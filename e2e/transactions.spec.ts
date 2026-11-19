import { expect, test, type Page } from "@playwright/test";
import { must } from "./helpers";
import { count, post, setup, shifted, today, visibleRows } from "./transactions-fixtures";


/** Assert the list shows exactly these descriptions, now and after a reload. */
async function expectRows(page: Page, descriptions: string[], urlPart: RegExp) {
  for (const pass of ["before reload", "after reload"]) {
    await expect(page, pass).toHaveURL(urlPart);
    await expect(count(page), pass).toHaveText(String(descriptions.length));
    if (descriptions.length) await expect(visibleRows(page), pass).toHaveCount(descriptions.length);
    for (const d of descriptions) await expect(visibleRows(page).filter({ hasText: d }), `${pass}: ${d}`).toHaveCount(1);
    if (pass === "before reload") await page.reload();
  }
}

test("filters narrow the list, live in the URL and survive a reload", async ({ page }) => {
  test.setTimeout(120_000); // ~30 navigations and reloads
  const { db, ids } = await setup(page);
  const batch = must(await db.from("import_batches").insert({ business_id: ids.id, money_account_id: ids.checking, status: "committed" }).select("id").single()).id;
  await post(db, ids.id, { date: today, money: ids.checking, amount: 250000, desc: "Invoice 1001 paid", cat: ids.sales });
  await post(db, ids.id, { date: today, money: ids.checking, amount: -4599, desc: "STARBUCKS #123", cat: ids.meals, vendor: "starbucks", memo: "team coffee" });
  await post(db, ids.id, { date: shifted(-1, 1), money: ids.visa, amount: -1250, desc: "SQ *BLUE BOTTLE", vendor: "blue bottle" });
  await post(db, ids.id, { date: shifted(-1, 2), money: ids.checking, amount: -50000, desc: "Card payment", cat: ids.visa });
  await post(db, ids.id, { date: shifted(-12), money: ids.checking, amount: -20000, desc: "Owner draw", cat: ids.draws });
  await post(db, ids.id, { date: today, money: ids.checking, amount: -999, desc: "Imported fee", cat: ids.fees, source: "import", batch });

  const base = `/b/${ids.id}/transactions`;
  await page.goto(base);
  await expectRows(page, ["Invoice 1001 paid", "STARBUCKS #123", "SQ *BLUE BOTTLE", "Card payment", "Owner draw", "Imported fee"], /transactions$/);
  await expect(page.getByTestId("summary-in").filter({ visible: true })).toHaveText("+$2,500.00");
  await expect(page.getByTestId("summary-out").filter({ visible: true })).toHaveText("-$768.48");
  await expect(page.getByTestId("summary-net").filter({ visible: true })).toHaveText("+$1,731.52");

  // Date presets: the period select in the page header.
  const period = async (option: string) => {
    await page.getByTestId("period-select").filter({ visible: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  await period("This month");
  await expectRows(page, ["Invoice 1001 paid", "STARBUCKS #123", "Imported fee"], /date=this_month/);
  await period("Last month");
  await expectRows(page, ["SQ *BLUE BOTTLE", "Card payment"], /date=last_month/);
  await period("Last year");
  await expectRows(page, ["Owner draw"], /date=last_year/);
  await page.getByTestId("period-select").filter({ visible: true }).click();
  await page.getByLabel("From", { exact: true }).fill(shifted(-1, 1));
  await page.getByLabel("To", { exact: true }).fill(shifted(-1, 1));
  await page.getByRole("button", { name: "Apply range" }).click();
  await expectRows(page, ["SQ *BLUE BOTTLE"], /date=custom&from=/);
  await page.goto(base);

  // Type: the list's tabs (To review = uncategorized, Money in = income, Money out = expense).
  const tabCases: [string, string, string[]][] = [
    ["tab-in", "income", ["Invoice 1001 paid"]], ["tab-out", "expense", ["STARBUCKS #123", "Imported fee"]],
    ["tab-review", "uncategorized", ["SQ *BLUE BOTTLE"]],
  ];
  for (const [tab, type, expected] of tabCases) {
    await page.goto(base);
    await page.getByTestId(tab).filter({ visible: true }).click();
    await expectRows(page, expected, new RegExp(`type=${type}$`));
  }
  // Types without a tab (and two at once) still work by URL.
  for (const [type, expected] of [["transfer", ["Card payment"]], ["equity", ["Owner draw"]]] as const) {
    await page.goto(`${base}?type=${type}`);
    await expectRows(page, [...expected], new RegExp(`type=${type}`));
  }
  await page.goto(`${base}?type=uncategorized,income`);
  await expectRows(page, ["Invoice 1001 paid", "SQ *BLUE BOTTLE"], /type=uncategorized(%2C|,)income/);

  // Category multi-select (grouped by type)
  await page.goto(base);
  await page.getByTestId("f-category").filter({ visible: true }).click();
  await page.getByRole("option", { name: "Meals", exact: true }).click();
  await page.getByRole("option", { name: "Sales", exact: true }).click();
  await page.keyboard.press("Escape");
  await expectRows(page, ["Invoice 1001 paid", "STARBUCKS #123"], /cat=/);

  // Money account
  await page.goto(base);
  await page.getByTestId("f-account").filter({ visible: true }).click();
  await page.getByRole("option", { name: "Ops Visa" }).click();
  await page.keyboard.press("Escape");
  await expectRows(page, ["SQ *BLUE BOTTLE"], /acct=/);

  // Amount range (by size, in or out), under "More filters"
  await page.goto(base);
  await page.getByTestId("more-filters").filter({ visible: true }).click();
  await page.getByLabel("From", { exact: true }).fill("100");
  await page.getByLabel("To", { exact: true }).fill("$1,000");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expectRows(page, ["Card payment", "Owner draw"], /min=100&max=/);

  // Source: no control in the reskinned list; the URL filter still works.
  await page.goto(`${base}?source=import`);
  await expectRows(page, ["Imported fee"], /source=import/);

  // Text search: description, vendor and memo
  for (const [q, expected] of [["blue", ["SQ *BLUE BOTTLE"]], ["TEAM", ["STARBUCKS #123"]]] as const) {
    await page.goto(base);
    await page.getByLabel("Search transactions").filter({ visible: true }).fill(q);
    await page.keyboard.press("Enter");
    await expectRows(page, [...expected], new RegExp(`q=${q}`));
  }

  // Filters combine; "Clear all filters" (under "More filters") resets.
  await page.goto(`${base}?type=expense&q=starbucks`);
  await expectRows(page, ["STARBUCKS #123"], /type=expense&q=starbucks/);
  await page.getByTestId("more-filters").filter({ visible: true }).click();
  await page.getByRole("button", { name: "Clear all filters" }).click();
  await expect(page).toHaveURL(/transactions$/);
  await expect(count(page)).toHaveText("6");
});

test("categorizing reposts the amount, works from the keyboard, and carries over to the same vendor", async ({ page }) => {
  const { db, ids } = await setup(page);
  await post(db, ids.id, { date: today, money: ids.visa, amount: -1250, desc: "SQ *BLUE BOTTLE 1", vendor: "blue bottle" });
  await post(db, ids.id, { date: today, money: ids.visa, amount: -800, desc: "SQ *BLUE BOTTLE 2", vendor: "blue bottle" });
  await post(db, ids.id, { date: today, money: ids.checking, amount: -3000, desc: "Mystery charge" });
  const balance = async (accountId: string) =>
    must(await db.from("account_balances").select("natural_balance_cents").eq("account_id", accountId).single()).natural_balance_cents;

  await page.goto(`/b/${ids.id}/transactions`);
  expect(await balance(ids.uncat)).toBe(5050);

  // Inline picker: search, pick Meals.
  const row = (desc: string) => visibleRows(page).filter({ hasText: desc });
  await row("SQ *BLUE BOTTLE 1").getByRole("button", { name: /Category for/ }).click();
  await page.getByPlaceholder("Search categories…").fill("meal");
  await page.getByRole("option", { name: "Meals", exact: true }).click();
  // The vendor's other row is filed the same way at once, with an Undo.
  await expect(page.getByText("Also filed 1 more blue bottle transaction under Meals")).toBeVisible();
  await expect(row("SQ *BLUE BOTTLE 1").getByTestId("category-cell")).toHaveText("Meals");
  await expect(row("SQ *BLUE BOTTLE 2").getByTestId("category-cell")).toHaveText("Meals");
  expect(await balance(ids.uncat)).toBe(3000);
  expect(await balance(ids.meals)).toBe(2050);

  // Keyboard: the active row follows focus; j/k move it, c opens its picker. Then create a
  // category from inside the picker. "Mystery charge" is newest, so it is the first row.
  // (Clicking anywhere on a row opens the drawer, so focus the row directly.)
  await row("Mystery charge").focus();
  await page.keyboard.press("j");
  await expect(row("SQ *BLUE BOTTLE 2")).toBeFocused();
  await page.keyboard.press("k");
  await expect(row("Mystery charge")).toBeFocused();
  await page.keyboard.press("c");
  await page.getByPlaceholder("Search categories…").fill("Coffee Beans");
  await page.getByRole("option", { name: /Create category/ }).click();
  await page.getByLabel("New category type").selectOption("expense");
  await page.getByRole("button", { name: "Create and use" }).click();
  await expect(row("Mystery charge").getByTestId("category-cell")).toHaveText("Coffee Beans");
  expect(await balance(ids.uncat)).toBe(0);

  // The books still balance.
  const all = must(await db.from("account_balances").select("balance_cents").eq("business_id", ids.id));
  expect(all.reduce((s, b) => s + (b.balance_cents ?? 0), 0)).toBe(0);
});

