"use client";

import { fmtMinutes } from "@/core/intervals";
import type { BoardPayload } from "@/lib/group";
import { CopyButton } from "../CopyButton";
import { IconClose } from "../icons";
import { type BoardLabels, durationText, whoText } from "./labels";

type SlotDay = BoardPayload["slotDays"][number];

/**
 * «Общие окна»: выбор дня и варианты с кнопкой «Назначить». Длина встречи и
 * кто должен прийти — в полосе подбора над доской (PickBar): они меняют всю
 * вкладку, а не только эту карточку.
 */
export function WindowsCard({
  slotDays,
  day,
  onDay,
  duration,
  selectedTotal,
  loading,
  labels,
  onPick,
  onHide,
}: {
  slotDays: SlotDay[];
  day: SlotDay | undefined;
  onDay: (date: string) => void;
  /** Длина, для которой посчитаны варианты на экране. */
  duration: number;
  selectedTotal: number;
  loading: boolean;
  labels: BoardLabels;
  onPick: (date: string, start: number, end: number, text: string) => void;
  /** Закрыть карточку — как «Лучшее время»: остаётся кнопкой-сводкой. */
  onHide: () => void;
}) {
  // Окна текстом — вставить в чат группы одним сообщением.
  const windowsText = [
    labels.copyHead.replace("{duration}", durationText(duration, labels)),
    ...slotDays
      .filter((entry) => entry.items.length > 0)
      .map(
        (entry) =>
          `${entry.short}: ${entry.items
            .map((item) =>
              item.missing.length > 0
                ? `${item.text} (${labels.copyWithout.replace("{names}", item.missing.join(", "))})`
                : item.text,
            )
            .join(", ")}`,
      ),
  ].join("\n");
  const hasWindows = slotDays.some((entry) => entry.items.length > 0);

  return (
    <section className="card windows-card" aria-busy={loading}>
      <div className="card-head best-head">
        <h2>{labels.windowsTitle}</h2>
        <button
          type="button"
          className="icon-btn best-close"
          aria-label={labels.windowsHide}
          title={labels.windowsHide}
          onClick={onHide}
        >
          <IconClose size={18} />
        </button>
      </div>

      <div className="field">
        <span className="label" id="slot-day-label">
          {labels.day}
        </span>
        <div className="daypicker" role="radiogroup" aria-labelledby="slot-day-label">
          {slotDays.map((entry) => {
            const active = entry.date === day?.date;
            return (
              <button
                key={entry.date}
                type="button"
                role="radio"
                aria-checked={active}
                className={`daychip${active ? " active" : ""}${entry.items.length === 0 ? " empty" : ""}`}
                onClick={() => onDay(entry.date)}
                title={entry.label}
              >
                <span>{entry.short}</span>
              </button>
            );
          })}
        </div>
      </div>

      {day && (
        <p className="small muted windows-meta">
          {day.label} · {labels.variantsTemplate.replace("{n}", String(day.items.length))} ·{" "}
          {durationText(duration, labels)}
        </p>
      )}

      <div className="slotlist">
        {selectedTotal === 0 ? (
          <p className="muted small">{labels.windowsNoData}</p>
        ) : !day || day.items.length === 0 ? (
          <p className="muted small">{labels.windowsEmpty}</p>
        ) : (
          <ul className="windows">
            {day.items.map((item) => (
              <li key={`${day.date}-${item.start}`} className="slotrow">
                <div className="slotinfo">
                  <span className="when">{item.text}</span>{" "}
                  <span className="small muted">{whoText(item, selectedTotal, labels)}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    // Окно может быть длиннее встречи — ставим её в начало окна.
                    const end = item.start + duration;
                    onPick(day.date, item.start, end, `${day.label} · ${fmtMinutes(item.start)}–${fmtMinutes(end)}`);
                  }}
                >
                  {labels.pick}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Окна недели текстом — для чата группы; внизу, после того как их посмотрели. */}
      {hasWindows && (
        <div className="windows-copy">
          <CopyButton value={windowsText} label={labels.copyWindows} copiedLabel={labels.copiedWindows} small />
        </div>
      )}
    </section>
  );
}
