"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { haptic, whenReady } from "@/lib/telegram";

const OPENED_KEY = "qairu-opened-last-group";
const DISMISSED_KEY = "qairu-home-screen-dismissed";

/**
 * Мини-апп открывается кнопкой бота на главной странице сайта. Если человек
 * уже бывал в какой-то группе, сразу ведём его туда — он пришёл за своей
 * группой, а не за списком групп. Только один раз за запуск: нажатие на
 * логотип дальше должно открывать главную, а не отбрасывать обратно.
 */
export function OpenLastGroup({ slug }: { slug: string | null }) {
  const router = useRouter();

  useEffect(() => {
    if (!slug) return;
    return whenReady(() => {
      try {
        if (sessionStorage.getItem(OPENED_KEY) === "1") return;
        sessionStorage.setItem(OPENED_KEY, "1");
      } catch {
        // Без хранилища всё равно ведём — повтор в худшем случае лишь неудобен.
      }
      router.replace(`/g/${slug}`);
    });
  }, [slug, router]);

  return null;
}

/**
 * Предложение добавить мини-апп на главный экран телефона — открывать группу
 * в одно касание, без поиска бота в списке чатов. Показываем, только если
 * Telegram говорит, что это возможно и ещё не сделано, и если человек не
 * отказался раньше.
 */
export function HomeScreenPrompt({ labels }: { labels: { text: string; add: string; later: string } }) {
  const [visible, setVisible] = useState(false);

  useEffect(
    () =>
      whenReady((app) => {
        try {
          if (localStorage.getItem(DISMISSED_KEY) === "1") return;
        } catch {
          // см. ниже: без хранилища просто спросим
        }
        app.checkHomeScreenStatus?.((status) => setVisible(status === "missed"));
        const added = () => {
          haptic("ok");
          setVisible(false);
        };
        app.onEvent?.("homeScreenAdded", added);
        return () => app.offEvent?.("homeScreenAdded", added);
      }),
    [],
  );

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Не запомнили — спросим в следующий раз, это не страшно.
    }
  }

  return (
    <div className="notice notice-row home-screen" role="status">
      <span>{labels.text}</span>
      <span className="notice-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => whenReady((app) => app.addToHomeScreen?.())}
        >
          {labels.add}
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={dismiss}>
          {labels.later}
        </button>
      </span>
    </div>
  );
}
