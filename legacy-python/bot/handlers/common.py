"""Общие команды: /start, /help, /lang, /cancel, /settings."""

from __future__ import annotations

import logging
import re

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ChatType, ParseMode
from telegram.ext import CallbackQueryHandler, CommandHandler, ContextTypes

from qairu.core.intervals import fmt_minutes
from qairu.db import repo
from qairu.i18n import LANG_NAMES, t
from ..utils import is_chat_admin, resolve_lang, sync_user

log = logging.getLogger(__name__)

DEEP_LINK_RE = re.compile(r"^c(-?\d+)$")


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/start в личке. Поддерживает deep-link t.me/bot?start=c<chat_id>."""
    tg_user = update.effective_user
    message = update.effective_message
    if not tg_user or not message:
        return

    payload = context.args[0] if context.args else ""

    async with repo.session() as session:
        user = await sync_user(session, tg_user)
        lang = user.lang
        linked_title = None

        match = DEEP_LINK_RE.match(payload)
        if match:
            chat_id = int(match.group(1))
            chat = await repo.get_chat(session, chat_id)
            if chat:
                await repo.add_membership(session, chat_id, tg_user.id)
                linked_title = chat.title or str(chat_id)
        await session.commit()

    if linked_title:
        await message.reply_text(
            t(lang, "start_linked", chat=linked_title), parse_mode=ParseMode.HTML
        )
    else:
        await message.reply_text(
            t(lang, "start_private", name=tg_user.first_name), parse_mode=ParseMode.HTML
        )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if not message:
        return
    async with repo.session() as session:
        lang = await resolve_lang(update, session)
    await message.reply_text(t(lang, "help"), parse_mode=ParseMode.HTML)


async def cmd_lang(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    chat = update.effective_chat
    if not message or not chat:
        return

    async with repo.session() as session:
        lang = await resolve_lang(update, session)

    if chat.type in (ChatType.GROUP, ChatType.SUPERGROUP) and not await is_chat_admin(update, context):
        await message.reply_text(t(lang, "only_admin"))
        return

    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton(title, callback_data=f"lang:{code}")] for code, title in LANG_NAMES.items()]
    )
    await message.reply_text(t(lang, "choose_lang"), reply_markup=keyboard)


async def on_lang_choice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not query.data:
        return
    new_lang = query.data.split(":", 1)[1]
    chat = update.effective_chat
    tg_user = update.effective_user

    if chat and chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
        if not await is_chat_admin(update, context):
            async with repo.session() as session:
                lang = await resolve_lang(update, session)
            await query.answer(t(lang, "only_admin"), show_alert=True)
            return

    async with repo.session() as session:
        if tg_user:
            await sync_user(session, tg_user)
            await repo.set_user_lang(session, tg_user.id, new_lang)
        if chat and chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
            db_chat = await repo.upsert_chat(session, chat.id, chat.title or "")
            db_chat.lang = new_lang
        await session.commit()

    await query.answer()
    await query.edit_message_text(t(new_lang, "lang_set"))


async def cmd_settings(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/settings — показать или изменить настройки чата (только админ)."""
    message = update.effective_message
    tg_chat = update.effective_chat
    if not message or not tg_chat:
        return
    if tg_chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        async with repo.session() as session:
            lang = await resolve_lang(update, session)
        await message.reply_text(t(lang, "only_group"))
        return

    async with repo.session() as session:
        chat = await repo.upsert_chat(session, tg_chat.id, tg_chat.title or "")
        lang = chat.lang
        args = context.args or []

        if args:
            if not await is_chat_admin(update, context):
                await message.reply_text(t(lang, "only_admin"))
                return
            ok = _apply_setting(chat, args)
            await session.commit()
            await message.reply_text(t(lang, "settings_saved" if ok else "settings_bad"))
            return

        text = t(
            lang, "settings_title",
            start=fmt_minutes(chat.day_start_min),
            end=fmt_minutes(chat.day_end_min),
            min=chat.min_slot_min,
            buffer=chat.travel_buffer_min,
            semester=(chat.semester_start.strftime("%d.%m.%Y") if chat.semester_start
                      else t(lang, "settings_not_set")),
            reminder=chat.reminder_min,
            tz=chat.tz,
            lang=LANG_NAMES.get(chat.lang, chat.lang),
        )
    await message.reply_text(text, parse_mode=ParseMode.HTML)


def _apply_setting(chat, args: list[str]) -> bool:
    key = args[0].lower()
    try:
        if key == "hours" and len(args) >= 3:
            start, end = _hhmm(args[1]), _hhmm(args[2])
            if start is None or end is None or start >= end:
                return False
            chat.day_start_min, chat.day_end_min = start, end
            return True
        if key == "min" and len(args) >= 2:
            value = int(args[1])
            if not 5 <= value <= 12 * 60:
                return False
            chat.min_slot_min = value
            return True
        if key in ("buffer", "буфер") and len(args) >= 2:
            value = int(args[1])
            if not 0 <= value <= 120:
                return False
            chat.travel_buffer_min = value
            return True
        if key in ("semester", "семестр", "parity", "чётность", "четность") and len(args) >= 2:
            from datetime import date as _date
            from ..utils import parse_date_token
            day = parse_date_token(args[1], _date(1970, 1, 1))
            if day is None:
                return False
            chat.semester_start = day
            return True
        if key in ("reminder", "напоминание") and len(args) >= 2:
            value = int(args[1])
            if not 0 <= value <= 24 * 60:
                return False
            chat.reminder_min = value
            return True
        if key == "tz" and len(args) >= 2:
            from zoneinfo import ZoneInfo
            ZoneInfo(args[1])  # проверка, что зона существует
            chat.tz = args[1]
            return True
    except Exception:
        return False
    return False


def _hhmm(value: str) -> int | None:
    match = re.fullmatch(r"(\d{1,2})[:.]?(\d{2})?", value)
    if not match:
        return None
    hours = int(match.group(1))
    minutes = int(match.group(2) or 0)
    if not (0 <= hours <= 24 and 0 <= minutes < 60):
        return None
    return min(hours * 60 + minutes, 24 * 60)


async def cmd_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if not message:
        return
    async with repo.session() as session:
        lang = await resolve_lang(update, session)
    context.user_data.clear()
    await message.reply_text(t(lang, "cancelled"))


async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    log.exception("Ошибка при обработке апдейта", exc_info=context.error)


def register(app) -> None:
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("lang", cmd_lang))
    app.add_handler(CommandHandler("settings", cmd_settings))
    app.add_handler(CallbackQueryHandler(on_lang_choice, pattern=r"^lang:"))
    app.add_error_handler(on_error)
