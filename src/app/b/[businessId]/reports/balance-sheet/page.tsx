import { Suspense } from "react";
import { DownloadMenu } from "@/components/reports/download-menu";
import { BalanceSheetControls } from "@/components/reports/report-controls";
import { ReportFrame, Tile, Tiles } from "@/components/reports/report-frame";
import { StatementTable } from "@/components/reports/statement-table";
import { Money } from "@/components/ui-kit/money";
import { Chip } from "@/components/ui-kit/status-chip";
import { getBalanceSheetReport } from "@/lib/dal-reports";
import { formatCents, sumCents } from "@/lib/money";
import { formatDate } from "@/lib/reports/document";
import type { ReportLine } from "@/lib/reports/lines";
import { bsQuery } from "@/lib/reports/periods";

export default function BalanceSheetPage({ params, searchParams }: PageProps<"/b/[businessId]/reports/balance-sheet">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-surface-muted" />}>
      <BalanceSheet params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const SHARE_COLORS = ["bg-brand", "bg-brand/55", "bg-brand/25", "bg-border"];

/** Up to three names in plain words: "Checking, savings and equipment". */
function listNames(lines: ReportLine[]) {
  const names = lines.slice(0, 3).map((l, i) => (i === 0 ? l.label : l.label.toLowerCase()));
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

async function BalanceSheet({ params, searchParams }: PageProps<"/b/[businessId]/reports/balance-sheet">) {
  const { businessId } = await params;
  const { business, params: p, today, statement } = await getBalanceSheetReport(businessId, await searchParams);
  const query = bsQuery(p, today);
  const line = (key: string) => statement.lines.find((l) => l.key === key);
  const owns = line("total_assets"), owes = line("total_liabilities"), equity = line("total_equity");
  const diff = statement.difference;
  const off = diff && diff.cents !== 0 ? diff.cents : 0;
  const cmpLabel = p.cmpAsOf ? formatDate(p.cmpAsOf) : null;
  const shortAsOf = new Date(`${p.asOf}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const columns = { main: shortAsOf, cmp: p.cmpAsOf ? new Date(`${p.cmpAsOf}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null };

  const of = (section: ReportLine["section"]) => statement.lines.filter((l) => l.section === section);
  const accountsOf = (section: ReportLine["section"]) => of(section).filter((l) => l.kind === "account" && (l.cents ?? 0) > 0)
    .sort((a, b) => (b.cents ?? 0) - (a.cents ?? 0));
  const assets = accountsOf("asset");
  const ownsTotal = owns?.cents ?? 0;
  // Shares are display ratios of SQL totals; the top three accounts, then the rest.
  const shares = [...assets.slice(0, 3).map((a) => ({ label: a.label, cents: a.cents! })),
    ...(assets.length > 3 ? [{ label: "Everything else", cents: sumCents(assets.slice(3).map((a) => a.cents!)) }] : [])];

  const grandify = (ls: ReportLine[], key: string) => ls.map((l) => (l.key === key ? { ...l, kind: "grand" as const } : l));

  return (
    <ReportFrame businessId={business.id} active="bs"
      controls={<>
        <BalanceSheetControls key={query} params={p} today={today} label={formatDate(p.asOf)} />
        <DownloadMenu businessId={business.id} report="balance-sheet" query={query} />
      </>}
      meta={<>As of {formatDate(p.asOf)}{cmpLabel ? ` · Compared with ${cmpLabel}` : ""}</>}>
      <Tiles cols={3}>
        <Tile label="What the business owns" value={<Money cents={ownsTotal} split />} foot={listNames(assets) || "Nothing yet"} testId="bs-owns" />
        <Tile label="What it owes" value={<Money cents={owes?.cents ?? 0} split />} foot={listNames(accountsOf("liability")) || "Nothing owed"} testId="bs-owes" />
        <Tile label="Owner's equity" value={<Money cents={equity?.cents ?? 0} split />} foot="Owns minus owes" testId="bs-equity"
          badge={off === 0
            ? <Chip tone="categorized" testId="balanced">Balanced</Chip>
            : <Chip tone="review" testId="imbalance">Off by {formatCents(Math.abs(off))}</Chip>} />
      </Tiles>

      {ownsTotal > 0 && (
        <section className="surface p-5" aria-label="Where the money sits">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold">Where the money sits</h2>
            <p className="text-xs text-muted-foreground">Share of what the business owns</p>
          </div>
          <div className="flex h-3 gap-1 overflow-hidden rounded-full" aria-hidden>
            {shares.map((s, i) => <span key={s.label} className={`rounded-full ${SHARE_COLORS[i]}`} style={{ flexGrow: Math.max(s.cents / ownsTotal, 0.01) }} />)}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs" data-testid="money-sits">
            {shares.map((s, i) => (
              <li key={s.label} className="flex items-center gap-1.5">
                <span className={`size-2 rounded-full ${SHARE_COLORS[i]}`} aria-hidden />
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground tabular-nums">{(Math.round((s.cents / ownsTotal) * 1000) / 10).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2" data-testid="balance-sheet">
        <StatementTable statement={statement} businessId={business.id} testId="bs-assets" title="Assets" changeColumn={false}
          columns={columns} lines={grandify(of("asset").filter((l) => l.kind !== "heading"), "total_assets")} />
        <div className="space-y-4">
          <StatementTable statement={statement} businessId={business.id} testId="bs-liabilities" title="Liabilities" changeColumn={false}
            columns={columns} lines={of("liability").filter((l) => l.kind !== "heading")} />
          <StatementTable statement={statement} businessId={business.id} testId="bs-equity" title="Equity" changeColumn={false}
            columns={columns} lines={[...of("equity").filter((l) => l.kind !== "heading"), ...statement.lines.filter((l) => l.key === "total_liabilities_equity")]} />
        </div>
      </div>
    </ReportFrame>
  );
}
