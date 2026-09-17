import { translator, weekdayShort } from "@/i18n";

/**
 * Окно продукта на лендинге.
 *
 * Собрано из настоящей разметки и настоящих классов — той же таблицы недели,
 * тех же клеток тепловой карты и той же карточки «лучшего времени», что и
 * внутри. Рисовать вместо продукта абстрактную картинку нельзя: человек должен
 * увидеть ровно то, что получит.
 *
 * Данные выдуманные, но фиксированные: никакой случайности, иначе сервер и
 * клиент нарисуют разное.
 */

/** Сколько человек свободно в каждой клетке: 6 пар × 5 дней, всего восемь человек. */
const FREE: number[][] = [
  [8, 8, 3, 8, 8],
  [2, 8, 3, 6, 8],
  [2, 5, 8, 6, 8],
  [8, 5, 8, 8, 4],
  [8, 8, 8, 8, 4],
  [6, 3, 8, 5, 8],
];

const TOTAL = 8;

const TIMES = [
  ["1", "08:00"],
  ["2", "09:00"],
  ["3", "10:00"],
  ["4", "11:10"],
  ["5", "12:10"],
  ["6", "13:10"],
];

function heatClass(count: number): string {
  const share = count / TOTAL;
  if (share >= 1) return "h0";
  if (share >= 0.8) return "h1";
  if (share >= 0.6) return "h2";
  if (share >= 0.4) return "h3";
  if (share > 0) return "h4";
  return "h5";
}

export function ProductDemo({ lang }: { lang: string }) {
  const t = translator(lang);
  const days = [0, 1, 2, 3, 4].map((weekday) => weekdayShort(lang, weekday));

  return (
    <div className="demo" aria-hidden="true">
      <div className="demo-best">
        <span className="type-title-3">12:10–13:00</span>
        <span className="small muted">
          {days[2]} · {t("w_best_all")}
        </span>
      </div>

      <table className="week periods demo-week">
        <thead>
          <tr>
            <th className="timecol" />
            {days.map((day) => (
              <th key={day}>{day}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FREE.map((row, index) => (
            <tr key={TIMES[index][0]}>
              <td className="timecol period">
                <span className="period-n">{TIMES[index][0]}</span>
                <span className="period-time">{TIMES[index][1]}</span>
              </td>
              {row.map((count, day) => (
                <td className={`cell ${heatClass(count)}`} key={day} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="legend">
        <span>{t("w_legend_all")}</span>
        {["h0", "h1", "h2", "h3", "h4", "h5"].map((cls) => (
          <i key={cls} className={cls} />
        ))}
        <span>{t("w_legend_none")}</span>
      </div>
    </div>
  );
}
