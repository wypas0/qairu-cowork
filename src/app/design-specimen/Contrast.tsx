"use client";

import { useEffect, useState } from "react";

/** Пары «текст / фон» и «элемент / фон» — что именно проверяем на AA. */
const PAIRS: { fg: string; bg: string; kind: "text" | "ui"; note: string }[] = [
  { fg: "--text", bg: "--bg", kind: "text", note: "основной текст" },
  { fg: "--muted", bg: "--bg", kind: "text", note: "вторичный текст" },
  { fg: "--text", bg: "--card", kind: "text", note: "текст на карточке" },
  { fg: "--muted", bg: "--card", kind: "text", note: "вторичный на карточке" },
  { fg: "--ink-text", bg: "--ink", kind: "text", note: "главная кнопка" },
  { fg: "--accent", bg: "--bg", kind: "text", note: "ссылка / «через 2 ч»" },
  { fg: "--accent-text", bg: "--accent", kind: "text", note: "счётчик-бейдж" },
  { fg: "--meeting-text", bg: "--meeting", kind: "text", note: "подпись встречи" },
  { fg: "--danger", bg: "--card", kind: "text", note: "ошибка / «Отменить»" },
  { fg: "--field-line", bg: "--card", kind: "ui", note: "обводка поля" },
  { fg: "--btn-line", bg: "--card", kind: "ui", note: "обводка кнопки" },
  { fg: "--ring", bg: "--bg", kind: "ui", note: "кольцо фокуса" },
  { fg: "--warning", bg: "--card", kind: "ui", note: "обводка «неудобно»" },
  { fg: "--slot-busy", bg: "--card", kind: "ui", note: "занятая клетка" },
];

type Rgba = [number, number, number, number];

function parse(value: string): Rgba | null {
  const probe = document.createElement("div");
  probe.style.color = value;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const m = computed.match(/[\d.]+/g);
  if (!m) return null;
  const [r, g, b, a = "1"] = m;
  return [Number(r), Number(g), Number(b), Number(a)];
}

function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function Contrast() {
  const [rows, setRows] = useState<{ note: string; fg: string; bg: string; ratio: number; ok: boolean; kind: string }[]>([]);

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string) => style.getPropertyValue(name).trim();
    // Под карточкой и полупрозрачными токенами лежит страница; под страницей — самый тёмный край неба.
    const page = over(parse(token("--bg"))!, [255, 255, 255, 1]);
    // В тёмной теме страница — небо: худший случай — самое светлое место,
    // свечение горизонта у подвала (#0F163A под 38% #2656CE).
    const pages: Rgba[] = luminance(page) < 0.1 ? [page, [24, 46, 114, 1]] : [page];
    const ratioOn = (pair: (typeof PAIRS)[number], under: Rgba) => {
      const bg = over(parse(token(pair.bg))!, under);
      const fg = over(parse(token(pair.fg))!, bg);
      const [l1, l2] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    };
    // Токены читаются только после монтирования — в браузере, по текущей теме.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(
      PAIRS.map((pair) => {
        // Непрозрачный фон (кнопка, бейдж) от неба не зависит.
        const opaque = parse(token(pair.bg))![3] === 1 && pair.bg !== "--bg";
        const ratio = Math.min(...(opaque ? [page] : pages).map((under) => ratioOn(pair, under)));
        return {
          note: pair.note,
          fg: pair.fg,
          bg: pair.bg,
          ratio,
          ok: ratio >= (pair.kind === "text" ? 4.5 : 3),
          kind: pair.kind,
        };
      }),
    );
  }, []);

  return (
    <table className="acct-table" style={{ width: "100%" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>Пара</th>
          <th style={{ textAlign: "left" }}>Образец</th>
          <th style={{ textAlign: "right" }}>Контраст</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.note}>
            <td>
              {row.note}
              <br />
              <span className="small muted">
                {row.fg} на {row.bg} · {row.kind === "text" ? "текст ≥ 4.5" : "элемент ≥ 3"}
              </span>
            </td>
            <td>
              <span
                style={{
                  display: "inline-block",
                  padding: "6px 12px",
                  borderRadius: 8,
                  background: `var(${row.bg})`,
                  color: `var(${row.fg})`,
                  border: `2px solid var(${row.kind === "ui" ? row.fg : row.bg})`,
                }}
              >
                Аа Әә
              </span>
            </td>
            <td style={{ textAlign: "right" }} className="tnum">
              <b>{row.ratio.toFixed(2)}</b> {row.ok ? "✓ AA" : "✗"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
