import { NextResponse, type NextRequest } from "next/server";

import { COOKIE_MAX_AGE, COOKIE_NAME } from "@/lib/cookies";

/**
 * Персональная ссылка из бота: `/g/<slug>?t=<token>`.
 *
 * Токен немедленно перекладывается в HttpOnly-куку, а из адресной строки
 * убирается редиректом — иначе он остался бы в истории браузера, в заголовке
 * Referer и на чужом скриншоте.
 *
 * Делать это в middleware обязательно: серверный компонент страницы куки
 * ставить не умеет.
 */
export function middleware(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");
  if (!token) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.searchParams.delete("t");
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}

export const config = {
  matcher: ["/g/:path*"],
};
