"""QairuCowork — веб-версия.

Тот же продукт, что и бот: та же база, то же ядро расчёта окон.
Группа в Telegram и группа на сайте — один и тот же объект `Chat`,
поэтому расписание, заполненное в боте, сразу видно на сайте и наоборот.

Аккаунтов нет: личность подтверждается токеном в куке (ссылка-приглашение
или команда /link в боте) либо подписью Telegram Mini App.
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from qairu.calendar import build_ics
from qairu.config import Settings
from qairu.core.availability import (
    compute_availability,
    heatmap,
    parity_from_semester_start,
)
from qairu.core.intervals import fmt_interval, fmt_minutes
from qairu.core.parser import parse_any
from qairu.db import repo
from qairu.db.models import Chat, User
from qairu.i18n import LANG_NAMES, format_day, normalize_lang, t, weekday_name
from qairu.timeutils import chat_tz, today_in

from .auth import COOKIE_NAME, InitDataError, set_token_cookie, verify_init_data

log = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
SLOT_STEP = 30          # шаг сетки, минуты
DAYS_AHEAD = 7

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
settings = Settings.from_env_web()


@asynccontextmanager
async def lifespan(_: FastAPI):
    repo.init_engine(settings.database_url)
    await repo.create_schema()
    log.info("QairuCowork web запущен")
    yield
    await repo.dispose()


app = FastAPI(title="QairuCowork", docs_url=None, redoc_url=None, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


# --------------------------------------------------------------------------
# Общие помощники
# --------------------------------------------------------------------------

def _secure_cookies(request: Request) -> bool:
    return request.url.scheme == "https"


def _lang(request: Request, chat: Chat | None = None, user: User | None = None) -> str:
    if user is not None:
        return user.lang
    if chat is not None:
        return chat.lang
    return normalize_lang(request.headers.get("accept-language", "").split(",")[0])


async def current_user(request: Request) -> User | None:
    token = request.cookies.get(COOKIE_NAME, "")
    if not token:
        return None
    async with repo.session() as session:
        user = await repo.user_by_web_token(session, token)
        await session.commit()
        return user


def _render(request: Request, name: str, ctx: dict) -> HTMLResponse:
    base = {
        "request": request,
        "t": lambda key, **kw: t(ctx.get("lang", "ru"), key, **kw),
        "lang": ctx.get("lang", "ru"),
        "lang_names": LANG_NAMES,
        "fmt": fmt_minutes,
        "fmt_interval": fmt_interval,
        "weekday_name": lambda index: weekday_name(ctx.get("lang", "ru"), index),
        "format_day": lambda day: format_day(ctx.get("lang", "ru"), day),
    }
    base.update(ctx)
    return templates.TemplateResponse(request, name, base)


async def _load_group(slug: str) -> Chat:
    async with repo.session() as session:
        chat = await repo.get_chat_by_slug(session, slug)
    if chat is None:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    return chat


async def _is_member(chat_id: int, user: User | None) -> bool:
    if user is None:
        return False
    async with repo.session() as session:
        members = await repo.chat_members(session, chat_id)
    return any(member.user_id == user.user_id for member in members)


def _parity_of(chat: Chat):
    return parity_from_semester_start(chat.semester_start) if chat.semester_start else None


# --------------------------------------------------------------------------
# Лендинг и создание группы
# --------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def landing(request: Request, user: User | None = Depends(current_user)):
    groups = []
    if user is not None:
        async with repo.session() as session:
            groups = await repo.user_chats(session, user.user_id)
    return _render(request, "landing.html",
                   {"lang": _lang(request, user=user), "user": user, "groups": groups})


@app.post("/groups")
async def create_group(request: Request, title: str = Form(...), name: str = Form(...),
                       tz: str = Form("Asia/Almaty"), lang: str = Form("ru")):
    lang = normalize_lang(lang)
    async with repo.session() as session:
        chat = await repo.create_web_chat(session, title=title, tz=tz, lang=lang)
        user = await repo.create_web_user(session, full_name=name, lang=lang)
        await repo.add_membership(session, chat.chat_id, user.user_id)
        token = await repo.issue_web_session(session, user.user_id)
        slug = chat.slug
        await session.commit()

    response = RedirectResponse(f"/g/{slug}/me", status_code=303)
    set_token_cookie(response, token, _secure_cookies(request))
    return response


# --------------------------------------------------------------------------
# Вход в группу
# --------------------------------------------------------------------------

@app.get("/g/{slug}")
async def group_dashboard(request: Request, slug: str, t_param: str | None = None,
                          user: User | None = Depends(current_user)):
    """Дашборд группы. `?t=` — персональный токен из бота или приглашения."""
    token = request.query_params.get("t")
    if token:
        # Убираем токен из адресной строки: иначе он утечёт в историю,
        # в Referer и в чужой скриншот.
        response = RedirectResponse(f"/g/{slug}", status_code=303)
        set_token_cookie(response, token, _secure_cookies(request))
        return response

    chat = await _load_group(slug)
    if not await _is_member(chat.chat_id, user):
        return RedirectResponse(f"/g/{slug}/join", status_code=303)

    lang = chat.lang
    data = await _group_state(chat, user)
    return _render(request, "group.html", {"lang": lang, "chat": chat, "user": user, **data})


@app.get("/g/{slug}/join", response_class=HTMLResponse)
async def join_form(request: Request, slug: str, user: User | None = Depends(current_user)):
    chat = await _load_group(slug)
    if await _is_member(chat.chat_id, user):
        return RedirectResponse(f"/g/{slug}", status_code=303)
    async with repo.session() as session:
        members = await repo.chat_members(session, chat.chat_id)
    return _render(request, "join.html",
                   {"lang": chat.lang, "chat": chat, "user": user, "members": members})


@app.post("/g/{slug}/join")
async def join_submit(request: Request, slug: str, name: str = Form(...),
                      user: User | None = Depends(current_user)):
    chat = await _load_group(slug)
    async with repo.session() as session:
        if user is None:
            user = await repo.create_web_user(session, full_name=name, lang=chat.lang)
            token = await repo.issue_web_session(session, user.user_id)
        else:
            await repo.rename_user(session, user.user_id, name)
            token = None
        await repo.add_membership(session, chat.chat_id, user.user_id)
        await session.commit()

    response = RedirectResponse(f"/g/{slug}/me", status_code=303)
    if token:
        set_token_cookie(response, token, _secure_cookies(request))
    return response


@app.post("/api/tg-auth")
async def telegram_auth(request: Request):
    """Вход из Telegram Mini App: подписанный initData → тот же самый пользователь бота."""
    body = await request.json()
    init_data = body.get("initData", "")
    slug = body.get("slug", "")
    try:
        data = verify_init_data(init_data, settings.bot_token)
    except InitDataError as error:
        raise HTTPException(status_code=401, detail=str(error))

    tg_user = data.get("user") or {}
    user_id = tg_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="в initData нет пользователя")

    full_name = " ".join(filter(None, [tg_user.get("first_name"), tg_user.get("last_name")]))
    async with repo.session() as session:
        await repo.upsert_user(session, user_id=int(user_id),
                               username=tg_user.get("username"),
                               full_name=full_name or str(user_id),
                               lang=normalize_lang(tg_user.get("language_code")))
        if slug:
            chat = await repo.get_chat_by_slug(session, slug)
            if chat is not None:
                await repo.add_membership(session, chat.chat_id, int(user_id))
        token = await repo.issue_web_session(session, int(user_id))
        await session.commit()

    response = JSONResponse({"ok": True})
    set_token_cookie(response, token, _secure_cookies(request))
    return response


# --------------------------------------------------------------------------
# Состояние группы: тепловая карта, окна, участники, встречи
# --------------------------------------------------------------------------

async def _group_state(chat: Chat, user: User | None, quorum: int | None = None,
                       min_slot: int | None = None) -> dict:
    async with repo.session() as session:
        members = await repo.chat_members(session, chat.chat_id)
        people = await repo.build_person_schedules(session, members)
        meetings = await repo.chat_meetings(session, chat.chat_id, limit=10)
        responses = {
            meeting.id: await repo.meeting_responses(session, meeting.id)
            for meeting in meetings
        }
        filled_ids = {person.user_id for person in people if person.has_data}

    names = {member.user_id: member.display for member in members}
    tz = chat_tz(chat)
    today = today_in(tz)
    parity_of = _parity_of(chat)
    minimum = min_slot or chat.min_slot_min

    grid = heatmap(people, today, DAYS_AHEAD, chat.day_start_min, chat.day_end_min,
                   SLOT_STEP, parity_of, chat.travel_buffer_min)
    result = compute_availability(people, today, DAYS_AHEAD, chat.day_start_min,
                                  chat.day_end_min, minimum, quorum, parity_of,
                                  chat.travel_buffer_min)

    total = len(result.participants)
    return {
        "members": members,
        "names": names,
        "filled_ids": filled_ids,
        "missing": [member for member in members if member.user_id not in filled_ids],
        "grid": grid,
        "result": result,
        "total": total,
        "today": today,
        "slot_times": list(range(chat.day_start_min, chat.day_end_min, SLOT_STEP)),
        "meetings": meetings,
        "responses": responses,
        "quorum": quorum,
        "min_slot": minimum,
        "parity_of": parity_of,
    }


@app.get("/api/g/{slug}/state")
async def api_state(request: Request, slug: str, user: User | None = Depends(current_user)):
    """JSON-версия дашборда — сетка перерисовывается без перезагрузки страницы."""
    chat = await _load_group(slug)
    if not await _is_member(chat.chat_id, user):
        raise HTTPException(status_code=403, detail="not a member")

    quorum = request.query_params.get("quorum")
    min_slot = request.query_params.get("min")
    data = await _group_state(
        chat, user,
        quorum=int(quorum) if quorum and quorum.isdigit() else None,
        min_slot=int(min_slot) if min_slot and min_slot.isdigit() else None,
    )
    lang = chat.lang
    return {
        "total": data["total"],
        "quorum": data["result"].quorum,
        "everyone": data["result"].everyone,
        "days": [
            {
                "date": day.day.isoformat(),
                "label": format_day(lang, day.day),
                "cells": [
                    {"start": cell.start_min, "end": cell.end_min,
                     "count": cell.count, "free": cell.free_ids}
                    for cell in day.cells
                ],
            }
            for day in data["grid"]
        ],
        "windows": [
            {
                "date": day.day.isoformat(),
                "label": format_day(lang, day.day),
                "items": [
                    {"start": window.interval[0], "end": window.interval[1],
                     "text": fmt_interval(window.interval), "count": window.count,
                     "missing": [data["names"].get(person.user_id, "?")
                                 for person in data["result"].participants
                                 if person.user_id not in window.free_ids]}
                    for window in day.windows
                ],
            }
            for day in data["result"].days if day.has_windows
        ],
        "names": {str(key): value for key, value in data["names"].items()},
        "missing": [member.display for member in data["missing"]],
    }


# --------------------------------------------------------------------------
# Редактор своего расписания
# --------------------------------------------------------------------------

@app.get("/g/{slug}/me", response_class=HTMLResponse)
async def my_schedule(request: Request, slug: str, user: User | None = Depends(current_user)):
    chat = await _load_group(slug)
    if not await _is_member(chat.chat_id, user):
        return RedirectResponse(f"/g/{slug}/join", status_code=303)

    async with repo.session() as session:
        slots = await repo.get_slots(session, user.user_id)
        filled = await repo.is_filled(session, user.user_id)

    weekly = {weekday: [] for weekday in range(7)}
    dated = []
    for slot in slots:
        if slot.weekday is not None and slot.specific_date is None and slot.date_from is None:
            weekly[slot.weekday].append(
                {"start": slot.start_min, "end": slot.end_min,
                 "label": slot.label, "parity": slot.week_parity, "kind": slot.kind}
            )
        elif slot.specific_date is not None:
            dated.append(slot)
        elif slot.date_from is not None:
            dated.append(slot)

    return _render(request, "me.html", {
        "lang": chat.lang, "chat": chat, "user": user,
        "weekly_json": json.dumps(weekly, ensure_ascii=False),
        "weekly": weekly, "dated": dated, "filled": filled,
        "slot_times": list(range(chat.day_start_min, chat.day_end_min, SLOT_STEP)),
        "step": SLOT_STEP,
    })


@app.post("/api/g/{slug}/schedule")
async def save_schedule(request: Request, slug: str, user: User | None = Depends(current_user)):
    """Сохранить недельную занятость. Тело: {"slots": [{weekday,start,end,label,parity,kind}]}"""
    chat = await _load_group(slug)
    if not await _is_member(chat.chat_id, user):
        raise HTTPException(status_code=403, detail="not a member")

    payload = await request.json()
    rows = payload.get("slots") or []
    cleaned: list[tuple] = []
    for row in rows[:400]:
        try:
            weekday = int(row["weekday"])
            start = int(row["start"])
            end = int(row["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (0 <= weekday <= 6) or not (0 <= start < end <= 24 * 60):
            continue
        parity = row.get("parity")
        parity = int(parity) if parity in (0, 1, "0", "1") else None
        kind = str(row.get("kind") or "class")[:16]
        cleaned.append((weekday, start, end, str(row.get("label") or "")[:60], parity, kind))

    async with repo.session() as session:
        await repo.replace_weekly_slots(session, user.user_id, list(range(7)), cleaned, source="web")
        await session.commit()
    return {"ok": True, "saved": len(cleaned)}


@app.post("/api/g/{slug}/import")
async def import_text(request: Request, slug: str, user: User | None = Depends(current_user)):
    """Разбор расписания из свободного текста — тем же парсером, что и в боте."""
    chat = await _load_group(slug)
    if not await _is_member(chat.chat_id, user):
        raise HTTPException(status_code=403, detail="not a member")

    payload = await request.json()
    parsed = parse_any(str(payload.get("text") or "")[:8000])
    return {
        "ok": parsed.ok,
        "slots": [
            {"weekday": slot.weekday, "start": slot.start_min, "end": slot.end_min,
             "label": slot.label, "parity": slot.parity, "kind": slot.kind,
             "text": f"{fmt_minutes(slot.start_min)}–{fmt_minutes(slot.end_min)}"}
            for slot in parsed.slots
        ],
        "free_days": parsed.free_days,
        "errors": parsed.errors[:5],
    }


# --------------------------------------------------------------------------
# Встречи
# --------------------------------------------------------------------------

@app.post("/g/{slug}/meetings")
async def create_meeting(request: Request, slug: str, place: str = Form(""),
                         goal: str = Form(""), when: str = Form(""),
                         user: User | None = Depends(current_user)):
    chat = await _load_group(slug)
    if not await _is_member(chat.chat_id, user):
        return RedirectResponse(f"/g/{slug}/join", status_code=303)

    start_at = None
    when_text = when.strip()
    # `when` приходит из сетки как "2026-09-14T15:00|90" либо свободным текстом
    if "|" in when:
        iso, _, duration = when.partition("|")
        try:
            naive = datetime.fromisoformat(iso)
            start_at = naive.replace(tzinfo=chat_tz(chat))
            minutes = int(duration or 90)
            when_text = (f"{format_day(chat.lang, start_at.date())} · "
                         f"{fmt_minutes(start_at.hour * 60 + start_at.minute)}–"
                         f"{fmt_minutes(start_at.hour * 60 + start_at.minute + minutes)}")
        except ValueError:
            start_at = None

    async with repo.session() as session:
        members = await repo.chat_members(session, chat.chat_id)
        meeting = await repo.create_meeting(
            session, chat_id=chat.chat_id, initiator_id=user.user_id,
            place=place.strip()[:200], when_text=when_text[:200], goal=goal.strip()[:500],
            invitees=[member.user_id for member in members],
        )
        meeting.when_start = start_at
        await session.commit()
    return RedirectResponse(f"/g/{slug}", status_code=303)


@app.post("/g/{slug}/meetings/{meeting_id}/vote")
async def vote(request: Request, slug: str, meeting_id: int, answer: str = Form(...),
               comment: str = Form(""), user: User | None = Depends(current_user)):
    chat = await _load_group(slug)
    if not await _is_member(chat.chat_id, user):
        return RedirectResponse(f"/g/{slug}/join", status_code=303)
    if answer not in ("yes", "no", "change"):
        raise HTTPException(status_code=400, detail="bad answer")

    async with repo.session() as session:
        meeting = await repo.get_meeting(session, meeting_id)
        if meeting is None or meeting.chat_id != chat.chat_id:
            raise HTTPException(status_code=404, detail="meeting not found")
        await repo.set_response(session, meeting_id, user.user_id, answer, comment.strip()[:300])
        await session.commit()
    return RedirectResponse(f"/g/{slug}", status_code=303)


@app.post("/g/{slug}/meetings/{meeting_id}/cancel")
async def cancel_meeting(slug: str, meeting_id: int, user: User | None = Depends(current_user)):
    chat = await _load_group(slug)
    async with repo.session() as session:
        meeting = await repo.get_meeting(session, meeting_id)
        if meeting is None or meeting.chat_id != chat.chat_id:
            raise HTTPException(status_code=404, detail="meeting not found")
        if user is None or meeting.initiator_id != user.user_id:
            raise HTTPException(status_code=403, detail="only the initiator can cancel")
        meeting.status = "cancelled"
        await session.commit()
    return RedirectResponse(f"/g/{slug}", status_code=303)


@app.get("/g/{slug}/meetings/{meeting_id}.ics")
async def meeting_ics(slug: str, meeting_id: int):
    chat = await _load_group(slug)
    async with repo.session() as session:
        meeting = await repo.get_meeting(session, meeting_id)
    if meeting is None or meeting.chat_id != chat.chat_id or meeting.when_start is None:
        raise HTTPException(status_code=404, detail="no calendar data")

    payload = build_ics(uid=f"meeting-{meeting_id}", summary=meeting.goal or chat.title,
                        start=meeting.when_start, duration_min=90,
                        location=meeting.place, description=meeting.goal)
    return Response(
        payload,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="qairu-{meeting_id}.ics"'},
    )


# --------------------------------------------------------------------------
# Настройки группы
# --------------------------------------------------------------------------

@app.post("/g/{slug}/settings")
async def save_settings(slug: str, day_start: str = Form("08:00"), day_end: str = Form("22:00"),
                        min_slot: int = Form(30), buffer: int = Form(0),
                        semester: str = Form(""), lang: str = Form("ru"),
                        user: User | None = Depends(current_user)):
    chat = await _load_group(slug)
    if not await _is_member(chat.chat_id, user):
        raise HTTPException(status_code=403, detail="not a member")

    def hhmm(value: str, fallback: int) -> int:
        try:
            hours, _, minutes = value.partition(":")
            total = int(hours) * 60 + int(minutes or 0)
            return total if 0 <= total <= 24 * 60 else fallback
        except ValueError:
            return fallback

    async with repo.session() as session:
        target = await repo.get_chat(session, chat.chat_id)
        start = hhmm(day_start, target.day_start_min)
        end = hhmm(day_end, target.day_end_min)
        if start < end:
            target.day_start_min, target.day_end_min = start, end
        target.min_slot_min = max(5, min(int(min_slot), 12 * 60))
        target.travel_buffer_min = max(0, min(int(buffer), 120))
        target.lang = normalize_lang(lang)
        if semester.strip():
            try:
                target.semester_start = datetime.strptime(semester.strip(), "%Y-%m-%d").date()
            except ValueError:
                pass
        else:
            target.semester_start = None
        await session.commit()
    return RedirectResponse(f"/g/{slug}", status_code=303)


@app.get("/healthz")
async def healthz():
    return {"ok": True}
