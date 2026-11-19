import { expect, test, type Page } from "@playwright/test";
import { normalizeDescription } from "../src/lib/transactions/normalize";
import { chooseImportAccount, chooseImportFile, continueToReview, must } from "./helpers";
import { setup, type Db } from "./transactions-fixtures";

// 6 good rows, 3 bad rows, 2 copies of good rows (in-file duplicates), and 4 rows that
// are already in the books.
const EXISTING = [
  ["08/01/2026", "STARBUCKS #123 SEATTLE WA", "-5.75"],
  ["08/02/2026", "SHELL OIL 57444 HOUSTON TX", "-48.20"],
  ["08/03/2026", "ACME CORP PAYROLL", "3200.00"],
  ["08/04/2026", "NETFLIX.COM LOS GATOS CA", "-15.49"],
] as const;
const MESSY = [
  "Date,Description,Amount,Category",
  "08/05/2026,SQ *BLUE BOTTLE COFFEE Oakland CA,-6.50,Coffee Stuff",
  "08/06/2026,TST* JOES DINER 1234 SEATTLE WA,-23.40,Meals",
  "08/07/2026,CLIENT PAYMENT INV 1001,1500.00,",
  "08/08/2026,ADOBE *CREATIVE CLOUD 408-536-6000 CA,-54.99,",
  "08/09/2026,SQ *BLUE BOTTLE COFFEE Oakland CA,-7.25,Coffee Stuff",
  "08/10/2026,COSTCO WHSE #0123 ISSAQUAH WA,-212.18,",
  "13/45/2026,BAD DATE ROW,-1.00,",
  "08/11/2026,BAD AMOUNT ROW,abc,",
  "08/12/2026,,-3.00,",
  "08/05/2026,SQ *BLUE BOTTLE COFFEE Oakland CA,-6.50,Coffee Stuff",
  "08/06/2026,TST* JOES DINER 1234 SEATTLE WA,-23.40,Meals",
  ...EXISTING.map((r) => `${r.join(",")},`),
].join("\n");

const csv = (body: string, name = "messy.csv") => ({ name, mimeType: "text/csv", buffer: Buffer.from(body) });

/** Stage a file into Ops Checking; a second file with the same columns skips the mapping step. */
async function stage(page: Page, businessId: string, body: string, name?: string) {
  await page.goto(`/b/${businessId}/import`);
  await chooseImportAccount(page, "Ops Checking");
  await chooseImportFile(page, csv(body, name));
  return continueToReview(page);
}
const tab = (page: Page, t: string) => page.getByTestId(`tab-${t}`);
async function totalBalance(db: Db, businessId: string) {
  const rows = must(await db.from("account_balances").select("balance_cents").eq("business_id", businessId));
  return rows.reduce((s, r) => s + (r.balance_cents ?? 0), 0);
}

