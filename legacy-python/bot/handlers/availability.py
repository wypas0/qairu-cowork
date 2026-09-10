"""Команда /availability — общие свободные окна (в том числе по кворуму)."""

from __future__ import annotations

import html
import logging
import re

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ChatType, ParseMode
from telegram.ext import CallbackQueryHandler, CommandHandler, ContextTypes

from qairu.core.availability import (
    AvailabilityResult,
    compute_availability,
    parity_from_semester_start,
)
from qairu.core.intervals import fmt_interval, fmt_minutes
from qairu.db import repo
from qairu.db.models import Chat, User
from qairu.i18n import format_day, t
from qairu.textutils import clip
from ..utils import (
    chat_tz,
    extract_mentioned_users,
    extract_min_duration,
    mention_list,
    plain_names,
    sync_user,
    today_in,
)

log = logging.getLogger(__name__)

PERCENT_RE = re.compile(r"^(\d{1,3})%$")
QUORUM_RE = re.compile(r"^(?:q|кворум|кв)(\d{1,3})$", re.IGNORECASE)


def parse_quorum(args: list[str], total: int) -> int | None:
    """`80%` → 80% участников, `q8` / `кворум8` → ровно 8 человек. None — нужны все."""
    for index, arg in enumerate(args):
        percent = PERCENT_RE.match(arg)
        if percent:
            value = int(percent.group(1))
            return max(1, min(total, round(total * value / 100)))
        absolute = QUORUM_RE.match(arg)
        if absolute:
            return max(1, min(total, int(absolute.group(1))))
        if arg.lower() in ("кворум", "quorum", "кв", "q") and index + 1 < len(args):
            nxt = args[index + 1]
            if nxt.isdigit():
                return max(1, min(total, int(nxt)))
    return None


async def cmd_availability(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    tg_chat = update.effective_chat
    tg_user = update.effective_user
    if not message or not tg_chat or not tg_user:
        return

    async with repo.session() as session:
        await sync_user(session, tg_user)
        await session.commit()

    if tg_chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
        async with repo.session() as session:
            await repo.upsert_chat(session, tg_chat.id, tg_chat.title or "")
            await repo.add_membership(session, tg_chat.id, tg_user.id)
            await session.commit()
        text = await _build_report(update, context, tg_chat.id)
        await message.reply_text(text, parse_mode=ParseMode.HTML, disable_web_page_preview=True)
        return

    # личка: выбрать, про какой чат речь
    async with repo.session() as session:
        chats = await repo.user_chats(session, tg_user.id)
        user = await session.get(User, tg_user.id)
        lang = user.lang if user else "ru"

    if not chats:
        await message.reply_text(t(lang, "avail_no_members"))
        return
    if len(chats) == 1:
        text = await _build_report(update, context, chats[0].chat_id)
        await message.reply_text(text, parse_mode=ParseMode.HTML, disable_web_page_preview=True)
        return

    args = " ".join(context.args or [])[:48]
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton(chat.title or str(chat.chat_id),
                                  callback_data=f"avl:{chat.chat_id}")]
            for chat in chats
        ]
    )
    context.user_data["avail_args"] = args
    await message.reply_text(t(lang, "avail_title", who="…"), parse_mode=ParseMode.HTML,
                             reply_markup=keyboard)


async def on_chat_choice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    chat_id = int(query.data.split(":", 1)[1])
    saved = (context.user_data.get("avail_args") or "").split()
    text = await _build_report(update, context, chat_id, forced_args=saved)
    await query.edit_message_text(text, parse_mode=ParseMode.HTML, disable_web_page_preview=True)


