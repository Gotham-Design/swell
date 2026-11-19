// "Explain this month": a short plain-language summary of a period from aggregates only:
// the P&L by category and the pattern list. No transaction descriptions, memos or ids are
// sent. Pure, so tests can check exactly what would leave the server.
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { centsToInput } from "@/lib/money";
import type { AiModel } from "./prompt";

export const EXPLAIN_PROMPT_VERSION = "explain-2026-10-23";

/** Shape of public.insights() (the fields we read). */
export interface Insights {
  from: string;
  to: string;
  recurring: { vendor: string; direction: string; cadence: string; amount_match: string; expected_amount_cents: number;
    expected_next_date: string; last_amount_cents: number | null; last_date: string | null; status: string; annualized_cents: number;
    regular_amount_cents: number | null; price_increase: boolean }[];
  large: { transaction_id: string; date: string; vendor: string | null; description: string; amount_cents: number; rules: string[] }[];
  new_vendors: { vendor: string; first_seen: string; txn_count: number; typical_amount_cents: number }[];
  top_vendors: { vendor: string; spend_cents: number; txn_count: number }[];
  uncategorized: number;
  uncategorized_in_period: number;
  patterns_computed_at: string | null;
}

export interface PnlLine { line_type: string; section: string | null; key: string; name: string; depth: number; total_cents: number; is_uncategorized?: boolean | null }

export interface ExplainAggregates {
  period: { from: string; to: string };
  pnl: {
    income: string; expenses: string; net_income: string;
    categories: { name: string; section: "income" | "expense"; amount: string }[];
    uncategorized: string;
  };
  recurring: { vendor: string; cadence: string; expected_amount: string; yearly_cost: string; status: string }[];
  large: { vendor: string; amount: string; flagged_by: string[] }[];
  new_vendors: { vendor: string; transactions: number }[];
  top_vendors: { vendor: string; spend: string; transactions: number }[];
  uncategorized_transactions: number;
}

const money = (c: number) => centsToInput(c);

/** Pick the aggregates: category totals, vendor-level patterns, counts. Nothing per transaction but amounts and vendors. */
export function explainAggregates(insights: Insights, pnl: PnlLine[]): ExplainAggregates {
  const total = (key: string) => pnl.find((r) => r.key === key)?.total_cents ?? 0;
  return {
    period: { from: insights.from, to: insights.to },
    pnl: {
      income: money(total("income_total")),
      expenses: money(total("expense_total")),
      net_income: money(total("net_income")),
      // Top-level categories only (their totals include children).
      categories: pnl.filter((r) => r.line_type === "account" && r.depth === 0 && (r.section === "income" || r.section === "expense"))
        .map((r) => ({ name: r.name, section: r.section as "income" | "expense", amount: money(r.total_cents) })),
      uncategorized: money(pnl.find((r) => r.is_uncategorized)?.total_cents ?? 0),
    },
    recurring: insights.recurring.map((r) => ({
      vendor: r.vendor, cadence: r.cadence, expected_amount: money(r.expected_amount_cents),
      yearly_cost: money(r.annualized_cents), status: r.status,
    })),
    large: insights.large.map((l) => ({ vendor: l.vendor ?? "unknown vendor", amount: money(l.amount_cents), flagged_by: l.rules })),
    new_vendors: insights.new_vendors.map((v) => ({ vendor: v.vendor, transactions: v.txn_count })),
    top_vendors: insights.top_vendors.map((v) => ({ vendor: v.vendor, spend: money(v.spend_cents), transactions: v.txn_count })),
    uncategorized_transactions: insights.uncategorized_in_period,
  };
}

/** Same aggregates, same prompt, same hash: the cached summary still fits. */
export function explainHash(model: string, agg: ExplainAggregates): string {
  return createHash("sha256").update(`${EXPLAIN_PROMPT_VERSION}|${model}|${JSON.stringify(agg)}`).digest("hex");
}

const SYSTEM = `You explain a small business's month to its owner in plain language. You get aggregates only: profit and loss by category, recurring charges, large payments, new and top vendors. Amounts are in dollars; negative amounts are money out.

Write 4 to 6 short sentences, no headings or bullet points, no greeting. Lead with how the period went (income, expenses, net). Then point out what deserves attention: missed or changed recurring charges, unusually large payments, new vendors, and uncategorized transactions that make the totals less reliable. Don't give tax, legal or investment advice, and don't invent numbers that aren't in the data.`;

export function buildExplainRequest(model: AiModel, agg: ExplainAggregates): Anthropic.Beta.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 4000,
    output_config: { effort: "low" },
    system: SYSTEM,
    messages: [{ role: "user", content: `Explain this period:\n${JSON.stringify(agg)}` }],
    ...(model === "claude-sonnet-5-5" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };
}

/** The summary text, or null when there is none (refusal, empty answer). */
export function readExplanation(message: Anthropic.Beta.BetaMessage): string | null {
  if (message.stop_reason === "refusal") return null;
  const text = message.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
  return text || null;
}
