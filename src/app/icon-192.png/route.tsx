import { appIcon } from "@/lib/appIcon";

/** Иконка 192×192 для манифеста и домашнего экрана. Собирается при сборке. */
export const dynamic = "force-static";

export function GET() {
  return appIcon(192);
}
