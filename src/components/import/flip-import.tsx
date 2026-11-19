"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { flipCommittedImport } from "@/app/b/[businessId]/import/actions";

/** "Money in and out are backwards": flips an imported statement, with a confirm first. */
export function FlipImportButton({ businessId, batchId, fileName, compact }: {
  businessId: string; batchId: string; fileName: string | null; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const flip = () => start(async () => {
    const r = await flipCommittedImport(businessId, batchId);
    if (!r.ok) { toast.error(r.error); return; }
    setOpen(false);
    toast.success(`Flipped ${r.flipped} transaction${r.flipped === 1 ? "" : "s"}. Future statements from this bank will import the right way.`);
  });
  return (
    <>
      <Button variant={compact ? "ghost" : "outline"} size={compact ? "sm" : "default"} onClick={() => setOpen(true)}
        aria-label={`Flip money in and out for ${fileName ?? "this import"}`} data-testid="flip-import">
        <ArrowRightLeft aria-hidden /> {compact ? "Flip" : "Flip money in and out"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flip money in and out?</DialogTitle>
            <DialogDescription>
              For when a statement came in backwards, like card purchases showing as money in. Every transaction from{" "}
              {fileName ?? "this import"} swaps direction. Categories you chose stay; ones filed automatically are sorted again.
              You can flip it back the same way.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={pending} onClick={flip}>
              {pending ? <><Loader2 className="animate-spin" aria-hidden /> Flipping and re-sorting…</> : "Flip it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
