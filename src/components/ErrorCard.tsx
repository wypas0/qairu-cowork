"use client";

import Link from "next/link";

import type { ErrorText } from "@/i18n/errorText";
import { BrandBar } from "./BrandBar";

/**
 * Что видит человек при сбое страницы: что случилось, кнопка «ещё раз» и путь
 * на главную. Код ошибки (digest) совпадает с записью в логах Vercel — по нему
 * сбой легко найти, если человек пришлёт снимок экрана.
 */
export function ErrorCard({ text, digest, retry }: { text: ErrorText; digest?: string; retry: () => void }) {
  return (
    <>
      <BrandBar />
      <main className="wrap">
        <div className="card" style={{ maxWidth: 520, margin: "32px auto" }}>
          <h1 style={{ fontSize: 22 }}>{text.title}</h1>
          <p className="muted">{text.lead}</p>
          {digest ? (
            <p className="small muted">
              {text.code}: <span style={{ fontVariantNumeric: "tabular-nums" }}>{digest}</span>
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={() => retry()}>
              {text.retry}
            </button>
            <Link className="btn" href="/">
              {text.home}
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
