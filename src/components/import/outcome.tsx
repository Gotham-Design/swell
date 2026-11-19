"use client";

import { useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { undoImport, type ImportOutcome } from "@/app/b/[businessId]/import/actions";

type OutcomeState = { pending: boolean; phase: "importing" | "sorting"; count: number; result?: ImportOutcome };

// Kept in the module, not in a component: committing re-renders the import page as
// "Imported", and the outcome has to survive that until the person clicks something.
const outcomes = new Map<string, OutcomeState>();
const listeners = new Set<() => void>();
export function setOutcome(batchId: string, state: OutcomeState | null) {
  if (state) outcomes.set(batchId, state); else outcomes.delete(batchId);
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Importing → sorting → what happened, with the next steps. Stays until a button is clicked. */
export function ImportOutcomeDialog({ businessId, batchId }: { businessId: string; batchId: string }) {
  const state = useSyncExternalStore(subscribe, () => outcomes.get(batchId) ?? null, () => null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const result = state?.result;
  const phase = state?.phase ?? "importing";
  const count = state?.count ?? 0;
  const go = (q: string) => {
    setOutcome(batchId, null);
    router.push(`/b/${businessId}/transactions?${q ? `${q}&` : ""}batch=${batchId}`);
  };
  return (
      <Dialog open={!!state} onOpenChange={() => {}}>
        <DialogContent showCloseButton={false} className="sm:max-w-md" data-testid="import-outcome">
          {!result ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center" role="status">
              <Loader2 className="size-8 animate-spin text-brand" aria-hidden />
              <div>
                <DialogTitle>{phase === "importing" ? `Importing ${count.toLocaleString("en-US")} transactions…` : "Sorting them into categories…"}</DialogTitle>
                <DialogDescription className="mt-1">
                  {phase === "importing" ? "Adding them to the books." : "Filing the ones we're sure about. The rest are set aside for you."}
                </DialogDescription>
              </div>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-money-in" aria-hidden /> Imported {result.committed.toLocaleString("en-US")} transactions</DialogTitle>
                <DialogDescription>
                  {result.stillSorting ? "Still sorting the rest; they'll fill in over the next minute." : "Here's how they were sorted."}
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-2 gap-3" data-testid="outcome-counts">
                <div className="rounded-xl bg-money-in-soft px-4 py-3">
                  <dt className="text-xs text-money-in-text">Filed automatically</dt>
                  <dd className="text-2xl font-semibold tabular-nums text-money-in-text" data-testid="outcome-filed">{result.autoFiled}</dd>
                </div>
                <div className="rounded-xl bg-attention-soft px-4 py-3">
                  <dt className="text-xs text-attention-text">Set aside for you</dt>
                  <dd className="text-2xl font-semibold tabular-nums text-attention-text" data-testid="outcome-review">{result.toReview}</dd>
                </div>
              </dl>
              {result.toReview > 0 && (
                <p className="text-sm text-muted-foreground">
                  {result.flagged > 0 && <>{result.flagged === 1 ? "1 looks like a transfer or owner draw" : `${result.flagged} look like transfers or owner draws`}. </>}
                  File a vendor the same way twice and every future one is filed for you.
                </p>
              )}
              {result.transfers > 0 && (
                <p className="rounded-xl bg-brand-soft px-4 py-3 text-sm">
                  <span className="font-medium">{result.transfers} transfer{result.transfers === 1 ? "" : "s"} between accounts</span>
                  <span className="text-muted-foreground"> to match, so payments like a card paid from checking count once.</span>{" "}
                  <button type="button" className="font-medium text-brand hover:underline" onClick={() => { setOutcome(batchId, null); router.push(`/b/${businessId}/transactions?transfers=1`); }}>
                    Match them
                  </button>
                </p>
              )}
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {result.autoFiled > 0 && <Button variant="outline" onClick={() => go("by=ai")}>See what was filed</Button>}
                {result.toReview > 0
                  ? <Button onClick={() => go("type=uncategorized")}>Review {result.toReview}</Button>
                  : <Button onClick={() => go("")}>Done</Button>}
              </div>
              <button type="button" className="text-center text-xs text-muted-foreground hover:underline" onClick={() => startTransition(async () => {
                const u = await undoImport(businessId, batchId);
                if (u.ok) { toast.success(`Undid the import: ${u.deleted} removed`); setOutcome(batchId, null); router.refresh(); }
                else toast.error(u.error);
              })}>Undo this import</button>
            </>
          )}
        </DialogContent>
      </Dialog>
  );
}
