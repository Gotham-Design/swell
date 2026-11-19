// Timing test: runs in its own Playwright project after every other spec, so it measures
// the app rather than contention with parallel tests.
import { expect, test } from "@playwright/test";
import { must } from "./helpers";
import { count, post, setup, today } from "./transactions-fixtures";

test("bulk categorize of 200 rows finishes in under 2 seconds", async ({ page }) => {
  const { db, ids } = await setup(page);
  for (let start = 0; start < 200; start += 25) {
    await Promise.all(Array.from({ length: 25 }, (_, i) =>
      post(db, ids.id, { date: today, money: ids.checking, amount: -(100 + start + i), desc: `Bulk row ${start + i + 1}` })));
  }

  await page.goto(`/b/${ids.id}/transactions?type=uncategorized`);
  await expect(count(page)).toHaveText("200");
  await expect(page.getByTestId("showing").filter({ visible: true })).toHaveText("Showing 1–50 of 200");

  await page.getByRole("checkbox", { name: "Select all on this page" }).filter({ visible: true }).click();
  await page.getByTestId("bulk-bar").getByRole("button", { name: "Select all 200", exact: true }).click();
  await expect(page.getByTestId("bulk-bar").getByTestId("selected-count")).toHaveText("200");
  await page.getByTestId("bulk-bar").getByRole("button", { name: "Set category" }).click();
  await page.getByPlaceholder("Search categories…").fill("Office");

  const started = Date.now();
  await page.getByRole("option", { name: "Office Supplies", exact: true }).click();
  // The toast no longer reports the server's own time, so only click-to-confirmation is measured.
  await expect(page.getByText("Categorized 200 transactions")).toBeVisible();
  const elapsed = Date.now() - started;
  expect(elapsed, "click to confirmation").toBeLessThan(2000);

  const left = must(await db.rpc("summarize_transactions", { p_business_id: ids.id, p_types: ["uncategorized"] }).single());
  expect(Number(left.count)).toBe(0);
  await expect(count(page)).toHaveText("0");
});
