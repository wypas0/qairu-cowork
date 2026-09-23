import { ImageResponse } from "next/og";

import { BRAND_COLOR, brandMarkSvg } from "@/lib/brand";

export const alt = "QairuCowork — общие свободные окна учебной группы";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Картинка превью ссылки на сайт — в Telegram, WhatsApp, VK: знак, название
 * и зачем сервис. Собирается при сборке; вложенные страницы берут её же.
 */
export default function OpengraphImage() {
  const mark = encodeURIComponent(brandMarkSvg("white"));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 64,
          padding: "0 96px",
          background: BRAND_COLOR,
          color: "white",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- картинка внутри генератора PNG, а не страница */}
        <img src={`data:image/svg+xml,${mark}`} width={250} height={250} alt="" />
        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 680 }}>
          <div style={{ fontSize: 88, letterSpacing: -2 }}>QairuCowork</div>
          <div style={{ fontSize: 40, lineHeight: 1.3, opacity: 0.92 }}>
            Общие свободные окна учебной группы и встречи в один клик
          </div>
        </div>
      </div>
    ),
    size,
  );
}
