import Link from "next/link";

import { BrandMark, IconChevronRight, IconClock } from "./icons";
import type { GroupNextMeeting, ProfileGroup } from "./ProfilePanel";

/*
 * Группы в левой панели: строка группы и её предстоящие встречи. Одни и те же
 * на страницах группы (AppShell) и на лендинге (LandingShell).
 */

/** Строка группы: знак, название, счётчик «ждёт тебя». В свёрнутой панели остаются знак и счётчик. */
export function GroupLink({
  group,
  current = false,
  pendingLabel,
}: {
  group: ProfileGroup;
  current?: boolean;
  pendingLabel: string;
}) {
  return (
    <Link
      className={`sidebar-link sidebar-group${current ? " current" : ""}`}
      href={`/g/${group.slug}`}
      title={group.title}
    >
      <span className="sidebar-mark" aria-hidden="true">
        <BrandMark size={14} />
      </span>
      <span className="sidebar-title">{group.title}</span>
      {group.pending ? (
        <span className="count-badge" aria-label={pendingLabel}>
          {group.pending}
        </span>
      ) : null}
    </Link>
  );
}

export type MeetingLabels = {
  list: string;
  /** «3 встречи» — число в правильной форме. */
  count: (n: number) => string;
  /** «{n}/{total} идут» — литеральные {n} и {total}. */
  going: string;
  awaiting: string;
};

/**
 * Все предстоящие встречи группы под её названием, по времени: когда, о чём,
 * сколько идут и ждёт ли встреча твоего ответа. Нажатие открывает встречу во
 * вкладке «Встречи».
 *
 * Список текущей группы раскрыт, у остальных свёрнут в строку «3 встречи ·
 * Завтра, 16:00» — как рабочие пространства в Slack: при пяти группах со
 * встречами сайдбар иначе превращается в ленту.
 */
export function GroupMeetings({
  group,
  open,
  labels,
}: {
  group: ProfileGroup;
  open: boolean;
  labels: MeetingLabels;
}) {
  const meetings = group.meetings ?? [];
  if (meetings.length === 0) return null;
  const awaiting = meetings.some((meeting) => meeting.awaiting);
  return (
    <details className="sidebar-fold" open={open}>
      <summary className="sidebar-fold-head">
        <IconChevronRight size={14} className="sidebar-fold-icon" />
        <span className="sidebar-fold-text">
          {labels.count(meetings.length)}
          <span className="sidebar-fold-when"> · {meetings[0].when}</span>
        </span>
        {awaiting && <span className="sidebar-dot" title={labels.awaiting} aria-label={labels.awaiting} />}
      </summary>
      <ul className="sidebar-meetings" aria-label={labels.list}>
        {meetings.map((meeting) => (
          <li key={meeting.id}>
            <Link
              className="sidebar-next"
              href={`/g/${group.slug}?at=meeting-${meeting.id}`}
              aria-label={[
                meeting.when,
                meeting.soon,
                meeting.about,
                meeting.invited > 0 ? goingText(meeting, labels) : null,
                meeting.awaiting ? labels.awaiting : null,
              ]
                .filter(Boolean)
                .join(", ")}
            >
              <span className="sidebar-next-when">
                {/* Ждёт твоего ответа — точка на месте значка часов, строка не растёт. */}
                {meeting.awaiting ? (
                  <span className="sidebar-dot-slot" aria-hidden="true">
                    <span className="sidebar-dot" />
                  </span>
                ) : (
                  <IconClock size={14} />
                )}
                {meeting.when}
                {meeting.soon && <span className="sidebar-soon">{meeting.soon}</span>}
              </span>
              {meeting.about && <span className="sidebar-next-about">{meeting.about}</span>}
              {meeting.invited > 0 && <span className="sidebar-next-going">{goingText(meeting, labels)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

function goingText(meeting: GroupNextMeeting, labels: MeetingLabels): string {
  return labels.going.replace("{n}", String(meeting.going)).replace("{total}", String(meeting.invited));
}
