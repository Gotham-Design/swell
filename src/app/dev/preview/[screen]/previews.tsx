import type { ReactNode } from "react";
import { AppShell, type ShellData } from "@/components/shell/app-shell";
import { FilterBar, PeriodSelect } from "@/components/transactions/filter-bar";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { AddTransactionButton } from "@/components/transactions/add-transaction";
import { ImportStatementButton } from "@/components/ui-kit/import-button";
import { Money } from "@/components/ui-kit/money";
import { PageHeader } from "@/components/ui-kit/page-header";
import { EMPTY_FILTERS } from "@/lib/transactions/filters";
import { ACCTS, CATS, NAMES, ROWS, SUGGESTIONS } from "./fixtures";
import { readFileSync } from "node:fs";
import { ImportWizard } from "@/components/import/import-wizard";
import { AskPreview, MappingStepPreview } from "./client";
import { BooksHealthCard, MoneyAccountsCard, MoneyMovementCard, OverviewCard } from "@/components/overview/cards";
import { MonthPicker } from "@/components/overview/month-picker";
import { PeriodPicker } from "@/components/overview/period-picker";
import { resolveOverviewPeriod } from "@/lib/overview/period";
import { SearchField } from "@/components/ui-kit/search-field";
import { ReportFrame, Tile, Tiles } from "@/components/reports/report-frame";
import { StatementTable } from "@/components/reports/statement-table";
import { DownloadMenu } from "@/components/reports/download-menu";
import { PNL } from "./report-fixtures";
import { ReviewFooter, ReviewSummary } from "@/components/import/verify";
import { IMPORT_STEPS, Stepper } from "@/components/ui-kit/stepper";
import { Chip } from "@/components/ui-kit/status-chip";
import { analyzeFile } from "@/lib/import/parse";
import { suggestMapping } from "@/lib/import/mapping";

import { BIZ } from "./fixtures";
import { SegmentedNav } from "@/components/ui-kit/segmented-nav";
import { TeamView } from "@/app/b/[businessId]/team/team-view";
import { AssetDialog, AssetsTable, LargePurchases, PostDepreciation } from "@/components/tax/assets";
import { AddTripButton, ImportTripsButton, TripsTable } from "@/components/tax/mileage";
import { TaxCandidates, TaxItemsTable } from "@/components/tax/health";
import type { AssetRow, TaxItemRow, TripRow } from "@/lib/dal-tax";
import { AddMoneyAccountButton, MoneyAccountCards, StatementHistory, type AccountCardData } from "@/app/b/[businessId]/accounts/money-accounts";

import { CategoryDetail, CategoryTable, NewCategoryButton } from "@/app/b/[businessId]/categories/categories-list";
import type { CategoryGroup } from "@/lib/dal-categories";

const cat = (id: string, name: string, type: string, count: number, total: number, share: number | null, extra: Partial<{ isNew: boolean; used: boolean }> = {}) =>
  ({ id, name, type, parentId: null, isSystem: false, isStandard: true, description: null, count, total, share, isNew: false, used: count > 0, ...extra });
const CAT_GROUPS: CategoryGroup[] = [
  { key: "income", label: "Income", rows: [cat("c1", "Sales", "income", 22, 846036, 81.4), cat("c2", "Service Revenue", "income", 3, 193822, 18.6), cat("c3", "Interest Income", "income", 1, 500, 0)] },
  { key: "expense", label: "Expenses", rows: [cat("c4", "Payroll", "expense", 2, 360000, 52), cat("c5", "Ingredients", "expense", 9, 184579, 27), cat("c6", "Insurance", "expense", 1, 62000, 9),
    cat("c7", "Utilities", "expense", 3, 41213, 6), cat("c8", "Contractors", "expense", 1, 18000, 3, { isNew: true }), cat("c9", "Software", "expense", 2, 9800, 1.4),
    cat("c10", "Bank Fees", "expense", 4, 9400, 1.4), cat("c11", "Office Supplies", "expense", 1, 3040, 0.4), cat("c12", "Meals", "expense", 1, 692, 0.1),
    cat("c13", "Advertising", "expense", 0, 0, 0), cat("c14", "Rent", "expense", 0, 0, 0)] },
  { key: "transfer", label: "Transfers", rows: [cat("c15", "Business Visa", "liability", 1, 250000, null)] },
];

