import {
  cancelMeetingAction,
  markAttendanceAction,
  pingNonRespondersAction,
  saveSummaryAction,
  voteAction,
} from "@/app/g/[slug]/actions";
import {
  answerPairMeetingAction,
  cancelPairMeetingAction,
  pingPairMeetingAction,
} from "@/app/friends/actions";
import type { Meeting, MeetingResponse } from "@/db/schema";
import { translator } from "@/i18n";
import { nextOccurrence, weeklyRule } from "@/core/recurrence";
import { type DateStr, formatDM, startsSoon, utcToZonedWall, weekdayOf } from "@/core/timeutils";
import { weekdayShort } from "@/i18n";
import { fmtMinutes } from "@/core/intervals";
import { meetingDurationMin, meetingSpan, whenTextFor } from "@/lib/group";
import { ConfirmSubmit } from "./ConfirmSubmit";
// Две буквы, а не одна: Амир и Асель на встрече вдвоём иначе оба «А».
import { initials } from "./friends/initials";
import { RepeatMeetingButton } from "./RepeatMeetingButton";
import { repeatDetail } from "@/lib/repeat";
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

/**
 * Ссылка «добавить в Google Календарь». Файл .ics понимают не все телефоны
 * сходу, а эта ссылка открывает готовое событие в один тап.
 */
function googleCalendarUrl(meeting: Meeting, tz: string): string | null {
  if (!meeting.whenStart) return null;
  const end = new Date(meeting.whenStart.getTime() + meetingDurationMin(meeting, tz) * 60_000);
  const stamp = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: meeting.goal || meeting.whenText,
    dates: `${stamp(meeting.whenStart)}/${stamp(end)}`,
  });
  if (meeting.place) params.set("location", meeting.place);
  // Серия — одно повторяющееся событие в календаре, а не одна встреча.
  if (meeting.repeatUntil) params.set("recur", `RRULE:${weeklyRule(meeting.repeatUntil as DateStr, tz)}`);
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** Где живёт встреча: в группе (её код) или вдвоём с другом (его id) — от этого её действия и файл .ics. */
export type MeetingTarget = { slug: string } | { friendId: number };

/** Действия карточки для группы или для встречи вдвоём — разметка у них одна. */
function actionsFor(target: MeetingTarget, meetingId: number) {
  if ("slug" in target) {
    return {
      vote: voteAction.bind(null, target.slug, meetingId),
      ping: pingNonRespondersAction.bind(null, target.slug, meetingId),
      cancel: cancelMeetingAction.bind(null, target.slug, meetingId),
      ics: `/g/${target.slug}/meetings/${meetingId}.ics`,
    };
  }
  return {
    vote: answerPairMeetingAction.bind(null, target.friendId, meetingId),
    ping: pingPairMeetingAction.bind(null, target.friendId, meetingId),
    cancel: cancelPairMeetingAction.bind(null, target.friendId, meetingId),
    ics: `/friends/${target.friendId}/meetings/${meetingId}.ics`,
  };
}

/**
 * Карточка встречи: кто идёт, кто нет, кто ещё молчит — и три кнопки ответа.
 *
 * Счётчики вида «✅ 2 · ❌ 1 · ⏳ 4» приходилось расшифровывать, поэтому здесь
 * имена видно сразу: каждая группа — строка с кружками-инициалами. Ответ
 * «может» существует, потому что в жизни он самый частый, а без него человек
 * либо врёт «приду», либо не отвечает вовсе.
 *
 * Одна и та же карточка — у встреч группы и у встреч вдвоём на карточке
 * друга (`target`); итоги и «кто был» — только у группы.
 */
