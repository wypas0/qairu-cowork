"""Слой доступа к данным. Все запросы к БД живут здесь."""

from __future__ import annotations

from datetime import date

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from ..core.availability import PersonSchedule
from .models import (Base, BusySlot, Chat, Meeting, MeetingResponse, Membership,
                     ScheduleState, User, utcnow)

_engine = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def init_engine(database_url: str) -> None:
    global _engine, _session_factory
    _engine = create_async_engine(database_url, echo=False, pool_pre_ping=True)
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)


async def create_schema() -> None:
    assert _engine is not None, "init_engine() не вызван"
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def session() -> AsyncSession:
    assert _session_factory is not None, "init_engine() не вызван"
    return _session_factory()


async def dispose() -> None:
    if _engine is not None:
        await _engine.dispose()


# --------------------------------------------------------------------------
# Пользователи и чаты
# --------------------------------------------------------------------------

async def upsert_user(s: AsyncSession, user_id: int, username: str | None,
                      full_name: str, lang: str | None = None) -> User:
    """Создать или обновить пользователя. Username обновляем всегда — он меняется."""
    user = await s.get(User, user_id)
    if user is None:
        user = User(user_id=user_id, username=username, full_name=full_name, lang=lang or "ru")
        s.add(user)
    else:
        user.username = username
        if full_name:
            user.full_name = full_name
        if lang:
            user.lang = lang
    await s.flush()
    return user


async def set_user_lang(s: AsyncSession, user_id: int, lang: str) -> None:
    user = await s.get(User, user_id)
    if user:
        user.lang = lang


async def upsert_chat(s: AsyncSession, chat_id: int, title: str) -> Chat:
    chat = await s.get(Chat, chat_id)
    if chat is None:
        chat = Chat(chat_id=chat_id, title=title)
        s.add(chat)
    elif title:
        chat.title = title
    await s.flush()
    return chat


async def get_chat(s: AsyncSession, chat_id: int) -> Chat | None:
    return await s.get(Chat, chat_id)


async def add_membership(s: AsyncSession, chat_id: int, user_id: int) -> bool:
    """True, если участник добавлен впервые."""
    existing = await s.get(Membership, (chat_id, user_id))
    if existing:
        return False
    s.add(Membership(chat_id=chat_id, user_id=user_id))
    await s.flush()
    return True


async def remove_membership(s: AsyncSession, chat_id: int, user_id: int) -> None:
    await s.execute(
        delete(Membership).where(Membership.chat_id == chat_id, Membership.user_id == user_id)
    )


async def chat_members(s: AsyncSession, chat_id: int) -> list[User]:
    stmt = (
        select(User)
        .join(Membership, Membership.user_id == User.user_id)
        .where(Membership.chat_id == chat_id)
        .order_by(User.full_name)
    )
    return list((await s.execute(stmt)).scalars().all())


async def user_chats(s: AsyncSession, user_id: int) -> list[Chat]:
    stmt = (
        select(Chat)
        .join(Membership, Membership.chat_id == Chat.chat_id)
        .where(Membership.user_id == user_id)
    )
    return list((await s.execute(stmt)).scalars().all())


async def find_user_by_username(s: AsyncSession, username: str) -> User | None:
    clean = username.lstrip("@").lower()
    stmt = select(User).where(func.lower(User.username) == clean)
    return (await s.execute(stmt)).scalars().first()


# --------------------------------------------------------------------------
# Расписание
# --------------------------------------------------------------------------

async def replace_weekly_slots(s: AsyncSession, user_id: int, weekdays: list[int],
                               slots: list[tuple], source: str = "import") -> None:
    """Заменить недельные слоты для перечисленных дней.

    slots: [(weekday, start_min, end_min, label[, parity[, kind]]), ...]
    Удаляются все повторяющиеся слоты этих дней — обеих чётностей.
    """
    if weekdays:
        await s.execute(
            delete(BusySlot).where(
                BusySlot.user_id == user_id,
                BusySlot.weekday.in_(weekdays),
                BusySlot.specific_date.is_(None),
                BusySlot.date_from.is_(None),
            )
        )
    for row in slots:
        weekday, start, end, label = row[0], row[1], row[2], row[3]
        parity = row[4] if len(row) > 4 else None
        kind = row[5] if len(row) > 5 else "class"
        s.add(BusySlot(user_id=user_id, weekday=weekday, start_min=start, end_min=end,
                       label=label, week_parity=parity, kind=kind, source=source))
    await mark_filled(s, user_id, True)


