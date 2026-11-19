// Reconcile to statement: enter the statement, tick cleared transactions, finish at zero.
import { expect, test } from "@playwright/test";
import { post, setup } from "./transactions-fixtures";

// Phase 2: hidden in MVP
test.skip("reconcile checking to a statement", async ({ page }) => {
  const { db, ids } = await setup(page);
  await post(db, ids.id, { date: "2026-09-01", money: ids.checking, amount: 100000, desc: "Deposit", cat: ids.sales });
  await post(db, ids.id, { date: "2026-09-03", money: ids.checking, amount: -2500, desc: "Bank fee", cat: ids.fees });
  await post(db, ids.id, { date: "2026-09-25", money: ids.checking, amount: -1000, desc: "After statement", cat: ids.fees });

  await page.goto(`/b/${ids.id}/accounts`);
  await page.getByRole("link", { name: "Reconcile Ops Checking" }).click();
  await page.getByLabel("Statement ending date").fill("2026-09-20");
  await page.getByLabel("Statement ending balance").fill("975.00");
  await page.getByRole("button", { name: "Start reconciling" }).click();

  await expect(page.getByTestId("rec-line")).toHaveCount(2); // not the one after the statement date
  await expect(page.getByTestId("rec-difference")).toHaveText("$975.00");
  const finish = page.getByRole("button", { name: "Finish reconciling" });
  await expect(finish).toBeDisabled();

  await page.getByLabel(/^Cleared: Deposit/).check();
  await expect(page.getByTestId("rec-difference")).toHaveText("-$25.00");
  await page.getByLabel(/^Cleared: Bank fee, minus 25 dollars/).check();
  await expect(page.getByTestId("rec-difference")).toHaveText("$0.00");
  await finish.click();
  await expect(page.getByText("Statement reconciled")).toBeVisible();
  await expect(page.getByTestId("reconciled-history")).toContainText("Statement ending 2026-09-20");

  // The next statement starts from this one's balance.
  await page.getByLabel("Statement ending date").fill("2026-09-30");
  await page.getByLabel("Statement ending balance").fill("965.00");
  await page.getByRole("button", { name: "Start reconciling" }).click();
  await expect(page.getByTestId("rec-beginning")).toHaveText("$975.00");
  await expect(page.getByTestId("rec-line")).toHaveCount(1);
});
