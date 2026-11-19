// The Ask bar's fallback for full sentences the local reader can't place. The model only
// turns the typed question into the same AskQuery shape; it never sees transactions,
// statements or amounts from the books, and every number in the answer still comes from SQL.
// Sent: the question, today's date, and the business's category names. Vendor and account
// names are matched here, after the model replies, so none of them leave the app.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env/server";
import { tryParseCents } from "@/lib/money";
import { periodLabel } from "@/lib/transactions/filters";
import type { AskQuery, AskVocabulary } from "./parse";

const MODEL = "claude-haiku-5-5";
const TOOL = "read_question";

const tool: Anthropic.Tool = {
  name: TOOL,
  description: "Record what a bookkeeping question asks for, as filters over the business's transactions.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      measure: { type: "string", enum: ["spend", "earn", "list"], description: "spend: money going out; earn: money coming in; list: just find the transactions." },
      vendor: { type: ["string", "null"], description: "A business or person the money went to or came from, as written in the question." },
      category: { type: ["string", "null"], description: "One of the category names given, if the question is about a category." },
      account: { type: ["string", "null"], description: "A bank account or card named in the question (name or last four digits)." },
      from: { type: ["string", "null"], description: "Start date, YYYY-MM-DD, if the question limits the time." },
      to: { type: ["string", "null"], description: "End date, YYYY-MM-DD (not after today)." },
      min: { type: ["string", "null"], description: "Smallest amount in dollars, e.g. \"500\"." },
      max: { type: ["string", "null"], description: "Largest amount in dollars." },
      uncategorized: { type: "boolean", description: "Only transactions that don't have a category yet." },
      search: { type: ["string", "null"], description: "Other words to look for in descriptions, when nothing above fits." },
    },
    required: ["measure", "vendor", "category", "account", "from", "to", "min", "max", "uncategorized", "search"],
  },
};

type Reply = {
  measure: AskQuery["measure"]; vendor: string | null; category: string | null; account: string | null;
  from: string | null; to: string | null; min: string | null; max: string | null; uncategorized: boolean; search: string | null;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Turn the model's reply into an AskQuery, matching names against this business's own lists. */
export function toQuery(r: Reply, vocab: AskVocabulary, today: string): AskQuery {
  const q: AskQuery = { measure: r.measure === "spend" || r.measure === "earn" ? r.measure : "list" };
  if (r.vendor) {
    const want = norm(r.vendor);
    const v = vocab.vendors.find((x) => norm(x.label) === want || x.key === want)
      ?? vocab.vendors.find((x) => norm(x.label).startsWith(want) || x.key.startsWith(want) || want.startsWith(x.key));
    if (v) q.vendor = { key: v.key, label: v.label };
    else q.search = r.vendor.slice(0, 100);
  }
  if (r.category) {
    const c = vocab.categories.find((x) => norm(x.name) === norm(r.category!));
    if (c) q.category = { id: c.id, name: c.name };
  }
  if (r.account) {
    const want = norm(r.account);
    const a = vocab.accounts.find((x) => norm(x.name) === want || x.last4 === want || norm(x.name).includes(want));
    if (a) q.account = { id: a.id, name: a.name };
  }
  if (r.from && ISO.test(r.from)) {
    const to = r.to && ISO.test(r.to) && r.to < today ? r.to : today;
    if (r.from <= to) q.range = { from: r.from, to, label: periodLabel(r.from, to) };
  }
  const dollars = (s: string | null) => {
    if (!s) return undefined;
    const c = tryParseCents(s.replace(/[$,\s]/g, ""));
    return c === null ? undefined : Math.abs(c);
  };
  const min = dollars(r.min);
  const max = dollars(r.max);
  if (min !== undefined) q.min = min;
  if (max !== undefined) q.max = max;
  if (r.uncategorized) q.uncategorized = true;
  if (!q.search && r.search && !q.vendor && !q.category) q.search = r.search.slice(0, 100);
  return q;
}

export const askModel = {
  available() {
    return serverEnv.hasAnthropicKey;
  },
  async read(question: string, vocab: AskVocabulary, today: string): Promise<AskQuery | null> {
    const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey, maxRetries: 1, timeout: 10_000 });
    const res = await client.messages.create({
      model: serverEnv.anthropicModel || MODEL,
      max_tokens: 300,
      tools: [tool],
      tool_choice: { type: "tool", name: TOOL },
      system: `You read questions about a small business's books into filters. Today is ${today}. `
        + `"Lately" or "recently" means the last 90 days. Use a category only if it is one of these names: `
        + vocab.categories.map((c) => c.name).join("; "),
      messages: [{ role: "user", content: question }],
    });
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL);
    return call ? toQuery(call.input as Reply, vocab, today) : null;
  },
};