async def clear_schedule(s: AsyncSession, user_id: int) -> None:
    await s.execute(delete(BusySlot).where(BusySlot.user_id == user_id))
    await mark_filled(s, user_id, False)


async def add_dated_slot(s: AsyncSession, user_id: int, day: date, start: int, end: int,
                         label: str = "", kind: str = "other") -> None:
    """Разовая занятость на конкретную дату."""
    s.add(BusySlot(user_id=user_id, specific_date=day, start_min=start,
                   end_min=end, label=label, kind=kind, source="wizard"))
    await mark_filled(s, user_id, True)


async def add_range_slot(s: AsyncSession, user_id: int, date_from: date, date_to: date,
                         start: int, end: int, label: str = "", kind: str = "exam") -> None:
    """Занятость на диапазон дат: сессия, поездка, «занят до пятницы»."""
    s.add(BusySlot(user_id=user_id, date_from=date_from, date_to=date_to, start_min=start,
                   end_min=end, label=label, kind=kind, source="wizard"))
    await mark_filled(s, user_id, True)


async def delete_dated_slots(s: AsyncSession, user_id: int) -> int:
    """Удалить все разовые занятости и диапазоны, оставив недельное расписание."""
    result = await s.execute(
        delete(BusySlot).where(
            BusySlot.user_id == user_id,
            (BusySlot.specific_date.is_not(None)) | (BusySlot.date_from.is_not(None)),
        )
    )
    return result.rowcount or 0


async def get_slots(s: AsyncSession, user_id: int) -> list[BusySlot]:
    stmt = select(BusySlot).where(BusySlot.user_id == user_id).order_by(
        BusySlot.weekday, BusySlot.specific_date, BusySlot.start_min
    )
    return list((await s.execute(stmt)).scalars().all())


async def mark_filled(s: AsyncSession, user_id: int, filled: bool) -> None:
    state = await s.get(ScheduleState, user_id)
    if state is None:
        s.add(ScheduleState(user_id=user_id, filled=filled))
    else:
        state.filled = filled


async def is_filled(s: AsyncSession, user_id: int) -> bool:
    state = await s.get(ScheduleState, user_id)
    return bool(state and state.filled)


async def build_person_schedules(s: AsyncSession, users: list[User]) -> list[PersonSchedule]:
    """Собрать доменные объекты PersonSchedule для движка availability."""
    if not users:
        return []
    ids = [user.user_id for user in users]

    stmt = select(BusySlot).where(BusySlot.user_id.in_(ids))
    slots = list((await s.execute(stmt)).scalars().all())

    stmt_state = select(ScheduleState).where(ScheduleState.user_id.in_(ids))
    filled_ids = {
        state.user_id for state in (await s.execute(stmt_state)).scalars().all() if state.filled
    }

    by_user: dict[int, PersonSchedule] = {
        user.user_id: PersonSchedule(
            user_id=user.user_id,
            name=user.display,
            has_data=user.user_id in filled_ids,
        )
        for user in users
    }
    for slot in slots:
        person = by_user.get(slot.user_id)
        if person is None:
            continue
        interval = (slot.start_min, slot.end_min)
        if slot.specific_date is not None:
            person.dated.setdefault(slot.specific_date, []).append(interval)
        elif slot.date_from is not None and slot.date_to is not None:
            person.ranges.append((slot.date_from, slot.date_to, slot.start_min, slot.end_min))
        elif slot.weekday is not None:
            if slot.week_parity is None:
                person.weekly.setdefault(slot.weekday, []).append(interval)
            else:
                person.weekly_parity.setdefault(slot.week_parity, {}).setdefault(
                    slot.weekday, []
                ).append(interval)
    return [by_user[user.user_id] for user in users]


# --------------------------------------------------------------------------
# Встречи
# --------------------------------------------------------------------------

async def create_meeting(s: AsyncSession, chat_id: int, initiator_id: int, place: str,
                         when_text: str, goal: str, invitees: list[int]) -> Meeting:
    meeting = Meeting(
        chat_id=chat_id,
        initiator_id=initiator_id,
        place=place,
        when_text=when_text,
        goal=goal,
        invitees=",".join(str(uid) for uid in invitees),
    )
    s.add(meeting)
    await s.flush()
    return meeting


async def get_meeting(s: AsyncSession, meeting_id: int) -> Meeting | None:
    return await s.get(Meeting, meeting_id)


