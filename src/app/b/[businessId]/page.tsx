import { accountFreshness } from "@/lib/accounts/freshness";
import { Suspense } from "react";
import { after } from "next/server";
import { maybeRunSuggestions } from "@/lib/ai/run";
import { RequestStatementsButton } from "@/components/requests/request-statements";
import { defaultFromName } from "./import/request-actions";
import { serverEnv } from "@/lib/env/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AddTransactionButton } from "@/components/transactions/add-transaction";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { BooksHealthCard, MoneyAccountsCard, MoneyMovementCard, OverviewCard } from "@/components/overview/cards";
import { PeriodPicker } from "@/components/overview/period-picker";
import { periodHref, resolveOverviewPeriod } from "@/lib/overview/period";
import { AddMoneyAccountButton } from "./accounts/money-accounts";
import { ImportStatementButton } from "@/components/ui-kit/import-button";
import { SearchField } from "@/components/ui-kit/search-field";
import { SMART_SEARCH } from "@/lib/flags";
import { ShellActions } from "@/components/shell/shell-actions";
import { getMatchesFor, getTransferCounts } from "@/lib/dal-transfers";
import { ChartLine } from "lucide-react";
import {
  getAccountNames, getAiState, getBusiness, getLastImports, getMoneyAccounts, getPickerOptions, getRecentCategoryIds,
  getReceivedCount, getSuggestionsFor, getTransactionsPage, todayIso,
} from "@/lib/dal";
import { getOverviewData, type OverviewTab } from "@/lib/dal-overview";
import { sumCents } from "@/lib/money";
import { EMPTY_FILTERS, toQueryString, type TypeFilter } from "@/lib/transactions/filters";
import { isOwedKind } from "@/lib/validation/accounts";
import { cn } from "@/lib/utils";
import { INDUSTRY_LABEL, MONTHS, type Industry } from "@/lib/validation/business";

const TAB_TYPES: Record<OverviewTab, TypeFilter[]> = { all: [], review: ["uncategorized"], in: ["income"], out: ["expense"] };
const TAB_LABEL: Record<OverviewTab, string> = { all: "All", review: "Needs review", in: "Money in", out: "Money out" };

