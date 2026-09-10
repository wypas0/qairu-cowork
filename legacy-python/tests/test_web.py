"""Сквозные тесты веб-версии: вход по ссылке, сетка, окна, встречи, Mini App."""

import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient

from web.app import app
from web.auth import InitDataError, verify_init_data

BOT_TOKEN = "123456:AAHtestTOKENtestTOKENtestTOKENtestTO"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def make_group(client, title="ИС-21", name="Амир"):
    response = client.post(
        "/groups",
        data={"title": title, "name": name, "tz": "Asia/Almaty", "lang": "ru"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    return response.headers["location"].split("/")[2]


# --- базовый путь -------------------------------------------------------

def test_landing_renders(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "QairuCowork" in response.text


def test_create_group_sets_cookie_and_redirects_to_editor(client):
    response = client.post(
        "/groups",
        data={"title": "Тест", "name": "Амир", "tz": "Asia/Almaty", "lang": "ru"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert response.headers["location"].endswith("/me")
    assert "qairu_token" in response.headers.get("set-cookie", "")


def test_unknown_group_is_404(client):
    assert client.get("/g/nosuchgroup").status_code == 404


def test_stranger_is_sent_to_join(client):
    slug = make_group(client, title="Чужая")
    with TestClient(app) as stranger:
        response = stranger.get(f"/g/{slug}", follow_redirects=False)
        assert response.status_code == 303
        assert response.headers["location"].endswith("/join")


# --- расписание ---------------------------------------------------------

def test_import_uses_the_same_parser_as_the_bot(client):
    slug = make_group(client)
    response = client.post(f"/api/g/{slug}/import",
                           json={"text": "Пн 9:00-10:30 Матан\nСб 18:00-22:00 работа"})
    data = response.json()
    assert data["ok"]
    assert {slot["kind"] for slot in data["slots"]} == {"class", "work"}
    assert data["slots"][0]["text"] == "09:00–10:30"


def test_save_schedule_rejects_broken_rows(client):
    slug = make_group(client)
    response = client.post(f"/api/g/{slug}/schedule", json={"slots": [
        {"weekday": 0, "start": 540, "end": 630},          # ок
        {"weekday": 9, "start": 540, "end": 630},          # нет такого дня
        {"weekday": 1, "start": 700, "end": 600},          # конец раньше начала
        {"weekday": 2, "start": "нет", "end": 600},        # мусор
    ]})
    assert response.json() == {"ok": True, "saved": 1}


def test_fresh_member_is_not_counted_until_they_save(client):
    """Пока человек не сохранил расписание, он не «свободен всегда» — он неизвестен."""
    slug = make_group(client)
    state = client.get(f"/api/g/{slug}/state").json()
    assert state["total"] == 0
    assert all(cell["count"] == 0 for cell in state["days"][0]["cells"])


def test_saving_an_empty_grid_means_free_all_week(client):
    """Пустая сетка — осмысленный ответ «я свободен», а не отсутствие ответа."""
    slug = make_group(client)
    client.post(f"/api/g/{slug}/schedule", json={"slots": []})
    state = client.get(f"/api/g/{slug}/state").json()
    assert state["total"] == 1
    assert all(cell["count"] == 1 for cell in state["days"][0]["cells"])


def test_saved_schedule_shrinks_the_windows(client):
    slug = make_group(client)
    client.post(f"/api/g/{slug}/schedule",
                json={"slots": [{"weekday": d, "start": 540, "end": 630} for d in range(7)]})
    state = client.get(f"/api/g/{slug}/state").json()
    cells = state["days"][0]["cells"]
    busy = [cell for cell in cells if 540 <= cell["start"] < 630]
    free = [cell for cell in cells if cell["start"] >= 630]
    assert busy and all(cell["count"] == 0 for cell in busy)
    assert free and all(cell["count"] == 1 for cell in free)


# --- второй участник и кворум -------------------------------------------

def test_second_member_joins_and_quorum_relaxes_windows():
    with TestClient(app) as owner:
        slug = make_group(owner, title="Кворум", name="Амир")
        # владелец занят весь понедельник
        owner.post(f"/api/g/{slug}/schedule",
                   json={"slots": [{"weekday": 0, "start": 0, "end": 1440}]})

        with TestClient(app) as guest:
            response = guest.post(f"/g/{slug}/join", data={"name": "Асель"},
                                  follow_redirects=False)
            assert response.status_code == 303
            guest.post(f"/api/g/{slug}/schedule", json={"slots": []})

            state_all = guest.get(f"/api/g/{slug}/state").json()
            assert state_all["total"] == 2
            monday = state_all["days"][0]
            assert all(cell["count"] <= 1 for cell in monday["cells"])

            state_quorum = guest.get(f"/api/g/{slug}/state?quorum=1").json()
            assert state_quorum["quorum"] == 1
            assert state_quorum["everyone"] is False
            monday_windows = [day for day in state_quorum["windows"]
                              if day["date"] == monday["date"]]
            assert monday_windows, "при кворуме 1 окно в понедельник обязано найтись"
            assert "Амир" in monday_windows[0]["items"][0]["missing"]


# --- встречи ------------------------------------------------------------

def test_meeting_from_a_window_gets_a_calendar_file(client):
    slug = make_group(client, title="Встречи")
    client.post(f"/api/g/{slug}/schedule", json={"slots": []})
    state = client.get(f"/api/g/{slug}/state").json()
    day = state["windows"][0]
    when = f"{day['date']}T10:00|90"

    response = client.post(f"/g/{slug}/meetings",
                           data={"place": "Библиотека", "goal": "Разбор задач", "when": when},
                           follow_redirects=False)
    assert response.status_code == 303

    page = client.get(f"/g/{slug}").text
    assert "Библиотека" in page and "Разбор задач" in page

    meeting_id = int(page.split("/meetings/")[1].split("/")[0].split(".")[0])
    ics = client.get(f"/g/{slug}/meetings/{meeting_id}.ics")
    assert ics.status_code == 200
    assert "BEGIN:VEVENT" in ics.text
    assert "SUMMARY:Разбор задач" in ics.text
    # 10:00 в Asia/Almaty (UTC+5) — это 05:00 UTC
    assert "T050000Z" in ics.text


def test_vote_and_cancel(client):
    slug = make_group(client, title="Голоса")
    client.post(f"/g/{slug}/meetings", data={"place": "Кафе", "goal": "Обсудить", "when": "завтра"})
    page = client.get(f"/g/{slug}").text
    meeting_id = int(page.split("/meetings/")[1].split("/")[0].split(".")[0])

    client.post(f"/g/{slug}/meetings/{meeting_id}/vote", data={"answer": "yes"})
    assert "✅ 1" in client.get(f"/g/{slug}").text

    client.post(f"/g/{slug}/meetings/{meeting_id}/vote",
                data={"answer": "change", "comment": "лучше в 16:00"})
    page = client.get(f"/g/{slug}").text
    assert "лучше в 16:00" in page and "✅ 0" in page

    client.post(f"/g/{slug}/meetings/{meeting_id}/cancel")
    assert "Встреча отменена" in client.get(f"/g/{slug}").text


def test_bad_vote_is_rejected(client):
    slug = make_group(client, title="Плохой голос")
    client.post(f"/g/{slug}/meetings", data={"place": "X", "goal": "Y", "when": "z"})
    page = client.get(f"/g/{slug}").text
    meeting_id = int(page.split("/meetings/")[1].split("/")[0].split(".")[0])
    response = client.post(f"/g/{slug}/meetings/{meeting_id}/vote", data={"answer": "maybe"})
    assert response.status_code == 400


# --- настройки ----------------------------------------------------------

def test_settings_change_the_grid(client):
    slug = make_group(client, title="Настройки")
    client.post(f"/g/{slug}/settings", data={
        "day_start": "10:00", "day_end": "14:00", "min_slot": 60,
        "buffer": 15, "semester": "2026-09-01", "lang": "ru"})
    state = client.get(f"/api/g/{slug}/state").json()
    cells = state["days"][0]["cells"]
    assert cells[0]["start"] == 600 and cells[-1]["end"] == 840


# --- Telegram Mini App --------------------------------------------------

def sign_init_data(payload: dict, token: str = BOT_TOKEN) -> str:
    pairs = {key: value for key, value in payload.items()}
    check = "\n".join(f"{key}={pairs[key]}" for key in sorted(pairs))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    pairs["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(pairs)


def test_verify_init_data_accepts_a_correct_signature():
    raw = sign_init_data({
        "auth_date": str(int(time.time())),
        "query_id": "AAF",
        "user": json.dumps({"id": 777, "first_name": "Амир"}, ensure_ascii=False),
    })
    data = verify_init_data(raw, BOT_TOKEN)
    assert data["user"]["id"] == 777


def test_verify_init_data_rejects_a_tampered_payload():
    raw = sign_init_data({"auth_date": str(int(time.time())), "user": '{"id": 1}'})
    tampered = raw.replace("%22id%22%3A+1", "%22id%22%3A+2")
    with pytest.raises(InitDataError):
        verify_init_data(tampered, BOT_TOKEN)


def test_verify_init_data_rejects_a_stale_payload():
    raw = sign_init_data({
        "auth_date": str(int(time.time()) - 10 * 24 * 3600),
        "user": '{"id": 3}',
    })
    with pytest.raises(InitDataError):
        verify_init_data(raw, BOT_TOKEN)


def test_verify_init_data_rejects_another_bots_token():
    raw = sign_init_data({"auth_date": str(int(time.time())), "user": '{"id": 4}'})
    with pytest.raises(InitDataError):
        verify_init_data(raw, "999999:OTHERtokenOTHERtokenOTHERtokenOTHE")


def test_mini_app_login_joins_the_group_as_the_telegram_user():
    with TestClient(app) as owner:
        slug = make_group(owner, title="Мини-апп")

    with TestClient(app) as tg_client:
        raw = sign_init_data({
            "auth_date": str(int(time.time())),
            "user": json.dumps({"id": 424242, "first_name": "Нурбек",
                                "username": "nurbek"}, ensure_ascii=False),
        })
        response = tg_client.post("/api/tg-auth", json={"initData": raw, "slug": slug})
        assert response.status_code == 200
        page = tg_client.get(f"/g/{slug}")
        assert page.status_code == 200
        assert "Нурбек" in page.text


def test_mini_app_login_refuses_garbage():
    with TestClient(app) as tg_client:
        response = tg_client.post("/api/tg-auth", json={"initData": "user=1&hash=deadbeef"})
        assert response.status_code == 401


def test_healthz(client):
    assert client.get("/healthz").json() == {"ok": True}


# --- регрессии разметки ---------------------------------------------------

def test_heatmap_rows_have_distinct_times(client):
    """Каждая строка сетки — свой получас.

    Ловит ошибку вложенных циклов Jinja: `loop.index0` внутри внутреннего
    цикла указывает на внутренний цикл, и тогда все строки получают время
    первой клетки, а раскрашивается только верхний ряд.
    """
    import re

    slug = make_group(client, title="Сетка")
    client.post(f"/api/g/{slug}/schedule", json={"slots": []})
    page = client.get(f"/g/{slug}").text

    starts = [int(value) for value in re.findall(r'class="cell h0" data-date="[^"]+"\s+data-start="(\d+)"', page)]
    assert starts, "клетки сетки не отрисовались"
    monday = starts[::7]                      # первая колонка каждой строки
    assert len(set(monday)) == len(monday), "строки не должны повторять одно и то же время"
    assert monday == sorted(monday)
    assert monday[1] - monday[0] == 30


def test_editor_grid_covers_the_whole_working_day(client):
    slug = make_group(client, title="Редактор")
    page = client.get(f"/g/{slug}/me").text
    assert page.count('data-weekday="0"') == 28      # 08:00–22:00 по 30 минут
    assert 'data-start="480"' in page and 'data-start="1290"' in page
