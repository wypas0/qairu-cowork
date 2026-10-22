import { Fragment } from "react";

import { formatDM, utcToZonedWall } from "@/core/timeutils";

/**
 * Строка перевода с узлами вместо {имён}: «{name} зовёт в {group}» →
 * <b>Асель</b> зовёт в <b>«Литклуб»</b>. Порядок слов берётся из перевода:
 * в казахском группа идёт первой.
 */
export function rich(template: string, parts: Record<string, React.ReactNode>): React.ReactNode {
  return template.split(/(\{\w+\})/).map((chunk, index) => {
    const name = /^\{(\w+)\}$/.exec(chunk)?.[1];
    return <Fragment key={index}>{name !== undefined && name in parts ? parts[name] : chunk}</Fragment>;
  });
}

/**
 * Когда это было: «только что» (`justNow`), «5 мин назад», «вчера», «3 дн.
 * назад» — словами языка (Intl), старше недели — дата «22.10» в поясе `tz`.
 * Первую минуту Intl назвал бы «в эту минуту» — поэтому своя подпись.
 */
export function ago(lang: string, at: Date, now: Date, tz: string, justNow: string): string {
  const seconds = (at.getTime() - now.getTime()) / 1000;
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
  const abs = Math.abs(seconds);
  if (abs < 60) return justNow;
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return format.format(Math.round(seconds / 86_400), "day");
  return formatDM(utcToZonedWall(at, tz).day);
}
