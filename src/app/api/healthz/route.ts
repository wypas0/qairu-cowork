import { checkHealth } from "@/lib/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Здоровье сайта для мониторов (DEPLOY.md, «Мониторинг»).
 *
 *   GET /api/healthz       → 200 {ok:true, db:{ok:true, ms}, version, at}
 *                            503 {ok:false, db:{ok:false, ms, error}, …} — база
 *                            упала или не ответила за 2,5 с;
 *   GET /api/healthz?live  → 200 без похода в базу: «процесс жив и отвечает».
 *
 * Ответ не кешируется ни браузером, ни CDN: монитор должен видеть сейчас, а не
 * минуту назад.
 */
export async function GET(request: Request) {
  const live = new URL(request.url).searchParams.has("live");
  const health = await checkHealth({ db: !live });
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
