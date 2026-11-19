"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/submit-button";
import { explainPeriod } from "@/app/b/[businessId]/insights-actions";
import { getSuggestionsNow } from "@/app/b/[businessId]/transactions/ai-actions";

/** "Explain this month": the cached summary, or ask for one. */
export function ExplainPeriod({ businessId, from, to, canWrite, explanation }: {
  businessId: string; from: string; to: string; canWrite: boolean;
  explanation: { summary: string; createdAt: string; stale: boolean } | null;
}) {
  const off = !useHydrated();
  const [pending, start] = useTransition();
  const [summary, setSummary] = useState(explanation?.summary ?? null);
  const ask = () => start(async () => {
    const r = await explainPeriod(businessId, from, to);
    if (r.ok) setSummary(r.summary); else toast.error(r.error);
  });
  return (
    <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-900 dark:bg-violet-950/20" data-testid="explain">
      {summary ? (
        <p className="text-sm leading-relaxed" data-testid="explain-summary">{summary}</p>
      ) : (
        <p className="text-sm text-muted-foreground">A short summary of this period, written by Claude from totals only (no descriptions are sent).</p>
      )}
      {canWrite && (!summary || explanation?.stale) && (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" disabled={off || pending} onClick={ask}>
            <Sparkles aria-hidden /> {pending ? "Writing…" : summary ? "Explain again" : "Explain this month"}
          </Button>
          {summary && explanation?.stale && <span className="text-xs text-muted-foreground">The numbers changed since this was written.</span>}
        </div>
      )}
    </div>
  );
}

/** Ask for suggestions if none are waiting, then open review mode on the uncategorized list. */
export function ReviewWithAi({ businessId, pending }: { businessId: string; pending: number }) {
  const off = !useHydrated();
  const router = useRouter();
  const [busy, start] = useTransition();
  const go = () => start(async () => {
    if (pending === 0) {
      const r = await getSuggestionsNow(businessId);
      if (!r.ok) { toast.error(r.error); return; }
    }
    router.push(`/b/${businessId}/transactions?type=uncategorized&review=1`);
  });
  return (
    <Button size="sm" disabled={off || busy} onClick={go}>
      <Sparkles aria-hidden /> {busy ? "Getting suggestions…" : "Review with AI"}
    </Button>
  );
}
