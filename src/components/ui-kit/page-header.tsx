import type { ReactNode } from "react";

/** Page title (26/600, tight) with an optional line above or below, and actions on the right. */
export function PageHeader({ title, eyebrow, subtitle, actions }: {
  title: ReactNode; eyebrow?: ReactNode; subtitle?: ReactNode; actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[13px] text-muted-foreground">{eyebrow}</p>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A white card with an optional title row: 1px border, radius 16, padding 20. */
export function Card({ title, actions, children, className, testId, padded = true }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; testId?: string; padded?: boolean;
}) {
  return (
    <section className={`surface ${padded ? "p-5" : ""} ${className ?? ""}`} data-testid={testId}>
      {(title || actions) && (
        <div className={`flex items-center justify-between gap-3 ${padded ? "mb-4" : "px-5 pt-5 pb-4"}`}>
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
