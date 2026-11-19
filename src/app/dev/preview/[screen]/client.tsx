"use client";
// Client wrappers for previews that need event handlers.
import { MappingStep, type ImportAccount } from "@/components/import/import-wizard";
import type { GuessedField, Mapping } from "@/lib/import/mapping";
import type { ParsedFile } from "@/lib/import/parse";

export function MappingStepPreview({ account, parsed, mapping, guessed }: { account: ImportAccount; parsed: ParsedFile; mapping: Mapping; guessed: GuessedField[] }) {
  return (
    <MappingStep account={account} fileName="chase_checking_oct.csv" parsed={parsed} mapping={mapping} guessed={new Set(guessed)}
      continuing={false} saveMapping onSaveMappingChange={() => {}} onContinue={() => {}} onChange={() => {}} onBack={() => {}} />
  );
}

// ---- Ask bar panel states ---------------------------------------------------------------
import { AskHome } from "@/components/ask/ask-home";
import { AskTyping } from "@/components/ask/ask-typing";
import { AskAnswerView } from "@/components/ask/ask-answer";
import type { AskContext } from "@/app/b/[businessId]/ask/actions";
import type { AskAnswer } from "@/lib/search/answer";
import { parseAsk, suggestEntities } from "@/lib/search/parse";
import { ACCTS, BIZ, CATS } from "./fixtures";

const ING = CATS.find((c) => c.name === "Ingredients")!.id;
const ASK_CTX: AskContext = {
  today: "2026-10-23", canWrite: true, smart: true, recentIds: [], options: CATS,
  vocab: {
    vendors: [{ key: "restaurant depot", label: "Restaurant Depot", count: 14 }, { key: "square", label: "Square", count: 40 }, { key: "gusto", label: "Gusto", count: 9 }],
    categories: CATS.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    accounts: Object.values(ACCTS).map((a) => ({ id: a.id, name: a.name, last4: a.last4 })),
  },
  home: [
    { kind: "review", title: "Review 5 suggestions", detail: "3 ready to accept · 2 need a look", href: "#", cta: "Review" },
    { kind: "import", title: "Import a statement for Reserve Savings", detail: "Last import Sep 30 · 22 days ago", href: "#", cta: "Import", warn: true },
    { kind: "pnl", title: "October profit & loss", detail: "Net income $3,516.34 so far", href: "#", cta: "Open" },
    { kind: "note", title: "Restaurant Depot is up 18%", detail: "Against your 3-month average", href: "#", cta: "See why" },
  ],
};
const row = (id: string, date: string, amount: number, cat: string | null) =>
  ({ id, date, description: "Restaurant Depot #0412", vendor: "restaurant depot", amount, money_account_id: ACCTS.visa.id, category_account_id: cat, category_source: cat ? "user" : null, locked: false });
const ASK_ANSWER: AskAnswer = {
  headline: "$4,916.72 at Restaurant Depot in the last 90 days",
  details: ["14 purchases on Business Visa", "up 18% on the last 90 days before", "2 still uncategorized"],
  bars: [{ label: "Aug", cents: 151200 }, { label: "Sep", cents: 179000 }, { label: "Oct", cents: 161400 }],
  count: 14,
  rows: [row("r1", "2026-10-21", -66471, null), row("r2", "2026-10-14", -40108, null), row("r3", "2026-10-07", -50915, ING), row("r4", "2026-09-30", -44392, ING), row("r5", "2026-09-23", -55183, ING)],
  suggestions: {
    r1: { id: "s1", category_account_id: ING, category_name: "Ingredients", confidence: 0.95, reason: null, flags: [] },
    r2: { id: "s2", category_account_id: ING, category_name: "Ingredients", confidence: 0.95, reason: null, flags: [] },
  },
  href: "#", exportHref: "#",
  vendor: { label: "Restaurant Depot", count: 14, avg: 35119 },
  rule: { vendorKey: "restaurant depot", vendorLabel: "Restaurant Depot", categoryId: ING, categoryName: "Ingredients" },
  accept: { ids: ["s1", "s2"], categoryNames: ["Ingredients"] },
  empty: false,
};

export function AskPreview() {
  const typed = "how much have we spent at restaurant d";
  const parse = parseAsk(typed, ASK_CTX.vocab, ASK_CTX.today);
  const panel = "overflow-hidden rounded-2xl border bg-card shadow-[0_24px_60px_-20px_rgb(15_31_23/0.35)]";
  const none = () => {};
  return (
    <div className="mx-auto max-w-[1300px] space-y-10 p-4 md:p-8">
      <div className={panel}>
        <AskHome entries={[...ASK_CTX.home.map((item) => ({ kind: "home" as const, item })), { kind: "recent", text: "How much did we spend on ingredients in Q3?" }, { kind: "recent", text: "Uncategorized over $500" }]}
          active={0} onPick={none} onHover={none} onAction={none} canWrite />
      </div>
      <div className={panel}>
        <AskTyping entries={[{ kind: "ask", text: typed }, ...suggestEntities(typed, ASK_CTX.vocab).map((suggestion) => ({ kind: "entity" as const, suggestion }))]}
          active={0} onPick={none} onHover={none} parse={parse} smart asking={false} />
      </div>
      <div className={panel}>
        <AskAnswerView businessId={BIZ} ctx={ASK_CTX} answer={ASK_ANSWER} query={parseAsk("spent at restaurant depot lately", ASK_CTX.vocab, ASK_CTX.today).query}
          busy={false} onRefresh={none} onNavigate={none} onRefine={none} />
      </div>
    </div>
  );
}
