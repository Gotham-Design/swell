"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { SearchField } from "@/components/ui-kit/search-field";
import type { PickerOption } from "@/lib/dal";
import {
  DATE_PRESETS, DATE_PRESET_LABEL, hasActiveFilters, toQueryString, type CategorizedBy, type DatePreset, type Filters, type TypeFilter,
} from "@/lib/transactions/filters";
import { TYPE_LABEL, type AccountType } from "@/lib/validation/accounts";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/components/submit-button";

/** The list's tabs, as the `type` filter: To review = uncategorized (pending suggestion or none). */
export const TABS: { key: string; label: string; types: TypeFilter[]; by?: CategorizedBy[] }[] = [
  { key: "all", label: "All", types: [] },
  { key: "review", label: "To review", types: ["uncategorized"] },
  { key: "auto", label: "Auto-filed", types: [], by: ["ai"] },
  { key: "in", label: "Money in", types: ["income"] },
  { key: "out", label: "Money out", types: ["expense"] },
];
export function activeTab(f: Filters) {
  return TABS.find((t) => t.types.join() === f.types.join() && (t.by ?? []).join() === f.categorizedBy.join())?.key ?? null;
}

/** Toolbar inside the list card: pill tabs, search, account and category filters, more, export. */
export function FilterBar({ filters, categories, moneyAccounts, toReview, exportHref }: {
  filters: Filters;
  categories: PickerOption[];
  moneyAccounts: { id: string; name: string }[];
  toReview: number;
  exportHref: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const off = !useHydrated();
  const apply = (patch: Partial<Filters>) => router.push(`${pathname}${toQueryString({ ...filters, ...patch, page: 1 })}`);
  const tab = activeTab(filters);

  const categoryGroups = (["income", "expense", "asset", "liability", "equity"] as AccountType[])
    .map((t) => ({ heading: TYPE_LABEL[t], items: categories.filter((c) => c.type === t && !c.is_money_account) }))
    .filter((g) => g.items.length);

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-4" data-testid="filters">
      <nav aria-label="Show" className="-mx-1 flex max-w-full items-center overflow-x-auto rounded-full bg-surface-muted p-1 [scrollbar-width:none] sm:mx-0 sm:inline-flex">
        {TABS.map((t) => (
          <Link key={t.key} href={`${pathname}${toQueryString({ ...filters, types: t.types, categorizedBy: t.by ?? [], page: 1 })}`}
            aria-current={tab === t.key ? "page" : undefined} data-testid={`tab-${t.key}`}
            className={cn("inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3 sm:px-3.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === t.key ? "bg-card font-medium shadow-[0_1px_2px_rgb(15_31_23/0.08)]" : "text-muted-foreground hover:text-foreground")}>
            {t.label}{t.key === "review" && toReview > 0 && <span className="ml-1 tabular-nums">· {toReview}</span>}
          </Link>
        ))}
      </nav>
      <span className="flex-1" />
      <SearchField key={filters.q} initial={filters.q} className="w-full sm:w-64"
        action={(q) => `${pathname}${toQueryString({ ...filters, q, page: 1 })}`} />
      <MultiSelect label="Account" allLabel="All accounts" testId="f-account" selected={filters.accounts} disabled={off}
        groups={[{ heading: "Money accounts", items: moneyAccounts }]} onChange={(accounts) => apply({ accounts })} />
      <MultiSelect label="Category" allLabel="All categories" testId="f-category" selected={filters.categories} disabled={off}
        groups={categoryGroups} onChange={(categories) => apply({ categories })} />
      <MoreFilters filters={filters} disabled={off} apply={apply} clear={() => router.push(pathname)} />
      <Button variant="outline" nativeButton={false} render={<a href={exportHref} data-testid="export-csv" />}>Export</Button>
    </div>
  );
}

/** Period select in the page header: presets plus a custom range. */
export function PeriodSelect({ filters, label }: { filters: Filters; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const off = !useHydrated();
  const [open, setOpen] = useState(false);
  const go = (patch: Partial<Filters>) => { setOpen(false); router.push(`${pathname}${toQueryString({ ...filters, ...patch, page: 1 })}`); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" disabled={off} data-testid="period-select" aria-label={`Period: ${label}`} />}>
        {label} <ChevronDown className="text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <ul role="listbox" aria-label="Period">
          {DATE_PRESETS.filter((p) => p !== "custom").map((p) => (
            <li key={p}>
              <button type="button" role="option" aria-selected={filters.preset === p} onClick={() => go({ preset: p as DatePreset })}
                className={cn("w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-muted", filters.preset === p && "font-medium text-brand")}>
                {DATE_PRESET_LABEL[p]}
              </button>
            </li>
          ))}
        </ul>
        <form className="mt-1 space-y-2 border-t p-2" onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          go({ preset: "custom", from: String(fd.get("from") || "") || null, to: String(fd.get("to") || "") || null });
        }}>
          <p className="text-xs font-medium text-muted-foreground">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <Input name="from" type="date" aria-label="From" defaultValue={filters.from ?? ""} className="h-8 rounded-lg px-2 text-xs" />
            <Input name="to" type="date" aria-label="To" defaultValue={filters.to ?? ""} className="h-8 rounded-lg px-2 text-xs" />
          </div>
          <Button type="submit" size="sm" variant="outline" className="w-full">Apply range</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function MoreFilters({ filters, disabled, apply, clear }: {
  filters: Filters; disabled: boolean; apply: (patch: Partial<Filters>) => void; clear: () => void;
}) {
  const [min, setMin] = useState(filters.min);
  const [max, setMax] = useState(filters.max);
  const extra = (filters.min || filters.max ? 1 : 0) + (filters.deleted ? 1 : 0);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="icon" className="relative" disabled={disabled} aria-label={`More filters${extra ? ` (${extra} on)` : ""}`} data-testid="more-filters" />}>
        <SlidersHorizontal aria-hidden />
        {extra > 0 && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand" aria-hidden />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-4">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); apply({ min: min.trim(), max: max.trim() }); }}>
          <p className="text-sm font-medium">Amount</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="f-min" className="text-xs text-muted-foreground">From</Label>
              <Input id="f-min" inputMode="decimal" placeholder="0.00" value={min} onChange={(e) => setMin(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-max" className="text-xs text-muted-foreground">To</Label>
              <Input id="f-max" inputMode="decimal" placeholder="any" value={max} onChange={(e) => setMax(e.target.value)} />
            </div>
          </div>
          <Button type="submit" size="sm" variant="outline" className="w-full">Apply</Button>
        </form>
        <label className="flex items-center gap-2 border-t pt-3 text-sm">
          <input type="checkbox" checked={filters.deleted} onChange={(e) => apply({ deleted: e.target.checked })} />
          Show deleted transactions
        </label>
        {hasActiveFilters(filters) && (
          <Button size="sm" variant="ghost" className="w-full" onClick={() => { setMin(""); setMax(""); clear(); }}>Clear all filters</Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MultiSelect({ label, allLabel, testId, selected, groups, onChange, disabled }: {
  disabled?: boolean;
  label: string;
  allLabel: string;
  testId: string;
  selected: string[];
  groups: { heading: string; items: { id: string; name: string }[] }[];
  onChange: (ids: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const current = draft ?? selected;
  const names = new Map(groups.flatMap((g) => g.items.map((i) => [i.id, i.name] as const)));
  const summary = selected.length === 0 ? allLabel : selected.length === 1 ? names.get(selected[0]) ?? "1 selected" : `${selected.length} ${label.toLowerCase()}s`;
  return (
    <Popover onOpenChange={(open) => {
      if (open) setDraft(selected);
      else { if (draft && draft.join() !== selected.join()) onChange(draft); setDraft(null); }
    }}>
      <PopoverTrigger render={
        <Button variant="outline" className="max-w-48 justify-between" aria-label={`${label}: ${summary}`} data-testid={testId} disabled={disabled} />
      }>
        <span className="truncate">{summary}</span>
        <ChevronDown className="text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}s…`} />
          <CommandList className="max-h-72">
            <CommandEmpty>Nothing matches.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.heading} heading={g.heading}>
                {g.items.map((i) => (
                  <CommandItem key={i.id} value={`${i.name} ${i.id}`} data-checked={current.includes(i.id)}
                    onSelect={() => setDraft(current.includes(i.id) ? current.filter((x) => x !== i.id) : [...current, i.id])}>
                    {i.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        {current.length > 0 && (
          <div className="border-t p-1">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setDraft([])}>Clear selection</Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
