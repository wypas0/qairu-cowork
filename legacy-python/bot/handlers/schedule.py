"""Ввод расписания в личке: /schedule, /import, /wizard, /myschedule, /clear, /busy."""

from __future__ import annotations

import html
import logging
import re

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from qairu.core.intervals import fmt_minutes, merge
from qairu.core.parser import ParseResult, _find_ranges, find_kind, is_all_day, parse_any
from qairu.db import repo
from qairu.i18n import t, weekday_name
from ..utils import chat_tz, parse_date_token, resolve_lang, sync_user, today_in

log = logging.getLogger(__name__)

# состояния диалогов
IMPORT_WAIT, IMPORT_CONFIRM = range(2)
WIZ_PICK_DAY, WIZ_WAIT_TEXT = range(2, 4)
BUSY_WAIT = 4

PRIVATE = filters.ChatType.PRIVATE


# --------------------------------------------------------------------------
# Импорт расписания текстом
# --------------------------------------------------------------------------

async def cmd_schedule(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    async with repo.session() as session:
        await sync_user(session, update.effective_user)
        lang = await resolve_lang(update, session)
        await session.commit()
    await update.effective_message.reply_text(t(lang, "schedule_intro"), parse_mode=ParseMode.HTML)
    return IMPORT_WAIT


async def on_schedule_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    message = update.effective_message
    text = message.text or ""

    async with repo.session() as session:
        await sync_user(session, update.effective_user)
        lang = await resolve_lang(update, session)
        await session.commit()

    result = parse_any(text)
    if not result.ok:
        await message.reply_text(t(lang, "parse_failed"), parse_mode=ParseMode.HTML)
        return IMPORT_WAIT

    context.user_data["pending_schedule"] = {
        "slots": [(s.weekday, s.start_min, s.end_min, s.label, s.parity, s.kind)
                  for s in result.slots],
        "free_days": result.free_days,
    }

    preview = _render_parse_preview(result, lang)
    body = t(lang, "parse_preview", schedule=preview)
    if result.errors:
        body += t(lang, "parse_errors", lines=html.escape("\n".join(result.errors[:5])))

    keyboard = InlineKeyboardMarkup(
        [[
            InlineKeyboardButton(t(lang, "btn_confirm"), callback_data="sch:ok"),
            InlineKeyboardButton(t(lang, "btn_retry"), callback_data="sch:retry"),
        ]]
    )
    await message.reply_text(body, parse_mode=ParseMode.HTML, reply_markup=keyboard)
    return IMPORT_CONFIRM


def _slot_suffix(lang: str, label: str, parity: int | None, kind: str) -> str:
    parts: list[str] = []
    if label:
        parts.append(html.escape(label))
    if parity is not None:
        parts.append(t(lang, "parity_odd" if parity == 0 else "parity_even"))
    if kind and kind != "class":
        parts.append(t(lang, f"kind_{kind}"))
    return f" <i>({', '.join(parts)})</i>" if parts else ""


def _render_parse_preview(result: ParseResult, lang: str) -> str:
    by_day: dict[int, list[tuple[int, int, str, int | None, str]]] = {}
    for slot in result.slots:
        by_day.setdefault(slot.weekday, []).append(
            (slot.start_min, slot.end_min, slot.label, slot.parity, slot.kind)
        )

    lines: list[str] = []
    for weekday in range(7):
        if weekday in by_day:
            items = sorted(by_day[weekday], key=lambda row: (row[0], row[1]))
            rendered = ", ".join(
                f"{fmt_minutes(start)}–{fmt_minutes(end)}"
                + _slot_suffix(lang, label, parity, kind)
                for start, end, label, parity, kind in items
            )
            lines.append(f"<b>{weekday_name(lang, weekday)}</b>: {rendered}")
        elif weekday in result.free_days:
            lines.append(f"<b>{weekday_name(lang, weekday)}</b>: {t(lang, 'day_free')}")
    return "\n".join(lines) or "—"


async def on_schedule_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    action = query.data.split(":", 1)[1]

    async with repo.session() as session:
        lang = await resolve_lang(update, session)

    if action == "retry":
        context.user_data.pop("pending_schedule", None)
        await query.edit_message_text(t(lang, "schedule_intro"), parse_mode=ParseMode.HTML)
        return IMPORT_WAIT

    pending = context.user_data.pop("pending_schedule", None)
    if not pending:
        await query.edit_message_text(t(lang, "error_generic"))
        return ConversationHandler.END

    touched_days = sorted({slot[0] for slot in pending["slots"]} | set(pending["free_days"]))
    async with repo.session() as session:
        await repo.replace_weekly_slots(
            session, update.effective_user.id, touched_days, pending["slots"], source="import"
        )
        await session.commit()

    await query.edit_message_text(t(lang, "schedule_saved"))
    return ConversationHandler.END


# --------------------------------------------------------------------------
# Мастер по дням
# --------------------------------------------------------------------------

def _day_keyboard(lang: str) -> InlineKeyboardMarkup:
    rows, row = [], []
    for weekday in range(7):
        row.append(InlineKeyboardButton(weekday_name(lang, weekday)[:3], callback_data=f"wiz:day:{weekday}"))
        if len(row) == 4:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([InlineKeyboardButton(t(lang, "btn_done"), callback_data="wiz:done")])
    return InlineKeyboardMarkup(rows)


async def cmd_wizard(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    async with repo.session() as session:
        await sync_user(session, update.effective_user)
        lang = await resolve_lang(update, session)
        await session.commit()
    await update.effective_message.reply_text(
        t(lang, "wizard_pick_day"), reply_markup=_day_keyboard(lang)
    )
    return WIZ_PICK_DAY


async def on_wizard_day(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    async with repo.session() as session:
        lang = await resolve_lang(update, session)

    if query.data == "wiz:done":
        async with repo.session() as session:
            await repo.mark_filled(session, update.effective_user.id, True)
            await session.commit()
        await query.edit_message_text(t(lang, "wizard_done"))
        return ConversationHandler.END

    weekday = int(query.data.rsplit(":", 1)[1])
    context.user_data["wiz_day"] = weekday
    await query.edit_message_text(
        t(lang, "wizard_ask_day", day=weekday_name(lang, weekday)), parse_mode=ParseMode.HTML
    )
    return WIZ_WAIT_TEXT


async def on_wizard_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    message = update.effective_message
    weekday = context.user_data.get("wiz_day")
    async with repo.session() as session:
        lang = await resolve_lang(update, session)

    if weekday is None:
        await message.reply_text(t(lang, "error_generic"))
        return ConversationHandler.END

    ranges = _find_ranges(message.text or "")
    slots = [(weekday, start, end, "") for start, end, _, _ in ranges]

    async with repo.session() as session:
        await repo.replace_weekly_slots(session, update.effective_user.id, [weekday], slots, source="wizard")
        await session.commit()

    rendered = ", ".join(f"{fmt_minutes(s)}–{fmt_minutes(e)}" for _, s, e, _ in slots) or t(lang, "day_free")
    await message.reply_text(
        t(lang, "wizard_day_saved", day=weekday_name(lang, weekday), slots=rendered)
    )
    await message.reply_text(t(lang, "wizard_pick_day"), reply_markup=_day_keyboard(lang))
    return WIZ_PICK_DAY


# --------------------------------------------------------------------------
# Просмотр, очистка, разовая занятость
# --------------------------------------------------------------------------

async def cmd_my_schedule(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    async with repo.session() as session:
        await sync_user(session, update.effective_user)
        lang = await resolve_lang(update, session)
        slots = await repo.get_slots(session, update.effective_user.id)
        await session.commit()

    if not slots:
        await update.effective_message.reply_text(t(lang, "schedule_empty"))
        return

    weekly: dict[int, list[tuple[int, int, str, int | None, str]]] = {}
    dated: list[str] = []
    for slot in slots:
        if slot.specific_date is not None:
            dated.append(
                f"📌 <b>{slot.specific_date.strftime('%d.%m.%Y')}</b>: "
                f"{fmt_minutes(slot.start_min)}–{fmt_minutes(slot.end_min)}"
                + _slot_suffix(lang, slot.label, None, slot.kind)
            )
        elif slot.date_from is not None and slot.date_to is not None:
            dated.append(
                f"📌 <b>{slot.date_from.strftime('%d.%m')}–{slot.date_to.strftime('%d.%m.%Y')}</b>: "
                f"{fmt_minutes(slot.start_min)}–{fmt_minutes(slot.end_min)}"
                + _slot_suffix(lang, slot.label, None, slot.kind)
            )
        elif slot.weekday is not None:
            weekly.setdefault(slot.weekday, []).append(
                (slot.start_min, slot.end_min, slot.label, slot.week_parity, slot.kind)
            )

    lines = []
    for weekday in range(7):
        items = sorted(weekly.get(weekday, []), key=lambda row: (row[0], row[1]))
        value = ", ".join(
            f"{fmt_minutes(start)}–{fmt_minutes(end)}" + _slot_suffix(lang, label, parity, kind)
            for start, end, label, parity, kind in items
        ) or t(lang, "day_free")
        lines.append(f"<b>{weekday_name(lang, weekday)}</b>: {value}")
    lines.extend(sorted(dated))

    await update.effective_message.reply_text(
        t(lang, "my_schedule", schedule="\n".join(lines)), parse_mode=ParseMode.HTML
    )


async def cmd_clear(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    async with repo.session() as session:
        lang = await resolve_lang(update, session)
    keyboard = InlineKeyboardMarkup(
        [[
            InlineKeyboardButton(t(lang, "btn_yes_delete"), callback_data="clr:yes"),
            InlineKeyboardButton(t(lang, "btn_no"), callback_data="clr:no"),
        ]]
    )
    await update.effective_message.reply_text(t(lang, "clear_confirm"), reply_markup=keyboard)


async def on_clear_choice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    async with repo.session() as session:
        lang = await resolve_lang(update, session)
        if query.data == "clr:yes":
            await repo.clear_schedule(session, update.effective_user.id)
            await session.commit()
            await query.edit_message_text(t(lang, "cleared"))
        else:
            await query.edit_message_text(t(lang, "cancelled"))


async def cmd_busy(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    async with repo.session() as session:
        await sync_user(session, update.effective_user)
        lang = await resolve_lang(update, session)
        await session.commit()
    await update.effective_message.reply_text(t(lang, "busy_ask"), parse_mode=ParseMode.HTML)
    return BUSY_WAIT


async def on_busy_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    message = update.effective_message
    text = message.text or ""
    async with repo.session() as session:
        lang = await resolve_lang(update, session)

    today = today_in(chat_tz(None))
    dates = _extract_dates(text, today)
    if not dates:
        await message.reply_text(t(lang, "busy_bad"), parse_mode=ParseMode.HTML)
        return BUSY_WAIT

    ranges = _find_ranges(text)
    # «12.09 весь день» и «15.09-20.09 сессия» — время не указано, значит занят целиком
    if not ranges:
        if is_all_day(text) or len(dates) > 1:
            ranges = [(0, 24 * 60, 0, 0)]
        else:
            await message.reply_text(t(lang, "busy_bad"), parse_mode=ParseMode.HTML)
            return BUSY_WAIT

    kind = find_kind(text)
    label = _busy_label(text, today)
    rendered = ", ".join(f"{fmt_minutes(s)}–{fmt_minutes(e)}" for s, e, _, _ in ranges)
    user_id = update.effective_user.id

    async with repo.session() as session:
        if len(dates) > 1:
            date_from, date_to = min(dates), max(dates)
            for start, end, _, _ in ranges:
                await repo.add_range_slot(session, user_id, date_from, date_to,
                                          start, end, label, kind)
            await session.commit()
            await message.reply_text(t(lang, "busy_range_saved",
                                       date_from=date_from.strftime("%d.%m.%Y"),
                                       date_to=date_to.strftime("%d.%m.%Y"), time=rendered))
        else:
            for start, end, _, _ in ranges:
                await repo.add_dated_slot(session, user_id, dates[0], start, end, label, kind)
            await session.commit()
            await message.reply_text(t(lang, "busy_saved",
                                       date=dates[0].strftime("%d.%m.%Y"), time=rendered))
    return ConversationHandler.END


def _extract_dates(text: str, today) -> list:
    """Все даты в сообщении. Две даты = диапазон (сессия, поездка)."""
    found = []
    for token in re.split(r"[\s,;]+|(?<=\d)[–—](?=\d)|(?<=\d)-(?=\d{1,2}[./-])", text):
        day = parse_date_token(token, today)
        if day and day not in found:
            found.append(day)
    return found


def _busy_label(text: str, today) -> str:
    """Название занятости: всё, что не дата и не диапазон времени."""
    words: list[str] = []
    for token in re.split(r"[\s,;]+", text):
        if not token:
            continue
        if parse_date_token(token, today):
            continue
        if re.fullmatch(r"[\d:.\-–—/hч]+", token):   # даты-диапазоны и времена
            continue
        words.append(token)
    return " ".join(words).strip(" .:,;-–—")[:60]


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    async with repo.session() as session:
        lang = await resolve_lang(update, session)
    context.user_data.pop("pending_schedule", None)
    context.user_data.pop("wiz_day", None)
    await update.effective_message.reply_text(t(lang, "cancelled"))
    return ConversationHandler.END


def register(app) -> None:
    import_conv = ConversationHandler(
        entry_points=[
            CommandHandler("schedule", cmd_schedule, filters=PRIVATE),
            CommandHandler("import", cmd_schedule, filters=PRIVATE),
            MessageHandler(PRIVATE & filters.TEXT & ~filters.COMMAND, on_schedule_text),
        ],
        states={
            IMPORT_WAIT: [MessageHandler(PRIVATE & filters.TEXT & ~filters.COMMAND, on_schedule_text)],
            IMPORT_CONFIRM: [CallbackQueryHandler(on_schedule_confirm, pattern=r"^sch:")],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
        name="schedule_import",
        persistent=True,
        conversation_timeout=15 * 60,
    )

    wizard_conv = ConversationHandler(
        entry_points=[CommandHandler("wizard", cmd_wizard, filters=PRIVATE)],
        states={
            WIZ_PICK_DAY: [CallbackQueryHandler(on_wizard_day, pattern=r"^wiz:")],
            WIZ_WAIT_TEXT: [MessageHandler(PRIVATE & filters.TEXT & ~filters.COMMAND, on_wizard_text)],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
        name="schedule_wizard",
        persistent=True,
        conversation_timeout=15 * 60,
    )

    busy_conv = ConversationHandler(
        entry_points=[CommandHandler("busy", cmd_busy, filters=PRIVATE)],
        states={BUSY_WAIT: [MessageHandler(PRIVATE & filters.TEXT & ~filters.COMMAND, on_busy_text)]},
        fallbacks=[CommandHandler("cancel", cancel)],
        name="schedule_busy",
        persistent=True,
        conversation_timeout=10 * 60,
    )

    # Мастер и разовая занятость идут раньше свободного импорта:
    # иначе их текстовые шаги перехватит entry_point импорта.
    app.add_handler(wizard_conv)
    app.add_handler(busy_conv)
    app.add_handler(import_conv)
    app.add_handler(CommandHandler("myschedule", cmd_my_schedule, filters=PRIVATE))
    app.add_handler(CommandHandler("clear", cmd_clear, filters=PRIVATE))
    app.add_handler(CallbackQueryHandler(on_clear_choice, pattern=r"^clr:"))
