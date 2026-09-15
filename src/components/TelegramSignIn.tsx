import { botUsername } from "@/bot/context";
import { translator } from "@/i18n";
import { hasBot } from "@/lib/config";
import { startTelegramLoginAction } from "@/app/login/actions";

/**
 * Единственный способ зарегистрироваться: вход через Telegram.
 *
 * В браузере — кнопка «Войти через Telegram» (подтверждение в боте). Рядом —
 * ссылка открыть бота: оттуда сайт запускается как Mini App и входит сам.
 */
export async function TelegramSignIn({
  lang,
  next,
  purpose = "login",
  label,
}: {
  lang: string;
  next: string;
  purpose?: "login" | "link";
  label?: string;
}) {
  const t = translator(lang);
  if (!hasBot()) {
    return (
      <div className="notice warn" role="alert">
        {t("w_tglogin_no_bot")}
      </div>
    );
  }
  const username = await botUsername();

  return (
    <div className="tg-signin">
      <form action={startTelegramLoginAction}>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="purpose" value={purpose} />
        <button className="btn btn-primary tg-btn" type="submit" style={{ width: "100%" }}>
          {label ?? t("w_tglogin_btn")}
        </button>
      </form>
      {username && (
        <a
          className="btn btn-quiet tg-open"
          href={`https://t.me/${username}?start`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ width: "100%" }}
        >
          {t("w_open_in_tg")}
        </a>
      )}
    </div>
  );
}
