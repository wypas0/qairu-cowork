"""Локализация: ru / kk / en.

Использование:
    from ..i18n import t
    t(lang, "greeting", name="Амир")

Если ключа нет в выбранном языке — падаем на русский, потом на сам ключ.
"""

from __future__ import annotations

from .en import STRINGS as EN
from .kk import STRINGS as KK
from .ru import STRINGS as RU

LANGS: dict[str, dict[str, str]] = {"ru": RU, "kk": KK, "en": EN}
LANG_NAMES = {"ru": "🇷🇺 Русский", "kk": "🇰🇿 Қазақша", "en": "🇬🇧 English"}
DEFAULT_LANG = "ru"

WEEKDAY_NAMES: dict[str, list[str]] = {
    "ru": ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"],
    "kk": ["Дүйсенбі", "Сейсенбі", "Сәрсенбі", "Бейсенбі", "Жұма", "Сенбі", "Жексенбі"],
    "en": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
}

MONTH_NAMES: dict[str, list[str]] = {
    "ru": ["января", "февраля", "марта", "апреля", "мая", "июня",
           "июля", "августа", "сентября", "октября", "ноября", "декабря"],
    "kk": ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым",
           "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"],
    "en": ["January", "February", "March", "April", "May", "June",
           "July", "August", "September", "October", "November", "December"],
}


def normalize_lang(code: str | None) -> str:
    if not code:
        return DEFAULT_LANG
    short = code.split("-")[0].lower()
    return short if short in LANGS else DEFAULT_LANG


def t(lang: str, key: str, **kwargs) -> str:
    lang = lang if lang in LANGS else DEFAULT_LANG
    template = LANGS[lang].get(key) or RU.get(key) or key
    try:
        return template.format(**kwargs)
    except (KeyError, IndexError):
        return template


def weekday_name(lang: str, index: int) -> str:
    return WEEKDAY_NAMES.get(lang, WEEKDAY_NAMES["ru"])[index % 7]


def format_day(lang: str, day) -> str:
    """date -> «среда, 9 сентября» / «Wednesday, September 9»."""
    weekday = weekday_name(lang, day.weekday())
    month = MONTH_NAMES.get(lang, MONTH_NAMES["ru"])[day.month - 1]
    if lang == "en":
        return f"{weekday}, {month} {day.day}"
    return f"{weekday.lower()}, {day.day} {month}"
