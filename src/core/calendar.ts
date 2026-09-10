/** Генерация .ics — встречу можно положить в любой календарь. */

const BACKSLASH = "\\";

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
};

/**
 * Минимальный, но валидный VEVENT в UTC.
 *
 * Всё время переводится в UTC — так файл открывается одинаково
 * в Google Calendar, Apple Calendar и Outlook без VTIMEZONE.
 */
export function buildIcs({
  uid,
  summary,
  start,
  durationMin = 90,
  location = "",
  description = "",
}: IcsInput): string {
  const end = new Date(start.getTime() + Math.max(15, durationMin) * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//QairuCowork//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}@qairucowork`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeIcs(summary)}`,
  ];
  if (location) lines.push(`LOCATION:${escapeIcs(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeIcs(description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  // RFC 5545 требует CRLF
  return lines.join("\r\n") + "\r\n";
}
