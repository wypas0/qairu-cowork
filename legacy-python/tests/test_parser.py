from qairu.core.parser import parse_any, parse_schedule_csv, parse_schedule_text


def slots_of(result, weekday):
    return sorted((s.start_min, s.end_min) for s in result.slots if s.weekday == weekday)


def test_russian_short_days():
    result = parse_schedule_text("Пн 9:00-10:30\nВт 13:00-14:30")
    assert slots_of(result, 0) == [(540, 630)]
    assert slots_of(result, 1) == [(780, 870)]


def test_russian_full_days():
    result = parse_schedule_text("понедельник 9-10:30\nсреда 12:00-13:30")
    assert slots_of(result, 0) == [(540, 630)]
    assert slots_of(result, 2) == [(720, 810)]


def test_kazakh_days_longest_match_wins():
    """«Сенбі» не должно срабатывать внутри «Дүйсенбі» или «Бейсенбі»."""
    result = parse_schedule_text("Дүйсенбі 9:00-10:30\nБейсенбі 11:00-12:30\nСенбі 14:00-15:30")
    assert slots_of(result, 0) == [(540, 630)]   # дүйсенбі = понедельник
    assert slots_of(result, 3) == [(660, 750)]   # бейсенбі = четверг
    assert slots_of(result, 5) == [(840, 930)]   # сенбі = суббота


def test_english_days():
    result = parse_schedule_text("Monday 9:00-10:30\nfri 15:00-16:00")
    assert slots_of(result, 0) == [(540, 630)]
    assert slots_of(result, 4) == [(900, 960)]


def test_multiple_ranges_one_line_with_labels():
    result = parse_schedule_text("Пн 9:00-10:30 Матан, 13:00-14:30 История")
    assert slots_of(result, 0) == [(540, 630), (780, 870)]
    labels = sorted(s.label for s in result.slots)
    assert "Матан" in labels[1] or "Матан" in labels[0]


def test_various_time_formats():
    result = parse_schedule_text("Чт 10-11.30; 12:00-13:30")
    assert slots_of(result, 3) == [(600, 690), (720, 810)]


def test_en_dash_and_em_dash():
    result = parse_schedule_text("Вт 8:00–9:30\nСр 10:00—11:00")
    assert slots_of(result, 1) == [(480, 570)]
    assert slots_of(result, 2) == [(600, 660)]


def test_free_day_marked():
    result = parse_schedule_text("Ср нет пар")
    assert 2 in result.free_days
    assert slots_of(result, 2) == []


def test_everyday_keyword():
    result = parse_schedule_text("ежедневно 9:00-10:00")
    assert len(result.slots) == 7


def test_unparsable_line_reported():
    result = parse_schedule_text("какая-то ерунда без времени")
    assert result.errors
    assert not result.slots


def test_day_carries_over_to_next_line():
    result = parse_schedule_text("Пн\n9:00-10:30\n13:00-14:00")
    assert slots_of(result, 0) == [(540, 630), (780, 840)]


def test_invalid_time_ignored():
    result = parse_schedule_text("Пн 25:00-26:00")
    assert slots_of(result, 0) == []


def test_csv_with_header():
    text = "weekday,start,end,label\nПн,9:00,10:30,Матан\nВт,13:00,14:30,История\n"
    result = parse_schedule_csv(text)
    assert slots_of(result, 0) == [(540, 630)]
    assert slots_of(result, 1) == [(780, 870)]


def test_parse_any_picks_csv():
    text = "Пн,9:00,10:30,Матан\nВт,13:00,14:30,История\nСр,10:00,11:00,Физика\n"
    result = parse_any(text)
    assert len(result.slots) == 3


def test_parse_any_picks_text_when_commas_are_separators():
    text = "Пн 9:00-10:30 Матан, 13:00-14:30 История\nВт 8:00-9:30"
    result = parse_any(text)
    assert slots_of(result, 0) == [(540, 630), (780, 870)]
    assert slots_of(result, 1) == [(480, 570)]


# --- чётность недель, типы занятости, «весь день» ---

from qairu.core.parser import find_kind, find_parity, is_all_day  # noqa: E402


def test_parity_detected_per_range():
    result = parse_schedule_text("Пн 9:00-10:30 Матан (числитель), 13:00-14:30 История (знаменатель)")
    by_start = {s.start_min: s for s in result.slots}
    assert by_start[540].parity == 0
    assert by_start[780].parity == 1


def test_parity_strips_service_words_from_label():
    result = parse_schedule_text("Пн 9:00-10:30 Матан (числитель)")
    assert result.slots[0].label == "Матан"


def test_parity_line_level_applies_to_all_ranges():
    result = parse_schedule_text("Знаменатель: Ср 9:00-10:30, 11:00-12:30")
    assert all(slot.parity == 1 for slot in result.slots)


def test_no_parity_means_every_week():
    result = parse_schedule_text("Пн 9:00-10:30 Матан")
    assert result.slots[0].parity is None


def test_kind_detection():
    assert find_kind("18:00-22:00 работа") == "work"
    assert find_kind("тренировка в зале") == "sport"
    assert find_kind("экзамен по матану") == "exam"
    assert find_kind("Матан") == "class"


def test_work_slot_kind_is_saved():
    result = parse_schedule_text("Сб 18:00-22:00 работа")
    assert result.slots[0].kind == "work"
    assert result.slots[0].start_min == 1080


def test_all_day_without_time():
    result = parse_schedule_text("Вт весь день")
    assert result.slots[0].start_min == 0
    assert result.slots[0].end_min == 24 * 60


def test_all_day_helper():
    assert is_all_day("12.09 весь день")
    assert is_all_day("all day")
    assert not is_all_day("14:00-16:00")


def test_parity_helper_english():
    assert find_parity("odd week") == 0
    assert find_parity("even week") == 1
    assert find_parity("just a label") is None


def test_csv_fifth_column_is_parity():
    text = "Пн,9:00,10:30,Матан,числитель\nВт,13:00,14:30,История,знаменатель\n"
    result = parse_schedule_csv(text)
    assert [s.parity for s in result.slots] == [0, 1]
