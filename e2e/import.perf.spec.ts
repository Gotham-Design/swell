// Timing: runs alone after the other specs (see playwright.config.ts).
import { expect, test } from "@playwright/test";
import { chooseImportAccount, chooseImportFile, must } from "./helpers";
import { setup } from "./transactions-fixtures";

test("a 20,000-row file verifies in under 10 seconds (and commits)", async ({ page }) => {
  test.setTimeout(180_000);
  const { db, ids } = await setup(page);
  const vendors = ["SQ *BLUE BOTTLE COFFEE Oakland CA", "AMAZON.COM*2K4LM8Q90 AMZN.COM/BILLWA", "SHELL OIL 57444 HOUSTON TX", "GUSTO PAYROLL", "ADOBE *CREATIVE CLOUD"];
  const lines = ["Date,Description,Amount,Balance"];
  let balance = 0;
  for (let i = 0; i < 20_000; i++) {
    const d = new Date(Date.UTC(2025, 0, 1 + Math.floor(i / 60)));
    const amount = i % 25 === 0 ? 2500 + (i % 7) : -((i % 900) + 1) / 100;
    balance = Math.round((balance + amount) * 100) / 100;
    lines.push(`${d.toISOString().slice(0, 10)},"${vendors[i % vendors.length]} ${i}",${amount.toFixed(2)},${balance.toFixed(2)}`);
  }
  const file = { name: "big.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) };

  await page.goto(`/b/${ids.id}/import`);
  await chooseImportAccount(page, "Ops Checking");
  await chooseImportFile(page, file);
  await expect(page.getByTestId("file-summary")).toContainText("20,000 rows");

  const started = Date.now();
  await page.getByTestId("continue-to-review").click();
  await expect(page.getByTestId("totals-count")).toHaveText("20,000", { timeout: 30_000 });
  const verifyMs = Date.now() - started;
  console.log(`verify 20k rows: ${verifyMs} ms`);
  expect(verifyMs, "upload, stage and verify 20,000 rows").toBeLessThan(10_000);
  await expect(page.getByTestId("balance-check")).toContainText("Totals match your statement");

  const commitStarted = Date.now();
  await page.getByRole("button", { name: "Import 20,000 transactions" }).click();
  await expect(page.getByTestId("import-outcome").getByText("Imported 20,000 transactions")).toBeVisible({ timeout: 60_000 });
  console.log(`commit 20k rows: ${Date.now() - commitStarted} ms`);

  // The balances read right after a big import once took 5–30s (row estimates for a
  // business the statistics haven't seen yet); see 20261025000001_balances_view_estimates.
  const readStarted = Date.now();
  const rows = must(await db.from("account_balances").select("balance_cents").eq("business_id", ids.id));
  const readMs = Date.now() - readStarted;
  console.log(`balances after commit: ${readMs} ms`);
  expect(readMs, "balances read right after the commit").toBeLessThan(1000);
  expect(rows.reduce((s, r) => s + (r.balance_cents ?? 0), 0)).toBe(0);

  // Don't leave 20,000 rows behind in the local database for the next run.
  const deleted = await db.from("businesses").delete().eq("id", ids.id).select("id");
  expect(deleted.error).toBeNull();
  expect(deleted.data).toHaveLength(1);
});
