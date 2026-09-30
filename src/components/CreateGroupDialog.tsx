"use client";

import { useEffect, useRef } from "react";

import { IconClose } from "./icons";

/**
 * «Создать группу» — окно поверх страницы. Открывается по адресу `/#create`:
 * ссылка из сайдбара группы, из панели профиля и возврат после входа ведут
 * сюда же, а форма больше не стоит внизу главной.
 */
export function CreateGroupDialog({
  action,
  timezones,
  langs,
  defaultLang,
  labels,
}: {
  action: (formData: FormData) => void;
  timezones: string[][];
  langs: [string, string][];
  defaultLang: string;
  labels: { title: string; name: string; namePh: string; tz: string; lang: string; submit: string; close: string };
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const sync = () => {
      if (window.location.hash === "#create" && !dialog.open) dialog.showModal();
    };
    // Закрыли окно — убираем #create из адреса, иначе «назад» откроет его снова.
    const onClose = () => {
      if (window.location.hash === "#create") {
        history.replaceState(history.state, "", window.location.pathname + window.location.search);
      }
    };
    // Ссылка на «#create» на этой же странице (сайдбар, панель профиля): Next
    // меняет адрес без события hashchange, поэтому окно открываем сами.
    // Слушаем на погружении — раньше, чем ссылка Next успеет сама перейти по адресу.
    // В свёрнутой полосе сайдбара нажатие сначала раскрывает его (см. LandingShell).
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href$="#create"]');
      if (!link || link.closest(".sidebar-closed") || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      if (!dialog.open) dialog.showModal();
    };
    sync();
    window.addEventListener("hashchange", sync);
    document.addEventListener("click", onClick, true);
    dialog.addEventListener("close", onClose);
    return () => {
      window.removeEventListener("hashchange", sync);
      document.removeEventListener("click", onClick, true);
      dialog.removeEventListener("close", onClose);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="create-dialog"
      aria-labelledby="create-title"
      onClick={(event) => {
        // Нажатие по фону вокруг окна закрывает его.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <form action={action}>
        <div className="create-head">
          <h2 id="create-title">{labels.title}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label={labels.close}
            title={labels.close}
            onClick={() => ref.current?.close()}
          >
            <IconClose size={18} />
          </button>
        </div>
        <div className="field">
          <label htmlFor="title">{labels.name}</label>
          <input id="title" name="title" type="text" required maxLength={120} placeholder={labels.namePh} />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="tz">{labels.tz}</label>
            <select id="tz" name="tz" defaultValue="Asia/Almaty">
              {timezones.map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="lang">{labels.lang}</label>
            <select id="lang" name="lang" defaultValue={defaultLang}>
              {langs.map(([code, title]) => (
                <option key={code} value={code}>
                  {title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" type="submit">
          {labels.submit}
        </button>
      </form>
    </dialog>
  );
}
