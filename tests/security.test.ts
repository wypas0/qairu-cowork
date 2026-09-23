import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { isOwnOrDirect } from "@/lib/secFetch";
import { proxy } from "@/proxy";

const headers = (values: Record<string, string>) => new Headers(values);

describe("вступление по ссылке: откуда запрос", () => {
  it("свой сайт и адрес, открытый человеком, — вступаем сразу", () => {
    expect(isOwnOrDirect(headers({ "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" }))).toBe(true);
    expect(isOwnOrDirect(headers({ "sec-fetch-site": "none", "sec-fetch-mode": "navigate" }))).toBe(true);
  });

  it("чужая страница и браузер без Sec-Fetch — только по кнопке", () => {
    expect(isOwnOrDirect(headers({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }))).toBe(false);
    expect(isOwnOrDirect(headers({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" }))).toBe(false);
    expect(isOwnOrDirect(headers({ "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate" }))).toBe(false);
    expect(isOwnOrDirect(headers({ "sec-fetch-site": "none", "sec-fetch-mode": "no-cors" }))).toBe(false);
    expect(isOwnOrDirect(headers({}))).toBe(false);
  });
});

describe("старая ссылка с токеном", () => {
  it("?t= не входит в аккаунт, а только убирается из адреса", () => {
    const response = proxy(new NextRequest("https://qairu.example/g/abcd1234?t=stolen&x=1"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://qairu.example/g/abcd1234?x=1");
    expect(response.cookies.get("qairu_token")).toBeUndefined();
  });
});
