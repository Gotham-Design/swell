// Reports: P&L and balance sheet figures on screen, drill-downs into the transaction list,
// the uncategorized warning, comparison columns, and the PDF / CSV / XLSX downloads.
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { post, setup } from "./transactions-fixtures";

async function seed(page: Page) {
  const s = await setup(page);
  const { db, ids } = s;
  const p = (date: string, money: string, amount: number, desc: string, cat?: string) =>
    post(db, ids.id, { date, money, amount, desc, cat });
  await p("2025-01-07", ids.checking, 100000, "Last year's sale", ids.sales);
  await p("2026-01-05", ids.checking, 300000, "Big order", ids.sales);
  await p("2026-01-10", ids.checking, -4500, "Lunch with client", ids.meals);
  await p("2026-02-01", ids.checking, -50000, "Owner draw", ids.draws);
  await p("2026-02-03", ids.checking, -20000, "Pay the card", ids.visa);
  await p("2026-02-15", ids.visa, -1200, "Paper", ids.office);
  await p("2026-03-01", ids.checking, -999, "Mystery charge");
  return s;
}

const Q1 = "date=custom&from=2026-01-01&to=2026-03-31";
const line = (page: Page, key: string) => page.locator(`[data-line="${key}"]`);
const cells = (page: Page, key: string) => line(page, key).locator("td");
const controls = (page: Page) => page.getByTestId("report-controls").filter({ visible: true });
const summary = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true });

/** Open the Export menu and download one format. */
async function download(page: Page, format: "PDF" | "CSV" | "Excel (XLSX)") {
  await page.getByTestId("downloads").filter({ visible: true }).click();
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: format }).click()]);
  return { name: d.suggestedFilename(), body: await readFile((await d.path())!) };
}

