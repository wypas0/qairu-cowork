from datetime import date

from qairu.core.availability import (
    PersonSchedule,
    compute_availability,
    free_windows_for_day,
    parity_from_iso_week,
    parity_from_semester_start,
    top_slots,
)

MONDAY = date(2026, 9, 7)
TUESDAY = date(2026, 9, 8)
NEXT_MONDAY = date(2026, 9, 14)


def person(uid, weekly=None, dated=None, parity=None, ranges=None, has_data=True):
    return PersonSchedule(
        user_id=uid,
        name=f"u{uid}",
        weekly=weekly or {},
        weekly_parity=parity or {},
        dated=dated or {},
        ranges=ranges or [],
        has_data=has_data,
    )


def intervals(windows):
    return [window.interval for window in windows]


# --- базовые окна ---------------------------------------------------------

def test_single_person_free_windows():
    amir = person(1, {0: [(540, 630), (780, 870)]})
    assert intervals(free_windows_for_day([amir], MONDAY, 480, 1320, 30)) == [
        (480, 540), (630, 780), (870, 1320)
    ]


def test_two_people_intersection():
    a = person(1, {0: [(540, 630)]})
    b = person(2, {0: [(600, 720)]})
    assert intervals(free_windows_for_day([a, b], MONDAY, 480, 1320, 30)) == [
        (480, 540), (720, 1320)
    ]


def test_min_duration_filters_short_gaps():
    a = person(1, {0: [(540, 630), (650, 780)]})
    assert free_windows_for_day([a], MONDAY, 540, 780, 30) == []


def test_no_people_gives_no_windows():
    assert free_windows_for_day([], MONDAY, 480, 1320, 30) == []


def test_person_without_schedule_is_excluded_and_reported():
    a = person(1, {0: [(540, 630)]})
    b = person(2, has_data=False)
    result = compute_availability([a, b], MONDAY, days_ahead=1, day_start=480, day_end=1320)
    assert [p.user_id for p in result.participants] == [1]
    assert [p.user_id for p in result.missing] == [2]
    assert intervals(result.days[0].windows) == [(480, 540), (630, 1320)]


def test_window_reports_who_is_free():
    a = person(1, {0: [(540, 630)]})
    b = person(2, {0: [(540, 630)]})
    windows = free_windows_for_day([a, b], MONDAY, 480, 1320, 30)
    assert windows[0].free_ids == [1, 2]
    assert windows[0].count == 2


def test_week_ahead_covers_seven_days():
    a = person(1, {0: [(480, 1320)]})
    result = compute_availability([a], MONDAY, days_ahead=7, day_start=480, day_end=1320)
    assert len(result.days) == 7
    assert result.days[0].windows == []
    assert intervals(result.days[1].windows) == [(480, 1320)]


def test_fully_busy_week_reports_no_windows():
    a = person(1, {day: [(480, 1320)] for day in range(7)})
    result = compute_availability([a], MONDAY, days_ahead=7, day_start=480, day_end=1320)
    assert not result.any_windows


def test_working_window_bounds_are_respected():
    a = person(1, {0: [(0, 24 * 60)]})
    result = compute_availability([a], MONDAY, days_ahead=1, day_start=480, day_end=1320)
    assert result.days[0].windows == []


# --- разовая занятость и диапазоны дат ------------------------------------

def test_dated_slot_applies_only_that_day():
    a = person(1, weekly={1: [(540, 600)]}, dated={TUESDAY: [(600, 720)]})
    result = compute_availability([a], TUESDAY, days_ahead=1, day_start=480, day_end=1320)
    assert intervals(result.days[0].windows) == [(480, 540), (720, 1320)]


def test_date_range_blocks_every_day_inside_it():
    """Сессия 7–9 сентября: понедельник и вторник заняты, четверг свободен."""
    a = person(1, ranges=[(MONDAY, date(2026, 9, 9), 0, 24 * 60)])
    result = compute_availability([a], MONDAY, days_ahead=5, day_start=480, day_end=1320)
    assert result.days[0].windows == []          # 07.09
    assert result.days[1].windows == []          # 08.09
    assert result.days[2].windows == []          # 09.09
    assert intervals(result.days[3].windows) == [(480, 1320)]   # 10.09


