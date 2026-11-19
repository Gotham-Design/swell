// Jev and vendor-history tiers with the SDK mocked: what's sent, how probabilities become
// confidence and a runner-up, flags, chunking, and history answering without a call.
import { describe, expect, it, vi } from "vitest";
import { suggestCategories, type AiStore } from "./engine";
import { HISTORY_MIN, HISTORY_MODEL, historyConfidence, historySuggestions, type VendorHistoryRow } from "./history";
import { FLAG_THRESHOLD, JEV_CHUNK, JEV_PROMPT_VERSION, NONE_LABEL, TRANSFER_CONFIDENCE_CAP, TRANSFER_LABEL, buildJevRequest, categoryLabels, pickConfidence, readJevAnswers, type JevClient } from "./jev";
import type { AiCandidate, AiContext } from "./prompt";

const SOFT = "11111111-1111-4111-8111-111111111111";
const MEALS = "22222222-2222-4222-8222-222222222222";
const REFUNDS_IN = "33333333-3333-4333-8333-333333333333";
const REFUNDS_OUT = "44444444-4444-4444-8444-444444444444";
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ctx = (over: Partial<AiContext> = {}): AiContext => ({
  enabled: true, model: null, share_memos: false,
  categories: [
    { id: SOFT, name: "Software", type: "expense", description: "SaaS tools" },
    { id: MEALS, name: "Meals", type: "expense", description: null },
  ],
  examples: [{ description: "Github", category: "Software" }],
  rejections: [{ description: "Starbucks", not_category: "Software", chosen_category: "Meals" }],
  ...over,
});
const candidate = (n: number, over: Partial<AiCandidate> = {}): AiCandidate => ({
  id: id(n), date: "2026-10-01", description_clean: "Blue Hen Studio", vendor_normalized: "blue hen studio", amount_cents: -4500,
  money_account_kind: "credit_card", memo: "card 4242", recurring_cadence: "monthly", is_large: false, vendor_categories: [], ...over,
});

/** A Jev answer for every question in a request, from a pick per transaction. */
function answersFor(req: Parameters<JevClient["systemOne"]>[0], pick: (k: string) => Record<string, number>, flagYes = 0.1) {
  const answers: Awaited<ReturnType<JevClient["systemOne"]>>["answers"] = {};
  for (const key of Object.keys(req.questions)) {
    const k = key.split("_")[0];
    if (key.endsWith("_category")) {
      const probabilities = pick(k);
      const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
      answers[key] = { type: "choice", choice, probabilities };
    } else {
      answers[key] = { type: "noul", noul: flagYes };
    }
  }
  return answers;
}
const fakeJev = (pick: (k: string) => Record<string, number> = () => ({ Software: 0.91, Meals: 0.06, [NONE_LABEL]: 0.03 }), flagYes = 0.1) => {
  const systemOne = vi.fn(async (req: Parameters<JevClient["systemOne"]>[0]) => ({
    model: "jev-1.13.0", answers: answersFor(req, pick, flagYes), usage: { input_tokens: 800, output_tokens: 0 },
  }));
  return { jev: { systemOne } as JevClient, systemOne };
};

function fakeStore(batches: AiCandidate[][], history: VendorHistoryRow[] = [], over: Partial<AiStore> = {}) {
  const recorded: Parameters<AiStore["record"]>[0][] = [];
  const store: AiStore = {
    context: async () => ctx(),
    budget: async () => ({ used: 0, budget: 2_000_000, remaining: 2_000_000 }),
    candidates: async () => batches.shift() ?? [],
    requestDone: async () => false,
    vendorHistory: async (vendors) => history.filter((h) => vendors.includes(h.vendor_normalized)),
    record: async (r) => { recorded.push(r); return { inserted: r.suggestions.length, skipped: 0, auto_applied: 0 }; },
    ...over,
  };
  return { store, recorded };
}

