"use client";

import { useEffect, useRef, useState } from "react";

import { PICK_EVENT, type PickDetail } from "./Board";

export type MeetingFormLabels = {
  newMeeting: string;
  place: string;
  placePh: string;
  goal: string;
  goalPh: string;
  when: string;
  whenHint: string;
  create: string;
};

/**
 * Форма новой встречи.
 *
 * Слушает событие от доски: кнопка «Назначить» под окном подставляет сюда
 * машинное время и человекочитаемую подпись, чтобы организатору не пришлось
 * переписывать час руками.
 */
export function MeetingForm({
  action,
  labels,
}: {
  action: (formData: FormData) => void;
  labels: MeetingFormLabels;
}) {
  const [when, setWhen] = useState("");
  const [whenLabel, setWhenLabel] = useState("—");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    function onPick(event: Event) {
      const { detail } = event as CustomEvent<PickDetail>;
      setWhen(detail.value);
      setWhenLabel(detail.text);
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.addEventListener(PICK_EVENT, onPick);
    return () => window.removeEventListener(PICK_EVENT, onPick);
  }, []);

  return (
    <form ref={formRef} action={action} style={{ marginTop: 14 }}>
      <h3>{labels.newMeeting}</h3>
      <div className="field">
        <label htmlFor="place">{labels.place}</label>
        <input id="place" name="place" type="text" maxLength={200} placeholder={labels.placePh} />
      </div>
      <div className="field">
        <label htmlFor="goal">{labels.goal}</label>
        <input id="goal" name="goal" type="text" maxLength={300} placeholder={labels.goalPh} />
      </div>
      <div className="field">
        <label htmlFor="when">
          {labels.when} — <span className="muted">{whenLabel}</span>
        </label>
        <input
          id="when"
          name="when"
          type="text"
          maxLength={200}
          value={when}
          onChange={(event) => setWhen(event.target.value)}
        />
        <p className="small muted" style={{ marginTop: 5 }}>
          {labels.whenHint}
        </p>
      </div>
      <button className="btn btn-primary" type="submit">
        {labels.create}
      </button>
    </form>
  );
}
