"use client";

import { useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useHydrated } from "@/components/submit-button";
import {
  BS_COMPARE, BS_COMPARE_LABEL, PNL_COMPARE, PNL_COMPARE_LABEL, PNL_PRESETS, PNL_PRESET_LABEL,
  bsQuery, pnlQuery, type BsCompare, type BsParams, type PnlCompare, type PnlParams, type PnlPreset,
} from "@/lib/reports/periods";
import { cn } from "@/lib/utils";

/** P&L period and comparison in one header button ("October 2026"). Every change rewrites the URL. */
export function PnlControls({ params, label, fiscalNote }: {
  params: Pick<PnlParams, "preset" | "from" | "to" | "compare" | "range">;
  label: string;
  fiscalNote?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const off = !useHydrated();
  const [open, setOpen] = useState(false);
  const apply = (patch: Partial<PnlParams>) => { setOpen(false); router.push(`${pathname}${pnlQuery({ ...params, ...patch })}`); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" disabled={off} data-testid="report-controls" aria-label={`Period: ${label}`} />}>
        {label} <ChevronDown className="text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <ul role="listbox" aria-label="Period">
          {PNL_PRESETS.filter((p) => p !== "custom").map((p) => (
            <li key={p}>
              <button type="button" role="option" aria-selected={params.preset === p} onClick={() => apply({ preset: p as PnlPreset })}
                className={cn("w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-muted", params.preset === p && "font-medium text-brand")}>
                {PNL_PRESET_LABEL[p]}
              </button>
            </li>
          ))}
        </ul>
        <form className="space-y-2 border-t pt-3" onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          apply({ preset: "custom", from: String(fd.get("from") || params.range.from), to: String(fd.get("to") || params.range.to) });
        }}>
          <p className="text-xs font-medium text-muted-foreground">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <Input name="from" type="date" aria-label="From" defaultValue={params.from ?? params.range.from} className="h-8 rounded-lg px-2 text-xs" />
            <Input name="to" type="date" aria-label="To" defaultValue={params.to ?? params.range.to} className="h-8 rounded-lg px-2 text-xs" />
          </div>
          <Button type="submit" size="sm" variant="outline" className="w-full">Apply range</Button>
        </form>
        <div className="space-y-1 border-t pt-3">
          <label htmlFor="r-cmp" className="text-xs font-medium text-muted-foreground">Compare with</label>
          <NativeSelect id="r-cmp" value={params.compare} onChange={(e) => apply({ compare: e.target.value as PnlCompare })}>
            {PNL_COMPARE.map((c) => <option key={c} value={c}>{PNL_COMPARE_LABEL[c]}</option>)}
          </NativeSelect>
        </div>
        {fiscalNote && <p className="text-xs text-muted-foreground">{fiscalNote}</p>}
      </PopoverContent>
    </Popover>
  );
}

/** Balance sheet as-of date and comparison, in one header button ("Oct 31, 2026"). */
export function BalanceSheetControls({ params, today, label }: { params: Pick<BsParams, "asOf" | "compare" | "cmpDate">; today: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const off = !useHydrated();
  const [open, setOpen] = useState(false);
  const apply = (patch: Partial<BsParams>) => { setOpen(false); router.push(`${pathname}${bsQuery({ ...params, ...patch }, today)}`); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" disabled={off} data-testid="report-controls" aria-label={`As of ${label}`} />}>
        {label} <ChevronDown className="text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <form className="space-y-2" onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          apply({ asOf: String(fd.get("asof") || params.asOf), cmpDate: String(fd.get("cmp_date") || "") || params.cmpDate });
        }}>
          <label htmlFor="r-asof" className="text-xs font-medium text-muted-foreground">As of</label>
          <Input id="r-asof" name="asof" type="date" defaultValue={params.asOf} className="h-9 rounded-lg" />
          <label htmlFor="r-cmp" className="block pt-1 text-xs font-medium text-muted-foreground">Compare with</label>
          <NativeSelect id="r-cmp" name="cmp" value={params.compare} onChange={(e) => apply({ compare: e.target.value as BsCompare })}>
            {BS_COMPARE.map((c) => <option key={c} value={c}>{BS_COMPARE_LABEL[c]}</option>)}
          </NativeSelect>
          {params.compare === "custom" && (
            <>
              <label htmlFor="r-cmp-date" className="block pt-1 text-xs font-medium text-muted-foreground">Comparison date</label>
              <Input id="r-cmp-date" name="cmp_date" type="date" defaultValue={params.cmpDate ?? ""} className="h-9 rounded-lg" />
            </>
          )}
          <Button type="submit" size="sm" variant="outline" className="w-full">Apply</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