def test_date_range_with_hours_leaves_evening_free():
    a = person(1, ranges=[(MONDAY, date(2026, 9, 9), 540, 840)])
    result = compute_availability([a], MONDAY, days_ahead=1, day_start=480, day_end=1320)
    assert intervals(result.days[0].windows) == [(480, 540), (840, 1320)]


# --- чётность недель ------------------------------------------------------

def test_parity_from_semester_start():
    parity_of = parity_from_semester_start(date(2026, 9, 1))   # вторник 1-й недели
    assert parity_of(date(2026, 9, 1)) == 0     # числитель
    assert parity_of(date(2026, 9, 7)) == 1     # следующая неделя — знаменатель
    assert parity_of(date(2026, 9, 14)) == 0    # снова числитель


def test_parity_slot_applies_only_on_its_week():
    a = person(1, parity={0: {0: [(600, 720)]}})   # пара только по числителю
    parity_of = parity_from_semester_start(date(2026, 9, 1))

    busy_week = compute_availability([a], NEXT_MONDAY, days_ahead=1, day_start=480,
                                     day_end=1320, parity_of=parity_of)
    free_week = compute_availability([a], MONDAY, days_ahead=1, day_start=480,
                                     day_end=1320, parity_of=parity_of)
    assert intervals(busy_week.days[0].windows) == [(480, 600), (720, 1320)]
    assert intervals(free_week.days[0].windows) == [(480, 1320)]


def test_parity_ignored_when_no_reference_given():
    """Без начала семестра чётность неизвестна — такие пары не учитываются."""
    a = person(1, parity={0: {0: [(600, 720)]}})
    result = compute_availability([a], MONDAY, days_ahead=1, day_start=480, day_end=1320)
    assert intervals(result.days[0].windows) == [(480, 1320)]


def test_parity_from_iso_week_alternates():
    assert parity_from_iso_week(date(2026, 9, 7)) != parity_from_iso_week(date(2026, 9, 14))


# --- буфер на дорогу ------------------------------------------------------

def test_travel_buffer_shrinks_windows():
    a = person(1, {0: [(600, 720)]})
    result = compute_availability([a], MONDAY, days_ahead=1, day_start=480, day_end=1320,
                                  buffer_min=15)
    assert intervals(result.days[0].windows) == [(480, 585), (735, 1320)]


def test_travel_buffer_can_close_a_short_gap():
    a = person(1, {0: [(540, 600), (630, 720)]})   # окно 10:00–10:30
    result = compute_availability([a], MONDAY, days_ahead=1, day_start=480, day_end=1320,
                                  min_slot=30, buffer_min=20)
    assert (600, 630) not in intervals(result.days[0].windows)


# --- кворум ---------------------------------------------------------------

def test_quorum_finds_window_when_one_person_is_busy():
    a = person(1, {0: [(600, 720)]})
    b = person(2, {})
    c = person(3, {})
    everyone = compute_availability(
        [a, b, c], MONDAY, days_ahead=1, day_start=600, day_end=720, min_slot=30
    )
    assert everyone.days[0].windows == []
    assert everyone.everyone is True

    quorum = compute_availability([a, b, c], MONDAY, days_ahead=1, day_start=600,
                                  day_end=720, min_slot=30, quorum=2)
    assert intervals(quorum.days[0].windows) == [(600, 720)]
    assert quorum.days[0].windows[0].free_ids == [2, 3]
    assert quorum.everyone is False


def test_quorum_above_group_size_is_clamped_to_everyone():
    a = person(1, {})
    result = compute_availability([a], MONDAY, days_ahead=1, day_start=480, day_end=1320,
                                  quorum=99)
    assert result.quorum == 1
    assert result.everyone is True


def test_quorum_equal_to_group_size_matches_intersection():
    a = person(1, {0: [(540, 630)]})
    b = person(2, {0: [(600, 720)]})
    strict = compute_availability([a, b], MONDAY, days_ahead=1, day_start=480, day_end=1320)
    same = compute_availability([a, b], MONDAY, days_ahead=1, day_start=480, day_end=1320,
                                quorum=2)
    assert intervals(strict.days[0].windows) == intervals(same.days[0].windows)


# --- слоты для кнопок встречи ---------------------------------------------

def test_top_slots_limit_and_order():
    a = person(1, {})
    result = compute_availability([a], MONDAY, days_ahead=7, day_start=480, day_end=1320)
    slots = top_slots(result, limit=3)
    assert len(slots) == 3
    assert slots[0][0] == MONDAY
    assert slots[1][0] == TUESDAY
