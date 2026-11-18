import { translator } from "@/i18n";

/**
 * Л5. Вопросы и ответы — аккордеон на <details> с общим движением раскрытия
 * (motion.css). Ответы сверены с кодом; меняется поведение — поправь ответ:
 * 1 — вход только через Telegram (src/lib/gate.ts, TelegramSignIn; пароль на
 *     /login — только у старых аккаунтов, задавших его сами);
 * 2 — по клеткам группе уходят имена свободных, занятых и «неудобно», но не
 *     названия пар и событий (toBoardPayload в src/lib/group.ts, календарь
 *     пишет занятость без названий — src/lib/calendarSync.ts);
 * 3 — «Моё расписание» и кнопка «Новый семестр» в настройках группы;
 * 4 — Mini App в Telegram, «на главный экран» (TelegramHome), карта на
 *     телефоне — по дню.
 */
export function Faq({ lang }: { lang: string }) {
  const t = translator(lang);
  return (
    <section className="faq-section" aria-labelledby="faq-title">
      <h2 id="faq-title" className="section-title">
        {t("w_l_faq_title")}
      </h2>
      <div className="faq">
        {([1, 2, 3, 4] as const).map((n) => (
          <details className="faq-item" key={n}>
            <summary>{t(`w_l_faq_${n}_q`)}</summary>
            <p className="muted">{t(`w_l_faq_${n}_a`)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
