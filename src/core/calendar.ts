/** Генерация .ics — встречу можно положить в любой календарь. */

const BACKSLASH = "\\";
const CRLF = String.fromCharCode(13, 10);

function escapeIcs(value: string): string {
  // RFC 5545: обратный слэш, точка с запятой, запятая и перевод строки экранируются.
  return value
    .split(BACKSLASH)
    .join(BACKSLASH + BACKSLASH)
    .split(";")
    .join(BACKSLASH + ";")
    .split(",")
    .join(BACKSLASH + ",")
    .split("\n")
    .join(BACKSLASH + "n");
}

function stamp(moment: Date): string {
  const iso = moment.toISOString(); // 2026-09-14T10:00:00.000Z
  return (
    iso.slice(0, 4) +
    iso.slice(5, 7) +
    iso.slice(8, 10) +
    "T" +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19) +
    "Z"
  );
}

export type IcsInput = {
  uid: string;
  summary: string;
  start: Date;
  durationMin?: number;
  location?: string;
  description?: string;
  /** RRULE без префикса, например «FREQ=WEEKLY;UNTIL=20261216T185900Z». */
  rrule?: string;
};

/**
 * Минимальный, но валидный VEVENT в UTC.
 *
 * Всё время переводится в UTC — так файл открывается одинаково
 * в Google Calendar, Apple Calendar и Outlook без VTIMEZONE.
 */
export function buildIcs(input: IcsInput): string {
  return buildFeed({ events: [input] });
}

/** Строки одного VEVENT. */
function eventLines({
  uid,
  summary,
  start,
  durationMin = 90,
  location = "",
  description = "",
  rrule = "",
}: IcsInput): string[] {
  const end = new Date(start.getTime() + Math.max(15, durationMin) * 60_000);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}@qairucowork`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeIcs(summary)}`,
  ];
  if (rrule) lines.push(`RRULE:${rrule}`);
  if (location) lines.push(`LOCATION:${escapeIcs(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeIcs(description)}`);
  lines.push("END:VEVENT");
  return lines;
}

/**
 * Календарь из нескольких встреч — для подписки. Календарь человека сам
 * перечитывает ссылку, поэтому новые встречи появляются у него без действий,
 * а отменённые (их в ленте больше нет) исчезают.
 */
export function buildFeed({ name, events }: { name?: string; events: IcsInput[] }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//QairuCowork//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (name) lines.push(`X-WR-CALNAME:${escapeIcs(name)}`);
  // Как часто перечитывать ленту — подсказка календарям, которые её понимают.
  lines.push("REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H");
  for (const event of events) lines.push(...eventLines(event));
  lines.push("END:VCALENDAR");
  // RFC 5545 требует CRLF
  return lines.join(CRLF) + CRLF;
}
