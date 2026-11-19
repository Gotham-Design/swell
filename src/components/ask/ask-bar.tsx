"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { loadAsk, readWithModel, runAsk, type AskContext } from "@/app/b/[businessId]/ask/actions";
import { handOffImport } from "@/components/requests/received-files";
import { requestAddTransaction } from "@/components/transactions/add-transaction";
import type { AskAnswer } from "@/lib/search/answer";
import { parseAsk, suggestEntities, type AskQuery, type AskSuggestion } from "@/lib/search/parse";
import { cn } from "@/lib/utils";
import { AskHome, TRY_ASKING, type HomeEntry } from "./ask-home";
import { AskTyping, type TypingEntry } from "./ask-typing";
import { AskAnswerView } from "./ask-answer";

const recentKey = (b: string) => `ag:ask-recent:${b}`;
function readRecent(b: string): string[] {
  try { return JSON.parse(window.localStorage.getItem(recentKey(b)) ?? "[]").filter((x: unknown) => typeof x === "string").slice(0, 6); } catch { return []; }
}
function saveRecent(b: string, q: string) {
  try {
    const next = [q, ...readRecent(b).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6);
    window.localStorage.setItem(recentKey(b), JSON.stringify(next));
  } catch { /* this browser keeps no history */ }
}

/** A question worth answering as the person types (they named something specific). */
// Anything read as a question is answered as you type; a lone short word waits for more.
const answerable = (q: AskQuery) => !(q.search && Object.keys(q).length === 2 && q.search.length < 3);

/**
 * The Ask bar: pinned at the top of every client page. Opens a panel that starts with where to
 * pick up, finishes names as you type, and answers questions with the matching transactions,
 * which can be filed right there. Phones get the same panel full screen.
 */
