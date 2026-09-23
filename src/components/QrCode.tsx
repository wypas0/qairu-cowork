import { qrShape } from "@/core/qr";

/**
 * QR-код как картинка. Цвета — всегда тёмный на белом, в любой теме:
 * камеры телефонов не читают светлый код на тёмном фоне. Вокруг — белая
 * рамка в 4 модуля, её требует стандарт.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { size, path } = qrShape(value);
  const box = size + 8;
  return (
    <svg
      className={className ? `qr ${className}` : "qr"}
      viewBox={`0 0 ${box} ${box}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect className="qr-bg" width={box} height={box} />
      <path className="qr-ink" d={path} transform="translate(4 4)" />
    </svg>
  );
}
