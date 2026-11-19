"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CategoryPicker } from "@/components/transactions/category-picker";
import { Money } from "@/components/ui-kit/money";
import { categorizeOne, quickCreateCategory } from "@/app/b/[businessId]/transactions/actions";
import { confirmTransfers, dismissTransfer, loadTransferCandidates } from "@/app/b/[businessId]/transactions/transfer-actions";
import type { PickerOption } from "@/lib/dal";
import type { TransferCandidates } from "@/lib/dal-transfers";
import type { AccountType } from "@/lib/validation/accounts";

const short = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

/**
 * "Transfers to match": the same payment seen on two of the client's accounts (confirm to count
 * it once), and money to or from an account that isn't in the books (file it, often as an owner
 * contribution or draw). Nothing is matched without the accountant saying so.
 */
export function TransferReview({ businessId, pairs, lone, autoOpen, options, recentIds }: {
  businessId: string; pairs: number; lone: number; autoOpen?: boolean; options: PickerOption[]; recentIds: string[];
}) {
  const [open, setOpen] = useState(!!autoOpen);
  const [data, setData] = useState<TransferCandidates | null>(null);
  const [pending, start] = useTransition();
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await loadTransferCandidates(businessId);
    if (r.ok) setData(r.candidates); else toast.error(r.error);
  }, [businessId]);
  useEffect(() => {
    if (!open) return;
    // Fetch when the panel opens; the list is refreshed after every decision.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [open, load]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string } | { ok: true }>, message?: string) => start(async () => {
    const r = await fn();
    if (!r.ok) { toast.error("error" in r && r.error ? r.error : "That didn't work."); return; }
    if (message) toast.success(message);
    await load();
  });
  const match = (list: { outId: string; inId: string }[]) => act(async () => {
    const r = await confirmTransfers(businessId, list);
    if (r.ok && r.failed) toast.error(`${r.failed} couldn't be matched (closed books or changed since).`);
    return r;
  }, list.length === 1 ? "Matched: it counts once now" : `Matched ${list.length} transfers`);
  const file = (txId: string, categoryId: string | null, label: string) => act(async () => {
    const r = await categorizeOne(businessId, txId, categoryId);
    return r.ok ? { ok: true as const } : r;
  }, `Filed as ${label}`);
  const create = async (name: string, type: AccountType) => {
    const r = await quickCreateCategory(businessId, name, type);
    return r.ok ? { id: r.id } : { error: r.error };
  };

  if (!pairs && !lone) return null;
  const names = Object.fromEntries(options.map((o) => [o.id, o.name]));
  return (
    <>
      <p className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand-soft px-4 py-2 text-sm" data-testid="transfers-banner">
        <ArrowLeftRight className="size-4 text-brand" aria-hidden />
        <span className="flex-1">
          {pairs > 0 && <><strong>{pairs}</strong> payment{pairs === 1 ? "" : "s"} look{pairs === 1 ? "s" : ""} like the same transfer on two accounts</>}
          {pairs > 0 && lone > 0 && " · "}
          {lone > 0 && <><strong>{lone}</strong> transfer{lone === 1 ? "" : "s"} to or from an account that isn&apos;t in the books</>}
        </span>
        <Button size="sm" onClick={() => setOpen(true)}>Review</Button>
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" data-testid="transfer-review">
          <DialogHeader>
            <DialogTitle>Transfers to match</DialogTitle>
            <DialogDescription>
              A payment from one of this client&apos;s accounts to another shows on both statements. Match them and it counts once.
            </DialogDescription>
          </DialogHeader>
          {!data ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Finding transfers…</p>
          ) : (
            <div className="space-y-6">
              {data.pairs.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">Same payment on two accounts · {data.pairs.length}</h3>
                    {data.pairs.length > 1 && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => match(data.pairs)}>Match all {data.pairs.length}</Button>
                    )}
                  </div>
                  <ul className="divide-y rounded-xl border" data-testid="transfer-pairs">
                    {data.pairs.map((p) => (
                      <li key={p.outId + p.inId} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] sm:items-center">
                        <Side date={p.out.date} account={p.out.account} description={p.out.description} amount={-p.amount} />
                        <ArrowLeftRight className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
                        <Side date={p.in.date} account={p.in.account} description={p.in.description} amount={p.amount} />
                        <span className="flex gap-2 sm:flex-col">
                          <Button size="sm" disabled={pending} onClick={() => match([p])}>Match</Button>
                          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => dismissTransfer(businessId, p.outId, p.inId), "Won't suggest that pair again")}>
                            Not a match
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {data.lone.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold">To or from an account that isn&apos;t in the books · {data.lone.length}</h3>
                  <p className="mb-2 text-xs text-muted-foreground">Often the owner&apos;s personal account. File each the way it should count.</p>
                  <ul className="divide-y rounded-xl border" data-testid="transfer-lone">
                    {data.lone.map((t) => {
                      const owner = t.amount > 0 ? data.owner.contribution : data.owner.draw;
                      const ownerLabel = t.amount > 0 ? "Owner contribution" : "Owner draw";
                      return (
                        <li key={t.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                          <Side date={t.date} account={t.account} description={t.description} amount={t.amount} />
                          <span className="flex flex-wrap gap-2">
                            {owner && <Button size="sm" disabled={pending} onClick={() => file(t.id, owner, names[owner] ?? ownerLabel)}>{ownerLabel}</Button>}
                            <CategoryPicker open={pickerFor === t.id} onOpenChange={(o) => setPickerFor(o ? t.id : null)}
                              trigger={<Button size="sm" variant="outline" disabled={pending}>Choose…</Button>}
                              options={options} recentIds={recentIds} value={null}
                              onSelect={(c) => c && file(t.id, c, names[c] ?? "that")} onCreate={create} allowNone={false} />
                            <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => dismissTransfer(businessId, t.id), "Won't flag it again")}>
                              Not a transfer
                            </Button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {!data.pairs.length && !data.lone.length && (
                <p className="py-6 text-center text-sm text-muted-foreground">All matched. Nothing waiting.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Side({ date, account, description, amount }: { date: string; account: string; description: string; amount: number }) {
  return (
    <span className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-surface-muted px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{description}</span>
        <span className="block truncate text-xs text-muted-foreground">{short(date)} · {account}</span>
      </span>
      <Money cents={amount} tone="signed" signPositive className="shrink-0 text-sm font-semibold" />
    </span>
  );
}
