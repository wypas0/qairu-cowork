"use client";

import { useEffect, useRef, useState } from "react";

import { PICK_EVENT, type PickDetail } from "./Board";
import { IconPlus } from "./icons";

export type MeetingFormLabels = {
  newMeeting: string;
  place: string;
  placePh: string;
  goal: string;
  goalPh: string;
  when: string;
  whenHint: string;
  create: string;
  cancel: string;
  repeat: string;
  repeatUntil: string;
  repeatHint: string;
};

/**
 * Форма новой встречи.
 *
 * Стоит наверху раздела «Встречи», свёрнутая в одну кнопку: раньше она была
 * в самом низу, под всеми встречами, и до неё приходилось листать. Кнопка
 * «Назначить» у окна разворачивает форму сама и подставляет время.
 *
 * Выбранное время уходит на сервер в машинном виде («2026-09-16T15:00|30»),
 * а человек видит его словами. Раньше машинная строка показывалась прямо
 * в поле; если начать печатать своё, выбор сбрасывается и уходит текст.
 */
export function MeetingForm({
  action,
  labels,
}: {
  action: (formData: FormData) => void;
  labels: MeetingFormLabels;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickDetail | null>(null);
  const [typed, setTyped] = useState("");
  const [repeat, setRepeat] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const goalRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onPick(event: Event) {
      const { detail } = event as CustomEvent<PickDetail>;
      setPicked(detail);
      setTyped("");
      setOpen(true);
      // Ждём кадр: форма только что развернулась.
      requestAnimationFrame(() => {
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        goalRef.current?.focus({ preventScroll: true });
      });
    }
    window.addEventListener(PICK_EVENT, onPick);
    return () => window.removeEventListener(PICK_EVENT, onPick);
  }, []);

  if (!open) {
    return (
      <button type="button" className="btn new-meeting" onClick={() => setOpen(true)}>
        <IconPlus size={18} /> {labels.newMeeting}
      </button>
    );
  }

  return (
    <form ref={formRef} action={action} className="meeting-form">
      <h3>{labels.newMeeting}</h3>
      <input type="hidden" name="when" value={picked ? picked.value : typed} />
      <div className="field">
        <label htmlFor="goal">{labels.goal}</label>
        <input
          ref={goalRef}
          id="goal"
          name="goal"
          type="text"
          maxLength={300}
          placeholder={labels.goalPh}
        />
      </div>
      <div className="field">
        <label htmlFor="place">{labels.place}</label>
        <input id="place" name="place" type="text" maxLength={200} placeholder={labels.placePh} />
      </div>
      <div className="field">
        <label htmlFor="when-text">{labels.when}</label>
        <input
          id="when-text"
          type="text"
          maxLength={200}
          value={picked ? picked.text : typed}
          onChange={(event) => {
            setPicked(null);
            setTyped(event.target.value);
          }}
        />
        <p className="small muted" style={{ marginTop: 5 }}>
          {labels.whenHint}
        </p>
      </div>
      {/* Повторять можно только встречу с точным временем: иначе неясно, когда повтор. */}
      {picked ? (
        <div className="field">
          <label className="checkbox">
            <input
              type="checkbox"
              name="repeat"
              checked={repeat}
              onChange={(event) => setRepeat(event.target.checked)}
            />
            <span>{labels.repeat}</span>
          </label>
          {repeat && (
            <div className="repeat-until">
              <label htmlFor="repeat_until">{labels.repeatUntil}</label>
              <input
                id="repeat_until"
                name="repeat_until"
                type="date"
                min={pickedDate(picked)}
                defaultValue={addWeeks(pickedDate(picked), 12)}
                required
              />
            </div>
          )}
        </div>
      ) : (
        <p className="small muted">{labels.repeatHint}</p>
      )}

      <div className="dated-actions">
        <button className="btn btn-primary" type="submit">
          {labels.create}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
          {labels.cancel}
        </button>
      </div>
    </form>
  );
}

/** Дата выбранного окна из машинной строки «2026-09-16T15:00|30». */
function pickedDate(picked: PickDetail): string {
  return picked.value.slice(0, 10);
}

/** Та же дата через `weeks` недель — по умолчанию серия идёт около семестра. */
function addWeeks(date: string, weeks: number): string {
  const moment = new Date(`${date}T12:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + weeks * 7);
  return moment.toISOString().slice(0, 10);
}
