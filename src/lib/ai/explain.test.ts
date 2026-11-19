// "Explain this month" sends aggregates only: category totals and vendor-level patterns,
// never transaction descriptions, ids or memos.
import { describe, expect, it } from "vitest";
import { buildExplainRequest, explainAggregates, explainHash, readExplanation, type Insights, type PnlLine } from "./explain";
import type Anthropic from "@anthropic-ai/sdk";

const insights: Insights = {
  from: "2026-10-01", to: "2026-10-31",
  recurring: [{ vendor: "figma", direction: "out", cadence: "monthly", amount_match: "exact", expected_amount_cents: -5200,
    expected_next_date: "2026-11-15", last_amount_cents: -5200, last_date: "2026-10-15", status: "amount_changed",
    annualized_cents: -62400, regular_amount_cents: -4500, price_increase: true }],
  large: [{ transaction_id: "aaaaaaaa-0000-4000-8000-00000000beef", date: "2026-10-05", vendor: "dell",
    description: "DELL PO#4471 SHIP TO 12 ELM ST, card 4242", amount_cents: -1500000, rules: ["p95"] }],
  new_vendors: [{ vendor: "zoom", first_seen: "2026-10-06", txn_count: 2, typical_amount_cents: -1850 }],
  top_vendors: [{ vendor: "dell", spend_cents: 1500000, txn_count: 1 }],
  uncategorized: 7, uncategorized_in_period: 2, patterns_computed_at: "2026-10-20T07:30:00Z",
};
const pnl: PnlLine[] = [
  { line_type: "account", section: "income", key: "s", name: "Sales", depth: 0, total_cents: 900000 },
  { line_type: "account", section: "expense", key: "t", name: "Tech", depth: 0, total_cents: 6100 },
  { line_type: "account", section: "expense", key: "h", name: "Hosting", depth: 1, total_cents: 900 },
  { line_type: "account", section: "expense", key: "u", name: "Uncategorized", depth: 0, total_cents: 3700, is_uncategorized: true },
  { line_type: "total", section: "income", key: "income_total", name: "Gross income", depth: 0, total_cents: 900000 },
  { line_type: "total", section: "expense", key: "expense_total", name: "Total expenses", depth: 0, total_cents: 9800 },
  { line_type: "total", section: null, key: "net_income", name: "Net income", depth: 0, total_cents: 890200 },
];

describe("explain this month", () => {
  it("builds aggregates only", () => {
    const agg = explainAggregates(insights, pnl);
    expect(agg).toEqual({
      period: { from: "2026-10-01", to: "2026-10-31" },
      pnl: {
        income: "9000.00", expenses: "98.00", net_income: "8902.00", uncategorized: "37.00",
        categories: [
          { name: "Sales", section: "income", amount: "9000.00" },
          { name: "Tech", section: "expense", amount: "61.00" },
          { name: "Uncategorized", section: "expense", amount: "37.00" },
        ],
      },
      recurring: [{ vendor: "figma", cadence: "monthly", expected_amount: "-52.00", yearly_cost: "-624.00", status: "amount_changed" }],
      large: [{ vendor: "dell", amount: "-15000.00", flagged_by: ["p95"] }],
      new_vendors: [{ vendor: "zoom", transactions: 2 }],
      top_vendors: [{ vendor: "dell", spend: "15000.00", transactions: 1 }],
      uncategorized_transactions: 2,
    });
  });

  it("the request carries no descriptions, transaction ids or card numbers", () => {
    const params = buildExplainRequest("claude-haiku-5-5", explainAggregates(insights, pnl));
    const sent = JSON.stringify(params);
    expect(sent).not.toContain("DELL PO#4471");
    expect(sent).not.toContain("12 ELM ST");
    expect(sent).not.toContain("4242");
    expect(sent).not.toContain("beef");
    expect(sent).not.toMatch(/description|transaction_id|memo/);
    expect(params.messages).toHaveLength(1);
    expect(params).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low" } });
    expect(params).not.toHaveProperty("tools");
  });

  it("hash changes with the numbers, so a cached summary can go stale", () => {
    const a = explainAggregates(insights, pnl);
    expect(explainHash("claude-haiku-5-5", a)).toBe(explainHash("claude-haiku-5-5", explainAggregates(insights, pnl)));
    const b = explainAggregates({ ...insights, uncategorized_in_period: 3 }, pnl);
    expect(explainHash("claude-haiku-5-5", b)).not.toBe(explainHash("claude-haiku-5-5", a));
  });

  it("reads the text, and nothing from a refusal", () => {
    const msg = (over: Partial<Anthropic.Beta.BetaMessage>) => ({
      content: [{ type: "text", text: " October was strong. " }], stop_reason: "end_turn", ...over,
    }) as Anthropic.Beta.BetaMessage;
    expect(readExplanation(msg({}))).toBe("October was strong.");
    expect(readExplanation(msg({ stop_reason: "refusal" as Anthropic.Beta.BetaStopReason }))).toBeNull();
    expect(readExplanation(msg({ content: [] }))).toBeNull();
  });
});
