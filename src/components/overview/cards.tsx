import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarClock, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddTransactionButton } from "@/components/transactions/add-transaction";
import { RailMoneyAccountsIcon } from "@/components/shell/rail-icons";
import { Money } from "@/components/ui-kit/money";
import { Chip } from "@/components/ui-kit/status-chip";
import { cn } from "@/lib/utils";
import { IncomeChart, type MonthPoint } from "./income-chart";
import { NotesStrip, type OverviewNote } from "./notes-strip";

export function CardShell({ title, heading, actions, children, className, testId }: {
  title: string; heading?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; testId?: string;
}) {
  return (
    <section className={cn("surface flex min-w-0 flex-col p-5", className)} data-testid={testId} aria-label={title}>
      <div className="mb-4 flex items-center justify-between gap-3">
        {heading ?? <h2 className="text-[15px] font-semibold">{title}</h2>}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

const pctText = (r: number) => `${(Math.round(r * 1000) / 10).toFixed(1)}%`;

export function OverviewCard({ client, businessId, canWrite, monthName, prevName, net, income, expenses, margin, change, costs, monthly, picker }: {
  /** The client this dashboard is for, named at the top of the first card. */
  client: { name: string; meta: string };
  businessId: string; canWrite: boolean;
  monthName: string; prevName: string | null; net: number; income: number; expenses: number; margin: number | null; change: number | null;
  costs: { id: string; name: string; cents: number }[]; monthly: MonthPoint[]; picker: ReactNode;
}) {
  // A month with nothing in it yet: say why, and point at the statement or the last busy month.
  const quiet = income === 0 && expenses === 0;
  const lastBusy = [...monthly].slice(0, -1).reverse().find((m) => m.income !== 0 || m.expense !== 0);
  const busyKey = lastBusy?.month.slice(0, 7);
  const busyName = lastBusy && new Date(`${lastBusy.month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return (
    <CardShell title={`${client.name} overview`} actions={picker} testId="overview-card"
      heading={
        <div className="min-w-0" data-testid="client-header">
          <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em]">{client.name}</h1>
          {client.meta && <p className="truncate text-xs text-muted-foreground">{client.meta}</p>}
        </div>
      }>
      <div className="grid min-w-0 gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">Net income · {monthName.replace(/^the /, "")}</p>
          <Money cents={net} split className="mt-1 block text-[34px] font-semibold tracking-[-0.02em]" testId="month-net" />
          <p className="mt-1 flex flex-wrap gap-x-3 text-[13px] font-medium">
            <span className="text-money-in-text" data-testid="month-income">↑ <Money cents={income} /> in</span>
            <span className="text-money-out-text" data-testid="month-expenses">↓ <Money cents={expenses} /> out</span>
          </p>
          {/* With no comparison chosen, the margin stands alone. */}
          <div className={cn("mt-3 grid gap-2", prevName && "grid-cols-2")}>
            <div className="rounded-xl bg-surface-muted px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Profit margin</p>
              <p className="text-sm font-semibold tabular-nums">{margin === null ? "—" : pctText(margin)}</p>
            </div>
            {prevName && (
              <div className="rounded-xl bg-surface-muted px-3 py-2">
                <p className="truncate text-[11px] text-muted-foreground" title={prevName}>vs. {prevName}</p>
                <p className={cn("text-sm font-semibold tabular-nums", change !== null && (change >= 0 ? "text-money-in-text" : "text-money-out-text"))}>
                  {change === null ? "—" : `${change >= 0 ? "+" : ""}${pctText(change)}`}
                </p>
              </div>
            )}
          </div>
          <div className="mt-4 border-t pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Biggest costs</p>
            {costs.length === 0 ? <p className="text-[13px] text-muted-foreground">No expenses yet.</p> : (
              <ul className="space-y-1.5 text-[13px]" data-testid="biggest-costs">
                {costs.map((c) => (
                  <li key={c.id} className="flex justify-between gap-3"><span className="truncate">{c.name}</span><Money cents={c.cents} /></li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <IncomeChart data={monthly} label={`Income and expenses for the last ${monthly.length} months`} />
      </div>
      {quiet && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-brand-soft px-4 py-3 text-sm" data-testid="quiet-month">
          <p className="min-w-0 flex-1">
            <span className="font-medium">Nothing in {monthName} yet</span>
            <span className="text-muted-foreground"> · {canWrite ? "import statements to fill it in" : "it fills in once statements are imported"}</span>
          </p>
          {busyKey && (
            <Link href={`/b/${businessId}?month=${busyKey}`} className="font-medium text-brand hover:underline">See {busyName}</Link>
          )}
          {canWrite && <Link href={`/b/${businessId}/import`} className="font-medium text-brand hover:underline">Import statement</Link>}
        </div>
      )}
    </CardShell>
  );
}

export function MoneyAccountsCard({ businessId, cash, accounts, add }: {
  businessId: string;
  cash: number;
  accounts: { id: string; name: string; last4: string | null; owed: boolean; balance: number; freshness: string; stale: boolean; card: boolean }[];
  /** "Add account", shown while the business has only one. */
  add?: ReactNode;
}) {
  return (
    <CardShell title="Money accounts" testId="money-accounts-card"
      actions={<Button variant="ghost" size="icon-sm" nativeButton={false} aria-label="Open money accounts" render={<Link href={`/b/${businessId}/accounts`} />}><MoreHorizontal aria-hidden /></Button>}>
      <p className="text-[13px] text-muted-foreground">Cash on hand · as of last import</p>
      <Money cents={cash} split className="mt-0.5 block text-2xl font-semibold" testId="cash-on-hand" />
      <ul className="mt-3 divide-y border-t" data-testid="money-accounts">
        {accounts.length === 0 && <li className="py-4 text-sm text-muted-foreground">No money accounts yet.</li>}
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-3.5">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", a.card ? "bg-money-out-soft text-money-out" : "bg-money-in-soft text-money-in-text")}>
              <RailMoneyAccountsIcon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{a.name}</span>
              <span className={cn("block truncate text-xs", a.stale ? "text-attention-text" : "text-muted-foreground")}>
                {a.last4 ? `··${a.last4} · ` : ""}{a.freshness}
              </span>
            </span>
            <span className="text-right">
              <Money cents={a.balance} className="block text-sm font-semibold" />
              <span className="block text-[11px] text-muted-foreground">{a.owed ? "owed" : "balance"}</span>
            </span>
          </li>
        ))}
      </ul>
      {add && (
        <div className="mt-auto pt-4" data-testid="add-account-hint">
          <div className="flex flex-col items-start gap-3 rounded-xl bg-surface-muted p-4">
            <p className="text-[13px] text-muted-foreground">
              Have a business card, savings or a second checking account? Add it so cash on hand covers everything.
            </p>
            {add}
          </div>
        </div>
      )}
    </CardShell>
  );
}

type Movement = { dir: "in" | "out"; total: number; groups: { label: string; cents: number; rank: number; isVendor: boolean }[] };

export function MoneyMovementCard({ movement, notes, picker, canWrite }: { movement: Movement[]; notes: OverviewNote[]; picker: ReactNode; canWrite: boolean }) {
  return (
    <CardShell title="Money movement" actions={picker} testId="money-movement">
      <div className="grid gap-3 md:grid-cols-2">
        {movement.map((m) => <MovementPanel key={m.dir} m={m} canWrite={canWrite} />)}
      </div>
      {notes.length > 0 && <div className="mt-4"><NotesStrip notes={notes} /></div>}
    </CardShell>
  );
}

function MovementPanel({ m, canWrite }: { m: Movement; canWrite: boolean }) {
  const inflow = m.dir === "in";
  const colors = inflow ? ["bg-money-in", "bg-money-in/45", "bg-border"] : ["bg-money-out", "bg-money-out/45", "bg-border"];
  const share = (c: number) => (m.total > 0 ? c / m.total : 0);
  return (
    <div className="rounded-2xl border p-4" data-testid={`movement-${m.dir}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] text-muted-foreground">{inflow ? "Money in" : "Money out"}</p>
          <Money cents={m.total} split className="mt-0.5 block text-[26px] font-semibold tracking-[-0.01em]" />
        </div>
        {canWrite && <AddTransactionButton mode={m.dir} iconOnly label={inflow ? "Add money in" : "Add money out"} />}
      </div>
      <div className="my-3 flex h-4 gap-1 overflow-hidden rounded-md" aria-hidden>
        {m.groups.length === 0 ? <span className="flex-1 rounded-md bg-surface-muted" /> : m.groups.map((g, i) => (
          <span key={g.label} className={cn("min-w-1 rounded-[3px]", colors[Math.min(i, 2)])} style={{ flexGrow: Math.max(share(g.cents), 0.02) }} />
        ))}
      </div>
      <ul className="space-y-1.5 border-t pt-3 text-[13px]">
        {m.groups.length === 0 && <li className="text-muted-foreground">Nothing in this period.</li>}
        {m.groups.map((g, i) => (
          <li key={g.label} className="grid grid-cols-[auto_1fr_auto_3rem] items-center gap-2">
            <span className={cn("size-2 rounded-full", colors[Math.min(i, 2)])} aria-hidden />
            <span className="truncate">{g.isVendor ? titleCase(g.label) : g.label}</span>
            <Money cents={g.cents} className="font-medium" />
            <span className="text-right text-muted-foreground tabular-nums">{Math.round(share(g.cents) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BooksHealthCard({ businessId, books, coming, transfers = 0 }: {
  businessId: string;
  /** Pairs and one-sided transfers waiting for the accountant. */
  transfers?: number;
  books: { count: number; categorized: number; uncategorized: number };
  coming: { id: string; vendor: string; date: string; cents: number; days: number }[];
}) {
  // Whole-ledger share, rounded down so 99.6% never reads as done.
  const pct = books.count ? Math.floor((books.categorized / books.count) * 100) : null;
  const bars = 40;
  const lit = Math.round(((pct ?? 0) / 100) * bars);
  return (
    <CardShell title="Books health" testId="books-health">
      <Link href={`/b/${businessId}/transactions?type=uncategorized`}
        className="flex items-center gap-3 rounded-xl bg-surface-muted px-3 py-2.5 text-[13px] hover:bg-brand-soft"
        aria-label={pct === null ? "No transactions yet" : `${pct}% of all transactions categorized`}>
        <span className="text-muted-foreground">Categorized</span>
        <span className="flex h-4 flex-1 items-end gap-[2px]" aria-hidden>
          {/* Lit bars deepen from pale to full evergreen as they reach the percentage. */}
          {Array.from({ length: bars }, (_, i) => (
            <span key={i} className={cn("h-full flex-1 rounded-[1px]", i < lit ? "bg-brand" : "bg-brand/10")}
              style={i < lit ? { opacity: 0.22 + 0.78 * (lit > 1 ? i / (lit - 1) : 1) } : undefined} />
          ))}
        </span>
        <span className="font-semibold tabular-nums" data-testid="categorized-pct">{pct === null ? "—" : `${pct}%`}</span>
      </Link>
      {books.uncategorized > 0 && (
        <p className="mt-2 text-[13px]">
          <Link href={`/b/${businessId}/transactions?type=uncategorized`} className="font-medium text-attention-text hover:underline" data-testid="books-to-review">
            {books.uncategorized.toLocaleString("en-US")} of {books.count.toLocaleString("en-US")} still need a category
          </Link>
        </p>
      )}
      {transfers > 0 && (
        <p className="mt-1 text-[13px]">
          <Link href={`/b/${businessId}/transactions?transfers=1`} className="font-medium text-brand hover:underline" data-testid="books-transfers">
            {transfers} transfer{transfers === 1 ? "" : "s"} between accounts to match
          </Link>
        </p>
      )}
      {coming.length > 0 && (
        <>
          <p className="mt-4 mb-1 text-[13px] text-muted-foreground">Coming up</p>
          <ul className="divide-y border-t" data-testid="coming-up">
            {coming.map((c) => (
              <li key={c.id} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 py-3">
                <span>
                  <span className="block text-sm font-medium">{shortDate(c.date)}</span>
                  <span className="block text-xs text-muted-foreground">{c.days === 0 ? "today" : `in ${c.days} day${c.days === 1 ? "" : "s"}`}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm">{titleCase(c.vendor)}</span>
                  {c.days <= 3 ? <Chip tone="review">Due soon</Chip> : <Chip tone="neutral">Recurring</Chip>}
                </span>
                <Money cents={c.cents} className="text-sm font-semibold" />
              </li>
            ))}
          </ul>
        </>
      )}
      {coming.length === 0 && (
        <div className="mt-4 flex flex-1 flex-col" data-testid="coming-up-empty">
          <p className="mb-2 text-[13px] text-muted-foreground">Coming up</p>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-5 py-6 text-center">
            <CalendarClock className="size-5 text-brand" aria-hidden />
            <p className="text-sm font-medium">Upcoming bills will show here</p>
            <p className="max-w-64 text-[13px] text-muted-foreground">
              {books.count === 0
                ? "Import a statement to get started. Rent, payroll, subscriptions and other regular payments appear here once we spot them."
                : "Once a payment repeats on a schedule, usually after two or three months of statements, we'll list the next one and flag it when it's due."}
            </p>
          </div>
        </div>
      )}
    </CardShell>
  );
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function titleCase(v: string) {
  return v.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}
