import {
  cancelMeetingAction,
  pingNonRespondersAction,
  voteAction,
} from "@/app/g/[slug]/actions";
import type { Meeting, MeetingResponse } from "@/db/schema";
import { translator } from "@/i18n";
import { meetingSpan } from "@/lib/group";
import { ConfirmSubmit } from "./ConfirmSubmit";
import {
  IconClock,
  IconComment,
  IconEdit,
  IconMeeting,
  IconNo,
  IconPlace,
  IconUser,
  IconWaiting,
  IconYes,
} from "./icons";

/** Ответы, которые может дать участник. «change» — это комментарий, а не явка. */
const ANSWERS = ["yes", "maybe", "no"] as const;

/** Первая буква имени — метка человека там, где фото не нужно. */
function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/**
 * Ссылка «добавить в Google Календарь». Файл .ics понимают не все телефоны
 * сходу, а эта ссылка открывает готовое событие в один тап.
 */
function googleCalendarUrl(meeting: Meeting, tz: string): string | null {
  const span = meetingSpan(meeting, tz);
  if (!meeting.whenStart || !span) return null;
  const end = new Date(meeting.whenStart.getTime() + (span.end - span.start) * 60_000);
  const stamp = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: meeting.goal || meeting.whenText,
    dates: `${stamp(meeting.whenStart)}/${stamp(end)}`,
  });
  if (meeting.place) params.set("location", meeting.place);
  return `https://calendar.google.com/calendar/render?${params}`;
}

/**
 * Карточка встречи: кто идёт, кто нет, кто ещё молчит — и три кнопки ответа.
 *
 * Счётчики вида «✅ 2 · ❌ 1 · ⏳ 4» приходилось расшифровывать, поэтому здесь
 * имена видно сразу: каждая группа — строка с кружками-инициалами. Ответ
 * «может» существует, потому что в жизни он самый частый, а без него человек
 * либо врёт «приду», либо не отвечает вовсе.
 */
export function MeetingCard({
  slug,
  lang,
  tz,
  meeting,
  answers,
  names,
  invitees,
  viewerId,
  canManage,
  past = false,
}: {
  slug: string;
  lang: string;
  tz: string;
  meeting: Meeting;
  answers: MeetingResponse[];
  names: Map<number, string>;
  invitees: number[];
  viewerId: number;
  canManage: boolean;
  past?: boolean;
}) {
  const t = translator(lang);
  const byUser = new Map(answers.map((answer) => [answer.userId, answer]));
  const cancelled = meeting.status === "cancelled";
  const mine = byUser.get(viewerId);
  const invited = invitees.includes(viewerId);
  const waiting = invitees.filter((id) => !byUser.has(id));
  const gcal = googleCalendarUrl(meeting, tz);

  const groups = [
    { key: "yes", label: t("w_going"), Icon: IconYes, ids: invitees.filter((id) => byUser.get(id)?.answer === "yes") },
    { key: "maybe", label: t("w_going_maybe"), Icon: IconWaiting, ids: invitees.filter((id) => byUser.get(id)?.answer === "maybe") },
    { key: "no", label: t("w_not_going"), Icon: IconNo, ids: invitees.filter((id) => byUser.get(id)?.answer === "no") },
    { key: "change", label: t("w_change"), Icon: IconEdit, ids: invitees.filter((id) => byUser.get(id)?.answer === "change") },
    { key: "wait", label: t("w_waiting_answer"), Icon: IconWaiting, ids: waiting },
  ].filter((group) => group.ids.length > 0);

  const comments = invitees
    .map((id) => ({ id, answer: byUser.get(id) }))
    .filter((entry) => entry.answer?.comment);

  return (
    <article className={`meeting${cancelled ? " cancelled" : ""}`} id={`meeting-${meeting.id}`}>
      <div className="meeting-title">
        <b className="mtitle">{meeting.goal || t("w_new_meeting")}</b>
        {cancelled && <span className="badge">{t("w_cancelled")}</span>}
        {!cancelled && past && <span className="badge">{t("w_meeting_past")}</span>}
      </div>

      <div className="small muted meeting-meta">
        <span>
          <IconPlace /> {meeting.place || "—"}
        </span>
        <span>
          <IconClock /> {meeting.whenText || "—"}
        </span>
        <span>
          <IconUser /> {names.get(meeting.initiatorId) ?? "—"}
        </span>
      </div>

      {!cancelled && (
        <>
          <div className="answers">
            {groups.map((group) => (
              <div className={`answer-group group-${group.key}`} key={group.key}>
                <span className={`answer-label answer-${group.key}`}>
                  <group.Icon /> {group.label} {group.ids.length}
                </span>
                <span className="marks">
                  {group.ids.map((id) => (
                    <span className="mark" key={id} title={names.get(id) ?? "?"}>
                      {initial(names.get(id) ?? "?")}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>

          {comments.length > 0 && (
            <ul className="comments small">
              {comments.map((entry) => (
                <li key={entry.id}>
                  <IconComment /> <b>{names.get(entry.id) ?? "?"}</b>{" "}
                  <span className="muted">{entry.answer!.comment}</span>
                </li>
              ))}
            </ul>
          )}

          {invited && !past && (
            <>
              <div className="votes">
                {ANSWERS.map((value) => (
                  <form key={value} action={voteAction.bind(null, slug, meeting.id)}>
                    <input type="hidden" name="answer" value={value} />
                    <button
                      className={`daychip${mine?.answer === value ? " active" : ""}`}
                      type="submit"
                      aria-pressed={mine?.answer === value}
                    >
                      {value === "yes" ? t("w_yes") : value === "maybe" ? t("w_maybe") : t("w_no")}
                    </button>
                  </form>
                ))}
                {meeting.whenStart && (
                  <a className="btn btn-sm" href={`/g/${slug}/meetings/${meeting.id}.ics`}>
                    <IconMeeting /> {t("w_ics")}
                  </a>
                )}
                {gcal && (
                  <a className="btn btn-sm" href={gcal} target="_blank" rel="noreferrer">
                    {t("w_gcal")}
                  </a>
                )}
              </div>

              <details className="change-details">
                <summary className="small">{t("w_change_open")}</summary>
                <form action={voteAction.bind(null, slug, meeting.id)} className="change-form">
                  <input type="hidden" name="answer" value="change" />
                  <input
                    type="text"
                    name="comment"
                    maxLength={300}
                    required
                    placeholder={t("w_comment_ph")}
                    aria-label={t("w_comment_ph")}
                  />
                  <button className="btn btn-sm" type="submit">
                    {t("w_change")}
                  </button>
                </form>
              </details>
            </>
          )}

          {canManage && !past && (
            <div className="votes">
              {waiting.filter((id) => id !== viewerId).length > 0 && (
                <form action={pingNonRespondersAction.bind(null, slug, meeting.id)}>
                  <button className="btn btn-sm" type="submit">
                    {t("w_ping", { n: waiting.filter((id) => id !== viewerId).length })}
                  </button>
                </form>
              )}
              <form action={cancelMeetingAction.bind(null, slug, meeting.id)}>
                <ConfirmSubmit
                  className="btn btn-sm btn-quiet btn-danger"
                  confirm={t("w_cancel_confirm")}
                >
                  {t("w_cancel_meeting")}
                </ConfirmSubmit>
              </form>
            </div>
          )}
        </>
      )}
    </article>
  );
}
