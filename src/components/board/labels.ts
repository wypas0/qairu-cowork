/** Все подписи доски группы. Строки с {n}, {total} и т.п. подставляются здесь же. */
export type BoardLabels = {
  bestTitle: string;
  bestLead: string;
  bestEmpty: string;
  bestAll: string;
  moreDays: string; // «и ещё {n}»
  bestCount: string; // «свободны {n} из {total}»
  bestHide: string;
  bestShow: string;
  rowsTrimmed: string; // «Скрыты часы, когда никто не свободен»
  rowsShowAll: string;
  rowsHideEmpty: string;
  copyWindows: string;
  copiedWindows: string;
  copyHead: string; // «Общие окна · {duration}» — литеральный {duration}
  copyWithout: string; // «без {names}» — литеральный {names}
  nowLabel: string;
  weekPrev: string;
  weekNext: string;
  weekThis: string;
  whoNeeded: string; // «Кто должен прийти · {n} из {total}»
  whoAll: string;
  whoHint: string;
  notFilled: string;
  heatTitle: string;
  heatHint: string;
  /** Подсказка карты на телефоне: там один день и нет наведения. */
  heatHintMobile: string;
  breakRow: string; // «Перерыв {m} мин»
  legendNone: string;
  legendAll: string;
  legendMeeting: string;
  legendMine: string;
  /** «кому-то неудобно» в легенде. */
  legendSoft: string;
  freeNames: string;
  busyNames: string;
  /** «неудобно: {names}» — литеральный {names}. */
  softNames: string;
  nobody: string;
  windowsTitle: string;
  windowsEmpty: string;
  windowsNoData: string;
  missingShort: string;
  pick: string;
  day: string;
  duration: string;
  durationTemplate: string; // «{h} ч {m} мин» — литеральные {h} и {m}
  hoursOnlyTemplate: string; // «{h} ч»
  minutesTemplate: string; // «{m} мин»
  variantsTemplate: string; // «{n} вариантов» — литеральный {n}
  close: string;
};

export function durationText(minutes: number, labels: BoardLabels): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return labels.minutesTemplate.replace("{m}", String(m));
  if (m === 0) return labels.hoursOnlyTemplate.replace("{h}", String(h));
  return labels.durationTemplate.replace("{h}", String(h)).replace("{m}", String(m));
}

/** «Пн 21.09, Вт 22.09, Ср 23.09» — не больше трёх дней, дальше «и ещё N». */
export function daysText(dates: { short: string }[], labels: BoardLabels): string {
  const shown = dates.slice(0, 3).map((date) => date.short).join(", ");
  const rest = dates.length - 3;
  return rest > 0 ? `${shown} ${labels.moreDays.replace("{n}", String(rest))}` : shown;
}

/** «свободны все», «свободны 7 из 9 — нет Асель, Болат», плюс «· неудобно: Дана». */
export function whoText(
  item: { count: number; missing: string[]; soft?: string[] },
  total: number,
  labels: BoardLabels,
): string {
  const soft = item.soft?.length ? ` · ${labels.softNames.replace("{names}", item.soft.join(", "))}` : "";
  if (item.missing.length === 0) return labels.bestAll + soft;
  const count = labels.bestCount.replace("{n}", String(item.count)).replace("{total}", String(total));
  return `${count} — ${labels.missingShort} ${item.missing.join(", ")}${soft}`;
}
