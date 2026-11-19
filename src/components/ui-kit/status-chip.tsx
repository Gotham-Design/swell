import type { ReactNode } from "react";
import { STATUS_LABEL, type TxnStatus } from "@/lib/transactions/status";
import { cn } from "@/lib/utils";

const TONE = {
  suggested: "bg-brand-soft text-brand",
  review: "bg-attention-soft text-attention-text",
  categorized: "bg-money-in-soft text-money-in-text",
  auto: "bg-brand-soft text-brand",
  neutral: "bg-surface-muted text-foreground",
  danger: "bg-money-out-soft text-money-out-text",
} as const;

export type ChipTone = keyof typeof TONE;

/** A small status pill: Suggested / Needs review / Categorized, or any tone with a label. */
export function Chip({ tone, children, className, testId }: { tone: ChipTone; children: ReactNode; className?: string; testId?: string }) {
  return (
    <span data-testid={testId}
      className={cn("inline-flex h-5 items-center whitespace-nowrap rounded-md px-1.5 text-xs font-medium", TONE[tone], className)}>
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: TxnStatus }) {
  return <Chip tone={status} testId="status-chip">{STATUS_LABEL[status]}</Chip>;
}
