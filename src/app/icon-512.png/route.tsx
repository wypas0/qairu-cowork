import { appIcon } from "@/lib/appIcon";

/** Иконка 512×512 для манифеста и домашнего экрана. Собирается при сборке. */
export const dynamic = "force-static";

export function GET() {
  return appIcon(512);
}
