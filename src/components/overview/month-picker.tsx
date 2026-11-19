"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** "Oct 2026" with a list of recent months; the choice lives in ?month=YYYY-MM. */
export function MonthPicker({ value, months, param = "month" }: { value: string; months: string[]; param?: string }) {
  const pathname = usePathname();
  const label = (m: string, long = false) => {
    const [y, mm] = m.split("-").map(Number);
    return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-US", { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" });
  };
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" aria-label={`Month: ${label(value, true)}`} data-testid="month-picker" />}>
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" strokeLinecap="round" />
        </svg>
        {label(value)}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <ul>
          {months.map((m) => (
            <li key={m}>
              <Link href={`${pathname}?${param}=${m}`} aria-current={m === value ? "true" : undefined}
                className={cn("block rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-muted", m === value && "font-medium text-brand")}>
                {label(m, true)}
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
