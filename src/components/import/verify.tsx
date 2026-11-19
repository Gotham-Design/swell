"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRightLeft, CheckCircle2, ChevronDown, Loader2, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { CategoryPicker } from "@/components/transactions/category-picker";
import { useHydrated } from "@/components/submit-button";
import type { PickerOption } from "@/lib/dal";
import type { ImportRow } from "@/lib/dal-import";
import type { Mapping, ProblemField } from "@/lib/import/mapping";
import type { BalanceCheck } from "@/lib/import/reconcile";
import { formatCents } from "@/lib/money";
import { ACCOUNT_TYPES, TYPE_LABEL, type AccountType } from "@/lib/validation/accounts";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui-kit/status-chip";
import {
  commitImport, createCategoryForName, discardImport, fixRowCell, flipSign, mapCategoryName, setRowDecision, undoImport,
} from "@/app/b/[businessId]/import/actions";
import { setOutcome } from "./outcome";
import { FlipImportButton } from "./flip-import";

interface Issue { field: ProblemField; message: string }
const issuesOf = (r: ImportRow) => [...(r.parse_issues as unknown as Issue[]), ...(r.check_issues as unknown as Issue[])];
const money = (c: number | null) => (c === null ? "—" : formatCents(c, { signPositive: true }));

// ---------------------------------------------------------------------------
// Review: summary tiles with the totals check, then the footer that commits
// ---------------------------------------------------------------------------
export function ReviewSummary({ rows, willImport, duplicates, skipped, totalIn, totalOut, balance, ending }: {
  rows: number; willImport: number; duplicates: number; skipped: number; totalIn: number; totalOut: number; balance: BalanceCheck | null;
  /** The statement's ending balance, when the file has a balance column. */
  ending: number | null;
}) {
  const ok = !!balance?.checked && balance.ok;
  const broken = !!balance?.checked && !balance.ok;
  return (
    <div className="surface grid overflow-hidden sm:grid-cols-2 lg:grid-cols-[repeat(4,1fr)_1.6fr]" data-testid="totals">
      <Tile label="Rows in file" value={rows} testId="totals-rows" />
      <Tile label="Will import" value={willImport} tone="text-brand" testId="totals-count" />
      <Tile label="Possible duplicate" value={duplicates} tone={duplicates ? "text-attention" : undefined} testId="totals-duplicates" />
      <Tile label="Skipped" value={skipped} tone="text-muted-foreground" testId="totals-skipped" />
      <div className={cn("px-5 py-4 text-[13px] max-lg:border-t", ok ? "bg-money-in-soft" : broken ? "bg-attention-soft" : "bg-surface-muted")} data-testid="balance-check">
        <p className={cn("flex items-center gap-1.5 font-semibold", ok ? "text-money-in-text" : broken ? "text-attention-text" : "text-foreground")}>
          {ok ? <><CheckCircle2 className="size-4" aria-hidden /> Totals match your statement</>
            : broken ? <><AlertTriangle className="size-4" aria-hidden /> The running balance doesn&apos;t add up</>
            : "Check these against your statement"}
        </p>
        <p className="mt-1 tabular-nums" data-testid="totals-in-out">
          In <span data-testid="totals-in">{formatCents(totalIn, { signPositive: true })}</span> · Out <span data-testid="totals-out">{formatCents(totalOut)}</span>
        </p>
        {ok && ending !== null && (
          <p className="tabular-nums">Ending balance {formatCents(ending)}, same as the statement.</p>
        )}
        {broken && (
          <p>
            At row {(balance!.breakRow ?? 0) + 1} it should be {formatCents(balance!.expected ?? 0)}; the file says {formatCents(balance!.actual ?? 0)}.
            A row may be missing, or money in and out may be flipped.
          </p>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, tone, testId }: { label: string; value: number; tone?: string; testId: string }) {
  return (
    <div className="border-r px-5 py-4 max-sm:border-b max-lg:[&:nth-child(2n)]:border-r-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)} data-testid={testId}>{value.toLocaleString("en-US")}</dd>
    </div>
  );
}

/** Back / cancel / flip on the left; "Import N transactions" on the right. */
export function ReviewFooter({ businessId, batchId, count, mapping, canWrite }: {
  businessId: string; batchId: string; count: number; mapping: Mapping | null; canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const hydrated = useHydrated();
  if (!canWrite) return null;
  // The outcome lives outside this component: committing re-renders the page as "Imported",
  // which unmounts this footer, and the result must stay up until the person picks a button.
  const commit = () => startTransition(async () => {
    setOutcome(batchId, { pending: true, phase: "importing", count });
    // The commit takes a moment; the sorting step is most of the wait.
    const t = setTimeout(() => setOutcome(batchId, { pending: true, phase: "sorting", count }), 1500);
    const r = await commitImport(businessId, batchId, count);
    clearTimeout(t);
    if (!r.ok) { setOutcome(batchId, null); toast.error(r.error); return; }
    setOutcome(batchId, { pending: false, phase: "sorting", count, result: r.outcome });
  });
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="review-footer">
      <Button variant="outline" nativeButton={false} render={<Link href={`/b/${businessId}/import?batch=${batchId}`} />}>Back to mapping</Button>
      <Button variant="ghost" disabled={pending} onClick={() => setConfirmCancel(true)}>Cancel import</Button>
      {mapping?.amountMode === "signed" && (
        <Button variant="ghost" disabled={pending} onClick={() => startTransition(async () => {
          const r = await flipSign(businessId, batchId);
          if (r.ok) toast.success("Flipped: positive amounts are now money " + (mapping.signConvention === "positive_in" ? "out" : "in"));
          else toast.error(r.error);
        })}>
          <ArrowRightLeft aria-hidden /> Flip money in and out
        </Button>
      )}
      <span className="flex-1" />
      <span className="text-[13px] text-muted-foreground">You can undo the whole import afterwards.</span>
      <Button disabled={!hydrated || pending || count === 0} onClick={commit} data-testid="commit-import">
        {pending ? <><Loader2 className="animate-spin" aria-hidden /> Importing…</> : `Import ${count.toLocaleString("en-US")} transaction${count === 1 ? "" : "s"}`}
      </Button>
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this import?</DialogTitle>
            <DialogDescription>Nothing has been added to your books. The file and its checks are thrown away.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep reviewing</DialogClose>
            <Button variant="destructive" disabled={pending} onClick={() => startTransition(async () => {
              const r = await discardImport(businessId, batchId);
              if (!r.ok) { toast.error(r.error); return; }
              router.push(`/b/${businessId}/import`);
            })}>Cancel import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category names from the file that match nothing
// ---------------------------------------------------------------------------
export function CategoryMatcher({ businessId, batchId, unmatched, options, canWrite }: {
  businessId: string; batchId: string; unmatched: { name: string; rows: number }[]; options: PickerOption[]; canWrite: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => startTransition(async () => {
    const r = await fn();
    if (r.ok) toast.success(success);
    else toast.error(r.error ?? "Something went wrong");
  });
  return (
    <Card data-testid="category-matcher">
      <CardHeader>
        <CardTitle>Categories from your file</CardTitle>
        <CardDescription>These names don&apos;t match a category yet. Map each to an existing one or create it; anything left stays uncategorized.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {unmatched.map((u) => (
            <li key={u.name} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm" data-testid="unmatched-category" data-name={u.name}>
              <span><span className="font-medium">{u.name}</span> <span className="text-muted-foreground">· {u.rows} row{u.rows === 1 ? "" : "s"}</span></span>
              {canWrite && (
                <span className="flex flex-wrap items-center gap-2">
                  <CategoryPicker
                    trigger={<Button size="sm" variant="outline" disabled={pending}>Map to existing <ChevronDown aria-hidden /></Button>}
                    options={options.filter((o) => !o.is_money_account)} recentIds={[]} value={null} allowNone={false}
                    onSelect={(id) => id && run(() => mapCategoryName(businessId, batchId, u.name, id), `Mapped "${u.name}"`)}
                  />
                  <CreateFromName name={u.name} disabled={pending}
                    onCreate={(type) => run(() => createCategoryForName(businessId, batchId, u.name, type), `Created "${u.name}"`)} />
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CreateFromName({ name, disabled, onCreate }: { name: string; disabled: boolean; onCreate: (t: AccountType) => void }) {
  const [type, setType] = useState<AccountType>("expense");
  return (
    <span className="flex items-center gap-1">
      <NativeSelect aria-label={`Type for new category ${name}`} className="h-7 w-28 text-xs" value={type} disabled={disabled}
        onChange={(e) => setType(e.target.value as AccountType)}>
        {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
      </NativeSelect>
      <Button size="sm" disabled={disabled} onClick={() => onCreate(type)} aria-label={`Create category ${name}`}><Plus aria-hidden /> Create</Button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------
export function ImportRows({ businessId, batchId, rows, mapping, names, matched, canWrite, footer }: {
  businessId: string; batchId: string; rows: ImportRow[]; mapping: Mapping | null; names: Record<string, string>;
  matched: Record<string, { date: string; description_clean: string | null; description_raw: string; amount_cents: number }>;
  canWrite: boolean;
  footer?: React.ReactNode;
}) {
  const [editing, setEditing] = useState<{ rowId: string; field: ProblemField } | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const showCategory = mapping?.category !== null && mapping?.category !== undefined;

  const decide = (rowId: string, decision: "include" | "exclude" | null) => startTransition(async () => {
    const r = await setRowDecision(businessId, batchId, [rowId], decision);
    if (!r.ok) toast.error(r.error);
  });

  const save = (e: FormEvent<HTMLFormElement>, rowId: string, field: ProblemField) => {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get("value") ?? "");
    startTransition(async () => {
      const r = await fixRowCell(businessId, batchId, rowId, field, value);
      if (!r.ok) { toast.error(r.error); return; }
      setEditing(null);
    });
  };

  if (!rows.length) return <p className="border-t p-8 text-center text-sm text-muted-foreground">No rows here.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Rows in the file">
        <thead className="text-left text-[13px] text-muted-foreground">
          <tr className="border-y [&_th]:h-9 [&_th]:font-normal">
            <th className="w-40 pl-5">Status</th><th className="w-24 px-3">Date</th><th className="px-3">Description</th>
            {showCategory && <th className="px-3">Category</th>}
            <th className="px-3 text-right">Amount</th>
            {canWrite && <th className="w-48 pr-5"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const issues = issuesOf(r);
            const bad = (f: ProblemField[]) => issues.find((i) => f.includes(i.field));
            const zero = issues.some((i) => i.message === "Amount is zero");
            const dateIssue = zero ? undefined : bad(["date"]);
            const amountIssue = zero ? undefined : bad(["amount", "debit", "credit"]);
            const descIssue = zero ? undefined : bad(["description"]);
            const cellValue = (field: ProblemField) => {
              const col = mapping?.[field];
              return col === null || col === undefined ? "" : r.raw[col] ?? "";
            };
            const fixable = canWrite && r.status === "error" && !zero;
            const cell = (issue: Issue | undefined, shown: React.ReactNode, testId: string, align?: string, extra?: React.ReactNode) => {
              if (editing?.rowId === r.id && issue && editing.field === issue.field) {
                return (
                  <td className="px-2 py-1">
                    <form onSubmit={(e) => save(e, r.id, issue.field)} className="flex gap-1">
                      <Input name="value" aria-label={`Fix ${issue.field} on row ${r.row_index + 1}`} defaultValue={cellValue(issue.field)} autoFocus className="h-8 min-w-28 rounded-lg" />
                      <Button type="submit" size="sm" disabled={pending}>Save</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </form>
                  </td>
                );
              }
              return (
                <td className={cn("px-3 py-2.5", align, issue && "text-money-out-text")} title={issue?.message}
                  data-testid={testId} data-bad={issue ? "true" : undefined}>
                  {issue && fixable && hydrated ? (
                    <button type="button" className="underline decoration-dotted" onClick={() => setEditing({ rowId: r.id, field: issue.field })}
                      aria-label={`Fix ${issue.field} on row ${r.row_index + 1}: ${issue.message}`}>
                      {shown || "(empty)"}
                    </button>
                  ) : shown}
                  {extra}
                </td>
              );
            };
            const dupOf = r.duplicate_of_transaction ? matched[r.duplicate_of_transaction] : null;
            const nearOf = r.near_duplicate_of ? matched[r.near_duplicate_of] : null;
            const reason = zero ? "Zero amount, nothing to record"
              : r.status === "error" ? issues.map((i) => i.message).join("; ")
              : r.duplicate_of_row !== null ? `Same as row ${r.duplicate_of_row + 1} in this file`
              : dupOf ? `Already in your books: ${shortDate(dupOf.date)} · same date and amount`
              : nearOf ? `Similar to ${shortDate(nearOf.date)} ${nearOf.description_clean ?? nearOf.description_raw} (${formatCents(nearOf.amount_cents)})`
              : "";
            const dup = r.status === "duplicate" || r.status === "near_duplicate";
            const chip = zero || r.decision === "exclude" || (!r.included && r.status !== "error" && !dup) ? <Chip tone="neutral">Skipped</Chip>
              : r.status === "error" ? <Chip tone="danger">Needs a fix</Chip>
              : dup && !r.included ? <Chip tone="review">Possible duplicate</Chip>
              : <Chip tone="categorized">{dup ? "Importing anyway" : "Will import"}</Chip>;
            return (
              <tr key={r.id} className={cn("border-b last:border-b-0", dup && !r.included && r.decision !== "exclude" && "bg-attention-soft", (!r.included || zero) && !dup && "text-muted-foreground")}
                data-testid="import-row" data-row={r.row_index + 1} data-status={r.status}>
                <td className="pl-5" data-testid="row-status">{chip}</td>
                {cell(dateIssue, r.date ? shortDate(r.date) : cellValue("date"), "cell-date", "whitespace-nowrap text-muted-foreground tabular-nums")}
                {cell(descIssue, <span className={cn("font-medium", (!r.included || zero) && !dup && "font-normal")}>{r.description_raw ?? ""}</span>, "cell-description", undefined,
                  reason && <span className={cn("block text-xs", dup ? "text-attention-text" : "text-muted-foreground")}>{reason}</span>)}
                {showCategory && (
                  <td className="px-3">
                    {r.category_name ? (r.category_account_id ? names[r.category_account_id] : <span className="text-attention-text">{r.category_name} (no match)</span>) : "—"}
                  </td>
                )}
                {cell(amountIssue, r.amount_cents !== null ? money(r.amount_cents) : zero ? "$0.00" : cellValue(amountIssue?.field ?? "amount"), "cell-amount",
                  cn("text-right font-medium whitespace-nowrap tabular-nums", r.amount_cents !== null && r.included && (r.amount_cents > 0 ? "text-money-in-text" : "text-money-out-text")))}
                {canWrite && (
                  <td className="pr-5 text-right">
                    {r.status !== "error" && dup && !r.included && r.decision === null ? (
                      <span className="inline-flex gap-1">
                        <Button size="sm" variant="outline" disabled={pending || !hydrated} onClick={() => decide(r.id, "exclude")}>Skip</Button>
                        <Button size="sm" variant="ghost" disabled={pending || !hydrated} onClick={() => decide(r.id, "include")}>Import anyway</Button>
                      </span>
                    ) : r.status !== "error" && (r.included ? (
                      <Button size="sm" variant={dup ? "outline" : "ghost"} disabled={pending || !hydrated} onClick={() => decide(r.id, "exclude")}>Skip</Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={pending || !hydrated} onClick={() => decide(r.id, r.decision === "exclude" && !dup ? null : "include")}>
                        {dup ? "Import anyway" : "Include"}
                      </Button>
                    ))}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// After commit
// ---------------------------------------------------------------------------
export function CommittedSummary({ businessId, batchId, status, count, accountName, totalIn, totalOut, fileName, canWrite }: {
  businessId: string; batchId: string; status: string; count: number; accountName: string; totalIn: number; totalOut: number;
  fileName: string; canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  if (status === "undone") {
    return (
      <Card data-testid="import-undone">
        <CardHeader>
          <CardTitle>This import was undone</CardTitle>
          <CardDescription>
            The {count} transactions from {fileName} were deleted. They&apos;re in the Deleted view of Transactions, or import the file again.
          </CardDescription>
        </CardHeader>
        <CardContent><Link href={`/b/${businessId}/import`} className={buttonVariants()}>Import a file</Link></CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid="import-committed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-money-in-text" aria-hidden /> Imported {count.toLocaleString("en-US")} transaction{count === 1 ? "" : "s"}</CardTitle>
        <CardDescription>
          Into {accountName}: {formatCents(totalIn)} in, {formatCents(totalOut)} out, {formatCents(totalIn + totalOut)} net.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Link href={`/b/${businessId}/transactions?batch=${batchId}`} className={buttonVariants()}>View the imported transactions</Link>
        {canWrite && (
          <>
            <FlipImportButton businessId={businessId} batchId={batchId} fileName={fileName} />
            <Button variant="outline" onClick={() => setOpen(true)}><Undo2 aria-hidden /> Undo import</Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Undo this import?</DialogTitle>
                  <DialogDescription>All {count} transactions from {fileName} will be deleted. You can restore them from the Deleted view.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                  <Button variant="destructive" disabled={pending} onClick={() => startTransition(async () => {
                    const r = await undoImport(businessId, batchId);
                    setOpen(false);
                    if (!r.ok) { toast.error(r.error); return; }
                    toast.success(`Undid the import: ${r.deleted} deleted`);
                    router.refresh();
                  })}>Undo import</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </CardContent>
    </Card>
  );
}
