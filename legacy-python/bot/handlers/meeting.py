"""Команда /meeting — создание встречи с опросом в чате."""

from __future__ import annotations

import html
import logging
from datetime import datetime, timedelta, timezone

from telegram import ForceReply, InlineKeyboardButton, InlineKeyboardMarkup, InputFile, Update
from telegram.constants import ChatType, ParseMode
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from qairu.core.availability import compute_availability, parity_from_semester_start, top_slots
from qairu.core.intervals import fmt_interval
from qairu.db import repo
from qairu.db.models import Meeting, User
from qairu.calendar import build_ics
from qairu.i18n import format_day, t
from ..utils import chat_tz, extract_mentioned_users, mention_list, sync_user, today_in

log = logging.getLogger(__name__)

MTG_PLACE, MTG_TIME, MTG_GOAL = range(10, 13)
GROUP_FILTER = filters.ChatType.GROUPS


# --------------------------------------------------------------------------
# Мастер создания встречи
# --------------------------------------------------------------------------

async def cmd_meeting(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    message = update.effective_message
    tg_chat = update.effective_chat
    tg_user = update.effective_user
    if not message or not tg_chat or not tg_user:
        return ConversationHandler.END

    if tg_chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        async with repo.session() as session:
            chat = await repo.get_chat(session, tg_chat.id)
        await message.reply_text(t(chat.lang if chat else "ru", "only_group"))
        return ConversationHandler.END

    async with repo.session() as session:
        chat = await repo.upsert_chat(session, tg_chat.id, tg_chat.title or "")
        lang = chat.lang
        await sync_user(session, tg_user)
        await repo.add_membership(session, tg_chat.id, tg_user.id)

        mentioned, _ = await extract_mentioned_users(update, session)
        if mentioned:
            invitees = _dedup([tg_user.id] + [user.user_id for user in mentioned])
        else:
            invitees = [user.user_id for user in await repo.chat_members(session, tg_chat.id)]
        await session.commit()

    if not invitees:
        await message.reply_text(t(lang, "avail_no_members"))
        return ConversationHandler.END

    context.user_data["mtg_draft"] = {"chat_id": tg_chat.id, "invitees": invitees, "lang": lang}

    prompt = await message.reply_text(
        t(lang, "meeting_step1"),
        parse_mode=ParseMode.HTML,
        reply_markup=ForceReply(selective=True),
    )
    context.user_data["mtg_prompt_id"] = prompt.message_id
    return MTG_PLACE


def _dedup(ids: list[int]) -> list[int]:
    seen, result = set(), []
    for value in ids:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _is_reply_to_prompt(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    message = update.effective_message
    expected = context.user_data.get("mtg_prompt_id")
    return bool(
        message
        and message.reply_to_message
        and expected
        and message.reply_to_message.message_id == expected
    )


async def on_place(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not _is_reply_to_prompt(update, context):
        return MTG_PLACE
    draft = context.user_data.get("mtg_draft")
    if not draft:
        return ConversationHandler.END

    draft["place"] = (update.effective_message.text or "").strip()[:200]
    lang = draft["lang"]

    slots, keyboard = await _time_keyboard(draft, lang)
    context.user_data["mtg_slots"] = slots

    if slots:
        prompt = await update.effective_message.reply_text(
            t(lang, "meeting_step2"), parse_mode=ParseMode.HTML, reply_markup=keyboard
        )
    else:
        prompt = await update.effective_message.reply_text(
            t(lang, "meeting_no_windows") + "\n\n" + t(lang, "meeting_step2_manual"),
            parse_mode=ParseMode.HTML,
            reply_markup=ForceReply(selective=True),
        )
    context.user_data["mtg_prompt_id"] = prompt.message_id
    return MTG_TIME


async def _time_keyboard(draft: dict, lang: str):
    """Кнопки с топ-5 общих окон приглашённых + ручной ввод."""
    async with repo.session() as session:
        chat = await repo.get_chat(session, draft["chat_id"])
        users = list((await repo.users_by_ids(session, draft["invitees"])).values())
        people = await repo.build_person_schedules(session, users)

    if chat is None or not any(person.has_data for person in people):
        return [], None

    tz = chat_tz(chat)
    result = compute_availability(
        people,
        start_day=today_in(tz),
        days_ahead=7,
        day_start=chat.day_start_min,
        day_end=chat.day_end_min,
        min_slot=chat.min_slot_min,
        parity_of=(parity_from_semester_start(chat.semester_start) if chat.semester_start else None),
        buffer_min=chat.travel_buffer_min,
    )
    slots = top_slots(result, limit=5)
    if not slots:
        return [], None

    options = [
        {
            "label": f"{format_day(lang, day)} · {fmt_interval(window)}",
            "date": day.isoformat(),
            "start": window[0],
            "end": window[1],
        }
        for day, window in slots
    ]
    rows = [[InlineKeyboardButton(option["label"], callback_data=f"mtg:slot:{index}")]
            for index, option in enumerate(options)]
    rows.append([InlineKeyboardButton(t(lang, "btn_manual_time"), callback_data="mtg:manual")])
    return options, InlineKeyboardMarkup(rows)


async def on_time_button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    draft = context.user_data.get("mtg_draft")
    if not draft:
        await query.answer()
        return ConversationHandler.END

    lang = draft["lang"]
    if query.from_user.id != update.effective_user.id:
        await query.answer(t(lang, "meeting_not_yours"), show_alert=True)
        return MTG_TIME

    await query.answer()
    if query.data == "mtg:manual":
        await query.edit_message_reply_markup(reply_markup=None)
        prompt = await context.bot.send_message(
            draft["chat_id"], t(lang, "meeting_step2_manual"),
            parse_mode=ParseMode.HTML, reply_markup=ForceReply(selective=True),
        )
        context.user_data["mtg_prompt_id"] = prompt.message_id
        return MTG_TIME

    index = int(query.data.rsplit(":", 1)[1])
    options = context.user_data.get("mtg_slots") or []
    if index >= len(options):
        return MTG_TIME
    chosen = options[index]
    draft["when"] = chosen["label"]
    draft["when_date"] = chosen["date"]
    draft["when_start_min"] = chosen["start"]

    await query.edit_message_text(f"🕒 {html.escape(chosen['label'])}")
    prompt = await context.bot.send_message(
        draft["chat_id"], t(lang, "meeting_step3"),
        parse_mode=ParseMode.HTML, reply_markup=ForceReply(selective=True),
    )
    context.user_data["mtg_prompt_id"] = prompt.message_id
    return MTG_GOAL


async def on_time_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not _is_reply_to_prompt(update, context):
        return MTG_TIME
    draft = context.user_data.get("mtg_draft")
    if not draft:
        return ConversationHandler.END

    draft["when"] = (update.effective_message.text or "").strip()[:200]
    lang = draft["lang"]
    prompt = await update.effective_message.reply_text(
        t(lang, "meeting_step3"), parse_mode=ParseMode.HTML, reply_markup=ForceReply(selective=True)
    )
    context.user_data["mtg_prompt_id"] = prompt.message_id
    return MTG_GOAL


async def on_goal(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not _is_reply_to_prompt(update, context):
        return MTG_GOAL
    draft = context.user_data.get("mtg_draft")
    if not draft:
        return ConversationHandler.END

    draft["goal"] = (update.effective_message.text or "").strip()[:500]
    lang = draft["lang"]

    async with repo.session() as session:
        meeting = await repo.create_meeting(
            session,
            chat_id=draft["chat_id"],
            initiator_id=update.effective_user.id,
            place=draft.get("place", ""),
            when_text=draft.get("when", ""),
            goal=draft.get("goal", ""),
            invitees=draft["invitees"],
        )
        chat = await repo.get_chat(session, draft["chat_id"])
        meeting.when_start = _draft_start_at(draft, chat)
        await session.commit()
        meeting_id = meeting.id
        when_start = meeting.when_start
        reminder_min = chat.reminder_min if chat else 30

    schedule_reminder(context.application, meeting_id, when_start, reminder_min)

    text, keyboard = await _render_card(meeting_id, lang)
    sent = await context.bot.send_message(
        draft["chat_id"], text, parse_mode=ParseMode.HTML,
        reply_markup=keyboard, disable_web_page_preview=True,
    )

    async with repo.session() as session:
        meeting = await repo.get_meeting(session, meeting_id)
        if meeting:
            meeting.chat_message_id = sent.message_id
        await session.commit()

    for key in ("mtg_draft", "mtg_prompt_id", "mtg_slots"):
        context.user_data.pop(key, None)
    return ConversationHandler.END


def _draft_start_at(draft: dict, chat) -> datetime | None:
    """Точное время начала встречи — только если организатор выбрал окно кнопкой."""
    iso_date = draft.get("when_date")
    start_min = draft.get("when_start_min")
    if not iso_date or start_min is None or chat is None:
        return None
    from datetime import date as _date

    day = _date.fromisoformat(iso_date)
    tz = chat_tz(chat)
    return datetime(day.year, day.month, day.day, start_min // 60, start_min % 60, tzinfo=tz)


def schedule_reminder(application, meeting_id: int, when_start: datetime | None,
                      reminder_min: int) -> None:
    """Поставить джобу напоминания. Идемпотентно: старая джоба этой встречи снимается."""
    job_queue = getattr(application, "job_queue", None)
    if job_queue is None or when_start is None or reminder_min <= 0:
        return
    fire_at = when_start - timedelta(minutes=reminder_min)
    if fire_at <= datetime.now(timezone.utc):
        return
    name = f"meeting-reminder:{meeting_id}"
    for job in job_queue.get_jobs_by_name(name):
        job.schedule_removal()
    job_queue.run_once(send_meeting_reminder, when=fire_at, name=name,
                       data={"meeting_id": meeting_id, "reminder_min": reminder_min})


async def send_meeting_reminder(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Пинг перед встречей: зовём тех, кто согласился, иначе всех приглашённых."""
    payload = context.job.data or {}
    meeting_id = payload.get("meeting_id")
    if meeting_id is None:
        return

    async with repo.session() as session:
        meeting = await repo.get_meeting(session, meeting_id)
        if meeting is None or meeting.status != "open":
            return
        chat = await repo.get_chat(session, meeting.chat_id)
        lang = chat.lang if chat else "ru"
        responses = await repo.meeting_responses(session, meeting_id)
        said_yes = [r.user_id for r in responses if r.answer == "yes"]
        target_ids = said_yes or meeting.invitee_ids()
        users = await repo.users_by_ids(session, target_ids)

    ordered = [users[uid] for uid in target_ids if uid in users]
    try:
        await context.bot.send_message(
            meeting.chat_id,
            t(lang, "meeting_reminder",
              minutes=payload.get("reminder_min", 30),
              place=html.escape(meeting.place) or "—",
              goal=html.escape(meeting.goal) or "—",
              names=mention_list(ordered)),
            parse_mode=ParseMode.HTML,
        )
    except Exception:
        log.warning("Не удалось отправить напоминание о встрече %s", meeting_id)


async def restore_reminders(application) -> None:
    """После рестарта заново поставить напоминания по открытым встречам."""
    async with repo.session() as session:
        meetings = await repo.open_meetings_with_time(session)
        chats = {m.chat_id: await repo.get_chat(session, m.chat_id) for m in meetings}
    restored = 0
    for meeting in meetings:
        chat = chats.get(meeting.chat_id)
        schedule_reminder(application, meeting.id, meeting.when_start,
                          chat.reminder_min if chat else 30)
        restored += 1
    if restored:
        log.info("Восстановлено напоминаний о встречах: %s", restored)


async def on_meeting_timeout(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    draft = context.user_data.pop("mtg_draft", None)
    if draft:
        try:
            await context.bot.send_message(draft["chat_id"], t(draft["lang"], "meeting_timeout"))
        except Exception:
            log.debug("Не удалось сообщить о таймауте встречи")
    return ConversationHandler.END


async def cancel_meeting(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    draft = context.user_data.pop("mtg_draft", None)
    lang = draft["lang"] if draft else "ru"
    await update.effective_message.reply_text(t(lang, "cancelled"))
    return ConversationHandler.END


# --------------------------------------------------------------------------
# Карточка встречи и голосование
# --------------------------------------------------------------------------

async def _render_card(meeting_id: int, lang: str) -> tuple[str, InlineKeyboardMarkup]:
    async with repo.session() as session:
        meeting: Meeting | None = await repo.get_meeting(session, meeting_id)
        if meeting is None:
            return t(lang, "error_generic"), InlineKeyboardMarkup([])

        invitee_ids = meeting.invitee_ids()
        users = await repo.users_by_ids(session, invitee_ids)
        responses = await repo.meeting_responses(session, meeting_id)

    ordered = [users[uid] for uid in invitee_ids if uid in users]
    if meeting.status == "cancelled":
        text = t(lang, "meeting_cancelled_card",
                 place=html.escape(meeting.place) or "—",
                 when=html.escape(meeting.when_text) or "—",
                 goal=html.escape(meeting.goal) or "—")
        return text, InlineKeyboardMarkup([])

    text = t(
        lang, "meeting_card",
        place=html.escape(meeting.place) or "—",
        when=html.escape(meeting.when_text) or "—",
        goal=html.escape(meeting.goal) or "—",
        invitees=mention_list(ordered),
    )

    buckets: dict[str, list[User]] = {"yes": [], "no": [], "change": []}
    comments: list[str] = []
    for response in responses:
        user = users.get(response.user_id)
        if user and response.answer in buckets:
            buckets[response.answer].append(user)
        if response.comment and user:
            comments.append(f"• {html.escape(user.display)}: {html.escape(response.comment)}")

    text += t(
        lang, "meeting_votes",
        yes=len(buckets["yes"]), yes_names=mention_list(buckets["yes"]),
        no=len(buckets["no"]), no_names=mention_list(buckets["no"]),
        change=len(buckets["change"]), change_names=mention_list(buckets["change"]),
    )
    if comments:
        text += t(lang, "changes_block", items="\n".join(comments[:10]))

    rows = [
        [
            InlineKeyboardButton(f"{t(lang, 'btn_yes')} {len(buckets['yes'])}",
                                 callback_data=f"vote:{meeting_id}:yes"),
            InlineKeyboardButton(f"{t(lang, 'btn_no_answer')} {len(buckets['no'])}",
                                 callback_data=f"vote:{meeting_id}:no"),
        ],
        [InlineKeyboardButton(t(lang, "btn_change"), callback_data=f"vote:{meeting_id}:change")],
    ]
    extra = []
    if meeting.when_start is not None:
        extra.append(InlineKeyboardButton(t(lang, "btn_ics"), callback_data=f"card:ics:{meeting_id}"))
    extra.append(InlineKeyboardButton(t(lang, "btn_cancel_meeting"),
                                      callback_data=f"card:cancel:{meeting_id}"))
    rows.append(extra)
    return text, InlineKeyboardMarkup(rows)


async def on_vote(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not query.data:
        return
    _, raw_id, answer = query.data.split(":")
    meeting_id = int(raw_id)
    voter_id = query.from_user.id

    async with repo.session() as session:
        meeting = await repo.get_meeting(session, meeting_id)
        if meeting is None:
            await query.answer()
            return
        chat = await repo.get_chat(session, meeting.chat_id)
        lang = chat.lang if chat else "ru"

        if voter_id not in meeting.invitee_ids():
            await query.answer(t(lang, "vote_not_invited"), show_alert=True)
            return

        await sync_user(session, query.from_user)
        await repo.set_response(session, meeting_id, voter_id, answer)
        await session.commit()

    await query.answer(t(lang, "vote_registered", answer=t(lang, f"answer_{answer}")))

    text, keyboard = await _render_card(meeting_id, lang)
    try:
        await query.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=keyboard,
                                      disable_web_page_preview=True)
    except Exception:
        log.debug("Карточка встречи не изменилась")

    if answer == "change":
        prompt = await context.bot.send_message(
            meeting.chat_id,
            f'<a href="tg://user?id={voter_id}">{html.escape(query.from_user.full_name)}</a>, '
            + t(lang, "change_ask"),
            parse_mode=ParseMode.HTML,
            reply_markup=ForceReply(selective=True),
        )
        prompts = context.chat_data.setdefault("change_prompts", {})
        prompts[prompt.message_id] = (meeting_id, voter_id)
        # держим только последние 20 — иначе словарь растёт бесконечно
        for stale in sorted(prompts)[:-20]:
            prompts.pop(stale, None)


async def on_card_button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Кнопки карточки: выгрузить .ics и отменить встречу."""
    query = update.callback_query
    if not query or not query.data:
        return
    _, action, raw_id = query.data.split(":")
    meeting_id = int(raw_id)

    async with repo.session() as session:
        meeting = await repo.get_meeting(session, meeting_id)
        if meeting is None:
            await query.answer()
            return
        chat = await repo.get_chat(session, meeting.chat_id)
        lang = chat.lang if chat else "ru"

        if action == "cancel":
            if query.from_user.id != meeting.initiator_id:
                await query.answer(t(lang, "cancel_only_initiator"), show_alert=True)
                return
            meeting.status = "cancelled"
            await session.commit()

    if action == "cancel":
        for job in _reminder_jobs(context.application, meeting_id):
            job.schedule_removal()
        await query.answer(t(lang, "meeting_cancel_done"))
        text, keyboard = await _render_card(meeting_id, lang)
        try:
            await query.edit_message_text(text, parse_mode=ParseMode.HTML,
                                          reply_markup=keyboard, disable_web_page_preview=True)
        except Exception:
            log.debug("Карточка встречи уже в этом состоянии")
        return

    # action == "ics"
    await query.answer()
    if meeting.when_start is None:
        return
    payload = build_ics(
        uid=f"meeting-{meeting_id}",
        summary=meeting.goal or t(lang, "ics_default_summary"),
        start=meeting.when_start,
        duration_min=90,
        location=meeting.place,
        description=meeting.goal,
    )
    await context.bot.send_document(
        meeting.chat_id,
        document=InputFile(payload.encode("utf-8"), filename=f"qairu-meeting-{meeting_id}.ics"),
        caption=t(lang, "ics_caption"),
    )


def _reminder_jobs(application, meeting_id: int):
    job_queue = getattr(application, "job_queue", None)
    if job_queue is None:
        return []
    return job_queue.get_jobs_by_name(f"meeting-reminder:{meeting_id}")


async def on_change_reply(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Ответ на «предложить изменения» — дописываем комментарий в карточку."""
    message = update.effective_message
    if not message or not message.reply_to_message:
        return
    prompts = context.chat_data.get("change_prompts") or {}
    entry = prompts.get(message.reply_to_message.message_id)
    if not entry:
        return
    meeting_id, expected_user = entry
    if update.effective_user.id != expected_user:
        return

    comment = (message.text or "").strip()[:300]
    async with repo.session() as session:
        meeting = await repo.get_meeting(session, meeting_id)
        if meeting is None:
            prompts.pop(message.reply_to_message.message_id, None)
            return
        chat = await repo.get_chat(session, meeting.chat_id)
        lang = chat.lang if chat else "ru"
        await repo.set_response(session, meeting_id, expected_user, "change", comment)
        await session.commit()

    prompts.pop(message.reply_to_message.message_id, None)

    if meeting and meeting.chat_message_id:
        text, keyboard = await _render_card(meeting_id, lang)
        try:
            await context.bot.edit_message_text(
                chat_id=meeting.chat_id, message_id=meeting.chat_message_id,
                text=text, parse_mode=ParseMode.HTML, reply_markup=keyboard,
                disable_web_page_preview=True,
            )
        except Exception:
            log.debug("Не удалось обновить карточку встречи")
    await message.reply_text(t(lang, "change_saved"))


def register(app) -> None:
    conv = ConversationHandler(
        entry_points=[CommandHandler("meeting", cmd_meeting, filters=GROUP_FILTER)],
        states={
            MTG_PLACE: [MessageHandler(GROUP_FILTER & filters.REPLY & filters.TEXT & ~filters.COMMAND, on_place)],
            MTG_TIME: [
                CallbackQueryHandler(on_time_button, pattern=r"^mtg:"),
                MessageHandler(GROUP_FILTER & filters.REPLY & filters.TEXT & ~filters.COMMAND, on_time_text),
            ],
            MTG_GOAL: [MessageHandler(GROUP_FILTER & filters.REPLY & filters.TEXT & ~filters.COMMAND, on_goal)],
            ConversationHandler.TIMEOUT: [
                MessageHandler(filters.ALL, on_meeting_timeout),
                CallbackQueryHandler(on_meeting_timeout),
            ],
        },
        fallbacks=[CommandHandler("cancel", cancel_meeting)],
        name="meeting",
        persistent=True,
        conversation_timeout=15 * 60,
    )
    app.add_handler(conv)
    app.add_handler(CallbackQueryHandler(on_vote, pattern=r"^vote:"))
    app.add_handler(CallbackQueryHandler(on_card_button, pattern=r"^card:"))
    # Ответы на «предложить изменения» ловим отдельно — вне диалога создания.
    app.add_handler(
        MessageHandler(GROUP_FILTER & filters.REPLY & filters.TEXT & ~filters.COMMAND, on_change_reply),
        group=1,
    )
