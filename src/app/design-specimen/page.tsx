import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Contrast } from "./Contrast";

/*
 * Образец дизайн-системы: палитра с живым расчётом контраста, шрифты на трёх
 * языках, все компоненты. Внутренний инструмент разработчика, а не страница
 * продукта, поэтому тексты здесь не через i18n. На проде — 404; открыть
 * можно в `next dev` или с DESIGN_SPECIMEN=1 (так делает e2e-server).
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const SAMPLES = {
  ru: { h: "Когда у всех есть общее окно?", p: "Съешь же ещё этих мягких французских булок." },
  kk: { h: "Бәрі қашан бос?", p: "Әкімші топқа қосылды: ғ қ ң ө ұ ү һ і — барлығы бір шрифтпен." },
  en: { h: "When is everyone free?", p: "The quick brown fox jumps over the lazy dog." },
};

export default function Specimen() {
  if (process.env.NODE_ENV === "production" && process.env.DESIGN_SPECIMEN !== "1") notFound();
  return (
    <main className="wrap" style={{ paddingTop: 24, paddingBottom: 48 }}>
      <p className="eyebrow">QairuCowork × qairuhub</p>
      <h1>Образец дизайн-системы</h1>
      <p className="lead">Токены, типографика и компоненты светлой темы. Контраст считается в браузере.</p>

      <section className="card">
        <h2>Палитра и контраст</h2>
        <Contrast />
      </section>

      <section className="card">
        <h2>Типографика на трёх языках</h2>
        {Object.entries(SAMPLES).map(([lang, s]) => (
          <div key={lang} lang={lang} style={{ marginBottom: 24 }}>
            <p className="eyebrow">{lang}</p>
            <p className="type-display" style={{ margin: "0 0 8px" }}>
              {s.h}
            </p>
            <h1 style={{ margin: 0 }}>{s.h}</h1>
            <h2>{s.h}</h2>
            <p>{s.p}</p>
            <p className="small muted">{s.p}</p>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Кнопки</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="button">
            Создать группу
          </button>
          <button className="btn" type="button">
            Скопировать для чата
          </button>
          <button className="btn btn-quiet" type="button">
            Отменить
          </button>
          <button className="btn btn-danger" type="button">
            Отменить встречу
          </button>
          <button className="btn btn-sm" type="button">
            Назначить
          </button>
          <button className="btn btn-primary" type="button" disabled>
            Недоступно
          </button>
        </div>
        <h3 style={{ marginTop: 20 }}>Вкладки и выбор</h3>
        <div className="tabs" role="tablist">
          <button className="tab active" role="tab" aria-selected="true" type="button">
            Время
          </button>
          <button className="tab" role="tab" aria-selected="false" type="button">
            Встречи <span className="count-badge">2</span>
          </button>
          <button className="tab" role="tab" aria-selected="false" type="button">
            Участники
          </button>
          <button className="tab" role="tab" aria-selected="false" type="button">
            Настройки
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button className="daychip active" type="button">
            Пт 25.09
          </button>
          <button className="daychip" type="button">
            Сб 26.09 <span className="count">3</span>
          </button>
          <button className="daychip empty" type="button">
            Вс 27.09
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Поля</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="s-title">Название группы</label>
            <input id="s-title" type="text" placeholder="Например, ИС-21" />
          </div>
          <div className="field">
            <label htmlFor="s-dur">Длительность встречи</label>
            <select id="s-dur" defaultValue="90">
              <option value="60">60 мин</option>
              <option value="90">90 мин</option>
            </select>
          </div>
        </div>
        <label className="checkbox">
          <input type="checkbox" defaultChecked /> Асель
        </label>
        <div className="notice warn" role="alert">
          Код не подошёл. Проверь буквы или попроси новую ссылку.
        </div>
      </section>

      <section className="card">
        <h2>Карта недели</h2>
        <table className="week periods" style={{ minWidth: 0 }}>
          <tbody>
            <tr>
              {[0, 1, 2, 3, 4, 5].map((h) => (
                <td key={h} className={`cell h${h}`} style={{ height: 40 }} />
              ))}
              <td className="cell meeting" style={{ height: 40 }}>
                <span className="cell-meeting">Разбор задач</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="legend" style={{ marginTop: 12 }}>
          <span className="legend-item">
            все <span className="legend-scale">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>{" "}
            никого
          </span>
          <span className="legend-item">
            <i className="swatch-meeting" /> встреча
          </span>
          <span className="legend-item">
            <i className="swatch-soft" /> кому-то неудобно
          </span>
        </div>
        <h3 style={{ marginTop: 20 }}>Редактор</h3>
        <table className="week editor" style={{ minWidth: 0, maxWidth: 360 }}>
          <tbody>
            <tr>
              <td className="cell" style={{ height: 40 }} />
              <td className="cell busy" style={{ height: 40 }} />
              <td className="cell soft" style={{ height: 40 }} />
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card" aria-busy="true">
        <h2>Загрузка (пересчёт окон)</h2>
        <p className="small muted">Полоса бежит по верху карточки, содержимое приглушено.</p>
        <div className="skeleton" style={{ height: 44, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 44 }} />
      </section>

      <div className="empty">
        <h3>Встреч пока нет</h3>
        <p>Выбери время на карте или в «Лучшем времени» — встреча появится здесь.</p>
        <button className="btn btn-primary" type="button">
          Новая встреча
        </button>
      </div>
    </main>
  );
}
