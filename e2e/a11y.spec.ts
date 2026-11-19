// Accessibility: axe (WCAG 2.1 A/AA, including color contrast) on the main MVP screens, a
// keyboard-only pass through transactions, import and reports, and spoken labels on amounts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { chooseImportFile, must } from "./helpers";
import { post, setup } from "./transactions-fixtures";

async function axe(page: Page, name: string) {
  // Controls are disabled (dimmed) until hydration; check the page people actually use.
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !document.querySelector("select[disabled], [data-slot=native-select][disabled]"));
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} ${n.html.slice(0, 120)} ${(n.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 160)}`).join(" | ")}`);
  expect(summary, `axe violations on ${name}`).toEqual([]);
}

async function seed(page: Page) {
  const s = await setup(page);
  await post(s.db, s.ids.id, { date: "2026-09-01", money: s.ids.checking, amount: 300000, desc: "Client payment", cat: s.ids.sales });
  await post(s.db, s.ids.id, { date: "2026-09-02", money: s.ids.visa, amount: -4550, desc: "Lunch", cat: s.ids.meals });
  const zoom = await post(s.db, s.ids.id, { date: "2026-09-03", money: s.ids.visa, amount: -1599, desc: "ZOOM.US" });
  must(await s.db.from("businesses").update({ ai_enabled: true }).eq("id", s.ids.id).select("id"));
  must(await s.db.rpc("record_ai_suggestions", {
    p_business_id: s.ids.id, p_request_key: `a11y-${Date.now()}`, p_model: "claude-haiku-5-5", p_prompt_version: "a11y",
    p_latency_ms: 1, p_input_tokens: 1, p_output_tokens: 1,
    p_suggestions: [{ transaction_id: zoom, category_id: s.ids.office, confidence: 0.9, reason: "Video calls", flags: [] }],
  }));
  must(await s.db.rpc("refresh_patterns", { p_business_id: s.ids.id }));
  return s;
}

// Reconcile and Rules are Phase 2 (hidden in MVP), so they're no longer in this pass.
test("axe: overview, transactions, import, reports, money accounts, categories, settings", async ({ page }) => {
  const { ids } = await seed(page);
  const pages: [string, string][] = [
    [`/b/${ids.id}`, "overview-card"],
    [`/b/${ids.id}/transactions`, "txn-row"],
    [`/b/${ids.id}/import`, "dropzone"],
    [`/b/${ids.id}/reports/pnl?date=custom&from=2026-09-01&to=2026-09-30&cmp=yoy`, "pnl"],
    [`/b/${ids.id}/reports/balance-sheet?asof=2026-09-30&cmp=fy_end`, "balance-sheet"],
    [`/b/${ids.id}/accounts`, "money-account-list"],
    [`/b/${ids.id}/categories`, "category-table"],
    [`/b/${ids.id}/settings`, "members"],
  ];
  for (const [url, ready] of pages) {
    await page.goto(url);
    await expect(page.getByTestId(ready).filter({ visible: true }).first()).toBeVisible();
    await axe(page, url);
  }
});

test("amounts have spoken labels", async ({ page }) => {
  const { ids } = await seed(page);
  await page.goto(`/b/${ids.id}/transactions`);
  await expect(page.getByLabel("minus 45 dollars and 50 cents").filter({ visible: true })).toBeVisible();
  await page.goto(`/b/${ids.id}/reports/pnl?date=custom&from=2026-09-01&to=2026-09-30`);
  await expect(page.locator('[data-line="net_income"] [aria-label^="Net income"]').first())
    .toHaveAttribute("aria-label", /^Net income: 2,938 dollars and 51 cents/);
});

test("keyboard only: categorize, accept a suggestion, open a report drill-down", async ({ page }) => {
  const { ids } = await seed(page);
  await page.goto(`/b/${ids.id}/transactions`);
  await expect(page.getByTestId("txn-row").filter({ visible: true }).first()).toBeVisible();

  // Tab to the suggestion chip and accept it with Enter.
  const chip = page.getByTestId("suggestion-chip");
  for (let i = 0; i < 80 && !(await chip.evaluate((el) => el === document.activeElement).catch(() => false)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(chip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("txn-row").filter({ visible: true }).filter({ hasText: "ZOOM.US" })).toContainText("Office Supplies");

  // j/k to a row, c opens the picker, type and Enter to choose.
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  await page.keyboard.type("Travel");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("txn-row").filter({ visible: true }).nth(1)).toContainText("Travel");

  // Reports: change the period from the keyboard and follow a drill-down with Enter.
  await page.goto(`/b/${ids.id}/reports/pnl?date=custom&from=2026-09-01&to=2026-09-30`);
  const period = page.getByTestId("report-controls").filter({ visible: true });
  await expect(period).toBeEnabled();
  await period.focus();
  await page.keyboard.press("Enter"); // opens the period popover
  const ytd = page.getByRole("option", { name: "Year to date" });
  await expect(ytd).toBeVisible();
  await ytd.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/date=ytd/);
  await page.goto(`/b/${ids.id}/reports/pnl?date=custom&from=2026-09-01&to=2026-09-30`);
  const drill = page.locator(`[data-line="${ids.sales}"] a`);
  await page.waitForLoadState("networkidle");
  await drill.focus();
  await expect(drill).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/transactions\\?.*cat=${ids.sales}`));
});

test("keyboard only: import wizard to the review screen and commit", async ({ page }) => {
  const { ids } = await setup(page);
  await page.goto(`/b/${ids.id}/import`);
  // Account tiles are radios: focus one and pick it with Space.
  const account = page.getByRole("radio", { name: "Ops Checking", exact: true });
  await expect(account).toBeEnabled();
  await account.focus();
  await page.keyboard.press("Space");
  await expect(account).toBeChecked();
  await chooseImportFile(page, {
    name: "bank.csv", mimeType: "text/csv",
    buffer: Buffer.from("Date,Description,Amount\n09/01/2026,COFFEE SHOP,-4.50\n09/02/2026,CLIENT PAYMENT,1200.00\n"),
  });
  const go = page.getByRole("button", { name: "Continue to review" });
  await go.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await axe(page, "import review");
  const commit = page.getByRole("button", { name: "Import 2 transactions" });
  await expect(commit).toBeEnabled();
  await commit.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("import-outcome").getByText("Imported 2 transactions")).toBeVisible();
  await expect(page).toHaveURL(/\/transactions\?type=uncategorized&batch=/);
});
