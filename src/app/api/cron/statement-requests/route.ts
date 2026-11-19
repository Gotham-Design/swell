// Daily (vercel.json crons): email the recurring statement requests that are due.
import { serverEnv } from "@/lib/env/server";
import { runDueSchedules } from "@/lib/requests/run-schedules";
import { safeEqual } from "@/lib/security/compare";

export async function GET(request: Request) {
  const secret = serverEnv.cronSecret;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return new Response("Not allowed", { status: 401 });
  }
  const origin = serverEnv.appOrigin || new URL(request.url).origin;
  const report = await runDueSchedules(origin);
  return Response.json(report);
}