export default function OverviewPage({ params, searchParams }: PageProps<"/b/[businessId]">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-surface-muted" />}>
      <Overview params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Overview({ params, searchParams }: PageProps<"/b/[businessId]">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const fy = (await getBusiness(businessId)).business.fiscal_year_start_month;
  const period = resolveOverviewPeriod(sp, todayIso(), fy);
  const month = { from: period.from, to: period.to, prevFrom: period.cmp?.from ?? null, prevTo: period.cmp?.to ?? null, chartMonths: period.chartMonths };
  const tab: OverviewTab = (["all", "review", "in", "out"] as const).find((t) => t === sp.recent) ?? "all";
  const [{ business, canWrite }, accounts, lastImports, data, recent, names, options, recentIds, ai, fromName, received] = await Promise.all([
    getBusiness(businessId), getMoneyAccounts(businessId), getLastImports(businessId), getOverviewData(businessId, month),
    getTransactionsPage(businessId, { ...EMPTY_FILTERS, types: TAB_TYPES[tab] }),
    getAccountNames(businessId), getPickerOptions(businessId), getRecentCategoryIds(businessId), getAiState(businessId),
    defaultFromName(businessId), getReceivedCount(businessId),
  ]);
  // "Load more" adds ten rows at a time, up to the first page of the full list.
  const RECENT_STEP = 10;
  const shown = Math.min(recent.rows.length, RECENT_STEP * Math.max(1, Math.min(5, Number.parseInt(String(sp.more ?? "1"), 10) || 1)));
  const rows = recent.rows.slice(0, shown);
  const moreHref = `/b/${businessId}?${new URLSearchParams({
    ...(period.key !== "this_month" ? { period: period.key } : {}), ...(period.compare !== "none" ? { cmp: period.compare } : {}),
    ...(tab === "all" ? {} : { recent: tab }), more: String(shown / RECENT_STEP + 1),
  })}`;
  // Rows with no suggestion yet get one in the background (throttled in maybeRunSuggestions).
  if (canWrite && ai.enabled && data.books.uncategorized > ai.pending) after(() => maybeRunSuggestions(business.id));
  const [suggestions, matches, transfers] = await Promise.all([
    ai.enabled ? getSuggestionsFor(business.id, rows.map((r) => r.id)) : Promise.resolve({}),
    getMatchesFor(business.id, rows.map((r) => r.id)),
    canWrite ? getTransferCounts(business.id) : Promise.resolve({ pairs: 0, lone: 0 }),
  ]);
  const active = accounts.filter((a) => !a.archived);
  const moneyAccounts = active.map((a) => ({ id: a.id, name: a.name, last4: a.last4 }));
  // Cash on hand: checking + savings + cash, as of each one's last import.
  const cash = sumCents(active.filter((a) => ["checking", "savings", "cash"].includes(a.kind)).map((a) => a.balance_cents));
  const base = `/b/${business.id}`;
  const hasActivity = Number(recent.summary.count) > 0;
  const today = todayIso();
  const clientMeta = [
    business.industry ? INDUSTRY_LABEL[business.industry as Industry] : null,
    "Cash basis",
    business.fiscal_year_start_month !== 1 ? `Fiscal year starts in ${MONTHS[business.fiscal_year_start_month - 1]}` : null,
    business.lock_date
      ? `Books closed through ${new Date(`${business.lock_date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      <ShellActions>
        {!SMART_SEARCH && <SearchField action={`${base}/transactions`} className="w-full sm:w-72" />}
        {canWrite && <RequestStatementsButton businessId={business.id} businessName={business.name} defaultFrom={fromName}
          accounts={active.map((a) => ({ id: a.id, name: a.name, last4: a.last4 }))} canEmail={serverEnv.canSendEmail} />}
        <Button variant="outline" nativeButton={false} render={<Link href={`${base}/reports`} />}><ChartLine aria-hidden /> Run report</Button>
        {canWrite && <AddTransactionButton disabled={!active.length} />}
        {canWrite && <ImportStatementButton businessId={business.id} />}
      </ShellActions>

      {received > 0 && (
        <section className="surface flex flex-wrap items-center gap-4 border-brand/30 bg-brand-soft px-5 py-4" data-testid="received-banner">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{received} statement{received === 1 ? "" : "s"} received from {business.name}</span>
            <span className="text-muted-foreground"> · sent through your request link, waiting to be imported</span>
          </p>
          <Button nativeButton={false} render={<Link href={`${base}/import`} />}>Import now</Button>
        </section>
      )}

      {!hasActivity && canWrite && (
        <section className="surface flex flex-wrap items-center gap-4 bg-brand-soft p-5" data-testid="getting-started">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">{active.length ? "Import your first statement" : "Add the first money account"}</h2>
            <p className="text-sm text-muted-foreground">
              {active.length
                ? "Download a CSV from the bank, drop it in, and every row gets checked before anything reaches the books."
                : "Checking, savings, credit card or cash: every transaction lives in one, and statements import into it."}
            </p>
          </div>
          {active.length
            ? <ImportStatementButton businessId={business.id} />
            : <Button nativeButton={false} render={<Link href={`${base}/accounts`} />}>Add a money account</Button>}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_368px]">
        <OverviewCard client={{ name: business.name, meta: clientMeta }} businessId={business.id} canWrite={canWrite} monthName={period.name} prevName={period.cmp?.name ?? null} net={data.net} income={data.income} expenses={data.expenses}
          margin={data.margin} change={data.change} costs={data.costs} monthly={data.monthly}
          picker={<PeriodPicker period={period} recent={tab === "all" ? undefined : tab} />} />
        <MoneyAccountsCard businessId={business.id} cash={cash}
          accounts={active.map((a) => {
            const f = accountFreshness(lastImports.get(a.id));
            return { id: a.id, name: a.name, last4: a.last4, owed: isOwedKind(a.kind), balance: a.balance_cents,
              freshness: f.label, stale: f.stale, card: a.kind === "credit_card" };
          })}
          // One account is rarely the whole picture: offer the next one until there are two.
          add={canWrite && active.length === 1 ? <AddMoneyAccountButton businessId={business.id} defaultDate={today} /> : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_368px]">
        <MoneyMovementCard movement={data.movement} notes={data.notes} canWrite={canWrite}
          picker={<PeriodPicker period={period} recent={tab === "all" ? undefined : tab} />} />
        <BooksHealthCard businessId={business.id} books={data.books} coming={data.coming} transfers={transfers.pairs + transfers.lone} />
      </div>

      <TransactionsTable businessId={business.id} rows={rows} total={rows.length} matchingNet={0} names={names} options={options}
        moneyAccounts={moneyAccounts} recentIds={recentIds} canWrite={canWrite} query="" lockDate={business.lock_date}
        deletedView={false} today={today} suggestions={suggestions} matches={matches} selectable={false}
        footer={Number(recent.summary.count) > rows.length && (
          <div className="flex items-center justify-center gap-4 border-t px-5 py-3 text-sm" data-testid="recent-more">
            {shown < recent.rows.length ? (
              <Link href={moreHref} scroll={false} className="font-medium text-brand hover:underline">Load more</Link>
            ) : null}
            <Link href={`${base}/transactions${toQueryString({ ...EMPTY_FILTERS, types: TAB_TYPES[tab] })}`} className="text-muted-foreground hover:underline">
              See all {Number(recent.summary.count).toLocaleString("en-US")} in Transactions
            </Link>
          </div>
        )}
        header={
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <h2 className="text-[15px] font-semibold">Recent transactions</h2>
            <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto">
              <nav aria-label="Recent transactions" className="flex min-w-0 items-center overflow-x-auto rounded-full bg-surface-muted p-1 [scrollbar-width:none]">
                {(Object.keys(TAB_LABEL) as OverviewTab[]).map((t) => (
                  <Link key={t} href={periodHref(base, period, { recent: t === "all" ? undefined : t })}
                    aria-current={t === tab ? "page" : undefined} scroll={false} data-testid={`recent-${t}`}
                    className={cn("inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-sm transition-colors sm:px-3.5",
                      t === tab ? "bg-card font-medium shadow-[0_1px_2px_rgb(15_31_23/0.08)]" : "text-muted-foreground hover:text-foreground")}>
                    {TAB_LABEL[t]}
                  </Link>
                ))}
              </nav>
              <Link href={`${base}/transactions${toQueryString({ ...EMPTY_FILTERS, types: TAB_TYPES[tab] })}`}
                className="shrink-0 text-sm font-medium hover:underline">View all</Link>
            </div>
          </div>
        } />
    </div>
  );
}
