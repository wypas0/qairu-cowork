/**
 * QR-код ссылки-приглашения: матрица модулей в виде одного SVG-пути.
 * Соседние тёмные модули в строке склеиваются в одну полосу — путь выходит
 * в разы короче, чем по квадрату на модуль.
 */

import qrcode from "qrcode-generator";

export type QrShape = {
  /** Сторона кода в модулях, без белой рамки. */
  size: number;
  /** Путь всех тёмных модулей в координатах модулей. */
  path: string;
};

export function qrShape(text: string): QrShape {
  // Уровень M: переживает блик на экране проектора и не раздувает код.
  const code = qrcode(0, "M");
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  const parts: string[] = [];
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      if (!code.isDark(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < size && code.isDark(row, col)) col += 1;
      parts.push(`M${start} ${row}h${col - start}v1h${start - col}z`);
    }
  }
  return { size, path: parts.join("") };
}