import { SettingsView } from "@/app/b/[businessId]/settings/settings-view";

import { CreateBusinessForm } from "@/app/new/create-business-form";
import { Logo } from "@/components/brand/logo";

import { RulesView } from "@/components/rules/rules-view";

const MONTHS = ["2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-22"];
const series = (vals: number[]) => vals.map((v, i) => ({ month: MONTHS[i], cents: v * 100 }));
const ACCOUNT_CARDS: AccountCardData[] = [
  { id: "a1", name: "Bakery Checking", kind: "checking", last4: "4821", owed: false, archived: false, balance: 7082809, opening_balance_cents: 0, opening_date: null,
    months: series([52000, 56000, 55000, 54000, 58000, 70828]), freshness: { label: "Imported Oct 21 · through Oct 20", stale: false } },
  { id: "a2", name: "Business Visa", kind: "credit_card", last4: "1007", owed: true, archived: false, balance: 1114732, opening_balance_cents: 0, opening_date: null,
    months: series([7900, 8600, 7000, 9100, 11500, 11147]), freshness: { label: "Imported Oct 18 · through Oct 17", stale: false } },
  { id: "a3", name: "Reserve Savings", kind: "savings", last4: "3458", owed: false, archived: false, balance: 502000, opening_balance_cents: 0, opening_date: null,
    months: series([5000, 5005, 5008, 5012, 5016, 5020]), freshness: { label: "Last import Sep 30 · 3 weeks behind", stale: true } },
];
const HISTORY = [
  { id: "h1", account: "Bakery Checking ··4821", period: "Oct 1 – Oct 20", fileName: "chase_oct_2026.csv", rows: 96, imported: "Oct 21" },
  { id: "h2", account: "Business Visa ··1007", period: "Sep 18 – Oct 17", fileName: "amex_activity.csv", rows: 41, imported: "Oct 18" },
  { id: "h3", account: "Bakery Checking ··4821", period: "Sep 1 – Sep 30", fileName: "chase_sep_2026.csv", rows: 112, imported: "Oct 2" },
  { id: "h4", account: "Reserve Savings ··3458", period: "Sep 1 – Sep 30", fileName: "ally_statement_09.csv", rows: 3, imported: "Oct 1" },
];
export const shell: ShellData = {
  business: { id: BIZ, name: "Demo Bakery" },
  businesses: [{ id: BIZ, name: "Demo Bakery", role: "owner" }],
  user: { id: "preview-user", email: "demo@swell.test" },
  toReview: 15,
  accounts: [
    { id: "a1", label: "Checking ··4821", balance: "$70,828", spoken: "70,828 dollars" },
    { id: "a2", label: "Card ··1007", balance: "$11,147", spoken: "11,147 dollars" },
    { id: "a3", label: "Savings ··3458", balance: "$5,020", spoken: "5,020 dollars" },
  ],
};

const accounts = Object.values(ACCTS);

