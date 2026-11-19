"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { ArrowRight, ChevronDown, History, Lock, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Money } from "@/components/ui-kit/money";
import { VendorAvatar } from "@/components/ui-kit/vendor-avatar";
import { Field } from "@/components/form-field";
import { FormAlert } from "@/components/form-alert";
import { CategoryPicker } from "@/components/transactions/category-picker";
import type { PickerOption, SuggestionChipData, TransactionRow } from "@/lib/dal";
import { SUGGESTED_AT, pct } from "@/lib/transactions/status";
import { acceptSuggestion } from "@/app/b/[businessId]/transactions/ai-actions";
import { announceMatched } from "./matched-toast";
import { centsToInput, tryParseCents } from "@/lib/money";
import { testRules } from "@/app/b/[businessId]/rules/actions";
import type { AccountType } from "@/lib/validation/accounts";
import { MODES, MODE_LABEL, fromPosting, transactionSchema, type Mode } from "@/lib/validation/transaction";
import { cn } from "@/lib/utils";
import {
  categorizeOne, deleteTransactions, getHistory, quickCreateCategory, restoreTransactions, saveTransaction, type HistoryEntry,
} from "@/app/b/[businessId]/transactions/actions";

type Errors = Record<string, string[] | undefined>;

/** "Deleted 3 transactions" with Undo for 10 seconds. */
export function undoToast(businessId: string, message: string, ids: string[]) {
  toast.success(message, {
    duration: 10_000,
    action: {
      label: "Undo",
      onClick: async () => {
        const r = await restoreTransactions(businessId, ids);
        if (r.ok) toast.success(`Restored ${r.changed}`);
        else toast.error(r.error);
      },
    },
  });
}

