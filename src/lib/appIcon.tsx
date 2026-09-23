import { ImageResponse } from "next/og";

import { BRAND_COLOR, brandMarkSvg } from "./brand";

/**
 * Иконка приложения: знак продукта (как BrandMark) белым на кобальте. Знак
 * занимает середину — края срезает маска Android и круг аватара в Telegram.
 */
export function appIcon(size: number): ImageResponse {
  const mark = size * 0.68;
  const svg = encodeURIComponent(brandMarkSvg("white"));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_COLOR,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- картинка внутри генератора PNG, а не страница */}
        <img src={`data:image/svg+xml,${svg}`} width={mark} height={mark} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}
