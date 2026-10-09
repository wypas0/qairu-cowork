import { notFound, redirect } from "next/navigation";

import { ownerViewer } from "@/lib/ownerGate";

export const dynamic = "force-dynamic";

/**
 * Старый адрес статистики. Статистика теперь — часть консоли (/admin):
 * владельца ведём туда, остальным — «не найдено», как и раньше.
 */
export default async function StatsPage() {
  if (!(await ownerViewer())) notFound();
  redirect("/admin");
}
