"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents, spokenCents } from "@/lib/money";
import { applyRun, previewRun, undoRun, type PreviewRow } from "@/app/b/[businessId]/rules/actions";

/**
 * "Apply to existing": every row the rules would change (current -> new category), with a
 * date filter; untick rows to leave them out. Applying is one run that can be undone.
 */
export function ApplyPreview({ businessId, ruleIds, title, names, open, onOpenChange }: {
  businessId: string; ruleIds: string[] | null; title: string; names: Record<string, string>;
  open: boolean; onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <PreviewBody businessId={businessId} ruleIds={ruleIds} title={title} names={names} close={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function PreviewBody({ businessId, ruleIds, title, names, close }: {
  businessId: string; ruleIds: string[] | null; title: string; names: Record<string, string>; close: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const load = useCallback(() => start(async () => {
    const r = await previewRun(businessId, ruleIds, from || null, to || null);
    if (!r.ok) { toast.error(r.error); return; }
    setRows(r.rows);
    setExcluded(new Set());
  }), [businessId, ruleIds, from, to]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const kept = (rows ?? []).filter((r) => !excluded.has(r.transaction_id));
  const toggle = (id: string) => setExcluded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const apply = () => start(async () => {
    const r = await applyRun(businessId, ruleIds, from || null, to || null, kept.map((x) => x.transaction_id), kept.length);
    if (!r.ok) { toast.error(r.error); return; }
    close();
    const runId = r.runId;
    toast.success(`Changed ${r.changed} transaction${r.changed === 1 ? "" : "s"}`, {
      duration: 15_000,
      action: runId ? {
        label: "Undo",
        onClick: async () => {
          const u = await undoRun(businessId, runId);
          if (!u.ok) toast.error(u.error);
          else toast.success(`Restored ${u.restored} transaction${u.restored === 1 ? "" : "s"}${u.skipped ? ` (${u.skipped} changed since, left as they are)` : ""}`);
        },
      } : undefined,
    });
  });
  const cat = (id: string | null) => (id ? names[id] ?? "Unknown" : "Uncategorized");

  return (
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl" data-testid="apply-preview">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Only uncategorized transactions and ones a rule categorized can change; anything you categorized yourself, or dated in a
          locked period, is left alone.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="ap-from">From</Label>
          <Input id="ap-from" type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ap-to">To</Label>
          <Input id="ap-to" type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button variant="outline" disabled={pending} onClick={load}>Update preview</Button>
      </div>
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Checking…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl bg-surface-muted p-4 text-sm text-muted-foreground" data-testid="preview-empty">Nothing would change.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-xl border">
          <table className="w-full text-sm" data-testid="preview-rows">
            <caption className="sr-only">Transactions that would change</caption>
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-left text-foreground/80">
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" className="size-4" aria-label="Include all" checked={excluded.size === 0}
                    onChange={(e) => setExcluded(e.target.checked ? new Set() : new Set(rows.map((r) => r.transaction_id)))} />
                </th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Category</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.transaction_id} className="border-b last:border-0" data-testid="preview-row">
                  <td className="px-3 py-2">
                    <input type="checkbox" className="size-4" checked={!excluded.has(r.transaction_id)} onChange={() => toggle(r.transaction_id)}
                      aria-label={`Include ${r.description}`} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.date}</td>
                  <td className="px-3 py-2">
                    {r.description}
                    {r.new_memo !== r.current_memo && <span className="block text-xs text-muted-foreground">Memo: {r.new_memo ?? "(cleared)"}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums" aria-label={spokenCents(r.amount_cents)}>{formatCents(r.amount_cents)}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground">{cat(r.current_category_id)}</span>
                      <ArrowRight className="size-3.5" aria-label="to" />
                      <span className="font-medium">{cat(r.new_category_id)}</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">{r.rule_name}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={close}>Cancel</Button>
        <Button disabled={pending || kept.length === 0} onClick={apply} data-testid="apply-confirm">
          Apply {kept.length} change{kept.length === 1 ? "" : "s"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
