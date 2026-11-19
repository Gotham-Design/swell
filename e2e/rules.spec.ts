// Rules end to end: create one from a transaction, edit its conditions, preview it against
// history, apply, undo; suggested rules from the pattern engine; reorder, toggle, duplicate,
// delete with revert; the test box; the drawer filling a category from a rule; imports;
// and the large-transaction threshold setting.
import { expect, test, type Page } from "@playwright/test";
import { normalizeDescription } from "../src/lib/transactions/normalize";
import { must } from "./helpers";
import { post, setup, type Db } from "./transactions-fixtures";

const ADOBE = "ADOBE *CREATIVE CLOUD 408-536-6000 CA";
const vendorOf = (d: string) => normalizeDescription(d).vendor_normalized!;
type Ids = Awaited<ReturnType<typeof setup>>["ids"];

async function postNamed(db: Db, ids: Ids, date: string, desc: string, cents: number, cat?: string) {
  const n = normalizeDescription(desc);
  return must(await db.rpc("post_transaction", {
    p_business_id: ids.id, p_date: date, p_money_account_id: ids.checking, p_amount_cents: cents, p_description_raw: desc,
    p_category_account_id: cat, p_description_clean: n.description_clean, p_vendor_normalized: n.vendor_normalized ?? undefined,
  }));
}
const rowById = (page: Page, id: string) => page.locator(`[data-testid="txn-row"][data-id="${id}"]`).filter({ visible: true });
const categoryOf = async (db: Db, id: string) => must(await db.from("transactions").select("category_account_id, category_source").eq("id", id).single());

// Phase 2: hidden in MVP
test.skip("create a rule from a transaction, edit it, preview against history, apply, undo", async ({ page }) => {
  const { db, ids } = await setup(page);
  const first = await postNamed(db, ids, "2026-08-01", "AMZN MKTP US*1A", -1999, ids.office);
  const small = await postNamed(db, ids, "2026-08-05", "AMZN MKTP US*2B", -2450);
  const big = await postNamed(db, ids, "2026-08-09", "AMZN MKTP US*3C", -12000);
  const hand = await postNamed(db, ids, "2026-08-10", "AMZN MKTP US*4D", -1500, ids.meals);
  const netBefore = must(await db.rpc("report_pnl", { p_business_id: ids.id, p_from: "2026-08-01", p_to: "2026-08-31" }))
    .find((r) => r.key === "net_income")!.total_cents;

  await page.goto(`/b/${ids.id}/transactions`);
  const row = rowById(page, first);
  await row.getByRole("cell").nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Create rule from this transaction" }).click();
  const builder = page.getByTestId("rule-builder");
  await expect(builder.getByLabel("Condition 1 field")).toHaveValue("vendor_normalized");
  await expect(builder.getByLabel("Category")).toHaveValue(ids.office);

  // Edit: description contains "amzn mktp" and amount under $50.
  await builder.getByLabel("Condition 1 field").selectOption("description_raw");
  await builder.getByLabel("Condition 1 operator").selectOption("contains");
  await builder.getByLabel("Condition 1 value").fill("amzn mktp");
  await expect(builder.getByTestId("rule-match-count")).toHaveText("Matches 4 existing transactions");
  await builder.getByRole("button", { name: "Add condition" }).click();
  await builder.getByLabel("Condition 2 operator").selectOption("lt");
  await builder.getByLabel("Condition 2 value").fill("50");
  await expect(builder.getByTestId("rule-match-count")).toHaveText("Matches 3 existing transactions");
  await expect(builder.getByTestId("rule-match-sample").locator("li")).toHaveCount(3);
  await builder.getByLabel("Name").fill("Small Amazon orders");
  await builder.getByRole("button", { name: "Create rule" }).click();

  // Preview: only the uncategorized small order changes (the hand-set one and the $120 one don't).
  const preview = page.getByTestId("apply-preview");
  await expect(preview.getByTestId("preview-row")).toHaveCount(1);
  await expect(preview.getByTestId("preview-row")).toContainText("2026-08-05");
  await expect(preview.getByTestId("preview-row")).toContainText("Office Supplies");
  await preview.getByTestId("apply-confirm").click();
  await expect(page.getByText("Changed 1 transaction")).toBeVisible();
  await expect.poll(async () => categoryOf(db, small)).toEqual({ category_account_id: ids.office, category_source: "rule" });
  expect((await categoryOf(db, big)).category_account_id).toBeNull();
  expect(await categoryOf(db, hand)).toEqual({ category_account_id: ids.meals, category_source: "user" });

  // The Rule badge names the rule and links to it.
  await page.reload();
  const badge = rowById(page, small).getByTestId("ai-slot").getByRole("link");
  await expect(badge).toHaveAccessibleName(/Small Amazon orders/);

  // Undo the run.
  await page.goto(`/b/${ids.id}/rules`);
  await page.getByRole("button", { name: "More for Small Amazon orders" }).click();
  await page.getByRole("menuitem", { name: "Apply to existing" }).click();
  await expect(page.getByTestId("preview-empty")).toBeVisible(); // already applied: nothing more to do
  await page.getByRole("button", { name: "Cancel" }).click();
  must(await db.rpc("categorize_transactions", { p_transaction_ids: [small], p_category_account_id: null as unknown as string }));
  await page.getByRole("button", { name: "More for Small Amazon orders" }).click();
  await page.getByRole("menuitem", { name: "Apply to existing" }).click();
  await page.getByTestId("apply-confirm").click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Restored 1 transaction")).toBeVisible();
  expect(await categoryOf(db, small)).toEqual({ category_account_id: null, category_source: null });
  const netAfter = must(await db.rpc("report_pnl", { p_business_id: ids.id, p_from: "2026-08-01", p_to: "2026-08-31" }))
    .find((r) => r.key === "net_income")!.total_cents;
  expect(netAfter).toBe(netBefore);
  expect(first).toBeTruthy();
});

