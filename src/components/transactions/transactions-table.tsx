"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactElement, type ReactNode } from "react";
import { Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CategoryPicker } from "@/components/transactions/category-picker";
import { TransactionDrawer, undoToast } from "@/components/transactions/transaction-drawer";
import { onAddTransaction } from "@/components/transactions/add-transaction";
import { SuggestionChip } from "@/components/transactions/suggestion-chip";
import { useHydrated } from "@/components/submit-button";
import { Money } from "@/components/ui-kit/money";
import { StatusChip } from "@/components/ui-kit/status-chip";
import { VendorAvatar } from "@/components/ui-kit/vendor-avatar";
import type { PickerOption, SuggestionChipData, TransactionRow } from "@/lib/dal";
import { formatCents, sumCents } from "@/lib/money";
import { txnStatus } from "@/lib/transactions/status";
import type { AccountType } from "@/lib/validation/accounts";
import type { Mode } from "@/lib/validation/transaction";
import { cn } from "@/lib/utils";
import { acceptSuggestion, acceptSuggestions } from "@/app/b/[businessId]/transactions/ai-actions";
import { announceMatched } from "./matched-toast";
import { MatchedChip } from "./matched-chip";
import type { MatchInfo } from "@/lib/dal-transfers";
import {
  bulkCategorize, categorizeOne, deleteMatching, deleteTransactions, quickCreateCategory,
  restoreTransactions,
} from "@/app/b/[businessId]/transactions/actions";

export type MoneyAccountOption = { id: string; name: string; last4?: string | null };

/**
 * The transaction list: checkbox, date, vendor + description, account, category (suggestion
 * chip or name), status, amount. Clicking a row opens the edit drawer. Keyboard: j / k move,
 * Enter opens, c changes the category, x selects; on a chip Enter accepts, Backspace rejects.
 */
