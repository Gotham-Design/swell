"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The search box. Enter goes to `action(q)`; the "/" key focuses it from anywhere on the
 * page (unless someone is typing in another field).
 */
export function SearchField({ initial = "", action, className, label = "Search transactions", disabled }: {
  initial?: string;
  /** Where Enter goes, given the trimmed query. */
  action: string | ((q: string) => string);
  className?: string;
  label?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (!ref.current || ref.current.offsetParent === null) return; // hidden copy of the page
      e.preventDefault();
      ref.current.focus();
      ref.current.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form role="search" className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const query = q.trim();
        router.push(typeof action === "string" ? `${action}${query ? `?q=${encodeURIComponent(query)}` : ""}` : action(query));
      }}>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input ref={ref} type="search" value={q} onChange={(e) => setQ(e.target.value)} disabled={disabled}
        aria-label={label} placeholder={label} data-testid="search-input"
        className="h-9 w-full rounded-full border bg-card pr-10 pl-10 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60 [&::-webkit-search-cancel-button]:hidden" />
      <kbd className="pointer-events-none absolute top-1/2 right-2.5 grid h-5 min-w-5 -translate-y-1/2 place-items-center rounded-md border bg-surface-muted px-1 text-[11px] text-muted-foreground" aria-hidden>/</kbd>
    </form>
  );
}