test("P&L shows exact figures, a comparison, and drills into transactions", async ({ page }) => {
  const { ids } = await seed(page);
  await page.goto(`/b/${ids.id}/reports/pnl?${Q1}&cmp=yoy`);
  await expect(controls(page)).toContainText("Jan 1, 2026 – Mar 31, 2026");
  await expect(page.getByTestId("report-period")).toContainText("Compared with Jan 1, 2025 – Mar 31, 2025");

  // Columns: category, this period, comparison, % change.
  await expect(cells(page, ids.sales)).toHaveText(["Sales", "$3,000.00", "$1,000.00", "+200.0%"]);
  await expect(cells(page, "income_total")).toHaveText(["Gross income", "$3,000.00", "$1,000.00", "+200.0%"]);
  await expect(cells(page, ids.meals).nth(1)).toHaveText("$45.00");
  await expect(cells(page, ids.office).nth(1)).toHaveText("$12.00");
  await expect(cells(page, ids.uncat).nth(1)).toHaveText("$9.99");
  await expect(cells(page, "expense_total").nth(1)).toHaveText("$66.99");
  await expect(cells(page, "net_income")).toHaveText(["Net income", "$2,933.01", "$1,000.00", "+193.3%"]);
  await expect(page.getByTestId("pnl-net")).toHaveText("$2,933.01");

  // Transfers and owner draws never appear.
  await expect(line(page, ids.draws)).toHaveCount(0);
  await expect(line(page, ids.visa)).toHaveCount(0);
  await expect(page.getByTestId("pnl")).not.toContainText("Owner Draws");

  // Uncategorized: its own line, a warning, and a link to the filtered list.
  await expect(page.getByTestId("uncategorized-warning")).toContainText("1 transaction still needs review");
  await page.getByTestId("uncategorized-warning").getByRole("link", { name: "Review now" }).click();
  await expect(page).toHaveURL(/type=uncategorized/);
  await expect(summary(page, "summary-count")).toHaveText("1");
  await page.goBack();

  // Each amount opens the transactions behind it, for that period.
  await cells(page, ids.meals).nth(1).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?.*cat=${ids.meals}`));
  await expect(summary(page, "summary-count")).toHaveText("1");
  await expect(summary(page, "summary-net")).toHaveText("-$45.00");
  await page.goBack();
  await cells(page, ids.sales).nth(2).getByRole("link").click(); // comparison column
  await expect(page).toHaveURL(/from=2025-01-01&to=2025-03-31/);
  await expect(summary(page, "summary-net")).toHaveText("+$1,000.00");
});

test("P&L period presets and previous-period comparison", async ({ page }) => {
  const { ids } = await seed(page);
  await page.goto(`/b/${ids.id}/reports/pnl?date=custom&from=2026-02-01&to=2026-02-28&cmp=prev`);
  // February vs January.
  await expect(controls(page)).toContainText("February 2026");
  await expect(page.getByTestId("pnl").locator("thead")).toContainText("Jan 2026");
  await expect(page.getByTestId("report-period")).toContainText("Compared with January 2026");
  await expect(cells(page, "net_income")).toHaveText(["Net income", "($12.00)", "$2,955.00", "-100.4%"]);
  await controls(page).click();
  await page.getByRole("option", { name: "Last fiscal year" }).click();
  await expect(page).toHaveURL(/date=last_year/);
  await expect(controls(page)).toContainText("Jan 1, 2025 – Dec 31, 2025");
  await controls(page).click();
  await expect(page.getByRole("option", { name: "Last fiscal year" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(cells(page, "net_income").nth(1)).toHaveText("$1,000.00");
});

test("Balance sheet balances, splits earnings, and compares two dates", async ({ page }) => {
  const { ids } = await seed(page);
  await page.goto(`/b/${ids.id}/reports/balance-sheet?asof=2026-03-31&cmp=fy_end`);
  await expect(page.getByTestId("report-period")).toContainText("As of Mar 31, 2026");
  await expect(controls(page)).toContainText("Mar 31, 2026");
  // The balance sheet has no change column: category, as of, comparison, then an empty spacer cell.
  await expect(cells(page, ids.checking)).toHaveText(["Ops Checking", "$3,245.01", "$1,000.00", ""]);
  await expect(cells(page, "total_assets").nth(1)).toHaveText("$3,245.01");
  await expect(cells(page, ids.visa).nth(1)).toHaveText("($188.00)");
  await expect(cells(page, ids.draws).nth(1)).toHaveText("($500.00)");
  const re = page.locator("[data-line]").filter({ hasText: "Retained Earnings" });
  await expect(re.locator("td").nth(1)).toHaveText("$1,000.00");
  await expect(re.locator("td").nth(2)).toHaveText("$0.00");
  await expect(cells(page, "current_year_earnings")).toHaveText(["Current Year Earnings", "$2,933.01", "$1,000.00", ""]);
  await expect(cells(page, "total_liabilities_equity").nth(1)).toHaveText("$3,245.01");
  await expect(page.getByTestId("imbalance")).toHaveCount(0);
  await expect(page.getByTestId("balanced")).toBeVisible();

  // Current Year Earnings opens this fiscal year's P&L.
  await cells(page, "current_year_earnings").nth(1).getByRole("link").click();
  await expect(page).toHaveURL(/reports\/pnl\?date=custom&from=2026-01-01&to=2026-03-31/);
  await expect(cells(page, "net_income").nth(1)).toHaveText("$2,933.01");
});

test("downloads: PDF, CSV and XLSX with the same rows", async ({ page }) => {
  const { ids } = await seed(page);
  await page.goto(`/b/${ids.id}/reports/pnl?${Q1}&cmp=yoy`);
  const get = (format: "PDF" | "CSV" | "Excel (XLSX)") => download(page, format);

  const pdf = await get("PDF");
  expect(pdf.name).toBe("hotel-hardware_profit-and-loss_2026-01-01_2026-03-31.pdf");
  expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.body.toString("latin1")).toMatch(/\/Type\s*\/Page\b/);

  const csv = await get("CSV");
  expect(csv.name).toBe("hotel-hardware_profit-and-loss_2026-01-01_2026-03-31.csv");
  const text = csv.body.toString("utf8");
  expect(text).toContain('Hotel Hardware\r\nProfit & Loss\r\n"Jan 1, 2026 – Mar 31, 2026"\r\nBasis: Cash\r\n"Generated ');
  expect(text).toContain('Account,"Jan 1, 2026 – Mar 31, 2026","Jan 1, 2025 – Mar 31, 2025",$ change,% change\r\n');
  expect(text).toContain("Sales,3000.00,1000.00,2000.00,+200.0%");
  expect(text).toContain("Uncategorized,9.99,0.00,9.99,\r\n");
  expect(text).toContain("Net income,2933.01,1000.00,1933.01,+193.3%");
  expect(text).not.toContain("Owner Draws");

  const xlsx = await get("Excel (XLSX)");
  expect(xlsx.name).toBe("hotel-hardware_profit-and-loss_2026-01-01_2026-03-31.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.body as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const rows = new Map<string, unknown[]>();
  ws.eachRow((r) => { const v = r.values as unknown[]; rows.set(String(v[1]), v.slice(2)); });
  expect(rows.get("Sales")).toEqual([3000, 1000, 2000, "+200.0%"]);
  expect(rows.get("Net income")).toEqual([2933.01, 1000, 1933.01, "+193.3%"]);

  // Balance sheet: one as-of date, so the name repeats it.
  await page.goto(`/b/${ids.id}/reports/balance-sheet?asof=2026-03-31`);
  const bs = await get("CSV");
  expect(bs.name).toBe("hotel-hardware_balance-sheet_2026-03-31_2026-03-31.csv");
  expect(bs.body.toString("utf8")).toContain("Total liabilities and equity,3245.01");
});

test("reports open on the P&L with a tab to the balance sheet; strangers get a 404", async ({ page, browser }) => {
  const { ids } = await seed(page);
  await page.goto(`/b/${ids.id}/reports`);
  await expect(page).toHaveURL(new RegExp(`/b/${ids.id}/reports/pnl$`));
  await expect(page.getByTestId("pnl")).toBeVisible();
  await page.getByTestId("tab-bs").filter({ visible: true }).click();
  await expect(page).toHaveURL(/reports\/balance-sheet/);
  await expect(page.getByTestId("balance-sheet")).toBeVisible();
  await page.getByTestId("tab-pnl").filter({ visible: true }).click();
  await expect(page.getByTestId("pnl").filter({ visible: true })).toBeVisible();

  const other = await browser.newPage();
  const { signInDirect, uniqueEmail } = await import("./helpers");
  await signInDirect(other, uniqueEmail("stranger"));
  const res = await other.goto(`/b/${ids.id}/reports/download?report=pnl&format=csv&${Q1}`);
  expect(res?.status()).toBe(404);
  await other.close();
});
