/**
 * Парсер расписания из свободного текста и CSV.
 *
 * Понимает три языка (ru / kk / en), полные и сокращённые названия дней,
 * разные разделители диапазонов и форматы времени.
 *
 * Пример входа:
 *     Пн 9:00-10:30 Матан, 13:00-14:30 История
 *     Вт 8:00–9:30
 *     Ср нет пар
 *     Чт 10-11.30; 12:00-13:30 Физика
 */

import { fmtMinutes } from "./intervals";

// --------------------------------------------------------------------------
// Дни недели. Порядок важен: сначала длинные формы, иначе «сенбі» съест
// «дүйсенбі», а «ср» — «среда».
// --------------------------------------------------------------------------

const RAW_WEEKDAY_WORDS: [string, number][] = [
  // русский
  ["понедельник", 0], ["вторник", 1], ["среда", 2], ["среду", 2],
  ["четверг", 3], ["пятница", 4], ["пятницу", 4],
  ["суббота", 5], ["субботу", 5], ["воскресенье", 6], ["воскресение", 6],
  ["пн", 0], ["вт", 1], ["ср", 2], ["чт", 3], ["пт", 4], ["сб", 5], ["вс", 6],
  // казахский
  ["дүйсенбі", 0], ["дуйсенби", 0],
  ["сейсенбі", 1], ["сейсенби", 1],
  ["сәрсенбі", 2], ["сарсенби", 2],
  ["бейсенбі", 3], ["бейсенби", 3],
  ["жұма", 4], ["жума", 4],
  ["сенбі", 5], ["сенби", 5],
  ["жексенбі", 6], ["жексенби", 6],
  ["дс", 0], ["сс", 1], ["ср", 2], ["бс", 3], ["жм", 4], ["сб", 5], ["жс", 6],
  // английский
  ["monday", 0], ["tuesday", 1], ["wednesday", 2], ["thursday", 3],
  ["friday", 4], ["saturday", 5], ["sunday", 6],
  ["mon", 0], ["tue", 1], ["tues", 1], ["wed", 2], ["thu", 3], ["thur", 3],
  ["thurs", 3], ["fri", 4], ["sat", 5], ["sun", 6],
];

// длинные раньше коротких
export const WEEKDAY_WORDS: [string, number][] = [...RAW_WEEKDAY_WORDS].sort(
  (a, b) => b[0].length - a[0].length,
);

const EVERYDAY_WORDS = [
  "ежедневно", "каждый день", "все дни", "күнде", "кунде", "daily", "every day",
];

// Чётность недели: 0 — числитель (верхняя), 1 — знаменатель (нижняя)
const RAW_PARITY_WORDS: [string, number][] = [
  ["числитель", 0], ["числ", 0], ["чис", 0], ["верхняя", 0], ["верх", 0],
  ["1 неделя", 0], ["неделя 1", 0], ["н1", 0], ["odd", 0], ["upper", 0],
  ["знаменатель", 1], ["знам", 1], ["зн", 1], ["нижняя", 1], ["низ", 1],
  ["2 неделя", 1], ["неделя 2", 1], ["н2", 1], ["even", 1], ["lower", 1],
];
const PARITY_WORDS: [string, number][] = [...RAW_PARITY_WORDS].sort(
  (a, b) => b[0].length - a[0].length,
);

// Тип занятости
const RAW_KIND_WORDS: [string, BusyKind][] = [
  ["подработка", "work"], ["работа", "work"], ["работе", "work"], ["смена", "work"],
  ["жұмыс", "work"], ["жумыс", "work"], ["work", "work"], ["job", "work"], ["shift", "work"],
  ["тренировка", "sport"], ["тренировки", "sport"], ["секция", "sport"], ["спорт", "sport"],
  ["зал", "sport"], ["жаттығу", "sport"], ["sport", "sport"], ["gym", "sport"],
  ["training", "sport"], ["practice", "sport"],
  ["экзамен", "exam"], ["сессия", "exam"], ["зачёт", "exam"], ["зачет", "exam"],
  ["емтихан", "exam"], ["exam", "exam"],
];
const KIND_WORDS: [string, BusyKind][] = [...RAW_KIND_WORDS].sort(
  (a, b) => b[0].length - a[0].length,
);

const ALL_DAY_WORDS = [
  "весь день", "целый день", "полный день", "күні бойы", "куни бойы",
  "all day", "whole day", "занят весь день", "бос емес",
];

const FREE_DAY_WORDS = new Set([
  "нет пар", "нет", "свободно", "выходной", "жоқ", "жок", "бос",
  "free", "none", "no classes", "-",
]);

const DASHES = "-–—‒−~";
const TIME = String.raw`(\d{1,2})\s*(?:[:.\-hч]\s*(\d{2}))?`;
// Python `\w` в юникод-режиме включает кириллицу; JS-овский `\w` — только ASCII,
// поэтому границу слова задаём явно через свойства Unicode.
const WORD_CHAR = String.raw`[\p{L}\p{N}_]`;