function TxPreview() {
  return (
    <AppShell data={shell}>
      <div className="space-y-6">
        <PageHeader title="Transactions" subtitle="Every dollar in and out of your accounts, sorted into your books."
          actions={<><PeriodSelect filters={EMPTY_FILTERS} label="October 2026" /><AddTransactionButton /><ImportStatementButton businessId={BIZ} /></>} />
        <dl className="surface grid grid-cols-2 lg:grid-cols-4">
          {[
            ["Transactions", <>58</>, "7 waiting for review"],
            ["Money in", <Money key="i" cents={1040358} split tone="in" signPositive />, "14 deposits"],
            ["Money out", <Money key="o" cents={-688724} split tone="out" />, "44 payments"],
            ["Net change", <Money key="n" cents={351634} split signPositive />, "vs. +$3,128.00 in September"],
          ].map(([label, value, foot]) => (
            <div key={String(label)} className="min-w-0 border-b border-r px-5 py-4 last:border-r-0 max-lg:[&:nth-child(2n)]:border-r-0 lg:border-b-0">
              <dt className="text-[13px] text-muted-foreground">{label}</dt>
              <dd className="mt-1 truncate text-2xl font-semibold tabular-nums tracking-[-0.01em]">{value}</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">{foot}</dd>
            </div>
          ))}
        </dl>
        <TransactionsTable businessId={BIZ} rows={ROWS} total={58} matchingNet={351634} names={NAMES} options={CATS}
          moneyAccounts={accounts} recentIds={[]} canWrite query="" lockDate={null} deletedView={false} today="2026-10-22"
          suggestions={SUGGESTIONS}
          header={<FilterBar filters={EMPTY_FILTERS} categories={CATS} moneyAccounts={accounts} toReview={7} exportHref="#" />}
          footer={<nav className="flex items-center justify-between border-t px-5 py-3.5 text-sm"><span className="text-muted-foreground">Showing 1–12 of 58</span></nav>} />
      </div>
    </AppShell>
  );
}

const tiles = [
  { ...ACCTS.chk, kind: "checking", freshness: "Imported Oct 21", stale: false },
  { ...ACCTS.visa, kind: "credit_card", freshness: "Imported Oct 18", stale: false },
  { ...ACCTS.sav, kind: "savings", freshness: "Last import Sep 30", stale: true },
];
const recent = (
  <section className="surface p-5">
    <h2 className="mb-3 text-[15px] font-semibold">Recent imports</h2>
    <ul className="divide-y text-sm">
      {[["chase_checking_oct.csv", "Bakery Checking · 42 rows · Oct 21", true], ["visa_statement_0918.csv", "Business Visa · 3 rows · Oct 2", false]].map(([f, d, ok]) => (
        <li key={String(f)} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <span><span className="block font-medium">{f}</span><span className="block text-xs text-muted-foreground">{d}</span></span>
          {ok ? <Chip tone="categorized">Imported</Chip> : <Chip tone="neutral">Undone</Chip>}
        </li>
      ))}
    </ul>
  </section>
);

function MappingPreview() {
  const parsed = analyzeFile(new Uint8Array(readFileSync("src/lib/import/__fixtures__/chase-checking.csv")));
  const s = suggestMapping(parsed.headers, parsed.rows, "checking");
  return (
    <AppShell data={shell}>
      <MappingStepPreview account={tiles[0]} parsed={parsed} mapping={s.mapping} guessed={[...s.guessed]} />
    </AppShell>
  );
}

function ReviewPreview() {
  return (
    <AppShell data={shell}>
      <div className="space-y-6">
        <PageHeader title="Review before importing" subtitle="Reserve Savings · savings_oct.csv · 12 rows · every row checked"
          actions={<Stepper steps={IMPORT_STEPS} current={3} />} />
        <ReviewSummary rows={12} willImport={10} duplicates={1} skipped={1} totalIn={330918} totalOut={-120000}
          balance={{ checked: true, ok: true }} ending={502000} />
        <ReviewFooter businessId={BIZ} batchId={BIZ} count={10} mapping={null} canWrite />
      </div>
    </AppShell>
  );
}

