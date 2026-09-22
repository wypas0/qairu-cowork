/**
 * Контакты в подвале сайта. Меняются только здесь.
 *
 * Разработчик — только Telegram: туда пишут про баги и с предложениями.
 * Qairu Hub — организация, у которой проект: её ссылки выводятся все, какие заданы.
 * Пустое значение просто не показывается.
 */
export const CONTACTS = {
  /** Ник разработчика в Telegram, без @. */
  developerTelegram: "wypas0",
  hub: {
    /** Сайт Qairu Hub, полный адрес. */
    site: "https://qairuhub.com",
    /** Канал или чат Qairu Hub в Telegram, без @. */
    telegram: "qairuhub",
  },
};

export const telegramUrl = (nick: string) => `https://t.me/${nick.replace(/^@/, "")}`;
