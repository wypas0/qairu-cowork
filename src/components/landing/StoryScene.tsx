import { ALL_IDS, DEMO_PEOPLE, DEMO_PERIODS, bestWindow, freeCounts, heatClass } from "@/core/landingDemo";
import { translator, weekdayShort } from "@/i18n";
import { ScrollStory } from "./ScrollStory";

/** Место карточки человека: веер на широком экране и сетка 4 × 2 (в долях её размера). */
function cardPlace(index: number): React.CSSProperties {
  const offset = index - (DEMO_PEOPLE.length - 1) / 2;
  const col = index % 4;
  const row = Math.floor(index / 4);
  return {
    "--fx": `${(offset * 44).toFixed(1)}%`,
    "--fy": `${(offset * offset * 3 - 14).toFixed(1)}%`,
    "--fr": `${(offset * 6).toFixed(1)}deg`,
    "--gx": `${((col - 1.5) * 112).toFixed(1)}%`,
    "--gy": `${((row - 0.5) * 112).toFixed(1)}%`,
    "--i": index,
  } as React.CSSProperties;
}

/**
 * Л2. «Как складывается неделя»: восемь недель веером складываются в общую
 * карту, на ней находится окно и встреча. Разметка целиком с сервера — до
 * гидратации и без JS сцена читается (подписи и веер на месте); двигает её
 * прокрутка через `--p` (ScrollStory, landing.css).
 */
export function StoryScene({ lang }: { lang: string }) {
  const t = translator(lang);
  const days = [0, 1, 2, 3, 4].map((weekday) => weekdayShort(lang, weekday));
  const counts = freeCounts(ALL_IDS);
  const best = bestWindow(ALL_IDS)!;
  const period = DEMO_PERIODS[best.period];

  return (
    <ScrollStory labelledBy="story-title">
      <div className="story-scene">
        <div className="story-steps">
          <h2 id="story-title" className="eyebrow story-title">
            {t("w_l_story_title")}
          </h2>
          <span className="story-bar" aria-hidden="true" />
          <ol className="story-list">
            {([1, 2, 3] as const).map((n) => (
              <li className="story-step" key={n} style={{ "--n": n - 1 } as React.CSSProperties}>
                <span className="step-n display-caps" aria-hidden="true">
                  0{n}
                </span>
                <div>
                  <h3>{t(`w_step${n}_t`)}</h3>
                  <p className="small muted">{t(`w_step${n}_d`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Картинка к подписям: смысл несут подписи слева. */}
        <div className="story-field" aria-hidden="true">
          <div className="story-map">
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
                {DEMO_PERIODS.map((row, index) => (
                  <tr key={row.n}>
                    <td className="timecol period">
                      <span className="period-line">
                        <b className="period-n">{row.n}</b>
                        <span className="period-start">{row.start}</span>
                      </span>
                    </td>
                    {counts[index].map((count, day) => {
                      const isBest = index === best.period && day === best.day;
                      return (
                        <td className={`cell ${heatClass(count, ALL_IDS.size)}${isBest ? " best" : ""}`} key={day}>
                          {isBest && <span className="story-meet">{t("w_l_story_meeting")}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="story-cards">
            {DEMO_PEOPLE.map((person) => (
              <div className="story-card" key={person.id} style={cardPlace(person.id)}>
                <span className="story-card-name">{person.name}</span>
                <span className="story-week">
                  {person.busy.flatMap((row, periodIndex) =>
                    row.map((busy, day) => <i key={`${periodIndex}-${day}`} className={busy ? "busy" : undefined} />),
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="story-result">
            <b className="type-title-3">
              {period.start}–{period.end}
            </b>
            <span className="small muted">
              {days[best.day]} · {t("w_best_all")}
            </span>
          </div>
        </div>
      </div>
    </ScrollStory>
  );
}
