import Link from "next/link";

import { chatTz, formatDM, todayIn, utcToZonedWall, weekdayOf } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { tn, translator, weekdayShort } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { IconBell, IconCalendarUser, IconClock } from "./icons";
import type { ProfileGroup } from "./ProfilePanel";

/**
 * «Сегодня» внизу сайдбара — на месте пустоты между списком групп и профилем.
 * Три строки о том, что ждёт человека: встречи сегодня, ответы, которых от
 * него ждут, и когда он обновлял расписание. Каждая строка ведёт туда, где
 * это поправить. В свёрнутой панели блока нет.
 */
export async function SidebarToday({
  lang,
  slug,
  groups,
}: {
  lang: string;
  slug: string;
  groups: ProfileGroup[];
}) {
  const user = await currentUser();
  if (!user) return null;
  const t = translator(lang);

  const meetings = groups.flatMap((group) => (group.meetings ?? []).map((meeting) => ({ group, meeting })));
  const today = meetings.filter(({ meeting }) => meeting.today);
  const awaiting = meetings.filter(({ meeting }) => meeting.awaiting);
  const updatedAt = (await repo.scheduleUpdatedAt([user.userId])).get(user.userId);
  const tz = chatTz(null);
  const day = todayIn(tz);

  return (
    <section className="sidebar-today" aria-label={t("w_today_title")}>
      <p className="eyebrow">
        {t("w_today_title")} · {weekdayShort(lang, weekdayOf(day))} {formatDM(day)}
      </p>
      <ul>
        <li>
          {today.length > 0 ? (
            <Link href={`/g/${today[0].group.slug}?at=meeting-${today[0].meeting.id}`}>
              <IconClock size={14} />
              <span>{tn(lang, "w_today_meetings", today.length)}</span>
            </Link>
          ) : (
            <span className="sidebar-today-row muted">
              <IconClock size={14} />
              <span>{t("w_today_none")}</span>
            </span>
          )}
        </li>
        {awaiting.length > 0 && (
          <li>
            <Link href={`/g/${awaiting[0].group.slug}?at=meeting-${awaiting[0].meeting.id}`}>
              <IconBell size={14} />
              <span>{t("w_today_awaiting", { n: awaiting.length })}</span>
            </Link>
          </li>
        )}
        <li>
          <Link href={`/g/${slug}/me`}>
            <IconCalendarUser size={14} />
            <span>
              {updatedAt
                ? t("w_today_schedule", { date: formatDM(utcToZonedWall(updatedAt, tz).day) })
                : t("w_today_schedule_empty")}
            </span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