// Phase 2: hidden in MVP
test.skip("suggested rules: approve from the Rules page, then imports use them", async ({ page }) => {
  const { db, ids } = await setup(page);
  const software = must(await db.from("accounts").select("id").eq("business_id", ids.id).eq("name", "Software & Subscriptions").single()).id;
  for (const date of ["2026-05-03", "2026-06-03", "2026-07-03"]) await postNamed(db, ids, date, ADOBE, -5499, software);
  expect(must(await db.rpc("refresh_patterns", { p_business_id: ids.id }))).toMatchObject({ rules_created: 1 });

  await page.goto(`/b/${ids.id}/rules`);
  await expect(page.getByTestId("nav-badge").filter({ visible: true })).toHaveText("1");
  const suggestion = page.getByTestId("suggested-rule");
  await expect(suggestion).toContainText(`Vendor is ${vendorOf(ADOBE)}`);
  await expect(suggestion).toContainText("chosen 3 times");
  await suggestion.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("rule-row")).toHaveCount(1);
  await expect(page.getByTestId("suggested-rules")).toHaveCount(0);

  // Import: the approved rule categorizes the new Adobe charge.
  await page.goto(`/b/${ids.id}/import`);
  await page.getByLabel("1. Which account is this statement for?").selectOption({ label: "Ops Checking (Checking)" });
  await page.locator("#import-file").setInputFiles({ name: "aug.csv", mimeType: "text/csv",
    buffer: Buffer.from(["Date,Description,Amount", `08/03/2026,${ADOBE},-54.99`].join("\n")) });
  await page.getByRole("button", { name: "Continue to verify" }).click();
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const batch = page.url().split("/import/")[1].split("?")[0];
  await page.getByLabel("These totals match my statement").check();
  await page.getByRole("button", { name: /^Import 1 transactions?$/ }).click();
  await expect(page.getByTestId("import-committed")).toContainText("Imported 1 transaction");
  const [t] = must(await db.from("transactions").select("category_account_id, category_source").eq("import_batch_id", batch));
  expect(t).toEqual({ category_account_id: software, category_source: "rule" });
});

