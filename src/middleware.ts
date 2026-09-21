import { NextResponse, type NextRequest } from "next/server";

import { COOKIE_MAX_AGE, COOKIE_NAME, RECENT_COOKIE, RECENT_LIMIT, parseRecent } from "@/lib/cookies";

/** Вызовы, которые приходят не из браузера сайта: у них своя проверка подлинности. */
const EXTERNAL_API = ["/api/telegram/", "/api/cron/", "/api/healthz"];

/**
 * 1. Персональная ссылка из бота: `/g/<slug>?t=<token>`.
 *
 *    Токен немедленно перекладывается в HttpOnly-куку, а из адресной строки
 *    убирается редиректом — иначе он остался бы в истории браузера, в заголовке
 *    Referer и на чужом скриншоте. Делать это в middleware обязательно:
 *    серверный компонент страницы куки ставить не умеет.
 *
 * 2. Защита API от запросов с чужих сайтов. Кука сессии на https выдаётся с
 *    SameSite=None (иначе не работает вход из Mini App в Telegram Web), а
 *    значит, браузер приложит её и к POST с чужой страницы. Такие запросы
 *    отличает заголовок Origin — отклоняем всё, что пришло не с нашего адреса.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
      return NextResponse.next();
    }
    if (EXTERNAL_API.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();
    const origin = request.headers.get("origin");
    if (origin && !sameOrigin(origin, request)) {
      return NextResponse.json({ detail: "cross-site request" }, { status: 403 });
    }
    return NextResponse.next();
  }

  const token = request.nextUrl.searchParams.get("t");
  const secure = request.nextUrl.protocol === "https:";
  if (!token) return rememberGroup(request, NextResponse.next(), secure);

  const url = request.nextUrl.clone();
  url.searchParams.delete("t");
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return rememberGroup(request, response, secure);
}

/**
 * 3. Последние открытые группы. Запоминаем код группы при каждом заходе на её
 *    страницы: по нему группы стоят в списках, а мини-апп открывается сразу
 *    в последней. SameSite=None на https — по той же причине, что и у сессии:
 *    внутри Telegram сайт открыт во фрейме.
 */
function rememberGroup(request: NextRequest, response: NextResponse, secure: boolean): NextResponse {
  const match = /^\/g\/([a-z0-9]{3,24})(?:\/|$)/i.exec(request.nextUrl.pathname);
  if (!match) return response;
  const code = match[1].toLowerCase();
  const previous = parseRecent(request.cookies.get(RECENT_COOKIE)?.value);
  if (previous[0] === code) return response;
  const next = [code, ...previous.filter((item) => item !== code)].slice(0, RECENT_LIMIT);
  response.cookies.set(RECENT_COOKIE, next.join("."), {
    sameSite: secure ? "none" : "lax",
    secure,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}

function sameOrigin(origin: string, request: NextRequest): boolean {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const expected = [request.nextUrl.host, request.headers.get("x-forwarded-host"), request.headers.get("host")];
  return expected.some((value) => value && value === host);
}

export const config = {
  matcher: ["/g/:path*", "/api/:path*"],
};
