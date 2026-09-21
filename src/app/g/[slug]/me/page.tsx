import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { DatedQuickForm } from "@/components/DatedQuickForm";
import { FlashToast } from "@/components/FlashToast";
import { ScrollToAnchor } from "@/components/ScrollToAnchor";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import { TelegramBackButton } from "@/components/TelegramButtons";
import { gridPeriods, periodOverlaps } from "@/core/grid";
import { fmtMinutes } from "@/core/intervals";
import { addDays, chatTz, compareDates, formatDM, formatDMY, todayIn } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { WEEKDAY_NAMES, WEEKDAY_SHORT, isLang, translator } from "@/i18n";
import { pageUser } from "@/lib/gate";
import { SLOT_STEP } from "@/lib/config";
import { hasVision } from "@/lib/vision";
import { addDatedBusyAction, deleteDatedBusyAction } from "./actions";

export const dynamic = "force-dynamic";

const IMPORT_PLACEHOLDER = [
  "Пн 9:00-10:30 Матан, 13:00-14:30 История",
  "Вт 8:00–9:30",
  "Ср нет пар",
  "Сб 18:00-22:00 работа",
].join("\n");

const DATED_ERRORS: Record<string, string> = {
  date: "w_dated_err_date",
  range_order: "w_dated_err_order",
  range_long: "w_dated_err_long",
  time: "w_dated_err_time",
  past: "w_dated_err_past",
};

