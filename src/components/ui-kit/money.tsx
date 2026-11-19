import { formatCents, spokenCents, type Cents, type FormatOptions } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * An amount from cents. Always tabular figures and a spoken aria-label. `split` shows the
 * cents in muted grey, as on big amounts ($3,516 + .34); `tone` colours it by direction.
 */
export function Money({ cents, split = false, tone = "none", className, testId, ...opts }: {
  cents: Cents;
  split?: boolean;
  /** "signed": green when in, red when out. "in" / "out": force a colour. */
  tone?: "none" | "signed" | "in" | "out";
  className?: string;
  testId?: string;
} & FormatOptions) {
  const text = formatCents(cents, opts);
  const color = tone === "in" || (tone === "signed" && cents > 0) ? "text-money-in-text"
    : tone === "out" || (tone === "signed" && cents < 0) ? "text-money-out-text" : undefined;
  const dot = text.lastIndexOf(".");
  return (
    <span className={cn("tabular-nums whitespace-nowrap", color, className)} aria-label={spokenCents(cents)} data-testid={testId}>
      {split && dot > 0 ? (
        <>
          <span aria-hidden>{text.slice(0, dot)}</span>
          <span aria-hidden className="text-muted-foreground">{text.slice(dot)}</span>
        </>
      ) : (
        <span aria-hidden>{text}</span>
      )}
    </span>
  );
}
