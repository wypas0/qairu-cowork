"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { toast } from "./toast";

export type EditorLabels = {
  paintHint: string;
  save: string;
  saved: string;
  unsaved: string;
  saveError: string;
  clear: string;
  importTitle: string;
  importHint: string;
  importBtn: string;
  importParsed: string;
  importFailed: string;
  importPlaceholder: string;
  legendFree: string;
  legendBusy: string;
};

type ParsedSlot = {
  weekday: number;
  start: number;
  end: number;
  label: string;
  text: string;
};

function cellKey(weekday: number, start: number): string {
  return `${weekday}:${start}`;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Редактор своей занятости.
 *
 * Хранится занятость, а не свобода: расписание пар человеку легко продиктовать,
 * а перечислить всё свободное время — нет.
 */
export function ScheduleEditor({
  slug,
  step,
  slotTimes,
  initialBusy,
  weekdayNames,
  labels,
}: {
  slug: string;
  step: number;
  slotTimes: number[];
  initialBusy: string[];
  weekdayNames: string[];
  labels: EditorLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Set<string>>(() => new Set(initialBusy));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{ slots: ParsedSlot[]; errors: string[] } | null>(null);
  const [failed, setFailed] = useState(false);

  const painting = useRef(false);
  const paintTo = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((keys: string[], value: boolean) => {
    if (keys.length === 0) return;
    setBusy((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const key of keys) {
        if (value ? !next.has(key) : next.has(key)) {
          changed = true;
          if (value) next.add(key);
          else next.delete(key);
        }
      }
      if (!changed) return previous;
      return next;
    });
    setDirty(true);
  }, []);

  // Предупреждаем о несохранённом: нарисованная сетка легко теряется по Back.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    function stop() {
      painting.current = false;
    }
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("td.cell");
    if (!cell?.dataset.key) return;
    event.preventDefault();
    painting.current = true;
    paintTo.current = !busy.has(cell.dataset.key);
    apply([cell.dataset.key], paintTo.current);
    rootRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!painting.current) return;
    // При захвате указателя события идут только на контейнер, поэтому
    // клетку под пальцем ищем по координатам — так работает и протяжка мышью.
    const node = document.elementFromPoint(event.clientX, event.clientY);
    const cell = node instanceof Element ? node.closest<HTMLElement>("td.cell") : null;
    if (cell?.dataset.key) apply([cell.dataset.key], paintTo.current);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== " " && event.key !== "Enter") return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>("td.cell");
    if (!cell?.dataset.key) return;
    event.preventDefault();
    apply([cell.dataset.key], !busy.has(cell.dataset.key));
  }

  function toggleDay(weekday: number) {
    const keys = slotTimes.map((start) => cellKey(weekday, start));
    const allBusy = keys.every((key) => busy.has(key));
    apply(keys, !allBusy);
  }

  function clearAll() {
    apply(
      weekdayNames.flatMap((_, weekday) => slotTimes.map((start) => cellKey(weekday, start))),
      false,
    );
  }

  /** Собрать клетки обратно в интервалы. */
  function collect(): { weekday: number; start: number; end: number }[] {
    const slots: { weekday: number; start: number; end: number }[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      let runStart: number | null = null;
      let previousEnd = 0;
      for (const start of slotTimes) {
        if (busy.has(cellKey(weekday, start))) {
          if (runStart === null) runStart = start;
          previousEnd = start + step;
        } else if (runStart !== null) {
          slots.push({ weekday, start: runStart, end: previousEnd });
          runStart = null;
        }
      }
      if (runStart !== null) slots.push({ weekday, start: runStart, end: previousEnd });
    }
    return slots;
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`/api/g/${slug}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ slots: collect() }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setDirty(false);
      toast(labels.saved);
      router.refresh();
    } catch {
      toast(labels.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function runImport() {
    if (!importText.trim()) return;
    setImporting(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/g/${slug}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ text: importText }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as {
        ok: boolean;
        slots: ParsedSlot[];
        errors: string[];
      };
      if (!data.ok) {
        setPreview(null);
        setFailed(true);
        return;
      }
      // Раскрашиваем сетку по распознанным парам, ничего не сохраняя:
      // человек сначала видит результат и только потом жмёт «Сохранить».
      const next = new Set<string>();
      for (const slot of data.slots) {
        for (let minute = slot.start; minute < slot.end; minute += step) {
          if (slotTimes.includes(minute)) next.add(cellKey(slot.weekday, minute));
        }
      }
      setBusy(next);
      setDirty(true);
      setPreview({ slots: data.slots, errors: data.errors });
    } catch {
      toast(labels.saveError);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="grid-2">
      <section className="card">
        <p className="small muted">{labels.paintHint}</p>

        <div
          className="gridwrap"
          ref={rootRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
          style={{ touchAction: "none" }}
        >
          <table className="week editor">
            <thead>
              <tr>
                <th className="timecol" />
                {weekdayNames.map((name, weekday) => (
                  <th key={name}>
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      style={{ padding: "2px 6px" }}
                      onClick={() => toggleDay(weekday)}
                    >
                      {name.slice(0, 3)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slotTimes.map((start, row) => (
                <tr key={start}>
                  <td className="timecol">{row % 2 === 0 ? hhmm(start) : ""}</td>
                  {weekdayNames.map((name, weekday) => {
                    const key = cellKey(weekday, start);
                    const isBusy = busy.has(key);
                    return (
                      <td
                        key={key}
                        className={`cell${isBusy ? " busy" : ""}`}
                        tabIndex={0}
                        role="button"
                        aria-pressed={isBusy}
                        aria-label={`${name} ${hhmm(start)}`}
                        data-key={key}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="legend">
          <i className="swatch-free" />
          <span>{labels.legendFree}</span>
          <i className="swatch-busy" />
          <span>{labels.legendBusy}</span>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <button
            className="btn btn-primary"
            type="button"
            style={{ flex: "0 0 auto" }}
            disabled={saving}
            onClick={save}
          >
            {dirty ? labels.unsaved : labels.save}
          </button>
          <button
            className="btn btn-quiet"
            type="button"
            style={{ flex: "0 0 auto" }}
            onClick={clearAll}
          >
            {labels.clear}
          </button>
        </div>
      </section>

      <div>
        <section className="card">
          <h2>{labels.importTitle}</h2>
          <p className="small muted">{labels.importHint}</p>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={labels.importPlaceholder}
          />
          <button
            className="btn"
            type="button"
            style={{ marginTop: 8 }}
            disabled={importing}
            onClick={runImport}
          >
            {labels.importBtn}
          </button>

          <div style={{ marginTop: 10 }}>
            {failed && <p className="muted small">{labels.importFailed}</p>}
            {preview && (
              <>
                <p className="small">
                  {labels.importParsed.replace("{n}", String(preview.slots.length))}
                </p>
                <p className="small muted mono">
                  {preview.slots.slice(0, 12).map((slot, index) => (
                    <span key={`${slot.weekday}-${slot.start}-${index}`}>
                      {slot.text}
                      {slot.label ? ` · ${slot.label}` : ""}
                      <br />
                    </span>
                  ))}
                </p>
                {preview.errors.length > 0 && (
                  <p className="small muted">⚠️ {preview.errors.join(" · ")}</p>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