describe("Jev request", () => {
  it("sends the allowed fields only, memos only when opted in", () => {
    const { request } = buildJevRequest(ctx(), [candidate(1)], "jev-latest");
    expect(request.state.t1).toEqual({
      date: "2026-10-01", description: "Blue Hen Studio", vendor: "blue hen studio", amount: "-45.00", direction: "money out",
      account_type: "credit_card", recurring: "monthly", unusually_large: false, vendor_past_categories: [],
    });
    const withMemos = buildJevRequest(ctx({ share_memos: true }), [candidate(1)], "jev-latest").request;
    expect((withMemos.state.t1 as { memo?: string }).memo).toBe("card 4242");
  });

  it("asks one category choice and four flags per transaction, with a none-of-these option", () => {
    const { request } = buildJevRequest(ctx(), [candidate(1), candidate(2)], "jev-latest");
    expect(Object.keys(request.questions)).toHaveLength(10);
    const q = request.questions.t2_category as { type: string; criteria: Record<string, unknown> };
    expect(q.type).toBe("choice");
    expect(Object.keys(q.criteria)).toEqual(["Software", "Meals", TRANSFER_LABEL, NONE_LABEL]);
  });

  it("keeps category labels unique when two categories share a name", () => {
    const labels = categoryLabels(ctx({ categories: [
      { id: REFUNDS_IN, name: "Refunds", type: "income", description: null },
      { id: REFUNDS_OUT, name: "Refunds", type: "expense", description: null },
    ] }));
    expect([...labels.entries()]).toEqual([["Refunds (income)", REFUNDS_IN], ["Refunds (expense)", REFUNDS_OUT]]);
  });
});

describe("reading Jev answers", () => {
  const labels = categoryLabels(ctx());
  const answer = (probabilities: Record<string, number>, flags: number[] = [0, 0, 0, 0]) => ({
    t1_category: { type: "choice", choice: "x", probabilities },
    ...Object.fromEntries(flags.map((p, j) => [`t1_flag${j}`, { type: "noul", noul: p }])),
  });

  it("scores a decisive pick against its closest rival and keeps the runner-up", () => {
    const [s] = readJevAnswers(answer({ Software: 0.8, Meals: 0.07, [NONE_LABEL]: 0.13 }), [candidate(1)], labels);
    expect(s).toMatchObject({ category_id: SOFT, confidence: 0.92, runner_up_category_id: MEALS, runner_up_confidence: 0.07, reason: "" });
  });

  it("doesn't count a catch-all category as the rival", () => {
    const [s] = readJevAnswers(answer({ Software: 0.77, Meals: 0.02, [NONE_LABEL]: 0.07 }), [candidate(1)], labels, new Set(["Meals"]));
    expect(s.confidence).toBe(0.99);
  });

  it("keeps the raw probability when Jev isn't leaning, and close calls stay under the line", () => {
    expect(pickConfidence(0.5, 0.1)).toBe(0.5);
    expect(pickConfidence(0.71, 0.18)).toBeLessThan(0.85);
    expect(pickConfidence(0.99, 0)).toBe(0.99);
  });

  it("never picks none-of-these: the best real category lands under the line instead", () => {
    const [s] = readJevAnswers(answer({ Software: 0.2, Meals: 0.15, [NONE_LABEL]: 0.65 }), [candidate(1)], labels);
    expect(s.category_id).toBe(SOFT);
    expect(s.confidence).toBeLessThan(0.85);
  });

  it("attaches flags at or above the threshold", () => {
    const [s] = readJevAnswers(answer({ Software: 0.9, Meals: 0.1 }, [FLAG_THRESHOLD, 0.2, 0.95, 0]), [candidate(1)], labels);
    expect(s.flags).toEqual(["possible transfer", "personal?"]);
  });

  it("a likely transfer never clears the Suggested line, from the flag or the transfer option", () => {
    const byFlag = readJevAnswers(answer({ Software: 0.93, Meals: 0.07 }, [0.9, 0, 0, 0]), [candidate(1)], labels)[0];
    expect(byFlag.confidence).toBe(TRANSFER_CONFIDENCE_CAP);
    const byOption = readJevAnswers(answer({ [TRANSFER_LABEL]: 0.7, Software: 0.25, Meals: 0.05 }), [candidate(1)], labels)[0];
    expect(byOption).toMatchObject({ category_id: SOFT, confidence: 0.25, flags: ["possible transfer"] });
  });

  it("skips a transaction with no answer and ignores unknown labels", () => {
    expect(readJevAnswers({}, [candidate(1)], labels)).toEqual([]);
    const [s] = readJevAnswers(answer({ Rent: 0.99, Meals: 0.01 }), [candidate(1)], labels);
    expect(s).toMatchObject({ category_id: MEALS, confidence: 0.01 });
    expect(s.runner_up_category_id).toBeUndefined();
  });
});

