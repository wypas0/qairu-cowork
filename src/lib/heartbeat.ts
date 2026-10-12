/**
 * «Пульс» cron напоминаний для healthchecks.io (DEPLOY.md, «Мониторинг»).
 *
 * После каждого прогона — GET на `HEALTHCHECKS_PING_URL` (удачный) или на
 * `<адрес>/fail` (упавший). Если пульса нет дольше периода и запаса — пингер
 * cron-job.org отвалился, секрет разъехался или прогоны падают, — сервис
 * сообщает в Telegram. Пульс — дело второстепенное: его сбой или зависание не
 * должны ни ронять прогон, ни съедать его бюджет.
 */

import { healthchecksPingUrl } from "./config";

/** Сколько ждём сервис пульса. Он отвечает за десятки миллисекунд. */
export const HEARTBEAT_TIMEOUT_MS = 5_000;

export async function pingHeartbeat(ok: boolean, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const base = healthchecksPingUrl();
  if (!base) return false;
  try {
    const response = await fetchImpl(ok ? base : `${base}/fail`, {
      method: "GET",
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
      cache: "no-store",
    });
    // Тело не нужно, но его надо вычитать, иначе соединение висит до сборки мусора.
    await response.body?.cancel().catch(() => {});
    if (!response.ok) console.error(`[qairu:heartbeat] сервис ответил ${response.status}`);
    return response.ok;
  } catch (error) {
    // Адрес — секрет: в журнал идёт только причина.
    const reason = error instanceof Error ? error.name : "error";
    console.error(`[qairu:heartbeat] пульс не ушёл: ${reason}`);
    return false;
  }
}
