import { cookies } from "next/headers";

import { translator } from "@/i18n";
import { HOWTO_COOKIE, parseHowto } from "@/lib/cookies";
import { HowTo } from "./HowTo";

/** Шагов в описании не больше стольких — дальше это уже не подсказка, а инструкция. */
const MAX_STEPS = 6;

/**
 * Шаги описания раздела `id` из i18n: `w_howto_<id>_1`, `_2`… — сколько есть.
 * Отдельно от HowToHint — для клиентских мест (панель профиля), куда шаги
 * приходят готовыми.
 */
export function howtoSteps(lang: string, id: string): string[] {
  const t = translator(lang);
  const steps: string[] = [];
  for (let n = 1; n <= MAX_STEPS; n += 1) {
    const key = `w_howto_${id}_${n}`;
    const text = t(key);
    if (text === key) break;
    steps.push(text);
  }
  return steps;
}

/** Раскрыто ли описание на этом устройстве. */
export async function howtoOpen(id: string): Promise<boolean> {
  return parseHowto((await cookies()).get(HOWTO_COOKIE)?.value).includes(id);
}

/** «Как это работает» для серверной страницы: шаги из i18n, раскрыто ли — из куки. */
export async function HowToHint({ id, lang }: { id: string; lang: string }) {
  const t = translator(lang);
  return <HowTo id={id} title={t("w_howto")} steps={howtoSteps(lang, id)} initialOpen={await howtoOpen(id)} />;
}