export function MeetingCard({
  target,
  lang,
  tz,
  meeting,
  answers,
  names,
  invitees,
  viewerId,
  canManage,
  canSummarize = false,
  past = false,
  attendance = null,
}: {
  target: MeetingTarget;
  lang: string;
  tz: string;
  meeting: Meeting;
  answers: MeetingResponse[];
  names: Map<number, string>;
  invitees: number[];
  viewerId: number;
  canManage: boolean;
  /** Может записать итоги: приглашён, создал встречу или староста. */
  canSummarize?: boolean;
  past?: boolean;
  /** Кто был на последнем прошедшем повторе (только у прошедших встреч). */
  attendance?: { attended: number[]; missed: number[]; mine: boolean | null } | null;
}) {
  const t = translator(lang);
  const actions = actionsFor(target, meeting.id);
  const byUser = new Map(answers.map((answer) => [answer.userId, answer]));
  const cancelled = meeting.status === "cancelled";
  const mine = byUser.get(viewerId);
  const invited = invitees.includes(viewerId);
  const waiting = invitees.filter((id) => !byUser.has(id));
  const gcal = googleCalendarUrl(meeting, tz);
  // «через 2 ч» у встречи, до которой меньше суток; у серии — до ближайшего повтора.
  const now = new Date();
  const nextStart =
    meeting.whenStart && meeting.repeatUntil
      ? nextOccurrence(meeting.whenStart, meeting.repeatUntil as DateStr, tz, now)
      : meeting.whenStart;
  const soon = !cancelled && !past && nextStart ? startsSoon(nextStart, now) : null;

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
        {soon && (
          <span className="badge soon">
            {t(soon.unit === "min" ? "w_in_minutes" : "w_in_hours", { n: soon.n })}
          </span>
        )}
      </div>

      <div className="small muted meeting-meta">
        <span>
          <IconPlace /> {meeting.place || "—"}
        </span>
        <span>
          <IconClock /> {whenLabel(meeting, tz, lang, t) || "—"}
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
                      {initials(names.get(id) ?? "?")}
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
                  <form key={value} action={actions.vote}>
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
                  <a className="btn btn-sm" href={actions.ics}>
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
                <form action={actions.vote} className="change-form">
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
                <form action={actions.ping}>
                  <button className="btn btn-sm" type="submit">
                    {t("w_ping", { n: waiting.filter((id) => id !== viewerId).length })}
                  </button>
                </form>
              )}
              <form action={actions.cancel}>
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
      {/* Прошедшая встреча: итоги и «повторить». Для отменённой — только повтор. */}
      {past && (
        <div className="meeting-after">
          {/* Кто дошёл: отвечают в боте после встречи или здесь. */}
          {!cancelled && attendance && (
            <div className="attendance">
              <b className="small">
                {t("w_attend_title", { n: attendance.attended.length, total: invitees.length })}
              </b>
              {(attendance.attended.length > 0 || attendance.missed.length > 0) && (
                <p className="small muted">
                  {attendance.attended.length > 0 &&
                    t("w_attend_were", { names: attendance.attended.map((id) => names.get(id) ?? "—").join(", ") })}
                  {attendance.attended.length > 0 && attendance.missed.length > 0 && " · "}
                  {attendance.missed.length > 0 &&
                    t("w_attend_missed", { names: attendance.missed.map((id) => names.get(id) ?? "—").join(", ") })}
                </p>
              )}
              {invited && "slug" in target && (
                <div className="votes">
                  {([true, false] as const).map((value) => (
                    <form key={String(value)} action={markAttendanceAction.bind(null, target.slug, meeting.id, value)}>
                      <button
                        className={`daychip${attendance.mine === value ? " active" : ""}`}
                        type="submit"
                        aria-pressed={attendance.mine === value}
                      >
                        {value ? t("w_attend_yes") : t("w_attend_no")}
                      </button>
                    </form>
                  ))}
                </div>
              )}
            </div>
          )}
          {!cancelled && (meeting.summary || canSummarize) && (
            <div className="summary">
              <b className="small">{t("w_summary_title")}</b>
              {meeting.summary && (
                <>
                  <p className="summary-text">{meeting.summary}</p>
                  {meeting.summaryBy !== null && meeting.summaryAt && (
                    <p className="small muted summary-by">
                      {t("w_summary_by", {
                        name: names.get(meeting.summaryBy) ?? "—",
                        date: formatDM(utcToZonedWall(meeting.summaryAt, tz).day),
                      })}
                    </p>
                  )}
                </>
              )}
              {canSummarize && "slug" in target && (
                <details className="summary-edit" open={!meeting.summary}>
                  {meeting.summary && <summary className="small">{t("w_summary_edit")}</summary>}
                  <form action={saveSummaryAction.bind(null, target.slug, meeting.id)} className="summary-form">
                    <textarea
                      name="summary"
                      rows={3}
                      maxLength={2000}
                      defaultValue={meeting.summary}
                      placeholder={t("w_summary_ph")}
                      aria-label={t("w_summary_title")}
                    />
                    <button className="btn btn-sm" type="submit">
                      {t("w_summary_save")}
                    </button>
                  </form>
                </details>
              )}
            </div>
          )}
          <div className="votes">
            <RepeatMeetingButton detail={repeatDetail(meeting, tz, lang, now)} label={t("w_repeat_meeting")} />
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * Когда встреча — так, как её надо читать. Для разовой это текст времени из
 * формы. Для серии текст хранит только первую дату, поэтому собираем
 * «каждую неделю: ср 15:00–16:30, до 16.12».
 */
function whenLabel(
  meeting: Meeting,
  tz: string,
  lang: string,
  t: ReturnType<typeof translator>,
): string {
  const span = meeting.repeatUntil ? meetingSpan(meeting, tz) : null;
  // Встреча вдвоём — на языке того, кто смотрит: текст сохранён на языке создателя.
  if (!span || !meeting.whenStart) return whenTextFor(meeting, lang, tz);
  const day = utcToZonedWall(meeting.whenStart, tz).day;
  return t("w_repeat_meta", {
    day: weekdayShort(lang, weekdayOf(day)),
    time: `${fmtMinutes(span.start)}–${fmtMinutes(span.end)}`,
    until: formatDM(meeting.repeatUntil as DateStr),
  });
}
