import { expect, test, type Page } from "@playwright/test";
import { createBusiness, must, signInDirect, uniqueEmail, userClient } from "./helpers";

const account = (page: Page, name: string) => page.getByTestId("money-account").filter({ visible: true }).and(page.locator(`[data-name="${name}"]`));

async function addAccount(page: Page, f: { name: string; kind: string; last4?: string; opening?: string; date?: string }) {
  // The header's "Add account" opens the dialog (the dialog's own submit has the same name).
  await page.getByRole("main").filter({ visible: true }).getByRole("button", { name: "Add account" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(f.name);
  await dialog.getByLabel("Type").selectOption({ label: f.kind });
  if (f.last4) await dialog.getByLabel("Last 4 digits (optional)").fill(f.last4);
  if (f.opening) await dialog.getByLabel("Opening balance", { exact: true }).fill(f.opening);
  if (f.date) await dialog.getByLabel("Opening balance date").fill(f.date);
  await dialog.getByRole("button", { name: "Add account" }).click();
}

test("money accounts: opening balances make balances correct and keep the books balanced", async ({ page }) => {
  const email = uniqueEmail("owner");
  await signInDirect(page, email);
  // Onboarding creates the first account (no opening balance); add the rest on the accounts page.
  const id = await createBusiness(page, "Foxtrot Freight", "Payroll Checking");
  await page.getByRole("link", { name: "Money accounts" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(new RegExp(`/b/${id}/accounts$`));
  await expect(account(page, "Payroll Checking").getByTestId("balance")).toHaveText("$0.00");

  await addAccount(page, { name: "Operating Checking", kind: "Checking", last4: "1234", opening: "$5,000.00", date: "2026-01-01" });
  await expect(account(page, "Operating Checking").getByTestId("balance")).toHaveText("$5,000.00");
  await expect(account(page, "Operating Checking")).toContainText("Checking ··1234");

  await addAccount(page, { name: "Business Visa", kind: "Credit card", opening: "1,200", date: "2026-01-01" });
  await expect(account(page, "Business Visa").getByTestId("balance")).toHaveText("$1,200.00");
  await expect(account(page, "Business Visa")).toContainText("Balance owed");

  await addAccount(page, { name: "Cash Drawer", kind: "Cash" });
  await expect(account(page, "Cash Drawer").getByTestId("balance")).toHaveText("$0.00");

  // A name that collides with the chart gets a helpful error.
  await addAccount(page, { name: "Checking", kind: "Checking" });
  await expect(page.getByRole("dialog").getByText(/already an account named "Checking"/)).toBeVisible();
  await page.keyboard.press("Escape");

  // The books still balance, and Opening Balance Equity holds the difference.
  const db = await userClient(email);
  const balances = must(await db.from("account_balances").select("name, balance_cents, natural_balance_cents").eq("business_id", id));
  expect(balances.reduce((s, b) => s + (b.balance_cents ?? 0), 0)).toBe(0);
  expect(balances.find((b) => b.name === "Opening Balance Equity")?.natural_balance_cents).toBe(380000);

  // Editing the opening balance changes the account balance.
  await account(page, "Operating Checking").getByRole("button", { name: "More for Operating Checking" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("dialog").getByLabel("Opening balance", { exact: true })).toHaveValue("5000.00");
  await expect(page.getByRole("dialog").getByLabel("Opening balance date")).toHaveValue("2026-01-01");
  await page.getByRole("dialog").getByLabel("Opening balance", { exact: true }).fill("6500");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(account(page, "Operating Checking").getByTestId("balance")).toHaveText("$6,500.00");
  const after = must(await db.from("account_balances").select("balance_cents").eq("business_id", id));
  expect(after.reduce((s, b) => s + (b.balance_cents ?? 0), 0)).toBe(0);

  // The overview lists the accounts and moves on to importing a statement.
  await page.getByRole("link", { name: "Overview" }).filter({ visible: true }).click();
  await expect(page.getByTestId("money-accounts").filter({ visible: true })).toContainText("Operating Checking");
  await expect(page.getByTestId("getting-started").filter({ visible: true })).toContainText("Import your first statement");
});
