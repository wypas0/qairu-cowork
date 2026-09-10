"""Алгебра временных отрезков.

Все интервалы — полуинтервалы [start, end) в минутах от полуночи (int).
Модуль намеренно не знает ни про Telegram, ни про БД: чистые функции,
которые полностью покрываются юнит-тестами.
"""

from __future__ import annotations

Interval = tuple[int, int]


def normalize(intervals: list[Interval], lo: int = 0, hi: int = 24 * 60) -> list[Interval]:
    """Обрезать интервалы по границам [lo, hi) и выбросить пустые/некорректные."""
    out: list[Interval] = []
    for start, end in intervals:
        s, e = max(int(start), lo), min(int(end), hi)
        if s < e:
            out.append((s, e))
    return out


def merge(intervals: list[Interval]) -> list[Interval]:
    """Слить пересекающиеся и смежные интервалы. O(n log n).

    Смежные (9:00-10:00 и 10:00-11:00) сливаются намеренно: между двумя
    парами подряд нет окна.
    """
    if not intervals:
        return []
    ordered = sorted((int(s), int(e)) for s, e in intervals if int(s) < int(e))
    if not ordered:
        return []
    merged: list[Interval] = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:  # пересекаются или касаются
            if end > last_end:
                merged[-1] = (last_start, end)
        else:
            merged.append((start, end))
    return merged


def invert(busy: list[Interval], lo: int, hi: int) -> list[Interval]:
    """Дополнение занятости до рабочего окна [lo, hi) — свободные интервалы."""
    if lo >= hi:
        return []
    free: list[Interval] = []
    cursor = lo
    for start, end in merge(normalize(busy, lo, hi)):
        if start > cursor:
            free.append((cursor, start))
        cursor = max(cursor, end)
    if cursor < hi:
        free.append((cursor, hi))
    return free


def intersect(a: list[Interval], b: list[Interval]) -> list[Interval]:
    """Пересечение двух отсортированных непересекающихся списков. O(n+m)."""
    result: list[Interval] = []
    i = j = 0
    while i < len(a) and j < len(b):
        start = max(a[i][0], b[j][0])
        end = min(a[i][1], b[j][1])
        if start < end:
            result.append((start, end))
        # двигаем тот, что заканчивается раньше
        if a[i][1] <= b[j][1]:
            i += 1
        else:
            j += 1
    return result


def intersect_all(groups: list[list[Interval]], lo: int, hi: int) -> list[Interval]:
    """Пересечение произвольного числа наборов свободных интервалов.

    Пустой список групп — это ошибка вызывающего кода, а не «все свободны»:
    возвращаем пустой результат, чтобы бот не показал ложные окна.
    """
    if not groups:
        return []
    common: list[Interval] = [(lo, hi)]
    for group in groups:
        common = intersect(common, merge(normalize(group, lo, hi)))
        if not common:
            return []
    return common


def filter_min_duration(intervals: list[Interval], minimum: int) -> list[Interval]:
    """Отсеять окна короче `minimum` минут."""
    return [(s, e) for s, e in intervals if e - s >= minimum]


def total_minutes(intervals: list[Interval]) -> int:
    return sum(e - s for s, e in intervals)


def fmt_minutes(value: int) -> str:
    """540 -> '09:00'. Значение 1440 отображается как '24:00'."""
    value = max(0, int(value))
    return f"{value // 60:02d}:{value % 60:02d}"


def fmt_interval(interval: Interval) -> str:
    start, end = interval
    return f"{fmt_minutes(start)}–{fmt_minutes(end)}"


def coverage_windows(free_sets: list[list[Interval]], min_count: int) -> list[tuple[Interval, int]]:
    """Окна, в которых одновременно свободны хотя бы `min_count` человек.

    Заметающая прямая: каждый свободный интервал даёт +1 в начале и -1 в конце.
    Смежные участки со счётчиком ≥ порога склеиваются в одно окно; вторым
    элементом возвращается МИНИМАЛЬНЫЙ счётчик на этом окне — то есть
    «на всём окне свободны как минимум столько».
    """
    if min_count <= 0 or not free_sets:
        return []

    events: list[tuple[int, int]] = []
    for intervals in free_sets:
        for start, end in merge(intervals):
            events.append((start, 1))
            events.append((end, -1))
    if not events:
        return []
    events.sort()

    result: list[tuple[Interval, int]] = []
    count = 0
    segment_start: int | None = None
    segment_min = 0
    index = 0
    while index < len(events):
        position = events[index][0]
        if segment_start is not None and position > segment_start:
            segment_min = min(segment_min, count)
        while index < len(events) and events[index][0] == position:
            count += events[index][1]
            index += 1
        if count >= min_count:
            if segment_start is None:
                segment_start = position
                segment_min = count
            else:
                segment_min = min(segment_min, count)
        elif segment_start is not None:
            result.append(((segment_start, position), segment_min))
            segment_start = None
    return result


def who_is_free(free_by_user: dict[int, list[Interval]], window: Interval) -> list[int]:
    """Кто свободен на протяжении всего окна целиком."""
    start, end = window
    return [
        user_id
        for user_id, intervals in free_by_user.items()
        if any(s <= start and end <= e for s, e in merge(intervals))
    ]