export function TransactionsTable({
  businessId, rows, total, matchingNet, names, options, moneyAccounts, recentIds, canWrite, query, lockDate,
  deletedView, today, suggestions = {}, header, footer, selectable = true, matches = {},
}: {
  /** Matched transfers on screen: shown as "Transfer ⇄ <other account>", with Unmatch. */
  matches?: Record<string, MatchInfo>;
  businessId: string;
  rows: TransactionRow[];
  /** Rows matching the filters across all pages, and their net amount. */
  total: number;
  matchingNet: number;
  names: Record<string, string>;
  options: PickerOption[];
  moneyAccounts: MoneyAccountOption[];
  recentIds: string[];
  canWrite: boolean;
  /** The list's current query string, for "select all matching". */
  query: string;
  lockDate: string | null;
  /** Showing soft-deleted rows (restore instead of edit). */
  deletedView: boolean;
  today: string;
  /** Pending AI suggestions for rows on this page, by transaction id. */
  suggestions?: Record<string, SuggestionChipData>;
  /** The toolbar above the table (tabs, search, filters), inside the same card. */
  header?: ReactNode;
  /** Pagination under the table, inside the card. */
  footer?: ReactNode;
  /** Checkboxes and the bulk bar (off for the overview's recent list). */
  selectable?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [active, setActive] = useState(0);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ open: boolean; row: TransactionRow | null; key: number; mode?: Mode }>({ open: false, row: null, key: 0 });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  // Row controls wait for hydration, so an early click isn't silently dropped.
  const off = !useHydrated();
  const pick = canWrite && selectable;

  const isLocked = (r: TransactionRow) => !!lockDate && r.date <= lockDate;
  const editable = (r: TransactionRow) => canWrite && !deletedView && !isLocked(r);

  // A new page or filter starts with nothing selected.
  const pageKey = rows.map((r) => r.id).join();
  const [lastPageKey, setLastPageKey] = useState(pageKey);
  if (pageKey !== lastPageKey) {
    setLastPageKey(pageKey);
    setSelected(new Set());
    setAllMatching(false);
    setActive(0);
  }

  const openDrawer = (row: TransactionRow | null, mode?: Mode) => setDrawer((d) => ({ open: true, row, key: d.key + 1, mode }));

  // "Add transaction" buttons elsewhere on the page (see AddTransactionButton).
  useEffect(() => onAddTransaction((mode) => openDrawer(null, mode)), []);

  const create = useCallback(async (name: string, type: AccountType) => {
    const r = await quickCreateCategory(businessId, name, type);
    return r.ok ? { id: r.id } : { error: r.error };
  }, [businessId]);

  const categorize = (id: string, categoryId: string | null) => startTransition(async () => {
    const r = await categorizeOne(businessId, id, categoryId);
    if (!r.ok) { toast.error(r.error); return; }
    if (categoryId) announceMatched(businessId, r.matched, names[categoryId]);
  });

  // ✓ files the suggestion (and the vendor's other rows). ✕ just opens the picker: choosing a
  // category there decides the suggestion, and closing it leaves the suggestion as it was.
  const decide = (row: TransactionRow, s: SuggestionChipData, accept: boolean) => {
    if (!accept) { setPickerFor(row.id); return; }
    startTransition(async () => {
      const r = await acceptSuggestion(businessId, s.id);
      if (!r.ok) { toast.error(r.error); return; }
      announceMatched(businessId, r.matched, s.category_name);
    });
  };

  const clearSelection = () => { setSelected(new Set()); setAllMatching(false); };

  const runBulk = (categoryId: string | null) => startTransition(async () => {
    const r = await bulkCategorize(businessId, allMatching ? { query } : { ids: [...selected] }, categoryId);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`Categorized ${r.changed} transaction${r.changed === 1 ? "" : "s"}`);
    clearSelection();
  });

  const runBulkDelete = () => startTransition(async () => {
    let ids = [...selected];
    const r = allMatching ? await deleteMatching(businessId, query) : await deleteTransactions(businessId, ids);
    setConfirmDelete(false);
    if (!r.ok) { toast.error(r.error); return; }
    if (allMatching && "ids" in r) ids = r.ids as string[];
    undoToast(businessId, `Deleted ${r.changed} transaction${r.changed === 1 ? "" : "s"}`, ids);
    clearSelection();
  });

  const runBulkRestore = () => startTransition(async () => {
    const r = await restoreTransactions(businessId, [...selected]);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`Restored ${r.changed} transaction${r.changed === 1 ? "" : "s"}`);
    clearSelection();
  });

  // Suggestions on the selected rows of this page.
  const selectedSuggestions = rows.filter((r) => selected.has(r.id) && !r.category_account_id && suggestions[r.id])
    .map((r) => suggestions[r.id].id);
  const runAccept = () => startTransition(async () => {
    const r = await acceptSuggestions(businessId, selectedSuggestions);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`Accepted ${r.count} suggestion${r.count === 1 ? "" : "s"}${r.failed ? ` (${r.failed} couldn't be applied)` : ""}`);
    clearSelection();
  });

  const toggleRow = (id: string) => {
    setAllMatching(false);
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || drawer.open
        || el.closest("input, textarea, select, button, [role=dialog], [data-slot=popover-content]")) return;
      const row = rows[active];
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        setActive((i) => {
          const next = Math.max(0, Math.min(rows.length - 1, i + (e.key === "j" ? 1 : -1)));
          rowRefs.current[next]?.focus();
          return next;
        });
      } else if (e.key === "c" && row && editable(row)) {
        e.preventDefault();
        setPickerFor(row.id);
      } else if (e.key === "x" && row && pick && !isLocked(row)) {
        e.preventDefault();
        toggleRow(row.id);
      } else if ((e.key === "Enter" || e.key === "e") && row) {
        e.preventDefault();
        openDrawer(row);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const unlocked = rows.filter((r) => !isLocked(r));
  const pageAllSelected = unlocked.length > 0 && unlocked.every((r) => selected.has(r.id));
  const selectedCount = allMatching ? total : selected.size;
  const selectedNet = allMatching ? matchingNet : sumCents(rows.filter((r) => selected.has(r.id)).map((r) => r.amount_cents));
  const accountLabel = (id: string) => moneyAccounts.find((a) => a.id === id)?.name ?? names[id] ?? "";
  const selectAllBox = pick && (
    <Checkbox aria-label="Select all on this page" checked={pageAllSelected || allMatching}
      indeterminate={!pageAllSelected && !allMatching && selected.size > 0} disabled={off || unlocked.length === 0}
      onCheckedChange={(c) => { setAllMatching(false); setSelected(c ? new Set(unlocked.map((r) => r.id)) : new Set()); }} />
  );

  return (
    <div className="space-y-4">
      <div className="surface overflow-hidden" data-testid="transactions-card">
        {header}

        {pick && selectedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-3 bg-brand-soft px-5 py-2" data-testid="bulk-bar">
            {selectAllBox}
            <span className="text-sm font-medium text-brand"><span data-testid="selected-count">{selectedCount}</span> selected</span>
            {!allMatching && total > selectedCount && (
              <button type="button" className="text-sm font-medium text-brand hover:underline" onClick={() => setAllMatching(true)}>
                Select all {total}
              </button>
            )}
            <span className="flex-1" />
            {deletedView ? (
              <Button size="sm" disabled={pending || allMatching} onClick={runBulkRestore}><RotateCcw aria-hidden /> Restore</Button>
            ) : (
              <>
                <CategoryPicker
                  trigger={<Button size="sm" variant="outline" disabled={pending}>Set category</Button>}
                  options={options} recentIds={recentIds} value={null} onSelect={runBulk} onCreate={create}
                />
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirmDelete(true)}>Delete</Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
            {!deletedView && !allMatching && selectedSuggestions.length > 0 && (
              <Button size="sm" disabled={pending} onClick={runAccept} data-testid="accept-selected">
                Accept {selectedSuggestions.length} suggestion{selectedSuggestions.length === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="border-t p-10 text-center text-sm text-muted-foreground" data-testid="empty-list">
            {deletedView ? "Nothing deleted matches these filters." : "No transactions match these filters."}
          </p>
        ) : (
          <table className="w-full text-sm" aria-label="Transactions" aria-rowcount={total}>
            <thead className={cn(pick && selectedCount > 0 && "sr-only")}>
              <tr className="border-y text-left text-[13px] text-muted-foreground [&_th]:h-9 [&_th]:font-normal">
                {pick && <th className="w-12 pl-5">{selectedCount === 0 && selectAllBox}</th>}
                <th className={cn("hidden w-20 px-3 sm:table-cell", !pick && "pl-5")}>Date</th>
                <th className={cn("px-3", !pick && "pl-5 sm:pl-3")}>Description</th>
                <th className="hidden px-3 lg:table-cell">Account</th>
                <th className="hidden px-3 sm:table-cell">Category</th>
                <th className="hidden px-3 md:table-cell">Status</th>
                <th className="pr-5 pl-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const desc = r.description_clean || r.description_raw;
                const locked = isLocked(r);
                const s = !r.category_account_id ? suggestions[r.id] : undefined;
                const status = txnStatus(r.category_account_id, s?.confidence, r.category_source);
                const categoryName = r.category_account_id ? names[r.category_account_id] : "Uncategorized";
                const checked = (allMatching && !locked) || selected.has(r.id);
                const picker = (trigger: ReactElement) => (
                  <CategoryPicker open={pickerFor === r.id} onOpenChange={(o) => setPickerFor(o ? r.id : null)}
                    trigger={trigger} options={options} recentIds={recentIds} value={r.category_account_id}
                    excludeId={r.money_account_id} onSelect={(c) => categorize(r.id, c)} onCreate={create}
                    suggested={s ? { id: s.category_account_id, name: s.category_name, confidence: s.confidence,
                      runnerUp: s.runner_up_id && s.runner_up_name ? { id: s.runner_up_id, name: s.runner_up_name } : null } : undefined} />
                );
                return (
                  <tr key={r.id} ref={(el) => { rowRefs.current[i] = el; }} tabIndex={i === active ? 0 : -1}
                    onFocus={() => setActive(i)} data-testid="txn-row" data-id={r.id} data-locked={locked || undefined}
                    data-status={status} aria-selected={checked}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("button, a, input, [role=checkbox], [data-slot=popover-content]")) return;
                      openDrawer(r);
                    }}
                    className={cn("h-[52px] cursor-pointer border-b outline-none last:border-b-0 hover:bg-surface-muted/60 focus-visible:bg-surface-muted",
                      checked && "bg-brand-soft hover:bg-brand-soft", deletedView && "text-muted-foreground")}>
                    {pick && (
                      <td className="pl-5">
                        <Checkbox aria-label={`Select ${desc}`} checked={checked} disabled={off || locked} onCheckedChange={() => toggleRow(r.id)} />
                      </td>
                    )}
                    <td className={cn("hidden whitespace-nowrap px-3 text-muted-foreground tabular-nums sm:table-cell", !pick && "pl-5")}>
                      <span className="inline-flex items-center gap-1.5">
                        <time dateTime={r.date} title={r.date}>{shortDate(r.date)}</time>
                        {locked && (
                          <Tooltip>
                            <TooltipTrigger render={<span tabIndex={0} className="text-muted-foreground" data-testid="lock-icon" />}>
                              <Lock className="size-3.5" aria-label="Locked" />
                            </TooltipTrigger>
                            <TooltipContent>
                              Books are closed through {lockDate}. An owner can change that date in Settings.
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                    </td>
                    <td className={cn("w-full max-w-0 px-3 py-2 sm:w-auto sm:py-0 lg:w-[40%]", !pick && "pl-5 sm:pl-3")}>
                      <span className="flex min-w-0 items-center gap-3">
                        <VendorAvatar name={r.vendor_normalized || desc} className="size-7 text-[10px]" />
                        <span className="min-w-0">
                          <button type="button" disabled={off} onClick={() => openDrawer(r)} title={r.description_raw}
                            className="block max-w-full truncate text-left font-medium outline-none hover:underline focus-visible:underline" aria-label={`Open ${desc}`}>
                            {desc}
                          </button>
                          {r.vendor_normalized && <span className="hidden truncate text-xs text-muted-foreground sm:block">{r.vendor_normalized}</span>}
                          {/* Phones: date and category under the description (their columns are hidden). */}
                          <span className="block truncate text-xs text-muted-foreground sm:hidden" data-testid="mobile-meta">
                            {shortDate(r.date)} ·{" "}
                            <span className={cn(!r.category_account_id && "text-attention-text")}>
                              {matches[r.id] ? `Transfer ⇄ ${matches[r.id].otherAccount}` : r.category_account_id ? categoryName : s ? `${s.category_name}?` : "Needs a category"}
                            </span>
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="hidden max-w-44 truncate px-3 lg:table-cell">{accountLabel(r.money_account_id)}</td>
                    <td className="hidden px-3 sm:table-cell" data-testid="category-cell">
                      {matches[r.id] ? (
                        <MatchedChip businessId={businessId} match={matches[r.id]} canWrite={canWrite && !isLocked(r)} />
                      ) : s && editable(r) ? (
                        <>
                          <SuggestionChip s={s} disabled={off || pending} onAccept={() => decide(r, s, true)} onReject={() => decide(r, s, false)} onOpen={() => setPickerFor(r.id)} />
                          {pickerFor === r.id && picker(<span aria-hidden className="inline-block h-6 w-0 align-middle" />)}
                        </>
                      ) : editable(r) ? (
                        picker(
                          <button type="button" disabled={off} aria-label={`Category for ${desc}: ${categoryName}`}
                            className={cn("-mx-2 max-w-48 truncate rounded-full px-2 py-1 text-left outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring",
                              !r.category_account_id && "text-attention-text")}>
                            {r.category_account_id ? categoryName : "Choose a category"}
                          </button>,
                        )
                      ) : (
                        <span className={cn(!r.category_account_id && "text-attention-text")}>{categoryName}</span>
                      )}
                    </td>
                    <td className="hidden px-3 md:table-cell"><StatusChip status={status} /></td>
                    <td className="whitespace-nowrap pr-5 pl-3 text-right font-semibold" data-testid="amount">
                      <Money cents={r.amount_cents} tone="signed" signPositive />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {footer}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedCount} transaction{selectedCount === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription data-testid="delete-summary">
              {selectedCount} transaction{selectedCount === 1 ? "" : "s"} totaling {formatCents(selectedNet)}. They move to
              Deleted, where you can restore them, and you can undo for 10 seconds.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" disabled={pending} onClick={runBulkDelete}>Delete {selectedCount}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TransactionDrawer key={drawer.key} open={drawer.open} onOpenChange={(open) => setDrawer((d) => ({ ...d, open }))}
        businessId={businessId} transaction={drawer.row} moneyAccounts={moneyAccounts} options={options}
        recentIds={recentIds} names={names} canWrite={canWrite} lockDate={lockDate} today={today}
        suggestion={drawer.row ? suggestions[drawer.row.id] ?? null : null} initialMode={drawer.mode} />
    </div>
  );
}

/** "Oct 22" for this year, "Oct 22, 2025" otherwise. */
function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const thisYear = new Date().getUTCFullYear() === y;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}
