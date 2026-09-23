"use client";

import type { BoardBest } from "@/lib/group";
import { IconClose } from "../icons";
import { type BoardLabels, daysText, whoText } from "./labels";

/**
 * «Лучшее время» — главный ответ страницы: два-три окна, где свободно больше
 * всего людей. Закрывается крестиком (кто назначает по карте, тому список не
 * нужен) и остаётся одной строкой — вернуть его можно в одно нажатие.
 */
export function BestTime({
  best,
  total,
  hidden,
  loading,
  labels,
  onToggle,
  onPick,
}: {
  best: BoardBest[];
  total: number;
  hidden: boolean;
  loading: boolean;
  labels: BoardLabels;
  onToggle: (hide: boolean) => void;
  onPick: (date: string, start: number, end: number, text: string) => void;
}) {
  if (hidden) {
    return (
      <section className="card best-collapsed">
        <div className="card-head">
          <h2>{labels.bestTitle}</h2>
          <button type="button" className="btn btn-sm" onClick={() => onToggle(false)}>
            {labels.bestShow}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card" aria-busy={loading}>
      <div className="card-head best-head">
        <h2>{labels.bestTitle}</h2>
        <button
          type="button"
          className="icon-btn best-close"
          aria-label={labels.bestHide}
          title={labels.bestHide}
          onClick={() => onToggle(true)}
        >
          <IconClose size={18} />
        </button>
      </div>
      <p className="small muted">{labels.bestLead}</p>
      {best.length === 0 ? (
        <div className="empty">
          <h3>{labels.bestEmpty}</h3>
        </div>
      ) : (
        <ul className="best-list">
          {best.map((item) => {
            const first = item.dates[0];
            return (
              <li className="best-item" key={`${first.date}-${item.start}`}>
                <span className="type-title-3 best-time">{item.text}</span>
                <div className="best-text">
                  <b className="best-days">{daysText(item.dates, labels)}</b>
                  <span className="small muted">{whoText(item, total, labels)}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onPick(first.date, item.start, item.end, `${first.label} · ${item.text}`)}
                >
                  {labels.pick}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
