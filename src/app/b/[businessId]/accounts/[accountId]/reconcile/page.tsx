import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getBusiness, getSupabase, todayIso } from "@/lib/dal";
import { formatCents, spokenCents } from "@/lib/money";
import { isOwedKind } from "@/lib/validation/accounts";
import { Reconcile } from "./reconcile";

export default function ReconcilePage({ params }: PageProps<"/b/[businessId]/accounts/[accountId]/reconcile">) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <ReconcileView params={params} />
      </Suspense>
    </div>
  );
}

async function ReconcileView({ params }: Pick<PageProps<"/b/[businessId]/accounts/[accountId]/reconcile">, "params">) {
  const { businessId, accountId } = await params;
  const { business, canWrite } = await getBusiness(businessId);
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) notFound();
  const supabase = await getSupabase();
  const { data: account } = await supabase.from("accounts").select("id, name, subtype, is_money_account")
    .eq("business_id", business.id).eq("id", accountId).maybeSingle();
  if (!account?.is_money_account) notFound();
  const { data: recs, error } = await supabase.from("reconciliations")
    .select("id, statement_date, statement_balance_cents, status, completed_at")
    .eq("money_account_id", account.id).order("statement_date", { ascending: false });
  if (error) throw new Error(error.message);
  const open = recs.find((r) => r.status === "in_progress") ?? null;
  const done = recs.filter((r) => r.status === "completed");
  const [lines, summary] = open
    ? await Promise.all([
        supabase.rpc("reconciliation_lines", { p_reconciliation_id: open.id }),
        supabase.rpc("reconciliation_summary", { p_reconciliation_id: open.id }).single(),
      ])
    : [null, null];
  if (lines?.error) throw new Error(lines.error.message);
  if (summary?.error) throw new Error(summary.error.message);
  const owed = isOwedKind(account.subtype ?? "");

  return (
    <>
      <div>
        <Link href={`/b/${business.id}/accounts`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden /> Money accounts
        </Link>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight sm:text-3xl">Reconcile {account.name}</h1>
        <p className="mt-2 max-w-3xl text-base text-muted-foreground">
          Enter the statement&apos;s ending date and {owed ? "balance owed" : "balance"}, tick each transaction that appears on it,
          and finish when the difference is zero.
        </p>
      </div>
      <Reconcile
        businessId={business.id} accountId={account.id} canWrite={canWrite} owed={owed} today={todayIso()}
        open={open ? { id: open.id, statement_date: open.statement_date, statement_balance_cents: open.statement_balance_cents } : null}
        lines={(lines?.data ?? []).map((l) => ({ ...l, amount_cents: Number(l.amount_cents) }))}
        summary={summary?.data ? {
          beginning: Number(summary.data.beginning_cents), cleared: Number(summary.data.cleared_cents),
          count: summary.data.cleared_count, statement: Number(summary.data.statement_balance_cents),
          difference: Number(summary.data.difference_cents),
        } : null}
      />
      {done.length > 0 && (
        <section aria-labelledby="rec-history" className="space-y-2">
          <h2 id="rec-history" className="text-lg font-semibold">Reconciled statements</h2>
          <ul className="divide-y surface text-sm" data-testid="reconciled-history">
            {done.map((r) => (
              <li key={r.id} className="flex justify-between px-4 py-2">
                <span>Statement ending {r.statement_date}</span>
                <span className="tabular-nums" aria-label={spokenCents(Number(r.statement_balance_cents))}>
                  {formatCents(Number(r.statement_balance_cents))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
