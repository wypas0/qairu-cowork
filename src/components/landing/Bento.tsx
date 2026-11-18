import { type Lang, t as tl, tn, translator, weekdayShort } from "@/i18n";
import { BentoGrid } from "./BentoGrid";
import { initials } from "../friends/initials";
import { type BestOption, TileBest } from "./TileBest";
import { TileBot } from "./TileBot";
import { TileCampus } from "./TileCampus";
import { TileLangs } from "./TileLangs";
import { TilePair } from "./TilePair";
import { TileRepeat } from "./TileRepeat";

/** Сколько человек в выдуманной группе плиток — как в демо витрины. */
const TOTAL = 8;

/** «Лучшее время» для трёх длин: [день недели, начало, конец, сколько свободно]. */
const BEST: [number, [number, string, string, number][]][] = [
  [45, [[2, "12:10", "12:55", 8], [0, "08:00", "08:45", 7], [4, "13:10", "13:55", 7]]],
  [90, [[3, "14:00", "15:30", 8], [2, "11:10", "12:40", 7], [0, "15:00", "16:30", 6]]],
  [180, [[5, "10:00", "13:00", 8], [4, "14:00", "17:00", 6], [1, "15:00", "18:00", 5]]],
];

/** Длина встречи теми же словами, что в полосе подбора: «45 мин», «1 ч 30 мин», «3 ч». */
function durationText(lang: string, minutes: number): string {
  const t = translator(lang);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t("w_duration_m", { m });
  if (m === 0) return t("w_duration_h", { h });
  return t("w_duration_hm", { h, m });
}

/** Сегменты языков плитки: подписи на своём языке, как в переключателе языка. */
const LANG_SHORT: [Lang, string][] = [
  ["ru", "Рус"],
  ["kk", "Қаз"],
  ["en", "Eng"],
];

/**
 * Л4. «Что внутри»: шесть стеклянных плиток с маленькими живыми виджетами.
 * Заголовки и тексты — с сервера; виджеты — отдельные клиентские компоненты,
 * которым тексты приходят готовыми (словари в браузер не едут). Тексты не
 * обещают того, чего нет в продукте: меняется поведение — поправь плитку.
 */
export function Bento({ lang }: { lang: string }) {
  const t = translator(lang);
  const free = (n: number) => (n === TOTAL ? t("w_best_all") : tn(lang, "w_l_free_of", n, { total: TOTAL }));
  const best: BestOption[] = BEST.map(([minutes, rows]) => ({
    label: durationText(lang, minutes),
    rows: rows.map(([day, start, end, count]) => ({
      when: `${weekdayShort(lang, day)} ${start}–${end}`,
      free: free(count),
    })),
  }));

  return (
    <section className="bento-section" aria-labelledby="bento-title">
      <h2 id="bento-title" className="section-title">
        {t("w_l_bento_title")}
      </h2>
      <BentoGrid>
        <article className="tile tile-wide">
          <h3>{t("w_best_title")}</h3>
          <p className="small muted">{t("w_l_best_d")}</p>
          <div className="tile-widget">
            <TileBest options={best} label={t("w_duration")} />
          </div>
        </article>

        <article className="tile">
          <h3>{t("w_l_bot_t")}</h3>
          <p className="small muted">{t("w_l_bot_d")}</p>
          <div className="tile-widget">
            <TileBot
              goal={t("w_l_bot_goal")}
              when={`${weekdayShort(lang, 2)}, 12:10`}
              answers={{ yes: t("w_l_bot_yes"), maybe: t("w_l_bot_maybe"), no: t("w_l_bot_no") }}
              going={[tn(lang, "w_l_going", 3, { total: TOTAL }), tn(lang, "w_l_going", 4, { total: TOTAL })]}
            />
          </div>
        </article>

        <article className="tile">
          <h3>{t("w_l_campus_t")}</h3>
          <p className="small muted">{t("w_l_campus_d")}</p>
          <div className="tile-widget tile-campus">
            <TileCampus go={t("w_l_campus_btn")} done={t("w_l_campus_done")} />
          </div>
        </article>

        <article className="tile tile-wide">
          <h3>{t("w_l_repeat_t")}</h3>
          <p className="small muted">{t("w_l_repeat_d")}</p>
          <div className="tile-widget">
            <TileRepeat
              label={t("w_repeat")}
              weeks={[t("w_l_week_0"), t("w_l_week_1"), t("w_l_week_2")]}
              days={[0, 1, 2, 3, 4].map((day) => weekdayShort(lang, day))}
            />
          </div>
        </article>

        <article className="tile tile-wide">
          <h3>{t("w_l_pair_t")}</h3>
          <p className="small muted">{t("w_l_pair_d")}</p>
          <div className="tile-widget">
            <TilePair
              people={[
                [initials("Амир"), "Амир"],
                [initials("Асель"), "Асель"],
              ]}
              day={weekdayShort(lang, 3)}
              hint={t("w_l_pair_hint")}
              free={t("w_l_pair_free", { time: "{time}" })}
            />
          </div>
        </article>

        <article className="tile">
          <TileLangs
            initial={lang}
            label={t("w_l_langs_label")}
            texts={LANG_SHORT.map(([code, short]) => ({
              lang: code,
              short,
              title: tl(code, "w_l_langs_t"),
              text: tl(code, "w_l_langs_d"),
            }))}
          />
        </article>
      </BentoGrid>
    </section>
  );
}
