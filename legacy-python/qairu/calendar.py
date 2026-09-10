"""Генерация .ics — встречу можно положить в любой календарь."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


def _escape(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def build_ics(
    uid: str,
    summary: str,
    start: datetime,
    duration_min: int = 90,
    location: str = "",
    description: str = "",
) -> str:
    """Минимальный, но валидный VEVENT в UTC.

    Всё время переводится в UTC — так файл открывается одинаково
    в Google Calendar, Apple Calendar и Outlook без VTIMEZONE.
    """
    end = start + timedelta(minutes=max(15, duration_min))
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//QairuCowork//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:{uid}@qairucowork",
        f"DTSTAMP:{_stamp(datetime.now(timezone.utc))}",
        f"DTSTART:{_stamp(start)}",
        f"DTEND:{_stamp(end)}",
        f"SUMMARY:{_escape(summary)}",
    ]
    if location:
        lines.append(f"LOCATION:{_escape(location)}")
    if description:
        lines.append(f"DESCRIPTION:{_escape(description)}")
    lines += ["END:VEVENT", "END:VCALENDAR"]
    # RFC 5545 требует CRLF
    return "\r\n".join(lines) + "\r\n"
