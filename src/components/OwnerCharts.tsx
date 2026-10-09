/* Графики консоли владельца — серверные, без единой строки JS в браузере:
   inline SVG на токенах цвета. Подсказка над столбцом — родной <title>, а
   цель наведения — вся высота дня, а не тонкий столбец. Таблица с теми же
   числами — рядом, под <details>: график не единственный способ их прочесть. */

type Point = { day: string; count: number };

const WIDTH = 900;
const HEIGHT = 160;
/** Зазор между соседними столбцами — 2px поверхности. */
const GAP = 2;

/**
 * Столбцы по дням. SVG растягивается по ширине карточки
 * (preserveAspectRatio="none"), поэтому подписей внутри нет: даты по краям и
 * максимум — обычным текстом под и над графиком.
 */
export function DailyBars({
  points,
  label,
  formatDay,
}: {
  points: Point[];
  label: string;
  formatDay: (day: string) => string;
}) {
  const max = Math.max(1, ...points.map((point) => point.count));
  const step = WIDTH / Math.max(1, points.length);
  const barWidth = Math.max(1, step - GAP);
  const middle = points[Math.floor(points.length / 2)];

  return (
    <figure className="owner-chart">
      <div className="owner-chart-plot">
        <span className="owner-chart-max small muted tnum" aria-hidden="true">
          {max}
        </span>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label}>
          {/* Сетка — тихая: половина и верх шкалы. */}
          <line className="owner-grid" x1="0" x2={WIDTH} y1="0.5" y2="0.5" vectorEffect="non-scaling-stroke" />
          <line className="owner-grid" x1="0" x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} vectorEffect="non-scaling-stroke" />
          <line className="owner-axis" x1="0" x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} vectorEffect="non-scaling-stroke" />
          {points.map((point, index) => {
            const height = point.count > 0 ? Math.max(3, (point.count / max) * (HEIGHT - 4)) : 0;
            const x = index * step;
            return (
              <g key={point.day} className="owner-bar">
                <rect className="owner-bar-hit" x={x} y="0" width={step} height={HEIGHT} />
                {height > 0 && (
                  <rect className="owner-bar-fill" x={x + GAP / 2} y={HEIGHT - height} width={barWidth} height={height} rx="1.5" />
                )}
                <title>{`${formatDay(point.day)}: ${point.count}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
      {points.length > 0 && (
        <figcaption className="owner-chart-axis small muted tnum" aria-hidden="true">
          <span>{formatDay(points[0].day)}</span>
          {middle && <span>{formatDay(middle.day)}</span>}
          <span>{formatDay(points[points.length - 1].day)}</span>
        </figcaption>
      )}
    </figure>
  );
}

/** Доля строкой: подпись, число и тонкая полоса под ними. Одна величина — один цвет. */
export function ShareRow({ label, value, share }: { label: string; value: string; share: number }) {
  const width = `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`;
  return (
    <div className="owner-share">
      <div className="owner-share-head">
        <span className="small muted">{label}</span>
        <span className="owner-value tnum">{value}</span>
      </div>
      <div className="owner-share-track" aria-hidden="true">
        <div className="owner-share-fill" style={{ width }} />
      </div>
    </div>
  );
}

/**
 * Заполненность хранилища. Цвет — по порогу (до 80% синий, дальше жёлтый,
 * с 90% красный), но состояние всегда дублируется текстом рядом.
 */
export function Meter({ share, label }: { share: number; label: string }) {
  const tone = share >= 0.9 ? "danger" : share >= 0.8 ? "warning" : "ok";
  const width = `${Math.max(1, Math.round(Math.min(1, share) * 100))}%`;
  return (
    <div
      className={`owner-meter owner-meter-${tone}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      aria-label={label}
    >
      <div className="owner-meter-fill" style={{ width }} />
    </div>
  );
}