// Phase 2: hidden in MVP
test.skip("reorder, toggle, duplicate, test box, delete with revert", async ({ page }) => {
  const { db, ids } = await setup(page);
  const save = async (name: string, value: string, cat: string) => must(await db.rpc("save_rule", { p_business_id: ids.id, p_rule: {
    name, match_mode: "all", stop_processing: true, enabled: true,
    conditions: [{ field: "description_raw", operator: "contains", value }], actions: [{ action: "set_category", account_id: cat }] } }));
  await save("Coffee is meals", "coffee", ids.meals);
  await save("Coffee beans are office", "coffee beans", ids.office);
  const t = await postNamed(db, ids, "2026-08-01", "BLUE BOTTLE COFFEE BEANS", -2200);

  await page.goto(`/b/${ids.id}/rules`);
  const rows = page.getByTestId("rule-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Coffee is meals");
  await expect(rows.nth(0).getByTestId("rule-summary")).toHaveText("Bank description contains coffee");

  // Test box: the first rule wins for coffee beans.
  const box = page.getByTestId("rule-test");
  await box.getByLabel("Description").fill("BLUE BOTTLE COFFEE BEANS");
  await box.getByLabel("Amount").fill("-22.00");
  await box.getByRole("button", { name: "Test" }).click();
  await expect(box.getByTestId("rule-test-result")).toContainText("“Coffee is meals” wins and sets Meals");

  // Move the narrower rule up; now it wins.
  await page.getByRole("button", { name: "Move Coffee beans are office up" }).click();
  await expect(rows.nth(0)).toContainText("Coffee beans are office");
  await box.getByRole("button", { name: "Test" }).click();
  await expect(box.getByTestId("rule-test-result")).toContainText("“Coffee beans are office” wins and sets Office Supplies");

  // Toggle off, then on.
  const toggle = page.getByRole("switch", { name: "Coffee beans are office enabled" });
  await toggle.click();
  await expect(page.getByText("Rule off")).toBeVisible();
  await expect.poll(async () => must(await db.from("category_rules").select("enabled").eq("name", "Coffee beans are office").eq("business_id", ids.id).single()).enabled).toBe(false);
  await toggle.click();
  await expect(page.getByText("Rule on")).toBeVisible();

  // Duplicate (off by default).
  await page.getByRole("button", { name: "More for Coffee beans are office" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.getByTestId("rule-row").filter({ hasText: "Copy of Coffee beans are office" })).toHaveCount(1);

  // Apply it, then delete it and revert what it did.
  await page.getByRole("button", { name: "Run rules on existing transactions" }).click();
  await page.getByTestId("apply-confirm").click();
  await expect.poll(async () => (await categoryOf(db, t)).category_account_id).toBe(ids.office);
  await page.getByRole("button", { name: "More for Coffee beans are office", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete and revert" }).click();
  await expect(page.getByText(/Rule deleted; 1 reverted/)).toBeVisible();
  expect(await categoryOf(db, t)).toEqual({ category_account_id: null, category_source: null });
});

// Phase 2: hidden in MVP
test.skip("the drawer fills an empty category from a matching rule", async ({ page }) => {
  const { db, ids } = await setup(page);
  must(await db.rpc("save_rule", { p_business_id: ids.id, p_rule: {
    name: "Uber is travel-ish", match_mode: "all", stop_processing: true, enabled: true,
    conditions: [{ field: "description_raw", operator: "contains", value: "uber" }], actions: [{ action: "set_category", account_id: ids.meals }] } }));
  await page.goto(`/b/${ids.id}/transactions`);
  await page.getByRole("button", { name: "Add transaction" }).click();
  const drawer = page.getByTestId("transaction-drawer");
  await drawer.getByLabel("Amount").fill("23.40");
  await drawer.getByLabel("Description").fill("UBER TRIP 123");
  await expect(page.getByTestId("drawer-rule-hint")).toContainText("Uber is travel-ish");
  await drawer.getByRole("button", { name: "Add transaction" }).click();
  await expect(drawer).toHaveCount(0);
  await expect.poll(async () => must(await db.from("transactions").select("category_account_id, category_source")
    .eq("business_id", ids.id).ilike("description_raw", "UBER%"))).toEqual([{ category_account_id: ids.meals, category_source: "rule" }]);
  const [{ id }] = must(await db.from("transactions").select("id").eq("business_id", ids.id).ilike("description_raw", "UBER%"));
  await expect(rowById(page, id).getByTestId("category-cell")).toContainText("Meals");
  await expect(rowById(page, id).getByTestId("ai-slot")).toHaveText("Rule");
});

// Phase 2: hidden in MVP
test.skip("large-transaction threshold is set in Settings", async ({ page }) => {
  const { db, ids } = await setup(page);
  await post(db, ids.id, { date: "2026-08-01", money: ids.checking, amount: -750000, desc: "New forklift", cat: ids.office });
  await page.goto(`/b/${ids.id}/settings`);
  await page.getByLabel("Flag money out over").fill("5,000");
  await page.getByRole("button", { name: "Save threshold" }).click();
  await expect(page.getByText("Threshold saved")).toBeVisible();
  expect(must(await db.from("businesses").select("large_threshold_cents").eq("id", ids.id).single()).large_threshold_cents).toBe(500000);

  must(await db.rpc("refresh_patterns", { p_business_id: ids.id }));
  const large = must(await db.from("transaction_patterns").select("amount_cents, large_rules").eq("business_id", ids.id).eq("kind", "large"));
  expect(large).toEqual([{ amount_cents: -750000, large_rules: ["threshold"] }]);

  await page.getByLabel("Flag money out over").fill("-3");
  await page.getByRole("button", { name: "Save threshold" }).click();
  await expect(page.getByText("Enter an amount over $0, or leave it blank")).toBeVisible();
});
