// CSV of the transaction list as filtered on screen (same query string). Any member may
// download; reads go through RLS as the signed-in user.
import { allowForUser, LIMITS, TOO_MANY } from "@/lib/security/rate-limit";
import type { NextRequest } from "next/server";
import { getAccountNames, getBusiness, getSupabase, searchArgs, todayIso } from "@/lib/dal";
import { toCsv } from "@/lib/export/csv";
import { formatCents } from "@/lib/money";
import { slugify } from "@/lib/reports/document";
import { parseFilters } from "@/lib/transactions/filters";

const MAX_ROWS = 50_000;

export async function GET(req: NextRequest, ctx: RouteContext<"/b/[businessId]/transactions/export">) {
  const { businessId } = await ctx.params;
  const { business } = await getBusiness(businessId);
  if (!(await allowForUser(LIMITS.exportPerUser))) return new Response(TOO_MANY, { status: 429 });
  const supabase = await getSupabase();
  const filters = parseFilters(req.nextUrl.searchParams);
  const args = searchArgs(business.id, filters, todayIso(), business.fiscal_year_start_month);
  const [names, rows] = await Promise.all([
    getAccountNames(business.id),
    supabase.rpc("search_transactions", args)
      .select("date, description_raw, description_clean, vendor_normalized, amount_cents, money_account_id, category_account_id, memo, reference")
      .order("date", { ascending: false }).order("created_at", { ascending: false }).order("id")
      .range(0, MAX_ROWS - 1),
  ]);
  if (rows.error) return new Response(rows.error.message, { status: 500 });
  const csv = toCsv(
    ["Date", "Description", "Vendor", "Account", "Category", "Amount", "Memo", "Reference", "Original description"],
    rows.data.map((r) => [
      r.date, r.description_clean ?? r.description_raw, r.vendor_normalized ?? "", names[r.money_account_id] ?? "",
      r.category_account_id ? names[r.category_account_id] ?? "" : "Uncategorized",
      formatCents(r.amount_cents, { symbol: false }).replace(/,/g, ""), r.memo ?? "", r.reference ?? "", r.description_raw,
    ]),
    new Set(["Description", "Vendor", "Account", "Category", "Memo", "Reference", "Original description"]),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slugify(business.name)}_transactions_${todayIso()}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
