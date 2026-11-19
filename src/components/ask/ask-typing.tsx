"use client";

import { CornerDownLeft, Landmark, Loader2, Sparkles, Store, Tag } from "lucide-react";
import { formatCents } from "@/lib/money";
import type { AskParse, AskSuggestion } from "@/lib/search/parse";
import { cn } from "@/lib/utils";

export type TypingEntry = { kind: "ask"; text: string } | { kind: "entity"; suggestion: AskSuggestion };

/** What the words have been read as so far, as small chips. */
function Understood({ parse }: { parse: AskParse }) {
  const q = parse.query;
  const chips = [
    q.measure === "spend" && "Money out",
    q.measure === "earn" && "Money in",
    q.vendor && q.vendor.label,
    q.category && q.category.name,
    q.account && q.account.name,
    q.range && q.range.label.replace(/^the /, "").replace(/^\w/, (c) => c.toUpperCase()),
    q.uncategorized && "Uncategorized",
    q.min !== undefined && `Over ${formatCents(q.min)}`,
    q.max !== undefined && `Under ${formatCents(q.max)}`,
    q.search && `“${q.search}”`,
  ].filter(Boolean) as string[];
  if (!chips.length) return null;
  return (
    <span className="block truncate text-xs text-muted-foreground">{chips.join(" · ")}</span>
  );
}

/** While typing: ask the whole thing, or finish a vendor, category or account name. */
export function AskTyping({ entries, active, onPick, onHover, parse, smart, asking }: {
  entries: TypingEntry[]; active: number; onPick: (i: number) => void; onHover: (i: number) => void;
  parse: AskParse | null; smart: boolean; asking: boolean;
}) {
  return (
    <ul className="p-3 md:p-4" role="listbox" aria-label="Suggestions" data-testid="ask-typing">
      {entries.map((e, i) => {
        const on = i === active;
        if (e.kind === "ask") {
          return (
            <li key="ask" role="option" aria-selected={on}>
              <button type="button" onClick={() => onPick(i)} onMouseEnter={() => onHover(i)}
                className={cn("flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left outline-none", on ? "bg-brand-soft" : "hover:bg-surface-muted")}>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-white">
                  {asking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">Ask: {e.text}</span>
                  {parse?.action ? (
                    <span className="block text-xs text-muted-foreground">Opens {parse.action === "report" ? "reports" : parse.action}</span>
                  ) : parse?.understood ? <Understood parse={parse} /> : (
                    <span className="block text-xs text-muted-foreground">{smart ? "Press enter and we'll work out what you mean" : "Searches every description for these words"}</span>
                  )}
                </span>
                <CornerDownLeft className="mt-2 size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          );
        }
        const s = e.suggestion;
        const Icon = s.kind === "vendor" ? Store : s.kind === "category" ? Tag : Landmark;
        const label = s.kind === "vendor" ? s.vendor.label : s.kind === "category" ? s.category.name : s.account.name;
        const detail = s.kind === "vendor" ? `Vendor · ${s.vendor.count} transaction${s.vendor.count === 1 ? "" : "s"}`
          : s.kind === "category" ? `Category · ${s.category.type}` : `Account${s.account.last4 ? ` · ··${s.account.last4}` : ""}`;
        return (
          <li key={`${s.kind}-${label}`} role="option" aria-selected={on}>
            {i === 1 && <p className="mt-2 mb-1 px-3 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">DID YOU MEAN</p>}
            <button type="button" onClick={() => onPick(i)} onMouseEnter={() => onHover(i)}
              className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none", on ? "bg-surface-muted" : "hover:bg-surface-muted")}>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border text-muted-foreground"><Icon className="size-4" aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{label}</span>
                <span className="block text-xs text-muted-foreground">{detail}</span>
              </span>
              <kbd className="hidden rounded border px-1 text-[11px] text-muted-foreground sm:inline">tab</kbd>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
