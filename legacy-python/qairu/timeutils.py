"""Работа с датами и часовыми поясами. Общее для бота и сайта."""

from __future__ import annotations

import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

DEFAULT_TZ = "Asia/Almaty"


def tz_of(name: str | None, fallback: str = DEFAULT_TZ) -> ZoneInfo:
    try:
        return ZoneInfo(name or fallback)
    except Exception:
        return ZoneInfo(fallback)


def chat_tz(chat, fallback: str = DEFAULT_TZ) -> ZoneInfo:
    """Часовой пояс чата; None — значение по умолчанию."""
    return tz_of(getattr(chat, "tz", None), fallback)


def today_in(tz: ZoneInfo) -> date:
    return datetime.now(tz).date()


def parse_date_token(token: str, today: date) -> date | None:
    """«12.09», «12.09.2026», «12/09» -> date. Год подставляется ближайший будущий."""
    match = re.fullmatch(r"(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?", token.strip())
    if not match:
        return None
    day, month = int(match.group(1)), int(match.group(2))
    if match.group(3):
        year = int(match.group(3))
        year += 2000 if year < 100 else 0
    else:
        year = today.year
    try:
        result = date(year, month, day)
    except ValueError:
        return None
    if not match.group(3) and result < today:
        try:
            result = date(year + 1, month, day)
        except ValueError:
            return None
    return result
