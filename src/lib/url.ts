import "server-only";

import { headers } from "next/headers";

import { siteUrl } from "./config";

/**
 * Базовый адрес сайта для ссылок, которые уедут наружу.
 *
 * Явная переменная окружения важнее заголовков: за прокси Host может оказаться
 * внутренним, и ссылка-приглашение уйдёт в чат нерабочей.
 */
export async function baseUrl(): Promise<string> {
  const configured = siteUrl();
  if (configured) return configured;
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
