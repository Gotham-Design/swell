"use client";

import { useEffect, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { announceMatched } from "./matched-toast";
import { useHydrated } from "@/components/submit-button";
import { CategoryPicker } from "@/components/transactions/category-picker";
import { pct } from "@/components/transactions/suggestion-chip";
import type { AiState, PickerOption } from "@/lib/dal";
import { formatCents } from "@/lib/money";
import {
  acceptSuggestion, acceptSuggestionsAbove, countSuggestionsAbove, getSuggestionsNow, listSuggestionQueue, rejectSuggestion,
  type QueueItem,
} from "@/app/b/[businessId]/transactions/ai-actions";
import { categorizeOne } from "@/app/b/[businessId]/transactions/actions";

const THRESHOLDS = [95, 90, 80, 70] as const;

/** Suggestions toolbar: count, review mode, accept-all-above, ask now, budget notice. */
export function AiBar({ businessId, ai, canWrite, options, recentIds, names, autoReview = false }: {
  businessId: string; ai: AiState; canWrite: boolean; options: PickerOption[]; recentIds: string[]; names: Record<string, string>;
  /** Open review mode on arrival ("Review with AI" from the insights panel). */
  autoReview?: boolean;
}) {
  const off = !useHydrated();
  const [pending, start] = useTransition();
  const [threshold, setThreshold] = useState<number>(90);
  const [preview, setPreview] = useState<{ count: number } | null>(null);
  const [review, setReview] = useState(autoReview && canWrite && ai.pending > 0);
  if (!ai.enabled) return null;

  const askNow = () => start(async () => {
    const r = await getSuggestionsNow(businessId);
    if (r.ok) toast.success(r.message); else toast.error(r.error);
  });
  const openPreview = () => start(async () => {
    const r = await countSuggestionsAbove(businessId, threshold);
    if (r.ok) setPreview({ count: r.count }); else toast.error(r.error);
  });
  const acceptAll = () => start(async () => {
    if (!preview) return;
    const r = await acceptSuggestionsAbove(businessId, threshold, preview.count);
    setPreview(null);
    if (r.ok) toast.success(`Accepted ${r.count} suggestion${r.count === 1 ? "" : "s"}`); else toast.error(r.error);
  });

  return (
    <div className="space-y-2" data-testid="ai-bar">
      {ai.exhausted && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="ai-budget-notice">
          <Sparkles aria-hidden />
          <AlertTitle>AI suggestions are paused for this month</AlertTitle>
          <AlertDescription>
            The monthly token budget is used up ({ai.used.toLocaleString("en-US")} of {ai.budget.toLocaleString("en-US")} tokens).
            Suggestions already made still work. An owner can raise the budget in Settings.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2 surface border border-brand/20 bg-brand-soft/60 px-3 py-2 text-sm dark:border-violet-900 dark:bg-violet-950/20">
        <Sparkles className="size-4 text-violet-600" aria-hidden />
        <span data-testid="ai-pending">{ai.pending} suggestion{ai.pending === 1 ? "" : "s"} to review</span>
        {canWrite && (
          <>
            <Button size="sm" variant="outline" disabled={off || pending || ai.pending === 0} onClick={() => setReview(true)}>
              Review suggestions
            </Button>
            <span className="ml-auto flex items-center gap-2">
              <NativeSelect aria-label="Confidence threshold" className="w-24" value={threshold} disabled={off || pending}
                onChange={(e) => setThreshold(Number(e.target.value))}>
                {THRESHOLDS.map((t) => <option key={t} value={t}>{t}%+</option>)}
              </NativeSelect>
              <Button size="sm" variant="outline" disabled={off || pending || ai.pending === 0} onClick={openPreview}>
                Accept all above…
              </Button>
              <Button size="sm" variant="ghost" disabled={off || pending || ai.exhausted} onClick={askNow}>
                Get suggestions
              </Button>
            </span>
          </>
        )}
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept {preview?.count ?? 0} suggestion{preview?.count === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription data-testid="accept-preview">
              {preview?.count
                ? `Every pending suggestion at ${threshold}% confidence or higher will be applied as its category.`
                : `No pending suggestions are at ${threshold}% or higher.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button disabled={pending || !preview?.count} onClick={acceptAll}>Accept {preview?.count ?? 0}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {review && (
        <ReviewDialog businessId={businessId} options={options} recentIds={recentIds} names={names} onClose={() => setReview(false)} />
      )}
    </div>
  );
}

/** "Review suggestions": one at a time. Enter accepts, Backspace rejects, or pick another. */
function ReviewDialog({ businessId, options, recentIds, names, onClose }: {
  businessId: string; options: PickerOption[]; recentIds: string[]; names: Record<string, string>; onClose: () => void;
}) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [picking, setPicking] = useState(false);
  const [, start] = useTransition();

  useEffect(() => {
    listSuggestionQueue(businessId).then((r) => (r.ok ? setItems(r.items) : (toast.error(r.error), setItems([]))));
  }, [businessId]);

  const item = items?.[index];
  const next = () => setIndex((i) => i + 1);
  // Move on at once and let the decision save in the background, so a quick Enter,
  // Backspace, Enter isn't dropped while the previous one is still saving.
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    next();
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error);
    });
  };
  const accept = () => item && act(async () => {
    const r = await acceptSuggestion(businessId, item.id);
    if (r.ok) announceMatched(businessId, r.matched, item.category_name);
    return r;
  });
  const reject = () => item && act(() => rejectSuggestion(businessId, item.id));
  const pick = (categoryId: string | null) => item && categoryId && act(async () => {
    const r = await categorizeOne(businessId, item.transaction_id, categoryId);
    if (r.ok) announceMatched(businessId, r.matched, undefined);
    return r.ok ? { ok: true as const } : r;
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="review-dialog"
        onKeyDown={(e) => {
          if (picking || !item || (e.target as HTMLElement).closest("input, [data-slot=popover-content]")) return;
          if (e.key === "Enter") { e.preventDefault(); accept(); }
          else if (e.key === "Backspace") { e.preventDefault(); reject(); }
        }}>
        <DialogHeader>
          <DialogTitle>Review suggestions</DialogTitle>
          <DialogDescription>
            {items === null ? "Loading…" : item ? `${index + 1} of ${items.length} · Enter accepts, Backspace rejects` : "All caught up."}
          </DialogDescription>
        </DialogHeader>
        {item && (
          <div className="space-y-3 text-sm" data-testid="review-item">
            <div className="rounded-lg border p-3">
              <div className="flex justify-between gap-3">
                <span className="font-medium">{item.description}</span>
                <span className="tabular-nums">{formatCents(item.amount_cents, { signPositive: true })}</span>
              </div>
              <div className="text-muted-foreground">{item.date} · {names[item.money_account_id]}</div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-violet-600" aria-hidden />
                <span className="font-medium" data-testid="review-category">{item.category_name}</span>
                <span className="text-muted-foreground">{pct(item.confidence)}</span>
              </div>
              {item.reason && <p className="mt-1 text-muted-foreground">{item.reason}</p>}
              {item.flags.length > 0 && <p className="mt-1 text-amber-700 dark:text-amber-400">Flags: {item.flags.join(", ")}</p>}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          {item ? (
            <>
              <Button variant="ghost" onClick={next}>Skip</Button>
              <CategoryPicker open={picking} onOpenChange={setPicking}
                trigger={<Button variant="outline">Pick another</Button>}
                options={options} recentIds={recentIds} value={null} excludeId={item.money_account_id} allowNone={false}
                onSelect={(c) => { setPicking(false); pick(c); }} />
              <Button variant="outline" onClick={reject}>Reject</Button>
              <Button onClick={accept}>Accept</Button>
            </>
          ) : (
            <DialogClose render={<Button />}>Done</DialogClose>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
