"use client";

import { fmtMinutes } from "@/core/intervals";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { Period, WeeklySlot } from "@/core/grid";
import { SOFT_PREFIX, editorCells, editorSlots, periodOverlaps } from "@/core/grid";
import { LATEST_EXTENSION, PAGE_SOURCE, campusScheduleUrl, olderVersion, readExtensionMessage, supportsIntent } from "@/core/extensionImport";
import { haptic, webApp, whenReady } from "@/lib/telegram";
import { moveFocusByArrow } from "./gridKeys";
import { IconArrowDown, IconCheck, IconChevronRight, IconGrid } from "./icons";
import { BreakRow, PeriodTime } from "./PeriodRow";
import { TelegramMainButton } from "./TelegramButtons";
import { toast } from "./toast";
import { desktopChromium, startCampusTransfer, useCampusExtension } from "./useCampusExtension";

export type EditorLabels = {
  paintHint: string;
  saved: string;
  notFilledYet: string;
  saving: string;
  saveError: string;
  saveRetry: string;
  done: string;
  undo: string;
  clear: string;
  busyTotal: string; // «Занято {h} ч в неделю»
  tplTitle: string;
  tplEvenings: string;
  tplWeekendFree: string;
  tplWeekendBusy: string;
  chooseTitle: string;
  chooseLead: string;
  /** Первый экран: «из кампуса» — подсказка зависит от того, стоит ли расширение. */
  chooseCampus: string;
  chooseCampusHint: string;
  chooseCampusInstall: string;
  chooseCampusUpdate: string;
  chooseCampusDesktop: string;
  chooseManual: string;
  chooseManualHint: string;
  /** То же для пар, пришедших из расширения кампуса. */
  campusReview: string; // «Пары из кампуса: {n}…»
  importSave: string;
  importCancel: string;
  importPending: string;
  legendFree: string;
  legendBusy: string;
  /** «Неудобно» в легенде и на кисти. */
  legendSoft: string;
  brushLabel: string;
  brushBusy: string;
  brushSoft: string;
  breakRow: string; // «Перерыв {m} мин»
  /** Дневной вид на телефоне: подпись к выбору дня и кнопка на весь день. */
  dayPick: string;
  dayAllBusy: string;
  dayAllFree: string;
};

/**
 * «Неудобно» лежит в том же множестве клеток, что и «занят», с этим
 * префиксом: отмена, шаблоны и автосохранение работают с обоими сразу.
 * Клетка бывает либо занятой, либо неудобной, но не обеими.
 */
const SOFT = SOFT_PREFIX;
type Brush = "busy" | "soft";

/** Ключ клетки в множестве для этой кисти. */
function own(key: string, kind: Brush): string {
  return kind === "soft" ? SOFT + key : key;
}

/**
 * Ключ клетки под элементом. Клетки дневного вида (телефон) несут его в
 * data-day-key, а не в data-key: в разметке лежат оба вида сразу, и один
 * data-key на две клетки путал бы и поиск клетки, и тесты.
 */
function keyOf(target: EventTarget | null): string | null {
  const cell = target instanceof Element ? target.closest<HTMLElement>("td.cell") : null;
  return cell?.dataset.key ?? cell?.dataset.dayKey ?? null;
}

/** Сколько держать палец на клетке, чтобы начать мазок, и сколько ему можно сместиться. */
const HOLD_MS = 320;
const HOLD_SLOP = 8;

/** Откуда пришли пары на проверку — пока только расширение кампуса. */
type ImportSource = "campus";

type ParsedSlot = {
  weekday: number;
  start: number;
  end: number;
  label: string;
  parity?: number | null;
  kind?: string;
  text: string;
  /** Период и исключения (пары из кампуса), см. WeeklySlot. */
  from?: string | null;
  to?: string | null;
  except?: string[];
};

function cellKey(weekday: number, start: number): string {
  return `${weekday}:${start}`;
}

