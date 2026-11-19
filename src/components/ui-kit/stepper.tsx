import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** "1 Upload — 2 Match columns — 3 Review": done steps get a check, the current one is evergreen. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Import steps" data-testid="stepper">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const on = n === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={on ? "step" : undefined}>
            {i > 0 && <span className={cn("h-px w-6 sm:w-8", done || on ? "bg-brand" : "bg-border")} aria-hidden />}
            <span className={cn("grid size-6 place-items-center rounded-full text-xs font-semibold",
              done || on ? "bg-brand text-brand-foreground" : "bg-surface-muted text-muted-foreground")}>
              {done ? <Check className="size-3.5" aria-label="Done" /> : n}
            </span>
            <span className={cn(on ? "font-medium text-foreground" : done ? "text-foreground" : "text-muted-foreground")}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export const IMPORT_STEPS = ["Upload", "Match columns", "Review"];
