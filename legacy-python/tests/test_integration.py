"""Бот и сайт — один продукт: общая база, общее ядро, общий человек.

Эти тесты проверяют именно стык, а не отдельные половины.
"""

import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from qairu.calendar import build_ics
from qairu.db import repo
from qairu.textutils import clip
from web.app import app


def run(coro):
    """Отдельный цикл событий: TestClient крутит свой собственный."""
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_schedule_filled_in_the_bot_shows_up_on_the_site(client):
    """Человек заполнил расписание в Telegram — на сайте оно уже есть."""
    slug = client.post(
        "/groups",
        data={"title": "Стык", "name": "Амир", "tz": "Asia/Almaty", "lang": "ru"},
        follow_redirects=False,
    ).headers["location"].split("/")[2]
    client.post(f"/api/g/{slug}/schedule", json={"slots": []})

    async def add_telegram_member():
        async with repo.session() as session:
            chat = await repo.get_chat_by_slug(session, slug)
            await repo.upsert_user(session, user_id=555001, username="asel",
                                   full_name="Асель", lang="ru")
            await repo.add_membership(session, chat.chat_id, 555001)
            # как будто человек прислал боту «Пн 9:00-12:00»
            await repo.replace_weekly_slots(session, 555001, [0],
                                            [(0, 540, 720, "Матан", None, "class")],
                                            source="import")
            await session.commit()

    run(add_telegram_member())

    state = client.get(f"/api/g/{slug}/state").json()
    assert state["total"] == 2
    assert "Асель" in state["names"].values()

    monday = state["days"][0]
    busy = [cell for cell in monday["cells"] if 540 <= cell["start"] < 720]
    assert busy and all(cell["count"] == 1 for cell in busy), "занятость из бота должна сузить окна"
    free = [cell for cell in monday["cells"] if cell["start"] >= 720]
    assert free and all(cell["count"] == 2 for cell in free)


def test_group_created_on_the_site_is_reachable_by_the_bot_layer(client):
    """Группа с сайта — обычный Chat: бот работает с ней теми же функциями."""
    slug = client.post(
        "/groups",
        data={"title": "Из веба", "name": "Нурбек", "tz": "Asia/Almaty", "lang": "kk"},
        follow_redirects=False,
    ).headers["location"].split("/")[2]

    async def check():
        async with repo.session() as session:
            chat = await repo.get_chat_by_slug(session, slug)
            assert chat is not None
            assert chat.origin == "web"
            assert chat.lang == "kk"
            members = await repo.chat_members(session, chat.chat_id)
            people = await repo.build_person_schedules(session, members)
            return chat, members, people

    chat, members, people = run(check())
    assert len(members) == 1 and len(people) == 1
    # синтетический id заведомо вне диапазона Telegram
    assert chat.chat_id < -10**14


def test_meeting_time_survives_a_round_trip_through_the_database(client):
    """Часовой пояс не должен теряться при сохранении — иначе напоминания врут."""
    slug = client.post(
        "/groups",
        data={"title": "Время", "name": "Амир", "tz": "Asia/Almaty", "lang": "ru"},
        follow_redirects=False,
    ).headers["location"].split("/")[2]
    client.post(f"/api/g/{slug}/schedule", json={"slots": []})

    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    client.post(f"/g/{slug}/meetings",
                data={"place": "Ауд. 305", "goal": "Проект", "when": f"{tomorrow}T15:00|60"})

    async def read_back():
        async with repo.session() as session:
            chat = await repo.get_chat_by_slug(session, slug)
            meetings = await repo.chat_meetings(session, chat.chat_id)
            return meetings[0]

    meeting = run(read_back())
    assert meeting.when_start is not None
    assert meeting.when_start.tzinfo is not None, "дата обязана вернуться с часовым поясом"
    assert meeting.when_start.astimezone(timezone.utc).hour == 10   # 15:00 UTC+5

    # то же значение переживает сравнение с now(), на котором раньше падало
    assert meeting.when_start > datetime.now(timezone.utc) - timedelta(days=2)


def test_ics_from_bot_and_site_describe_the_same_event():
    start = datetime(2026, 9, 14, 15, 0, tzinfo=timezone(timedelta(hours=5)))
    payload = build_ics("meeting-9", "Разбор задач", start, 90, "Библиотека", "Разбор задач")
    assert "DTSTART:20260914T100000Z" in payload
    assert "DTEND:20260914T113000Z" in payload
    assert payload.endswith("\r\n")


def test_long_answer_is_clipped_below_the_telegram_limit():
    body = "\n".join(f"<code>{index:02d}:00–{index:02d}:30</code>" for index in range(400))
    result = clip(body, note="…обрезано")
    assert len(result) < 4096
    assert result.endswith("…обрезано")
    assert result.count("<code>") == result.count("</code>"), "теги не должны рваться"
