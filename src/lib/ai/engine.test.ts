// Category suggestions with the SDK mocked: what's sent, the retry on an unknown category
// id, backoff on 429/529, budget exhaustion, idempotency, and refusals.
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { callWithBackoff, requestKey, resolveModel, suggestCategories, type AiClient, type AiStore } from "./engine";
import { PROMPT_VERSION, TOOL_NAME, buildRequest, type AiCandidate, type AiContext } from "./prompt";

const CAT_SOFT = "11111111-1111-4111-8111-111111111111";
const CAT_MEALS = "22222222-2222-4222-8222-222222222222";
const T1 = "aaaaaaaa-0000-4000-8000-000000000001";
const T2 = "aaaaaaaa-0000-4000-8000-000000000002";

const ctx = (over: Partial<AiContext> = {}): AiContext => ({
  enabled: true, model: null, share_memos: false,
  categories: [
    { id: CAT_SOFT, name: "Software & Subscriptions", type: "expense", description: "SaaS tools" },
    { id: CAT_MEALS, name: "Meals", type: "expense", description: null },
  ],
  examples: [{ description: "Github", category: "Software & Subscriptions" }],
  rejections: [{ description: "Starbucks", not_category: "Software & Subscriptions", chosen_category: "Meals" }],
  ...over,
});
const candidate = (id: string, over: Partial<AiCandidate> = {}): AiCandidate => ({
  id, date: "2026-10-01", description_clean: "Blue Hen Studio", vendor_normalized: "blue hen studio", amount_cents: -4500,
  money_account_kind: "credit_card", memo: null, recurring_cadence: "monthly", is_large: false, vendor_categories: [], ...over,
});

function message(input: unknown, over: Partial<Anthropic.Beta.BetaMessage> = {}): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5",
    content: [{ type: "tool_use", id: "toolu_1", name: TOOL_NAME, input } as Anthropic.Beta.BetaToolUseBlock],
    stop_reason: "tool_use", stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...over,
  } as Anthropic.Beta.BetaMessage;
}
const ok = (txns: string[], cat = CAT_SOFT) => message({
  suggestions: txns.map((t) => ({ transaction_id: t, category_id: cat, confidence: 0.93, reason: "Figma is design software", flags: [] })),
});

function fakeStore(over: Partial<AiStore> & { pending?: AiCandidate[][] } = {}) {
  const queue = over.pending ?? [[candidate(T1), candidate(T2)]];
  const recorded: Parameters<AiStore["record"]>[0][] = [];
  const store: AiStore = {
    context: async () => ctx(),
    budget: async () => ({ used: 0, budget: 2_000_000, remaining: 2_000_000 }),
    candidates: async () => queue.shift() ?? [],
    requestDone: async () => false,
    record: async (r) => { recorded.push(r); return { inserted: r.suggestions.length, skipped: 0, auto_applied: 0 }; },
    ...over,
  };
  return { store, recorded };
}
const fakeClient = (...responses: (Anthropic.Beta.BetaMessage | Error)[]) => {
  const create = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { beta: { messages: { create } } } as unknown as AiClient, create };
};
const noSleep = async () => {};

describe("request content", () => {
  it("sends only the allowed fields", () => {
    const params = buildRequest("claude-haiku-5-5", ctx(), [candidate(T1, { memo: "card 4242, call jane@example.com" })]);
    const user = JSON.parse(String(params.messages[0].content).split("\n").slice(1).join("\n"));
    expect(Object.keys(user[0]).sort()).toEqual(["account_type", "amount", "date", "description", "id", "patterns", "vendor"]);
    expect(user[0]).toMatchObject({ amount: "-45.00", account_type: "credit_card", patterns: { recurring: "monthly", large: false } });
    const sys = (params.system as Anthropic.Beta.BetaTextBlockParam[]).map((b) => b.text).join("\n");
    const business = JSON.parse(sys.split("Business categories and history:\n")[1]);
    expect(Object.keys(business).sort()).toEqual(["categories", "examples", "rejected"]);
    expect(Object.keys(business.categories[0]).sort()).toEqual(["description", "id", "name", "type"]);
    // No memo, email or card number anywhere unless the owner opted in.
    expect(JSON.stringify(params)).not.toMatch(/4242|jane@example\.com/);
    expect(JSON.stringify(buildRequest("claude-haiku-5-5", ctx({ share_memos: true }), [candidate(T1, { memo: "Team lunch" })])))
      .toContain("Team lunch");
  });

  it("forces structure through a strict tool whose enums are the ids sent", () => {
    const params = buildRequest("claude-haiku-5-5", ctx(), [candidate(T1)]);
    const tool = params.tools![0] as Anthropic.Beta.BetaTool;
    expect(tool).toMatchObject({ name: TOOL_NAME, strict: true });
    const item = (tool.input_schema.properties as Record<string, { items: { properties: Record<string, { enum?: string[] }>; additionalProperties: boolean } }>).suggestions.items;
    expect(item.properties.category_id.enum).toEqual([CAT_SOFT, CAT_MEALS]);
    expect(item.properties.transaction_id.enum).toEqual([T1]);
    expect(item.additionalProperties).toBe(false);
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params).not.toHaveProperty("fallbacks");
  });

  it("Sonnet requests opt into server-side fallback", () => {
    expect(buildRequest("claude-sonnet-5-5", ctx(), [candidate(T1)])).toMatchObject({
      model: "claude-sonnet-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"],
    });
  });

  it("model: business setting, then env, then Haiku", () => {
    expect(resolveModel("claude-sonnet-5-5", "claude-haiku-5-5")).toBe("claude-sonnet-5-5");
    expect(resolveModel(null, "claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(resolveModel(null, undefined)).toBe("claude-haiku-5-5");
    expect(resolveModel(null, "gpt-4")).toBe("claude-haiku-5-5");
  });
});

