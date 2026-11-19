// AI suggestions in the transaction list. The model call itself is unit-tested with a
// mocked SDK (src/lib/ai/engine.test.ts); here suggestions are recorded through the same
// database function the engine uses, and the UI decides them (row chips, bulk accept on
// selected rows, the drawer's suggestion).
import { expect, test, type Page } from "@playwright/test";
import { must } from "./helpers";
import { post, setup, type Db } from "./transactions-fixtures";

type Ids = Awaited<ReturnType<typeof setup>>["ids"];
let seq = 0;
async function record(db: Db, ids: Ids, items: { txn: string; cat: string; conf: number; reason?: string }[], tokens = 1200) {
  return must(await db.rpc("record_ai_suggestions", {
    p_business_id: ids.id, p_request_key: `e2e-key-${Date.now()}-${seq++}`, p_model: "claude-haiku-5-5",
    p_prompt_version: "e2e", p_latency_ms: 900, p_input_tokens: tokens - 200, p_output_tokens: 200,
    p_suggestions: items.map((i) => ({ transaction_id: i.txn, category_id: i.cat, confidence: i.conf,
      reason: i.reason ?? "Matches earlier purchases", flags: [] })),
  }));
}
const row = (page: Page, text: string) => page.getByTestId("txn-row").filter({ visible: true }).filter({ hasText: text });
const categoryOf = async (db: Db, id: string) =>
  must(await db.from("transactions").select("category_account_id, category_source").eq("id", id).single());

const chips = (page: Page) => page.getByTestId("suggestion-chip").filter({ visible: true });

async function seed(page: Page) {
  const s = await setup(page);
  // On by default for new businesses; set explicitly so the tests don't depend on that. Auto-filing
  // is off here so suggestions stay pending for the UI to decide (journey.spec covers auto-filing).
  must(await s.db.from("businesses").update({ ai_enabled: true, ai_auto_file: false }).eq("id", s.ids.id).select("id"));
  const p = (date: string, amount: number, desc: string) => post(s.db, s.ids.id, { date, money: s.ids.visa, amount, desc });
  const t = {
    figma: await p("2026-09-01", -4500, "FIGMA MONTHLY"),
    uber: await p("2026-09-02", -2300, "UBER TRIP"),
    adobe: await p("2026-09-03", -5499, "ADOBE CREATIVE"),
  };
  return { ...s, t };
}

test("chip: Enter accepts, Backspace rejects; nothing changes without a decision", async ({ page }) => {
  const { db, ids, t } = await seed(page);
  await record(db, ids, [
    { txn: t.figma, cat: ids.office, conf: 0.95, reason: "Design tool subscription" },
    { txn: t.uber, cat: ids.meals, conf: 0.85 },
    { txn: t.adobe, cat: ids.fees, conf: 0.6 },
  ]);
  for (const id of Object.values(t)) expect((await categoryOf(db, id)).category_account_id).toBeNull();

  await page.goto(`/b/${ids.id}/transactions`);
  await expect(chips(page)).toHaveCount(3);
  const chip = row(page, "Figma").getByTestId("suggestion-chip");
  await expect(chip).toContainText("Office Supplies");
  await expect(chip).toContainText("95%");
  await expect(row(page, "Figma")).toHaveAttribute("data-status", "suggested");
  await expect(row(page, "Adobe")).toHaveAttribute("data-status", "review");

  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(row(page, "Figma").getByTestId("category-cell")).toContainText("Office Supplies");
  await expect(row(page, "Figma").getByTestId("suggestion")).toHaveCount(0);
  expect(await categoryOf(db, t.figma)).toEqual({ category_account_id: ids.office, category_source: "user" });

  // Backspace (like ✕) opens the category picker right away; closing it changes nothing.
  const uberChip = row(page, "Uber").getByTestId("suggestion-chip");
  await uberChip.focus();
  await page.keyboard.press("Backspace");
  await expect(page.getByPlaceholder("Search categories…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Search categories…")).toBeHidden();
  expect((await categoryOf(db, t.uber)).category_account_id).toBeNull();
  const statuses = must(await db.from("ai_suggestions").select("transaction_id, status").eq("business_id", ids.id));
  expect(statuses.find((s) => s.transaction_id === t.uber)?.status).toBe("pending");
  await expect(chips(page)).toHaveCount(2);
});

test("bulk: accept the suggestions on the selected rows", async ({ page }) => {
  const { db, ids, t } = await seed(page);
  await record(db, ids, [
    { txn: t.figma, cat: ids.office, conf: 0.95 },
    { txn: t.uber, cat: ids.meals, conf: 0.85 },
    { txn: t.adobe, cat: ids.fees, conf: 0.6 },
  ]);
  await page.goto(`/b/${ids.id}/transactions`);
  await row(page, "Figma").getByRole("checkbox").click();
  await row(page, "Uber").getByRole("checkbox").click();
  const bar = page.getByTestId("bulk-bar");
  await expect(bar.getByTestId("selected-count")).toHaveText("2");
  await bar.getByTestId("accept-selected").click(); // "Accept 2 suggestions"
  await expect(page.getByText("Accepted 2 suggestions")).toBeVisible();
  expect((await categoryOf(db, t.figma)).category_account_id).toBe(ids.office);
  expect((await categoryOf(db, t.uber)).category_account_id).toBe(ids.meals);
  expect((await categoryOf(db, t.adobe)).category_account_id).toBeNull();
  await expect(chips(page)).toHaveCount(1);
});