const RANGE_RE = new RegExp(
  `${TIME}\\s*(?:[${DASHES}]|до|дейін|деиин|to|till|until)\\s*${TIME}`,
  "giu",
);
const SINGLE_TIME_RE = new RegExp(`^\\s*${TIME}\\s*$`, "iu");

export type BusyKind = "class" | "work" | "sport" | "exam" | "other";

/** Один распознанный занятый интервал. */
export type ParsedSlot = {
  /** 0 = понедельник … 6 = воскресенье */
  weekday: number;
  startMin: number;
  endMin: number;
  label: string;
  /** null — каждую неделю, 0 — числитель, 1 — знаменатель */
  parity: number | null;
  kind: BusyKind;
};

export type ParseResult = {
  slots: ParsedSlot[];
  /** дни, явно помеченные как свободные */
  freeDays: number[];
  /** строки, которые не удалось разобрать */
  errors: string[];
};

export function parseResultOk(result: ParseResult): boolean {
  return result.slots.length > 0 || result.freeDays.length > 0;
}

export function slotToString(slot: ParsedSlot): string {
  const tail = slot.label ? ` ${slot.label}` : "";
  return `${fmtMinutes(slot.startMin)}–${fmtMinutes(slot.endMin)}${tail}`;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `(?<!\w)word(?!\w)` с юникодной трактовкой `\w`, как в Python. */
function boundedRe(word: string, flags: string): RegExp {
  return new RegExp(`(?<!${WORD_CHAR})${escapeRe(word)}(?!${WORD_CHAR})`, flags);
}

function toMinutes(hours: string, minutes: string | undefined): number | null {
  const h = Number(hours);
  const m = minutes ? Number(minutes) : 0;
  if (!(h >= 0 && h <= 24) || !(m >= 0 && m < 60)) return null;
  const value = h * 60 + m;
  return value <= 24 * 60 ? value : null;
}

/** Найти все дни недели, упомянутые в тексте (с учётом границ слова). */
export function findWeekdays(text: string): number[] {
  const lowered = text.toLowerCase();
  if (EVERYDAY_WORDS.some((word) => lowered.includes(word))) {
    return [0, 1, 2, 3, 4, 5, 6];
  }

  const found: [number, number][] = []; // (позиция, weekday)
  const taken: [number, number][] = []; // занятые срезы, чтобы «ср» не нашлась внутри «среда»
  for (const [word, weekday] of WEEKDAY_WORDS) {
    const re = boundedRe(word, "gu");
    let match: RegExpExecArray | null;
    while ((match = re.exec(lowered)) !== null) {
      const span: [number, number] = [match.index, match.index + match[0].length];
      if (taken.some(([ts, te]) => span[0] < te && ts < span[1])) continue;
      taken.push(span);
      found.push([span[0], weekday]);
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const result: number[] = [];
  for (const [, weekday] of found) {
    if (!result.includes(weekday)) result.push(weekday);
  }
  return result;
}

export type FoundRange = {
  start: number;
  end: number;
  posStart: number;
  posEnd: number;
};

/** Вернуть все диапазоны времени с их позициями в строке. */
export function findRangesWithPos(text: string): FoundRange[] {
  const ranges: FoundRange[] = [];
  const re = new RegExp(RANGE_RE.source, RANGE_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    const start = toMinutes(match[1], match[2]);
    let end = toMinutes(match[3], match[4]);
    if (start === null || end === null) continue;
    if (end <= start) {
      // «с 23 до 1» — через полночь; для учебного расписания это опечатка,
      // но 13-14 без нуля тоже бывает: если конец меньше начала на 12 часов, чиним
      if (end + 12 * 60 > start) end += 12 * 60;
      else continue;
    }
    if (end > 24 * 60) continue;
    ranges.push({ start, end, posStart: match.index, posEnd: match.index + match[0].length });
  }
  return ranges;
}

/** Публичный хелпер: найти все диапазоны времени в строке. */
export function findTimeRanges(text: string): [number, number][] {
  return findRangesWithPos(text).map((range) => [range.start, range.end]);
}

/** Числитель / знаменатель, если указаны в тексте. */
export function findParity(text: string): number | null {
  const lowered = text.toLowerCase();
  for (const [word, parity] of PARITY_WORDS) {
    if (boundedRe(word, "u").test(lowered)) return parity;
  }
  return null;
}

/** Тип занятости по ключевым словам; по умолчанию — учебная пара. */
export function findKind(text: string): BusyKind {
  const lowered = text.toLowerCase();
  for (const [word, kind] of KIND_WORDS) {
    if (lowered.includes(word)) return kind;
  }
  return "class";
}

export function isAllDay(text: string): boolean {
  const lowered = text.toLowerCase();
  return ALL_DAY_WORDS.some((word) => lowered.includes(word));
}

/** Метка пары: без служебных слов чётности и мусорной пунктуации. */
function cleanLabel(raw: string): string {
  let label = raw;
  for (const [word] of PARITY_WORDS) {
    label = label.replace(boundedRe(word, "giu"), " ");
  }
  label = label.replace(/[()[\]]/g, " ");
  label = label.replace(/[\s,;:•·\-–—]+/gu, " ").trim();
  return label.slice(0, 60);
}

/** Аналог питоновского `str.strip(chars)`. */
function stripChars(value: string, chars: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start])) start += 1;
  while (end > start && chars.includes(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

/** Разобрать многострочный текст расписания. */
export function parseScheduleText(text: string): ParseResult {
  const slots: ParsedSlot[] = [];
  const freeDays: number[] = [];
  const errors: string[] = [];
  let currentDays: number[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const days = findWeekdays(line);
    if (days.length) currentDays = days;
    if (currentDays.length === 0) {
      errors.push(rawLine.trim());
      continue;
    }

    let stripped = line.toLowerCase();
    for (const [word] of WEEKDAY_WORDS) {
      stripped = stripped.replace(boundedRe(word, "gu"), " ");
    }
    stripped = stripChars(stripped, " .:,;");

    const ranges = findRangesWithPos(line);
    if (ranges.length === 0) {
      if (isAllDay(line)) {
        for (const day of currentDays) {
          slots.push({
            weekday: day,
            startMin: 0,
            endMin: 24 * 60,
            label: cleanLabel(stripped),
            parity: findParity(line),
            kind: findKind(line),
          });
        }
        continue;
      }
      if (FREE_DAY_WORDS.has(stripped) || !stripped) {
        for (const day of currentDays) {
          if (!freeDays.includes(day)) freeDays.push(day);
        }
      } else {
        errors.push(rawLine.trim());
      }
      continue;
    }

    const lineParity = findParity(line);
    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index];
      const nextStart = index + 1 < ranges.length ? ranges[index + 1].posStart : line.length;
      const tail = line.slice(range.posEnd, nextStart);
      const label = cleanLabel(tail);
      const tailParity = findParity(tail);
      const parity = tailParity === null ? lineParity : tailParity;
      const kind = label ? findKind(tail) : findKind(line);
      for (const day of currentDays) {
        slots.push({
          weekday: day,
          startMin: range.start,
          endMin: range.end,
          label,
          parity,
          kind,
        });
      }
    }
  }

  return { slots, freeDays, errors };
}

function parseSingleTime(value: string): number | null {
  const match = SINGLE_TIME_RE.exec(value);
  if (!match) return null;
  return toMinutes(match[1], match[2]);
}

/** Минимальный CSV-ридер: кавычки, удвоенные кавычки внутри поля. */
function readCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 1024);
  let best = ",";
  let bestCount = -1;
  for (const candidate of [",", ";", "\t"]) {
    const count = sample.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

/** CSV вида: weekday,start,end,label[,parity] — с заголовком или без. */
export function parseScheduleCsv(text: string): ParseResult {
  const slots: ParsedSlot[] = [];
  const errors: string[] = [];
  const delimiter = sniffDelimiter(text);

  for (const row of readCsv(text, delimiter)) {
    const cells = row.map((cell) => cell.trim()).filter((cell) => cell !== "");
    if (cells.length < 3) {
      if (cells.length) errors.push(cells.join(","));
      continue;
    }
    const days = findWeekdays(cells[0]);
    if (days.length === 0) {
      errors.push(cells.join(",")); // скорее всего заголовок
      continue;
    }
    const start = parseSingleTime(cells[1]);
    const end = parseSingleTime(cells[2]);
    if (start === null || end === null || end <= start) {
      errors.push(cells.join(","));
      continue;
    }
    const label = cells.length > 3 ? cleanLabel(cells[3]) : "";
    const parity = cells.length > 4 ? findParity(cells[4]) : findParity(label);
    for (const day of days) {
      slots.push({ weekday: day, startMin: start, endMin: end, label, parity, kind: findKind(label) });
    }
  }
  return { slots, freeDays: [], errors };
}

/** Автовыбор: CSV, если строки похожи на таблицу, иначе свободный текст. */
export function parseAny(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const separators = lines.reduce(
    (sum, line) =>
      sum +
      (line.split(",").length - 1) +
      (line.split(";").length - 1) +
      (line.split("\t").length - 1),
    0,
  );
  const looksLikeCsv = lines.length >= 2 && separators >= 2 * lines.length;
  if (looksLikeCsv) {
    const result = parseScheduleCsv(text);
    if (parseResultOk(result)) return result;
  }
  return parseScheduleText(text);
}
