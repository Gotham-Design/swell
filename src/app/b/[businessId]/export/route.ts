// Full business export (zipped CSVs) for any member of the business; strangers get a 404
// from getBusiness, and every read goes through RLS as the signed-in user.
import { allowForUser, LIMITS, TOO_MANY } from "@/lib/security/rate-limit";
import type { NextRequest } from "next/server";
import { getBusiness, getSupabase, todayIso } from "@/lib/dal";
import { buildBusinessExport } from "@/lib/export/business-export";
import { slugify } from "@/lib/reports/document";

export async function GET(_req: NextRequest, ctx: RouteContext<"/b/[businessId]/export">) {
  const { businessId } = await ctx.params;
  const { business } = await getBusiness(businessId);
  if (!(await allowForUser(LIMITS.exportPerUser))) return new Response(TOO_MANY, { status: 429 });
  const supabase = await getSupabase();
  const { zip } = await buildBusinessExport(supabase, business.id, business.name, new Date().toISOString());
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slugify(business.name)}_export_${todayIso()}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
