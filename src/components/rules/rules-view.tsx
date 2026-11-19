"use client";

import { useState, useTransition, type DragEvent } from "react";
import { ArrowDown, ArrowUp, Check, Copy, GripVertical, ListChecks, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Chip } from "@/components/ui-kit/status-chip";
import { PageHeader } from "@/components/ui-kit/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useHydrated } from "@/components/submit-button";
import type { PickerOption, RuleRow } from "@/lib/dal";
import { tryParseCents } from "@/lib/money";
import { EMPTY_RULE, FIELD_LABEL, describeActions, describeConditions, operatorLabel, type Condition, type RuleDraft } from "@/lib/rules/model";
import { toDraft } from "@/lib/rules/convert";
import {
  approveRule, deleteRule, duplicateRule, reorderRules, setRuleEnabled, testRules, type TestResult,
} from "@/app/b/[businessId]/rules/actions";
import { RuleBuilder, type BuilderContext } from "./rule-builder";
import { ApplyPreview } from "./apply-preview";

const ORIGIN_LABEL: Record<string, string> = { user: "Created", auto_suggested: "Suggested", apply_similar: "From apply to similar" };

export function RulesView({ businessId, rules, canWrite, options, names, moneyAccounts, editId }: {
  businessId: string; rules: RuleRow[]; canWrite: boolean; options: PickerOption[]; names: Record<string, string>;
  moneyAccounts: { id: string; name: string }[]; editId: string | null;
}) {
  const off = !useHydrated();
  const [pending, start] = useTransition();
  const ctx: BuilderContext = { businessId, options, moneyAccounts, names };
  const editing = editId ? rules.find((r) => r.id === editId) : undefined;
  const [builder, setBuilder] = useState<{ open: boolean; draft: RuleDraft }>({ open: !!editing && canWrite, draft: editing ? toDraft(editing) : EMPTY_RULE });
  const [apply, setApply] = useState<{ open: boolean; ruleIds: string[] | null; title: string }>({ open: false, ruleIds: null, title: "" });
  const [deleting, setDeleting] = useState<RuleRow | null>(null);
  const suggested = rules.filter((r) => r.status === "draft");
  const [order, setOrder] = useState<string[] | null>(null);
  const active = rules.filter((r) => r.status === "active");
  // A just-saved order shows at once; rules it doesn't know about (new or duplicated) keep the server's order after it.
  const ordered = order
    ? [...active].sort((a, b) => {
        const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
        return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || a.priority - b.priority;
      })
    : active;
  const [dragId, setDragId] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) => start(async () => {
    const r = await fn();
    if (!r.ok) toast.error(r.error); else if (done) toast.success(done);
  });
  const saveOrder = (ids: string[]) => { setOrder(ids); run(() => reorderRules(businessId, ids), "Order saved"); };
  const move = (id: string, by: number) => {
    const ids = ordered.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    saveOrder(ids);
  };
  const onDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    const ids = ordered.map((r) => r.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    setDragId(null);
    saveOrder(ids);
  };
  const summary = (r: RuleRow) => {
    const d = toDraft(r);
    return { when: describeConditions(d, names), then: describeActions(d.actions, names) };
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Rules"
        subtitle="File transactions automatically by what they say or how much they are. Rules run top to bottom before any suggestion, and never change a category you set yourself."
        actions={canWrite && <>
          <Button variant="outline" disabled={off || active.length === 0}
            onClick={() => setApply({ open: true, ruleIds: null, title: "Run rules on existing transactions" })}>
            <ListChecks aria-hidden /> Run on existing
          </Button>
          <Button disabled={off} onClick={() => setBuilder({ open: true, draft: EMPTY_RULE })}><Plus aria-hidden /> New rule</Button>
        </>} />

      {suggested.length > 0 && (
        <section className="surface space-y-3 p-5" aria-labelledby="suggested-rules" data-testid="suggested-rules">
          <h2 id="suggested-rules" className="flex items-center gap-2 text-[15px] font-semibold">
            <Sparkles className="size-4 text-brand" aria-hidden /> Suggested rules
          </h2>
          <p className="text-sm text-muted-foreground">You filed these vendors the same way several times. Approve one to make it a rule for every future statement.</p>
          <ul className="divide-y">
            {suggested.map((r) => {
              const s = summary(r);
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="suggested-rule">
                  <div className="min-w-0">
                    <p className="font-medium">{s.when}</p>
                    <p className="text-sm text-muted-foreground">{s.then} · chosen {r.confirmations} time{r.confirmations === 1 ? "" : "s"}</p>
                  </div>
                  {canWrite && (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={off || pending} onClick={() => run(() => approveRule(businessId, r.id), "Rule approved")}>
                        <Check aria-hidden /> Approve
                      </Button>
                      <Button size="sm" variant="outline" disabled={off} onClick={() => setBuilder({ open: true, draft: toDraft(r) })}>
                        <Pencil aria-hidden /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" disabled={off || pending} onClick={() => run(() => deleteRule(businessId, r.id, false), "Suggestion dismissed")}>
                        <X aria-hidden /> Dismiss
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {ordered.length === 0 ? (
        <div className="surface p-8 text-center" data-testid="no-rules">
          <p className="text-[15px] font-semibold">No rules yet</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            Vendors you file the same way are learned automatically. Rules are for the rest: anything containing &ldquo;ZELLE TO&rdquo; to Owner
            Draws, any deposit over $5,000 to Sales, or every charge on one card to one category.
          </p>
        </div>
      ) : (
        <section className="surface" aria-labelledby="rule-list">
          <div className="flex items-center justify-between px-5 pb-2 pt-5">
            <h2 id="rule-list" className="text-[15px] font-semibold">Your rules</h2>
            <span className="text-sm text-muted-foreground">Top runs first{canWrite ? " · drag to reorder" : ""}</span>
          </div>
          <ol className="divide-y" data-testid="rules">
            {ordered.map((r, i) => {
              const s = summary(r);
              return (
                <li key={r.id} data-testid="rule-row" data-rule={r.name}
                  draggable={canWrite && !off} onDragStart={() => setDragId(r.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, r.id)}
                  className="flex flex-wrap items-center gap-3 px-5 py-3">
                  {canWrite && (
                    <span className="flex items-center text-muted-foreground">
                      <GripVertical className="size-4 cursor-grab" aria-hidden />
                      <Button variant="ghost" size="icon-sm" aria-label={`Move ${r.name} up`} disabled={off || i === 0} onClick={() => move(r.id, -1)}><ArrowUp aria-hidden /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Move ${r.name} down`} disabled={off || i === ordered.length - 1} onClick={() => move(r.id, 1)}><ArrowDown aria-hidden /></Button>
                    </span>
                  )}
                  <span className="w-8 text-sm tabular-nums text-muted-foreground" aria-label={`Priority ${i + 1}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {r.name}
                      <Chip tone={r.origin === "auto_suggested" ? "suggested" : "neutral"}>{ORIGIN_LABEL[r.origin] ?? r.origin}</Chip>
                    </p>
                    <p className="text-sm text-muted-foreground" data-testid="rule-summary">{s.when}</p>
                    <p className="text-sm">{s.then}</p>
                  </div>
                  <div className="w-36 text-right text-sm text-muted-foreground">
                    <p data-testid="rule-times">Applied {r.times_applied.toLocaleString("en-US")}×</p>
                    <p>{r.last_applied_at ? `Last ${r.last_applied_at.slice(0, 10)}` : "Never applied"}</p>
                  </div>
                  <Switch checked={r.enabled} disabled={off || pending || !canWrite} aria-label={`${r.name} enabled`}
                    onCheckedChange={(on) => run(() => setRuleEnabled(businessId, r.id, on), on ? "Rule on" : "Rule off")} />
                  {canWrite && (
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${r.name}`} disabled={off} />}>
                        <MoreHorizontal aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => setBuilder({ open: true, draft: toDraft(r) })}><Pencil aria-hidden /> Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => run(() => duplicateRule(businessId, r.id), "Rule duplicated (off until you turn it on)")}><Copy aria-hidden /> Duplicate</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setApply({ open: true, ruleIds: [r.id], title: `Apply “${r.name}” to existing transactions` })}>
                          <ListChecks aria-hidden /> Apply to existing
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setDeleting(r)} className="text-destructive"><Trash2 aria-hidden /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <TestBox businessId={businessId} moneyAccounts={moneyAccounts} names={names} />

      <RuleBuilder ctx={ctx} open={builder.open} initial={builder.draft} onOpenChange={(o) => setBuilder((b) => ({ ...b, open: o }))}
        onSaved={(id, rule) => {
          if (!rule.id) setApply({ open: true, ruleIds: [id], title: `Apply “${rule.name}” to existing transactions` });
        }} />
      <ApplyPreview businessId={businessId} ruleIds={apply.ruleIds} title={apply.title} names={names}
        open={apply.open} onOpenChange={(o) => setApply((a) => ({ ...a, open: o }))} />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              It has categorized {deleting?.times_applied ?? 0} transaction{deleting?.times_applied === 1 ? "" : "s"}. Keep those categories, or put
              them back the way they were before the rule?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="outline" disabled={pending} onClick={() => {
              const r = deleting!; setDeleting(null);
              run(() => deleteRule(businessId, r.id, true).then((x) => (x.ok ? (toast.success(`Rule deleted; ${x.reverted} reverted`), x) : x)));
            }}>Delete and revert</Button>
            <Button variant="destructive" disabled={pending} onClick={() => {
              const r = deleting!; setDeleting(null);
              run(() => deleteRule(businessId, r.id, false), "Rule deleted; categories kept");
            }}>Delete, keep categories</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Describe a transaction and see which rule would win, and why. */
function TestBox({ businessId, moneyAccounts, names }: { businessId: string; moneyAccounts: { id: string; name: string }[]; names: Record<string, string> }) {
  const off = !useHydrated();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [result, setResult] = useState<TestResult | null | undefined>(undefined);
  const [pending, start] = useTransition();
  const test = () => start(async () => {
    const cents = tryParseCents(amount);
    if (!description.trim() || cents === null) { toast.error("Enter a description and an amount (negative for money out)."); return; }
    const r = await testRules(businessId, { description: description.trim(), amount_cents: cents, money_account_id: account || null });
    if (!r.ok) { toast.error(r.error); return; }
    setResult(r.result);
  });
  return (
    <section className="surface space-y-4 p-5" aria-labelledby="rule-test" data-testid="rule-test">
      <h2 id="rule-test" className="text-[15px] font-semibold">Try a transaction</h2>
      <p className="-mt-2 text-sm text-muted-foreground">Type a description and amount to see which rule would file it.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); test(); }}>
        <div className="space-y-1">
          <Label htmlFor="test-desc">Description</Label>
          <Input id="test-desc" className="w-72" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="AMZN Mktp US*2K4" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="test-amount">Amount</Label>
          <Input id="test-amount" className="w-32" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="-45.00" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="test-account">Account</Label>
          <NativeSelect id="test-account" className="w-48" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Any</option>
            {moneyAccounts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" disabled={off || pending}>Test</Button>
      </form>
      {result !== undefined && (
        <div aria-live="polite" data-testid="rule-test-result" className="rounded-xl bg-surface-muted p-4 text-sm">
          {!result?.winner ? (
            <p>No rule matches. It would get a suggested category instead, or wait for you.</p>
          ) : (
            <div className="space-y-2">
              <p><span className="font-medium">“{result.winner.name}”</span> wins
                {result.category_id ? <> and sets <span className="font-medium">{names[result.category_id] ?? "a category"}</span></> : null}
                {result.skip_ai ? " · no suggestion asked for" : null}.</p>
              <ul className="space-y-0.5">
                {result.winner.conditions.map((c, i) => (
                  <li key={i} className={c.matched ? "text-money-in-text" : "text-muted-foreground"}>
                    {c.matched ? "✓" : "✗"} {FIELD_LABEL[c.field as Condition["field"]]} {operatorLabel(c.field as Condition["field"], c.operator as Condition["operator"])} {JSON.stringify(c.value)}
                  </li>
                ))}
              </ul>
              {result.matched.length > 1 && (
                <p className="text-muted-foreground">Also matched, in order: {result.matched.filter((m) => m.id !== result.winner?.id).map((m) => m.name).join(", ")}</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
