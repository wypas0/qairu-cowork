import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ScheduleEditor } from "@/components/ScheduleEditor";
import { TelegramAuth } from "@/components/TelegramAuth";
import { Topbar } from "@/components/Topbar";
import { slotTimes } from "@/core/grid";
import { fmtMinutes } from "@/core/intervals";
import { formatDM, formatDMY } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { WEEKDAY_NAMES, isLang, translator } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { SLOT_STEP } from "@/lib/config";

export const dynamic = "force-dynamic";

const IMPORT_PLACEHOLDER = [
  "Пн 9:00-10:30 Матан, 13:00-14:30 История",
  "Вт 8:00–9:30",
  "Ср нет пар",
  "Сб 18:00-22:00 работа",
].join("\n");

export default async function MySchedulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) notFound();

  const user = await currentUser();
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) {
    redirect(`/g/${slug}/join`);
  }

  const lang = chat.lang;
  const t = translator(lang);
  const slots = await repo.getSlots(user.userId);
  const times = slotTimes(chat.dayStartMin, chat.dayEndMin, SLOT_STEP);

  const initialBusy: string[] = [];
  const dated = slots.filter(
    (slot) => slot.specificDate !== null || slot.dateFrom !== null,
  );
  for (const slot of slots) {
    if (slot.weekday === null || slot.specificDate !== null || slot.dateFrom !== null) continue;
    for (const start of times) {
      if (slot.startMin <= start && start < slot.endMin) {
        initialBusy.push(`${slot.weekday}:${start}`);
      }
    }
  }

  return (
    <>
      <TelegramAuth slug={slug} authed />
      <Topbar>
        <Link className="btn btn-sm" href={`/g/${slug}`}>
          {t("w_back")}
        </Link>
      </Topbar>

      <main className="wrap">
        <h1>{t("w_me_title")}</h1>
        <p className="muted">{t("w_me_lead")}</p>

        <ScheduleEditor
          slug={slug}
          step={SLOT_STEP}
          slotTimes={times}
          initialBusy={initialBusy}
          weekdayNames={WEEKDAY_NAMES[isLang(lang) ? lang : "ru"]}
          labels={{
            paintHint: t("w_paint_hint"),
            save: t("w_save"),
            saved: t("w_saved"),
            unsaved: t("w_unsaved"),
            saveError: t("w_save_error"),
            clear: t("w_clear"),
            importTitle: t("w_import_title"),
            importHint: t("w_import_hint"),
            importBtn: t("w_import_btn"),
            importParsed: t("w_import_parsed", { n: "{n}" }),
            importFailed: t("w_import_failed"),
            importPlaceholder: IMPORT_PLACEHOLDER,
          }}
        />

        <section className="card">
          <h2>{t("w_dated")}</h2>
          {dated.length > 0 ? (
            <ul className="windows">
              {dated.map((slot) => (
                <li key={slot.id}>
                  <span className="when">
                    {slot.specificDate
                      ? formatDMY(slot.specificDate)
                      : `${formatDM(slot.dateFrom!)}–${formatDMY(slot.dateTo!)}`}
                  </span>{" "}
                  <span className="small muted">
                    {fmtMinutes(slot.startMin)}–{fmtMinutes(slot.endMin)}
                    {slot.label ? ` · ${slot.label}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">—</p>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>
            {t("w_dated_hint")}
          </p>
        </section>
      </main>
    </>
  );
}
