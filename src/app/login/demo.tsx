"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Check, FileText, Lock, Send, Sparkles, X } from "lucide-react";
import { VendorAvatar } from "@/components/ui-kit/vendor-avatar";
import { cn } from "@/lib/utils";

// A make-believe client, so the sign-in page can show the product working. Decorative:
// hidden from screen readers, and it holds still for people who prefer reduced motion.

const at = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });
const card = "overflow-hidden rounded-2xl bg-card text-foreground shadow-[0_16px_40px_rgb(0_0_0/0.22)]";

function Chip({ cat, pct, sure }: { cat: string; pct: number; sure: boolean }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs", sure ? "border-brand text-brand" : "border-attention text-attention-text")}>
      {cat} <span className="tabular-nums">{pct}%</span>
      <span className="h-3 w-px bg-current opacity-60" /><Check className="size-3" /><X className="size-3" />
    </span>
  );
}

function Row({ vendor, name, right, children, delay }: { vendor: string; name: string; right: ReactNode; children?: ReactNode; delay: number }) {
  return (
    <div className="ag-rise flex items-center gap-3 border-b px-5 py-2.5 text-[13px] last:border-b-0" style={at(delay)}>
      <VendorAvatar name={vendor} className="size-[30px] text-[10px]" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{vendor}</span>
      </span>
      {children}
      <span className="flex-1" />
      {right}
    </div>
  );
}

const amount = (s: string) => (
  <span className={cn("text-right text-sm font-semibold tabular-nums", s.startsWith("+") ? "text-money-in-text" : "text-money-out-text")}>{s}</span>
);

