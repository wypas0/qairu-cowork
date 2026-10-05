/**
 * Рисунки к трём шагам лендинга. Нарисованы вручную, анимированы в CSS
 * (pages.css → «рисунки шагов»), JS не нужен. Каждый рисунок — один цикл,
 * все его части делят длительность и отличаются только задержкой, поэтому
 * не расходятся со временем. Цвета — только классы и токены.
 *
 * 1 — ссылка-приглашение собирается в QR-код;
 * 2 — палец проводит по столбцу и закрашивает пары;
 * 3 — клетки недели теплеют до «свободны все», и бот присылает приглашение.
 */

type Style = React.CSSProperties & Record<`--${string}`, string | number>;

// Модули QR: детерминированный узор 7×7 без случайности — сервер и клиент рисуют одно и то же.
const QR = [
  "1110111",
  "1010101",
  "1110011",
  "0001010",
  "1101101",
  "1011001",
  "1110110",
];

function InviteArt() {
  return (
    <svg className="art art-invite" viewBox="0 0 240 150" aria-hidden="true" focusable="false">
      <rect className="art-paper" x="58" y="18" width="124" height="114" rx="14" />
      {QR.flatMap((row, y) =>
        [...row].map((bit, x) =>
          bit === "1" ? (
            <rect
              key={`${x}-${y}`}
              className="art-qr"
              x={86 + x * 10}
              y={30 + y * 10}
              width={8.5}
              height={8.5}
              rx={2}
              style={{ "--d": `${((x * 3 + y * 5) % 11) * 0.06}s` } as Style}
            />
          ) : null,
        ),
      )}
      <g className="art-link">
        <rect className="art-pill" x="66" y="108" width="108" height="16" rx="8" />
        <rect className="art-pill-text" x="76" y="114" width="58" height="4" rx="2" />
        <circle className="art-pill-dot" cx="162" cy="116" r="3.5" />
      </g>
    </svg>
  );
}

const PAINT_ROWS = [0, 1, 2, 3];

function PaintArt() {
  return (
    <svg className="art art-paint" viewBox="0 0 240 150" aria-hidden="true" focusable="false">
      {[0, 1, 2, 3, 4].flatMap((col) =>
        PAINT_ROWS.map((row) => (
          <rect
            key={`${col}-${row}`}
            className={col === 2 && row < 3 ? "art-slot art-slot-paint" : "art-slot"}
            x={36 + col * 36}
            y={22 + row * 28}
            width={30}
            height={22}
            rx={6}
            style={{ "--d": `${row * 0.32}s` } as Style}
          />
        )),
      )}
      <g className="art-finger">
        <circle className="art-finger-ring" cx="0" cy="0" r="11" />
        <circle className="art-finger-dot" cx="0" cy="0" r="5" />
      </g>
    </svg>
  );
}

// Сколько из пяти свободно в каждой клетке ряда после того, как все отметились.
const ROW = [3, 5, 2, 4, 5];

function WindowsArt() {
  return (
    <svg className="art art-windows" viewBox="0 0 240 150" aria-hidden="true" focusable="false">
      {ROW.map((free, i) => (
        <rect
          key={i}
          className={`art-heat art-heat-${free}`}
          x={30 + i * 37}
          y={20}
          width={32}
          height={32}
          rx={7}
          style={{ "--d": `${i * 0.12}s` } as Style}
        />
      ))}
      <rect className="art-best-ring" x={175} y={16} width={40} height={40} rx={10} />
      <g className="art-bubble">
        <rect className="art-paper" x="44" y="72" width="152" height="58" rx="14" />
        <rect className="art-line" x="58" y="84" width="72" height="5" rx="2.5" />
        <rect className="art-line art-line-soft" x="58" y="94" width="104" height="5" rx="2.5" />
        <rect className="art-yes" x="58" y="106" width="58" height="16" rx="8" />
        <path className="art-yes-mark" d="M80 114l4 4 8-8" />
        <rect className="art-no" x="124" y="106" width="58" height="16" rx="8" />
        <path className="art-no-mark" d="M149 110l8 8M157 110l-8 8" />
      </g>
    </svg>
  );
}

export function StepArt({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="step-art" data-loop="">
      {step === 1 ? <InviteArt /> : step === 2 ? <PaintArt /> : <WindowsArt />}
    </div>
  );
}