describe("vendor history", () => {
  const row = (n: number, total = n, cat = SOFT): VendorHistoryRow => ({ vendor_normalized: "blue hen studio", category_account_id: cat, n, vendor_total: total });

  it("answers when a vendor was filed the same way at least HISTORY_MIN times", () => {
    const { suggestions, rest } = historySuggestions(ctx(), [candidate(1)], [row(HISTORY_MIN)]);
    expect(rest).toEqual([]);
    expect(suggestions[0]).toMatchObject({ category_id: SOFT, confidence: 0.75 });
    expect(historyConfidence(5)).toBeCloseTo(0.857, 3);
  });

  it("leaves thin, mixed or archived history to the model", () => {
    expect(historySuggestions(ctx(), [candidate(1)], [row(HISTORY_MIN - 1)]).rest).toHaveLength(1);
    expect(historySuggestions(ctx(), [candidate(1)], [row(6, 7), row(1, 7, MEALS)]).rest).toHaveLength(1);
    expect(historySuggestions(ctx(), [candidate(1)], [row(9, 9, REFUNDS_IN)]).rest).toHaveLength(1);
    expect(historySuggestions(ctx(), [candidate(1, { vendor_normalized: null })], [row(9)]).rest).toHaveLength(1);
  });
});

describe("running with Jev", () => {
  it("records Jev suggestions with the model Jev reports and the Jev prompt version", async () => {
    const { jev, systemOne } = fakeJev();
    const { store, recorded } = fakeStore([[candidate(1), candidate(2)]]);
    const res = await suggestCategories({ store, jev, now: () => 0 });
    expect(res).toMatchObject({ status: "done", suggested: 2 });
    expect(systemOne).toHaveBeenCalledOnce();
    expect(recorded[0]).toMatchObject({ model: "jev-1.13.0", promptVersion: JEV_PROMPT_VERSION, inputTokens: 800 });
    expect(recorded[0].suggestions[0]).toMatchObject({ category_id: SOFT, confidence: 0.938, runner_up_category_id: MEALS });
  });

  it("splits a batch into parallel chunks", async () => {
    const { jev, systemOne } = fakeJev();
    const batch = Array.from({ length: JEV_CHUNK * 2 + 3 }, (_, i) => candidate(i + 1, { vendor_normalized: `v${i}` }));
    const { store, recorded } = fakeStore([batch]);
    await suggestCategories({ store, jev });
    expect(systemOne).toHaveBeenCalledTimes(3);
    expect(recorded[0].suggestions).toHaveLength(batch.length);
    expect(new Set(recorded[0].suggestions.map((s) => s.transaction_id)).size).toBe(batch.length);
  });

  it("history answers first, and only the rest go to Jev", async () => {
    const { jev, systemOne } = fakeJev();
    const { store, recorded } = fakeStore(
      [[candidate(1), candidate(2, { vendor_normalized: "new vendor" })]],
      [{ vendor_normalized: "blue hen studio", category_account_id: SOFT, n: 12, vendor_total: 12 }],
    );
    const res = await suggestCategories({ store, jev });
    expect(res.suggested).toBe(2);
    expect(recorded.map((r) => r.model)).toEqual([HISTORY_MODEL, "jev-1.13.0"]);
    expect(recorded[0]).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    const sent = systemOne.mock.calls[0][0];
    expect((sent.state.t1 as { vendor: string }).vendor).toBe("new vendor");
    expect(sent.state.t2).toBeUndefined();
  });

  it("makes no Jev call when history answers everything", async () => {
    const { jev, systemOne } = fakeJev();
    const { store } = fakeStore([[candidate(1)]], [{ vendor_normalized: "blue hen studio", category_account_id: SOFT, n: 5, vendor_total: 5 }]);
    expect((await suggestCategories({ store, jev })).suggested).toBe(1);
    expect(systemOne).not.toHaveBeenCalled();
  });

  it("reports a Jev failure without throwing", async () => {
    const jev: JevClient = { systemOne: vi.fn(async () => { throw new Error("503"); }) };
    const { store } = fakeStore([[candidate(1)]]);
    expect(await suggestCategories({ store, jev })).toMatchObject({ status: "failed" });
  });
});
