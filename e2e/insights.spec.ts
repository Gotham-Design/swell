// Insights panel on the overview and transactions pages: its figures match the pattern
// table, large payments filter the list in one click, "Review with AI" opens review mode,
// and a cached "Explain this month" summary is shown.
import { expect, test, type Page } from "@playwright/test";
import { formatCents } from "../src/lib/money";
import { must } from "./helpers";
import { post, setup, shifted } from "./transactions-fixtures";

async function seed(page: Page) {
  const s = await setup(page);
  const { db, ids } = s;
  const p = (date: string, amount: number, desc: string, vendor: string, cat?: string) =>
    post(db, ids.id, { date, money: ids.visa, amount, desc, vendor, cat });
  for (let m = -5; m <= 0; m++) await p(shifted(m, 1), -4500, "FIGMA MONTHLY", "figma", ids.office);
  const big = await p(shifted(0, 1), -1500000, "DELL LAPTOPS", "dell", ids.office);
  const zoom = await p(shifted(0, 1), -1599, "ZOOM.US", "zoom");
  must(await db.from("businesses").update({ large_threshold_cents: 1_000_000 }).eq("id", ids.id).select("id"));
  must(await db.rpc("refresh_patterns", { p_business_id: ids.id }));
  return { ...s, big, zoom };
}

// Phase 2: hidden in MVP
test.skip("panel figures match the pattern table; a large payment filters the list", async ({ page }) => {
  const { db, ids } = await seed(page);
  await page.goto(`/b/${ids.id}`);
  const panel = page.getByTestId("insights");
  await expect(panel).toBeVisible();

  const recurring = must(await db.from("transaction_patterns").select("vendor_normalized, expected_amount_cents, expected_next_date, cadence")
    .eq("business_id", ids.id).eq("kind", "recurring"));
  expect(recurring.map((r) => r.vendor_normalized)).toEqual(["figma"]);
  const row = panel.getByTestId("recurring-row").filter({ hasText: "figma" });
  await expect(row.getByTestId("recurring-expected")).toHaveText(formatCents(recurring[0].expected_amount_cents!));
  await expect(row).toContainText(recurring[0].expected_next_date!);
  await expect(row).toContainText("Monthly");
  await expect(row.getByTestId("recurring-annual")).toHaveText(formatCents(recurring[0].expected_amount_cents! * 12));

  const large = must(await db.from("transaction_patterns").select("amount_cents, large_rules").eq("business_id", ids.id).eq("kind", "large"));
  expect(large).toEqual([{ amount_cents: -1500000, large_rules: ["threshold"] }]);
  const largeRow = panel.getByTestId("large-row");
  await expect(largeRow).toHaveCount(1);
  await expect(largeRow).toContainText("-$15,000.00");
  await expect(largeRow).toContainText("Over your threshold");

  await expect(panel.getByTestId("new-vendors")).toContainText("zoom");
  await expect(panel.getByTestId("new-vendors")).toContainText("dell");
  await expect(panel.getByTestId("new-vendors")).not.toContainText("figma"); // first seen months ago
  await expect(panel.getByTestId("top-vendors").locator("li").first()).toContainText("dell");
  await expect(panel.getByTestId("top-vendors").locator("li").first()).toContainText("$15,000.00");

  const { count } = await db.from("transactions").select("id", { count: "exact", head: true })
    .eq("business_id", ids.id).is("category_account_id", null).is("deleted_at", null);
  await expect(panel.getByTestId("uncategorized-count")).toHaveText(String(count));

  await largeRow.getByRole("link").click();
  await expect(page).toHaveURL(/\/transactions\?/);
  await expect(page.getByTestId("summary-count").filter({ visible: true })).toHaveText("1");
  await expect(page.getByTestId("txn-row").filter({ visible: true })).toContainText("DELL LAPTOPS");
});

// Phase 2: hidden in MVP
test.skip("Review with AI opens review mode; a cached explanation is shown", async ({ page }) => {
  const { db, ids, zoom } = await seed(page);
  must(await db.from("businesses").update({ ai_enabled: true }).eq("id", ids.id).select("id"));
  must(await db.rpc("record_ai_suggestions", {
    p_business_id: ids.id, p_request_key: `insights-e2e-${Date.now()}`, p_model: "claude-haiku-5-5", p_prompt_version: "e2e",
    p_latency_ms: 1, p_input_tokens: 1, p_output_tokens: 1,
    p_suggestions: [{ transaction_id: zoom, category_id: ids.office, confidence: 0.9, reason: "Video calls", flags: [] }],
  }));
  const from = shifted(0, 1);
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const explained = await db.rpc("record_ai_explanation", {
    p_business_id: ids.id, p_from: from, p_to: to, p_input_hash: "older-numbers", p_summary: "A quiet month apart from new laptops.",
    p_model: "claude-haiku-5-5", p_prompt_version: "e2e", p_input_tokens: 10, p_output_tokens: 10, p_latency_ms: 1,
  });
  expect(explained.error).toBeNull(); // returns nothing

  await page.goto(`/b/${ids.id}`);
  const panel = page.getByTestId("insights");
  await expect(panel.getByTestId("explain-summary")).toHaveText("A quiet month apart from new laptops.");
  await expect(panel.getByText("The numbers changed since this was written.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Explain again" })).toBeEnabled();

  await panel.getByRole("button", { name: "Review with AI" }).click();
  await expect(page).toHaveURL(/type=uncategorized&review=1/);
  await expect(page.getByTestId("review-dialog")).toContainText("1 of 1");
  await expect(page.getByTestId("review-item")).toContainText(/zoom/i);
});

// Phase 2: hidden in MVP
test.skip("transactions page shows the panel for the filtered period", async ({ page }) => {
  const { ids } = await seed(page);
  await page.goto(`/b/${ids.id}/transactions?date=custom&from=${shifted(-5, 1)}&to=${shifted(-5, 28)}`);
  const panel = page.getByTestId("insights").filter({ visible: true });
  await expect(panel.getByTestId("large-row")).toHaveCount(0);
  await expect(panel.getByTestId("new-vendors")).toContainText("figma");
  await expect(panel.getByTestId("insights-uncategorized")).toBeVisible();
  // No AI: no explain box, and a plain link instead of "Review with AI".
  await expect(panel.getByTestId("explain")).toHaveCount(0);
  await expect(panel.getByRole("link", { name: "Show them" })).toBeVisible();
});
