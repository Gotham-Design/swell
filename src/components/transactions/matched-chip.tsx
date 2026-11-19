"use client";

import { useState, useTransition } from "react";
import { ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { unmatchTransfer } from "@/app/b/[businessId]/transactions/transfer-actions";
import type { MatchInfo } from "@/lib/dal-transfers";

const short = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

/** A matched transfer in the category cell: which account it pairs with, and Unmatch. */
export function MatchedChip({ businessId, match, canWrite }: { businessId: string; match: MatchInfo; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={
        <button type="button" data-testid="matched-chip"
          className="inline-flex h-6 max-w-56 items-center gap-1.5 rounded-full bg-brand-soft px-2.5 text-xs font-medium text-brand outline-none hover:bg-brand-soft/70 focus-visible:ring-2 focus-visible:ring-ring" />
      }>
        <ArrowLeftRight className="size-3 shrink-0" aria-hidden />
        <span className="truncate">Transfer · {match.otherAccount}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-4 text-sm">
        <p className="font-medium">Matched transfer</p>
        <p className="text-muted-foreground">
          Paired with the same amount on {match.otherAccount} ({short(match.otherDate)}), so the payment counts once.
        </p>
        {canWrite && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
            const r = await unmatchTransfer(businessId, match.matchId);
            if (!r.ok) { toast.error(r.error); return; }
            setOpen(false);
            toast.success("Unmatched. Both sides are back to how they were filed.");
          })}>Unmatch</Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
