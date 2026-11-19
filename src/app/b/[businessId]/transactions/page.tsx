import { Suspense } from "react";
import { after } from "next/server";
import { maybeRunSuggestions } from "@/lib/ai/run";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FilterBar, PeriodSelect } from "@/components/transactions/filter-bar";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { AddTransactionButton } from "@/components/transactions/add-transaction";
import { FileConfidentButton, GetSuggestionsButton } from "@/components/transactions/get-suggestions";
import { SortingNotice } from "@/components/transactions/auto-refresh";
import { ImportStatementButton } from "@/components/ui-kit/import-button";
import { Money } from "@/components/ui-kit/money";
import { TransferReview } from "@/components/transactions/transfer-review";
import { getMatchesFor, getTransferCounts } from "@/lib/dal-transfers";
import { PageHeader } from "@/components/ui-kit/page-header";
import {
  getAccountNames, getAiState, getBusiness, getMoneyAccounts, getPickerOptions, getRecentCategoryIds, getSuggestionsFor,
  getSupabase, getToReviewCount, getTransactionsPage, searchArgs, todayIso,
} from "@/lib/dal";
import { formatCents } from "@/lib/money";
import {
  PAGE_SIZE, parseFilters, periodLabel, previousRange, resolveRange, toQueryString, type Filters,
} from "@/lib/transactions/filters";

export default function TransactionsPage({ params, searchParams }: PageProps<"/b/[businessId]/transactions">) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Skeleton />}>
        <Transactions params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function Skeleton() {
  return (
    <>
      <PageHeader title="Transactions" subtitle="Every dollar in and out of your accounts, sorted into your books." />
      <div className="h-24 animate-pulse rounded-2xl bg-surface-muted" />
      <div className="h-96 animate-pulse rounded-2xl bg-surface-muted" />
    </>
  );
}