test("verify and commit import exactly the right rows; re-import adds 0; undo keeps the books balanced", async ({ page }) => {
  test.setTimeout(120_000);
  const { db, ids } = await setup(page);
  for (const [date, desc, amount] of EXISTING) {
    const [m, d, y] = date.split("/");
    must(await db.rpc("post_transaction", {
      p_business_id: ids.id, p_date: `${y}-${m}-${d}`, p_money_account_id: ids.checking,
      p_amount_cents: Math.round(Number(amount) * 100), p_description_raw: desc,
      p_description_clean: normalizeDescription(desc).description_clean, p_vendor_normalized: normalizeDescription(desc).vendor_normalized ?? undefined,
    }));
  }

  const batch = await stage(page, ids.id, MESSY);
  await expect(page.getByTestId("totals-rows")).toHaveText("15");
  await expect(tab(page, "all")).toContainText("15");
  await expect(tab(page, "problems")).toContainText("3");
  await expect(tab(page, "duplicates")).toContainText("6");
  await expect(tab(page, "import")).toContainText("6");

  // Problems: the bad cell is highlighted and explained.
  await tab(page, "problems").click();
  const problemRows = page.getByTestId("import-row");
  await expect(problemRows).toHaveCount(3);
  await expect(page.locator('[data-row="7"] [data-testid="cell-date"]')).toHaveAttribute("data-bad", "true");
  await expect(page.locator('[data-row="8"] [data-testid="cell-amount"]')).toHaveAttribute("data-bad", "true");
  await expect(page.locator('[data-row="9"] [data-testid="cell-description"]')).toHaveAttribute("data-bad", "true");
  await expect(page.locator('[data-row="8"]')).toContainText(`Can't read the amount "abc"`);

  // Duplicates explain themselves.
  await tab(page, "duplicates").click();
  await expect(page.locator('[data-row="10"]')).toContainText("Same as row 1 in this file");
  await expect(page.locator('[data-row="12"]')).toContainText("Already in your books: Aug 1 · same date and amount");

  // An unmatched category from the file: create it.
  const unmatched = page.getByTestId("unmatched-category");
  await expect(unmatched).toHaveCount(1);
  await expect(unmatched).toContainText("Coffee Stuff · 3 rows"); // includes the in-file copy
  await page.getByRole("button", { name: "Create category Coffee Stuff" }).click();
  await expect(page.getByTestId("category-matcher")).toHaveCount(0);

  // Totals, then commit. Committing lands on this import's rows in Transactions (To review tab).
  await expect(page.getByTestId("totals-count")).toHaveText("6");
  await expect(page.getByTestId("totals-in")).toHaveText("+$1,500.00");
  await expect(page.getByTestId("totals-out")).toHaveText("-$304.32");
  await page.getByRole("button", { name: "Import 6 transactions" }).click();
  const outcome = page.getByTestId("import-outcome");
  await expect(outcome.getByText("Imported 6 transactions")).toBeVisible({ timeout: 30_000 });
  await outcome.getByRole("button", { name: /^(Review \d+|Done)$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?.*batch=${batch}`));
  await expect(page.getByTestId("batch-banner").filter({ visible: true })).toBeVisible();

  const posted = must(await db.from("transactions").select("description_raw, amount_cents, category_account_id, source").eq("import_batch_id", batch).order("date"));
  expect(posted.map((t) => t.description_raw)).toEqual([
    "SQ *BLUE BOTTLE COFFEE Oakland CA", "TST* JOES DINER 1234 SEATTLE WA", "CLIENT PAYMENT INV 1001",
    "ADOBE *CREATIVE CLOUD 408-536-6000 CA", "SQ *BLUE BOTTLE COFFEE Oakland CA", "COSTCO WHSE #0123 ISSAQUAH WA",
  ]);
  expect(posted.every((t) => t.source === "import")).toBe(true);
  const coffee = must(await db.from("accounts").select("id").eq("business_id", ids.id).eq("name", "Coffee Stuff").single()).id;
  expect(posted.filter((t) => t.category_account_id === coffee)).toHaveLength(2);
  expect(posted[1].category_account_id).toBe(ids.meals);
  expect(await totalBalance(db, ids.id)).toBe(0);

  // The import's page shows the result and links to the imported rows.
  await page.goto(`/b/${ids.id}/import/${batch}`);
  await expect(page.getByTestId("import-committed")).toContainText("Imported 6 transactions");
  await page.getByRole("link", { name: "View the imported transactions" }).click();
  await expect(page).toHaveURL(new RegExp(`batch=${batch}`));
  await expect(page.getByTestId("summary-count").filter({ visible: true })).toHaveText("6");

  // Re-importing the same file adds 0.
  const again = await stage(page, ids.id, MESSY, "messy-again.csv");
  await expect(tab(page, "import")).toHaveCount(0); // tabs with nothing in them are hidden
  await expect(page.getByTestId("totals-count")).toHaveText("0");
  await expect(page.getByRole("button", { name: /Import 0 transactions/ })).toBeDisabled();

  // Undo the first import: its rows go, the books still balance.
  await page.goto(`/b/${ids.id}/import/${batch}`);
  await page.getByRole("button", { name: "Undo import" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByTestId("import-undone")).toBeVisible();
  const live = must(await db.from("transactions").select("id").eq("import_batch_id", batch).is("deleted_at", null));
  expect(live).toHaveLength(0);
  expect(await totalBalance(db, ids.id)).toBe(0);

  // With the first import undone, the second staged copy would import the 6 rows again.
  await page.goto(`/b/${ids.id}/import/${again}`);
  await page.getByTestId("review-footer").getByRole("button", { name: "Cancel import" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel import" }).click();
  await expect(page).toHaveURL(new RegExp(`/b/${ids.id}/import$`));
});

test("fix a cell inline, flip the sign, override duplicates, go back to mapping, balance check", async ({ page }) => {
  const { ids } = await setup(page);
  page.on("dialog", (d) => d.accept());
  // A file where positive amounts are money out (a deposit shows as negative).
  const body = [
    "Date,Description,Amount,Balance",
    "2026-09-01,OPENING DEPOSIT,-1000.00,1000.00",
    "2026-09-02,COFFEE,4.50,995.50",
    "2026-09-02,COFFEE,4.50,991.00",       // a real second coffee, same amount and day
    "2026-09-33,BROKEN DATE,10.00,981.00",
  ].join("\n");
  const batch = await stage(page, ids.id, body, "flip.csv");

  // Read as "positive is money in", the balance breaks at the first coffee.
  await expect(page.getByTestId("balance-check")).toContainText("The running balance doesn't add up");
  await expect(page.getByTestId("balance-check")).toContainText("At row 2 it should be $1,004.50");
  await page.getByRole("button", { name: "Flip money in and out" }).click();
  await expect(page.getByTestId("balance-check")).toContainText("Totals match your statement");
  await expect(page.getByTestId("totals-in")).toHaveText("+$1,000.00");

  // Fix the broken date inline.
  await page.getByRole("button", { name: /Fix date on row 4/ }).click();
  await page.getByLabel("Fix date on row 4").fill("2026-09-03");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-row="4"]')).toHaveAttribute("data-status", "ok");
  await expect(tab(page, "problems")).toHaveCount(0); // tabs with nothing in them are hidden

  // The second coffee is an in-file duplicate; it's real, so import it anyway.
  await expect(page.locator('[data-row="3"]')).toHaveAttribute("data-status", "duplicate");
  await page.locator('[data-row="3"]').getByRole("button", { name: "Import anyway" }).click();
  await expect(page.getByTestId("totals-count")).toHaveText("4");
  await expect(page.getByTestId("totals-out")).toHaveText("-$19.00");
  // ...and skip the opening row.
  await page.locator('[data-row="1"]').getByRole("button", { name: "Skip" }).click();
  await expect(page.getByTestId("totals-count")).toHaveText("3");
  await expect(page.getByTestId("totals-in")).toHaveText("$0.00");
  await expect(page.locator('[data-row="1"] [data-testid="row-status"]')).toHaveText("Skipped");

  // Back to mapping reopens the same file and mapping, even after a reload.
  await page.reload();
  await page.getByTestId("review-footer").getByText("Back to mapping").click();
  await expect(page.getByTestId("file-summary")).toContainText("flip.csv · 4 rows");
  await expect(page.locator("#map-balance")).toHaveValue("3");
  const restaged = await continueToReview(page);
  expect(restaged).not.toBe(batch);
  await page.goto(`/b/${ids.id}/import`);
  await expect(page.getByTestId("recent-imports").getByRole("listitem")).toHaveCount(1);
});