/** 1. A statement goes in, every row gets checked. */
function ImportScene() {
  return (
    <div className="space-y-3">
      <div className={cn(card, "ag-rise p-5")}>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><FileText className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">wells_fargo_september.pdf</span>
            <span className="block text-xs text-muted-foreground">Business Checking ··4821</span>
          </span>
          <span className="ag-rise text-xs font-medium text-money-in-text" style={at(1600)}>Read</span>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-muted">
          <div className="ag-fill h-full rounded-full bg-brand" style={at(200)} />
        </div>
      </div>
      <div className={cn(card, "ag-rise divide-y text-sm")} style={at(1500)}>
        {[["96 transactions found", "Sep 1 – Sep 30"], ["Balance checks out", "$70,828.09 = $70,828.09"], ["4 duplicates skipped", "already in the books"]].map(([a, b], i) => (
          <div key={a} className="ag-rise flex items-center gap-3 px-5 py-3" style={at(1800 + i * 350)}>
            <span className="grid size-5 place-items-center rounded-full bg-money-in-soft text-money-in-text"><Check className="size-3" /></span>
            <span className="flex-1 font-medium">{a}</span>
            <span className="text-xs text-muted-foreground">{b}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 2. Sorted into categories; the sure ones file themselves. */
function SortScene() {
  return (
    <div className="space-y-3">
      <div className="ag-rise ml-auto flex w-fit gap-3">
        <div className="rounded-2xl bg-card px-4 py-3 text-foreground shadow-[0_16px_40px_rgb(0_0_0/0.22)]">
          <p className="text-xs text-muted-foreground">Filed automatically</p>
          <p className="text-2xl font-semibold tabular-nums text-money-in-text">89</p>
        </div>
        <div className="rounded-2xl bg-card px-4 py-3 text-foreground shadow-[0_16px_40px_rgb(0_0_0/0.22)]">
          <p className="text-xs text-muted-foreground">Set aside for you</p>
          <p className="text-2xl font-semibold tabular-nums text-attention-text">7</p>
        </div>
      </div>
      <div className={card}>
        <Row vendor="square" name="Square Inc Deposit" right={amount("+$2,273.55")} delay={300}><Chip cat="Sales" pct={97} sure /></Row>
        <Row vendor="restaurant depot" name="Restaurant Depot" right={amount("−$664.71")} delay={550}><Chip cat="Ingredients" pct={95} sure /></Row>
        <Row vendor="state farm" name="State Farm" right={amount("−$218.00")} delay={800}><Chip cat="Insurance" pct={95} sure /></Row>
        <Row vendor="venmo" name="Venmo *J Rivera" right={amount("−$180.00")} delay={1050}><Chip cat="Contractors" pct={41} sure={false} /></Row>
      </div>
    </div>
  );
}

/** 3. Ask a question, get the number and the rows behind it. */
function AskScene() {
  const q = "how much did we spend at restaurant depot lately";
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTyped((n) => (n >= q.length ? n : n + 1)), 38);
    return () => clearInterval(t);
  }, []);
  const done = typed >= q.length;
  return (
    <div className="space-y-3">
      <div className={cn(card, "ag-rise flex h-12 items-center gap-3 px-4")}>
        <Sparkles className="size-[18px] text-brand" />
        <span className="flex-1 truncate text-[15px]">{q.slice(0, typed)}<span className="ag-caret ml-px inline-block h-4 w-px translate-y-0.5 bg-foreground" /></span>
        <span className="rounded-md border px-1.5 text-[11px] text-muted-foreground">⌘ K</span>
      </div>
      {done && (
        <div className={cn(card, "ag-rise p-4")}>
          <div className="flex items-end gap-4 rounded-xl bg-brand-soft p-4">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-brand"><Sparkles className="size-3.5" /> Answer</p>
              <p className="mt-1 text-lg font-semibold leading-snug">$4,916.72 at Restaurant Depot in the last 90 days</p>
              <p className="mt-0.5 text-xs text-muted-foreground">14 purchases · up 18% on the 90 days before</p>
            </div>
            <div className="flex items-end gap-2">
              {[38, 52, 46].map((h, i) => (
                <span key={i} className={cn("ag-grow w-6 rounded-md", i === 2 ? "bg-brand" : "bg-brand/30")} style={{ height: h, ...at(200 + i * 120) }} />
              ))}
            </div>
          </div>
          {[["Oct 21", "Ingredients 95%"], ["Oct 14", "Ingredients 95%"]].map(([d, c], i) => (
            <div key={d} className="ag-rise flex items-center gap-3 border-b px-2 py-2.5 text-sm last:border-b-0" style={at(500 + i * 200)}>
              <span className="w-12 text-muted-foreground">{d}</span>
              <span className="flex-1 font-medium">Restaurant Depot</span>
              <Chip cat={c.split(" ")[0]} pct={95} sure />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 4. Month closed: a clean P&L to hand over. */
function ReportScene() {
  const lines: [string, string][] = [["Income", ""], ["Sales", "$10,403.58"], ["Expenses", ""], ["Payroll", "$3,600.00"], ["Rent", "$3,200.00"], ["Ingredients", "$1,845.79"], ["Insurance", "$620.00"]];
  return (
    <div className={cn(card, "ag-rise")}>
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <span className="text-sm font-semibold">Profit &amp; loss · October 2026</span>
        <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">PDF · Excel</span>
      </div>
      <div className="px-5 py-2 text-sm">
        {lines.map(([name, value], i) => (
          <div key={name} className={cn("ag-rise flex justify-between", value ? "py-1" : "pt-2 pb-0.5")} style={at(250 + i * 150)}>
            <span className={value ? "pl-3 text-muted-foreground" : "text-xs font-semibold uppercase tracking-[0.06em]"}>{name}</span>
            <span className="tabular-nums">{value}</span>
          </div>
        ))}
      </div>
      <div className="ag-rise flex items-center justify-between border-t bg-money-in-soft px-5 py-3" style={at(1300)}>
        <span className="text-sm font-semibold">Net income</span>
        <span className="text-lg font-semibold tabular-nums text-money-in-text">$3,516.34</span>
      </div>
    </div>
  );
}

/** 5. Clients send statements through a private link. */
function RequestScene() {
  return (
    <div className="space-y-3">
      <div className={cn(card, "ag-rise p-5")}>
        <p className="text-sm font-semibold">Request statements from Demo Bakery</p>
        <div className="mt-3 flex items-center gap-2 rounded-xl border bg-surface-muted px-3 py-2 font-mono text-xs text-muted-foreground">
          <Lock className="size-3.5 shrink-0 text-brand" /> agmvp.vercel.app/r/k7Qx…9fT2
        </div>
        <div className="mt-3 flex gap-2">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand px-3 text-xs font-medium text-white"><Send className="size-3.5" /> Email it</span>
          <span className="inline-flex h-8 items-center rounded-full border px-3 text-xs">Copy link</span>
        </div>
      </div>
      <div className={cn(card, "ag-rise")} style={at(900)}>
        <p className="border-b px-5 py-3 text-sm font-semibold">Received from your client</p>
        {["chase_checking_sep.pdf", "amex_business_sep.csv"].map((f, i) => (
          <div key={f} className="ag-rise flex items-center gap-3 border-b px-5 py-2.5 text-sm last:border-b-0" style={at(1300 + i * 300)}>
            <FileText className="size-4 text-brand" />
            <span className="flex-1">{f}</span>
            <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-white">Import</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SCENES = [
  { label: "Import", caption: "Drop in any bank statement. Every row is checked against the balance.", view: ImportScene },
  { label: "Sort", caption: "The sure ones file themselves. You review the few it flags.", view: SortScene },
  { label: "Ask", caption: "Ask anything about a client's books and fix it right there.", view: AskScene },
  { label: "Report", caption: "Hand over a clean P&L, balance sheet or export.", view: ReportScene },
  { label: "Request", caption: "Clients send statements through a private link. No logins.", view: RequestScene },
];
const HOLD = 6000;

export function LoginDemo() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setI((n) => (n + 1) % SCENES.length), HOLD);
    return () => clearTimeout(t);
  }, [i, paused]);
  const scene = SCENES[i];
  const View = scene.view;
  return (
    <div className="mt-auto pt-10" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="relative min-h-[330px]" aria-hidden>
        {/* key remounts the scene, so its entrance plays each time it comes round */}
        <div key={i} className="ag-rise absolute inset-x-0 bottom-0">
          <View />
        </div>
      </div>
      <div className="mt-6 flex items-center gap-4">
        <p key={`c${i}`} className="ag-rise min-w-0 flex-1 text-sm text-white/80">{scene.caption}</p>
        <div className="flex gap-1.5" role="tablist" aria-label="Product tour">
          {SCENES.map((s, n) => (
            <button key={s.label} type="button" role="tab" aria-selected={n === i} aria-label={s.label} onClick={() => setI(n)}
              className={cn("h-1.5 rounded-full transition-all", n === i ? "w-6 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70")} />
          ))}
        </div>
      </div>
    </div>
  );
}
