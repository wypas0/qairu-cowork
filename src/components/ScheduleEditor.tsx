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
  photoTitle: string;
  photoHint: string;
  photoBtn: string;
  photoWorking: string;
  photoFailed: string;
  photoTooLarge: string;
  photoLimit: string;
  photoBusy: string;
  photoNotConfigured: string;
  photoTooMany: string; // «{n}»
};

/** Не больше 2 скриншотов за раз, каждый меньше мегабайта — те же лимиты проверяет сервер. */
const MAX_PHOTOS = 2;
const PHOTO_MAX_BYTES = 1024 * 1024 - 1;
/** Исходный файл больше этого даже не открываем — это не скриншот. */
const SOURCE_MAX_BYTES = 20 * 1024 * 1024;

class PhotoTooLarge extends Error {}

/** Размер data URL в байтах без декодирования. */
function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}

/**
 * Перекодировать скриншот в JPEG меньше мегабайта. Сначала пробуем 1800 px
 * и хорошее качество, если не влезло — уменьшаем размер и качество.
 */
async function shrinkPhoto(file: File): Promise<string> {
  if (file.size > SOURCE_MAX_BYTES) throw new PhotoTooLarge();
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("decode"));
      element.src = url;
    });
    const attempts: [number, number][] = [
      [1800, 0.88],
      [1600, 0.8],
      [1400, 0.72],
      [1200, 0.65],
    ];
    for (const [maxSide, quality] of attempts) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas");
      // Прозрачный PNG на чёрном фоне читается хуже — подкладываем белый.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrlBytes(dataUrl) <= PHOTO_MAX_BYTES) return dataUrl;
    }
    throw new PhotoTooLarge();
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
  weekdayShort,
  photoEnabled,
  labels,
}: {
  slug: string;
  step: number;
  slotTimes: number[];
  initialBusy: string[];
  weekdayNames: string[];
  weekdayShort: string[];
  photoEnabled: boolean;
  labels: EditorLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Set<string>>(() => new Set(initialBusy));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{ slots: ParsedSlot[]; errors: string[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [photoWorking, setPhotoWorking] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

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

  /**
   * Раскрасить сетку по распознанным парам, ничего не сохраняя: человек
   * сначала видит результат и только потом жмёт «Сохранить».
   * Клетка занята, если пара задевает её хотя бы частично.
   */
  function applyParsed(slots: ParsedSlot[], errors: string[]) {
    const next = new Set<string>();
    for (const slot of slots) {
      for (const start of slotTimes) {
        if (start < slot.end && start + step > slot.start) next.add(cellKey(slot.weekday, start));
      }
    }
    setBusy(next);
    setDirty(true);
    setPreview({ slots, errors });
  }

  async function runPhotoImport(files: File[]) {
    if (files.length === 0) return;
    if (files.length > MAX_PHOTOS) {
      setFailed(labels.photoTooMany.replace("{n}", String(MAX_PHOTOS)));
      return;
    }
    setPhotoWorking(true);
    setFailed(null);
    try {
      const images = await Promise.all(files.map(shrinkPhoto));
      const response = await fetch(`/api/g/${slug}/import-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ images }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        slots?: ParsedSlot[];
        error?: string;
      };
      if (!response.ok || !data.ok || !data.slots) {
        setPreview(null);
        const messages: Record<string, string> = {
          too_large: labels.photoTooLarge,
          limit: labels.photoLimit,
          busy: labels.photoBusy,
          not_configured: labels.photoNotConfigured,
        };
        setFailed(messages[data.error ?? ""] ?? labels.photoFailed);
        return;
      }
      applyParsed(data.slots, []);
    } catch (error) {
      setFailed(error instanceof PhotoTooLarge ? labels.photoTooLarge : labels.photoFailed);
    } finally {
      setPhotoWorking(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  async function runImport() {
    if (!importText.trim()) return;
    setImporting(true);
    setFailed(null);
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
        setFailed(labels.importFailed);
        return;
      }
      applyParsed(data.slots, data.errors);
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
        {photoEnabled && (
          <section className="card">
            <h2>{labels.photoTitle}</h2>
            <p className="small muted">{labels.photoHint}</p>
            <input
              ref={photoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(event) => void runPhotoImport([...(event.target.files ?? [])])}
            />
            <button
              className="btn btn-primary"
              type="button"
              disabled={photoWorking || importing}
              onClick={() => photoRef.current?.click()}
            >
              {photoWorking ? labels.photoWorking : labels.photoBtn}
            </button>
            {photoWorking && (
              <p className="small muted waiting" role="status" aria-live="polite">
                <span className="spinner" aria-hidden="true" /> {labels.photoWorking}
              </p>
            )}
          </section>
        )}

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
            disabled={importing || photoWorking}
            onClick={runImport}
          >
            {labels.importBtn}
          </button>

          <div style={{ marginTop: 10 }}>
            {failed && (
              <p className="small" role="alert" style={{ color: "var(--danger)" }}>
                {failed}
              </p>
            )}
            {preview && (
              <>
                <p className="small">
                  {labels.importParsed.replace("{n}", String(preview.slots.length))}
                </p>
                <p className="small muted mono">
                  {preview.slots.slice(0, 40).map((slot, index) => (
                    <span key={`${slot.weekday}-${slot.start}-${index}`}>
                      {weekdayShort[slot.weekday]} {slot.text}
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
