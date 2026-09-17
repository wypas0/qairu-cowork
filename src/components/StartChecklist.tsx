import Link from "next/link";

import { translator } from "@/i18n";
import { CopyButton } from "./CopyButton";
import { IconCheck } from "./icons";

/**
 * Три шага, после которых группой можно пользоваться.
 *
 * Пустая группа выглядит одинаково с рабочей: та же карта, те же вкладки, — и
 * новый человек не понимает, почему ничего не показывается. Чеклист называет
 * недостающее вслух и исчезает целиком, как только всё сделано.
 */
export function StartChecklist({
  slug,
  lang,
  inviteUrl,
  scheduleFilled,
  hasOthers,
  hasMeetings,
}: {
  slug: string;
  lang: string;
  inviteUrl: string;
  scheduleFilled: boolean;
  hasOthers: boolean;
  hasMeetings: boolean;
}) {
  const t = translator(lang);
  const steps = [
    {
      key: "schedule",
      done: scheduleFilled,
      title: t("w_start_1"),
      hint: t("w_start_1_hint"),
      action: (
        <Link className="btn btn-sm" href={`/g/${slug}/me`}>
          {t("w_start_1_btn")}
        </Link>
      ),
    },
    {
      key: "invite",
      done: hasOthers,
      title: t("w_start_2"),
      hint: t("w_start_2_hint"),
      action: <CopyButton value={inviteUrl} label={t("w_copy")} copiedLabel={t("w_copied")} small />,
    },
    {
      key: "meeting",
      done: hasMeetings,
      title: t("w_start_3"),
      hint: t("w_start_3_hint"),
      action: null,
    },
  ];

  if (steps.every((step) => step.done)) return null;

  return (
    <section className="card">
      <h2>{t("w_start_title")}</h2>
      <ol className="start-list">
        {steps.map((step, index) => (
          <li className={`start-step${step.done ? " done" : ""}`} key={step.key}>
            <span className="start-mark" aria-hidden="true">
              {step.done ? <IconCheck size={14} /> : index + 1}
            </span>
            <div className="start-text">
              <b>{step.title}</b>
              <p className="small muted">{step.done ? t("w_start_done") : step.hint}</p>
            </div>
            {!step.done && step.action}
          </li>
        ))}
      </ol>
    </section>
  );
}
