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
  cancel_only_initiator: "Only the organiser or a group admin can cancel the meeting.",
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
  w_my_groups: "My groups",
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
  w_min_slot: "Default meeting length, min",
  w_windows_title: "Shared windows",
  w_windows_empty: "No options of this length on that day. Pick another day, a shorter meeting or a lower quorum.",
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

  // --- администраторы, варианты встречи, уведомления, вход по паролю ---
  notify_meeting_new: "📅 {name} invites you to a meeting in «{chat}». Reply with the buttons below.",
  notify_meeting_ping: "⏳ {name} is waiting for your answer to the meeting «{goal}» ({when}).",
  notify_change: "✏️ {name} suggests changing the meeting «{goal}»:\n{comment}",
  notify_fill_dm: "⏰ {name} asks you to fill in your schedule in «{chat}» — shared free time can't be found without it.",
  w_windows_nodata: "Nobody has filled in a schedule yet — nothing to compute.",
  w_day: "Day",
  w_duration: "Meeting length",
  w_duration_hm: "{h} h {m} min",
  w_duration_h: "{h} h",
  w_duration_m: "{m} min",
  w_variants: "options: {n}",
  w_members_count: "{filled} of {n} filled in",
  w_role_creator: "creator",
  w_role_admin: "admin",
  w_role_tg_admin: "Telegram admin",
  w_you: "you",
  w_admin_hint: "You're an admin: you can send schedule reminders, appoint admins, remove members and cancel any meeting.",
  w_remind_all: "Remind those who haven't filled in ({n})",
  w_remind_one: "Remind",
  w_make_admin: "Make admin",
  w_remove_admin: "Remove admin",
  w_remove_member: "Remove",
  w_remove_confirm: "Remove {name} from the group? Their schedule is kept — they can come back via the invite link.",
  w_sent: "Done: via Telegram — {tg}, as a site notification — {site}.",
  w_err_not_admin: "Only a group admin can do this.",
  w_err_throttled: "A reminder was sent recently — try again in 10 minutes.",
  w_err_nobody: "Nobody to remind: everyone has filled in their schedule.",
  w_err_cannot_demote: "The group creator and Telegram chat admins can't be demoted.",
  w_err_cannot_remove: "The group creator and Telegram chat admins can't be removed.",
  w_err_last_admin: "The group must keep at least one admin.",
  w_err_empty_comment: "Write what you'd like to change.",
  w_saved_settings: "Settings saved.",
  w_settings_admin_only: "Group settings are changed by an admin.",
  w_notice_meeting: "📅 {name} invites you to «{goal}» — let them know if you're coming.",
  w_notice_change: "✏️ {name} suggests changing «{goal}»: {text}",
  w_notice_fill: "⏰ {name} asks you to fill in your schedule — shared free time can't be found without it.",
  w_notice_open: "Open",
  w_dismiss: "Dismiss",
  w_responses: "Members' answers",
  w_answer_yes: "coming",
  w_answer_no: "not coming",
  w_answer_change: "suggests changes",
  w_answer_wait: "hasn't answered",
  w_initiator: "organiser",
  w_your_answer: "Your answer: {answer}",
  w_ping: "Remind those who haven't answered ({n})",
  w_cancel_confirm: "Cancel the meeting? Members will see it as cancelled.",
  w_legend_free: "free",
  w_legend_busy: "busy",
  w_dated_lead: "Exams, make-up classes, trips, exam sessions — things that don't repeat weekly. Counted in shared free time only on those dates.",
  w_dated_empty: "No one-off busy time yet.",
  w_dated_add: "Add",
  w_dated_from: "Date",
  w_dated_to: "Until (optional)",
  w_dated_to_hint: "Fill in «Until» if you're busy several days in a row.",
  w_dated_all_day: "All day",
  w_dated_start: "From",
  w_dated_end: "To",
  w_dated_time_hint: "Untick «All day» to set hours.",
  w_dated_label: "What is it",
  w_dated_label_ph: "Calculus exam",
  w_dated_add_btn: "Add busy time",
  w_dated_added: "Busy time added.",
  w_dated_delete: "Delete",
  w_dated_delete_confirm: "Delete this busy time?",
  w_dated_past: "past",
  w_dated_err_date: "Check the date.",
  w_dated_err_order: "«Until» is earlier than the start date.",
  w_dated_err_long: "The period is longer than a year — check the year.",
  w_dated_err_time: "Set a start and end time, start before end.",
  w_dated_err_past: "These dates are in the past — check the year.",
  w_login_title: "Sign in",
  w_login_lead: "Set a login and password in your profile. If Telegram is linked to your account, you can use your @username instead of a login.",
  w_login_field: "Login or Telegram @username",
  w_login_field_ph: "amir or @amir",
  w_password: "Password",
  w_login_btn: "Sign in",
  w_login_err_empty: "Enter your login and password.",
  w_login_err_invalid: "Wrong login or password.",
  w_login_err_throttled: "Too many attempts. Wait 15 minutes.",
  w_login_already: "You're already signed in as {name}.",
  w_login_no_account: "No password yet? Open a group invite link or sign in through the bot, then set a login and password in your profile.",
  w_logout: "Sign out",
  w_join_have_account: "Already have an account?",
  w_acct_title: "Login and password",
  w_acct_login: "Login",
  w_acct_tg_login: "Telegram login",
  w_acct_tg_hint: "Shows up once you open the site from the bot (/link or Mini App).",
  w_acct_password_set: "set",
  w_acct_password_unset: "not set",
  w_acct_set_title: "Set a login and password",
  w_acct_change_title: "Change login or password",
  w_acct_set_lead: "Then you can sign in from any device without an invite link.",
  w_acct_login_hint: "3–32 characters: Latin letters, digits, dot, hyphen, underscore.",
  w_acct_current: "Current password",
  w_acct_new_password: "New password",
  w_acct_confirm: "Repeat password",
  w_acct_password_hint: "At least {min} characters.",
  w_acct_save: "Save",
  w_acct_saved: "Saved. Other devices that were signed in have been signed out.",
  w_acct_removed: "Password sign-in turned off.",
  w_acct_remove: "Turn off password sign-in",
  w_acct_remove_confirm: "Turn off password sign-in? You'll only be able to sign in via a link or Telegram.",
  w_acct_remove_lead: "Your current password is required. Afterwards you can only sign in via a link or Telegram, and other devices will be signed out.",
  w_acct_logout_warning: "No password set: after signing out you can only return to this account via your personal link.",
  w_acct_err_login_format: "Login: 3–32 characters, Latin letters, digits, dot, hyphen, underscore.",
  w_acct_err_login_taken: "This login is already taken.",
  w_acct_err_password_short: "The password must be at least {min} characters.",
  w_acct_err_password_long: "The password is too long.",
  w_acct_err_password_mismatch: "Passwords don't match.",
  w_acct_err_current_wrong: "The current password is wrong.",

  // --- вход через Telegram-бота ---
  weblogin_confirm: "🔐 <b>Sign in to the QairuCowork website</b>\n\nSign in as <b>{name}</b>{username}?\n\nRequest from: {device}\n\nIf you didn't just press «Sign in with Telegram» on the website, tap «Not me»: someone is trying to sign in to your account.",
  weblogin_btn_confirm: "✅ Confirm",
  weblogin_btn_reject: "✖ Not me",
  weblogin_done: "✅ Done! Go back to the website — you'll be signed in automatically.",
  weblogin_rejected: "Sign-in rejected. If it wasn't you, nothing else is needed — no one can sign in without confirmation.",
  weblogin_missing: "Sign-in link not found. Press «Sign in with Telegram» on the website again.",
  weblogin_expired: "The sign-in link has expired — it lasts 5 minutes. Press «Sign in with Telegram» on the website again.",
  weblogin_used: "This sign-in link has already been used.",
  weblogin_not_yours: "Only the person who opened the link can confirm this sign-in.",
  w_tglogin_btn: "Sign in with Telegram",
  w_tglogin_lead: "No password needed: the bot will ask you to confirm. If you don't have an account yet, one is created with your Telegram name.",
  w_tglogin_or: "or with login and password",
  w_tglogin_no_bot: "Sign-in with Telegram is unavailable: the bot isn't configured.",
  w_tglogin_title: "Sign in with Telegram",
  w_tglogin_step1: "Press the button below — the QairuCowork bot will open.",
  w_tglogin_step2: "Press «Start», then «Confirm».",
  w_tglogin_step3: "Come back to this page — you'll be signed in automatically.",
  w_tglogin_open_bot: "Open the bot",
  w_tglogin_waiting: "Waiting for confirmation in Telegram…",
  w_tglogin_done: "Signed in, redirecting…",
  w_tglogin_rejected: "Sign-in was rejected in the bot.",
  w_tglogin_expired: "Time to confirm has run out.",
  w_tglogin_invalid: "Sign-in request not found.",
  w_tglogin_retry: "Try again",
  w_tglogin_merge_hint: "You're already on the website without Telegram: after confirming, your groups, schedule and meeting answers move to your Telegram account.",
  w_tglogin_back: "Back to sign-in",

  // --- панель профиля ---
  w_pp_name_cleared: "Real name removed",
  w_pp_name_ph: "e.g. Amir Kovalchuk",
  w_pp_theme: "Theme",
  w_pp_theme_system: "System",
  w_pp_theme_light: "Light",
  w_pp_theme_dark: "Dark",
  w_pp_name: "Real name",
  w_pp_name_saved: "Saved",
  w_pp_name_hint: "Shown next to your Telegram name so groupmates know who you are.",
  w_pp_back: "Back",
  w_pp_account: "Account",
  w_pp_open_account: "Open account",
  w_pp_photo: "Profile photo",
  w_pp_change_photo: "Change photo",
  w_pp_remove_photo: "Remove photo",
  w_pp_photo_error: "Couldn't upload the photo. JPG, PNG or WebP will do.",
  w_pp_photo_too_large: "The photo is too large.",
  w_pp_credentials_unset: "not set — sign in via Telegram or a link",
  w_pp_logout: "Sign out",
  w_pp_join_ph: "Group link or code",
  w_pp_leave_group: "Leave «{title}»",
  w_pp_join_btn: "Join",
  w_pp_create: "Create a group",
  w_pp_login_label: "login {login}",

  // --- расписание со скриншота ---
  w_photo_empty_one: "File {n} is empty or no text could be extracted from it.",
  w_photo_empty: "The file is empty or no text could be extracted from it.",
  w_photo_format_one: "File {n} is not supported. Allowed: JPG, PNG, WebP, PDF, HTML, DOCX, XLSX, TXT, CSV, ICS. Scripts and programs are not accepted.",
  w_photo_format: "This file type is not supported. Allowed: JPG, PNG, WebP, PDF, HTML, DOCX, XLSX, TXT, CSV, ICS. Scripts and programs are not accepted.",
  w_photo_too_large_one: "File {n} is larger than 1 MB. Take a smaller screenshot or save just the table.",
  w_photo_no_classes: "A timetable was found, but no classes could be read. Try a larger screenshot or another format.",
  w_photo_not_timetable_one: "File {n} has no timetable. Replace it with a file containing the timetable.",
  w_photo_not_timetable: "There is no timetable in the file. Upload a screenshot, PDF or page with the timetable.",
  w_photo_title: "Upload a timetable file",
  w_photo_hint: "A screenshot or photo, PDF, a saved portal page (HTML), Word, Excel or text — up to 2 files, each up to 1 MB. If the timetable did not fit on one screenshot, choose both at once: they are combined into one week. Recognised classes appear on the grid: check them and press «Save».",
  w_photo_btn: "Choose files",
  w_photo_working: "Reading the timetable…",
  w_photo_failed: "Could not recognise classes. Try a sharper screenshot or paste the schedule as text.",
  w_photo_too_large: "The file is larger than 1 MB. Take a smaller screenshot or save just the table.",
  w_photo_limit: "Today's recognition limit is used up. Try tomorrow or paste the schedule as text.",
  w_photo_busy: "The recognition service is busy, try again in a minute.",
  w_photo_not_configured: "Photo recognition is not configured.",
  w_photo_too_many: "Up to {n} files at a time.",

  // --- подключение Telegram из профиля ---
  weblogin_link_confirm: "🔗 <b>Connect Telegram to your QairuCowork website account</b>\n\nConnect as <b>{name}</b>{username}?\n\nRequest from: {device}\n\nAfter connecting, your groups, schedule and meeting answers from the website move to this Telegram account, and you can sign in through the bot. If you didn't just press «Connect Telegram» on the website, tap «Not me».",
  weblogin_link_done: "✅ Telegram connected! Go back to the website — it will update by itself.",
  w_pp_tg_connect: "Connect Telegram",
  w_pp_tg_connect_hint: "bot notifications and sign-in without a password",
  w_pp_tg_connected: "connected · @{username}",
  w_pp_tg_connected_plain: "connected",
  w_tglink_title: "Connect Telegram",
  w_tglink_lead: "Your groups, schedule and meeting answers move to your Telegram account. If it already has its own schedule, that one is kept.",
  w_tglink_done: "Telegram connected, going back…",

  // --- сетка по парам ---
  w_break_row: "Break {m} min",
};
