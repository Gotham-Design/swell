import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { formatCents, spokenCents, type Cents } from "@/lib/money";
import { lineFigures } from "@/lib/reports/document";
import type { Drill, ReportLine, Statement } from "@/lib/reports/lines";
import { cn } from "@/lib/utils";

/** Where a drill goes: the transaction list filtered to the category and dates, or the P&L. */
export function drillHref(businessId: string, d: Drill): string {
  const q = new URLSearchParams();
  if (d.to === "pnl") {
    q.set("date", "custom"); q.set("from", d.from); q.set("to", d.to_date);
    return `/b/${businessId}/reports/pnl?${q}`;
  }
  q.set("date", "custom");
  if (d.from) q.set("from", d.from);
  q.set("to", d.to_date);
  if (d.uncategorized) q.set("type", "uncategorized");
  if (d.categories?.length) q.set("cat", d.categories.join(","));
  return `/b/${businessId}/transactions?${q}`;
}

const money = (c: Cents) => formatCents(c, { negative: "parens" });

/**
 * A statement as a card: muted header row, section headings, accounts indented, totals
 * ruled, the grand total on evergreen-soft. With a comparison, the last column is the %
 * change, coloured by whether it's good (income up, expenses down) or bad; "New" in amber
 * when there was nothing before. Clicking an amount opens the transactions behind it.
 */
export function StatementTable({ statement, businessId, columns, testId, lines, title, changeColumn = true, footer }: {
  statement: Statement;
  businessId: string;
  columns: { main: string; cmp: string | null };
  testId: string;
  /** A subset of lines (the balance sheet splits into cards); default all. */
  lines?: ReportLine[];
  /** Header label for the first column. */
  title?: string;
  changeColumn?: boolean;
  /** Under the table, inside the card. */
  footer?: React.ReactNode;
}) {
  const hasCmp = statement.hasComparison;
  const showChange = hasCmp && changeColumn;
  return (
    <div className="surface overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm" data-testid={testId}>
        <thead>
          <tr className="bg-surface-muted text-left text-xs text-muted-foreground [&_th]:h-10 [&_th]:font-medium">
            <th className="pl-5 uppercase tracking-[0.06em]">{title ?? "Category"}</th>
            <th className="px-3 text-right">{columns.main}</th>
            {hasCmp && <th className="px-3 text-right">{columns.cmp}</th>}
            {showChange && <th className="pr-5 pl-3 text-right">Change</th>}
            {!showChange && <th className="w-2 pr-2" aria-hidden />}
          </tr>
        </thead>
        <tbody>
          {(lines ?? statement.lines).map((l) => (
            <Line key={l.key} line={l} hasCmp={hasCmp} showChange={showChange} businessId={businessId} />
          ))}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

function Amount({ cents, drill, businessId, label, strong, muted }: {
  cents: Cents | null; drill?: Drill; businessId: string; label: string; strong?: boolean; muted?: boolean;
}) {
  if (cents === null) return <td className="px-3 text-right text-muted-foreground">—</td>;
  return (
    <td className={cn("whitespace-nowrap px-3 text-right tabular-nums", strong && "font-semibold", muted && "text-muted-foreground",
      cents < 0 && !muted && "text-money-out-text")}
      aria-label={drill ? undefined : `${label}: ${spokenCents(cents)}`}>
      {drill ? (
        <Link href={drillHref(businessId, drill)} className="underline-offset-4 hover:underline" aria-label={`${label}: ${spokenCents(cents)}, show transactions`}>
          {money(cents)}
        </Link>
      ) : money(cents)}
    </td>
  );
}

function Line({ line: l, hasCmp, showChange, businessId }: { line: ReportLine; hasCmp: boolean; showChange: boolean; businessId: string }) {
  const f = lineFigures(l, hasCmp);
  const strong = l.kind === "total" || l.kind === "grand" || l.kind === "subtotal";
  const cols = 1 + (hasCmp ? 1 : 0) + 1;
  const label = (
    <td className={cn("py-2.5 pr-3", strong && "font-semibold", l.kind === "parent" && "font-medium", l.kind === "heading" && "pt-4 pb-1.5 font-semibold")}
      style={{ paddingLeft: `${1.25 + (l.kind === "account" || l.kind === "parent" ? Math.max(1, l.depth + 1) : l.depth) * 1}rem` }}>
      <span className={cn("inline-flex items-center gap-1.5", l.warn && "text-attention-text")}>
        {l.warn && <TriangleAlert className="size-3.5" aria-label="Needs review" />}
        {l.label}
      </span>
    </td>
  );
  if (l.kind === "heading" || l.kind === "parent") {
    return <tr data-line={l.key} className={cn(l.kind === "heading" && "border-t first:border-t-0")}>{label}<td colSpan={cols} /></tr>;
  }
  return (
    <tr data-line={l.key}
      className={cn(strong && "border-t", l.kind === "total" && "border-b", l.kind === "grand" && "bg-brand-soft text-[15px]")}>
      {label}
      <Amount cents={f.cents} drill={l.drill} businessId={businessId} label={l.label} strong={strong} />
      {hasCmp && <Amount cents={f.cmpCents} drill={l.cmpDrill} businessId={businessId} label={`${l.label} (comparison)`} strong={false} muted />}
      {showChange ? <Change line={l} pct={f.pct} strong={strong} /> : <td aria-hidden />}
    </tr>
  );
}

/** Good is green, bad is red: income and equity up are good; expenses and liabilities up are bad. */
function Change({ line: l, pct, strong }: { line: ReportLine; pct: string | null; strong: boolean }) {
  const isNew = (l.cmpCents === 0 || l.cmpCents === null) && !!l.cents;
  if (isNew) return <td className="pr-5 pl-3 text-right text-attention-text">New</td>;
  if (!pct || pct === "0.0%" || pct === "+0.0%") return <td className="pr-5 pl-3 text-right text-muted-foreground">—</td>;
  const up = pct.startsWith("+");
  const upIsGood = l.key === "net_income" || l.section === "income" || l.section === "asset" || l.section === "equity";
  const good = up === upIsGood;
  return (
    <td className={cn("whitespace-nowrap pr-5 pl-3 text-right tabular-nums", strong && "font-semibold", good ? "text-money-in-text" : "text-money-out-text")}>
      {pct}
    </td>
  );
}
