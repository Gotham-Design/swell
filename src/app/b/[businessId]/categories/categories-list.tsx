"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form-field";
import { ActionDialog } from "@/components/action-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Chip } from "@/components/ui-kit/status-chip";
import { Money } from "@/components/ui-kit/money";
import type { PickerOption } from "@/lib/dal";
import type { CategoryGroup, CategoryListRow } from "@/lib/dal-categories";
import { formatCents, spokenCents } from "@/lib/money";
import { TYPE_LABEL, type AccountType } from "@/lib/validation/accounts";
import type { FormState } from "@/lib/validation/business";
import { cn } from "@/lib/utils";
import { createCategory, mergeCategory, setArchived, updateCategory } from "./actions";

const SWATCH: Record<string, string> = {
  income: "bg-brand", expense: "bg-swatch-expense", other: "bg-swatch-other", transfer: "bg-swatch-transfer",
};

/** Header button: a new income or expense category. */
export function NewCategoryButton({ businessId, options }: { businessId: string; options: PickerOption[] }) {
  return (
    <ActionDialog triggerLabel="New category" triggerVariant="default" triggerSize="default"
      title="New category" description="It shows up in pickers right away, and on reports once it has transactions."
      submitLabel="Add category" action={createCategory.bind(null, businessId)} wide>
      {(state) => <CategoryFields state={state} options={options} />}
    </ActionDialog>
  );
}

/**
 * Every category grouped by type with this month's count, share of its group and total.
 * Unused categories fold away under "Show N unused". A row selects the detail panel (?cat=).
 */
