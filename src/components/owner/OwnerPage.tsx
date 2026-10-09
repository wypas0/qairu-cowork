import Link from "next/link";

import { logoutAllOwnerAction, logoutOwnerAction, requestOwnerCodeAction, verifyOwnerCodeAction } from "@/app/admin/actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { FlashToast } from "@/components/FlashToast";
import { IconLock } from "@/components/icons";
import { Topbar } from "@/components/Topbar";
import * as repo from "@/db/repo";
import type { User } from "@/db/schema";
import { translator } from "@/i18n";
import { hasBot } from "@/lib/config";
import { OWNER_CODE_MAX_ATTEMPTS, OWNER_CODE_TTL_MS } from "@/lib/ownerConsole";
import { type OwnerAccess, ownerAccess } from "@/lib/ownerGate";
import type { SearchParams } from "@/lib/ownerQuery";
import { type Fmt, type T, formatters } from "./format";

export type OwnerTab = "overview" | "users" | "groups" | "system";

const TABS: { key: OwnerTab; href: string; label: string }[] = [
  { key: "overview", href: "/admin", label: "w_owner_tab_overview" },
  { key: "users", href: "/admin/users", label: "w_owner_tab_users" },
  { key: "groups", href: "/admin/groups", label: "w_owner_tab_groups" },
  { key: "system", href: "/admin/system", label: "w_owner_tab_system" },
];

const FLASH_OK: Record<string, string> = { sent: "w_owner_sent", in: "w_owner_in", out: "w_owner_out" };
const FLASH_ERR: Record<string, string> = {
  wrong: "w_owner_err_wrong",
  format: "w_owner_err_format",
  missing: "w_owner_err_missing",
  expired: "w_owner_err_expired",
  locked: "w_owner_err_locked",
  throttled: "w_owner_err_throttled",
  send_failed: "w_owner_err_send_failed",
  no_bot: "w_owner_no_bot",
};

/** Что получает тело страницы консоли: только когда консоль открыта. */
export type OwnerContext = {
  access: OwnerAccess & { session: NonNullable<OwnerAccess["session"]> };
  t: T;
  fmt: Fmt;
  query: SearchParams;
  params: Record<string, string>;
  now: Date;
};

type PageProps = {
  params: Promise<Record<string, string>>;
  searchParams: Promise<SearchParams>;
};

/**
 * Страница консоли владельца. Гейт один на все вкладки и карточки, копий
 * проверки по страницам нет:
 *
 * 1. ownerAccess() — первым делом: не владелец → «не найдено» (404), как
 *    будто адреса нет.
 * 2. Владелец без открытой консоли видит только ввод кода; `body` не
 *    вызывается вовсе — ни запроса к данным, ни записи в журнал.
 * 3. Консоль открыта — шапка, вкладки и то, что вернул `body`.
 *
 * `path` — адрес страницы: после ввода кода или выхода форма вернёт сюда же.
 */
export function ownerPage(
  tab: OwnerTab,
  body: (ctx: OwnerContext) => Promise<React.ReactNode>,
  path: (params: Record<string, string>) => string = () => TABS.find((item) => item.key === tab)!.href,
) {
  return async function OwnerConsolePage(props: PageProps) {
    const access = await ownerAccess();
    const [query, params] = await Promise.all([props.searchParams, props.params]);
    const { user, session } = access;
    const t = translator(user.lang);
    const fmt = formatters(user.lang);
    const here = path(params);

    const okKey =
      query.out === "all" ? "w_owner_out_all" : FLASH_OK[Object.keys(FLASH_OK).find((key) => key in query) ?? ""];
    const errKey = typeof query.err === "string" ? FLASH_ERR[query.err] : undefined;
    const left = typeof query.left === "string" ? Number(query.left) || 0 : 0;

    return (
      <>
        <Topbar lang={user.lang} />
        <main className="wrap owner">
          <FlashToast
            message={errKey ? t(errKey, { left }) : okKey ? t(okKey) : null}
            tone={errKey ? "error" : "ok"}
            params={["sent", "in", "out", "err", "left"]}
          />
          <header className="page-head">
            <div>
              <p className="eyebrow">{t("w_owner_eyebrow")}</p>
              <h1>{t("w_owner_title")}</h1>
              <p className="lead">{t("w_owner_lead")}</p>
            </div>
            {session && (
              <div className="owner-session">
                <p className="small muted">{t("w_owner_session_until", { time: fmt.time(session.expiresAt) })}</p>
                <div className="owner-session-actions">
                  <form action={logoutOwnerAction}>
                    <input type="hidden" name="next" value={here} />
                    <button className="btn btn-sm" type="submit">
                      {t("w_owner_logout")}
                    </button>
                  </form>
                  <form action={logoutAllOwnerAction}>
                    <input type="hidden" name="next" value={here} />
                    <ConfirmSubmit className="btn btn-sm btn-quiet btn-danger" confirm={t("w_owner_logout_all_confirm")}>
                      {t("w_owner_logout_all")}
                    </ConfirmSubmit>
                  </form>
                </div>
              </div>
            )}
          </header>
          {session ? (
            <>
              <nav className="tabs owner-tabs" aria-label={t("w_owner_tabs")}>
                {TABS.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    prefetch={false}
                    className={`tab${item.key === tab ? " active" : ""}`}
                    aria-current={item.key === tab ? "page" : undefined}
                  >
                    {t(item.label)}
                  </Link>
                ))}
              </nav>
              {await body({ access: { ...access, session }, t, fmt, query, params, now: new Date() })}
            </>
          ) : (
            <Gate user={user} t={t} fmt={fmt} here={here} />
          )}
        </main>
      </>
    );
  };
}

/** Второй фактор: «Прислать код» или поле для кода, пока он жив. */
async function Gate({ user, t, fmt, here }: { user: User; t: T; fmt: Fmt; here: string }) {
  const pending = await repo.pendingOwnerCode(user.userId);
  const bot = hasBot();
  return (
    <section className="card owner-gate" aria-labelledby="owner-gate-title">
      <h2 id="owner-gate-title">
        <IconLock size={18} /> {t("w_owner_gate_title")}
      </h2>
      <p className="small muted">
        {t("w_owner_gate_lead", { minutes: OWNER_CODE_TTL_MS / 60_000, attempts: OWNER_CODE_MAX_ATTEMPTS })}
      </p>
      {!bot && (
        <div className="notice warn" role="status">
          {t("w_owner_no_bot")}
        </div>
      )}
      {pending && (
        <form action={verifyOwnerCodeAction} className="owner-code-form">
          <input type="hidden" name="next" value={here} />
          <div className="field">
            <label htmlFor="owner-code">{t("w_owner_code_label")}</label>
            <input
              id="owner-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 \-]{6,8}"
              minLength={6}
              maxLength={8}
              required
              autoFocus
              spellCheck={false}
              className="owner-code-input tnum"
            />
            <p className="small muted owner-code-until">{t("w_owner_code_until", { time: fmt.time(pending.expiresAt) })}</p>
          </div>
          <button className="btn btn-primary" type="submit">
            {t("w_owner_enter")}
          </button>
        </form>
      )}
      <form action={requestOwnerCodeAction}>
        <input type="hidden" name="next" value={here} />
        <button className={pending ? "btn btn-sm" : "btn btn-primary"} type="submit" disabled={!bot}>
          {pending ? t("w_owner_resend") : t("w_owner_send_code")}
        </button>
      </form>
    </section>
  );
}
