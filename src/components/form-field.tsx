import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** Label + control + hint/errors, wired up with ids for screen readers. */
export function Field({ label, htmlFor, hint, errors, children }: {
  label: string; htmlFor: string; hint?: ReactNode; errors?: string[]; children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && !errors?.length && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors?.map((e) => <p key={e} className="text-xs text-destructive" id={`${htmlFor}-error`}>{e}</p>)}
    </div>
  );
}

/** A read-only label/value pair, used where the viewer can't edit. */
export function ReadOnlyField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <div className="text-sm text-muted-foreground">{value || "—"}</div>
    </div>
  );
}
