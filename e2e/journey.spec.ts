// The whole path a new user takes, end to end in the UI: create a business (onboarding adds
// its first account), give it an opening balance, import a CSV, accept the AI suggestions
// (on by default; the real suggestion engine runs against a local stand-in for the
// Anthropic API), then download the P&L and balance sheet PDFs.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { chooseImportAccount, chooseImportFile, continueToReview, createBusiness, signInDirect, uniqueEmail } from "./helpers";

const CSV = [
  "Date,Description,Amount",
  "09/02/2026,CLIENT PAYMENT INV 2041,2500.00",
  "09/03/2026,BLUE BOTTLE COFFEE,-6.50",
  "09/05/2026,ADOBE CREATIVE CLOUD,-54.99",
  "09/08/2026,UBER TRIP,-23.40",
  "09/10/2026,MYSTERY VENDOR 99,-12.00",
].join("\n");

test("create business, import, accept AI suggestions, download P&L and balance sheet PDFs", async ({ page }) => {
  test.setTimeout(120_000);
  await signInDirect(page, uniqueEmail("journey"));

  // Create the business; onboarding adds its checking account and opens the import.
  const id = await createBusiness(page, "Journey Bakery", "Bakery Checking");

  // Give the checking account an opening balance.
  await page.goto(`/b/${id}/accounts`);
  const card = page.getByTestId("money-account").filter({ hasText: "Bakery Checking" });
  await card.getByRole("button", { name: "More for Bakery Checking" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Opening balance", { exact: true }).fill("1,000.00");
  await dialog.getByLabel("Opening balance date").fill("2026-09-01");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(card.getByTestId("balance")).toHaveText("$1,000.00");

  // Category suggestions are on by default for a new business.
  await page.goto(`/b/${id}/settings`);
  await expect(page.getByRole("switch", { name: "Category suggestions" })).toBeChecked();

  // Import the CSV into the checking account.
  await page.goto(`/b/${id}/import`);
  await chooseImportAccount(page, "Bakery Checking");
  await chooseImportFile(page, { name: "september.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  const batch = await continueToReview(page);
  await expect(page.getByTestId("totals-count")).toHaveText("5");
  await page.getByRole("button", { name: "Import 5 transactions" }).click();
  // The outcome: the four confident rows are filed during the import, the mystery vendor waits.
  const outcome = page.getByTestId("import-outcome");
  await expect(outcome.getByText("Imported 5 transactions")).toBeVisible({ timeout: 30_000 });
  await expect(outcome.getByTestId("outcome-filed")).toHaveText("4");
  await expect(outcome.getByTestId("outcome-review")).toHaveText("1");
  await outcome.getByRole("button", { name: "Review 1" }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?type=uncategorized&batch=${batch}`));

  // Suggestions arrive after the commit (run after the response). The four confident ones are
  // filed automatically; the mystery vendor waits for a person.
  await page.goto(`/b/${id}/transactions`);
  const rows = page.getByTestId("txn-row").filter({ visible: true });
  const auto = page.locator('[data-testid="txn-row"][data-status="auto"]').filter({ visible: true });
  await expect(async () => {
    await page.reload();
    await expect(auto).toHaveCount(4, { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  const coffee = rows.filter({ hasText: "BLUE BOTTLE" });
  await expect(coffee.getByTestId("category-cell")).toContainText("Meals");
  await expect(page.getByTestId("suggestion-chip").filter({ visible: true })).toHaveCount(1);
  await expect(rows.filter({ hasText: "MYSTERY VENDOR" }).getByTestId("suggestion-chip")).toBeVisible();
  await page.getByTestId("tab-auto").click();
  await expect(rows).toHaveCount(4);

  // P&L for September: income 2,500.00; expenses 6.50 + 54.99 + 23.40 + 12.00 (uncategorized).
  await page.goto(`/b/${id}/reports/pnl?date=custom&from=2026-09-01&to=2026-09-30`);
  await expect(page.locator('[data-line="net_income"] td').nth(1)).toHaveText("$2,403.11");
  const download = async (format: "PDF" | "CSV" | "Excel (XLSX)") => {
    await page.getByTestId("downloads").filter({ visible: true }).click();
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: format }).click()]);
    return { name: d.suggestedFilename(), body: await readFile((await d.path())!) };
  };
  const pnl = await download("PDF");
  expect(pnl.name).toBe("journey-bakery_profit-and-loss_2026-09-01_2026-09-30.pdf");
  expect(pnl.body.subarray(0, 5).toString()).toBe("%PDF-");

  await page.goto(`/b/${id}/reports/balance-sheet?asof=2026-09-30`);
  await expect(page.locator('[data-line="total_assets"] td').nth(1)).toHaveText("$3,403.11");
  await expect(page.getByTestId("imbalance")).toHaveCount(0);
  const bs = await download("PDF");
  expect(bs.name).toBe("journey-bakery_balance-sheet_2026-09-30_2026-09-30.pdf");
  expect(bs.body.subarray(0, 5).toString()).toBe("%PDF-");
});