function OverviewPreview() {
  const months = ["2026-10", "2026-09", "2026-08"];
  const monthly = [["2026-04", 820000, 610000], ["2026-05", 900000, 640000], ["2026-06", 960000, 520000], ["2026-07", 940000, 610000],
    ["2026-08", 880000, 560000], ["2026-09", 990000, 640000], ["2026-10", 1040358, 688724]].map(([m, i, e]) => ({ month: `${m}-01`, income: Number(i), expense: Number(e) }));
  return (
    <AppShell data={shell}>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-2">
          <div className="min-w-0"><p className="mb-1 text-[13px] text-muted-foreground">Client</p><h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Demo Bakery</h1><p className="mt-1 text-[13px] text-muted-foreground">Food &amp; beverage · Cash basis · Books closed through Sep 30, 2026</p></div>
          <div className="flex flex-wrap items-center gap-2"><SearchField action="#" className="w-72" /><AddTransactionButton /><ImportStatementButton businessId={BIZ} /></div>
        </header>
        <div className="grid gap-4 lg:grid-cols-[1fr_368px]">
          <OverviewCard client={{ name: "Demo Bakery", meta: "Food and beverage · Cash basis" }} businessId="preview" canWrite monthName="October" prevName="September" net={351634} income={1040358} expenses={688724} margin={0.338} change={0.124}
            costs={[{ id: "1", name: "Payroll", cents: 360000 }, { id: "2", name: "Ingredients", cents: 184579 }, { id: "3", name: "Insurance", cents: 62000 }]}
            monthly={monthly} picker={<PeriodPicker period={resolveOverviewPeriod({ period: "last_30", cmp: "yoy" }, "2026-10-23")} />} />
          <MoneyAccountsCard businessId={BIZ} cash={7584809} accounts={[
            { id: "a", name: "Bakery Checking", last4: "4821", owed: false, balance: 7082809, freshness: "Imported Oct 21", stale: false, card: false },
            { id: "b", name: "Business Visa", last4: "1007", owed: true, balance: 1114696, freshness: "Imported Oct 18", stale: false, card: true },
            { id: "c", name: "Reserve Savings", last4: "3458", owed: false, balance: 502000, freshness: "Last import Sep 30", stale: true, card: false },
          ]} />
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_368px]">
          <MoneyMovementCard canWrite picker={<MonthPicker value="2026-10" months={months} />} movement={[
            { dir: "in", total: 1040358, groups: [{ label: "square deposits", cents: 842690, rank: 1, isVendor: true }, { label: "client payments", cents: 166118, rank: 2, isVendor: true }, { label: "Everything else", cents: 31550, rank: 3, isVendor: false }] },
            { dir: "out", total: 688724, groups: [{ label: "gusto payroll", cents: 360000, rank: 1, isVendor: true }, { label: "oakwood rent", cents: 320000, rank: 2, isVendor: true }, { label: "Everything else", cents: 8724, rank: 3, isVendor: false }] },
          ]} notes={[
            { kind: "category_change", headline: "Ingredients is up 15% from September", detail: "$1,845.79 this month vs. $1,610.44 last month", href: "#" },
            { kind: "to_review", headline: "7 transactions to review", detail: "$3,201.12 waiting for a category", href: "#" },
          ]} />
          <BooksHealthCard businessId={BIZ} books={{ count: 58, categorized: 53, uncategorized: 5 }} coming={[
            { id: "1", vendor: "owner draw", date: "2026-10-25", cents: 150000, days: 3 },
            { id: "2", vendor: "oakwood property mgmt", date: "2026-11-01", cents: 320000, days: 10 },
            { id: "3", vendor: "adobe creative cloud", date: "2026-11-04", cents: 5499, days: 13 },
          ]} />
        </div>
        <TransactionsTable businessId={BIZ} rows={ROWS.slice(0, 7)} total={7} matchingNet={0} names={NAMES} options={CATS}
          moneyAccounts={accounts} recentIds={[]} canWrite query="" lockDate={null} deletedView={false} today="2026-10-22"
          suggestions={SUGGESTIONS} selectable={false}
          header={<div className="flex items-center justify-between px-5 py-4"><h2 className="text-[15px] font-semibold">Recent transactions</h2></div>} />
      </div>
    </AppShell>
  );
}

