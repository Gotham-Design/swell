import { expect, test, type Page } from "@playwright/test";
import { createBusiness, signInDirect, uniqueEmail } from "./helpers";

const taxLine = (page: Page, name: string) =>
  page.getByTestId("category-row").filter({ visible: true }).and(page.locator(`[data-name="${name}"]`)).getByTestId("tax-line");

async function setTaxReturn(page: Page, id: string, label: string) {
  await page.goto(`/b/${id}/settings`);
  await page.getByLabel("Tax return").selectOption({ label });
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
}

// Phase 2: hidden in MVP
test.skip("categories map to tax lines on the business's return", async ({ page }) => {
  await signInDirect(page, uniqueEmail("owner"));
  const id = await createBusiness(page, "Golf Goods");

  // Until a return is picked, categories point to settings.
  await page.goto(`/b/${id}/categories`);
  await expect(page.getByTestId("tax-form-hint")).toBeVisible();

  // Schedule C defaults.
  await setTaxReturn(page, id, "Schedule C (sole proprietor or single-member LLC)");
  await page.goto(`/b/${id}/categories`);
  await expect(page.getByTestId("tax-form-hint")).toHaveCount(0);
  await expect(taxLine(page, "Meals")).toHaveText(" · Schedule C line 24b: Deductible meals");
  await expect(taxLine(page, "Sales")).toContainText("line 1: Gross receipts or sales");
  await expect(taxLine(page, "Interest Income")).toContainText("No tax line");

  // The accountant moves Software & Subscriptions to Office expense.
  await page.getByRole("button", { name: "Edit Software & Subscriptions" }).click();
  await page.getByLabel("Tax line (Schedule C)").selectOption({ label: "18 · Office expense" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(taxLine(page, "Software & Subscriptions")).toContainText("line 18: Office expense");
  await page.reload();
  await expect(taxLine(page, "Software & Subscriptions")).toContainText("line 18: Office expense");

  // Switching to 1120-S shows that form's mapping; switching back keeps the edit.
  await setTaxReturn(page, id, "Form 1120-S (S corporation)");
  await page.goto(`/b/${id}/categories`);
  await expect(taxLine(page, "Meals")).toContainText("Form 1120-S line 20: Other deductions");
  await expect(taxLine(page, "Owner Draws")).toContainText("line Sch K 16d: Distributions");
  await setTaxReturn(page, id, "Schedule C (sole proprietor or single-member LLC)");
  await page.goto(`/b/${id}/categories`);
  await expect(taxLine(page, "Software & Subscriptions")).toContainText("line 18: Office expense");
});