async function Transactions({ params, searchParams }: PageProps<"/b/[businessId]/transactions">) {
  const { businessId } = await params;
  const filters = parseFilters(await searchParams);
  const [{ business, canWrite }, { rows, summary }, names, options, moneyAccounts, recentIds, ai, toReview] = await Promise.all([
    getBusiness(businessId), getTransactionsPage(businessId, filters), getAccountNames(businessId),
    getPickerOptions(businessId), getMoneyAccounts(businessId), getRecentCategoryIds(businessId), getAiState(businessId),
    getToReviewCount(businessId),
  ]);
  const today = todayIso();
  const range = resolveRange(filters, today, business.fiscal_year_start_month);
  const [suggestions, previous, matches, transfers] = await Promise.all([
    ai.enabled && !filters.deleted ? getSuggestionsFor(business.id, rows.map((r) => r.id)) : Promise.resolve({}),
    range.from && range.to ? previousNet(business.id, filters, range.from, range.to, today, business.fiscal_year_start_month) : Promise.resolve(null),
    getMatchesFor(business.id, rows.map((r) => r.id)),
    canWrite && !filters.deleted ? getTransferCounts(business.id) : Promise.resolve({ pairs: 0, lone: 0 }),
  ]);

  // Rows with no suggestion yet get one in the background; the banner below lets people ask now.
  if (canWrite && ai.enabled && !filters.deleted && toReview > ai.pending) after(() => maybeRunSuggestions(business.id));

  const total = Number(summary.count);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const query = toQueryString({ ...filters, page: 1 });
  const base = `/b/${business.id}/transactions`;
  const activeMoney = moneyAccounts.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name, last4: a.last4 }));
  const totalIn = Number(summary.total_in);
  const totalOut = Number(summary.total_out);
  const net = Number(summary.net);
  const waiting = Number(summary.uncategorized);
  const first = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(total, page * PAGE_SIZE);

  return (
    <>
      <PageHeader title="Transactions" subtitle="Every dollar in and out of your accounts, sorted into your books."
        actions={
          <>
            <PeriodSelect filters={filters} label={periodLabel(range.from, range.to)} />
            {canWrite && <AddTransactionButton disabled={activeMoney.length === 0} />}
            {canWrite && <ImportStatementButton businessId={business.id} />}
          </>
        } />

      <dl className="surface grid grid-cols-2 lg:grid-cols-4" data-testid="summary" aria-label="Summary of matching transactions">
        <Stat label="Transactions" testId="summary-count" value={total.toLocaleString("en-US")}
          foot={waiting > 0 ? `${waiting.toLocaleString("en-US")} waiting for review` : "Nothing waiting for review"} />
        <Stat label="Money in" testId="summary-in" value={<Money cents={totalIn} split tone="in" signPositive />}
          foot={`${Number(summary.count_in).toLocaleString("en-US")} deposit${Number(summary.count_in) === 1 ? "" : "s"}`} />
        <Stat label="Money out" testId="summary-out" value={<Money cents={totalOut} split tone="out" />}
          foot={`${Number(summary.count_out).toLocaleString("en-US")} payment${Number(summary.count_out) === 1 ? "" : "s"}`} />
        <Stat label="Net change" testId="summary-net" value={<Money cents={net} split signPositive />}
          foot={previous ? `vs. ${formatCents(previous.net, { signPositive: true })} ${previous.label}` : "All dates"} />
      </dl>

      {filters.batch && (
        <p className="rounded-xl border border-dashed px-4 py-2 text-sm text-muted-foreground" data-testid="batch-banner">
          Showing transactions from one import.{" "}
          <Link className="font-medium text-brand hover:underline" href={`/b/${business.id}/import/${filters.batch}`}>Back to the import</Link>
          {" · "}
          <Link className="font-medium text-brand hover:underline" href={`${base}${toQueryString({ ...filters, batch: null, page: 1 })}`}>Show all transactions</Link>
        </p>
      )}
      {canWrite && ai.enabled && !filters.deleted && toReview > ai.pending && (
        <SortingNotice key={toReview - ai.pending} fallback={
          <p className="flex flex-wrap items-center gap-2 rounded-xl bg-attention-soft px-4 py-2 text-sm text-attention-text" data-testid="unsuggested">
            {(toReview - ai.pending).toLocaleString("en-US")} uncategorized transaction{toReview - ai.pending === 1 ? " has" : "s have"} no suggestion yet.
            <GetSuggestionsButton businessId={business.id} />
          </p>
        } />
      )}
      {canWrite && ai.enabled && ai.autoFile && !filters.deleted && ai.confident > 0 && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft px-4 py-2 text-sm text-brand" data-testid="confident-banner">
          {ai.confident.toLocaleString("en-US")} suggestion{ai.confident === 1 ? " is" : "s are"} confident enough to file without a look.
          <FileConfidentButton businessId={business.id} />
        </p>
      )}
      {canWrite && (transfers.pairs > 0 || transfers.lone > 0) && (
        <TransferReview businessId={business.id} pairs={transfers.pairs} lone={transfers.lone} options={options} recentIds={recentIds}
          autoOpen={(await searchParams).transfers === "1"} />
      )}
      {filters.deleted && (
        <p className="rounded-xl border border-dashed px-4 py-2 text-sm text-muted-foreground" data-testid="deleted-banner">
          Showing deleted transactions. They don&apos;t count anywhere; restore one to bring it back.
        </p>
      )}

      <TransactionsTable businessId={business.id} suggestions={suggestions} matches={matches} rows={rows} total={total} matchingNet={net} names={names}
        options={options} moneyAccounts={activeMoney} recentIds={recentIds} canWrite={canWrite} query={query}
        lockDate={business.lock_date} deletedView={filters.deleted} today={today}
        header={<FilterBar key={query} filters={filters} categories={options} moneyAccounts={activeMoney} toReview={toReview}
          exportHref={`${base}/export${query}`} />}
        footer={total > 0 && (
          <nav className="flex items-center justify-between border-t px-5 py-3.5 text-sm" aria-label="Pagination">
            <span className="text-muted-foreground" data-testid="showing">Showing {first}–{last} of {total.toLocaleString("en-US")}</span>
            <span className="flex gap-2">
              <PageLink disabled={page <= 1} href={`${base}${toQueryString({ ...filters, page: page - 1 })}`}>Previous</PageLink>
              <PageLink disabled={page >= pages} href={`${base}${toQueryString({ ...filters, page: page + 1 })}`}>Next</PageLink>
            </span>
          </nav>
        )} />
    </>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: string }) {
  return disabled
    ? <Button variant="outline" size="sm" disabled>{children}</Button>
    : <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href} />}>{children}</Button>;
}

function Stat({ label, value, foot, testId }: { label: string; value: React.ReactNode; foot: string; testId: string }) {
  return (
    <div className="min-w-0 border-b border-r px-4 py-4 sm:px-5 last:border-r-0 max-lg:[&:nth-child(2n)]:border-r-0 lg:border-b-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-xl sm:text-2xl font-semibold tabular-nums tracking-[-0.01em]" data-testid={testId}>{value}</dd>
      <dd className="mt-0.5 text-xs text-muted-foreground">{foot}</dd>
    </div>
  );
}

/** Net change for the same filters over the previous period ("vs. +$3,128 in September"). */
async function previousNet(businessId: string, filters: Filters, from: string, to: string, today: string, fy: number) {
  const prev = previousRange(from, to);
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("summarize_transactions",
    searchArgs(businessId, { ...filters, preset: "custom", from: prev.from, to: prev.to }, today, fy)).single();
  if (error) return null;
  const [y, m] = prev.from.split("-").map(Number);
  const label = prev.months === 1
    ? `in ${new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}`
    : "the period before";
  return { net: Number(data.net), label };
}
