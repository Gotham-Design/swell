"use client";

import { useState, type ReactElement } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import type { PickerOption } from "@/lib/dal";
import { ACCOUNT_TYPES, TYPE_LABEL, type AccountType } from "@/lib/validation/accounts";

export const UNCATEGORIZED = "__uncategorized__";

/** Picker groups: transfers (money accounts and the cash/card headers) get their own. */
function groupOf(o: PickerOption): string {
  if (o.is_money_account) return "Transfer to or from";
  return TYPE_LABEL[o.type as AccountType] ?? o.type;
}
const GROUP_ORDER = ["Expense", "Income", "Transfer to or from", "Asset", "Liability", "Equity"];

/**
 * Searchable category picker: recent categories first, then every active category
 * grouped by type, plus "Uncategorized" and "Create category …". Controlled `open` lets a
 * keyboard shortcut open it.
 */
export function CategoryPicker({
  trigger, options, recentIds, value, onSelect, onCreate, open, onOpenChange, excludeId, allowNone = true, suggested,
}: {
  /** The AI's pick (and runner-up), shown first so changing your mind is one click either way. */
  suggested?: { id: string; name: string; confidence: number; runnerUp?: { id: string; name: string } | null };
  trigger: ReactElement;
  options: PickerOption[];
  recentIds: string[];
  value: string | null;
  onSelect: (categoryId: string | null) => void;
  /** Create a category and return its id (or an error message). */
  onCreate?: (name: string, type: AccountType) => Promise<{ id: string } | { error: string }>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** A money account can't be its own category. */
  excludeId?: string;
  allowNone?: boolean;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = open ?? innerOpen;
  const setOpen = (o: boolean) => { onOpenChange?.(o); setInnerOpen(o); if (!o) { setSearch(""); setCreating(false); setError(null); } };
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState<AccountType>("expense");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const usable = options.filter((o) => o.id !== excludeId);
  const recent = recentIds.map((id) => usable.find((o) => o.id === id)).filter((o): o is PickerOption => !!o);
  const groups = GROUP_ORDER.map((g) => [g, usable.filter((o) => groupOf(o) === g)] as const).filter(([, list]) => list.length);
  const exact = usable.some((o) => o.name.toLowerCase() === search.trim().toLowerCase());

  const choose = (id: string | null) => { onSelect(id); setOpen(false); };

  const create = async () => {
    if (!onCreate) return;
    setBusy(true);
    setError(null);
    const r = await onCreate(search.trim(), newType);
    setBusy(false);
    if ("error" in r) setError(r.error);
    else choose(r.id);
  };

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent className="w-80 p-0" align="start">
        {creating ? (
          <div className="space-y-3 p-3" data-testid="create-category">
            <div className="text-sm font-medium">Create “{search.trim()}”</div>
            <label className="block space-y-1 text-sm">
              <span>Type</span>
              <NativeSelect aria-label="New category type" value={newType} onChange={(e) => setNewType(e.target.value as AccountType)}>
                {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </NativeSelect>
            </label>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Back</Button>
              <Button size="sm" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create and use"}</Button>
            </div>
          </div>
        ) : (
          <Command loop>
            <CommandInput placeholder="Search categories…" value={search} onValueChange={setSearch} autoFocus />
            <CommandList className="max-h-80">
              <CommandEmpty>No category matches.</CommandEmpty>
              {onCreate && search.trim() && !exact && (
                <CommandGroup>
                  <CommandItem value={`__create__ ${search}`} onSelect={() => setCreating(true)}>
                    <Plus aria-hidden /> Create category “{search.trim()}”
                  </CommandItem>
                </CommandGroup>
              )}
              {suggested && !search && (
                <>
                  <CommandGroup heading="Suggested">
                    <CommandItem value={`suggested ${suggested.name} ${suggested.id}`} onSelect={() => choose(suggested.id)} data-testid="picker-suggested">
                      <span className="flex-1">{suggested.name}</span>
                      {suggested.confidence >= 0.5 && <span className="text-xs tabular-nums text-muted-foreground">{Math.round(suggested.confidence * 100)}%</span>}
                    </CommandItem>
                    {suggested.runnerUp && (
                      <CommandItem value={`runner ${suggested.runnerUp.name} ${suggested.runnerUp.id}`} onSelect={() => choose(suggested.runnerUp!.id)}>
                        <span className="flex-1">{suggested.runnerUp.name}</span>
                        <span className="text-xs text-muted-foreground">next best</span>
                      </CommandItem>
                    )}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}
              {allowNone && (
                <CommandGroup>
                  <CommandItem value="Uncategorized" data-checked={value === null} onSelect={() => choose(null)}>
                    <span className="text-muted-foreground">Uncategorized</span>
                  </CommandItem>
                </CommandGroup>
              )}
              {recent.length > 0 && !search && (
                <>
                  <CommandGroup heading="Recent">
                    {recent.map((o) => (
                      <CommandItem key={`recent-${o.id}`} value={`recent ${o.name} ${o.id}`} data-checked={value === o.id} onSelect={() => choose(o.id)}>
                        {o.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}
              {groups.map(([heading, list]) => (
                <CommandGroup key={heading} heading={heading}>
                  {list.map((o) => (
                    <CommandItem key={o.id} value={`${o.name} ${o.id}`} keywords={[heading]} data-checked={value === o.id} onSelect={() => choose(o.id)}>
                      {o.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
