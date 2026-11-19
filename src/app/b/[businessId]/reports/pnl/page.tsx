import { Suspense } from "react";
import Link from "next/link";
import { DownloadMenu } from "@/components/reports/download-menu";
import { PnlControls } from "@/components/reports/report-controls";
import { ReportFrame, Tile, Tiles } from "@/components/reports/report-frame";
import { StatementTable } from "@/components/reports/statement-table";
import { Money } from "@/components/ui-kit/money";
import { Chip } from "@/components/ui-kit/status-chip";
import { getSupabase } from "@/lib/dal";
import { getPnlReport } from "@/lib/dal-reports";
import { formatRange } from "@/lib/reports/document";
import { percentChange } from "@/lib/reports/lines";
import { pnlQuery, type Range } from "@/lib/reports/periods";
import { MONTHS } from "@/lib/validation/business";

export default function PnlPage({ params, searchParams }: PageProps<"/b/[businessId]/reports/pnl">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-surface-muted" />}>
      <Pnl params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/** "October 2026" for a whole calendar month, else the range. */
function rangeLabel(r: Range) {
  const [y, m, d] = r.from.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (d === 1 && r.to === end) return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return formatRange(r);
}
const shortMonth = (r: Range) => {
  const label = rangeLabel(r);
  return /^\w+ \d{4}$/.test(label) ? label.replace(/^(\w{3})\w* /, "$1 ") : formatRange(r);
};

async function Pnl({ params, searchParams }: PageProps<"/b/[businessId]/reports/pnl">) {
  const { businessId } = await params;
  const { business, params: p, statement } = await getPnlReport(businessId, await searchParams);
  const query = pnlQuery(p);
  const fy = business.fiscal_year_start_month;
  const line = (key: string) => statement.lines.find((l) => l.key === key);
  const income = line("income_total"), expenses = line("expense_total"), net = line("net_income");
  const cmpName = p.cmp ? rangeLabel(p.cmp).replace(/ \d{4}$/, "") : null;
  const vs = (now: number | null | undefined, before: number | null | undefined) =>
    p.cmp && now != null && before != null ? `${percentChange(now, before) ?? "—"} vs. ${cmpName}` : undefined;
  // Margin is a display ratio of two SQL totals.
  const margin = (n: number | null | undefined, i: number | null | undefined) => (i ? Math.round((n! / i) * 1000) / 10 : null);
  const m = margin(net?.cents, income?.cents);
  const mPrev = margin(net?.cmpCents, income?.cmpCents);

  // Transactions in the period still waiting for a category.
  const supabase = await getSupabase();
  const { data: s } = await supabase.rpc("summarize_transactions", { p_business_id: business.id, p_from: p.range.from, p_to: p.range.to }).single();
  const waiting = Number(s?.uncategorized ?? 0);

  return (
    <ReportFrame businessId={business.id} active="pnl"
      controls={<>
        <PnlControls key={query} params={p} label={rangeLabel(p.range)}
          fiscalNote={fy !== 1 ? `Quarters and years follow your fiscal year (starts in ${MONTHS[fy - 1]}).` : undefined} />
        <DownloadMenu businessId={business.id} report="pnl" query={query} />
      </>}
      meta={<>Cash basis{p.cmp ? ` · Compared with ${rangeLabel(p.cmp)}` : ""}</>}>
      {p.problem && <p className="text-sm text-money-out-text" role="alert">{p.problem} Showing this month instead.</p>}
      <Tiles cols={4}>
        <Tile label="Income" value={<Money cents={income?.cents ?? 0} split tone="in" />} foot={vs(income?.cents, income?.cmpCents)} testId="pnl-income" />
        <Tile label="Expenses" value={<Money cents={expenses?.cents ?? 0} split tone="out" />} foot={vs(expenses?.cents, expenses?.cmpCents)} testId="pnl-expenses" />
        <Tile label="Net income" value={<Money cents={net?.cents ?? 0} split />} foot={vs(net?.cents, net?.cmpCents)} testId="pnl-net" />
        <Tile label="Profit margin" testId="pnl-margin"
          value={m === null ? "—" : <span className="tabular-nums">{Math.trunc(m)}<span className="text-muted-foreground">.{String(Math.abs(Math.round((m % 1) * 10)))}%</span></span>}
          foot={m !== null && mPrev !== null ? `${m >= mPrev ? "Up" : "Down"} from ${mPrev.toFixed(1)}%` : undefined} />
      </Tiles>
      <StatementTable statement={statement} businessId={business.id} testId="pnl"
        columns={{ main: shortMonth(p.range), cmp: p.cmp ? shortMonth(p.cmp) : null }}
        footer={waiting > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t px-5 py-4 text-[13px]" data-testid="uncategorized-warning">
            <Chip tone="review">{waiting} transaction{waiting === 1 ? "" : "s"} still need{waiting === 1 ? "s" : ""} review</Chip>
            <span className="flex-1 text-muted-foreground">Totals may shift slightly once they&apos;re categorized.</span>
            <Link className="font-medium hover:underline" href={`/b/${business.id}/transactions?type=uncategorized&date=custom&from=${p.range.from}&to=${p.range.to}`}>
              Review now
            </Link>
          </div>
        )} />
    </ReportFrame>
  );
}
