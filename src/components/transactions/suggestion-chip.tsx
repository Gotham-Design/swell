"use client";

import { Check, X } from "lucide-react";
import type { SuggestionChipData } from "@/lib/dal";
import { SUGGESTED_AT, pct } from "@/lib/transactions/status";
import { cn } from "@/lib/utils";

export { pct };

/**
 * A pending suggestion in the category cell: [Category NN% | ✓ ✕]. Evergreen outline when
 * Suggested (85%+), amber when it needs review. Focus the chip and press Enter to accept,
 * Backspace to choose another; ✕ opens the category picker (picking there decides the suggestion).
 */
export function SuggestionChip({ s, disabled, onAccept, onReject, onOpen }: {
  s: SuggestionChipData; disabled?: boolean; onAccept: () => void; onReject: () => void;
  /** Clicking the category name: open the picker (with this suggestion first). Defaults to accepting. */
  onOpen?: () => void;
}) {
  // A likely transfer or owner draw: the category guess means little, so ask the question instead.
  const transfer = s.flags.includes("possible transfer");
  const draw = s.flags.includes("possible owner draw");
  if ((transfer || draw) && s.confidence < 0.5) {
    const label = transfer && draw ? "Transfer or owner draw?" : transfer ? "Transfer?" : "Owner draw?";
    return (
      <button type="button" disabled={disabled} onClick={(e) => { e.stopPropagation(); onReject(); }} data-testid="suggestion-chip"
        aria-label={`${label} Choose where this money went.`}
        className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-attention bg-card px-2.5 text-xs font-medium text-attention-text outline-none hover:bg-attention-soft focus-visible:ring-2 focus-visible:ring-ring">
        {label}
      </button>
    );
  }
  const sure = s.confidence >= SUGGESTED_AT;
  const tone = sure ? "border-brand text-brand" : "border-attention text-attention-text";
  const hover = sure ? "hover:bg-brand-soft" : "hover:bg-attention-soft";
  return (
    <span className={cn("inline-flex h-6 max-w-full items-center rounded-full border bg-card text-xs", tone)} data-testid="suggestion"
      onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={disabled} data-testid="suggestion-chip"
        aria-label={`Suggested: ${s.category_name}, ${pct(s.confidence)}. Click to choose a category, Enter to accept.`}
        className={cn("inline-flex min-w-0 items-center gap-1.5 rounded-l-full py-0.5 pl-2 pr-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring", hover)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onAccept(); }
          else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); e.stopPropagation(); onReject(); }
        }}
        onClick={onOpen ?? onAccept}>
        <span className="truncate font-medium">{s.category_name}</span>
        {/* Under 50% it's a guess: say so rather than show a small number. */}
        <span className="tabular-nums">{s.confidence >= 0.5 ? pct(s.confidence) : "?"}</span>
      </button>
      <span className="h-3 w-px bg-current opacity-60" aria-hidden />
      <button type="button" disabled={disabled} onClick={onAccept} aria-label={`Accept ${s.category_name}`}
        className={cn("grid size-6 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", hover)}>
        <Check className="size-3.5" aria-hidden />
      </button>
      <button type="button" disabled={disabled} onClick={onReject} aria-label={`Reject ${s.category_name}`}
        className={cn("mr-0.5 grid size-6 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", hover)}>
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}
