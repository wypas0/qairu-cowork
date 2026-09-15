import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Board } from "@/components/Board";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { CopyButton } from "@/components/CopyButton";
import { MeetingForm } from "@/components/MeetingForm";
import { ScrollToAnchor } from "@/components/ScrollToAnchor";
import { TelegramAuth } from "@/components/TelegramAuth";
import { Topbar } from "@/components/Topbar";
import { fmtMinutes } from "@/core/intervals";
import { formatDM, weekdayOf } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { ROLE_ADMIN, displayName } from "@/db/schema";
import { LANG_NAMES, translator, weekdayName } from "@/i18n";
import { type AdminSource, adminSources } from "@/lib/admin";
import { currentUser } from "@/lib/auth";
import { durationOptions, loadGroupState, toBoardPayload } from "@/lib/group";
import { baseUrl } from "@/lib/url";
import {
  cancelMeetingAction,
  createMeetingAction,
  dismissNoticeAction,
  pingNonRespondersAction,
  remindFillAction,
  removeMemberAction,
  saveSettingsAction,
  setRoleAction,
  voteAction,
} from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  not_admin: "w_err_not_admin",
  throttled: "w_err_throttled",
  nobody_to_remind: "w_err_nobody",
  cannot_demote: "w_err_cannot_demote",
  cannot_remove: "w_err_cannot_remove",
  last_admin: "w_err_last_admin",
  empty_comment: "w_err_empty_comment",
};

