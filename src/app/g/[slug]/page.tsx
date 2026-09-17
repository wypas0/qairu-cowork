import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { Board } from "@/components/Board";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { GroupTabs, type GroupTabKey } from "@/components/GroupTabs";
import { CopyButton } from "@/components/CopyButton";
import { MeetingCard } from "@/components/MeetingCard";
import { MeetingForm } from "@/components/MeetingForm";
import { ScrollToAnchor } from "@/components/ScrollToAnchor";
import { StartChecklist } from "@/components/StartChecklist";
import { fmtMinutes } from "@/core/intervals";
import { chatTz } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { ROLE_ADMIN, displayName } from "@/db/schema";
import { LANG_NAMES, translator } from "@/i18n";
import { type AdminSource, adminSources } from "@/lib/admin";
import { pageUser } from "@/lib/gate";
import { durationOptions, loadGroupState, normalizeWeek, toBoardPayload } from "@/lib/group";
import { formatCode } from "@/lib/invite";
import { baseUrl } from "@/lib/url";
import {
  cancelMeetingAction,
  changeCodeAction,
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

  const user = await pageUser(`/g/${slug}`);
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) {
    redirect(`/g/${slug}/join`);
  }

  const lang = chat.lang;
  const t = translator(lang);
  const state = await loadGroupState(chat, { week: normalizeWeek(query.week) });
  const payload = toBoardPayload(state, lang, user.userId);
  const inviteUrl = `${await baseUrl()}/g/${slug}`;

  const roster = await repo.chatRoster(chat.chatId);
  const sources = await adminSources(chat, roster);
  const isAdmin = sources.has(user.userId);
  const notices = await repo.unreadNotices(chat.chatId, user.userId);
  const openMeetings = new Map(state.meetings.map((meeting) => [meeting.id, meeting]));

  // Встреча уходит в архив, когда началась: голосовать за прошедшее нечего.
  const startedAlready = (meeting: (typeof state.meetings)[number]) =>
    meeting.status === "cancelled" || (meeting.whenStart !== null && meeting.whenStart.getTime() < Date.now());
  const upcomingMeetings = state.meetings.filter((meeting) => !startedAlready(meeting));
  const archivedMeetings = state.meetings.filter(startedAlready);

  const unfilledOthers = roster.filter(
    (entry) => !state.filledIds.has(entry.user.userId) && entry.user.userId !== user.userId,
  );

  const sent = typeof query.sent === "string" ? /^(\d+)-(\d+)$/.exec(query.sent) : null;
  const errorKey = typeof query.err === "string" ? ERRORS[query.err] : undefined;
  const savedSettings = query.saved === "settings";

  // Серверные действия возвращают человека с параметром `at` — по нему
  // открываем тот же раздел, из которого он ушёл.
  const at = typeof query.at === "string" ? query.at : "";
  const initialTab: GroupTabKey = at.startsWith("meeting-")
    ? "meetings"
    : at === "members"
      ? "members"
      : savedSettings
        ? "settings"
        : "time";

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
      <ScrollToAnchor id={typeof query.at === "string" ? query.at : null} />
      <AppShell lang={lang} slug={slug} title={chat.title} section="group">
      <main className="wrap">
        {/* «Моё расписание» живёт в навигации — сайдбаре и нижней панели,
            поэтому в заголовке кнопку не дублируем. */}
        <header className="page-head">
          <div>
            <p className="eyebrow">{t("w_eyebrow_group")}</p>
            <h1>{chat.title}</h1>
          </div>
        </header>

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
        {query.code === "changed" && (
          <div className="notice" role="status">
            {t("w_code_changed")}
          </div>
        )}

        {/* ============ уведомления этому человеку ============ */}
        {notices.map((notice) => (
          <div className="notice notice-row" key={notice.id}>
            <span>{noticeText(notice)}</span>
            <span className="notice-actions">
              {notice.kind === "fill_schedule" ? (
                <Link className="btn btn-sm" href={`/g/${slug}/me`}>
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

        <StartChecklist
          slug={slug}
          lang={lang}
          inviteUrl={inviteUrl}
          scheduleFilled={state.filledIds.has(user.userId)}
          hasOthers={roster.length > 1}
          hasMeetings={state.meetings.length > 0}
        />

        <GroupTabs
          initial={initialTab}
          labels={{
            time: t("w_tab_time"),
            meetings: t("w_tab_meetings"),
            members: t("w_tab_members"),
            settings: t("w_tab_settings"),
          }}
          panels={{
            time: (
              <>
                <Board
                  slug={slug}
                  initial={payload}
                  durationOptions={durationOptions(state.duration)}
                  labels={{
                    bestTitle: t("w_best_title"),
                    bestLead: t("w_best_lead"),
                    bestEmpty: t("w_best_empty"),
                    bestAll: t("w_best_all"),
                    bestCount: t("w_best_count", { n: "{n}", total: "{total}" }),
                    weekPrev: t("w_week_prev"),
                    weekNext: t("w_week_next"),
                    weekThis: t("w_week_this"),
                    quorumAll: t("w_quorum_all"),
                    quorumMinusOne: t("w_quorum_minus_one"),
                    quorumMost: t("w_quorum_most"),
                    heatTitle: t("w_heat_title"),
                    heatHint: t("w_heat_hint"),
                    breakRow: t("w_break_row", { m: "{m}" }),
                    legendNone: t("w_legend_none"),
                    legendAll: t("w_legend_all"),
                    legendMeeting: t("w_legend_meeting"),
                    legendMine: t("w_legend_mine"),
                    freeNames: t("w_free_names"),
                    busyNames: t("w_busy_names"),
                    nobody: t("w_nobody"),
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
              </>
            ),
            meetings: (
              <>
                <section className="card">
                  <h2>{t("w_meetings")}</h2>

                  {upcomingMeetings.length === 0 && (
                    <div className="empty">
                      <h3>{t("w_meetings_empty")}</h3>
                      <p>{t("w_meetings_empty_hint")}</p>
                    </div>
                  )}

                  {upcomingMeetings.map((meeting) => (
                    <MeetingCard
                      key={meeting.id}
                      slug={slug}
                      lang={lang}
                      tz={chatTz(chat)}
                      meeting={meeting}
                      answers={state.responses.get(meeting.id) ?? []}
                      names={state.names}
                      invitees={repo.inviteeIds(meeting)}
                      viewerId={user.userId}
                      canManage={meeting.initiatorId === user.userId || isAdmin}
                    />
                  ))}

                  {/* Прошедшие и отменённые не мешают отвечать на ближайшие. */}
                  {archivedMeetings.length > 0 && (
                    <details className="past-meetings">
                      <summary className="small muted">
                        {t("w_past_meetings", { n: archivedMeetings.length })}
                      </summary>
                      {archivedMeetings.map((meeting) => (
                        <MeetingCard
                          key={meeting.id}
                          slug={slug}
                          lang={lang}
                          tz={chatTz(chat)}
                          meeting={meeting}
                          answers={state.responses.get(meeting.id) ?? []}
                          names={state.names}
                          invitees={repo.inviteeIds(meeting)}
                          viewerId={user.userId}
                          canManage={false}
                          past
                        />
                      ))}
                    </details>
                  )}

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
              </>
            ),
            members: (
              <>
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
                        <button className="btn btn-sm" type="submit">
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

                  <h3 style={{ marginTop: 16 }}>{t("w_code_title")}</h3>
                  <div className="invite-code">
                    <b className="code">{formatCode(slug)}</b>
                    <CopyButton
                      value={formatCode(slug)}
                      label={t("w_copy")}
                      copiedLabel={t("w_copied")}
                      small
                    />
                    {isAdmin && (
                      <form action={changeCodeAction.bind(null, slug)}>
                        <ConfirmSubmit
                          className="btn btn-sm btn-quiet"
                          confirm={t("w_code_change_confirm")}
                        >
                          {t("w_code_change")}
                        </ConfirmSubmit>
                      </form>
                    )}
                  </div>
                  <p className="small muted">{t("w_code_hint")}</p>

                  <h3 style={{ marginTop: 16 }}>{t("w_invite")}</h3>
                  <p className="small muted">{t("w_invite_hint")}</p>
                  <div className="row">
                    <input type="text" readOnly value={inviteUrl} aria-label={t("w_invite")} />
                    <CopyButton value={inviteUrl} label={t("w_copy")} copiedLabel={t("w_copied")} />
                  </div>
                </section>
              </>
            ),
            settings: (
              <>
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
              </>
            ),
          }}
        />
      </main>
      </AppShell>
    </>
  );
}
