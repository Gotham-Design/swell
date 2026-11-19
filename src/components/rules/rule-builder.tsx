"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { PickerOption } from "@/lib/dal";
import { centsToInput, formatCents, spokenCents, tryParseCents } from "@/lib/money";
import {
  ACTIONS, ACTION_LABEL, FIELDS, FIELD_LABEL, OPERATORS_FOR, conditionProblem, defaultValue, operatorLabel, ruleProblem,
  type Action, type ActionKind, type Condition, type Field, type Operator, type RuleDraft,
} from "@/lib/rules/model";
import { checkDraft, saveRule, type Conflict, type DraftMatch } from "@/app/b/[businessId]/rules/actions";
import { TYPE_LABEL, type AccountType } from "@/lib/validation/accounts";

const TEXT_FIELDS: Field[] = ["description_clean", "description_raw", "vendor_normalized"];
const SOURCES = [["manual", "Added by hand"], ["import", "Imported"], ["api", "Bank feed"]] as const;

export interface BuilderContext {
  businessId: string;
  options: PickerOption[];
  moneyAccounts: { id: string; name: string }[];
  names: Record<string, string>;
}

/** Create or edit a rule. Shows what it would match as you type, and overlaps with rules that run first. */
export function RuleBuilder({ ctx, open, onOpenChange, initial, title, onSaved }: {
  ctx: BuilderContext; open: boolean; onOpenChange: (o: boolean) => void; initial: RuleDraft; title?: string;
  onSaved?: (id: string, rule: RuleDraft) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <BuilderBody key={JSON.stringify(initial)} ctx={ctx} initial={initial} title={title} onSaved={onSaved} close={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function BuilderBody({ ctx, initial, title, onSaved, close }: {
  ctx: BuilderContext; initial: RuleDraft; title?: string; onSaved?: (id: string, rule: RuleDraft) => void; close: () => void;
}) {
  const [rule, setRule] = useState<RuleDraft>(initial);
  const [live, setLive] = useState<{ count: number; sample: DraftMatch[]; conflicts: Conflict[] } | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const set = (patch: Partial<RuleDraft>) => setRule((r) => ({ ...r, ...patch }));
  const setCond = (i: number, c: Condition) => set({ conditions: rule.conditions.map((x, j) => (j === i ? c : x)) });
  const setAct = (i: number, a: Action) => set({ actions: rule.actions.map((x, j) => (j === i ? a : x)) });

  // Live counter: once every condition is valid, ask the database (debounced).
  const condKey = JSON.stringify([rule.conditions, rule.match_mode, rule.actions, rule.id]);
  const condsValid = rule.conditions.length > 0 && rule.conditions.every((c) => !conditionProblem(c));
  useEffect(() => {
    if (!condsValid) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await checkDraft(ctx.businessId, rule);
      if (cancelled) return;
      if (r.ok) { setLive({ count: r.count, sample: r.sample, conflicts: r.conflicts }); setLiveError(null); }
      else setLiveError(r.error);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condKey, condsValid, ctx.businessId]);

  const problem = ruleProblem(rule);
  const save = () => startSave(async () => {
    const r = await saveRule(ctx.businessId, rule);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(rule.id ? "Rule saved" : "Rule created");
    onSaved?.(r.id, rule);
    close();
  });
  const categories = ctx.options.filter((o) => !o.is_money_account);

  return (
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl" data-testid="rule-builder">
      <DialogHeader>
        <DialogTitle>{title ?? (rule.id ? "Edit rule" : "New rule")}</DialogTitle>
        <DialogDescription>Rules categorize new imports and uncategorized transactions. They never change a category you set by hand.</DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <div className="space-y-1">
          <Label htmlFor="rule-name">Name</Label>
          <Input id="rule-name" value={rule.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="Amazon office supplies" />
        </div>

        <section className="space-y-2" aria-labelledby="rule-when">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <h3 id="rule-when" className="font-medium">When a transaction matches</h3>
            <NativeSelect aria-label="Match all or any conditions" className="w-24" value={rule.match_mode}
              onChange={(e) => set({ match_mode: e.target.value as "all" | "any" })}>
              <option value="all">all</option>
              <option value="any">any</option>
            </NativeSelect>
            <span>of these conditions</span>
          </div>
          <ul className="space-y-2">
            {rule.conditions.map((c, i) => (
              <ConditionRow key={i} index={i} c={c} ctx={ctx} onChange={(next) => setCond(i, next)}
                onRemove={rule.conditions.length > 1 ? () => set({ conditions: rule.conditions.filter((_, j) => j !== i) }) : undefined} />
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" disabled={rule.conditions.length >= 20}
            onClick={() => set({ conditions: [...rule.conditions, { field: "amount", operator: "lt", value: 0 }] })}>
            <Plus aria-hidden /> Add condition
          </Button>
        </section>

        <section className="space-y-2" aria-labelledby="rule-then">
          <h3 id="rule-then" className="text-sm font-medium">Then</h3>
          <ul className="space-y-2">
            {rule.actions.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2" data-testid="rule-action">
                <NativeSelect aria-label={`Action ${i + 1}`} className="w-48" value={a.action}
                  onChange={(e) => setAct(i, { action: e.target.value as ActionKind, account_id: null, value: {} })}>
                  {ACTIONS.map((k) => <option key={k} value={k}>{ACTION_LABEL[k]}</option>)}
                </NativeSelect>
                {a.action === "set_category" && (
                  <NativeSelect aria-label="Category" className="w-64" value={a.account_id ?? ""} onChange={(e) => setAct(i, { ...a, account_id: e.target.value || null })}>
                    <option value="">Pick a category…</option>
                    {(["income", "expense", "asset", "liability", "equity"] as AccountType[]).map((t) => {
                      const items = categories.filter((o) => o.type === t);
                      return items.length ? <optgroup key={t} label={TYPE_LABEL[t]}>{items.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</optgroup> : null;
                    })}
                  </NativeSelect>
                )}
                {a.action === "mark_transfer_to_account" && (
                  <NativeSelect aria-label="Transfer to account" className="w-64" value={a.account_id ?? ""} onChange={(e) => setAct(i, { ...a, account_id: e.target.value || null })}>
                    <option value="">Pick an account…</option>
                    {ctx.moneyAccounts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </NativeSelect>
                )}
                {(a.action === "set_memo" || a.action === "append_memo") && (
                  <Input aria-label="Memo text" className="w-64" maxLength={500} value={a.value?.text ?? ""}
                    onChange={(e) => setAct(i, { ...a, value: { text: e.target.value } })} />
                )}
                {rule.actions.length > 1 && (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove action ${i + 1}`}
                    onClick={() => set({ actions: rule.actions.filter((_, j) => j !== i) })}><X aria-hidden /></Button>
                )}
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" onClick={() => set({ actions: [...rule.actions, { action: "append_memo", value: { text: "" } }] })}>
            <Plus aria-hidden /> Add action
          </Button>
        </section>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4" checked={rule.stop_processing} onChange={(e) => set({ stop_processing: e.target.checked })} />
            Stop checking other rules after this one
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Enabled
          </label>
        </div>

        <section className="space-y-2 rounded-xl bg-surface-muted p-3" aria-live="polite" data-testid="rule-live">
          {!condsValid ? (
            <p className="text-sm text-muted-foreground">{rule.conditions.map(conditionProblem).find(Boolean) ?? "Add a condition to see matches."}</p>
          ) : liveError ? (
            <p className="text-sm text-destructive">{liveError}</p>
          ) : live ? (
            <>
              <p className="text-sm font-medium" data-testid="rule-match-count">
                Matches {live.count.toLocaleString("en-US")} existing transaction{live.count === 1 ? "" : "s"}
              </p>
              {live.sample.length > 0 && (
                <ul className="divide-y text-sm" data-testid="rule-match-sample">
                  {live.sample.map((m) => (
                    <li key={m.transaction_id} className="flex justify-between gap-3 py-1">
                      <span className="min-w-0 truncate"><span className="tabular-nums text-muted-foreground">{m.date}</span> {m.description}</span>
                      <span className="shrink-0 tabular-nums" aria-label={spokenCents(m.amount_cents)}>{formatCents(m.amount_cents)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {live.conflicts.map((c) => (
                <p key={c.rule_id} role="alert" data-testid="rule-conflict"
                  className="flex items-start gap-2 rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention-text">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>“{c.name}” runs first and sets {ctx.names[c.category_id ?? ""] ?? "another category"} on {c.overlap} of these. Move this rule above it, or narrow the conditions.</span>
                </p>
              ))}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Checking…</p>
          )}
        </section>
      </div>

      <DialogFooter className="items-center gap-3">
        {problem && <span className="mr-auto text-sm text-muted-foreground" data-testid="rule-problem">{problem}</span>}
        <Button variant="outline" onClick={close}>Cancel</Button>
        <Button disabled={!!problem || saving} onClick={save}>{rule.id ? "Save rule" : "Create rule"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ConditionRow({ index, c, ctx, onChange, onRemove }: {
  index: number; c: Condition; ctx: BuilderContext; onChange: (c: Condition) => void; onRemove?: () => void;
}) {
  const n = index + 1;
  const problem = conditionProblem(c);
  return (
    <li className="flex flex-wrap items-center gap-2" data-testid="rule-condition">
      <NativeSelect aria-label={`Condition ${n} field`} className="w-44" value={c.field}
        onChange={(e) => {
          const field = e.target.value as Field;
          const op = OPERATORS_FOR[field].includes(c.operator) ? c.operator : OPERATORS_FOR[field][0];
          onChange({ field, operator: op, value: defaultValue(field, op), case_sensitive: false });
        }}>
        {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
      </NativeSelect>
      <NativeSelect aria-label={`Condition ${n} operator`} className="w-44" value={c.operator}
        onChange={(e) => {
          const op = e.target.value as Operator;
          const sameShape = (op === "between") === (c.operator === "between") && (op === "in") === (c.operator === "in");
          onChange({ ...c, operator: op, value: sameShape ? c.value : defaultValue(c.field, op) });
        }}>
        {OPERATORS_FOR[c.field].map((o) => <option key={o} value={o}>{operatorLabel(c.field, o)}</option>)}
      </NativeSelect>
      <ValueControl n={n} c={c} ctx={ctx} onChange={(value) => onChange({ ...c, value })} />
      {TEXT_FIELDS.includes(c.field) && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" className="size-3.5" checked={!!c.case_sensitive} onChange={(e) => onChange({ ...c, case_sensitive: e.target.checked })} />
          Match case
        </label>
      )}
      {onRemove && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove condition ${n}`} onClick={onRemove}><X aria-hidden /></Button>
      )}
      {problem && <p className="basis-full text-xs text-destructive" role="status">{problem}</p>}
    </li>
  );
}

function ValueControl({ n, c, ctx, onChange }: { n: number; c: Condition; ctx: BuilderContext; onChange: (v: Condition["value"]) => void }) {
  const label = `Condition ${n} value`;
  if (TEXT_FIELDS.includes(c.field)) {
    if (c.operator === "in") {
      return <ListInput label={label} value={(c.value as string[]) ?? []} onChange={onChange} placeholder="uber, lyft" />;
    }
    return <Input aria-label={label} className="w-56" value={String(c.value ?? "")} onChange={(e) => onChange(e.target.value)}
      placeholder={c.operator === "regex" ? "^SQ \\*" : "AMZN"} />;
  }
  if (c.field === "amount") {
    if (c.operator === "between") {
      const [lo, hi] = (c.value as number[]) ?? [0, 0];
      return (
        <span className="flex items-center gap-2">
          <MoneyInput label={`${label} from`} cents={lo} onChange={(v) => onChange([v, hi])} />
          <span className="text-sm text-muted-foreground">and</span>
          <MoneyInput label={`${label} to`} cents={hi} onChange={(v) => onChange([lo, v])} />
        </span>
      );
    }
    if (c.operator === "in") {
      return <ListInput label={label} value={((c.value as number[]) ?? []).map((v) => centsToInput(v))} placeholder="9.99, 19.99"
        onChange={(list) => onChange(list.map((s) => Math.abs(tryParseCents(s) ?? NaN)).filter(Number.isFinite))} />;
    }
    return <MoneyInput label={label} cents={c.value as number} onChange={onChange} />;
  }
  if (c.field === "direction") {
    return (
      <NativeSelect aria-label={label} className="w-40" value={String(c.value)} onChange={(e) => onChange(e.target.value)}>
        <option value="out">Money out</option>
        <option value="in">Money in</option>
      </NativeSelect>
    );
  }
  if (c.field === "money_account_id") {
    if (c.operator === "in") {
      return (
        <select multiple aria-label={label} className="h-20 w-56 rounded-lg border border-input bg-transparent px-2 text-sm"
          value={(c.value as string[]) ?? []} onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}>
          {ctx.moneyAccounts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      );
    }
    return (
      <NativeSelect aria-label={label} className="w-56" value={String(c.value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">Pick an account…</option>
        {ctx.moneyAccounts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </NativeSelect>
    );
  }
  if (c.field === "date") {
    if (c.operator === "between") {
      const [from, to] = (c.value as string[]) ?? ["", ""];
      return (
        <span className="flex items-center gap-2">
          <Input type="date" aria-label={`${label} from`} className="w-40" value={from} onChange={(e) => onChange([e.target.value, to])} />
          <span className="text-sm text-muted-foreground">and</span>
          <Input type="date" aria-label={`${label} to`} className="w-40" value={to} onChange={(e) => onChange([from, e.target.value])} />
        </span>
      );
    }
    return <Input type="date" aria-label={label} className="w-40" value={String(c.value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
  // source
  if (c.operator === "in") {
    return (
      <select multiple aria-label={label} className="h-20 w-48 rounded-lg border border-input bg-transparent px-2 text-sm"
        value={(c.value as string[]) ?? []} onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}>
        {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    );
  }
  return (
    <NativeSelect aria-label={label} className="w-44" value={String(c.value)} onChange={(e) => onChange(e.target.value)}>
      {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </NativeSelect>
  );
}

/** Dollars as typed; the condition holds absolute cents. */
function MoneyInput({ label, cents, onChange }: { label: string; cents: number; onChange: (c: number) => void }) {
  const [text, setText] = useState(cents ? centsToInput(cents) : "");
  return (
    <Input aria-label={label} inputMode="decimal" className="w-32" value={text} placeholder="50.00"
      onChange={(e) => {
        setText(e.target.value);
        const c = tryParseCents(e.target.value);
        onChange(c === null ? -1 : Math.abs(c));
      }} />
  );
}

function ListInput({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <Input aria-label={label} className="w-56" value={text} placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean));
      }} />
  );
}
