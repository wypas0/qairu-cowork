"use client";

import { type PickDetail, pickMeeting } from "./pick";

/**
 * «Повторить встречу» из архива: форма новой встречи заполняется целью,
 * местом и тем же днём недели и временем на ближайшую неделю вперёд.
 * Поправить можно до отправки — это просто заполненная форма.
 */
export function RepeatMeetingButton({ detail, label }: { detail: PickDetail; label: string }) {
  return (
    <button type="button" className="btn btn-sm" onClick={() => pickMeeting(detail)}>
      {label}
    </button>
  );
}
