"""Парсер расписания из свободного текста и CSV.

Понимает три языка (ru / kk / en), полные и сокращённые названия дней,
разные разделители диапазонов и форматы времени.

Пример входа:
    Пн 9:00-10:30 Матан, 13:00-14:30 История
    Вт 8:00–9:30
    Ср нет пар
    Чт 10-11.30; 12:00-13:30 Физика
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass

# --------------------------------------------------------------------------
# Дни недели. Порядок важен: сначала длинные формы, иначе «сенбі» съест
# «дүйсенбі», а «ср» — «среда».
# --------------------------------------------------------------------------

WEEKDAY_WORDS: list[tuple[str, int]] = [
    # русский
    ("понедельник", 0), ("вторник", 1), ("среда", 2), ("среду", 2),
    ("четверг", 3), ("пятница", 4), ("пятницу", 4),
    ("суббота", 5), ("субботу", 5), ("воскресенье", 6), ("воскресение", 6),
    ("пн", 0), ("вт", 1), ("ср", 2), ("чт", 3), ("пт", 4), ("сб", 5), ("вс", 6),
    # казахский
    ("дүйсенбі", 0), ("дуйсенби", 0),
    ("сейсенбі", 1), ("сейсенби", 1),
    ("сәрсенбі", 2), ("сарсенби", 2),
    ("бейсенбі", 3), ("бейсенби", 3),
    ("жұма", 4), ("жума", 4),
    ("сенбі", 5), ("сенби", 5),
    ("жексенбі", 6), ("жексенби", 6),
    ("дс", 0), ("сс", 1), ("ср", 2), ("бс", 3), ("жм", 4), ("сб", 5), ("жс", 6),
    # английский
    ("monday", 0), ("tuesday", 1), ("wednesday", 2), ("thursday", 3),
    ("friday", 4), ("saturday", 5), ("sunday", 6),
    ("mon", 0), ("tue", 1), ("tues", 1), ("wed", 2), ("thu", 3), ("thur", 3),
    ("thurs", 3), ("fri", 4), ("sat", 5), ("sun", 6),
]
# длинные раньше коротких
WEEKDAY_WORDS.sort(key=lambda pair: -len(pair[0]))

EVERYDAY_WORDS = {"ежедневно", "каждый день", "все дни", "күнде", "кунде", "daily", "every day"}

# Чётность недели: 0 — числитель (верхняя), 1 — знаменатель (нижняя)
PARITY_WORDS: list[tuple[str, int]] = [
    ("числитель", 0), ("числ", 0), ("чис", 0), ("верхняя", 0), ("верх", 0),
    ("1 неделя", 0), ("неделя 1", 0), ("н1", 0), ("odd", 0), ("upper", 0),
    ("знаменатель", 1), ("знам", 1), ("зн", 1), ("нижняя", 1), ("низ", 1),
    ("2 неделя", 1), ("неделя 2", 1), ("н2", 1), ("even", 1), ("lower", 1),
]
PARITY_WORDS.sort(key=lambda pair: -len(pair[0]))

# Тип занятости
KIND_WORDS: list[tuple[str, str]] = [
    ("подработка", "work"), ("работа", "work"), ("работе", "work"), ("смена", "work"),
    ("жұмыс", "work"), ("жумыс", "work"), ("work", "work"), ("job", "work"), ("shift", "work"),
    ("тренировка", "sport"), ("тренировки", "sport"), ("секция", "sport"), ("спорт", "sport"),
    ("зал", "sport"), ("жаттығу", "sport"), ("sport", "sport"), ("gym", "sport"),
    ("training", "sport"), ("practice", "sport"),
    ("экзамен", "exam"), ("сессия", "exam"), ("зачёт", "exam"), ("зачет", "exam"),
    ("емтихан", "exam"), ("exam", "exam"),
]
KIND_WORDS.sort(key=lambda pair: -len(pair[0]))

ALL_DAY_WORDS = {"весь день", "целый день", "полный день", "күні бойы", "куни бойы",
                 "all day", "whole day", "занят весь день", "бос емес"}
FREE_DAY_WORDS = {"нет пар", "нет", "свободно", "выходной", "жоқ", "жок", "бос", "free", "none", "no classes", "-"}

_DASHES = "-–—‒−~"
_TIME = r"(\d{1,2})\s*(?:[:.\-hч]\s*(\d{2}))?"
RANGE_RE = re.compile(
    rf"{_TIME}\s*(?:[{_DASHES}]|до|дейін|деиин|to|till|until)\s*{_TIME}",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ParsedSlot:
    """Один распознанный занятый интервал."""
    weekday: int          # 0 = понедельник … 6 = воскресенье
    start_min: int
    end_min: int
    label: str = ""
    parity: int | None = None   # None — каждую неделю, 0 — числитель, 1 — знаменатель
    kind: str = "class"         # class | work | sport | exam

    def __str__(self) -> str:
        from .intervals import fmt_minutes
        tail = f" {self.label}" if self.label else ""
        return f"{fmt_minutes(self.start_min)}–{fmt_minutes(self.end_min)}{tail}"


@dataclass
class ParseResult:
    slots: list[ParsedSlot]
    free_days: list[int]          # дни, явно помеченные как свободные
    errors: list[str]             # строки, которые не удалось разобрать

    @property
    def ok(self) -> bool:
        return bool(self.slots or self.free_days)


def _to_minutes(hours: str, minutes: str | None) -> int | None:
    h = int(hours)
    m = int(minutes) if minutes else 0
    if not (0 <= h <= 24) or not (0 <= m < 60):
        return None
    value = h * 60 + m
    return value if value <= 24 * 60 else None


def _find_weekdays(text: str) -> list[int]:
    """Найти все дни недели, упомянутые в тексте (с учётом границ слова)."""
    lowered = text.lower()
    if any(word in lowered for word in EVERYDAY_WORDS):
        return list(range(7))

    found: list[tuple[int, int]] = []  # (позиция, weekday)
    taken: list[tuple[int, int]] = []  # занятые срезы, чтобы «ср» не нашлась внутри «среда»
    for word, weekday in WEEKDAY_WORDS:
        for match in re.finditer(rf"(?<![\w]){re.escape(word)}(?![\w])", lowered):
            span = match.span()
            if any(span[0] < t_end and t_start < span[1] for t_start, t_end in taken):
                continue
            taken.append(span)
            found.append((span[0], weekday))
    found.sort()
    result: list[int] = []
    for _, weekday in found:
        if weekday not in result:
            result.append(weekday)
    return result


def _find_ranges(text: str) -> list[tuple[int, int, int, int]]:
    """Вернуть [(start_min, end_min, pos_start, pos_end), ...]."""
    ranges: list[tuple[int, int, int, int]] = []
    for match in RANGE_RE.finditer(text):
        start = _to_minutes(match.group(1), match.group(2))
        end = _to_minutes(match.group(3), match.group(4))
        if start is None or end is None:
            continue
        if end <= start:
            # «с 23 до 1» — через полночь; для учебного расписания это опечатка,
            # но 13-14 без нуля тоже бывает: если конец меньше начала на 12 часов, чиним
            if end + 12 * 60 > start:
                end += 12 * 60
            else:
                continue
        if end > 24 * 60:
            continue
        ranges.append((start, end, match.start(), match.end()))
    return ranges


def find_parity(text: str) -> int | None:
    """Числитель / знаменатель, если указаны в тексте."""
    lowered = text.lower()
    for word, parity in PARITY_WORDS:
        if re.search(rf"(?<![\w]){re.escape(word)}(?![\w])", lowered):
            return parity
    return None


def find_kind(text: str) -> str:
    """Тип занятости по ключевым словам; по умолчанию — учебная пара."""
    lowered = text.lower()
    for word, kind in KIND_WORDS:
        if word in lowered:
            return kind
    return "class"


def is_all_day(text: str) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in ALL_DAY_WORDS)


def _clean_label(raw: str) -> str:
    """Метка пары: без служебных слов чётности и мусорной пунктуации."""
    label = raw
    for word, _ in PARITY_WORDS:
        label = re.sub(rf"(?<![\w]){re.escape(word)}(?![\w])", " ", label, flags=re.IGNORECASE)
    label = re.sub(r"[()\[\]]", " ", label)
    label = re.sub(r"[\s,;:•·\-–—]+", " ", label).strip()
    return label[:60]


def parse_schedule_text(text: str) -> ParseResult:
    """Разобрать многострочный текст расписания."""
    slots: list[ParsedSlot] = []
    free_days: list[int] = []
    errors: list[str] = []
    current_days: list[int] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        days = _find_weekdays(line)
        if days:
            current_days = days
        if not current_days:
            errors.append(raw_line.strip())
            continue

        stripped = line.lower()
        for word, _ in WEEKDAY_WORDS:
            stripped = re.sub(rf"(?<![\w]){re.escape(word)}(?![\w])", " ", stripped)
        stripped = stripped.strip(" .:,;")

        ranges = _find_ranges(line)
        if not ranges:
            if is_all_day(line):
                for day in current_days:
                    slots.append(ParsedSlot(day, 0, 24 * 60, _clean_label(stripped),
                                            find_parity(line), find_kind(line)))
                continue
            if stripped in FREE_DAY_WORDS or not stripped:
                for day in current_days:
                    if day not in free_days:
                        free_days.append(day)
            else:
                errors.append(raw_line.strip())
            continue

        line_parity = find_parity(line)
        for index, (start, end, _, pos_end) in enumerate(ranges):
            next_start = ranges[index + 1][2] if index + 1 < len(ranges) else len(line)
            tail = line[pos_end:next_start]
            label = _clean_label(tail)
            parity = find_parity(tail)
            if parity is None:
                parity = line_parity
            for day in current_days:
                slots.append(ParsedSlot(day, start, end, label, parity, find_kind(tail) if label else find_kind(line)))

    return ParseResult(slots=slots, free_days=free_days, errors=errors)


def parse_schedule_csv(text: str) -> ParseResult:
    """CSV вида: weekday,start,end,label — с заголовком или без."""
    slots: list[ParsedSlot] = []
    errors: list[str] = []
    try:
        dialect = csv.Sniffer().sniff(text[:1024], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    for row in reader:
        cells = [cell.strip() for cell in row if cell.strip()]
        if len(cells) < 3:
            if cells:
                errors.append(",".join(cells))
            continue
        days = _find_weekdays(cells[0])
        if not days:
            errors.append(",".join(cells))  # скорее всего заголовок
            continue
        start = _parse_single_time(cells[1])
        end = _parse_single_time(cells[2])
        if start is None or end is None or end <= start:
            errors.append(",".join(cells))
            continue
        label = _clean_label(cells[3]) if len(cells) > 3 else ""
        parity = find_parity(cells[4]) if len(cells) > 4 else find_parity(label)
        for day in days:
            slots.append(ParsedSlot(day, start, end, label, parity, find_kind(label)))
    return ParseResult(slots=slots, free_days=[], errors=errors)


def _parse_single_time(value: str) -> int | None:
    match = re.fullmatch(rf"\s*{_TIME}\s*", value)
    if not match:
        return None
    return _to_minutes(match.group(1), match.group(2))


def parse_any(text: str) -> ParseResult:
    """Автовыбор: CSV, если строки похожи на таблицу, иначе свободный текст."""
    lines = [line for line in text.splitlines() if line.strip()]
    looks_like_csv = (
        len(lines) >= 2
        and sum(line.count(",") + line.count(";") + line.count("\t") for line in lines) >= 2 * len(lines)
    )
    if looks_like_csv:
        result = parse_schedule_csv(text)
        if result.ok:
            return result
    return parse_schedule_text(text)


def find_time_ranges(text: str) -> list[tuple[int, int]]:
    """Публичный хелпер: найти все диапазоны времени в строке."""
    return [(start, end) for start, end, _, _ in _find_ranges(text)]