async def _build_report(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    chat_id: int,
    forced_args: list[str] | None = None,
) -> str:
    tg_user = update.effective_user
    args = forced_args if forced_args is not None else (context.args or [])

    async with repo.session() as session:
        chat = await repo.get_chat(session, chat_id)
        if chat is None:
            return t("ru", "chat_not_setup")
        lang = chat.lang

        members = await repo.chat_members(session, chat_id)
        if not members:
            return t(lang, "avail_no_members")

        mentioned, unknown = await extract_mentioned_users(update, session)
        if mentioned:
            caller = await session.get(User, tg_user.id)
            selected, seen = [], set()
            for user in ([caller] if caller else []) + mentioned:
                if user and user.user_id not in seen:
                    seen.add(user.user_id)
                    selected.append(user)
            who = t(lang, "avail_selected", count=len(selected), names=plain_names(selected))
        else:
            selected = members
            who = t(lang, "avail_all", count=len(selected))

        minimum = extract_min_duration(args, chat.min_slot_min)
        people = await repo.build_person_schedules(session, selected)
        id_to_user = {user.user_id: user for user in selected}

    with_data = [person for person in people if person.has_data]
    if not with_data:
        return t(lang, "avail_need_schedule")

    quorum = parse_quorum(args, len(with_data))
    parity_of = parity_from_semester_start(chat.semester_start) if chat.semester_start else None
    tz = chat_tz(chat)
    today = today_in(tz)

    result = compute_availability(
        people,
        start_day=today,
        days_ahead=7,
        day_start=chat.day_start_min,
        day_end=chat.day_end_min,
        min_slot=minimum,
        quorum=quorum,
        parity_of=parity_of,
        buffer_min=chat.travel_buffer_min,
    )

    text = _render(result, lang, who, id_to_user, chat, parity_of, today)
    if unknown:
        text += "\n" + "\n".join(
            t(lang, "avail_user_not_found", name=html.escape(name)) for name in unknown[:3]
        )
    # Telegram режет сообщения длиннее 4096 символов — на большой группе
    # список окон легко перевалит лимит, и сообщение просто не уйдёт.
    return clip(text, note=t(lang, "avail_clipped"))


def _render(result: AvailabilityResult, lang: str, who: str, id_to_user: dict[int, User],
            chat: Chat, parity_of, today) -> str:
    total = len(result.participants)

    if result.everyone:
        text = t(lang, "avail_title", who=who)
    else:
        text = t(lang, "avail_quorum_title", quorum=result.quorum, total=total, who=who)

    if parity_of:
        parity_key = "parity_odd" if parity_of(today) == 0 else "parity_even"
        text += t(lang, "avail_parity_note", parity=t(lang, parity_key))

    if not result.any_windows:
        key = "avail_none" if result.everyone else "avail_quorum_none"
        text += "\n" + t(lang, key, min=result.min_slot, quorum=result.quorum)
    else:
        for day in result.days:
            if not day.has_windows:
                continue
            text += f"\n<b>{format_day(lang, day.day)}</b>\n"
            for window in day.windows:
                text += f"<code>{fmt_interval(window.interval)}</code>\n"
                if not result.everyone:
                    absent = [
                        id_to_user[person.user_id]
                        for person in result.participants
                        if person.user_id not in window.free_ids and person.user_id in id_to_user
                    ]
                    if absent:
                        text += t(lang, "avail_quorum_line", count=window.count, total=total,
                                  missing=plain_names(absent)) + "\n"
                    else:
                        text += t(lang, "avail_quorum_all") + "\n"

    if result.missing:
        missing_users = [id_to_user[p.user_id] for p in result.missing if p.user_id in id_to_user]
        text += t(lang, "avail_missing_note", names=mention_list(missing_users))

    text += t(lang, "avail_hint", start=fmt_minutes(chat.day_start_min),
              end=fmt_minutes(chat.day_end_min), min=result.min_slot)
    return text


def register(app) -> None:
    app.add_handler(CommandHandler("availability", cmd_availability))
    app.add_handler(CommandHandler("free", cmd_availability))
    app.add_handler(CallbackQueryHandler(on_chat_choice, pattern=r"^avl:"))
