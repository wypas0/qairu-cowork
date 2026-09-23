import { ImageResponse } from "next/og";

/**
 * Иконка приложения: знак продукта (кольцо с ножкой, как BrandMark) белым на
 * кобальте. Знак занимает середину — края можно срезать маской Android.
 */
export function appIcon(size: number): ImageResponse {
  const mark = size * 0.46;
  const svg = encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'>" +
      "<circle cx='11' cy='11' r='7' stroke='white' stroke-width='4'/>" +
      "<path d='M11 18h9' stroke='white' stroke-width='4'/></svg>",
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0064e0",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- картинка внутри генератора PNG, а не страница */}
        <img src={`data:image/svg+xml,${svg}`} width={mark} height={mark} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}