describe("running a batch", () => {
  it("records valid suggestions with model, prompt version, tokens and latency", async () => {
    const { store, recorded } = fakeStore();
    const { client, create } = fakeClient(ok([T1, T2]));
    let t = 1000;
    const res = await suggestCategories({ store, client, sleep: noSleep, now: () => (t += 250) });
    expect(res).toMatchObject({ status: "done", batches: 1, suggested: 2 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(recorded[0]).toMatchObject({ model: "claude-haiku-5-5", promptVersion: PROMPT_VERSION, inputTokens: 1000, outputTokens: 200, latencyMs: 250 });
    expect(recorded[0].suggestions.map((s) => s.transaction_id)).toEqual([T1, T2]);
  });

  it("an unknown category id triggers one retry with the error, then keeps what's valid", async () => {
    const bad = message({ suggestions: [
      { transaction_id: T1, category_id: "99999999-9999-4999-8999-999999999999", confidence: 0.9, reason: "x", flags: [] },
      { transaction_id: T2, category_id: CAT_MEALS, confidence: 0.6, reason: "y", flags: [] },
    ] });
    const { store, recorded } = fakeStore();
    const { client, create } = fakeClient(bad, ok([T1, T2]));
    await suggestCategories({ store, client, sleep: noSleep });
    expect(create).toHaveBeenCalledTimes(2);
    const retry = (create.mock.calls as unknown as [Anthropic.Beta.MessageCreateParamsNonStreaming][])[1][0];
    const last = retry.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(JSON.stringify(last.content)).toContain("is not in the category list");
    expect(JSON.stringify(last.content)).toContain('"is_error":true');
    expect(retry.messages.at(-2)).toEqual({ role: "assistant", content: bad.content });
    expect(recorded[0].inputTokens).toBe(2000);
    expect(recorded[0].suggestions).toHaveLength(2);
  });

  it("retries only once: a second bad answer keeps the valid rows and drops the rest", async () => {
    const bad = message({ suggestions: [{ transaction_id: T1, category_id: "nope", confidence: 0.9, reason: "x", flags: [] }] });
    const { store, recorded } = fakeStore();
    const { client, create } = fakeClient(bad, bad);
    await suggestCategories({ store, client, sleep: noSleep });
    expect(create).toHaveBeenCalledTimes(2);
    expect(recorded[0].suggestions).toEqual([]);
  });

  it("backs off exponentially on 429 and 529, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const { store } = fakeStore();
    const { client, create } = fakeClient(
      new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers()),
      new Anthropic.InternalServerError(529, { type: "error" }, "overloaded", new Headers()),
      ok([T1, T2]),
    );
    const res = await suggestCategories({ store, client, sleep });
    expect(res.status).toBe("done");
    expect(create).toHaveBeenCalledTimes(3);
    const delays = (sleep.mock.calls as unknown as [number][]).map(([ms]) => ms);
    expect(delays[0]).toBeGreaterThanOrEqual(1000);
    expect(delays[1]).toBeGreaterThanOrEqual(2000);
  });

  it("honors retry-after and gives up after 5 attempts", async () => {
    const sleep = vi.fn(async () => {});
    const err = () => new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers({ "retry-after": "7" }));
    const { client, create } = fakeClient(err(), err(), err(), err(), err());
    await expect(callWithBackoff({ client, sleep }, buildRequest("claude-haiku-5-5", ctx(), [candidate(T1)])))
      .rejects.toBeInstanceOf(Anthropic.RateLimitError);
    expect(create).toHaveBeenCalledTimes(5);
    expect((sleep.mock.calls as unknown as [number][])[0][0]).toBeGreaterThanOrEqual(7000);
  });

  it("does not retry a bad request", async () => {
    const { store, recorded } = fakeStore();
    const { client, create } = fakeClient(new Anthropic.BadRequestError(400, { type: "error" }, "bad", new Headers()));
    const res = await suggestCategories({ store, client, sleep: noSleep });
    expect(res.status).toBe("failed");
    expect(create).toHaveBeenCalledTimes(1);
    expect(recorded).toEqual([]);
  });

  it("budget exhaustion stops calls and reports it", async () => {
    const { store } = fakeStore({ budget: async () => ({ used: 2_000_000, budget: 2_000_000, remaining: 0 }) });
    const { client, create } = fakeClient(ok([T1]));
    const res = await suggestCategories({ store, client, sleep: noSleep });
    expect(res).toMatchObject({ status: "budget_exhausted", batches: 0 });
    expect(res.message).toMatch(/budget/);
    expect(create).not.toHaveBeenCalled();
  });

  it("stops mid-run when the budget runs out between batches", async () => {
    let remaining = 1200; // exactly one batch (1,000 in + 200 out)
    const { store } = fakeStore({
      pending: [[candidate(T1)], [candidate(T2)]],
      budget: async () => ({ used: 0, budget: 1200, remaining }),
      record: async (r) => { remaining -= r.inputTokens + r.outputTokens; return { inserted: 1, skipped: 0, auto_applied: 0 }; },
    });
    const { client, create } = fakeClient(ok([T1]), ok([T2]));
    const res = await suggestCategories({ store, client, sleep: noSleep });
    expect(res).toMatchObject({ status: "budget_exhausted", batches: 1 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a batch already recorded is not sent again", async () => {
    const { store, recorded } = fakeStore({ requestDone: async () => true });
    const { client, create } = fakeClient(ok([T1, T2]));
    await suggestCategories({ store, client, sleep: noSleep });
    expect(create).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
    const a = requestKey("claude-haiku-5-5", ctx(), [candidate(T1), candidate(T2)]);
    expect(requestKey("claude-haiku-5-5", ctx(), [candidate(T2), candidate(T1)])).toBe(a);
    expect(requestKey("claude-sonnet-5-5", ctx(), [candidate(T1), candidate(T2)])).not.toBe(a);
  });

  it("does nothing when AI is off", async () => {
    const { store } = fakeStore({ context: async () => ctx({ enabled: false }) });
    const { client, create } = fakeClient(ok([T1]));
    expect((await suggestCategories({ store, client, sleep: noSleep })).status).toBe("disabled");
    expect(create).not.toHaveBeenCalled();
  });

  it("a refusal records usage and no suggestions", async () => {
    const { store, recorded } = fakeStore();
    const { client } = fakeClient(message({}, { content: [], stop_reason: "refusal" as Anthropic.Beta.BetaStopReason }));
    const res = await suggestCategories({ store, client, sleep: noSleep });
    expect(res.status).toBe("refused");
    expect(recorded[0]).toMatchObject({ suggestions: [], inputTokens: 1000 });
  });

  it("trims reasons to 20 words and clamps confidence", async () => {
    const { store, recorded } = fakeStore({ pending: [[candidate(T1)]] });
    const { client } = fakeClient(message({ suggestions: [{
      transaction_id: T1, category_id: CAT_SOFT, confidence: 1.7, flags: ["personal?", "made up"],
      reason: Array.from({ length: 30 }, (_, i) => `w${i}`).join(" "),
    }] }));
    await suggestCategories({ store, client, sleep: noSleep });
    const s = recorded[0].suggestions[0];
    expect(s.reason.split(" ")).toHaveLength(20);
    expect(s.confidence).toBe(1);
    expect(s.flags).toEqual(["personal?"]);
  });
});

describe("known merchants", () => {
  it("answers well-known merchants locally and sends only the rest", async () => {
    const recorded: { model: string; suggestions: { transaction_id: string; confidence: number }[] }[] = [];
    const create = vi.fn(async () => message({ suggestions: [{ transaction_id: "t2", category_id: CAT_SOFT, confidence: 0.7, reason: "x", flags: [] }] }));
    const store: AiStore = {
      context: async () => ctx(),
      budget: async () => ({ used: 0, budget: 1_000_000, remaining: 1_000_000 }),
      candidates: vi.fn().mockResolvedValueOnce([candidate("t1", { description_clean: "Adobe", vendor_normalized: "adobe" }), candidate("t2")]).mockResolvedValue([]),
      requestDone: async () => false,
      record: async (r) => { recorded.push(r); return { inserted: r.suggestions.length, skipped: 0, auto_applied: 0 }; },
    };
    await suggestCategories({ store, client: { beta: { messages: { create } } }, sleep: async () => {} });
    expect(recorded.map((r) => [r.model, r.suggestions.map((s) => s.transaction_id)])).toEqual([["known-merchant", ["t1"]], ["claude-haiku-5-5", ["t2"]]]);
    expect(recorded[0].suggestions[0].confidence).toBe(0.95);
  });
});
