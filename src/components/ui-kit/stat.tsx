import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One figure in a stat card: a small label, a large value and, optionally, a bar showing
 * its share of a whole (0–1) with a footnote under it.
 */
export function Stat({ label, value, spoken, share, tone = "green", foot, testId, className }: {
  label: string; value: string; spoken?: string; share?: number; tone?: "green" | "red" | "violet" | "amber";
  foot?: ReactNode; testId?: string; className?: string;
}) {
  const pct = share === undefined ? null : Math.round(Math.max(0, Math.min(1, share)) * 100);
  const bar = { green: "from-money-in to-money-in/60", red: "from-rose-500 to-rose-300", violet: "from-brand to-brand/50", amber: "from-amber-500 to-amber-300" }[tone];
  return (
    <div className="min-w-0 space-y-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-2xl font-semibold tabular-nums tracking-tight sm:text-[28px]", className)} data-testid={testId} aria-label={spoken}>
        {value}
      </dd>
      {pct !== null && (
        <dd className="h-2 w-full max-w-56 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className={cn("h-full rounded-full bg-gradient-to-r", bar)} style={{ width: `${pct}%` }} />
        </dd>
      )}
      {foot && <dd className="text-sm text-muted-foreground">{foot}</dd>}
    </div>
  );
}
