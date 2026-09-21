/**
 * Тонкая обёртка над Telegram Mini App API — для клиентских компонентов.
 *
 * Правила этого модуля:
 * — вне Telegram каждая функция ничего не делает и возвращает null, поэтому
 *   вызывающему коду не нужны проверки;
 * — «внутри Telegram» = у приложения есть подписанный `initData`. Скрипт
 *   telegram-web-app.js подключён на всех страницах и в обычном браузере тоже,
 *   но там initData пустой, и нативных кнопок быть не должно;
 * — методы, появившиеся в поздних версиях Bot API, вызываются через
 *   необязательные поля: у старого клиента их просто нет.
 *
 * Палитру Telegram мы намеренно не берём: у продукта своя тема (DESIGN.md).
 * Из Telegram синхронизируем только светлая/тёмная и цвета шапки и фона —
 * чтобы мини-апп не вспыхивал чужим фоном поверх чата.
 */

export type ColorScheme = "light" | "dark";

type Inset = { top: number; bottom: number; left: number; right: number };

type NativeButton = {
  setText(text: string): void;
  setParams(params: { color?: string; text_color?: string; text?: string; is_active?: boolean; is_visible?: boolean }): void;
  show(): void;
  hide(): void;
  enable(): void;
  disable(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
  onClick(handler: () => void): void;
  offClick(handler: () => void): void;
};

export type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: { start_param?: string };
  version?: string;
  colorScheme?: ColorScheme;
  safeAreaInset?: Inset;
  contentSafeAreaInset?: Inset;
  ready(): void;
  expand(): void;
  isVersionAtLeast?(version: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
  showConfirm?(message: string, callback: (ok: boolean) => void): void;
  /** Bot API 8.0: ярлык мини-аппа на главном экране телефона. */
  addToHomeScreen?(): void;
  checkHomeScreenStatus?(callback: (status: "unsupported" | "unknown" | "added" | "missed") => void): void;
  onEvent?(event: string, handler: () => void): void;
  offEvent?(event: string, handler: () => void): void;
  MainButton?: NativeButton;
  BackButton?: { show(): void; hide(): void; onClick(h: () => void): void; offClick(h: () => void): void };
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** Приложение Telegram, если страницу открыли из него. Иначе null. */
export function webApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const app = window.Telegram?.WebApp;
  return app?.initData ? app : null;
}

/**
 * Скрипт Telegram подключён с `async`, поэтому на первом кадре его может не
 * быть. Ждём появления, вызываем `run` и возвращаем функцию отмены —
 * её нужно вернуть из useEffect.
 */
export function whenReady(run: (app: TelegramWebApp) => void | (() => void)): () => void {
  let cleanup: (() => void) | void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  function attempt(tries = 0) {
    if (cancelled) return;
    const app = webApp();
    if (!app) {
      // Три секунды: дольше ждать нечего, значит это обычный браузер.
      if (tries < 30) timer = setTimeout(() => attempt(tries + 1), 100);
      return;
    }
    cleanup = run(app);
  }

  attempt();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    if (cleanup) cleanup();
  };
}

/** Короткий тактильный отклик. Вне Telegram — ничего. */
export function haptic(kind: "select" | "press" | "ok" | "error" = "select"): void {
  const feedback = webApp()?.HapticFeedback;
  if (!feedback) return;
  try {
    if (kind === "select") feedback.selectionChanged();
    else if (kind === "press") feedback.impactOccurred("light");
    else if (kind === "ok") feedback.notificationOccurred("success");
    else feedback.notificationOccurred("error");
  } catch {
    // У старых клиентов метода может не быть — отклик необязателен.
  }
}

/** Значение CSS-токена темы (например, `--surface`) как #rrggbb. */
export function themeColor(token: string): string | null {
  if (typeof window === "undefined") return null;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}
