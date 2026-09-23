/*
 * Service worker QairuCowork. Ничего не кэширует: расписание и встречи
 * должны быть свежими. Нужен для установки сайта как приложения и чтобы без
 * сети показывать понятную страницу, а не ошибку браузера.
 */
const OFFLINE_HTML = `<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QairuCowork — нет сети</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center;background:#f4f6fa;color:#0a1628">
<div><h1 style="font-size:22px">Нет подключения к интернету</h1>
<p>Расписание и встречи загрузятся, как только появится сеть.</p>
<button onclick="location.reload()" style="font:inherit;font-weight:600;padding:10px 20px;border-radius:999px;border:0;background:#0064e0;color:#fff">Обновить</button></div>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } }),
    ),
  );
});
