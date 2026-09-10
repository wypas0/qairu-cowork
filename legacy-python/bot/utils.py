"""Вспомогательные функции: язык, упоминания, парсинг аргументов команд."""

from __future__ import annotations

import html
import re
from telegram import Chat as TgChat, MessageEntity, Update, User as TgUser
from telegram.ext import ContextTypes

from qairu.db import repo
from qairu.db.models import User
from qairu.i18n import DEFAULT_LANG, normalize_lang
from qairu.timeutils import chat_tz, parse_date_token, today_in  # noqa: F401  (реэкспорт)

MENTION_RE = re.compile(r"@([A-Za-z0-9_]{4,32})")


def mention(user: User) -> str:
    """Кликабельное упоминание, которое работает даже без username."""
    name = html.escape(user.full_name or (f"@{user.username}" if user.username else str(user.user_id)))
    return f'<a href="tg://user?id={user.user_id}">{name}</a>'


def mention_list(users: list[User]) -> str:
    return ", ".join(mention(user) for user in users) if users else "—"


def plain_names(users: list[User]) -> str:
    return ", ".join(html.escape(user.display) for user in users) if users else "—"


async def resolve_lang(update: Update, session) -> str:
    """Язык: у группы — язык чата, в личке — язык пользователя."""
    tg_chat = update.effective_chat
    tg_user = update.effective_user
    if tg_chat and tg_chat.type in (TgChat.GROUP, TgChat.SUPERGROUP):
        chat = await repo.get_chat(session, tg_chat.id)
        if chat:
            return chat.lang
    if tg_user:
        user = await session.get(User, tg_user.id)
        if user:
            return user.lang
        return normalize_lang(tg_user.language_code)
    return DEFAULT_LANG


async def is_chat_admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    tg_chat, tg_user = update.effective_chat, update.effective_user
    if not tg_chat or not tg_user:
        return False
    if tg_chat.type == TgChat.PRIVATE:
        return True
    try:
        member = await context.bot.get_chat_member(tg_chat.id, tg_user.id)
    except Exception:
        return False
    return member.status in ("creator", "administrator")


async def sync_user(session, tg_user: TgUser) -> User:
    """Записать/обновить пользователя из апдейта. Username меняется — обновляем всегда."""
    return await repo.upsert_user(
        session,
        user_id=tg_user.id,
        username=tg_user.username,
        full_name=tg_user.full_name or tg_user.first_name or "",
        lang=None,
    )


async def extract_mentioned_users(update: Update, session) -> tuple[list[User], list[str]]:
    """Достать пользователей из аргументов команды.

    Возвращает (найденные, ненайденные_строки). Поддерживает и @username,
    и text_mention (упоминание человека без username).
    """
    message = update.effective_message
    if message is None:
        return [], []

    found: list[User] = []
    missing: list[str] = []
    seen: set[int] = set()

    text = message.text or message.caption or ""
    entities = message.entities or message.caption_entities or []

    for entity in entities:
        if entity.type == MessageEntity.TEXT_MENTION and entity.user:
            user = await session.get(User, entity.user.id)
            if user and user.user_id not in seen:
                seen.add(user.user_id)
                found.append(user)
            elif not user:
                missing.append(entity.user.full_name)

    for username in MENTION_RE.findall(text):
        user = await repo.find_user_by_username(session, username)
        if user:
            if user.user_id not in seen:
                seen.add(user.user_id)
                found.append(user)
        else:
            missing.append(f"@{username}")

    return found, missing


def extract_min_duration(args: list[str], default: int) -> int:
    """Найти в аргументах команды число — минимальную длительность окна."""
    for arg in args:
        if arg.isdigit():
            value = int(arg)
            if 5 <= value <= 12 * 60:
                return value
    return default
