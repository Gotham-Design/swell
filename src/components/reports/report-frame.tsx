import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui-kit/page-header";
import { SegmentedNav } from "@/components/ui-kit/segmented-nav";

/** Shared top of both reports: title, period + Export, the P&L / Balance sheet tabs and a note. */
export function ReportFrame({ businessId, active, controls, meta, children }: {
  businessId: string; active: "pnl" | "bs"; controls: ReactNode; meta: ReactNode; children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle="Statements your client can read, straight from the books." actions={controls} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedNav label="Reports" items={[
          { href: `/b/${businessId}/reports/pnl`, label: "Profit & Loss", active: active === "pnl", testId: "tab-pnl" },
          { href: `/b/${businessId}/reports/balance-sheet`, label: "Balance sheet", active: active === "bs", testId: "tab-bs" },
        ]} />
        <p className="text-[13px] text-muted-foreground" data-testid="report-period">{meta}</p>
      </div>
      {children}
    </div>
  );
}

/** A row of figure tiles with dividers. */
export function Tiles({ children, cols }: { children: ReactNode; cols: 3 | 4 }) {
  return <dl className={`surface grid sm:grid-cols-2 ${cols === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>{children}</dl>;
}
export function Tile({ label, value, foot, badge, testId }: { label: string; value: ReactNode; foot?: ReactNode; badge?: ReactNode; testId?: string }) {
  return (
    <div className="min-w-0 border-b px-5 py-4 sm:border-r lg:border-b-0 lg:last:border-r-0">
      <dt className="flex items-center gap-2 text-[13px] text-muted-foreground">{label}{badge}</dt>
      <dd className="mt-1 truncate text-[26px] font-semibold tracking-[-0.01em]" data-testid={testId}>{value}</dd>
      {foot && <dd className="mt-0.5 text-xs text-muted-foreground">{foot}</dd>}
    </div>
  );
}
