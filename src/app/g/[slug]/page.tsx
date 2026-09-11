import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Board } from "@/components/Board";
import { CopyButton } from "@/components/CopyButton";
import { MeetingForm } from "@/components/MeetingForm";
import { TelegramAuth } from "@/components/TelegramAuth";
import { Topbar } from "@/components/Topbar";
import { fmtMinutes } from "@/core/intervals";
import { formatDM, weekdayOf } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { LANG_NAMES, translator, weekdayName } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { loadGroupState, toBoardPayload } from "@/lib/group";
import { baseUrl } from "@/lib/url";
import { cancelMeetingAction, createMeetingAction, saveSettingsAction, voteAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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

  const dayHeaders = state.grid.map((day) => ({
    short: weekdayName(lang, weekdayOf(day.day)).slice(0, 3),
    dm: formatDM(day.day),
  }));

  return (
    <>
      <TelegramAuth slug={slug} authed />
      <Topbar lang={lang}>
        <Link className="btn btn-sm" href={`/g/${slug}/me`}>
          {t("w_edit_mine")}
        </Link>
      </Topbar>

      <main className="wrap">
        <h1>{chat.title}</h1>

        {!state.filledIds.has(user.userId) && (
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

        <Board
          slug={slug}
          initial={payload}
          dayHeaders={dayHeaders}
          initialQuorum={state.result.quorum}
          initialMinSlot={state.minSlot}
          labels={{
            heatTitle: t("w_heat_title"),
            heatHint: t("w_heat_hint"),
            legendNone: t("w_legend_none"),
            legendAll: t("w_legend_all"),
            windowsTitle: t("w_windows_title"),
            windowsEmpty: t("w_windows_empty"),
            missingShort: t("w_missing_short"),
            pick: t("w_pick"),
            minSlot: t("w_min_slot"),
            minutesShort: t("w_minutes_short"),
            quorumTemplate: t("w_quorum_label", { q: "{q}", n: "{n}" }),
          }}
        />

        <div className="grid-2">
          {/* ============ встречи ============ */}
          <section className="card">
            <h2>{t("w_meetings")}</h2>

            {state.meetings.length === 0 && <p className="muted small">—</p>}

            {state.meetings.map((meeting) => {
              const answers = state.responses.get(meeting.id) ?? [];
              const yes = answers.filter((a) => a.answer === "yes").length;
              const no = answers.filter((a) => a.answer === "no").length;
              const change = answers.filter((a) => a.answer === "change").length;
              const cancelled = meeting.status === "cancelled";

              return (
                <div className={`meeting${cancelled ? " cancelled" : ""}`} key={meeting.id}>
                  <div className="mtitle">
                    <b>{meeting.goal || t("w_new_meeting")}</b>
                  </div>
                  <div className="small muted">
                    📍 {meeting.place || "—"} · 🕒 {meeting.whenText || "—"}
                  </div>

                  {cancelled ? (
                    <p className="small muted" style={{ marginTop: 8 }}>
                      {t("w_cancelled")}
                    </p>
                  ) : (
                    <>
                      <div className="small" style={{ marginTop: 8 }}>
                        ✅ {yes} · ❌ {no} · ✏️ {change}
                      </div>
                      {answers
                        .filter((answer) => answer.comment)
                        .map((answer) => (
                          <div className="small muted" key={answer.userId}>
                            💬 {state.names.get(answer.userId) ?? "?"}: {answer.comment}
                          </div>
                        ))}

                      <div className="votes">
                        {(
                          [
                            ["yes", t("w_yes")],
                            ["no", t("w_no")],
                          ] as const
                        ).map(([value, label]) => (
                          <form key={value} action={voteAction.bind(null, slug, meeting.id)}>
                            <input type="hidden" name="answer" value={value} />
                            <button className="btn btn-sm" type="submit">
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
                        {meeting.initiatorId === user.userId && (
                          <form action={cancelMeetingAction.bind(null, slug, meeting.id)}>
                            <button className="btn btn-sm btn-quiet btn-danger" type="submit">
                              {t("w_cancel_meeting")}
                            </button>
                          </form>
                        )}
                      </div>

                      <form
                        action={voteAction.bind(null, slug, meeting.id)}
                        style={{ marginTop: 8, display: "flex", gap: 6 }}
                      >
                        <input type="hidden" name="answer" value="change" />
                        <input
                          type="text"
                          name="comment"
                          maxLength={300}
                          placeholder={t("w_comment_ph")}
                          style={{ minWidth: 0 }}
                        />
                        <button className="btn btn-sm" type="submit">
                          {t("w_change")}
                        </button>
                      </form>
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

          {/* ============ участники, приглашение, настройки ============ */}
          <div>
            <section className="card">
              <h2>{t("w_members")}</h2>
              <ul className="people">
                {state.members.map((member) => {
                  const filled = state.filledIds.has(member.userId);
                  return (
                    <li className={`chip ${filled ? "ok" : "warn"}`} key={member.userId}>
                      {displayName(member)}
                      <span className="small muted">
                        {filled ? t("w_filled") : t("w_not_filled")}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <h3 style={{ marginTop: 16 }}>{t("w_invite")}</h3>
              <p className="small muted">{t("w_invite_hint")}</p>
              <div className="row">
                <input type="text" readOnly value={inviteUrl} />
                <CopyButton value={inviteUrl} label={t("w_copy")} copiedLabel={t("w_copied")} />
              </div>
            </section>

            <section className="card">
              <h2>{t("w_settings")}</h2>
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
                      min={5}
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
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
