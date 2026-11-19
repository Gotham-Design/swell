import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CategoryMatcher, CommittedSummary, ImportRows, ReviewFooter, ReviewSummary } from "@/components/import/verify";
import { ImportOutcomeDialog } from "@/components/import/outcome";
import { PageHeader } from "@/components/ui-kit/page-header";
import { IMPORT_STEPS, Stepper } from "@/components/ui-kit/stepper";
import { getAccountNames, getPickerOptions } from "@/lib/dal";
import {
  IMPORT_TABS, IMPORT_TAB_LABEL, ROWS_PER_PAGE, getEndingBalance, getImportBatch, getImportRows, getMatchedTransactions,
  getUnmatchedCategories, type ImportTab,
} from "@/lib/dal-import";
import { cn } from "@/lib/utils";

export default function VerifyImportPage({ params, searchParams }: PageProps<"/b/[businessId]/import/[batchId]">) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-surface-muted" />}>
        <Verify params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// Tabs shown on the review screen; "duplicates" (exact) and "near" both read as possible duplicates.
const REVIEW_TABS: ImportTab[] = ["all", "import", "near", "duplicates", "problems", "skipped"];

async function Verify({ params, searchParams }: PageProps<"/b/[businessId]/import/[batchId]">) {
  const { businessId, batchId } = await params;
  const sp = await searchParams;
  const tab = (IMPORT_TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as ImportTab) : "all";
  const page = Math.max(1, Number.parseInt(String(sp.page ?? "1"), 10) || 1);
  const { batch, canWrite, business } = await getImportBatch(businessId, batchId);
  const base = `/b/${business.id}/import/${batch.id}`;
  const subtitle = `${batch.account_name} · ${batch.file_name ?? "import"} · ${batch.row_count?.toLocaleString("en-US") ?? 0} rows`;

  if (batch.status === "committed" || batch.status === "undone") {
    return (
      <>
        <PageHeader title={batch.status === "committed" ? "Imported" : "Import undone"} subtitle={subtitle} />
        <CommittedSummary businessId={business.id} batchId={batch.id} status={batch.status} count={batch.committed_count ?? 0}
          accountName={batch.account_name} totalIn={Number(batch.total_in_cents ?? 0)} totalOut={Number(batch.total_out_cents ?? 0)}
          fileName={batch.file_name ?? "the file"} canWrite={canWrite} />
        <ImportOutcomeDialog businessId={business.id} batchId={batch.id} />
      </>
    );
  }

  const [{ rows, tabCounts }, unmatched, options, names, ending] = await Promise.all([
    getImportRows(batch.id, tab, page), getUnmatchedCategories(batch.id), getPickerOptions(business.id), getAccountNames(business.id),
    getEndingBalance(batch.id),
  ]);
  const matched = await getMatchedTransactions(
    rows.flatMap((r) => [r.duplicate_of_transaction, r.near_duplicate_of]).filter((x): x is string => !!x));
  const pages = Math.max(1, Math.ceil(tabCounts[tab] / ROWS_PER_PAGE));
  const href = (t: ImportTab, p = 1) => `${base}?tab=${t}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <>
      <PageHeader title="Review before importing" subtitle={`${subtitle} · every row checked`}
        actions={<Stepper steps={IMPORT_STEPS} current={3} />} />

      <ReviewSummary rows={tabCounts.all} willImport={tabCounts.import} duplicates={tabCounts.near + tabCounts.duplicates}
        skipped={tabCounts.skipped} totalIn={Number(batch.total_in_cents ?? 0)} totalOut={Number(batch.total_out_cents ?? 0)}
        balance={batch.balance_check} ending={ending} />

      {unmatched.length > 0 && (
        <CategoryMatcher businessId={business.id} batchId={batch.id} unmatched={unmatched} options={options} canWrite={canWrite} />
      )}

      <section className="surface overflow-hidden">
        <nav className="flex flex-wrap items-center gap-1 px-5 py-4" aria-label="Filter rows">
          <span className="inline-flex flex-wrap items-center rounded-full bg-surface-muted p-1">
            {REVIEW_TABS.filter((t) => t === "all" || tabCounts[t] > 0 || t === tab).map((t) => (
              <Link key={t} href={href(t)} aria-current={t === tab ? "page" : undefined} data-testid={`tab-${t}`}
                className={cn("inline-flex h-8 items-center rounded-full px-3.5 text-sm transition-colors",
                  t === tab ? "bg-card font-medium shadow-[0_1px_2px_rgb(15_31_23/0.08)]" : "text-muted-foreground hover:text-foreground")}>
                {IMPORT_TAB_LABEL[t]} <span className="ml-1 tabular-nums opacity-75">{tabCounts[t].toLocaleString("en-US")}</span>
              </Link>
            ))}
          </span>
        </nav>
        <ImportRows businessId={business.id} batchId={batch.id} rows={rows} mapping={batch.mapping} names={names} matched={matched} canWrite={canWrite}
          footer={pages > 1 && (
            <nav className="flex items-center justify-between border-t px-5 py-3.5 text-sm" aria-label="Pages">
              <span className="text-muted-foreground">Page {page} of {pages}</span>
              <span className="flex gap-2">
                {page > 1 ? <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href(tab, page - 1)} />}>Previous</Button>
                  : <Button variant="outline" size="sm" disabled>Previous</Button>}
                {page < pages ? <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href(tab, page + 1)} />}>Next</Button>
                  : <Button variant="outline" size="sm" disabled>Next</Button>}
              </span>
            </nav>
          )} />
      </section>

      <ReviewFooter businessId={business.id} batchId={batch.id} count={tabCounts.import} mapping={batch.mapping} canWrite={canWrite} />
      <ImportOutcomeDialog businessId={business.id} batchId={batch.id} />
    </>
  );
}
