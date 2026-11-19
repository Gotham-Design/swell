import { expect, test, type Page } from "@playwright/test";
import { must } from "./helpers";
import { count, post, setup, today, visibleRows, type Db } from "./transactions-fixtures";

const drawer = (page: Page) => page.getByTestId("transaction-drawer");
const row = (page: Page, text: string) => visibleRows(page).filter({ hasText: text });

/** An existing transaction's drawer folds amount, account and type away; unfold it. */
async function showDetails(page: Page) {
  const more = drawer(page).getByTestId("drawer-more");
  if (!(await more.evaluate((d) => (d as HTMLDetailsElement).open))) await more.locator("summary").click();
}

/** Turn the list's "Show deleted transactions" (under "More filters") on or off. */
async function toggleShowDeleted(page: Page) {
  await page.getByTestId("more-filters").filter({ visible: true }).click();
  await page.getByLabel("Show deleted transactions").click();
}

async function pickCategory(page: Page, name: string) {
  await drawer(page).getByRole("button", { name: /Category/ }).click();
  await page.getByPlaceholder("Search categories…").fill(name);
  await page.getByRole("option", { name, exact: true }).click();
}

/** P&L total: every income and expense account's balance (debit-positive). */
async function pnl(db: Db, businessId: string) {
  const rows = must(await db.from("account_balances").select("type, balance_cents").eq("business_id", businessId));
  return rows.filter((r) => r.type === "income" || r.type === "expense").reduce((s, r) => s + (r.balance_cents ?? 0), 0);
}

test("add, edit, delete and undo round trip, with the audit trail", async ({ page }) => {
  const { email, db, ids } = await setup(page);
  await page.goto(`/b/${ids.id}/transactions`);

  // Add. The client checks the form before anything is sent.
  await page.getByRole("button", { name: "Add transaction" }).filter({ visible: true }).click();
  await drawer(page).getByLabel("Description").fill("SQ *BLUE BOTTLE COFFEE Oakland CA");
  await drawer(page).getByRole("button", { name: "Add transaction" }).click();
  await expect(drawer(page).getByText("Enter an amount like 45.99")).toBeVisible();
  await drawer(page).getByLabel("Amount").fill("45.99");
  await pickCategory(page, "Meals");
  await drawer(page).getByLabel("Memo").fill("Team coffee");
  await drawer(page).getByLabel("Reference").fill("R-1");
  await drawer(page).getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added")).toBeVisible();

  // Saved with the normalized description and vendor.
  const added = row(page, "Blue Bottle Coffee");
  await expect(added).toContainText("blue bottle coffee");
  await expect(added.getByTestId("amount")).toHaveText("-$45.99");
  await expect(added.getByTestId("category-cell")).toHaveText("Meals");
  const saved = must(await db.from("transactions").select("description_raw, description_clean, vendor_normalized, memo, reference, source").eq("business_id", ids.id).single());
  expect(saved).toEqual({ description_raw: "SQ *BLUE BOTTLE COFFEE Oakland CA", description_clean: "Blue Bottle Coffee",
    vendor_normalized: "blue bottle coffee", memo: "Team coffee", reference: "R-1", source: "manual" });

  // Edit in the same drawer.
  await added.getByRole("button", { name: "Open Blue Bottle Coffee" }).click();
  await expect(drawer(page).getByRole("heading", { name: "Blue Bottle Coffee" })).toBeVisible();
  await showDetails(page);
  await drawer(page).getByLabel("Amount").fill("50");
  await pickCategory(page, "Travel");
  await drawer(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Transaction saved")).toBeVisible();
  await expect(added.getByTestId("amount")).toHaveText("-$50.00");
  await expect(added.getByTestId("category-cell")).toHaveText("Travel");

  // The audit trail: who changed what, when.
  await added.getByRole("button", { name: "Open Blue Bottle Coffee" }).click();
  await drawer(page).getByTestId("history").locator("summary").click();
  const history = drawer(page).getByTestId("history-entry");
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText(`${email} changed it`);
  await expect(history.first()).toContainText("Amount: -$45.99 → -$50.00");
  await expect(history.first()).toContainText("Category: Meals → Travel");
  await expect(history.last()).toContainText(`${email} added it`);

  // Delete from the drawer, then Undo from the toast.
  await drawer(page).getByRole("button", { name: "Delete" }).click();
  await expect(count(page)).toHaveText("0");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Restored 1")).toBeVisible();
  await expect(count(page)).toHaveText("1");

  // Delete again; it shows under "Show deleted" and restores from there.
  await added.getByRole("button", { name: "Open Blue Bottle Coffee" }).click();
  await drawer(page).getByRole("button", { name: "Delete" }).click();
  await expect(count(page)).toHaveText("0");
  await expect(drawer(page)).toHaveCount(0);
  // The checkbox reflects the URL, so it flips after the navigation.
  await toggleShowDeleted(page);
  await expect(page).toHaveURL(/deleted=1/);
  await expect(page.getByTestId("deleted-banner")).toBeVisible();
  await expect(count(page)).toHaveText("1");
  await row(page, "Blue Bottle Coffee").getByRole("checkbox").click();
  await page.getByTestId("bulk-bar").getByRole("button", { name: "Restore" }).click();
  await expect(count(page)).toHaveText("0");
  await toggleShowDeleted(page);
  await expect(page).not.toHaveURL(/deleted=1/);
  await expect(count(page)).toHaveText("1");
});

test("bulk delete confirms the count and total, and can be undone", async ({ page }) => {
  const { db, ids } = await setup(page);
  for (const [amount, desc] of [[-1000, "Bulk A"], [-2550, "Bulk B"], [500, "Bulk C"]] as const) {
    await post(db, ids.id, { date: today, money: ids.checking, amount, desc });
  }
  await page.goto(`/b/${ids.id}/transactions`);
  await page.getByRole("checkbox", { name: "Select all on this page" }).filter({ visible: true }).click();
  await page.getByTestId("bulk-bar").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("delete-summary")).toContainText("3 transactions totaling -$30.50");
  await page.getByRole("button", { name: "Delete 3" }).click();
  await expect(count(page)).toHaveText("0");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(count(page)).toHaveText("3");
});

