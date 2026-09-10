from qairu.core.intervals import (
    filter_min_duration,
    fmt_interval,
    fmt_minutes,
    intersect,
    intersect_all,
    invert,
    merge,
    normalize,
    total_minutes,
)


def test_merge_empty():
    assert merge([]) == []


def test_merge_overlapping():
    assert merge([(540, 630), (600, 700)]) == [(540, 700)]


def test_merge_adjacent_slots_have_no_gap():
    """9:00-10:00 и 10:00-11:00 — это один блок, окна в 10:00 быть не должно."""
    assert merge([(540, 600), (600, 660)]) == [(540, 660)]


def test_merge_disjoint_keeps_order():
    assert merge([(700, 800), (540, 600)]) == [(540, 600), (700, 800)]


def test_merge_drops_degenerate():
    assert merge([(600, 600), (540, 600)]) == [(540, 600)]


def test_normalize_clips_to_bounds():
    assert normalize([(400, 700)], 480, 660) == [(480, 660)]


def test_normalize_drops_outside():
    assert normalize([(100, 200)], 480, 1320) == []


def test_invert_basic():
    busy = [(540, 630), (780, 870)]
    assert invert(busy, 480, 1320) == [(480, 540), (630, 780), (870, 1320)]


def test_invert_full_day_busy():
    assert invert([(480, 1320)], 480, 1320) == []


def test_invert_no_busy():
    assert invert([], 480, 1320) == [(480, 1320)]


def test_invert_slot_outside_working_window_is_clipped():
    # пара 7:00-9:00 при рабочем окне с 8:00 -> свободно только с 9:00
    assert invert([(420, 540)], 480, 1320) == [(540, 1320)]


def test_intersect_basic():
    a = [(480, 600), (700, 900)]
    b = [(540, 720), (800, 1000)]
    assert intersect(a, b) == [(540, 600), (700, 720), (800, 900)]


def test_intersect_touching_only_gives_nothing():
    assert intersect([(480, 600)], [(600, 700)]) == []


def test_intersect_all_no_groups_returns_empty():
    """Пустой набор людей — не «все свободны», а пустой результат."""
    assert intersect_all([], 480, 1320) == []


def test_intersect_all_three_people():
    groups = [
        [(480, 720), (780, 1320)],
        [(540, 700), (800, 1000)],
        [(560, 690), (820, 960)],
    ]
    assert intersect_all(groups, 480, 1320) == [(560, 690), (820, 960)]


def test_filter_min_duration():
    assert filter_min_duration([(480, 500), (600, 700)], 30) == [(600, 700)]


def test_total_minutes():
    assert total_minutes([(480, 540), (600, 630)]) == 90


def test_formatting():
    assert fmt_minutes(540) == "09:00"
    assert fmt_minutes(0) == "00:00"
    assert fmt_minutes(1439) == "23:59"
    assert fmt_interval((540, 630)) == "09:00–10:30"


# --- кворум: сколько человек свободно одновременно ---

from qairu.core.intervals import coverage_windows, who_is_free  # noqa: E402


def test_coverage_requires_everyone():
    a = [(480, 600), (700, 900)]
    b = [(540, 720)]
    c = [(560, 690)]
    assert coverage_windows([a, b, c], 3) == [((560, 600), 3)]


def test_coverage_with_lower_threshold_merges_segments():
    a = [(480, 600), (700, 900)]
    b = [(540, 720)]
    c = [(560, 690)]
    assert coverage_windows([a, b, c], 2) == [((540, 690), 2), ((700, 720), 2)]


def test_coverage_reports_minimum_count_over_the_window():
    a = [(480, 900)]
    b = [(480, 900)]
    c = [(600, 700)]
    # порог 2 держится весь интервал; минимум по окну — 2, хотя в середине их 3
    assert coverage_windows([a, b, c], 2) == [((480, 900), 2)]


def test_coverage_zero_threshold_is_empty():
    assert coverage_windows([[(480, 600)]], 0) == []


def test_coverage_no_sets_is_empty():
    assert coverage_windows([], 1) == []


def test_who_is_free_needs_the_whole_window():
    free = {1: [(480, 900)], 2: [(480, 600)], 3: [(500, 900)]}
    assert who_is_free(free, (520, 580)) == [1, 2, 3]
    assert who_is_free(free, (480, 900)) == [1]
