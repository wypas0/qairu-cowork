"""Подключение чата и регистрация участников: /setup, /join, /members, /remind."""

from __future__ import annotations

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ChatType, ParseMode
from telegram.error import Forbidden
from telegram.ext import CallbackQueryHandler, ChatMemberHandler, CommandHandler, ContextTypes
from telegram.helpers import create_deep_linked_url

from qairu.db import repo
from qairu.i18n import t
from ..utils import is_chat_admin, mention_list, resolve_lang, sync_user

log = logging.getLogger(__name__)


def _setup_keyboard(bot_username: str, chat_id: int, lang: str) -> InlineKeyboardMarkup:
    """Кнопка deep-link: открывает личку и сразу привязывает человека к чату."""
    url = create_deep_linked_url(bot_username, f"c{chat_id}")
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton(t(lang, "btn_fill_schedule"), url=url)],
            [InlineKeyboardButton(t(lang, "btn_who_filled"), callback_data="members:show")],
        ]
    )


async def cmd_link(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Персональная ссылка на веб-версию этой группы.

    Токен одноразово выдаётся конкретному человеку и открывает ЕГО расписание —
    то же самое, что он заполнил в боте. Поэтому шлём только в личку.
    """
    message = update.effective_message
    tg_chat = update.effective_chat
    tg_user = update.effective_user
    if not message or not tg_chat or not tg_user:
        return

    base = (context.application.bot_data or {}).get("web_base_url", "")
    async with repo.session() as session:
        lang = await resolve_lang(update, session)
        if not base:
            await message.reply_text(t(lang, "web_not_configured"))
            return

        await sync_user(session, tg_user)
        if tg_chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
            chat = await repo.upsert_chat(session, tg_chat.id, tg_chat.title or "")
            await repo.add_membership(session, tg_chat.id, tg_user.id)
        else:
            chats = await repo.user_chats(session, tg_user.id)
            chat = chats[0] if chats else None
        if chat is None:
            await message.reply_text(t(lang, "avail_no_members"))
            return
        slug = await repo.ensure_slug(session, chat)
        token = await repo.issue_web_session(session, tg_user.id)
        await session.commit()

    url = f"{base}/g/{slug}?t={token}"
    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton(t(lang, "btn_open_web"), url=url)]])

    if tg_chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
        try:
            await context.bot.send_message(tg_user.id, t(lang, "web_link"),
                                           parse_mode=ParseMode.HTML, reply_markup=keyboard)
            await message.reply_text(t(lang, "web_link_sent"))
        except Forbidden:
            await message.reply_text(
                t(lang, "web_link_dm_first"),
                reply_markup=_setup_keyboard(context.bot.username, tg_chat.id, lang),
            )
    else:
        await message.reply_text(t(lang, "web_link"), parse_mode=ParseMode.HTML,
                                 reply_markup=keyboard)


async def cmd_setup(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    tg_chat = update.effective_chat
    tg_user = update.effective_user
    if not message or not tg_chat or not tg_user:
        return

    if tg_chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        async with repo.session() as session:
            lang = await resolve_lang(update, session)
        await message.reply_text(t(lang, "only_group"))
        return

    async with repo.session() as session:
        chat = await repo.upsert_chat(session, tg_chat.id, tg_chat.title or "")
        lang = chat.lang
        if not await is_chat_admin(update, context):
            await message.reply_text(t(lang, "only_admin"))
            return
        await sync_user(session, tg_user)
        await repo.add_membership(session, tg_chat.id, tg_user.id)
        await session.commit()

    await message.reply_text(
        t(lang, "setup_done", chat=tg_chat.title or ""),
        parse_mode=ParseMode.HTML,
        reply_markup=_setup_keyboard(context.bot.username, tg_chat.id, lang),
    )


async def cmd_join(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    tg_chat = update.effective_chat
    tg_user = update.effective_user
    if not message or not tg_chat or not tg_user:
        return

    if tg_chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        async with repo.session() as session:
            lang = await resolve_lang(update, session)
        await message.reply_text(t(lang, "only_group"))
        return

    async with repo.session() as session:
        chat = await repo.upsert_chat(session, tg_chat.id, tg_chat.title or "")
        lang = chat.lang
        await sync_user(session, tg_user)
        is_new = await repo.add_membership(session, tg_chat.id, tg_user.id)
        await session.commit()

    key = "join_ok" if is_new else "join_already"
    await message.reply_text(
        t(lang, key, name=tg_user.first_name),
        parse_mode=ParseMode.HTML,
        reply_markup=_setup_keyboard(context.bot.username, tg_chat.id, lang),
    )


async def cmd_leave(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Выйти из списка участников чата — расписание при этом сохраняется."""
    message = update.effective_message
    tg_chat = update.effective_chat
    tg_user = update.effective_user
    if not message or not tg_chat or not tg_user:
        return
    if tg_chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        async with repo.session() as session:
            lang = await resolve_lang(update, session)
        await message.reply_text(t(lang, "only_group"))
        return

    async with repo.session() as session:
        chat = await repo.get_chat(session, tg_chat.id)
        lang = chat.lang if chat else "ru"
        await repo.remove_membership(session, tg_chat.id, tg_user.id)
        await session.commit()

    await message.reply_text(t(lang, "leave_ok", name=tg_user.first_name),
                             parse_mode=ParseMode.HTML)


async def _members_text(session, chat_id: int, lang: str) -> str:
    users = await repo.chat_members(session, chat_id)
    if not users:
        return t(lang, "members_empty")

    filled, missing = [], []
    for user in users:
        (filled if await repo.is_filled(session, user.user_id) else missing).append(user)

    text = t(lang, "members_title")
    text += t(lang, "members_filled", count=len(filled), names=mention_list(filled))
    if missing:
        text += t(lang, "members_missing", count=len(missing), names=mention_list(missing))
    return text


async def cmd_members(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
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
        text = await _members_text(session, tg_chat.id, lang)
        await session.commit()

    await message.reply_text(
        text,
        parse_mode=ParseMode.HTML,
        reply_markup=_setup_keyboard(context.bot.username, tg_chat.id, lang),
    )


async def on_members_button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    tg_chat = update.effective_chat
    if not query or not tg_chat:
        return
    async with repo.session() as session:
        chat = await repo.get_chat(session, tg_chat.id)
        lang = chat.lang if chat else "ru"
        text = await _members_text(session, tg_chat.id, lang)
    await query.answer()
    await context.bot.send_message(
        tg_chat.id,
        text,
        parse_mode=ParseMode.HTML,
        reply_markup=_setup_keyboard(context.bot.username, tg_chat.id, lang),
    )


async def cmd_remind(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Один агрегированный пинг вместо N сообщений — бережём лимиты Telegram."""
    message = update.effective_message
    tg_chat = update.effective_chat
    if not message or not tg_chat:
        return
    if tg_chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        return

    async with repo.session() as session:
        chat = await repo.upsert_chat(session, tg_chat.id, tg_chat.title or "")
        lang = chat.lang
        if not await is_chat_admin(update, context):
            await message.reply_text(t(lang, "only_admin"))
            return
        users = await repo.chat_members(session, tg_chat.id)
        missing = [u for u in users if not await repo.is_filled(session, u.user_id)]
        await session.commit()

    if not missing:
        await message.reply_text(t(lang, "remind_nobody"))
        return

    await message.reply_text(
        t(lang, "remind_text", names=mention_list(missing)),
        parse_mode=ParseMode.HTML,
        reply_markup=_setup_keyboard(context.bot.username, tg_chat.id, lang),
    )


async def on_my_chat_member(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Бота добавили в группу — сразу подсказываем, что делать."""
    result = update.my_chat_member
    if not result or not result.new_chat_member:
        return
    if result.new_chat_member.user.id != context.bot.id:
        return
    if result.new_chat_member.status not in ("member", "administrator"):
        return
    tg_chat = result.chat
    if tg_chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        return

    async with repo.session() as session:
        chat = await repo.upsert_chat(session, tg_chat.id, tg_chat.title or "")
        lang = chat.lang
        await session.commit()

    try:
        await context.bot.send_message(
            tg_chat.id,
            t(lang, "setup_done", chat=tg_chat.title or ""),
            parse_mode=ParseMode.HTML,
            reply_markup=_setup_keyboard(context.bot.username, tg_chat.id, lang),
        )
    except Forbidden:
        log.warning("Нет прав писать в чат %s", tg_chat.id)


def register(app) -> None:
    app.add_handler(CommandHandler("setup", cmd_setup))
    app.add_handler(CommandHandler("join", cmd_join))
    app.add_handler(CommandHandler("members", cmd_members))
    app.add_handler(CommandHandler("leave", cmd_leave))
    app.add_handler(CommandHandler("link", cmd_link))
    app.add_handler(CommandHandler("web", cmd_link))
    app.add_handler(CommandHandler("remind", cmd_remind))
    app.add_handler(CallbackQueryHandler(on_members_button, pattern=r"^members:show$"))
    app.add_handler(ChatMemberHandler(on_my_chat_member, ChatMemberHandler.MY_CHAT_MEMBER))