test("a transfer moves money between accounts and leaves the P&L unchanged", async ({ page }) => {
  const { db, ids } = await setup(page);
  await post(db, ids.id, { date: today, money: ids.checking, amount: 100000, desc: "Sale", cat: ids.sales });
  await post(db, ids.id, { date: today, money: ids.visa, amount: -40000, desc: "Supplies", cat: ids.office });
  const before = await pnl(db, ids.id);

  await page.goto(`/b/${ids.id}/transactions`);
  await page.getByRole("button", { name: "Add transaction" }).filter({ visible: true }).click();
  await drawer(page).getByRole("radio", { name: "Transfer" }).click();
  await drawer(page).getByLabel("From", { exact: true }).selectOption({ label: "Ops Checking" });
  await drawer(page).getByLabel("To", { exact: true }).selectOption({ label: "Ops Visa" });
  await drawer(page).getByLabel("Amount").fill("300");
  await drawer(page).getByLabel("Description").fill("Pay the card");
  await drawer(page).getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added")).toBeVisible();

  const t = row(page, "Pay The Card");
  await expect(t.getByTestId("category-cell")).toHaveText("Ops Visa");
  await expect(t.getByTestId("amount")).toHaveText("-$300.00");
  const posted = must(await db.from("transactions").select("kind").eq("business_id", ids.id).eq("description_raw", "Pay the card").single());
  expect(posted.kind).toBe("transfer");

  expect(await pnl(db, ids.id)).toBe(before);
  const bal = must(await db.from("account_balances").select("account_id, natural_balance_cents").in("account_id", [ids.checking, ids.visa]));
  expect(bal.find((b) => b.account_id === ids.checking)?.natural_balance_cents).toBe(70000);
  expect(bal.find((b) => b.account_id === ids.visa)?.natural_balance_cents).toBe(10000);

  // Opening it again shows it as a transfer.
  await t.getByRole("button", { name: /Open/ }).click();
  await showDetails(page);
  await expect(drawer(page).getByRole("radio", { name: "Transfer" })).toHaveAttribute("aria-checked", "true");
});

test("locked rows show a lock and refuse edits in the UI and at the database", async ({ page }) => {
  const { db, ids } = await setup(page);
  const lockedId = await post(db, ids.id, { date: "2026-01-15", money: ids.checking, amount: -1200, desc: "January rent", cat: ids.office });
  await post(db, ids.id, { date: today, money: ids.checking, amount: -800, desc: "Open row" });
  must(await db.from("businesses").update({ lock_date: "2026-01-31" }).eq("id", ids.id).select("id"));

  await page.goto(`/b/${ids.id}/transactions`);
  const locked = row(page, "January Rent");
  await expect(locked.getByTestId("lock-icon")).toBeVisible();
  await locked.getByTestId("lock-icon").hover();
  await expect(page.getByText(/Books are closed through 2026-01-31/).first()).toBeVisible();
  await expect(locked.getByRole("button", { name: /Category for/ })).toHaveCount(0);
  await expect(locked.getByRole("checkbox")).toBeDisabled();
  await expect(row(page, "Open Row").getByTestId("lock-icon")).toHaveCount(0);

  // The drawer opens read-only and explains why.
  await locked.getByRole("button", { name: /Open/ }).click();
  await expect(drawer(page).getByTestId("locked-note")).toBeVisible();
  await showDetails(page);
  await expect(drawer(page).getByLabel("Amount")).toBeDisabled();
  await expect(drawer(page).getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(drawer(page).getByRole("button", { name: "Delete" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The database refuses too, whatever the UI shows.
  const edit = await db.rpc("update_transaction", {
    p_transaction_id: lockedId, p_date: "2026-01-15", p_money_account_id: ids.checking, p_amount_cents: -1,
    p_description_raw: "Sneaky", p_category_account_id: ids.office, p_description_clean: "", p_vendor_normalized: "",
    p_memo: "", p_reference: "", p_dedupe_hash: "",
  });
  expect(edit.error?.message).toMatch(/locked/);
  expect((await db.rpc("soft_delete_transaction", { p_transaction_id: lockedId })).error?.message).toMatch(/locked/);
  expect((await db.rpc("categorize_transactions", { p_transaction_ids: [lockedId], p_category_account_id: ids.meals })).error?.message).toMatch(/locked/);
  const unchanged = must(await db.from("transactions").select("amount_cents, deleted_at, category_account_id").eq("id", lockedId).single());
  expect(unchanged).toEqual({ amount_cents: -1200, deleted_at: null, category_account_id: ids.office });
});
