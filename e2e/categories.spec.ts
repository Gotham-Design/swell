import { expect, test, type Page } from "@playwright/test";
import { createBusiness, must, signInDirect, uniqueEmail, userClient } from "./helpers";
import { today } from "./transactions-fixtures";

const row = (page: Page, name: string) => page.getByTestId("category-row").filter({ visible: true }).and(page.locator(`[data-name="${name}"]`));
const detail = (page: Page) => page.getByTestId("category-detail").filter({ visible: true });

/** Unused categories fold away under "Show N unused"; unfold them if they're folded. */
async function showUnused(page: Page) {
  const toggle = page.getByRole("button", { name: /^Show \d+ unused$/ }).filter({ visible: true });
  if (await toggle.count()) await toggle.click();
}

/** Select a category in the table so the detail panel (with its Edit menu) shows it. */
async function select(page: Page, name: string) {
  await showUnused(page);
  await row(page, name).getByRole("link").click();
  await expect(detail(page).getByRole("heading", { level: 2 })).toHaveText(name);
}

/** Run one item from the selected category's Edit menu. */
async function editMenu(page: Page, name: string, item: string) {
  await select(page, name);
  await detail(page).getByRole("button", { name: `Edit ${name}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** Options offered by the "Merge into" picker on a category's merge dialog. */
async function mergeOptions(page: Page, from: string) {
  await editMenu(page, from, "Merge into…");
  const dialog = page.getByRole("dialog");
  const options = await dialog.getByLabel("Merge into").locator("option").allTextContents();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  return options;
}

test("categories: standard chart, custom categories, rename, archive and merge", async ({ page }) => {
  const email = uniqueEmail("owner");
  await signInDirect(page, email);
  const id = await createBusiness(page, "Echo Bakery");
  await page.goto(`/b/${id}/categories`);

  // The standard chart, grouped into Income and Expenses. System, hidden and money accounts aren't listed.
  await showUnused(page);
  await expect(page.getByTestId("group-income")).toContainText("Service Revenue");
  await expect(page.getByTestId("group-expense")).toContainText("Software & Subscriptions");
  await expect(row(page, "Uncategorized")).toHaveCount(0);
  await expect(page.getByText("Accounts Receivable")).toHaveCount(0);
  await select(page, "Meals");
  await expect(detail(page)).toContainText("Business meals");

  // Create a custom category: it appears in the table and in the pickers. Type is Income or Expense only.
  await page.getByRole("button", { name: "New category" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Type").locator("option")).toHaveText(["Income", "Expense"]);
  await dialog.getByLabel("Name").fill("Coworking");
  await dialog.getByLabel("Type").selectOption("expense");
  await dialog.getByLabel("Description").fill("Hot desks and meeting rooms.");
  await dialog.getByRole("button", { name: "Add category" }).click();
  await expect(dialog).toHaveCount(0);
  await select(page, "Coworking");
  await expect(detail(page)).toContainText("Hot desks");
  expect(await mergeOptions(page, "Office Supplies")).toContain("Coworking");

  // Rename a standard category.
  await editMenu(page, "Other Expense", "Rename or move");
  await page.getByRole("dialog").getByLabel("Name").fill("Miscellaneous");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await showUnused(page);
  await expect(row(page, "Miscellaneous")).toHaveCount(1);
  await expect(row(page, "Other Expense")).toHaveCount(0);

  // Archive: gone from pickers, listed under archived, and back on Restore.
  await editMenu(page, "Coworking", "Archive");
  const archived = page.getByTestId("archived").filter({ visible: true });
  await expect(archived).toContainText("Coworking");
  expect(await mergeOptions(page, "Office Supplies")).not.toContain("Coworking");
  await archived.locator("summary").click();
  await archived.getByRole("listitem").filter({ hasText: "Coworking" }).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByTestId("archived")).toHaveCount(0);
  expect(await mergeOptions(page, "Office Supplies")).toContain("Coworking");

  // Merge: every transaction on Snacks moves to Meals. (Counts are for the selected month: post this month.)
  const db = await userClient(email);
  const snacks = must(await db.from("accounts").insert({ business_id: id, name: "Snacks", type: "expense" }).select("id").single()).id;
  const checking = must(await db.rpc("create_money_account", { p_business_id: id, p_name: "Ops Checking", p_kind: "checking" }));
  for (const [amount, desc] of [[-1250, "Costco"], [-899, "Trader Joe's"], [-450, "Vending"]] as const) {
    must(await db.rpc("post_transaction", {
      p_business_id: id, p_date: today, p_money_account_id: checking, p_amount_cents: amount,
      p_description_raw: desc, p_category_account_id: snacks,
    }));
  }
  await page.reload();
  const count = (name: string) => row(page, name).locator("td").nth(1);
  await expect(count("Snacks")).toHaveText("3");
  await editMenu(page, "Snacks", "Merge into…");
  await page.getByRole("dialog").getByLabel("Merge into").selectOption({ label: "Meals" });
  await page.getByRole("dialog").getByRole("button", { name: "Merge" }).click();
  await expect(page.getByText("Merged. 3 transactions moved.")).toBeVisible();
  await expect(page.getByTestId("archived").filter({ visible: true })).toContainText("Snacks");
  await expect(count("Meals")).toHaveText("3");

  const meals = must(await db.from("accounts").select("id").eq("business_id", id).eq("name", "Meals").single()).id;
  const moved = must(await db.from("transactions").select("category_account_id").eq("business_id", id));
  expect(moved).toHaveLength(3);
  expect(moved.every((t) => t.category_account_id === meals)).toBe(true);
  const merges = must(await db.from("audit_log").select("action, after").eq("business_id", id).eq("action", "merge"));
  expect(merges).toHaveLength(1);
});