export const PREVIEWS: Record<string, () => ReactNode> = {
  pnl: () => (
    <AppShell data={shell}>
      <ReportFrame businessId={BIZ} active="pnl" controls={<DownloadMenu businessId={BIZ} report="pnl" query="" />} meta="Cash basis · Compared with September 2026">
        <Tiles cols={4}>
          <Tile label="Income" value={<Money cents={1040358} split tone="in" />} foot="+8.9% vs. September" />
          <Tile label="Expenses" value={<Money cents={688724} split tone="out" />} foot="+7.1% vs. September" />
          <Tile label="Net income" value={<Money cents={351634} split />} foot="+12.4% vs. September" />
          <Tile label="Profit margin" value="33.8%" foot="Up from 32.7%" />
        </Tiles>
        <StatementTable statement={PNL} businessId={BIZ} testId="pnl" columns={{ main: "Oct 2026", cmp: "Sep 2026" }}
          footer={<div className="flex items-center gap-3 border-t px-5 py-4 text-[13px]"><Chip tone="review">7 transactions still need review</Chip><span className="flex-1 text-muted-foreground">Totals may shift slightly once they&apos;re categorized.</span><span className="font-medium">Review now</span></div>} />
      </ReportFrame>
    </AppShell>
  ),
  overview: () => <OverviewPreview />,
  "import-upload": () => (
    <AppShell data={shell}>
      <ImportWizard businessId={BIZ} accounts={tiles} initialAccountId={ACCTS.sav.id} aside={recent} />
    </AppShell>
  ),
  "import-match": () => <MappingPreview />,
  "import-review": () => <ReviewPreview />,
  transactions: () => <TxPreview />,
  categories: () => (
    <AppShell data={shell}>
      <div className="space-y-6">
        <PageHeader title="Categories" subtitle="The buckets every transaction lands in. These become the lines on your reports."
          actions={<NewCategoryButton businessId={BIZ} options={[]} />} />
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_384px]">
          <CategoryTable groups={CAT_GROUPS} selectedId="c5" hrefFor={Object.fromEntries(CAT_GROUPS.flatMap((g) => g.rows).map((r) => [r.id, "#"]))}
            monthName="October" usedCount={13} />
          <CategoryDetail businessId={BIZ} options={[]} canWrite
            data={{ row: CAT_GROUPS[1].rows[1], parentName: "Cost of goods sold", monthName: "October", transactionsHref: "#",
              months: series([1520, 1690, 1710, 1800, 1650, 1845.79].map((v) => Math.round(v))), average: 170236,
              vendors: [{ name: "Restaurant Depot", cents: 106579, count: 4 }, { name: "Sysco", cents: 61200, count: 3 }, { name: "Costco Business", cents: 16800, count: 2 }] }} />
        </div>
      </div>
    </AppShell>
  ),
  settings: () => (
    <AppShell data={shell}>
      <SettingsView canManage today="2026-10-22" exportHref="#"
        aiNote="Suggests a category for each new transaction from its description, amount and date, and learns from how you file. Account numbers, balances and statement files are never used."
        data={{ id: BIZ, name: "Demo Bakery", legalName: "Demo Bakery LLC", industry: "food_beverage", fiscalStart: 1, lockDate: "2026-09-30", aiEnabled: true, autoFile: true, archived: false }} />
    </AppShell>
  ),
  "new-business": () => (
    <main className="min-h-dvh px-10 pb-16">
      <header className="flex items-center justify-between py-7"><Logo /><span className="text-sm font-medium">Back to your businesses</span></header>
      <div className="pt-4"><CreateBusinessForm /></div>
    </main>
  ),
  rules: () => (
    <AppShell data={shell}>
      <RulesView businessId={BIZ} rules={[]} canWrite options={[]} names={{}} moneyAccounts={[]} editId={null} />
    </AppShell>
  ),
  accounts: () => (
    <AppShell data={shell}>
      <div className="space-y-6">
        <PageHeader title="Money accounts" subtitle="The bank and card accounts you import statements from."
          actions={<><AddMoneyAccountButton businessId={BIZ} defaultDate="2026-01-01" /><ImportStatementButton businessId={BIZ} /></>} />
        <MoneyAccountCards businessId={BIZ} accounts={ACCOUNT_CARDS} canWrite defaultDate="2026-01-01" />
        <StatementHistory businessId={BIZ} rows={HISTORY} canWrite />
      </div>
    </AppShell>
  ),
  ask: () => <AskPreview />,
  team: () => (
    <AppShell data={shell}>
      <TeamView businessId={BIZ} isAdmin firmName="Ledger & Co." clients={[{ id: "c1", name: "Groovy Duck Bakery" }, { id: "c2", name: "Harper Builders" }, { id: "c3", name: "Mainland Creative" }]}
        members={[
          { user_id: "u1", email: "barton@ledgerco.com", role: "admin", all_clients: true, client_role: "editor", business_ids: [], you: true },
          { user_id: "u2", email: "jess@ledgerco.com", role: "staff", all_clients: true, client_role: "editor", business_ids: [], you: false },
          { user_id: "u3", email: "sam.lee@ledgerco.com", role: "staff", all_clients: false, client_role: "viewer", business_ids: ["c1", "c2"], you: false },
        ]}
        invites={[{ id: "i1", email: "intern@ledgerco.com", role: "staff", all_clients: false, client_role: "editor", business_ids: ["c3"] }]} />
    </AppShell>
  ),
  "tax-assets": () => (
    <AppShell data={shell}>
      <div className="space-y-6">
        <PageHeader title="Tax" subtitle="Assets and depreciation, mileage, health and retirement, and the paperwork behind them." />
        <TaxTabs active="assets" />
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Book depreciation. Tax depreciation (MACRS) stays in the tax software.</p>
            <AssetDialog businessId={BIZ} triggerLabel="Add asset" />
          </div>
          <TaxStats items={[["Cost of assets in use", 4650000, "3 assets"], ["Depreciation posted", 512500, ""], ["Book value", 4137500, ""]]} />
          <PostDepreciation businessId={BIZ} monthEnds={["2026-10-31", "2026-09-30", "2026-08-31"]} defaultThrough="2026-10-31" lastPosted="2026-09-30" canWrite hasAssets />
          <LargePurchases businessId={BIZ} names={{ c1: "Repairs & Maintenance" }} rows={[
            { id: "11111111-1111-4111-8111-111111111111", date: "2026-10-04", description: "Hobart Mixer Supply", amount: 689000, categoryId: "c1" },
            { id: "22222222-2222-4222-8222-222222222222", date: "2026-08-19", description: "Apple Store", amount: 349900, categoryId: null },
          ]} />
          <AssetsTable businessId={BIZ} canWrite rows={TAX_ASSETS} />
        </div>
      </div>
    </AppShell>
  ),
  "tax-mileage": () => (
    <AppShell data={shell}>
      <div className="space-y-6">
        <PageHeader title="Tax" subtitle="Assets and depreciation, mileage, health and retirement, and the paperwork behind them." />
        <TaxTabs active="mileage" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">IRS business rate for 2026: 72.5¢, 76¢ from Jul 1 a mile.</p>
          <span className="flex flex-wrap gap-2"><ImportTripsButton businessId={BIZ} /><AddTripButton businessId={BIZ} today="2026-11-16" lastVehicle="F-150" /></span>
        </div>
        <TaxStats items={[["Business miles in 2026", "1,204.6", ""], ["Standard mileage deduction", 89231, "Miles × the IRS rate on each trip's date"], ["Trips", "38", ""]]} />
        <TripsTable businessId={BIZ} canWrite rows={TAX_TRIPS} />
      </div>
    </AppShell>
  ),
  "tax-health": () => (
    <AppShell data={shell}>
      <div className="space-y-6">
        <PageHeader title="Tax" subtitle="Assets and depreciation, mileage, health and retirement, and the paperwork behind them." />
        <TaxTabs active="health" />
        <TaxStats items={[["Health in 2026", 780000, "Owner $7,800.00"], ["Retirement in 2026", 1500000, "Owner $15,000.00"], ["Waiting to look at", "2", "Found in the transactions"]]} />
        <TaxCandidates businessId={BIZ} people={["Owner"]} rows={[
          { kind: "health", id: "33333333-3333-4333-8333-333333333333", date: "2026-11-01", description: "Blue Cross NC", amount: 65000 },
          { kind: "retirement", id: "44444444-4444-4444-8444-444444444444", date: "2026-10-15", description: "Vanguard SEP IRA", amount: 500000 },
        ]} />
        <div className="grid gap-4 xl:grid-cols-2">
          <TaxItemsTable businessId={BIZ} kind="health" canWrite people={["Owner"]} rows={TAX_ITEMS.filter((i) => i.kind === "health")} />
          <TaxItemsTable businessId={BIZ} kind="retirement" canWrite people={["Owner"]} rows={TAX_ITEMS.filter((i) => i.kind === "retirement")} />
        </div>
      </div>
    </AppShell>
  ),
  shell: () => (
    <AppShell data={shell}>
      <p className="text-sm text-muted-foreground">Content area</p>
    </AppShell>
  ),
};