export default async function MySchedulePage({
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

  const user = await pageUser(`/g/${slug}/me`);
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) {
    redirect(`/g/${slug}/join`);
  }

  const lang = chat.lang;
  const t = translator(lang);
  const slots = await repo.getSlots(user.userId);
  const dated = await repo.datedSlots(user.userId);
  const periods = gridPeriods(chat.dayStartMin, chat.dayEndMin, SLOT_STEP);
  const today = todayIn(chatTz(chat));

  const initialBusy: string[] = [];
  for (const slot of slots) {
    if (slot.weekday === null || slot.specificDate !== null || slot.dateFrom !== null) continue;
    for (const period of periods) {
      if (periodOverlaps(period, slot.startMin, slot.endMin)) {
        initialBusy.push(`${slot.weekday}:${period.start}`);
      }
    }
  }

  const errorKey = typeof query.err === "string" ? DATED_ERRORS[query.err] : undefined;
  const added = query.added === "1";

  return (
    <>
      <ScrollToAnchor id={typeof query.at === "string" ? query.at : null} />
      {/* В Telegram назад ведёт нативная кнопка в шапке. */}
      <TelegramBackButton href={`/g/${slug}`} />
      <AppShell lang={lang} slug={slug} title={chat.title} section="me">
      <main className="wrap">
        <header className="page-head">
          <div>
            <p className="eyebrow">{chat.title}</p>
            <h1>{t("w_me_title")}</h1>
            <p className="lead">{t("w_me_lead")}</p>
            <p className="small muted" style={{ margin: "8px 0 0" }}>
              {t("w_me_shared")}
            </p>
          </div>
        </header>

        <ScheduleEditor
          slug={slug}
          backHref={`/g/${slug}`}
          periods={periods}
          initialBusy={initialBusy}
          weekdayNames={WEEKDAY_NAMES[isLang(lang) ? lang : "ru"]}
          weekdayShort={WEEKDAY_SHORT[isLang(lang) ? lang : "ru"]}
          photoEnabled={hasVision()}
          labels={{
            paintHint: t("w_paint_hint"),
            saved: t("w_saved"),
            notFilledYet: t("w_not_filled_yet"),
            saving: t("w_saving"),
            saveError: t("w_save_error"),
            saveRetry: t("w_save_retry"),
            done: t("w_done"),
            undo: t("w_undo"),
            clear: t("w_clear"),
            busyTotal: t("w_busy_total", { h: "{h}" }),
            chooseTitle: t("w_choose_title"),
            chooseLead: t("w_choose_lead"),
            choosePhoto: t("w_choose_photo"),
            choosePhotoHint: t("w_choose_photo_hint"),
            chooseText: t("w_choose_text"),
            chooseTextHint: t("w_choose_text_hint"),
            chooseManual: t("w_choose_manual"),
            chooseManualHint: t("w_choose_manual_hint"),
            importTitle: t("w_import_title"),
            importTitleFirst: t("w_import_title_first"),
            importHint: t("w_import_hint"),
            importBtn: t("w_import_btn"),
            importParsed: t("w_import_parsed", { n: "{n}" }),
            importReview: t("w_import_review", { n: "{n}" }),
            importSave: t("w_import_save"),
            importCancel: t("w_import_cancel"),
            importPending: t("w_import_pending"),
            importFailed: t("w_import_failed"),
            importPlaceholder: IMPORT_PLACEHOLDER,
            legendFree: t("w_legend_free"),
            legendBusy: t("w_legend_busy"),
            breakRow: t("w_break_row", { m: "{m}" }),
            photoTitle: t("w_photo_title"),
            photoHint: t("w_photo_hint"),
            photoBtn: t("w_photo_btn"),
            photoWorking: t("w_photo_working"),
            photoFailed: t("w_photo_failed"),
            photoTooLarge: t("w_photo_too_large"),
            photoLimit: t("w_photo_limit"),
            photoBusy: t("w_photo_busy"),
            photoNotConfigured: t("w_photo_not_configured"),
            photoTooMany: t("w_photo_too_many", { n: "{n}" }),
            photoNotTimetable: t("w_photo_not_timetable"),
            photoNotTimetableOne: t("w_photo_not_timetable_one", { n: "{n}" }),
            photoNoClasses: t("w_photo_no_classes"),
            photoTooLargeOne: t("w_photo_too_large_one", { n: "{n}" }),
            photoFormat: t("w_photo_format"),
            photoFormatOne: t("w_photo_format_one", { n: "{n}" }),
            photoEmpty: t("w_photo_empty"),
            photoEmptyOne: t("w_photo_empty_one", { n: "{n}" }),
          }}
        />

        {/* ============ разовая занятость ============ */}
        <section className="card" id="dated">
          <h2>{t("w_dated")}</h2>
          <p className="small muted">{t("w_dated_lead")}</p>

          {errorKey && (
            <div className="notice warn" role="alert">
              {t(errorKey)}
            </div>
          )}
          <FlashToast message={added && !errorKey ? t("w_dated_added") : null} params={["added"]} />

          {/* Сначала добавить (это делают чаще), потом список уже добавленного. */}
          <DatedQuickForm
            action={addDatedBusyAction.bind(null, slug)}
            today={today}
            tomorrow={addDays(today, 1)}
            labels={{
              day: t("w_dated_from"),
              today: t("w_dated_today"),
              tomorrow: t("w_dated_tomorrow"),
              other: t("w_dated_other"),
              add: t("w_dated_add_btn"),
              more: t("w_dated_more"),
              less: t("w_dated_less"),
              to: t("w_dated_to"),
              toHint: t("w_dated_to_hint"),
              label: t("w_dated_label"),
              labelPh: t("w_dated_label_ph"),
              allDay: t("w_dated_all_day"),
              start: t("w_dated_start"),
              end: t("w_dated_end"),
              timeHint: t("w_dated_time_hint"),
            }}
          />

          <div className="dated-list">
          {dated.length > 0 ? (
            <ul className="windows">
              {dated.map((slot) => {
                const last = slot.dateTo ?? slot.specificDate ?? today;
                const past = compareDates(last, today) < 0;
                const allDay = slot.startMin === 0 && slot.endMin >= 24 * 60;
                return (
                  <li key={slot.id} className={`slotrow${past ? " past" : ""}`}>
                    <div className="slotinfo">
                      <span className="when">
                        {slot.specificDate
                          ? formatDMY(slot.specificDate)
                          : `${formatDM(slot.dateFrom!)}–${formatDMY(slot.dateTo!)}`}
                      </span>{" "}
                      <span className="small muted">
                        {allDay
                          ? t("w_dated_all_day")
                          : `${fmtMinutes(slot.startMin)}–${fmtMinutes(slot.endMin)}`}
                        {slot.label ? ` · ${slot.label}` : ""}
                        {past ? ` · ${t("w_dated_past")}` : ""}
                      </span>
                    </div>
                    <form action={deleteDatedBusyAction.bind(null, slug, slot.id)}>
                      <ConfirmSubmit
                        className="btn btn-sm btn-quiet btn-danger"
                        confirm={t("w_dated_delete_confirm")}
                      >
                        {t("w_dated_delete")}
                      </ConfirmSubmit>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted small">{t("w_dated_empty")}</p>
          )}
          </div>
        </section>
      </main>
      </AppShell>
    </>
  );
}