async def set_response(s: AsyncSession, meeting_id: int, user_id: int,
                       answer: str, comment: str = "") -> None:
    existing = await s.get(MeetingResponse, (meeting_id, user_id))
    if existing is None:
        s.add(MeetingResponse(meeting_id=meeting_id, user_id=user_id,
                              answer=answer, comment=comment))
    else:
        existing.answer = answer
        if comment:
            existing.comment = comment


async def open_meetings_with_time(s: AsyncSession) -> list[Meeting]:
    """Встречи с известным временем начала — для восстановления напоминаний после рестарта."""
    stmt = select(Meeting).where(Meeting.status == "open", Meeting.when_start.is_not(None))
    return list((await s.execute(stmt)).scalars().all())


async def meeting_responses(s: AsyncSession, meeting_id: int) -> list[MeetingResponse]:
    stmt = select(MeetingResponse).where(MeetingResponse.meeting_id == meeting_id)
    return list((await s.execute(stmt)).scalars().all())


async def users_by_ids(s: AsyncSession, ids: list[int]) -> dict[int, User]:
    if not ids:
        return {}
    stmt = select(User).where(User.user_id.in_(ids))
    return {user.user_id: user for user in (await s.execute(stmt)).scalars().all()}


# --------------------------------------------------------------------------
# Веб-версия: слаги групп, синтетические пользователи, сессии-ссылки
# --------------------------------------------------------------------------

import secrets  # noqa: E402
import string  # noqa: E402

from .models import WebSession  # noqa: E402

_SLUG_ALPHABET = string.ascii_lowercase + string.digits
# Синтетические id для сущностей, созданных на сайте. Telegram выдаёт
# положительные id пользователям и id вида -100… чатам, поэтому диапазон
# ниже -10^15 гарантированно свободен.
_SYNTHETIC_BASE = -10**15


def new_slug(length: int = 8) -> str:
    return "".join(secrets.choice(_SLUG_ALPHABET) for _ in range(length))


def new_web_id() -> int:
    return _SYNTHETIC_BASE - secrets.randbits(40)


def new_token() -> str:
    return secrets.token_urlsafe(32)


async def ensure_slug(s: AsyncSession, chat: Chat) -> str:
    """Выдать группе публичный слаг, если его ещё нет."""
    if chat.slug:
        return chat.slug
    for _ in range(10):
        candidate = new_slug()
        exists = (await s.execute(select(Chat).where(Chat.slug == candidate))).scalars().first()
        if exists is None:
            chat.slug = candidate
            await s.flush()
            return candidate
    raise RuntimeError("не удалось подобрать свободный слаг")


async def get_chat_by_slug(s: AsyncSession, slug: str) -> Chat | None:
    stmt = select(Chat).where(Chat.slug == slug)
    return (await s.execute(stmt)).scalars().first()


async def create_web_chat(s: AsyncSession, title: str, tz: str = "Asia/Almaty",
                          lang: str = "ru") -> Chat:
    """Группа, созданная на сайте, без Telegram-чата."""
    chat = Chat(chat_id=new_web_id(), title=title[:200] or "Группа",
                origin="web", tz=tz, lang=lang)
    s.add(chat)
    await s.flush()
    await ensure_slug(s, chat)
    return chat


async def create_web_user(s: AsyncSession, full_name: str, lang: str = "ru") -> User:
    user = User(user_id=new_web_id(), username=None, full_name=full_name[:120] or "Аноним",
                lang=lang, is_web=True)
    s.add(user)
    await s.flush()
    return user


async def issue_web_session(s: AsyncSession, user_id: int) -> str:
    token = new_token()
    s.add(WebSession(token=token, user_id=user_id))
    await s.flush()
    return token


async def user_by_web_token(s: AsyncSession, token: str) -> User | None:
    if not token:
        return None
    row = await s.get(WebSession, token)
    if row is None:
        return None
    row.last_seen_at = utcnow()
    return await s.get(User, row.user_id)


async def rename_user(s: AsyncSession, user_id: int, full_name: str) -> None:
    user = await s.get(User, user_id)
    if user and full_name.strip():
        user.full_name = full_name.strip()[:120]


async def chat_meetings(s: AsyncSession, chat_id: int, limit: int = 20) -> list[Meeting]:
    stmt = (select(Meeting).where(Meeting.chat_id == chat_id)
            .order_by(Meeting.created_at.desc()).limit(limit))
    return list((await s.execute(stmt)).scalars().all())
