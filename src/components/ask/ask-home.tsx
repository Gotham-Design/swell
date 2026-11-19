"use client";

import { ChartLine, Clock, FileUp, Lightbulb, ListChecks, Plus, Sparkles, Zap } from "lucide-react";
import type { AskHomeItem } from "@/lib/search/answer";
import { cn } from "@/lib/utils";

export type HomeEntry = { kind: "home"; item: AskHomeItem } | { kind: "recent" | "try"; text: string };

/** Shown until someone has asked their own questions. */
export const TRY_ASKING = ["How much did we spend on software this year?", "Uncategorized over $500", "What came in last month?", "Insurance in Q3"];

const ICON = { review: Sparkles, import: FileUp, pnl: ChartLine, note: Lightbulb } as const;
const TONE = {
  review: "bg-brand-soft text-brand", import: "bg-attention-soft text-attention-text",
  pnl: "bg-money-in-soft text-money-in-text", note: "bg-money-out-soft text-money-out-text",
} as const;

const SHORTCUTS = [
  { action: "import", word: "import", label: "Import a statement", icon: FileUp, write: true },
  { action: "review", word: "review", label: "Review suggestions", icon: ListChecks, write: false },
  { action: "report", word: "report", label: "Run a report", icon: ChartLine, write: false },
  { action: "rules", word: "rules", label: "Rules", icon: Zap, write: false },
  { action: "add", word: "add", label: "Add a transaction", icon: Plus, write: true },
] as const;

/** With nothing typed: where to pick up, recent questions, and what you can type. */
export function AskHome({ entries, active, onPick, onHover, onAction, canWrite }: {
  entries: HomeEntry[]; active: number; onPick: (i: number) => void; onHover: (i: number) => void; onAction: (a: string) => void; canWrite: boolean;
}) {
  const home = entries.map((e, i) => ({ e, i })).filter((x) => x.e.kind === "home");
  const recent = entries.map((e, i) => ({ e, i })).filter((x) => x.e.kind === "recent" || x.e.kind === "try");
  const tried = recent.some(({ e }) => e.kind === "recent");
  return (
    <div data-testid="ask-home">
      <div className="grid md:grid-cols-[minmax(0,1fr)_380px]">
        <section className="p-4 md:p-6">
          <h3 className="mb-2 px-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">PICK UP WHERE YOU LEFT OFF</h3>
          {home.length === 0 ? (
            <p className="px-1 py-3 text-sm text-muted-foreground">All caught up. Ask about any vendor, category or month below.</p>
          ) : (
            <ul className="space-y-1" role="listbox" aria-label="Pick up where you left off">
              {home.map(({ e, i }) => {
                if (e.kind !== "home") return null;
                const Icon = ICON[e.item.kind];
                return (
                  <li key={i} role="option" aria-selected={i === active}>
                    <button type="button" onClick={() => onPick(i)} onMouseEnter={() => onHover(i)}
                      className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none", i === active ? "bg-brand-soft" : "hover:bg-surface-muted")}>
                      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", TONE[e.item.kind])}><Icon className="size-4" aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{e.item.title}</span>
                        <span className={cn("block truncate text-xs", e.item.warn ? "text-attention-text" : "text-muted-foreground")}>{e.item.detail}</span>
                      </span>
                      <span className="shrink-0 text-sm font-medium text-brand">{e.item.cta}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="border-t p-4 md:border-t-0 md:border-l md:p-6">
          <h3 className="mb-2 px-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">{tried ? "RECENT QUESTIONS" : "TRY ASKING"}</h3>
          <ul className="space-y-0.5">
            {recent.map(({ e, i }) => e.kind !== "home" && (
              <li key={i}>
                <button type="button" onClick={() => onPick(i)} onMouseEnter={() => onHover(i)}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm outline-none", i === active ? "bg-surface-muted" : "hover:bg-surface-muted",
                    e.kind === "try" && "text-muted-foreground hover:text-foreground")}>
                  {e.kind === "try" ? <Sparkles className="size-3.5 shrink-0 text-brand" aria-hidden /> : <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className="truncate">{e.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="border-t p-4 md:px-6">
        <h3 className="mb-2 px-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">OR JUST TYPE</h3>
        <div className="flex flex-wrap gap-2">
          {SHORTCUTS.filter((s) => canWrite || !s.write).map((s) => (
            <button key={s.action} type="button" onClick={() => onAction(s.action)}
              className="inline-flex h-9 items-center gap-2 rounded-xl border bg-card px-3 text-sm text-muted-foreground outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring">
              <s.icon className="size-4" aria-hidden />
              <kbd className="rounded-md bg-surface-muted px-1.5 py-0.5 font-sans text-xs font-medium text-foreground">{s.word}</kbd>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
