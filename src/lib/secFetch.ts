/**
 * Откуда пришёл запрос — по заголовкам Sec-Fetch-*, которые браузер ставит сам
 * и которые чужая страница подделать не может.
 *
 * Кука сессии на https выдаётся с SameSite=None (иначе не работает вход из
 * Mini App в Telegram Web), поэтому браузер приложит её и к запросу, который
 * затеяла чужая страница: картинкой, фреймом или переходом по ссылке. Действие
 * по GET, которое что-то меняет, выполняется без вопросов, только если запрос
 * пришёл с нашего же сайта или человек открыл адрес сам — из приложения,
 * закладки, по QR-коду. Старые браузеры без этих заголовков получают
 * подтверждение кнопкой: так безопаснее.
 */
export function isOwnOrDirect(headers: Pick<Headers, "get">): boolean {
  const site = headers.get("sec-fetch-site");
  if (site === "same-origin") return true;
  return site === "none" && headers.get("sec-fetch-mode") === "navigate";
}

/**
 * Серверное действие пришло с нашей же страницы. Next сам сверяет Origin с
 * Host, но пропускает запрос вовсе без Origin; для консоли владельца этого
 * мало. Браузер, который не прислал ни Sec-Fetch-Site, ни Origin, — отказ.
 */
export function isSameOriginPost(headers: Pick<Headers, "get">): boolean {
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = headers.get("origin");
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return [headers.get("x-forwarded-host"), headers.get("host")].some((value) => value === host);
}
