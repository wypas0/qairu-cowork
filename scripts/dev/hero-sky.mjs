// Картинка неба для витрины лендинга: node scripts/dev/hero-sky.mjs
//
// Космос, звёзды и горизонт планеты из цветов qairuhub.com
// (site-clone/reverse/DESIGN.md, «Сцена»). Готовой картинкой, а не CSS:
// те же градиенты слоями на большом блоке на телефоне стоили ~100–150 мс
// первой отрисовки. Пишет public/hero-sky.jpg (~11 КБ).

import { chromium } from "@playwright/test";

const STARS = [
  [12, 18, 1], [28, 62, 0.6], [44, 12, 0.8], [61, 38, 0.5], [72, 8, 0.9], [86, 26, 0.7],
  [93, 58, 0.5], [6, 78, 0.5], [35, 30, 0.6], [55, 70, 0.4], [80, 45, 0.6], [20, 40, 0.5],
];
const layers = [
  ...STARS.map(([x, y, a]) => `radial-gradient(1.5px 1.5px at ${x}% ${y}%, rgba(255,255,255,${a}), transparent 60%)`),
  // горизонт планеты: тонкий светлый ободок и свечение над ним
  "radial-gradient(150% 62% at 50% 132%, #050a1f 60%, rgba(120,150,220,.95) 60.3%, rgba(38,86,206,.55) 61.5%, rgba(38,86,206,.18) 66%, transparent 74%)",
  "radial-gradient(90% 60% at 50% 120%, rgba(38,86,206,.38) 0%, rgba(17,36,93,.3) 40%, transparent 72%)",
  "radial-gradient(55% 45% at 8% 0%, rgba(17,36,93,.5), transparent 70%)",
  "linear-gradient(180deg, #05051d 0%, #0a0f2a 55%, #0f163a 100%)",
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 640 } });
await page.setContent(`<body style="margin:0"><div style="width:1200px;height:640px;background:${layers.join(",")}"></div></body>`);
await page.locator("div").screenshot({ path: "public/hero-sky.jpg", type: "jpeg", quality: 82 });
await browser.close();
console.log("public/hero-sky.jpg");