/**
 * Редактор своей занятости.
 *
 * Хранится занятость, а не свобода: расписание пар человеку легко продиктовать,
 * а перечислить всё свободное время — нет.
 */
export function ScheduleEditor({
  slug,
  periods,
  initialSlots,
  backHref,
  weekdayNames,
  weekdayShort,
  todayWeekday,
  campus,
  hint,
  labels,
}: {
  slug: string;
  /** Ряды сетки — пары. Занятость хранится по началу пары. */
  periods: Period[];
  /** Сохранённая недельная занятость, включая «неудобно». */
  initialSlots: WeeklySlot[];
  /** Куда ведёт главная кнопка Telegram, когда всё сохранено. */
  backHref: string;
  weekdayNames: string[];
  weekdayShort: string[];
  /** Сегодня по часовому поясу группы, 0 = пн: с него открывается дневной вид. */
  todayWeekday: number;
  /** Группа и язык — для «Перенести из кампуса» на первом экране. */
  campus: { title: string; lang: string };
  /** Подсказка расширения кампуса — вверху карточки редактора. */
  hint?: React.ReactNode;
  labels: EditorLabels;
}) {
  const router = useRouter();
  const [initialBusy] = useState(() => editorCells(periods, initialSlots));
  const [busy, setBusy] = useState<Set<string>>(() => new Set(initialBusy));
  // Интервалы, по которым раскрашена сетка: из них при сохранении берутся
  // подписи, чётность, вид и точное время тех клеток, которых не трогали.
  const base = useRef<WeeklySlot[]>(initialSlots);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failedSave, setFailedSave] = useState(false);
  // Было ли расписание хоть раз сохранено: иначе «✓ Сохранено» у пустой
  // сетки новичка звучит как «всё готово», хотя он ещё ничего не сделал.
  const [savedOnce, setSavedOnce] = useState(initialBusy.length > 0);
  // Шаги для отмены: один шаг — один мазок или одно целое действие.
  const [history, setHistory] = useState<{ cells: Set<string>; base: WeeklySlot[] }[]>([]);
  const [preview, setPreview] = useState<{ slots: ParsedSlot[]; source: ImportSource; count: number } | null>(null);
  // Откуда последний импорт (и версия расширения): уходит на сервер с первым
  // сохранением после него — для сводки у старосты и статистики.
  const importOrigin = useRef<{ origin: ImportSource; ext: string | null } | null>(null);
  // Пришедшее из кампуса ждёт проверки: пока человек не нажал
  // «Сохранить», автосохранение молчит. Снимок — чтобы «Отменить импорт»
  // вернул сетку ровно к тому, что было до него.
  const [reviewing, setReviewing] = useState(false);
  const beforeImport = useRef<{ busy: Set<string>; dirty: boolean; base: WeeklySlot[] } | null>(null);

  // Первый раз расписание заполняют не сразу сеткой: сперва человек выбирает
  // способ — перенести из кампуса или отметить вручную.
  const startedEmpty = useRef(initialBusy.length === 0);
  const [mode, setMode] = useState<"choose" | "manual">(() => (initialBusy.length === 0 ? "choose" : "manual"));
  const painting = useRef(false);
  const paintTo = useRef(true);
  // Чем красим: «занят» (пары, работа) или «неудобно» (могу, но не хочу).
  const [brush, setBrush] = useState<Brush>("busy");
  // День дневного вида на телефоне.
  const [day, setDay] = useState(todayWeekday);
  const brushRef = useRef<Brush>("busy");
  useEffect(() => {
    brushRef.current = brush;
  }, [brush]);
  const rootRef = useRef<HTMLDivElement>(null);
  // Последняя клетка под пальцем: тактильный отклик даём на каждую новую, а не на каждое событие.
  const lastPainted = useRef<string | null>(null);
  // Касание, по которому ещё не решено, что это: прокрутка, тап или мазок.
  const pending = useRef<{ key: string; x: number; y: number; pointerId: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);


  // Текущая сетка для обработчиков, которым нужно её значение, а не перерисовка.
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  /** Запомнить состояние перед изменением. Глубина ограничена — это отмена, а не журнал. */
  const pushHistory = useCallback(() => {
    setHistory((previous) => [...previous.slice(-19), { cells: new Set(busyRef.current), base: base.current }]);
  }, []);

  const undo = useCallback(() => {
    setHistory((previous) => {
      if (previous.length === 0) return previous;
      const step = previous[previous.length - 1];
      base.current = step.base;
      setBusy(step.cells);
      setDirty(true);
      haptic("press");
      return previous.slice(0, -1);
    });
  }, []);

  const apply = useCallback((keys: string[], value: boolean, kind: Brush = "busy") => {
    if (keys.length === 0) return;
    setBusy((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const key of keys) {
        const mine = own(key, kind);
        const other = own(key, kind === "soft" ? "busy" : "soft");
        if (value) {
          if (!next.has(mine)) {
            next.add(mine);
            changed = true;
          }
          // Занятая клетка не может быть заодно «неудобной» и наоборот.
          if (next.has(other)) {
            next.delete(other);
            changed = true;
          }
        } else if (next.has(mine)) {
          next.delete(mine);
          changed = true;
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

  // То же самое внутри Telegram: свайп вниз закрывает мини-апп мгновенно.
  useEffect(
    () =>
      whenReady((app) => {
        if (dirty) app.enableClosingConfirmation?.();
        else app.disableClosingConfirmation?.();
        return () => app.disableClosingConfirmation?.();
      }),
    [dirty],
  );

  /** Начать мазок от клетки: дальше он тянется за указателем. */
  const startPainting = useCallback(
    (key: string, pointerId: number) => {
      // Прокрутку забираем у браузера ровно на время мазка и делаем это сразу,
      // а не через состояние: перерисовка случится на кадр позже, и палец
      // успеет увести страницу.
      if (rootRef.current) rootRef.current.style.touchAction = "none";
      // Один мазок — один шаг отмены, поэтому запоминаем состояние в начале.
      pushHistory();
      painting.current = true;
      paintTo.current = !busyRef.current.has(own(key, brushRef.current));
      lastPainted.current = key;
      haptic("select");
      apply([key], paintTo.current, brushRef.current);
      try {
        rootRef.current?.setPointerCapture(pointerId);
      } catch {
        // Указателя может уже не быть (палец отпустили в момент удержания) —
        // мазок тогда просто закончится на первой клетке.
      }
    },
    [apply, pushHistory],
  );

  const cancelHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    pending.current = null;
  }, []);

  useEffect(() => {
    function stop() {
      // Короткое касание без движения — это тап по одной клетке.
      const tap = pending.current;
      cancelHold();
      if (tap) {
        pushHistory();
        haptic("select");
        apply([tap.key], !busyRef.current.has(own(tap.key, brushRef.current)), brushRef.current);
      }
      painting.current = false;
      if (rootRef.current) rootRef.current.style.touchAction = "";
    }
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, [apply, cancelHold, pushHistory]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const key = keyOf(event.target);
    if (!key) return;

    if (event.pointerType !== "mouse") {
      // Пальцем сначала листают страницу, и только потом красят. Поэтому здесь
      // не запрещаем прокрутку: мазок начинается после удержания на месте,
      // а короткое касание переключает одну клетку.
      pending.current = { key, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      holdTimer.current = setTimeout(() => {
        const held = pending.current;
        cancelHold();
        if (!held) return;
        startPainting(held.key, held.pointerId);
      }, HOLD_MS);
      return;
    }

    event.preventDefault();
    startPainting(key, event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (pending.current) {
      // Палец поехал раньше, чем сработало удержание, — значит это прокрутка.
      const moved =
        Math.abs(event.clientX - pending.current.x) > HOLD_SLOP ||
        Math.abs(event.clientY - pending.current.y) > HOLD_SLOP;
      if (moved) cancelHold();
      return;
    }
    if (!painting.current) return;
    // При захвате указателя события идут только на контейнер, поэтому
    // клетку под пальцем ищем по координатам — так работает и протяжка мышью.
    const key = keyOf(document.elementFromPoint(event.clientX, event.clientY));
    if (!key) return;
    if (key !== lastPainted.current) {
      lastPainted.current = key;
      haptic("select");
    }
    apply([key], paintTo.current, brushRef.current);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Стрелки ходят по клеткам, пробел и Enter переключают клетку.
    if (moveFocusByArrow(event)) return;
    if (event.key !== " " && event.key !== "Enter") return;
    const key = keyOf(event.target);
    if (!key) return;
    event.preventDefault();
    pushHistory();
    apply([key], !busy.has(own(key, brush)), brush);
  }

  function toggleDay(weekday: number) {
    pushHistory();
    const keys = periods.map((period) => cellKey(weekday, period.start));
    const allBusy = keys.every((key) => busy.has(key));
    apply(keys, !allBusy);
  }

  /**
   * Частые случаи одним нажатием. Каждый шаблон — обычное действие с сеткой:
   * его можно отменить и поправить руками, сохраняется он сам.
   */
  function applyTemplate(kind: "evenings" | "weekendFree" | "weekendBusy") {
    const weekdays = kind === "evenings" ? [0, 1, 2, 3, 4] : [5, 6];
    const rows = kind === "evenings" ? periods.filter((period) => period.start >= 18 * 60) : periods;
    const keys = weekdays.flatMap((weekday) => rows.map((period) => cellKey(weekday, period.start)));
    if (keys.length === 0) return;
    pushHistory();
    haptic("press");
    apply(keys, kind !== "weekendFree");
  }

  function clearAll() {
    pushHistory();
    const keys = weekdayNames.flatMap((_, weekday) => periods.map((period) => cellKey(weekday, period.start)));
    apply(keys, false, "busy");
    apply(keys, false, "soft");
  }

  const save = useCallback(async () => {
    setSaving(true);
    // Клетки — в интервалы; нетронутые пары уходят как были, с подписями и чётностью.
    const slots = editorSlots(periods, base.current, busy);
    try {
      const response = await fetch(`/api/g/${slug}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ slots, ...(importOrigin.current ?? {}) }),
      });
      if (!response.ok) throw new Error(String(response.status));
      importOrigin.current = null;
      // Сохранённое — новая основа: следующие правки сравниваются уже с ним.
      base.current = slots;
      setDirty(false);
      setFailedSave(false);
      setSavedOnce(true);
      router.refresh();
    } catch {
      // Тост только на ошибку: подтверждение успеха живёт строкой состояния,
      // иначе при автосохранении он всплывал бы после каждого мазка.
      setFailedSave(true);
      haptic("error");
      toast(labels.saveError);
    } finally {
      setSaving(false);
    }
  }, [busy, periods, router, slug, labels.saveError]);

  // Сетку не сохраняют кнопкой: ждём паузы в рисовании и сохраняем сами.
  useEffect(() => {
    // После неудачи ждём нажатия «Повторить»: иначе автосохранение будет
    // молча долбить сервер по кругу.
    if (!dirty || saving || failedSave || reviewing) return;
    const timer = setTimeout(() => void save(), 800);
    return () => clearTimeout(timer);
  }, [dirty, saving, failedSave, reviewing, save]);

  // Отмена последнего действия с клавиатуры — привычное сочетание.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // Выбрали «вручную» — показываем сетку.
  useEffect(() => {
    if (mode === "manual" && startedEmpty.current) {
      rootRef.current?.scrollIntoView({ block: "start" });
    }
  }, [mode]);

  /**
   * Раскрасить сетку по парам из кампуса, ничего не сохраняя: человек сначала
   * видит результат, может поправить клетки и только потом жмёт «Сохранить».
   * Клетка занята, если пара задевает её хотя бы частично.
   */
  function applyParsed(
    slots: ParsedSlot[],
    source: ImportSource = "campus",
    count = slots.length,
    ext: string | null = null,
  ) {
    importOrigin.current = { origin: source, ext };
    // Отметки «неудобно» кампус не приносит — их оставляем как были.
    const next = new Set<string>([...busy].filter((key) => key.startsWith(SOFT)));
    for (const slot of slots) {
      for (const period of periods) {
        if (!periodOverlaps(period, slot.start, slot.end)) continue;
        const key = cellKey(slot.weekday, period.start);
        next.add(key);
        next.delete(own(key, "soft"));
      }
    }
    // Повторный импорт поверх непроверенного сравниваем с исходной сеткой, а не с черновиком.
    if (!reviewing) beforeImport.current = { busy: new Set(busy), dirty, base: base.current };
    pushHistory();
    // Пары из кампуса становятся основой сетки вместе с подписями и
    // чётностью: сохранение возьмёт их отсюда, а не из клеток.
    base.current = [
      ...base.current.filter((slot) => slot.kind === "soft"),
      ...slots.map((slot) => ({
        weekday: slot.weekday,
        start: slot.start,
        end: slot.end,
        label: slot.label ?? "",
        parity: slot.parity ?? null,
        kind: slot.kind ?? "class",
        ...(slot.from && slot.to ? { from: slot.from, to: slot.to, except: slot.except ?? [] } : {}),
      })),
    ];
    setBusy(next);
    setDirty(true);
    setReviewing(true);
    setPreview({ slots, source, count });
    rootRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function confirmImport() {
    setReviewing(false);
    beforeImport.current = null;
    haptic("ok");
    void save();
  }

  function cancelImport() {
    const snapshot = beforeImport.current;
    if (snapshot) {
      base.current = snapshot.base;
      setBusy(snapshot.busy);
      setDirty(snapshot.dirty);
    }
    beforeImport.current = null;
    importOrigin.current = null;
    setReviewing(false);
    setPreview(null);
  }

  // Пары из расширения кампуса: оно ждёт «готов» и присылает их сообщением.
  // Обработчик живёт всё время, а раскрашивает сетку текущим applyParsed.
  const applyParsedRef = useRef(applyParsed);
  useEffect(() => {
    applyParsedRef.current = applyParsed;
  });
  useEffect(() => {
    const handled = new Set<string>();
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const incoming = readExtensionMessage(event.data);
      if (!incoming || handled.has(incoming.id)) return;
      handled.add(incoming.id);
      window.postMessage({ source: PAGE_SOURCE, type: "campus-received", id: incoming.id }, window.location.origin);
      setMode("manual");
      applyParsedRef.current(incoming.slots, "campus", incoming.count, incoming.version);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: PAGE_SOURCE, type: "campus-ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Часы занятости за неделю: страховка от главной ошибки — закрасить наоборот.
  const busyHours =
    Math.round(
      ([...busy].filter((key) => !key.startsWith(SOFT)).reduce((sum, key) => {
        const start = Number(key.split(":")[1]);
        const period = periods.find((entry) => entry.start === start);
        return sum + (period ? period.end - period.start : 0);
      }, 0) /
        60) *
        10,
    ) / 10;

  // Первый экран: два пути вместо сетки сразу. «Из кампуса» — главный: если
  // расширение стоит, ссылка сразу открывает кампус, иначе ведёт к установке.
  const extension = useCampusExtension(campus.lang);
  if (mode === "choose") {
    const canTransfer = extension.status === "present" && supportsIntent(extension.version);
    // До ответа расширения (и на сервере) — «поставь»: так разметка совпадает при гидратации.
    const campusOption = canTransfer
      ? { href: campusScheduleUrl(campus.lang), hint: labels.chooseCampusHint, external: true }
      : extension.status === "present" && olderVersion(extension.version ?? "0.0.0", LATEST_EXTENSION)
        ? { href: "/extension#update", hint: labels.chooseCampusUpdate, external: false }
        : extension.status === "absent" && (webApp() || !desktopChromium())
          ? { href: "/extension", hint: labels.chooseCampusDesktop, external: false }
          : { href: "/extension", hint: labels.chooseCampusInstall, external: false };

    return (
      <section className="card choose-card">
        <h2>{labels.chooseTitle}</h2>
        <p className="small muted">{labels.chooseLead}</p>
        <ul className="choose-list">
          <li>
            <a
              className="choose-row choose-main"
              href={campusOption.href}
              data-choose="campus"
              {...(campusOption.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              onClick={() => {
                if (!canTransfer) return;
                startCampusTransfer(campus.title, campus.lang);
                setMode("manual");
              }}
            >
              <IconArrowDown size={22} />
              <span className="choose-text">
                <b>{labels.chooseCampus}</b>
                <span className="small muted">{campusOption.hint}</span>
              </span>
              <IconChevronRight className="muted" />
            </a>
          </li>
          <li>
            <button type="button" className="choose-row" data-choose="manual" onClick={() => setMode("manual")}>
              <IconGrid size={22} />
              <span className="choose-text">
                <b>{labels.chooseManual}</b>
                <span className="small muted">{labels.chooseManualHint}</span>
              </span>
              <IconChevronRight className="muted" />
            </button>
          </li>
        </ul>
      </section>
    );
  }

  return (
    <section className="card editor-card">
      {hint}

      {/* Кисть и шаблоны — одной строкой: раньше они стояли столбиком и съедали
          полэкрана над сеткой. Кисть: «занят» — пары и работа, «неудобно» —
          могу, но лучше не надо; такие окна группа предложит последними. */}
      <div className="editor-toolbar">
        <div className="brush" role="radiogroup" aria-label={labels.brushLabel}>
          {(["busy", "soft"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={brush === kind}
              className={`brush-option${brush === kind ? " active" : ""}`}
              onClick={() => setBrush(kind)}
            >
              <i className={kind === "busy" ? "swatch-busy" : "swatch-soft-mine"} />
              {kind === "busy" ? labels.brushBusy : labels.brushSoft}
            </button>
          ))}
        </div>
        <div className="templates">
          <span className="small muted">{labels.tplTitle}</span>
          <button type="button" className="btn btn-sm" onClick={() => applyTemplate("evenings")}>
            {labels.tplEvenings}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => applyTemplate("weekendFree")}>
            {labels.tplWeekendFree}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => applyTemplate("weekendBusy")}>
            {labels.tplWeekendBusy}
          </button>
        </div>
      </div>
      <p className="small muted editor-hint">{labels.paintHint}</p>

      {reviewing && preview && (
        <div className="notice review-bar" role="status">
          <span>
            {labels.campusReview.replace("{n}", String(preview.count))}
          </span>
          <span className="notice-actions">
            <button className="btn btn-sm btn-primary tg-hide" type="button" onClick={confirmImport}>
              {labels.importSave}
            </button>
            <button className="btn btn-sm btn-quiet" type="button" onClick={cancelImport}>
              {labels.importCancel}
            </button>
          </span>
        </div>
      )}

      <div
        className="gridwrap"
        ref={rootRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <table className="week editor periods">
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
                    {weekdayShort[weekday]}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => [
              <BreakRow
                key={`break-${period.start}`}
                period={period}
                columns={weekdayNames.length}
                template={labels.breakRow}
              />,
              <tr key={period.start}>
                <PeriodTime period={period} />
                {weekdayNames.map((name, weekday) => {
                  const key = cellKey(weekday, period.start);
                  const isBusy = busy.has(key);
                  const isSoft = busy.has(own(key, "soft"));
                  return (
                    <td
                      key={key}
                      className={`cell${isBusy ? " busy" : ""}${isSoft ? " soft" : ""}`}
                      tabIndex={0}
                      role="button"
                      aria-pressed={isBusy}
                      aria-label={`${name} ${fmtMinutes(period.start)}–${fmtMinutes(period.end)}`}
                      data-key={key}
                    />
                  );
                })}
              </tr>,
            ])}
          </tbody>
        </table>

        {/* Телефон: один день крупными клетками. Семь колонок на 375px дают
            клетку ~39px — меньше цели нажатия в 44px. */}
        <div className="editor-day">
          <div className="editor-days" role="tablist" aria-label={labels.dayPick}>
            {weekdayShort.map((short, weekday) => {
              const taken = periods.filter((period) => busy.has(cellKey(weekday, period.start))).length;
              return (
                <button
                  key={short}
                  type="button"
                  role="tab"
                  aria-selected={weekday === day}
                  aria-label={weekdayNames[weekday]}
                  className={`daychip${weekday === day ? " active" : ""}`}
                  onClick={() => setDay(weekday)}
                >
                  <span>{short}</span>
                  {taken > 0 && <span className="count">{taken}</span>}
                </button>
              );
            })}
          </div>
          <table className="week editor periods day">
            <tbody>
              {periods.map((period) => {
                const key = cellKey(day, period.start);
                const isBusy = busy.has(key);
                const isSoft = busy.has(own(key, "soft"));
                return [
                  <BreakRow key={`break-${period.start}`} period={period} columns={1} template={labels.breakRow} />,
                  <tr key={period.start}>
                    <PeriodTime period={period} />
                    <td
                      className={`cell${isBusy ? " busy" : ""}${isSoft ? " soft" : ""}`}
                      tabIndex={0}
                      role="button"
                      aria-pressed={isBusy}
                      aria-label={`${weekdayNames[day]} ${fmtMinutes(period.start)}–${fmtMinutes(period.end)}`}
                      data-day-key={key}
                    >
                      {(isBusy || isSoft) && (
                        <span className="cell-state">{isBusy ? labels.legendBusy : labels.legendSoft}</span>
                      )}
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
          <button type="button" className="btn btn-sm" onClick={() => toggleDay(day)}>
            {periods.every((period) => busy.has(cellKey(day, period.start))) ? labels.dayAllFree : labels.dayAllBusy}
          </button>
        </div>
      </div>

      <div className="legend">
        <i className="swatch-free" />
        <span>{labels.legendFree}</span>
        <i className="swatch-busy" />
        <span>{labels.legendBusy}</span>
        <i className="swatch-soft-mine" />
        <span>{labels.legendSoft}</span>
      </div>

      {/* Сохранять руками нечего — главная кнопка просто возвращает в группу. */}
      <TelegramMainButton
        text={reviewing ? labels.importSave : labels.done}
        onClick={reviewing ? confirmImport : () => router.push(backHref)}
        disabled={reviewing ? false : saving || dirty}
        progress={saving}
      />

      <div className="editor-foot">
        <span className="small muted savestate" role="status" aria-live="polite">
          {failedSave ? (
            <>
              {labels.saveError}{" "}
              <button type="button" className="btn btn-sm" onClick={() => setFailedSave(false)}>
                {labels.saveRetry}
              </button>
            </>
          ) : reviewing ? (
            <>{labels.importPending}</>
          ) : !savedOnce && !dirty && !saving ? (
            <>{labels.notFilledYet}</>
          ) : saving || dirty ? (
            <>
              <span className="spinner" aria-hidden="true" /> {labels.saving}
            </>
          ) : (
            <>
              <IconCheck className="ok" /> {labels.saved}
            </>
          )}
        </span>
        <span className="small muted">
          {labels.busyTotal.replace("{h}", String(busyHours))}
        </span>
        <span className="editor-actions">
          <button
            className="btn btn-sm"
            type="button"
            disabled={history.length === 0}
            onClick={undo}
          >
            {labels.undo}
          </button>
          <button className="btn btn-sm btn-quiet" type="button" onClick={clearAll}>
            {labels.clear}
          </button>
        </span>
      </div>
    </section>
  );
}