function TaxTabs({ active }: { active: string }) {
  return (
    <div className="-mx-4 max-w-[calc(100%+2rem)] overflow-x-auto px-4 md:mx-0 md:max-w-full md:px-0 [&_a]:whitespace-nowrap"><SegmentedNav label="Tax sections" items={[["assets", "Assets"], ["mileage", "Mileage"], ["health", "Health & retirement"], ["documents", "Documents"]]
      .map(([k, l]) => ({ href: `/dev/preview/tax-${k}`, label: l, active: k === active }))} /></div>
  );
}
function TaxStats({ items }: { items: [string, number | string, string][] }) {
  return (
    <dl className="surface grid gap-4 p-5 sm:grid-cols-3">
      {items.map(([label, v, foot]) => (
        <div key={label}>
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="text-2xl font-semibold tracking-tight tabular-nums">{typeof v === "number" ? <Money cents={v} /> : v}</dd>
          {foot && <dd className="text-xs text-muted-foreground">{foot}</dd>}
        </div>
      ))}
    </dl>
  );
}
const TAX_ASSETS: AssetRow[] = [
  { id: "a1", name: "2024 Ford Transit Van", kind: "vehicle", acquiredOn: "2026-03-15", inServiceOn: "2026-03-15", cost: 3800000, salvage: 0, method: "straight_line",
    lifeMonths: 60, disposedOn: null, notes: "VIN 1FTBR1C82PKA00000", account: "Vehicles", purchaseId: null, posted: 443333, scheduled: 506667, bookValue: 3356667, monthly: 63333, lastThrough: "2026-09-30" },
  { id: "a2", name: "Deck oven", kind: "equipment", acquiredOn: "2026-06-02", inServiceOn: "2026-06-10", cost: 550000, salvage: 50000, method: "straight_line",
    lifeMonths: 84, disposedOn: null, notes: null, account: "Equipment", purchaseId: null, posted: 23810, scheduled: 29762, bookValue: 526190, monthly: 5952, lastThrough: "2026-09-30" },
  { id: "a3", name: "MacBook Pro", kind: "computer", acquiredOn: "2026-01-20", inServiceOn: "2026-01-20", cost: 300000, salvage: 0, method: "expense_now",
    lifeMonths: null, disposedOn: null, notes: null, account: "Equipment", purchaseId: null, posted: 300000, scheduled: 300000, bookValue: 0, monthly: 0, lastThrough: "2026-01-31" },
];
const TAX_TRIPS: TripRow[] = [
  { id: "t1", date: "2026-11-12", miles: 286, purpose: "Delivery to Harper wedding", from: "Bakery", to: "Raleigh", vehicle: "Transit", rate: 760, deduction: 2174 },
  { id: "t2", date: "2026-11-05", miles: 124, purpose: "Restaurant Depot", from: null, to: null, vehicle: "Transit", rate: 760, deduction: 942 },
  { id: "t3", date: "2026-06-30", miles: 1000, purpose: "Supplier visit", from: "Bakery", to: "Greensboro", vehicle: null, rate: 725, deduction: 7250 },
];
const TAX_ITEMS: TaxItemRow[] = [
  { id: "h1", kind: "health", type: "Health insurance premium", person: "Owner", date: "2026-10-01", amount: 65000, description: "Blue Cross NC", transactionId: "x", note: null },
  { id: "h2", kind: "health", type: "HSA contribution", person: "Owner", date: "2026-04-15", amount: 130000, description: "HealthEquity HSA", transactionId: null, note: "Paid from personal checking" },
  { id: "r1", kind: "retirement", type: "SEP-IRA", person: "Owner", date: "2026-04-15", amount: 1500000, description: "Vanguard SEP IRA", transactionId: "y", note: null },
];