export function CategoryTable({ groups, selectedId, hrefFor, monthName, usedCount }: {
  groups: CategoryGroup[]; selectedId: string | null; hrefFor: Record<string, string>; monthName: string; usedCount: number;
}) {
  const [showUnused, setShowUnused] = useState(false);
  const unused = groups.reduce((n, g) => n + g.rows.filter((r) => !r.used).length, 0);
  return (
    <section className="surface overflow-hidden" aria-labelledby="cat-title" data-testid="category-table">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <h2 id="cat-title" className="text-[15px] font-semibold">
          {usedCount} {usedCount === 1 ? "category" : "categories"} used in {monthName}
        </h2>
        <p className="text-xs text-muted-foreground">{monthName} totals</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm sm:min-w-[34rem]">
          <thead>
            <tr className="bg-surface-muted text-left text-xs uppercase tracking-[0.06em] text-muted-foreground [&_th]:h-10 [&_th]:font-medium">
              <th className="pl-5">Category</th>
              <th className="hidden px-3 text-right sm:table-cell">Count</th>
              <th className="hidden w-32 px-3 text-right sm:table-cell">Share</th>
              <th className="pr-5 text-right">{monthName}</th>
            </tr>
          </thead>
          {groups.map((g) => {
            const rows = g.rows.filter((r) => r.used || showUnused);
            if (rows.length === 0) return null;
            return (
              <tbody key={g.key} data-testid={`group-${g.key}`}>
                <tr className="border-t"><th colSpan={4} scope="rowgroup" className="py-3 pl-5 text-left text-sm font-semibold">{g.label}</th></tr>
                {rows.map((r) => (
                  <Row key={r.id} row={r} group={g.key} selected={r.id === selectedId} href={hrefFor[r.id]} />
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      {unused > 0 && (
        <button type="button" onClick={() => setShowUnused((s) => !s)} aria-expanded={showUnused}
          className="flex w-full items-center justify-center gap-1.5 border-t py-3 text-sm text-muted-foreground hover:text-foreground">
          {showUnused ? "Hide unused" : `Show ${unused} unused`}
          <ChevronDown className={cn("size-4 transition-transform", showUnused && "rotate-180")} aria-hidden />
        </button>
      )}
    </section>
  );
}

function Row({ row: r, group, selected, href }: { row: CategoryListRow; group: string; selected: boolean; href: string }) {
  return (
    <tr className={cn("border-t transition-colors [&_td]:py-2.5", selected ? "bg-brand-soft" : "hover:bg-surface-muted/60", !r.used && "text-muted-foreground")}
      data-testid="category-row" data-name={r.name}>
      <td className="pl-5">
        <Link href={href} scroll={false} aria-current={selected ? "true" : undefined}
          className="flex items-center gap-2.5 outline-none after:absolute after:inset-0 focus-visible:underline [tr:has(&)]:relative">
          <span className={cn("size-2 shrink-0 rounded-[2px]", SWATCH[group])} aria-hidden />
          <span className={cn(r.used && "text-foreground")}>{r.name}</span>
          {r.isNew && <Chip tone="review">New</Chip>}
          {group === "transfer" && <Chip tone="neutral">Not on reports</Chip>}
        </Link>
      </td>
      <td className="hidden px-3 text-right tabular-nums sm:table-cell">{r.count || "—"}</td>
      <td className="hidden px-3 sm:table-cell">
        {r.share !== null && r.used && (
          <span className="flex items-center justify-end gap-2">
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
              <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(r.share, 2)}%` }} />
            </span>
            <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{Math.round(r.share)}%</span>
          </span>
        )}
      </td>
      <td className="pr-5 text-right tabular-nums" aria-label={spokenCents(r.total)}>{r.used ? formatCents(r.total) : "—"}</td>
    </tr>
  );
}

const monthShort = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
const AVATAR = ["bg-attention-soft text-attention-text", "bg-money-in-soft text-money-in-text", "bg-[#E8F0FB] text-[#2459A8]"];
const initials = (s: string) => {
  const w = s.split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? w[0]?.[1] ?? "")).toUpperCase();
};

export type CategoryDetailData = {
  row: CategoryListRow; parentName: string | null; monthName: string; transactionsHref: string;
  months: { month: string; cents: number }[]; average: number; vendors: { name: string; cents: number; count: number }[];
};

/** The selected category: this month, its monthly average, six months of bars, top vendors. */
export function CategoryDetail({ data: d, businessId, options, canWrite }: {
  data: CategoryDetailData; businessId: string; options: PickerOption[]; canWrite: boolean;
}) {
  const hi = Math.max(1, ...d.months.map((m) => Math.abs(m.cents)));
  return (
    <aside className="surface p-5" aria-label={`${d.row.name} detail`} data-testid="category-detail">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold">{d.row.name}</h2>
          <p className="text-xs text-muted-foreground">
            {TYPE_LABEL[d.row.type as AccountType] ?? d.row.type}{d.parentName ? ` · ${d.parentName}` : ""}
          </p>
        </div>
        {canWrite && !d.row.isSystem && <EditMenu row={d.row} businessId={businessId} options={options} />}
      </div>
      {d.row.description && <p className="mt-2 text-sm text-muted-foreground">{d.row.description}</p>}

      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">{d.monthName}</p>
          <p className="text-[22px] font-semibold tracking-[-0.01em]"><Money cents={d.row.total} split /></p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Monthly average</p>
          <p className="text-[22px] font-semibold tracking-[-0.01em] text-muted-foreground"><Money cents={d.average} split /></p>
        </div>
      </div>

      <figure className="mt-4" aria-label={`${d.row.name} by month`}>
        <div className="flex h-14 items-end gap-1.5" aria-hidden>
          {d.months.map((m, i) => (
            <span key={m.month} className={cn("flex-1 rounded-[3px]", i === d.months.length - 1 ? "bg-brand" : "bg-bar-muted")}
              style={{ height: `${Math.max(6, (Math.abs(m.cents) / hi) * 100)}%` }} title={`${monthShort(m.month)}: ${formatCents(m.cents)}`} />
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5 text-[11px] text-muted-foreground" aria-hidden>
          {d.months.map((m) => <span key={m.month} className="flex-1 text-center">{monthShort(m.month)}</span>)}
        </div>
      </figure>

      <div className="mt-4 border-t pt-4">
        <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Top vendors</h3>
        {d.vendors.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing in {d.monthName} yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {d.vendors.map((v, i) => (
              <li key={v.name} className="flex items-center gap-3 py-1.5">
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold", AVATAR[i % AVATAR.length])} aria-hidden>
                  {initials(v.name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{v.name}</span>
                <span className="text-sm tabular-nums" aria-label={spokenCents(v.cents)}>{formatCents(v.cents)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href={d.transactionsHref} className="mt-3 inline-block text-sm font-medium hover:underline">
          {d.row.count === 1 ? "See the transaction" : d.row.count ? `See all ${d.row.count} transactions` : "See transactions"}
        </Link>
      </div>
    </aside>
  );
}

function EditMenu({ row, businessId, options }: { row: CategoryListRow; businessId: string; options: PickerOption[] }) {
  const [open, setOpen] = useState<"edit" | "merge" | null>(null);
  const [pending, start] = useTransition();
  const archive = () => start(async () => {
    const r = await setArchived(businessId, row.id, true);
    if (r.error) toast.error(r.error); else if (r.message) toast.success(r.message);
  });
  const mergeTargets = options.filter((o) => o.type === row.type && !o.is_money_account && o.id !== row.id);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={pending} aria-label={`Edit ${row.name}`} />}>
          Edit
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={() => setOpen("edit")}>Rename or move</DropdownMenuItem>
          {mergeTargets.length > 0 && <DropdownMenuItem onClick={() => setOpen("merge")}>Merge into…</DropdownMenuItem>}
          <DropdownMenuItem onClick={archive}>Archive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ActionDialog open={open === "edit"} onOpenChange={(o) => setOpen(o ? "edit" : null)} title={`Edit ${row.name}`} submitLabel="Save"
        action={updateCategory.bind(null, businessId, row.id)} wide>
        {(state) => <CategoryFields state={state} options={options} row={row} />}
      </ActionDialog>
      <ActionDialog open={open === "merge"} onOpenChange={(o) => setOpen(o ? "merge" : null)} title={`Merge ${row.name} into…`}
        description={`Every transaction on ${row.name} moves to the category you pick, then ${row.name} is archived.`}
        submitLabel="Merge" pendingText="Merging…" action={mergeCategory.bind(null, businessId, row.id)}>
        {(state) => (
          <Field label="Merge into" htmlFor={`into-${row.id}`} errors={state.fieldErrors?.into}>
            <NativeSelect id={`into-${row.id}`} name="into" defaultValue="" required>
              <option value="" disabled>Pick a category</option>
              {mergeTargets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </NativeSelect>
          </Field>
        )}
      </ActionDialog>
    </>
  );
}

/** Archived categories, folded at the bottom, each with Restore. */
export function ArchivedCategories({ businessId, rows, canWrite }: {
  businessId: string; rows: { id: string; name: string; type: string }[]; canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <details className="surface px-5 py-3 text-sm" data-testid="archived">
      <summary className="cursor-pointer text-muted-foreground">{rows.length} archived</summary>
      <ul className="mt-2 divide-y">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-2">
            <span>{r.name} <span className="text-xs text-muted-foreground">· {TYPE_LABEL[r.type as AccountType] ?? r.type}</span></span>
            {canWrite && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => {
                const res = await setArchived(businessId, r.id, false);
                if (res.error) toast.error(res.error); else if (res.message) toast.success(res.message);
              })}>Restore</Button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function CategoryFields({ state, options, row }: { state: FormState; options: PickerOption[]; row?: CategoryListRow }) {
  const e = state.fieldErrors;
  const [type, setType] = useState<string>(row?.type ?? "expense");
  // Parents: same type, not money accounts, not itself.
  const parents = options.filter((o) => !o.is_money_account && o.id !== row?.id && o.type === type);
  return (
    <div className="space-y-4">
      <Field label="Name" htmlFor="cat-name" errors={e?.name}>
        <Input id="cat-name" name="name" required maxLength={100} defaultValue={row?.name} aria-invalid={!!e?.name} />
      </Field>
      {!row && (
        <Field label="Type" htmlFor="cat-type" errors={e?.type} hint="Income or expense decides where it lands on the P&L.">
          <NativeSelect id="cat-type" name="type" value={type} onChange={(ev) => setType(ev.target.value)}>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </NativeSelect>
        </Field>
      )}
      <Field label="Group under (optional)" htmlFor="cat-parent" errors={e?.parent_id} hint="Shows it inside another category on reports.">
        <NativeSelect id="cat-parent" name="parent_id" defaultValue={row?.parentId ?? ""}>
          <option value="">Nothing</option>
          {parents.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Description" htmlFor="cat-desc" errors={e?.description} hint="One line on what belongs here. Suggestions use it.">
        <Textarea id="cat-desc" name="description" rows={2} maxLength={500} defaultValue={row?.description ?? ""} />
      </Field>
    </div>
  );
}
