/**
 * Данные живого демо на лендинге: выдуманная группа из восьми человек и её
 * неделя по парам. Чистый модуль без React — его считают и сервер (первая
 * отрисовка), и браузер (нажатия), и тест.
 *
 * Данные фиксированные, никакой случайности: иначе сервер и клиент нарисуют
 * разное. Матрицы подобраны так, что при всех восьми общее окно одно —
 * «Ср, 5 пара, 12:10–13:00», — а если не считать Амира, Асель, Болата или
 * Дану, лучшее окно переезжает на клетку, где был занят только он
 * (tests/landingDemo.test.ts это стережёт).
 */

/** Сколько пар в дне и дней в неделе (Пн–Пт). */
export const PERIODS = 6;
export const DAYS = 5;

/** Пары: номер, начало и конец — как сетка «по парам» на карте группы. */
export const DEMO_PERIODS: readonly { n: number; start: string; end: string }[] = [
  { n: 1, start: "08:00", end: "08:50" },
  { n: 2, start: "09:00", end: "09:50" },
  { n: 3, start: "10:00", end: "10:50" },
  { n: 4, start: "11:10", end: "12:00" },
  { n: 5, start: "12:10", end: "13:00" },
  { n: 6, start: "13:10", end: "14:00" },
];

/**
 * Восемь человек и их занятость: строка — пара, символ — день (Пн…Пт),
 * «1» — занят. Имена не переводятся: это имена, а не текст интерфейса.
 */
const ROWS: readonly [string, readonly string[]][] = [
  ["Амир", ["10101", "00001", "00000", "00000", "11000", "11100"]],
  ["Асель", ["00000", "11001", "11100", "01110", "01011", "11010"]],
  ["Болат", ["01110", "00011", "00101", "10010", "00000", "10000"]],
  ["Дана", ["00101", "00101", "10000", "01000", "01000", "11110"]],
  ["Ерлан", ["01000", "11000", "10110", "00011", "00011", "00010"]],
  ["Жанна", ["00111", "00011", "00001", "00010", "10000", "11000"]],
  ["Канат", ["00001", "10001", "10000", "01100", "01010", "11111"]],
  ["Мадина", ["01100", "10010", "10111", "00011", "00000", "00000"]],
];

export type DemoPerson = {
  id: number;
  name: string;
  /** busy[пара][день] — занят ли человек. */
  busy: readonly (readonly boolean[])[];
};

export const DEMO_PEOPLE: readonly DemoPerson[] = ROWS.map(([name, rows], id) => ({
  id,
  name,
  busy: rows.map((row) => [...row].map((mark) => mark === "1")),
}));

/** Все восемь — как на карте до первого нажатия. */
export const ALL_IDS: ReadonlySet<number> = new Set(DEMO_PEOPLE.map((person) => person.id));

/** Сколько из выбранных людей свободно в каждой клетке: [пара][день]. */
export function freeCounts(active: ReadonlySet<number>): number[][] {
  return Array.from({ length: PERIODS }, (_, period) =>
    Array.from({ length: DAYS }, (_, day) =>
      DEMO_PEOPLE.reduce((sum, person) => sum + (active.has(person.id) && !person.busy[period][day] ? 1 : 0), 0),
    ),
  );
}

/** Ступень тепловой карты (h0 — свободны все, h5 — никого), как на карте группы. */
export function heatClass(count: number, total: number): string {
  const share = total > 0 ? count / total : 0;
  if (share >= 1) return "h0";
  if (share >= 0.8) return "h1";
  if (share >= 0.6) return "h2";
  if (share >= 0.4) return "h3";
  if (share > 0) return "h4";
  return "h5";
}

export type DemoWindow = { period: number; day: number; count: number };

/**
 * Лучшее окно: клетка, где свободно больше всего выбранных; при равенстве —
 * раньше по дню, затем по паре. Никого не выбрано — окна нет.
 */
export function bestWindow(active: ReadonlySet<number>): DemoWindow | null {
  if (active.size === 0) return null;
  const counts = freeCounts(active);
  let best: DemoWindow | null = null;
  for (let day = 0; day < DAYS; day += 1) {
    for (let period = 0; period < PERIODS; period += 1) {
      const count = counts[period][day];
      if (!best || count > best.count) best = { period, day, count };
    }
  }
  return best;
}

/** Сколько из всех восьми свободно в клетке — для подписи «свободны 7 из 8». */
export function freeOfAll(period: number, day: number): number {
  return DEMO_PEOPLE.filter((person) => !person.busy[period][day]).length;
}
