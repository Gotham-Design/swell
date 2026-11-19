"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TRACK = "inline-flex items-center rounded-full bg-surface-muted p-1";
const PILL = "inline-flex h-8 items-center rounded-full px-3.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ON = "bg-card font-medium text-foreground shadow-[0_1px_2px_rgb(15_31_23/0.08)]";
const OFF = "text-muted-foreground hover:text-foreground";

/** Pill tabs between sibling pages (a white pill on a muted track). */
export function SegmentedNav({ items, label }: { items: { href: string; label: ReactNode; active: boolean; testId?: string }[]; label: string }) {
  return (
    <nav aria-label={label} className={TRACK}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.active ? "page" : undefined} data-testid={i.testId}
          className={cn(PILL, i.active ? ON : OFF)}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** The same look for in-page state (radio-like). */
export function PillTabs<T extends string>({ value, onChange, options, label, disabled }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={TRACK}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={disabled}
          onClick={() => onChange(o.value)} className={cn(PILL, value === o.value ? ON : OFF)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
