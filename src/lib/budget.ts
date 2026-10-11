/**
 * Бюджет времени прогона cron.
 *
 * Функция на Vercel живёт не дольше `maxDuration`; оборванный посреди рассылки
 * прогон теряет уже отмеченную, но не отправленную работу. Поэтому новую
 * единицу работы (встречу, календарь) прогон берёт, только пока бюджет не
 * кончился (`canStart`), а начатую доводит до конца, пока не вышел запас
 * (`canContinue`). Бюджет + запас < `maxDuration`.
 */

export type Budget = {
  /** Сколько миллисекунд осталось до конца бюджета (может быть отрицательным). */
  left(): number;
  /** Можно ли взять новую единицу работы. */
  canStart(): boolean;
  /** Можно ли продолжать уже начатую — до конца запаса. */
  canContinue(): boolean;
};

export function timeBudget(ms: number, graceMs = 0, clock: () => number = Date.now, startedAt = clock()): Budget {
  const end = startedAt + ms;
  return {
    left: () => end - clock(),
    canStart: () => clock() < end,
    canContinue: () => clock() < end + graceMs,
  };
}

/** Без ограничения — для вызовов вне cron и тестов. */
export const UNLIMITED: Budget = { left: () => Infinity, canStart: () => true, canContinue: () => true };
