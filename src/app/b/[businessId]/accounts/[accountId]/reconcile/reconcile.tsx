"use client";

import { useOptimistic, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHydrated } from "@/components/submit-button";
import { centsToInput, formatCents, spokenCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { discardReconciliation, finishReconciliation, setCleared, startReconciliation } from "./actions";

interface Line { transaction_id: string; date: string; description: string; amount_cents: number; cleared: boolean }
interface Summary { beginning: number; cleared: number; count: number; statement: number; difference: number }

export function Reconcile({ businessId, accountId, canWrite, owed, today, open, lines, summary }: {
  businessId: string; accountId: string; canWrite: boolean; owed: boolean; today: string;
  open: { id: string; statement_date: string; statement_balance_cents: number } | null;
  lines: Line[]; summary: Summary | null;
}) {
  const off = !useHydrated();
  const [pending, start] = useTransition();
  const [date, setDate] = useState(open?.statement_date ?? today);
  const [balance, setBalance] = useState(open ? centsToInput(Number(open.statement_balance_cents)) : "");

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) => start(async () => {
    const r = await fn();
    if (!r.ok) toast.error(r.error);
    else if (done) toast.success(done);
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => startReconciliation(businessId, accountId, date, balance));
  };
  // Ticks show at once; the server's answer (and the new totals) follow.
  const [cleared, setOptimistic] = useOptimistic(
    new Set(lines.filter((l) => l.cleared).map((l) => l.transaction_id)),
    (state, change: { ids: string[]; on: boolean }) => {
      const next = new Set(state);
      for (const id of change.ids) if (change.on) next.add(id); else next.delete(id);
      return next;
    },
  );
  const tick = (ids: string[], on: boolean) => start(async () => {
    setOptimistic({ ids, on });
    const r = await setCleared(businessId, open!.id, ids, on);
    if (!r.ok) toast.error(r.error);
  });
  const allCleared = lines.length > 0 && lines.every((l) => cleared.has(l.transaction_id));

  return (
    <div className="space-y-6">
      {canWrite && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3 surface p-4" data-testid="statement-form">
          <div className="space-y-1">
            <Label htmlFor="rec-date">Statement ending date</Label>
            <Input id="rec-date" type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} required disabled={off} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rec-balance">{owed ? "Statement balance owed" : "Statement ending balance"}</Label>
            <Input id="rec-balance" inputMode="decimal" className="w-44" value={balance} onChange={(e) => setBalance(e.target.value)}
              placeholder="0.00" required disabled={off} />
          </div>
          <Button type="submit" disabled={off || pending}>{open ? "Update statement" : "Start reconciling"}</Button>
          {open && (
            <Button type="button" variant="ghost" disabled={off || pending}
              onClick={() => run(() => discardReconciliation(businessId, open.id), "Reconciliation discarded")}>
              Discard
            </Button>
          )}
        </form>
      )}

      {open && summary && (
        <>
          <dl className="grid grid-cols-2 gap-3 surface p-4 sm:grid-cols-4" data-testid="rec-summary" aria-live="polite">
            <Stat label="Beginning balance" cents={summary.beginning} testId="rec-beginning" />
            <Stat label={`Cleared (${summary.count})`} cents={summary.cleared} testId="rec-cleared" />
            <Stat label="Statement balance" cents={summary.statement} testId="rec-statement" />
            <Stat label="Difference" cents={summary.difference} testId="rec-difference"
              className={summary.difference === 0 ? "text-money-in-text" : "text-red-700 dark:text-red-400"} />
          </dl>

          <div className="overflow-x-auto surface">
            <table className="w-full min-w-[32rem] text-sm" data-testid="rec-lines">
              <caption className="sr-only">Transactions on or before {open.statement_date}. Tick the ones on the statement.</caption>
              <thead>
                <tr className="border-b text-left text-sm text-foreground/80">
                  <th className="w-10 px-3 py-2">
                    <input type="checkbox" className="size-4" aria-label="Tick all" checked={allCleared} disabled={off || !canWrite || !lines.length}
                      onChange={(e) => tick(lines.map((l) => l.transaction_id), e.target.checked)} />
                  </th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.transaction_id} className={cn("border-b last:border-0", cleared.has(l.transaction_id) && "bg-money-in-soft/50")} data-testid="rec-line">
                    <td className="px-3 py-2">
                      <input type="checkbox" className="size-4" checked={cleared.has(l.transaction_id)} disabled={off || !canWrite}
                        aria-label={`Cleared: ${l.description}, ${spokenCents(l.amount_cents)}`}
                        onChange={(e) => tick([l.transaction_id], e.target.checked)} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{l.date}</td>
                    <td className="px-3 py-2">{l.description}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums" aria-label={spokenCents(l.amount_cents)}>
                      {formatCents(l.amount_cents, { signPositive: true })}
                    </td>
                  </tr>
                ))}
                {!lines.length && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No unreconciled transactions on or before this date.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {canWrite && (
            <div className="flex items-center justify-end gap-3">
              {summary.difference !== 0 && (
                <span className="text-sm text-muted-foreground">Finish is available when the difference is $0.00.</span>
              )}
              <Button disabled={off || pending || summary.difference !== 0 || cleared.size !== summary.count}
                onClick={() => run(() => finishReconciliation(businessId, open.id), "Statement reconciled")}>
                Finish reconciling
              </Button>
            </div>
          )}
        </>
      )}
      {!open && !canWrite && <p className="text-sm text-muted-foreground">No reconciliation in progress.</p>}
    </div>
  );
}

function Stat({ label, cents, testId, className }: { label: string; cents: number; testId: string; className?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-lg font-semibold tabular-nums", className)} data-testid={testId} aria-label={`${label}: ${spokenCents(cents)}`}>
        {formatCents(cents)}
      </dd>
    </div>
  );
}
