"""Вычисление общих свободных окон.

Поверх `intervals.py`. Про Telegram и БД не знает.

Поддерживает:
- повторяющиеся пары (каждую неделю и по чётности недели);
- разовую занятость на дату и на диапазон дат (сессия, поездка);
- буфер на дорогу — расширение каждой занятости на N минут с двух сторон;
- кворум: окна, где свободны не все, а хотя бы K человек.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta

from .intervals import Interval, coverage_windows, invert, merge, normalize, who_is_free

# Чётность недели: 0 — числитель (верхняя), 1 — знаменатель (нижняя)
ODD, EVEN = 0, 1


def parity_from_semester_start(semester_start: date) -> Callable[[date], int]:
    """Чётность недели относительно начала семестра (первая неделя — числитель)."""
    monday = semester_start - timedelta(days=semester_start.weekday())

    def parity_of(day: date) -> int:
        return ((day - monday).days // 7) % 2

    return parity_of


def parity_from_iso_week(day: date) -> int:
    """Запасной вариант: по номеру ISO-недели (нечётная — числитель)."""
    return (day.isocalendar().week + 1) % 2


@dataclass
class PersonSchedule:
    """Занятость одного человека."""

    user_id: int
    name: str
    weekly: dict[int, list[Interval]] = field(default_factory=dict)
    # {чётность: {день недели: интервалы}} — пары через неделю
    weekly_parity: dict[int, dict[int, list[Interval]]] = field(default_factory=dict)
    dated: dict[date, list[Interval]] = field(default_factory=dict)
    # (дата с, дата по, начало, конец) — сессия, поездка, «занят целиком»
    ranges: list[tuple[date, date, int, int]] = field(default_factory=list)
    has_data: bool = True

    def busy_on(self, day: date, parity: int | None = None, buffer_min: int = 0) -> list[Interval]:
        busy: list[Interval] = list(self.weekly.get(day.weekday(), []))
        if parity is not None:
            busy += self.weekly_parity.get(parity, {}).get(day.weekday(), [])
        busy += self.dated.get(day, [])
        for date_from, date_to, start, end in self.ranges:
            if date_from <= day <= date_to:
                busy.append((start, end))
        if buffer_min:
            busy = [(start - buffer_min, end + buffer_min) for start, end in busy]
        return merge(busy)


@dataclass
class Window:
    """Свободное окно и кто в нём свободен."""

    interval: Interval
    free_ids: list[int]

    @property
    def count(self) -> int:
        return len(self.free_ids)


@dataclass
class DayWindows:
    day: date
    windows: list[Window]

    @property
    def has_windows(self) -> bool:
        return bool(self.windows)


@dataclass
class AvailabilityResult:
    days: list[DayWindows]
    participants: list[PersonSchedule]
    missing: list[PersonSchedule]
    day_start: int
    day_end: int
    min_slot: int
    quorum: int
    everyone: bool  # True, если кворум = все участники

    @property
    def any_windows(self) -> bool:
        return any(day.has_windows for day in self.days)


def free_windows_for_day(
    people: list[PersonSchedule],
    day: date,
    day_start: int,
    day_end: int,
    min_slot: int,
    quorum: int | None = None,
    parity_of: Callable[[date], int] | None = None,
    buffer_min: int = 0,
) -> list[Window]:
    """Свободные окна одного дня.

    quorum=None — нужны все; иначе достаточно `quorum` свободных человек.
    """
    if not people:
        return []

    parity = parity_of(day) if parity_of else None
    free_by_user: dict[int, list[Interval]] = {
        person.user_id: invert(
            normalize(person.busy_on(day, parity, buffer_min), day_start, day_end),
            day_start,
            day_end,
        )
        for person in people
    }

    threshold = len(people) if quorum is None else max(1, min(quorum, len(people)))
    windows: list[Window] = []
    for interval, _ in coverage_windows(list(free_by_user.values()), threshold):
        if interval[1] - interval[0] < min_slot:
            continue
        windows.append(Window(interval=interval, free_ids=who_is_free(free_by_user, interval)))
    return windows


def compute_availability(
    people: list[PersonSchedule],
    start_day: date,
    days_ahead: int = 7,
    day_start: int = 8 * 60,
    day_end: int = 22 * 60,
    min_slot: int = 30,
    quorum: int | None = None,
    parity_of: Callable[[date], int] | None = None,
    buffer_min: int = 0,
) -> AvailabilityResult:
    """Свободные окна на `days_ahead` дней вперёд, начиная со `start_day`."""
    with_data = [person for person in people if person.has_data]
    missing = [person for person in people if not person.has_data]

    threshold = len(with_data) if quorum is None else max(1, min(quorum, len(with_data)))

    days = [
        DayWindows(
            day=start_day + timedelta(days=offset),
            windows=free_windows_for_day(
                with_data,
                start_day + timedelta(days=offset),
                day_start,
                day_end,
                min_slot,
                quorum,
                parity_of,
                buffer_min,
            ),
        )
        for offset in range(days_ahead)
    ]

    return AvailabilityResult(
        days=days,
        participants=with_data,
        missing=missing,
        day_start=day_start,
        day_end=day_end,
        min_slot=min_slot,
        quorum=threshold,
        everyone=threshold >= len(with_data),
    )


def top_slots(result: AvailabilityResult, limit: int = 5) -> list[tuple[date, Interval]]:
    """Первые `limit` окон по хронологии — для кнопок выбора времени встречи."""
    slots: list[tuple[date, Interval]] = []
    for day in result.days:
        for window in day.windows:
            slots.append((day.day, window.interval))
            if len(slots) >= limit:
                return slots
    return slots


@dataclass
class HeatCell:
    """Одна клетка сетки: сколько человек свободно на всём её протяжении."""

    start_min: int
    end_min: int
    free_ids: list[int]

    @property
    def count(self) -> int:
        return len(self.free_ids)


@dataclass
class HeatDay:
    day: date
    cells: list[HeatCell]


def heatmap(
    people: list[PersonSchedule],
    start_day: date,
    days_ahead: int = 7,
    day_start: int = 8 * 60,
    day_end: int = 22 * 60,
    step: int = 30,
    parity_of: Callable[[date], int] | None = None,
    buffer_min: int = 0,
) -> list[HeatDay]:
    """Тепловая карта недели: для каждой получасовой клетки — кто свободен.

    Это то, чего не может дать чат: одним взглядом видно, где «почти все»
    свободны, а где провал. Клетка считается свободной только если человек
    свободен на всём её протяжении — половинчатых значений нет намеренно,
    иначе цвет обманывает.
    """
    with_data = [person for person in people if person.has_data]
    result: list[HeatDay] = []

    for offset in range(days_ahead):
        day = start_day + timedelta(days=offset)
        parity = parity_of(day) if parity_of else None
        free_by_user = {
            person.user_id: invert(
                normalize(person.busy_on(day, parity, buffer_min), day_start, day_end),
                day_start,
                day_end,
            )
            for person in with_data
        }
        cells: list[HeatCell] = []
        for start in range(day_start, day_end, step):
            end = min(start + step, day_end)
            cells.append(
                HeatCell(start_min=start, end_min=end,
                         free_ids=who_is_free(free_by_user, (start, end)))
            )
        result.append(HeatDay(day=day, cells=cells))
    return result