export function AskBar({ businessId }: { businessId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [ctx, setCtx] = useState<AskContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; query: AskQuery; data: AskAnswer } | null>(null);
  const [asking, setAsking] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // Desktop: the panel opens in place, from the bar down and across the page's width.
  const [anchor, setAnchor] = useState<{ top: number; left: number; right: number } | null>(null);
  const seq = useRef(0);

  const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    setLoadingCtx(true);
    setLoadError(false);
    try {
      const r = await loadAsk(businessId);
      if (r.ok) setCtx(r.context); else { setLoadError(true); toast.error(r.error); }
    } catch {
      setLoadError(true);
    } finally {
      setLoadingCtx(false);
    }
  }, [businessId]);

  const show = useCallback(() => {
    const bar = barRef.current;
    if (bar && window.matchMedia("(min-width: 768px)").matches) {
      const r = bar.getBoundingClientRect();
      const main = bar.closest("main")?.getBoundingClientRect();
      const pad = main ? Number.parseFloat(getComputedStyle(bar.closest("main")!).paddingRight) || 32 : 32;
      setAnchor({ top: Math.max(8, r.top), left: r.left, right: Math.max(16, window.innerWidth - (main ? main.right - pad : r.right)) });
    } else {
      setAnchor(null);
    }
    setOpen(true);
    setRecent(readRecent(businessId));
    void load();
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, [businessId, load]);
  const close = useCallback(() => { setOpen(false); setActive(0); }, []);

  // Leaving the page closes the panel; a new client starts fresh.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => { setCtx(null); setAnswer(null); setText(""); }, [businessId]);

  // ⌘K / Ctrl+K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close(); else show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, show, close]);

  const parse = useMemo(() => (ctx && text.trim() ? parseAsk(text, ctx.vocab, ctx.today) : null), [ctx, text]);
  const suggestions = useMemo(() => (ctx && text.trim() ? suggestEntities(text, ctx.vocab) : []), [ctx, text]);

  const answerQuery = useCallback(async (asked: string, query: AskQuery, remember = true) => {
    const n = ++seq.current;
    setAsking(true);
    const r = await runAsk(businessId, query);
    if (n !== seq.current) return;
    setAsking(false);
    if (!r.ok) { toast.error(r.error); return; }
    setAnswer({ text: asked, query, data: r.answer });
    if (remember) { saveRecent(businessId, asked); setRecent(readRecent(businessId)); }
  }, [businessId]);

  /** Enter: answer what's typed; sentences the reader can't place go to the model when there is one. */
  const ask = useCallback(async (asked = text) => {
    if (!ctx || !asked.trim()) return;
    const p = parseAsk(asked, ctx.vocab, ctx.today);
    if (p.action) { goAction(p.action); return; }
    if (!p.understood || (p.query.search && ctx.smart && asked.trim().split(/\s+/).length > 3)) {
      if (ctx.smart) {
        setAsking(true);
        const m = await readWithModel(businessId, asked);
        setAsking(false);
        if (m.ok && m.query) { await answerQuery(asked, m.query); return; }
      }
    }
    await answerQuery(asked, p.understood ? p.query : { measure: "list", search: asked.trim().slice(0, 100) });
    // goAction is stable enough for this use; it only reads businessId and router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, text, businessId, answerQuery]);

  // Answer as they type once the words name something specific.
  useEffect(() => {
    if (!open || !parse?.understood || parse.action || !answerable(parse.query)) return;
    if (answer && JSON.stringify(answer.query) === JSON.stringify(parse.query)) return;
    const t = setTimeout(() => void answerQuery(text, parse.query, false), 300);
    return () => clearTimeout(t);
  }, [open, parse, text, answerQuery, answer]);

  const base = `/b/${businessId}`;
  const goAction = (a: string) => {
    if (a === "add") {
      const here = pathname === base || pathname.startsWith(`${base}/transactions`);
      requestAddTransaction(here);
      close();
      if (!here) router.push(`${base}/transactions`);
      return;
    }
    const href: Record<string, string> = {
      import: `${base}/import`, report: `${base}/reports`, review: `${base}/transactions?type=uncategorized`,
      request: `${base}/import`, rules: `${base}/rules`, accounts: `${base}/accounts`, categories: `${base}/categories`,
      settings: `${base}/settings`, transactions: `${base}/transactions`,
    };
    close();
    router.push(href[a] ?? base);
  };

  /** Finish the trailing words with a picked name ("restaurant d" → "Restaurant Depot"). */
  const complete = (s: AskSuggestion) => {
    const label = s.kind === "vendor" ? s.vendor.label : s.kind === "category" ? s.category.name : s.account.name;
    const words = text.trimEnd().split(/\s+/);
    const lower = label.toLowerCase();
    let cut = words.length;
    for (let take = Math.min(4, words.length); take >= 1; take--) {
      const frag = words.slice(-take).join(" ").toLowerCase();
      if (lower.startsWith(frag) || lower.includes(` ${frag}`)) { cut = words.length - take; break; }
    }
    const next = `${[...words.slice(0, cut), label].join(" ")} `;
    setText(next);
    inputRef.current?.focus({ preventScroll: true });
  };

  // Rows the arrow keys move through, depending on what's showing.
  // The last answer stays up while the next one loads; until it matches what's typed it's "stale",
  // and the ask row and name suggestions show above it.
  const current = !!answer && (answer.text.trim().toLowerCase() === text.trim().toLowerCase()
    || (!!parse?.understood && JSON.stringify(parse.query) === JSON.stringify(answer.query)));
  const showingAnswer = !!answer && text.trim() !== "";
  const stale = showingAnswer && !current;
  const homeEntries: HomeEntry[] = ctx ? [
    ...ctx.home.map((h) => ({ kind: "home" as const, item: h })),
    ...(recent.length ? recent.map((q) => ({ kind: "recent" as const, text: q })) : TRY_ASKING.map((q) => ({ kind: "try" as const, text: q }))),
  ] : [];
  const typingEntries: TypingEntry[] = text.trim() ? [
    { kind: "ask", text: text.trim() },
    ...suggestions.map((s) => ({ kind: "entity" as const, suggestion: s })),
  ] : [];
  const entries = text.trim() ? (showingAnswer && !stale ? [] : typingEntries) : homeEntries;

  const pick = (i: number) => {
    const e = entries[i];
    if (!e) return;
    if (e.kind === "home") { close(); router.push(e.item.href); }
    else if (e.kind === "recent" || e.kind === "try") { setText(e.text); void ask(e.text); }
    else if (e.kind === "ask") void ask();
    else if (e.kind === "entity") complete(e.suggestion);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); if (text) { setText(""); setAnswer(null); } else close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(entries.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); return; }
    if (e.key === "Tab" && !e.shiftKey && text.trim() && (!showingAnswer || stale) && suggestions.length) {
      // Tab finishes the name under the highlight (or the first one).
      e.preventDefault();
      const entry = entries[active];
      complete(entry?.kind === "entity" ? entry.suggestion : suggestions[0]);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (entries.length && active > 0) pick(active);
      else if (text.trim()) void ask();
      else pick(active);
    }
  };
  useEffect(() => { setActive(0); }, [text]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    handOffImport(f);
    close();
    router.push(`${base}/import`);
  };

  const refreshAnswer = useCallback(() => {
    if (answer) void answerQuery(answer.text, answer.query, false);
  }, [answer, answerQuery]);

  const input = (inPanel: boolean) => (
    <div className={cn("flex h-11 items-center gap-3 rounded-xl border bg-card px-3.5 transition-colors",
      inPanel ? "border-brand/50 ring-4 ring-brand/10" : "hover:border-brand/40", dragging && "border-brand bg-brand-soft")}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <Sparkles className="size-[18px] shrink-0 text-brand" aria-hidden />
      {inPanel ? (
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
          placeholder="Ask anything, search, or drop a statement…" aria-label="Ask or search" data-testid="ask-input"
          role="combobox" aria-expanded aria-controls="ask-panel" autoComplete="off" spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground" />
      ) : (
        <button type="button" onClick={show} className="min-w-0 flex-1 truncate text-left text-[15px] text-muted-foreground outline-none" data-testid="ask-open">
          {dragging ? "Drop to import this statement" : "Ask anything, search, or drop a statement…"}
        </button>
      )}
      {(asking || loadingCtx) && inPanel && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
      {inPanel ? (
        <button type="button" onClick={close} aria-label="Close" className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-surface-muted md:hidden">
          <X className="size-4" aria-hidden />
        </button>
      ) : (
        <kbd className="hidden rounded-md border px-1.5 text-[11px] text-muted-foreground md:inline">⌘ K</kbd>
      )}
      {inPanel && <kbd className="hidden rounded-md border px-1.5 text-[11px] text-muted-foreground md:inline">esc</kbd>}
    </div>
  );

  return (
    <div ref={barRef} className="relative" data-testid="ask-bar">
      {input(false)}
      {open && (
        // The rail stays usable: only the page area is covered.
        <div className="pointer-events-none fixed inset-0 z-50 [&>*]:pointer-events-auto" role="dialog" aria-label="Ask" data-scroll-lock>
          <div className="absolute inset-0 bg-background/60 backdrop-blur-[3px] max-md:bg-background md:left-[72px]" onClick={close} aria-hidden />
          <div className={anchor ? "absolute flex flex-col" : "relative flex h-full flex-col px-4 pt-3"}
            style={anchor ? { top: anchor.top, left: anchor.left, right: anchor.right, maxHeight: `calc(100dvh - ${anchor.top + 16}px)` } : undefined}>
            <div className="w-full max-w-[680px]">{input(true)}</div>
            <div id="ask-panel" className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-[0_24px_60px_-20px_rgb(15_31_23/0.35)] max-md:mb-3"
              data-testid="ask-panel">
              <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {!ctx ? (
                  loadError ? (
                    <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
                      Couldn{"'"}t open search just now.
                      <button type="button" onClick={() => void load()} className="font-medium text-brand hover:underline">Try again</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Getting {"this client's"} books ready…</div>
                  )
                ) : !text.trim() ? (
                  <AskHome entries={homeEntries} active={active} onPick={pick} onHover={setActive} onAction={goAction} canWrite={ctx.canWrite} />
                ) : showingAnswer && answer ? (<>
                  {stale && (
                    <div className="border-b">
                      <AskTyping entries={typingEntries.slice(0, 4)} active={active} onPick={pick} onHover={setActive} parse={parse} smart={ctx.smart} asking={asking} />
                    </div>
                  )}
                  <AskAnswerView businessId={businessId} ctx={ctx} answer={answer.data} query={answer.query} busy={asking || stale}
                    onRefresh={refreshAnswer} onNavigate={(href) => { close(); router.push(href); }}
                    onRefine={(q, label) => { setText(label); void answerQuery(label, q); }} />
                </>) : (
                  <AskTyping entries={typingEntries} active={active} onPick={pick} onHover={setActive} parse={parse} smart={ctx.smart} asking={asking} />
                )}
              </div>
              <div className="hidden items-center gap-4 border-t bg-surface-muted/60 px-6 py-2.5 text-xs text-muted-foreground md:flex">
                <span><kbd className="mr-1 rounded border bg-card px-1">↑↓</kbd> move</span>
                <span><kbd className="mr-1 rounded border bg-card px-1">enter</kbd> {text.trim() ? "ask" : "open"}</span>
                <span><kbd className="mr-1 rounded border bg-card px-1">tab</kbd> edit inline</span>
                <span><kbd className="mr-1 rounded border bg-card px-1">esc</kbd> {text ? "clear" : "close"}</span>
                <span className="flex-1" />
                <span>{ctx?.smart ? "Answers come from the books. Only your question is read by AI, never statements." : "Answers come straight from the books."}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
