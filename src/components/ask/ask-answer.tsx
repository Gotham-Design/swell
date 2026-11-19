"use client";

import { useState, useTransition } from "react";
import { ArrowUpRight, Download, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CategoryPicker } from "@/components/transactions/category-picker";
import { SuggestionChip } from "@/components/transactions/suggestion-chip";
import { announceMatched } from "@/components/transactions/matched-toast";
import { Money } from "@/components/ui-kit/money";
import { VendorAvatar } from "@/components/ui-kit/vendor-avatar";
import { categorizeOne, quickCreateCategory } from "@/app/b/[businessId]/transactions/actions";
import { acceptSuggestion, acceptSuggestions } from "@/app/b/[businessId]/transactions/ai-actions";
import { makeVendorRule, type AskContext } from "@/app/b/[businessId]/ask/actions";
import type { AskAnswer, AskRow, BreakdownRow } from "@/lib/search/answer";
import type { AskQuery } from "@/lib/search/parse";
import { formatCents } from "@/lib/money";
import type { AccountType } from "@/lib/validation/accounts";
import { cn } from "@/lib/utils";

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/** The answer: a sentence with the number, a few bars, the rows (editable in place) and what to do next. */
export function AskAnswerView({ businessId, ctx, answer, query, busy, onRefresh, onNavigate, onRefine }: {
  businessId: string; ctx: AskContext; answer: AskAnswer; query: AskQuery; busy: boolean;
  onRefresh: () => void; onNavigate: (href: string) => void; onRefine: (q: AskQuery, label: string) => void;
}) {
  const [pending, start] = useTransition();
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const names = Object.fromEntries(ctx.options.map((o) => [o.id, o.name]));
  const off = !ctx.canWrite || pending;
  const maxBar = Math.max(1, ...answer.bars.map((b) => b.cents));

  const act = (fn: () => Promise<void>) => start(async () => { await fn(); onRefresh(); });
  const categorize = (row: AskRow, categoryId: string | null) => act(async () => {
    const r = await categorizeOne(businessId, row.id, categoryId);
    if (!r.ok) { toast.error(r.error); return; }
    if (categoryId) announceMatched(businessId, r.matched, names[categoryId]);
  });
  const accept = (suggestionId: string, name: string) => act(async () => {
    const r = await acceptSuggestion(businessId, suggestionId);
    if (!r.ok) { toast.error(r.error); return; }
    announceMatched(businessId, r.matched, name);
  });
  const acceptAll = () => act(async () => {
    const r = await acceptSuggestions(businessId, answer.accept.ids);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`Accepted ${r.count} suggestion${r.count === 1 ? "" : "s"}`);
  });
  const rule = () => answer.rule && act(async () => {
    const r = await makeVendorRule(businessId, answer.rule!.vendorKey, answer.rule!.categoryId);
    if (!r.ok) toast.error(r.error); else toast.success(r.message);
  });
  const create = async (name: string, type: AccountType) => {
    const r = await quickCreateCategory(businessId, name, type);
    return r.ok ? { id: r.id } : { error: r.error };
  };

  const categoryCell = (row: AskRow) => {
    const s = !row.category_account_id ? answer.suggestions[row.id] : undefined;
    const editable = ctx.canWrite && !row.locked;
    const picker = (trigger: React.ReactElement) => (
      <CategoryPicker open={pickerFor === row.id} onOpenChange={(o) => setPickerFor(o ? row.id : null)} trigger={trigger}
        options={ctx.options} recentIds={ctx.recentIds} value={row.category_account_id} excludeId={row.money_account_id}
        onSelect={(c) => categorize(row, c)} onCreate={create}
        suggested={answer.suggestions[row.id] && !row.category_account_id ? { id: answer.suggestions[row.id].category_account_id, name: answer.suggestions[row.id].category_name, confidence: answer.suggestions[row.id].confidence } : undefined} />
    );
    if (s && editable) {
      return (
        <span className="inline-flex items-center">
          <SuggestionChip s={s} disabled={off} onAccept={() => accept(s.id, s.category_name)} onReject={() => setPickerFor(row.id)} onOpen={() => setPickerFor(row.id)} />
          {pickerFor === row.id && picker(<span aria-hidden className="inline-block h-6 w-0 align-middle" />)}
        </span>
      );
    }
    const label = row.category_account_id ? names[row.category_account_id] ?? "Category" : "Choose a category";
    if (!editable) return <span className={cn("text-sm", !row.category_account_id && "text-attention-text")}>{label}</span>;
    return picker(
      <button type="button" disabled={off} aria-label={`Category for ${row.description}: ${label}`}
        className={cn("inline-flex h-8 max-w-48 items-center gap-1 truncate rounded-lg border bg-card px-2.5 text-sm outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring",
          !row.category_account_id && "border-attention text-attention-text")}>
        <span className="truncate">{label}</span>
        <svg viewBox="0 0 12 12" className="size-3 shrink-0 opacity-60" aria-hidden><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>,
    );
  };

  return (
    <div className={cn("grid md:grid-cols-[minmax(0,1fr)_320px]", busy && "opacity-70 transition-opacity")} data-testid="ask-answer">
      <section className="min-w-0 p-4 md:p-6">
        <div className="flex flex-col gap-4 rounded-2xl bg-brand-soft p-5 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-brand"><Sparkles className="size-3.5" aria-hidden /> Answer</p>
            <h2 className="mt-1 text-xl font-semibold leading-snug tracking-[-0.01em] sm:text-[22px]" data-testid="ask-headline">{answer.headline}</h2>
            {answer.details.length > 0 && <p className="mt-1 text-sm text-muted-foreground">{answer.details.join(" · ")}</p>}
          </div>
          {answer.bars.length > 0 && answer.bars.some((b) => b.cents > 0) && (
            <div className="flex shrink-0 items-end gap-3" aria-label="Last three months">
              {answer.bars.map((b, i) => (
                <div key={b.label} className="flex flex-col items-center gap-1">
                  <span className="text-[11px] font-medium tabular-nums">{formatCents(b.cents - (b.cents % 100)).replace(/\.00$/, "")}</span>
                  <span className={cn("w-7 rounded-md", i === answer.bars.length - 1 ? "bg-brand" : "bg-brand/30")}
                    style={{ height: `${Math.max(4, Math.round((b.cents / maxBar) * 48))}px` }} />
                  <span className="text-[11px] text-muted-foreground">{b.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {answer.breakdown ? (
          <Breakdown breakdown={answer.breakdown} onRefine={onRefine} />
        ) : (<>
        <div className="mt-5 mb-2 flex items-center justify-between gap-3">
          <h3 className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">TRANSACTIONS · {answer.count.toLocaleString("en-US")}</h3>
          {answer.count > 0 && (
            <button type="button" onClick={() => onNavigate(answer.href)} className="text-sm font-medium text-brand hover:underline">
              Open all in Transactions
            </button>
          )}
        </div>
        {answer.empty ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="ask-empty">
            Nothing matches that yet.
            {query.range && (
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => onRefine({ ...query, range: undefined }, `${query.vendor?.label ?? query.category?.name ?? query.search ?? "everything"} all time`)}>
                  Try all dates
                </Button>
              </div>
            )}
          </div>
        ) : (
          <ul className="divide-y rounded-xl border" data-testid="ask-rows">
            {answer.rows.map((r) => (
              <li key={r.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[56px_minmax(0,1fr)_auto_96px] sm:px-4",
                pickerFor === r.id && "bg-surface-muted")} data-testid="ask-row">
                <span className="hidden text-sm text-muted-foreground tabular-nums sm:block">{shortDate(r.date)}</span>
                <span className="flex min-w-0 items-center gap-2.5">
                  <VendorAvatar name={r.vendor || r.description} className="size-7 text-[10px] sm:hidden" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.description}</span>
                    <span className="block text-xs text-muted-foreground sm:hidden">{shortDate(r.date)}</span>
                  </span>
                </span>
                <span className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">{categoryCell(r)}</span>
                <Money cents={r.amount} tone="signed" signPositive className="col-start-2 row-start-1 text-right text-sm font-semibold sm:col-start-auto sm:row-start-auto" />
              </li>
            ))}
            {answer.count > answer.rows.length && (
              <li className="px-4 py-2.5 text-center text-sm">
                <button type="button" onClick={() => onNavigate(answer.href)} className="font-medium text-brand hover:underline">
                  See all {answer.count.toLocaleString("en-US")} in Transactions
                </button>
              </li>
            )}
          </ul>
        )}
        </>)}
      </section>

      <aside className="space-y-5 border-t p-4 md:border-t-0 md:border-l md:p-6">
        {(answer.vendor || answer.category) && (
          <div>
            <h3 className="mb-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
              {answer.vendor && answer.category ? "VENDOR & CATEGORY" : answer.vendor ? "VENDOR" : "CATEGORY"}
            </h3>
            <div className="space-y-2">
              {answer.vendor && (
                <button type="button" className="flex w-full items-center gap-3 rounded-xl border p-3 text-left hover:bg-surface-muted"
                  onClick={() => onRefine({ measure: query.measure, vendor: query.vendor }, `${answer.vendor!.label} all time`)}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-attention-soft text-xs font-semibold text-attention-text">{initials(answer.vendor.label)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{answer.vendor.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      Vendor · {answer.vendor.count} transaction{answer.vendor.count === 1 ? "" : "s"}{answer.vendor.avg ? ` · avg ${formatCents(answer.vendor.avg)}` : ""}
                    </span>
                  </span>
                </button>
              )}
              {answer.category && (
                <button type="button" className="flex w-full items-center gap-3 rounded-xl border p-3 text-left hover:bg-surface-muted"
                  onClick={() => onNavigate(`/b/${businessId}/categories?cat=${answer.category!.id}`)}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-money-in-soft text-xs font-semibold text-money-in-text">{initials(answer.category.name)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{answer.category.name}</span>
                    <span className="block text-xs text-muted-foreground">Category · {formatCents(answer.category.yearCents)} this year</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
        <div>
          <h3 className="mb-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">NEXT STEPS</h3>
          <div className="flex flex-col items-stretch gap-2">
            {ctx.canWrite && answer.accept.ids.length > 0 && (
              <Button disabled={off} onClick={acceptAll} data-testid="ask-accept-all">
                Accept {answer.accept.ids.length} suggestion{answer.accept.ids.length === 1 ? "" : "s"}
              </Button>
            )}
            {ctx.canWrite && answer.rule && (
              <Button variant="outline" disabled={off} onClick={rule} className="h-auto min-h-9 justify-start whitespace-normal py-2 text-left" data-testid="ask-rule">
                <Zap aria-hidden /> <span>Rule: {answer.rule.vendorLabel} → {answer.rule.categoryName}</span>
              </Button>
            )}
            {answer.count > 0 && (
              <Button variant="ghost" nativeButton={false} render={<a href={answer.exportHref} download />}>
                <Download aria-hidden /> Export these {answer.count.toLocaleString("en-US")}
              </Button>
            )}
            <Button variant="ghost" onClick={() => onNavigate(answer.href)}>
              <ArrowUpRight aria-hidden /> Open in Transactions
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

const BREAKDOWN_TITLE = { month: "BY MONTH", category: "BY CATEGORY", vendor: "BY VENDOR" } as const;

/** Totals by month, category or vendor, as bars; each row asks about just that one. */
function Breakdown({ breakdown, onRefine }: { breakdown: NonNullable<AskAnswer["breakdown"]>; onRefine: (q: AskQuery, label: string) => void }) {
  const max = Math.max(1, ...breakdown.rows.map((r) => r.cents));
  return (
    <div className="mt-5" data-testid="ask-breakdown">
      <h3 className="mb-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">{BREAKDOWN_TITLE[breakdown.kind]}</h3>
      <ul className="divide-y rounded-xl border">
        {breakdown.rows.map((r: BreakdownRow) => (
          <li key={r.key}>
            <button type="button" onClick={() => onRefine(r.refine, r.refineLabel)}
              className="grid w-full grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-surface-muted focus-visible:bg-surface-muted">
              <span className="min-w-0">
                <span className={cn("block truncate text-sm", r.top && "font-semibold")}>{r.label}</span>
                {r.detail && <span className="block truncate text-xs text-muted-foreground">{r.detail}</span>}
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <span className={cn("block h-full rounded-full", r.top ? "bg-brand" : "bg-brand/35")} style={{ width: `${Math.max(r.cents > 0 ? 2 : 0, Math.round((r.cents / max) * 100))}%` }} />
              </span>
              <Money cents={r.cents} className={cn("text-right text-sm tabular-nums", r.top && "font-semibold")} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