const ANSWER_ICON: Record<string, string> = { yes: "✅", no: "❌", change: "✏️" };

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) notFound();

  const user = await currentUser();
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) {
    redirect(`/g/${slug}/join`);
  }

  const lang = chat.lang;
  const t = translator(lang);
  const state = await loadGroupState(chat);
  const payload = toBoardPayload(state, lang);
  const inviteUrl = `${await baseUrl()}/g/${slug}`;

  const roster = await repo.chatRoster(chat.chatId);
  const sources = await adminSources(chat, roster);
  const isAdmin = sources.has(user.userId);
  const notices = await repo.unreadNotices(chat.chatId, user.userId);
  const openMeetings = new Map(state.meetings.map((meeting) => [meeting.id, meeting]));

  const unfilledOthers = roster.filter(
    (entry) => !state.filledIds.has(entry.user.userId) && entry.user.userId !== user.userId,
  );

  const dayHeaders = state.grid.map((day) => ({
    short: weekdayName(lang, weekdayOf(day.day)).slice(0, 3),
    dm: formatDM(day.day),
  }));

  const sent = typeof query.sent === "string" ? /^(\d+)-(\d+)$/.exec(query.sent) : null;
  const errorKey = typeof query.err === "string" ? ERRORS[query.err] : undefined;
  const savedSettings = query.saved === "settings";

  const roleLabel = (source: AdminSource) =>
    source === "creator" ? t("w_role_creator") : source === "telegram" ? t("w_role_tg_admin") : t("w_role_admin");

  const noticeText = (notice: (typeof notices)[number]) => {
    const from = notice.fromUserId !== null ? state.names.get(notice.fromUserId) ?? "—" : "—";
    const meeting = notice.meetingId !== null ? openMeetings.get(notice.meetingId) : undefined;
    const goal = meeting?.goal || meeting?.whenText || notice.text || "—";
    if (notice.kind === "meeting") return t("w_notice_meeting", { name: from, goal });
    if (notice.kind === "meeting_change") {
      return t("w_notice_change", { name: from, goal, text: notice.text || "—" });
    }
    return t("w_notice_fill", { name: from });
  };

  return (
    <>
      <TelegramAuth slug={slug} authed />
      <ScrollToAnchor id={typeof query.at === "string" ? query.at : null} />
      <Topbar lang={lang}>
        <Link className="btn btn-sm" href={`/g/${slug}/me`}>
          {t("w_edit_mine")}
        </Link>
      </Topbar>

      <main className="wrap">
        <h1>{chat.title}</h1>

        {/* ============ сообщения о результате действия ============ */}
        {sent && (
          <div className="notice" role="status">
            {t("w_sent", { tg: sent[1], site: sent[2] })}
          </div>
        )}
        {errorKey && (
          <div className="notice warn" role="alert">
            {t(errorKey)}
          </div>
        )}
        {savedSettings && (
          <div className="notice" role="status">
            {t("w_saved_settings")}
          </div>
        )}

        {/* ============ уведомления этому человеку ============ */}
        {notices.map((notice) => (
          <div className="notice notice-row" key={notice.id}>
            <span>{noticeText(notice)}</span>
            <span className="notice-actions">
              {notice.kind === "fill_schedule" ? (
                <Link className="btn btn-sm btn-primary" href={`/g/${slug}/me`}>
                  {t("w_fill_now")}
                </Link>
              ) : (
                notice.meetingId !== null && (
                  <a className="btn btn-sm" href={`#meeting-${notice.meetingId}`}>
                    {t("w_notice_open")}
                  </a>
                )
              )}
              <form action={dismissNoticeAction.bind(null, slug, notice.id)}>
                <button className="btn btn-sm btn-quiet" type="submit">
                  {t("w_dismiss")}
                </button>
              </form>
            </span>
          </div>
        ))}

        {!state.filledIds.has(user.userId) && notices.every((n) => n.kind !== "fill_schedule") && (
          <div className="notice">
            {t("w_no_schedule_yet")}
            <Link
              className="btn btn-sm btn-primary"
              style={{ marginLeft: 8 }}
              href={`/g/${slug}/me`}
            >
              {t("w_fill_now")}
            </Link>
          </div>
        )}

        {/* ============ участники ============ */}
        <section className="card" id="members">
          <div className="card-head">
            <h2>
              {t("w_members")}{" "}
              <span className="small muted">
                {t("w_members_count", { filled: state.filledIds.size, n: roster.length })}
              </span>
            </h2>
            {isAdmin && unfilledOthers.length > 0 && (
              <form action={remindFillAction.bind(null, slug)}>
                <button className="btn btn-sm btn-primary" type="submit">
                  {t("w_remind_all", { n: unfilledOthers.length })}
                </button>
              </form>
            )}
          </div>
          {isAdmin && <p className="small muted">{t("w_admin_hint")}</p>}

          <ul className="roster">
            {roster.map((entry) => {
              const member = entry.user;
              const filled = state.filledIds.has(member.userId);
              const source = sources.get(member.userId);
              const self = member.userId === user.userId;
              const siteAdmin = entry.role === ROLE_ADMIN;
              return (
                <li className="roster-row" key={member.userId}>
                  <div className="roster-who">
                    <span className={`dot ${filled ? "ok" : "warn"}`} aria-hidden="true" />
                    <b>{displayName(member)}</b>
                    {member.realName && member.realName !== displayName(member) && (
                      <span className="small muted">{member.realName}</span>
                    )}
                    {self && <span className="small muted">({t("w_you")})</span>}
                    {source && <span className="badge">{roleLabel(source)}</span>}
                    <span className="small muted">
                      {filled ? t("w_filled") : t("w_not_filled")}
                    </span>
                  </div>

                  {isAdmin && !self && (
                    <div className="roster-actions">
                      {!filled && (
                        <form action={remindFillAction.bind(null, slug)}>
                          <input type="hidden" name="user_id" value={member.userId} />
                          <button className="btn btn-sm" type="submit">
                            {t("w_remind_one")}
                          </button>
                        </form>
                      )}
                      {source !== "creator" && source !== "telegram" && (
                        <form action={setRoleAction.bind(null, slug)}>
                          <input type="hidden" name="user_id" value={member.userId} />
                          <input
                            type="hidden"
                            name="role"
                            value={siteAdmin ? "member" : ROLE_ADMIN}
                          />
                          <button className="btn btn-sm btn-quiet" type="submit">
                            {siteAdmin ? t("w_remove_admin") : t("w_make_admin")}
                          </button>
                        </form>
                      )}
                      {source !== "creator" && source !== "telegram" && (
                        <form action={removeMemberAction.bind(null, slug)}>
                          <input type="hidden" name="user_id" value={member.userId} />
                          <ConfirmSubmit
                            className="btn btn-sm btn-quiet btn-danger"
                            confirm={t("w_remove_confirm", { name: displayName(member) })}
                          >
                            {t("w_remove_member")}
                          </ConfirmSubmit>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <h3 style={{ marginTop: 16 }}>{t("w_invite")}</h3>
          <p className="small muted">{t("w_invite_hint")}</p>
          <div className="row">
            <input type="text" readOnly value={inviteUrl} aria-label={t("w_invite")} />
            <CopyButton value={inviteUrl} label={t("w_copy")} copiedLabel={t("w_copied")} />
          </div>
        </section>

        <Board
          slug={slug}
          initial={payload}
          dayHeaders={dayHeaders}
          durationOptions={durationOptions(state.duration)}
          labels={{
            heatTitle: t("w_heat_title"),
            heatHint: t("w_heat_hint"),
            legendNone: t("w_legend_none"),
            legendAll: t("w_legend_all"),
            windowsTitle: t("w_windows_title"),
            windowsEmpty: t("w_windows_empty"),
            windowsNoData: t("w_windows_nodata"),
            missingShort: t("w_missing_short"),
            pick: t("w_pick"),
            day: t("w_day"),
            duration: t("w_duration"),
            durationTemplate: t("w_duration_hm", { h: "{h}", m: "{m}" }),
            hoursOnlyTemplate: t("w_duration_h", { h: "{h}" }),
            minutesTemplate: t("w_duration_m", { m: "{m}" }),
            variantsTemplate: t("w_variants", { n: "{n}" }),
            quorumTemplate: t("w_quorum_label", { q: "{q}", n: "{n}" }),
            close: t("w_close"),
          }}
        />

        <div className="grid-2">
          {/* ============ встречи ============ */}
          <section className="card">
            <h2>{t("w_meetings")}</h2>

            {state.meetings.length === 0 && <p className="muted small">—</p>}

            {state.meetings.map((meeting) => {
              const answers = state.responses.get(meeting.id) ?? [];
              const byUser = new Map(answers.map((answer) => [answer.userId, answer]));
              const invitees = repo.inviteeIds(meeting);
              const waiting = invitees.filter((id) => !byUser.has(id));
              const count = (value: string) => answers.filter((a) => a.answer === value).length;
              const cancelled = meeting.status === "cancelled";
              const mine = byUser.get(user.userId);
              const canManage = meeting.initiatorId === user.userId || isAdmin;
              const invited = invitees.includes(user.userId);

              return (
                <div
                  className={`meeting${cancelled ? " cancelled" : ""}`}
                  key={meeting.id}
                  id={`meeting-${meeting.id}`}
                >
                  <div className="mtitle">
                    <b>{meeting.goal || t("w_new_meeting")}</b>
                  </div>
                  <div className="small muted">
                    📍 {meeting.place || "—"} · 🕒 {meeting.whenText || "—"} · 👤{" "}
                    {state.names.get(meeting.initiatorId) ?? "—"}
                  </div>

                  {cancelled ? (
                    <p className="small muted" style={{ marginTop: 8 }}>
                      {t("w_cancelled")}
                    </p>
                  ) : (
                    <>
                      <div className="small" style={{ marginTop: 8 }}>
                        ✅ {count("yes")} · ❌ {count("no")} · ✏️ {count("change")} · ⏳{" "}
                        {waiting.length}
                      </div>

                      <details className="responses" open={invitees.length <= 8}>
                        <summary className="small">{t("w_responses")}</summary>
                        <ul>
                          {invitees.map((id) => {
                            const answer = byUser.get(id);
                            return (
                              <li key={id} className="small">
                                <span aria-hidden="true">
                                  {answer ? ANSWER_ICON[answer.answer] ?? "•" : "⏳"}
                                </span>{" "}
                                <b>{state.names.get(id) ?? "?"}</b>{" "}
                                <span className="muted">
                                  {answer ? t(`w_answer_${answer.answer}`) : t("w_answer_wait")}
                                  {id === meeting.initiatorId ? ` · ${t("w_initiator")}` : ""}
                                </span>
                                {answer?.comment && (
                                  <div className="muted response-comment">💬 {answer.comment}</div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </details>

                      {invited && (
                        <>
                          {mine && (
                            <p className="small" style={{ margin: "8px 0 0" }}>
                              {t("w_your_answer", { answer: t(`w_answer_${mine.answer}`) })}
                            </p>
                          )}
                          <div className="votes">
                            {(
                              [
                                ["yes", t("w_yes")],
                                ["no", t("w_no")],
                              ] as const
                            ).map(([value, label]) => (
                              <form key={value} action={voteAction.bind(null, slug, meeting.id)}>
                                <input type="hidden" name="answer" value={value} />
                                <button
                                  className={`btn btn-sm${mine?.answer === value ? " btn-primary" : ""}`}
                                  type="submit"
                                  aria-pressed={mine?.answer === value}
                                >
                                  {label}
                                </button>
                              </form>
                            ))}
                            {meeting.whenStart && (
                              <a
                                className="btn btn-sm"
                                href={`/g/${slug}/meetings/${meeting.id}.ics`}
                              >
                                {t("w_ics")}
                              </a>
                            )}
                          </div>

                          <form
                            action={voteAction.bind(null, slug, meeting.id)}
                            className="change-form"
                          >
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
                        </>
                      )}

                      {canManage && (
                        <div className="votes">
                          {waiting.filter((id) => id !== user.userId).length > 0 && (
                            <form action={pingNonRespondersAction.bind(null, slug, meeting.id)}>
                              <button className="btn btn-sm" type="submit">
                                {t("w_ping", {
                                  n: waiting.filter((id) => id !== user.userId).length,
                                })}
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
                </div>
              );
            })}

            <MeetingForm
              action={createMeetingAction.bind(null, slug)}
              labels={{
                newMeeting: t("w_new_meeting"),
                place: t("w_place"),
                placePh: t("w_place_ph"),
                goal: t("w_goal"),
                goalPh: t("w_goal_ph"),
                when: t("w_when"),
                whenHint: t("w_when_hint"),
                create: t("w_create_meeting"),
              }}
            />
          </section>

          {/* ============ настройки ============ */}
          <section className="card">
            <h2>{t("w_settings")}</h2>
            {!isAdmin ? (
              <>
                <p className="small muted">{t("w_settings_admin_only")}</p>
                <ul className="settings-summary small">
                  <li>
                    {t("w_hours")}: {fmtMinutes(chat.dayStartMin)}–{fmtMinutes(chat.dayEndMin)}
                  </li>
                  <li>
                    {t("w_min_slot")}: {chat.minSlotMin} {t("w_minutes_short")}
                  </li>
                  <li>
                    {t("w_buffer")}: {chat.travelBufferMin}
                  </li>
                  <li>
                    {t("w_semester")}: {chat.semesterStart ?? "—"}
                  </li>
                </ul>
              </>
            ) : (
              <form action={saveSettingsAction.bind(null, slug)}>
                <div className="row">
                  <div className="field">
                    <label htmlFor="day_start">{t("w_hours")}</label>
                    <input
                      id="day_start"
                      name="day_start"
                      type="text"
                      defaultValue={fmtMinutes(chat.dayStartMin)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="day_end">&nbsp;</label>
                    <input
                      id="day_end"
                      name="day_end"
                      type="text"
                      defaultValue={fmtMinutes(chat.dayEndMin)}
                    />
                  </div>
                </div>
                <div className="row">
                  <div className="field">
                    <label htmlFor="min_slot">{t("w_min_slot")}</label>
                    <input
                      id="min_slot"
                      name="min_slot"
                      type="number"
                      min={15}
                      max={720}
                      defaultValue={chat.minSlotMin}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="buffer">{t("w_buffer")}</label>
                    <input
                      id="buffer"
                      name="buffer"
                      type="number"
                      min={0}
                      max={120}
                      defaultValue={chat.travelBufferMin}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="semester">{t("w_semester")}</label>
                  <input
                    id="semester"
                    name="semester"
                    type="date"
                    defaultValue={chat.semesterStart ?? ""}
                  />
                  <p className="small muted" style={{ marginTop: 5 }}>
                    {t("w_semester_hint")}
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="lang-select">{t("w_lang")}</label>
                  <select id="lang-select" name="lang" defaultValue={chat.lang}>
                    {Object.entries(LANG_NAMES).map(([code, title]) => (
                      <option key={code} value={code}>
                        {title}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn" type="submit">
                  {t("w_save_settings")}
                </button>
              </form>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
