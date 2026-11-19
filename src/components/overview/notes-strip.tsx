"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface OverviewNote { kind: string; headline: string; detail: string; href: string }

/** One plain-SQL note at a time: bold fact, muted detail, a link; rotates every 6s, dots to jump. */
export function NotesStrip({ notes }: { notes: OverviewNote[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (notes.length < 2 || paused) return;
    const t = setInterval(() => setI((n) => (n + 1) % notes.length), 6000);
    return () => clearInterval(t);
  }, [notes.length, paused]);
  if (!notes.length) return null;
  const n = notes[Math.min(i, notes.length - 1)];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3 text-sm transition-colors",
      n.kind === "to_review" ? "bg-attention-soft text-attention-text" : "bg-brand-soft text-foreground")} data-testid="notes-strip"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <p className="min-w-0 flex-1" aria-live="polite" data-kind={n.kind}>
        <span className="font-medium">{n.headline}</span>
        <span className={n.kind === "to_review" ? "text-attention-text/80" : "text-muted-foreground"}> · {n.detail}</span>
      </p>
      <Link href={n.href} className={cn("font-medium hover:underline", n.kind === "to_review" ? "text-attention-text" : "text-brand")}>
        {n.kind === "to_review" ? "Review now" : "See transactions"}
      </Link>
      {notes.length > 1 && (
        <span className="flex items-center gap-1.5" role="tablist" aria-label="Notes">
          {notes.map((note, j) => (
            <button key={note.kind} type="button" role="tab" aria-selected={j === i} aria-label={`Note ${j + 1} of ${notes.length}`}
              onClick={() => setI(j)}
              className={cn("h-1.5 rounded-full transition-all", j === i ? "w-5 bg-brand" : "w-1.5 bg-brand/40 hover:bg-brand/70")} />
          ))}
        </span>
      )}
    </div>
  );
}
