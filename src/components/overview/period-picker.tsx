"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { COMPARES, PERIOD_LABEL, PERIOD_PRESETS, periodHref, type OverviewPeriod } from "@/lib/overview/period";
import { cn } from "@/lib/utils";

const SHORT = { none: "None", prev: "Previous period", yoy: "Last year" } as const;

const monthLabel = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

/** Period and comparison for the overview, like QuickBooks' report dates. Lives in the URL. */
export function PeriodPicker({ period, recent }: { period: OverviewPeriod; recent?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const href = (key: string, compare = period.compare) => periodHref(pathname, { key, compare }, { recent });
  const item = (key: string, label: string) => (
    <li key={key}>
      <Link href={href(key)} scroll={false} onClick={() => setOpen(false)} aria-current={key === period.key ? "true" : undefined}
        className={cn("block rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-muted", key === period.key && "bg-brand-soft font-medium text-brand")}>
        {label}
      </Link>
    </li>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" aria-label={`Period: ${period.short}`} data-testid="period-picker" />}>
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" strokeLinecap="round" />
        </svg>
        {period.short}
        {period.cmp && <span className="hidden text-muted-foreground sm:inline">· vs {period.compare === "yoy" ? "last year" : "prior"}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,26rem)] p-0">
        <div className="grid grid-cols-2 gap-1 p-2">
          <div>
            <p className="px-2.5 pt-1 pb-1 text-[11px] font-medium tracking-[0.06em] text-muted-foreground">PERIOD</p>
            <ul>{PERIOD_PRESETS.map((k) => item(k, PERIOD_LABEL[k]))}</ul>
          </div>
          <div>
            <p className="px-2.5 pt-1 pb-1 text-[11px] font-medium tracking-[0.06em] text-muted-foreground">MONTH</p>
            <ul className="max-h-72 overflow-y-auto">{period.months.map((m) => item(m, monthLabel(m)))}</ul>
          </div>
        </div>
        <div className="border-t p-2">
          <p className="px-2.5 pb-1.5 text-[11px] font-medium tracking-[0.06em] text-muted-foreground">COMPARE TO</p>
          <div className="flex gap-1 rounded-full bg-surface-muted p-1" role="group" aria-label="Compare to">
            {COMPARES.map((c) => (
              <Link key={c} href={href(period.key, c)} scroll={false} onClick={() => setOpen(false)} aria-current={c === period.compare ? "true" : undefined}
                className={cn("flex-1 rounded-full px-2 py-1 text-center text-xs", c === period.compare ? "bg-card font-medium shadow-[0_1px_2px_rgb(15_31_23/0.08)]" : "text-muted-foreground hover:text-foreground")}>
                {SHORT[c]}
              </Link>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
