import { Suspense } from "react";
import { PageHeader } from "@/components/ui-kit/page-header";
import { ImportStatementButton } from "@/components/ui-kit/import-button";
import { getBusiness, getLastImports, getMoneyAccounts } from "@/lib/dal";
import { getMonthEnds, getStatementHistory } from "@/lib/dal-accounts";
import { accountFreshness } from "@/lib/accounts/freshness";
import { isOwedKind } from "@/lib/validation/accounts";
import { AddMoneyAccountButton, MoneyAccountCards, StatementHistory, type AccountCardData, type HistoryRow } from "./money-accounts";

export default function MoneyAccountsPage({ params }: PageProps<"/b/[businessId]/accounts">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-surface-muted" />}>
      <Accounts params={params} />
    </Suspense>
  );
}

const short = (iso: string, year = false) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  .toLocaleDateString("en-US", year ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });

async function Accounts({ params }: Pick<PageProps<"/b/[businessId]/accounts">, "params">) {
  const { businessId } = await params;
  const [{ business, canWrite }, accounts, lastImports, history] = await Promise.all([
    getBusiness(businessId), getMoneyAccounts(businessId), getLastImports(businessId), getStatementHistory(businessId),
  ]);
  const months = await getMonthEnds(business.id, accounts.map((a) => a.id));
  // Opening balances usually sit on the day the books start.
  const defaultDate = business.books_start_date ?? new Date().toISOString().slice(0, 10);
  // Active accounts first, then archived ones.
  const cards: AccountCardData[] = [...accounts].sort((a, b) => Number(a.archived) - Number(b.archived)).map((a) => ({
    ...a, owed: isOwedKind(a.kind), balance: a.balance_cents, months: months.get(a.id) ?? [],
    freshness: accountFreshness(lastImports.get(a.id)),
  }));
  const label = new Map(accounts.map((a) => [a.id, `${a.name}${a.last4 ? ` ··${a.last4}` : ""}`]));
  const rows: HistoryRow[] = history.map((h) => ({
    id: h.id, account: label.get(h.accountId) ?? "—", fileName: h.fileName, rows: h.rows, imported: short(h.importedAt),
    period: h.from && h.to ? `${short(h.from)} – ${short(h.to, true)}` : "—",
  }));
  const hasActive = accounts.some((a) => !a.archived);

  return (
    <div className="space-y-6">
      <PageHeader title="Money accounts" subtitle="The bank and card accounts you import statements from."
        actions={canWrite && <>
          <AddMoneyAccountButton businessId={business.id} defaultDate={defaultDate} />
          {hasActive && <ImportStatementButton businessId={business.id} />}
        </>} />
      <MoneyAccountCards businessId={business.id} accounts={cards} canWrite={canWrite} defaultDate={defaultDate} />
      {accounts.length > 0 && <StatementHistory businessId={business.id} rows={rows} canWrite={canWrite} />}
    </div>
  );
}