test("review: the To review tab, the drawer's suggestion, and correcting with the picker", async ({ page }) => {
  const { db, ids, t } = await seed(page);
  await record(db, ids, [
    { txn: t.figma, cat: ids.office, conf: 0.95 },
    { txn: t.uber, cat: ids.meals, conf: 0.85 },
    { txn: t.adobe, cat: ids.fees, conf: 0.6 },
  ]);
  await page.goto(`/b/${ids.id}/transactions`);
  await page.getByTestId("tab-review").filter({ visible: true }).click();
  await expect(page).toHaveURL(/type=uncategorized/);
  await expect(page.getByTestId("txn-row").filter({ visible: true })).toHaveCount(3);

  // Accept from the drawer.
  await row(page, "Figma").getByRole("button", { name: /^Open / }).click();
  const drawer = page.getByTestId("transaction-drawer");
  const suggestion = drawer.getByTestId("drawer-suggestion");
  await expect(suggestion).toContainText("Suggested");
  await expect(suggestion).toContainText("95% sure");
  await suggestion.getByRole("button", { name: "Use Office Supplies" }).click();
  await expect(page.getByText("Filed under Office Supplies")).toBeVisible();
  await expect(page.getByTestId("txn-row").filter({ visible: true })).toHaveCount(2);

  // ✕ then Escape: nothing decided, the suggestion stays.
  await row(page, "Uber").getByRole("button", { name: "Reject Meals" }).click();
  await expect(page.getByPlaceholder("Search categories…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row(page, "Uber").getByTestId("suggestion")).toHaveCount(1);

  // ✕ and correct it with the picker that opens.
  await row(page, "Adobe").getByRole("button", { name: "Reject Bank Fees" }).click();
  await page.getByPlaceholder("Search categories…").fill("Software");
  await page.getByRole("option", { name: /Software & Subscriptions/ }).click();

  const software = must(await db.from("accounts").select("id").eq("business_id", ids.id).eq("name", "Software & Subscriptions").single()).id;
  await expect.poll(async () => (await categoryOf(db, t.adobe)))
    .toEqual({ category_account_id: software, category_source: "user" });
  expect((await categoryOf(db, t.figma)).category_account_id).toBe(ids.office);
  expect((await categoryOf(db, t.uber)).category_account_id).toBeNull();
  await expect.poll(async () => must(await db.from("ai_suggestions").select("status").eq("transaction_id", t.adobe).single()).status)
    .toBe("rejected"); // corrected
});

// Phase 2: hidden in MVP (AI model / token budget / auto-apply settings and the budget notice).
test.skip("budget: usage meter in Settings, and a notice when it's used up", async ({ page }) => {
  const { db, ids } = await seed(page);
  await page.goto(`/b/${ids.id}/settings`);
  const form = page.getByTestId("ai-settings");
  await form.getByLabel("Model").selectOption("claude-sonnet-5-5");
  await form.getByLabel("Monthly token budget").fill("20,000");
  await form.getByText("Auto-apply above 90%").click();
  await form.getByRole("button", { name: "Save AI settings" }).click();
  await expect(page.getByText("AI settings saved")).toBeVisible();
  expect(must(await db.from("businesses").select("ai_model, ai_auto_apply, ai_share_memos, ai_monthly_token_budget").eq("id", ids.id).single()))
    .toEqual({ ai_model: "claude-sonnet-5-5", ai_auto_apply: true, ai_share_memos: false, ai_monthly_token_budget: 20000 });

  await record(db, ids, [], 25000); // a call that used more than the budget
  await page.reload();
  await expect(page.getByTestId("ai-usage")).toContainText("25,000 of 20,000 (100%)");

  await page.goto(`/b/${ids.id}/transactions`);
  await expect(page.getByTestId("ai-budget-notice")).toContainText("paused for this month");
  await expect(page.getByRole("button", { name: "Get suggestions" })).toBeDisabled();
});

test("AI off: no suggestions and no way to ask for them", async ({ page }) => {
  const { db, ids, t } = await seed(page);
  await record(db, ids, [{ txn: t.figma, cat: ids.office, conf: 0.95 }]);
  await page.goto(`/b/${ids.id}/transactions`);
  await expect(chips(page)).toHaveCount(1);
  await expect(page.getByTestId("get-suggestions").filter({ visible: true })).toBeVisible(); // 2 rows have none yet

  must(await db.from("businesses").update({ ai_enabled: false }).eq("id", ids.id).select("id"));
  await page.reload();
  await expect(page.getByTestId("txn-row").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByTestId("suggestion-chip")).toHaveCount(0);
  await expect(page.getByTestId("unsuggested")).toHaveCount(0);
  await expect(page.getByTestId("get-suggestions")).toHaveCount(0);
});
