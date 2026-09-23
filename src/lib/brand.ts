/**
 * Знак продукта — единственное место, где он нарисован. Из него собираются
 * значок в шапке (BrandMark), favicon, иконки приложения и аватар бота.
 *
 * Q университета (кольцо с плоской ножкой, как у QAIRU Hub) со стрелками
 * часов внутри. Рисунок 24×24 сдвинут на (1, 1): у Q ножка уходит вправо, и
 * без сдвига знак сидит левее и выше середины.
 */
export function brandMarkInner(color: string): string {
  return (
    `<g transform="translate(1 1)" fill="none" stroke="${color}">` +
    `<circle cx="11" cy="11" r="7" stroke-width="4"/>` +
    `<path d="M11 18h9" stroke-width="4"/>` +
    `<path d="M11 11V8.2M11 11l2 1.3" stroke-width="1.8" stroke-linecap="round"/>` +
    `</g>`
  );
}

/** Знак отдельным SVG-документом — для data:-адресов и генератора PNG. */
export function brandMarkSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${brandMarkInner(color)}</svg>`;
}

/** Кобальт бренда — фон иконок и аватара бота. */
export const BRAND_COLOR = "#0064e0";