export function TransactionDrawer({
  open, onOpenChange, businessId, transaction, moneyAccounts, options, recentIds, names, canWrite, lockDate, today, suggestion,
  initialMode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId: string;
  /** null = add a new one. */
  transaction: TransactionRow | null;
  moneyAccounts: { id: string; name: string; last4?: string | null }[];
  options: PickerOption[];
  /** The row's pending suggestion, if any. */
  suggestion?: SuggestionChipData | null;
  /** For a new transaction: start as money in or out (the overview's + buttons). */
  initialMode?: Mode;
  recentIds: string[];
  names: Record<string, string>;
  canWrite: boolean;
  lockDate: string | null;
  today: string;
}) {
  const t = transaction;
  // New transactions default to the user's local date, not the server's (UTC) one.
  const [localToday] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const moneyIds = new Set(moneyAccounts.map((a) => a.id));
  const initial = t
    ? fromPosting(t, moneyIds)
    : { mode: (initialMode ?? "out") as Mode, date: localToday || today, money_account_id: moneyAccounts[0]?.id ?? "", to_account_id: null,
        amount_cents: 0, description: "", category_account_id: null as string | null, memo: "", reference: "" };

  const locked = !!t && !!lockDate && t.date <= lockDate;
  const deleted = !!t?.deleted_at;
  const readOnly = !canWrite || locked || deleted;

  const [mode, setMode] = useState<Mode>(initial.mode);
  const [category, setCategory] = useState<string | null>(initial.category_account_id);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  // A rule's category, filled in while the category is empty (or still the rule's).
  const [ruleHint, setRuleHint] = useState<{ id: string; name: string; category: string } | null>(null);
  const ruleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkRules = (form: HTMLFormElement) => {
    if (readOnly || mode === "transfer") return;
    if (category && category !== ruleHint?.category) return; // the person chose a category: leave it
    if (ruleTimer.current) clearTimeout(ruleTimer.current);
    ruleTimer.current = setTimeout(async () => {
      const fd = new FormData(form);
      const description = String(fd.get("description") ?? "").trim();
      const cents = tryParseCents(String(fd.get("amount") ?? ""));
      if (!description || cents === null) return;
      const r = await testRules(businessId, {
        description, amount_cents: mode === "in" ? Math.abs(cents) : -Math.abs(cents),
        money_account_id: String(fd.get("money_account_id") ?? "") || null, date: String(fd.get("date") ?? "") || null,
      });
      if (!r.ok) return;
      const w = r.result.winner;
      if (w && r.result.category_id) {
        setRuleHint({ id: w.id, name: w.name, category: r.result.category_id });
        setCategory((c) => (c === null || c === ruleHint?.category ? r.result.category_id : c));
      } else if (ruleHint && category === ruleHint.category) {
        setRuleHint(null);
        setCategory(null);
      }
    }, 400);
  };

  // Load the audit trail for an existing transaction.
  useEffect(() => {
    if (!open || !t) return;
    let live = true;
    getHistory(businessId, t.id).then((r) => { if (live) setHistory(r.ok ? r.entries : []); });
    return () => { live = false; };
  }, [open, t, businessId]);

  // Errors for fields this mode doesn't show still need to be seen, so they go on top.
  const SHOWN = mode === "transfer"
    ? ["date", "amount", "money_account_id", "to_account_id", "description", "memo", "reference"]
    : ["date", "amount", "money_account_id", "description", "memo", "reference"];
  const showErrors = (next: Errors, general?: string) => {
    setErrors(next);
    const hidden = Object.entries(next).filter(([k]) => !SHOWN.includes(k)).flatMap(([, v]) => v ?? []);
    setFormError(general ?? hidden[0]);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("mode", mode);
    fd.set("category_account_id", mode === "transfer" ? "" : category ?? "");
    if (ruleHint && category === ruleHint.category && mode !== "transfer") fd.set("rule_id", ruleHint.id);
    // Same schema the server uses; the server checks again.
    const check = transactionSchema.safeParse(Object.fromEntries(fd));
    if (!check.success) {
      const next: Errors = {};
      for (const i of check.error.issues) next[String(i.path[0])] = [...(next[String(i.path[0])] ?? []), i.message];
      showErrors(next);
      return;
    }
    setErrors({});
    setFormError(undefined);
    startTransition(async () => {
      const r = await saveTransaction(businessId, t?.id ?? null, fd);
      if (!r.ok) {
        showErrors(r.fieldErrors ?? {}, r.error);
        return;
      }
      toast.success(t ? "Transaction saved" : "Transaction added");
      if (r.matched) announceMatched(businessId, r.matched, names[r.matched.categoryId]);
      onOpenChange(false);
    });
  };

  const remove = () => {
    if (!t) return;
    startTransition(async () => {
      const r = await deleteTransactions(businessId, [t.id]);
      if (!r.ok) { setFormError(r.error); return; }
      onOpenChange(false);
      undoToast(businessId, "Transaction deleted", [t.id]);
    });
  };

  const restore = () => {
    if (!t) return;
    startTransition(async () => {
      const r = await restoreTransactions(businessId, [t.id]);
      if (!r.ok) { setFormError(r.error); return; }
      toast.success("Transaction restored");
      onOpenChange(false);
    });
  };

  const create = async (name: string, type: AccountType) => {
    const r = await quickCreateCategory(businessId, name, type);
    return r.ok ? { id: r.id } : { error: r.error };
  };

  const account = moneyAccounts.find((a) => a.id === (t?.money_account_id ?? initial.money_account_id));
  const accountLabel = account ? `${account.name}${account.last4 ? ` ··${account.last4}` : ""}` : "";
  const desc = t ? t.description_clean || t.description_raw : "";
  const s = suggestion && t && !t.category_account_id ? suggestion : null;
  const sure = !!s && s.confidence >= SUGGESTED_AT;

  const accept = () => s && startTransition(async () => {
    const r = await acceptSuggestion(businessId, s.id);
    if (!r.ok) { setFormError(r.error); return; }
    toast.success(`Filed under ${s.category_name}`);
    announceMatched(businessId, r.matched, s.category_name);
    onOpenChange(false);
  });
  const useRunnerUp = () => s?.runner_up_id && t && startTransition(async () => {
    const r = await categorizeOne(businessId, t.id, s.runner_up_id!);
    if (!r.ok) { setFormError(r.error); return; }
    toast.success(`Filed under ${s.runner_up_name}`);
    announceMatched(businessId, r.matched, s.runner_up_name ?? undefined);
    onOpenChange(false);
  });

  const fieldBox = "h-10 rounded-[10px] px-3 text-sm";
  const details = (
    <>
      <div role="radiogroup" aria-label="Type" className="inline-flex rounded-full bg-surface-muted p-1">
        {MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
            className={cn("h-8 rounded-full px-3.5 text-sm transition-colors",
              mode === m ? "bg-card font-medium shadow-[0_1px_2px_rgb(15_31_23/0.08)]" : "text-muted-foreground hover:text-foreground")}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <Field label="Amount" htmlFor="tx-amount" errors={errors.amount}>
        <Input id="tx-amount" name="amount" inputMode="decimal" placeholder="0.00" required className={fieldBox}
          defaultValue={initial.amount_cents ? centsToInput(Math.abs(initial.amount_cents)) : ""} />
      </Field>
      {mode === "transfer" ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <Field label="From" htmlFor="tx-from" errors={errors.money_account_id}>
            <NativeSelect id="tx-from" name="money_account_id" defaultValue={initial.money_account_id} className={fieldBox}>
              {moneyAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </NativeSelect>
          </Field>
          <ArrowRight className="mb-3 size-4 text-muted-foreground" aria-hidden />
          <Field label="To" htmlFor="tx-to" errors={errors.to_account_id}>
            <NativeSelect id="tx-to" name="to_account_id" defaultValue={initial.to_account_id ?? ""} className={fieldBox}>
              <option value="">Pick an account</option>
              {moneyAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </NativeSelect>
          </Field>
        </div>
      ) : (
        <Field label="Account" htmlFor="tx-account" errors={errors.money_account_id}>
          <NativeSelect id="tx-account" name="money_account_id" defaultValue={initial.money_account_id} className={fieldBox}>
            {moneyAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </NativeSelect>
        </Field>
      )}
      <Field label="Reference" htmlFor="tx-ref" errors={errors.reference} hint="Check number, invoice number…">
        <Input id="tx-ref" name="reference" maxLength={100} defaultValue={initial.reference} className={fieldBox} />
      </Field>
    </>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[460px]" showCloseButton={false} data-testid="transaction-drawer">
        <SheetHeader className="flex-row items-start gap-3 border-b py-5 pl-6 pr-4">
          {t && <VendorAvatar name={t.vendor_normalized || desc} className="size-9 text-xs" />}
          <div className="min-w-0 flex-1 space-y-0.5">
            <SheetTitle className="truncate text-[17px] font-semibold">{t ? desc : "Add transaction"}</SheetTitle>
            <SheetDescription className="text-[13px]">
              {t ? `${longDate(t.date)} · ${accountLabel}`
                : mode === "transfer" ? "Moving money between your own accounts. Not income or expense." : "One row in a money account, with one category."}
            </SheetDescription>
          </div>
          <SheetClose render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}><X aria-hidden /></SheetClose>
        </SheetHeader>

        <form id="tx-form" onSubmit={submit} onChange={(e) => checkRules(e.currentTarget)} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {t && (
              <div className="space-y-1">
                <Money cents={t.amount_cents} split tone="signed" className="text-[32px] font-semibold tracking-[-0.02em]" testId="drawer-amount" />
                <p className="text-xs text-muted-foreground" data-testid="drawer-source">
                  {[t.amount_cents < 0 ? "Money out" : "Money in", accountLabel, sourceLine(t)].filter(Boolean).join(" · ")}
                </p>
              </div>
            )}
            {locked && (
              <p className="flex items-start gap-2 rounded-xl bg-surface-muted p-3 text-sm" data-testid="locked-note">
                <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                Books are closed through {lockDate}. This transaction can&apos;t be changed or deleted unless an owner moves
                the date in Settings.
              </p>
            )}
            {deleted && (
              <p className="rounded-xl bg-surface-muted p-3 text-sm">This transaction is deleted. Restore it to make changes.</p>
            )}
            <FormAlert error={formError} />

            {s && !readOnly && (
              <section className={cn("space-y-2.5 rounded-xl px-4 py-3.5", sure ? "bg-brand-soft" : "bg-attention-soft")}
                aria-label="Suggested category" data-testid="drawer-suggestion">
                <div className={cn("flex items-center justify-between text-xs", sure ? "text-brand" : "text-attention-text")}>
                  <span className="font-semibold">{sure ? "Suggested" : "Needs review"}</span>
                  <span className="font-medium">{pct(s.confidence)} sure</span>
                </div>
                {s.vendor_has_history && s.vendor && (
                  <p className="text-[13px]">
                    Looks like {s.category_name}, based on how past {titleCase(s.vendor)} charges were filed.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={pending} onClick={accept}>Use {s.category_name}</Button>
                  {s.runner_up_id && s.runner_up_name && (
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={useRunnerUp}>{s.runner_up_name}</Button>
                  )}
                </div>
              </section>
            )}

            <fieldset disabled={readOnly || pending} className="space-y-5">
              {!t && details}
              {mode !== "transfer" && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground" id="tx-category-label">Category</div>
                  <CategoryPicker
                    trigger={
                      <button type="button" aria-labelledby="tx-category-label" disabled={readOnly}
                        className={cn("flex w-full items-center gap-2 border bg-card text-left outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring/30", fieldBox,
                          category && "border-brand")}>
                        <span className={cn("flex-1 truncate", !category && "text-muted-foreground")}>
                          {category ? names[category] ?? options.find((o) => o.id === category)?.name ?? "New category" : "Choose a category"}
                        </span>
                        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
                      </button>
                    }
                    options={options.filter((o) => !o.is_money_account)} recentIds={recentIds} value={category}
                    onSelect={setCategory} onCreate={create}
                  />
                  {ruleHint && category === ruleHint.category && (
                    <p className="text-xs text-brand" data-testid="drawer-rule-hint">Filled in by the rule “{ruleHint.name}”.</p>
                  )}
                </div>
              )}
              <Field label="Description" htmlFor="tx-desc" errors={errors.description}>
                <Input id="tx-desc" name="description" required maxLength={500} defaultValue={initial.description}
                  placeholder="As it appears on the statement" className={fieldBox} />
              </Field>
              {t && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Vendor</div>
                  <div className={cn("flex items-center border bg-surface-muted text-muted-foreground", fieldBox)} title="Worked out from the description when you save">
                    {t.vendor_normalized ? titleCase(t.vendor_normalized) : "—"}
                  </div>
                </div>
              )}
              <Field label="Date" htmlFor="tx-date" errors={errors.date}>
                <Input id="tx-date" name="date" type="date" defaultValue={initial.date} required className={fieldBox} />
              </Field>
              <Field label="Memo" htmlFor="tx-memo" errors={errors.memo}>
                <Textarea id="tx-memo" name="memo" rows={2} maxLength={1000} defaultValue={initial.memo}
                  placeholder="Add a note for your client…" className="rounded-[10px]" />
              </Field>
              {t && (
                <details className="group rounded-xl border px-4 py-2 [&[open]]:pb-4" data-testid="drawer-more">
                  <summary className="cursor-pointer py-1 text-sm font-medium text-muted-foreground">Amount, account and reference</summary>
                  <div className="mt-3 space-y-5">{details}</div>
                </details>
              )}
            </fieldset>

            {t && <DocumentsPanel businessId={businessId} link={{ transactionId: t.id }} kind="receipt" canWrite={canWrite && !deleted} />}

            {t && (
              <details className="rounded-xl border px-4 py-2" aria-labelledby="history-title" data-testid="history">
                <summary id="history-title" className="flex cursor-pointer items-center gap-2 py-1 text-sm font-medium text-muted-foreground">
                  <History className="size-4" aria-hidden /> History
                </summary>
                {history === null ? (
                  <p className="py-2 text-sm text-muted-foreground">Loading…</p>
                ) : (
                  <ol className="space-y-3 py-2 text-sm">
                    {history.map((h, i) => (
                      <li key={i} data-testid="history-entry">
                        <div>
                          <span className="font-medium">{h.who}</span>{" "}
                          {{ create: "added it", update: "changed it", delete: "deleted it", restore: "restored it" }[h.action] ?? h.action}
                        </div>
                        <div className="text-xs text-muted-foreground">{new Date(h.at).toLocaleString()}</div>
                        {h.changes.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {h.changes.map((c) => (
                              <li key={c.field}>{c.field}: <span className="line-through">{c.from}</span> → {c.to}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </details>
            )}
          </div>

          <SheetFooter className="mt-0 flex-row items-center gap-2 border-t px-6 py-3.5">
            {t && canWrite && !locked && (deleted
              ? <Button type="button" variant="ghost" onClick={restore} disabled={pending}>Restore</Button>
              : <Button type="button" variant="ghost" onClick={remove} disabled={pending}>Delete</Button>)}
            <span className="flex-1" />
            <SheetClose render={<Button type="button" variant="outline" />}>{readOnly ? "Close" : "Cancel"}</SheetClose>
            {!readOnly && (
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : t ? "Save" : "Add transaction"}
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
/** "imported Oct 18" / "added by hand" / "from a bank feed". */
function sourceLine(t: TransactionRow) {
  if (t.source === "import") return `imported ${shortDate(t.created_at)}`;
  if (t.source === "api") return "from a bank feed";
  return "added by hand";
}
function titleCase(v: string) {
  return v.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}
