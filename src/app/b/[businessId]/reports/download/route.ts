// Report downloads: GET ?report=pnl|balance-sheet&format=pdf|csv|xlsx plus the report's
// own query (date, from, to, cmp / asof, cmp, cmp_date) and the viewer's tz for the
// generated-at stamp. Reads go through the DAL as the signed-in user, so RLS applies.
import type { NextRequest } from "next/server";
import { allowForUser, LIMITS, TOO_MANY } from "@/lib/security/rate-limit";
import { getBalanceSheetReport, getPnlReport } from "@/lib/dal-reports";
import { formatDate, formatRange, generatedAt, reportFilename, toCsv, type ReportDocument } from "@/lib/reports/document";
import { toPdf } from "@/lib/reports/pdf";
import { toXlsx } from "@/lib/reports/xlsx";

const TYPES = {
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
type Format = keyof typeof TYPES;

async function buildDocument(businessId: string, q: URLSearchParams): Promise<ReportDocument | null> {
  const stamp = generatedAt(new Date(), q.get("tz"));
  if (q.get("report") === "pnl") {
    const { business, params: p, statement } = await getPnlReport(businessId, q);
    return {
      businessName: business.name, title: "Profit & Loss", period: formatRange(p.range), basis: "Cash", generatedAt: stamp,
      columns: { main: formatRange(p.range), cmp: p.cmp ? formatRange(p.cmp) : null },
      statement,
      filename: (ext) => reportFilename(business.name, "profit-and-loss", p.range.from, p.range.to, ext),
    };
  }
  if (q.get("report") === "balance-sheet") {
    const { business, params: p, statement } = await getBalanceSheetReport(businessId, q);
    return {
      businessName: business.name, title: "Balance Sheet", period: `As of ${formatDate(p.asOf)}`, basis: "Cash", generatedAt: stamp,
      columns: { main: formatDate(p.asOf), cmp: p.cmpAsOf ? formatDate(p.cmpAsOf) : null },
      statement,
      // An as-of report has one date; with a comparison the name spans both.
      filename: (ext) => reportFilename(business.name, "balance-sheet", p.cmpAsOf && p.cmpAsOf < p.asOf ? p.cmpAsOf : p.asOf, p.asOf, ext),
    };
  }
  return null;
}

export async function GET(req: NextRequest, ctx: RouteContext<"/b/[businessId]/reports/download">) {
  const { businessId } = await ctx.params;
  const q = req.nextUrl.searchParams;
  const format = q.get("format") as Format;
  if (!(format in TYPES)) return new Response("Unknown format", { status: 400 });
  if (!(await allowForUser(LIMITS.exportPerUser))) return new Response(TOO_MANY, { status: 429 });
  const doc = await buildDocument(businessId, q);
  if (!doc) return new Response("Unknown report", { status: 400 });

  const body = format === "pdf" ? await toPdf(doc) : format === "xlsx" ? await toXlsx(doc) : toCsv(doc);
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${doc.filename(format)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
