"""Безопасная работа с текстом сообщений."""

from __future__ import annotations

TELEGRAM_LIMIT = 4096


def clip(text: str, limit: int = 3900, note: str = "") -> str:
    """Обрезать текст по границе строки, чтобы не разорвать HTML-теги Telegram.

    Лимит Telegram — 4096 символов. Длинный список окон легко его превышает,
    и тогда сообщение просто не отправляется. Режем по последнему переводу
    строки и честно дописываем, что показано не всё.
    """
    if len(text) <= limit:
        return text
    cut = text.rfind("\n", 0, limit)
    if cut < limit // 2:
        cut = limit
    tail = f"\n\n{note}" if note else "\n\n…"
    return text[:cut].rstrip() + tail
