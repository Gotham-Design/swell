import { expect, test } from "@playwright/test";
import { createBusiness, signInDirect, uniqueEmail } from "./helpers";

/** A month-end inside the "Close books through" list (the last twelve month-ends). */
function recentMonthEnd() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 0)).toISOString().slice(0, 10);
}

test("an owner edits details, closes the books and turns off category suggestions", async ({ page }) => {
  await signInDirect(page, uniqueEmail("owner"));
  const id = await createBusiness(page, "Delta Labs");
  await page.goto(`/b/${id}/settings`);
  const save = page.getByRole("button", { name: "Save changes" });
  await expect(save).toBeEnabled(); // enabled once hydrated

  // Category suggestions: on by default for new businesses, with the data-sharing note.
  await expect(page.getByText(/statement files are never used/)).toBeVisible();
  const ai = page.getByRole("switch", { name: "Category suggestions" });
  await expect(ai).toBeChecked();

  // Details, books and the switch all save with the one "Save changes" button.
  const lockDate = recentMonthEnd();
  await page.getByLabel("Business name").fill("Delta Labs Inc");
  await page.getByLabel("Legal name").fill("Delta Laboratories LLC");
  await page.getByLabel("Fiscal year starts").selectOption({ label: "July" });
  await page.getByLabel("Close books through").selectOption(lockDate);
  await ai.click();
  await expect(ai).not.toBeChecked();
  await save.click();
  await expect(page.getByText("Changes saved")).toBeVisible();
  await expect(page.getByTestId("current-business").filter({ visible: true })).toHaveAttribute("data-name", "Delta Labs Inc");

  // Validation errors come back per field.
  await page.getByLabel("Business name").fill(" ");
  await save.click();
  await expect(page.getByText("Enter a business name")).toBeVisible();

  // Everything persisted.
  await page.reload();
  await expect(page.getByLabel("Business name")).toHaveValue("Delta Labs Inc");
  await expect(page.getByLabel("Legal name")).toHaveValue("Delta Laboratories LLC");
  await expect(page.getByLabel("Fiscal year starts")).toHaveValue("7");
  await expect(page.getByLabel("Close books through")).toHaveValue(lockDate);
  await expect(page.getByRole("switch", { name: "Category suggestions" })).not.toBeChecked();
});
