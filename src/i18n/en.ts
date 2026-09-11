import type { Strings } from "./types";

export const EN: Strings = {
  start_private:
    "👋 Hi, {name}!\n\n" +
    "I'm <b>QairuCowork</b> — I find common free time slots for students in the same chat.\n\n" +
    "How it works:\n" +
    "1️⃣ You tell me your class schedule once\n" +
    "2️⃣ Your groupmates do the same\n" +
    "3️⃣ /availability in the chat shows when everyone is free\n\n" +
    "Start with /schedule, or just send your schedule as plain text.",
  start_linked:
    "✅ You joined <b>{chat}</b>.\n\nNow fill in your schedule — /schedule or send it as text.",
  help:
    "<b>QairuCowork commands</b>\n\n" +
    "<b>In private chat:</b>\n" +
    "/schedule — fill in your schedule step by step\n" +
    "/import — send schedule as text or CSV\n" +
    "/myschedule — show my schedule\n" +
    "/busy — one-off busy slot on a specific date\n" +
    "/clear — wipe my schedule\n\n" +
    "<b>In a group:</b>\n" +
    "/setup — connect the chat (admin)\n" +
    "/join — join the chat\n" +
    "/members — who has filled in a schedule\n" +
    "/remind — ping those who haven't (admin)\n" +
    "/availability — common free windows\n" +
    "/availability @user @user — windows with these people only\n" +
    "/availability 90 — windows of at least 90 minutes\n" +
    "/availability 80% — windows where 80% of people are free\n" +
    "/availability q5 — where at least 5 people are free\n" +
    "/meeting @user — create a meeting with a poll\n" +
    "/settings — working hours and timezone (admin)\n" +
    "/lang — interface language",
  cancelled: "Cancelled.",
  nothing_to_cancel: "Nothing to cancel right now.",
  only_admin: "⛔ Only a chat administrator can use this command.",
  only_group: "This command works in group chats only.",
  only_private: "This command works in a private chat with the bot only.",
  error_generic: "Something went wrong. Try again or send /help.",

  choose_lang: "Choose the interface language:",
  lang_set: "✅ Interface language: English",

  setup_done:
    "✅ Chat <b>{chat}</b> is connected.\n\n" +
    "Everyone who wants to take part taps the button below — it opens a private chat " +
    "with me where you fill in your schedule.\n\n" +
    "<i>I can't see the group member list — that's a Telegram limitation. " +
    "So I only count windows among people who registered.</i>",
  btn_fill_schedule: "📅 Fill in schedule",
  btn_who_filled: "👥 Who has filled in",
  join_ok: "✅ {name}, you're on the list. Now fill in your schedule in my private chat.",
  join_already: "{name}, you're already on this chat's list.",
  chat_not_setup: "This chat isn't connected yet. An admin needs to run /setup.",
  btn_open_bot: "🤖 Open the bot",

  schedule_intro:
    "Send your class schedule in one message. Almost any format works:\n\n" +
    "<code>Mon 9:00-10:30 Calculus, 13:00-14:30 History\n" +
    "Tue 8:00-9:30\n" +
    "Wed no classes\n" +
    "Thu 10-11.30; 12:00-13:30 Physics</code>\n\n" +
    "Day names can be Russian, Kazakh or English. " +
    "Or use /wizard to fill day by day with buttons.",
  parse_preview: "Here's how I read your schedule:\n\n{schedule}\n\nIs that right?",
  parse_errors: "\n\n⚠️ Couldn't parse these lines:\n<code>{lines}</code>",
  parse_failed:
    "I couldn't parse a single line. The format should look like this:\n\n" +
    "<code>Mon 9:00-10:30\nTue 13:00-14:30</code>\n\nTry again or use /wizard.",
  btn_confirm: "✅ Correct",
  btn_retry: "✏️ Re-enter",
  schedule_saved: "✅ Schedule saved. /availability now works in the chat.",
  schedule_empty: "You don't have a schedule yet. Send it as text or use /wizard.",
  my_schedule: "<b>Your schedule</b>\n\n{schedule}",
  day_free: "free",
  clear_confirm: "Delete the whole schedule?",
  btn_yes_delete: "🗑 Yes, delete",
  btn_no: "Cancel",
  cleared: "Schedule deleted.",

  wizard_pick_day: "Pick a day to fill in:",
  wizard_ask_day:
    "Classes on <b>{day}</b>? Send them in one line, e.g.:\n<code>9:00-10:30, 13:00-14:30</code>\n\nIf there are none, write <code>no</code>.",
  wizard_day_saved: "✅ {day}: {slots}",
  wizard_done: "Done. Schedule saved.",
  btn_done: "✅ Finish",

  busy_ask:
    "Send a one-off busy slot. These formats work:\n\n" +
    "<code>12.09 14:00-16:00 exam</code>\n" +
    "<code>12.09 all day</code>\n" +
    "<code>15.09-20.09 exams</code>\n" +
    "<code>15.09-20.09 9:00-14:00 internship</code>",
  busy_saved: "✅ Noted: {date}, {time}",
  busy_bad: "I didn't get the date or time. Format: <code>12.09 14:00-16:00 title</code>",
  busy_range_saved: "✅ Noted: {date_from} — {date_to}, {time}",
  busy_cleared: "Removed {count} one-off entries. Your weekly schedule is untouched.",

  members_title: "<b>Chat members</b>\n",
  members_filled: "✅ Schedule filled in ({count}):\n{names}",
  members_missing: "\n⏳ Not filled in yet ({count}):\n{names}",
  members_empty: "Nobody has joined yet. Tap the button below or send /join.",
  remind_text:
    "⏰ {names} — please fill in your schedule, we can't compute common windows without you.",
  remind_nobody: "Everyone has filled in their schedule 👍",

  avail_title: "<b>🗓 Common free windows</b>\n<i>{who}</i>\n",
  avail_all: "all chat members ({count})",
  avail_selected: "{count} people: {names}",
  avail_none:
    "No common windows longer than {min} min in the next week 😕\nTry /availability 30 or a different set of people.",
  avail_no_members: "No registered members in this chat yet. Start with /setup and /join.",
  avail_need_schedule: "Nobody has a schedule yet. Fill it in via the bot's private chat.",
  avail_missing_note: "\n⚠️ Not counted (no schedule): {names}",
  avail_hint: "\n<i>Working window: {start}–{end}, minimum {min} min. Change it with /settings</i>",
  avail_user_not_found:
    "I don't know the user {name}. They need to /join and fill in a schedule.",
  avail_quorum_title:
    "<b>🗓 Windows where at least {quorum} of {total} are free</b>\n<i>{who}</i>\n",
  avail_quorum_line: "  <i>{count}/{total} — missing: {missing}</i>",
  avail_quorum_all: "  <i>everyone is free</i>",
  avail_quorum_none: "No windows with at least {quorum} people free in the next week.",
  avail_parity_note: "\n<i>Week: {parity}</i>",
  avail_clipped:
    "…list trimmed to fit one message. Narrow it down: /availability 90 or name specific people.",

  meeting_step1: "📌 <b>New meeting</b> — step 1 of 3\n\nWhere are we meeting?",
  meeting_step2: "📌 Step 2 of 3 — when?\n\nPick a common window or enter the time manually.",
  meeting_step2_manual:
    "📌 Step 2 of 3 — write the meeting time, e.g.:\n<code>Wednesday 15:00-16:30</code>",
  meeting_step3: "📌 Step 3 of 3 — what's the goal of the meeting?",
  btn_manual_time: "✏️ Enter manually",
  meeting_not_yours: "Someone else is creating this meeting.",
  meeting_card:
    "📌 <b>Meeting</b>\n\n" +
    "📍 Place: {place}\n" +
    "🕒 Time: {when}\n" +
    "🎯 Goal: {goal}\n\n" +
    "👥 {invitees}\n",
  meeting_votes:
    "\n✅ Yes ({yes}): {yes_names}\n❌ No ({no}): {no_names}\n✏️ Suggested changes ({change}): {change_names}",
  btn_yes: "✅ Yes",
  btn_no_answer: "❌ No",
  btn_change: "✏️ Suggest changes",
  vote_registered: "Vote recorded: {answer}",
  vote_not_invited: "You're not on the invite list for this meeting.",
  change_ask: "What would you change? Reply to this message.",
  change_saved: "Your suggestion was added to the meeting card.",
  changes_block: "\n\n<b>💬 Suggestions:</b>\n{items}",
  meeting_timeout: "Meeting creation timed out.",
  meeting_no_windows: "The selected people have no common windows — enter the time manually.",
  meeting_reminder: "⏰ Meeting in {minutes} min!\n📍 {place}\n🎯 {goal}\n\n{names}",
  meeting_no_time: "I couldn't read that as a date — no reminder, but the meeting is created.",
  cancel_only_initiator: "Only the person who created the meeting can cancel it.",
  meeting_cancel_done: "Meeting cancelled.",
  meeting_cancelled_card: "🚫 <b>Meeting cancelled</b>\n\n<s>📍 {place}\n🕒 {when}\n🎯 {goal}</s>",
  btn_ics: "📅 Add to calendar",
  btn_cancel_meeting: "🚫 Cancel",
  ics_caption: "Open the file to add the meeting to your calendar.",
  ics_default_summary: "Meeting",
  leave_ok: "{name} left the participant list. The schedule is kept — rejoin any time with /join.",

  parity_odd: "week A (odd)",
  parity_even: "week B (even)",
  parity_none: "every week",
  kind_class: "class",
  kind_work: "work",
  kind_sport: "sport",
  kind_exam: "exam",
  kind_other: "busy",

  settings_title:
    "<b>⚙️ Chat settings</b>\n\n" +
    "Working window: <b>{start}–{end}</b>\n" +
    "Minimum window length: <b>{min} min</b>\n" +
    "Travel buffer: <b>{buffer} min</b>\n" +
    "Semester start (week parity): <b>{semester}</b>\n" +
    "Meeting reminder: <b>{reminder} min before</b>\n" +
    "Timezone: <b>{tz}</b>\n" +
    "Language: <b>{lang}</b>\n\n" +
    "To change:\n" +
    "<code>/settings hours 8:00 22:00</code>\n" +
    "<code>/settings min 45</code>\n" +
    "<code>/settings buffer 20</code>\n" +
    "<code>/settings semester 01.09.2026</code>\n" +
    "<code>/settings reminder 30</code>\n" +
    "<code>/settings tz Asia/Almaty</code>",
  settings_saved: "✅ Settings updated.",
  settings_bad: "I didn't get that parameter. See the examples in /settings.",
  settings_not_set: "not set",
  answer_yes: "yes",
  answer_no: "no",
  answer_change: "suggested changes",

  web_link:
    "🌐 <b>Web version</b>\n\n" +
    "Same thing with a visual week grid — you can see who is busy when, " +
    "and free windows are highlighted.\n\n" +
    "This link is personal, don't forward it: it edits your schedule.",
  btn_open_web: "🌐 Open the web version",
  web_not_configured: "The web version isn't connected: the bot admin hasn't set WEB_BASE_URL.",
  web_link_sent: "I sent you the link in a private message.",
  web_link_dm_first: "Message me privately first — otherwise Telegram won't let me send you the link.",

  w_tagline: "Finds free time everyone in a student group shares.",
  w_footer:
    "QairuCowork — shared free windows for student groups. Works in Telegram and in the browser.",
  w_hero_title: "When is everyone free?",
  w_hero_lead:
    "Everyone marks their classes once. The site then shows when the whole group is free — and when almost all of it is.",
  w_step1_t: "Create a group",
  w_step1_d: "No accounts, no passwords. You get a link and send it to your groupmates.",
  w_step2_t: "Everyone marks classes",
  w_step2_d: "Drag on the grid, tap on a phone, or just paste the timetable as text.",
  w_step3_t: "Read the windows",
  w_step3_d:
    "Colour shows where everyone is free and where eight out of ten are. Meetings start right there.",
  w_create: "Create a group",
  w_group_title: "Group name",
  w_group_title_ph: "CS-21, project team…",
  w_your_name: "Your name",
  w_your_name_ph: "Your name",
  w_tz: "Timezone",
  w_lang: "Language",
  w_my_groups: "Your groups",
  w_open: "Open",
  w_join_title: "Join “{title}”",
  w_join_lead: "Introduce yourself — your groupmates need to know whose schedule this is.",
  w_join_btn: "Join",
  w_already_in: "Already in ({count})",
  w_invite: "Invite link",
  w_invite_hint: "Drop it in the group chat: anyone who opens it joins.",
  w_copy: "Copy",
  w_copied: "Copied",
  w_heat_title: "The whole week",
  w_heat_hint: "The darker the cell, the fewer people are free. Hover to see how many.",
  w_legend_none: "nobody",
  w_legend_all: "everyone",
  w_quorum_label: "{q} of {n} is enough",
  w_min_slot: "Minimum window length",
  w_windows_title: "Shared windows",
  w_windows_empty: "No windows. Try a shorter length or a lower quorum.",
  w_missing_short: "missing:",
  w_pick: "Schedule",
  w_members: "Members",
  w_filled: "filled in",
  w_not_filled: "not filled in",
  w_edit_mine: "My schedule",
  w_meetings: "Meetings",
  w_new_meeting: "New meeting",
  w_place: "Place",
  w_place_ph: "Library, 3rd floor",
  w_goal: "Goal",
  w_goal_ph: "Working through the calculus problem set",
  w_when: "Time",
  w_when_hint: "Pick a window with “Schedule”, or type the time in words.",
  w_create_meeting: "Create",
  w_yes: "Yes",
  w_no: "No",
  w_change: "Suggest changes",
  w_cancel_meeting: "Cancel meeting",
  w_cancelled: "Meeting cancelled",
  w_ics: "Add to calendar",
  w_comment_ph: "what you would change",
  w_me_title: "My schedule",
  w_me_lead:
    "Mark when you're busy: classes, work, training. The free time is worked out for you.",
  w_paint_hint: "Drag with the mouse or your finger. Click a day to fill or clear the whole column.",
  w_save: "Save",
  w_saved: "Saved",
  w_unsaved: "Save changes",
  w_save_error: "Couldn't save",
  w_clear: "Clear all",
  w_import_title: "Or paste your timetable as text",
  w_import_hint: "Understands Russian, Kazakh and English, odd/even weeks, work and training.",
  w_import_btn: "Parse",
  w_import_parsed: "Parsed {n} slots. Check the grid and press Save.",
  w_import_failed: "Couldn't parse that. Try the format “Mon 9:00-10:30 Calculus”.",
  w_dated: "One-off busy times",
  w_dated_hint: "Exams and exam periods are added in the bot with /busy.",
  w_settings: "Group settings",
  w_hours: "Working hours",
  w_buffer: "Travel buffer, min",
  w_semester: "Semester start",
  w_semester_hint: "Needed for every-other-week classes: without this date parity isn't computed.",
  w_save_settings: "Save settings",
  w_back: "Back to group",
  w_no_schedule_yet: "You haven't marked your schedule yet — windows are being computed without you.",
  w_fill_now: "Fill it in",
  w_minutes_short: "min",
  w_not_found: "Group not found",
  w_not_found_lead: "Check the link — the group may have been deleted, or the address is mistyped.",
  w_home: "Home",

  // --- profile ---
  w_profile: "Profile",
  w_close: "Close",
  w_no_groups: "You're not in any group yet.",
  w_leave: "Leave",
  w_leave_confirm: "Leave “{title}”? Your schedule stays saved — you can rejoin with the same link.",
  w_no_meetings: "No upcoming meetings.",
  w_join_other: "Join another group",
  w_join_other_ph: "invite link or group code",
  w_join_other_btn: "Go",
  w_profile_anon: "Open an invite link to any group — your profile will show up here.",
};
