// 100,000 transactions across 3 businesses: the list, its filters and both reports must
// answer in under 500ms locally, measured as database calls (as the signed-in user,
// through RLS) and as the full server response of each page.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { must, signInDirect, uniqueEmail, userClient, createBusiness } from "./helpers";

const DB_URL = "postgresql://postgres:postgres@127.0.0.1:58322/postgres";
const PER_BUSINESS = [34_000, 33_000, 33_000];
const BUDGET_MS = 500;
test.setTimeout(600_000);

async function median(label: string, fn: () => Promise<unknown>, runs = 5) {
  await fn(); // warm
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const ms = Math.round(times[Math.floor(runs / 2)]);
  console.log(`${label}: ${ms} ms`);
  return ms;
}

/** Server time for the whole streamed HTML response (all Suspense data included). */
async function serverMs(page: Page, url: string, ready: string) {
  const one = async () => {
    await page.goto(url);
    await expect(page.getByTestId(ready).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    return page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return nav.responseEnd - nav.requestStart;
    });
  };
  await one();
  const times = [await one(), await one(), await one()].sort((a, b) => a - b);
  const ms = Math.round(times[1]);
  console.log(`page ${url.split("/").slice(3).join("/")}: ${ms} ms`);
  return ms;
}

test("100k transactions: list, filters and reports under 500ms", async ({ page }) => {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const businesses: string[] = [];
  try {
    const email = uniqueEmail("scale");
    await signInDirect(page, email);
    const main = await createBusiness(page, "Scale Co");
    const client = await userClient(email);
    businesses.push(main);
    for (const name of ["Scale Two", "Scale Three"]) businesses.push(must(await client.rpc("create_business", { p_name: name })));
    for (const id of businesses) {
      must(await client.rpc("create_money_account", { p_business_id: id, p_name: "Ops Checking", p_kind: "checking", p_opening_balance_cents: 5_000_000 }));
      must(await client.rpc("create_money_account", { p_business_id: id, p_name: "Ops Card", p_kind: "credit_card" }));
    }
    const seed = readFileSync("e2e/fixtures/seed-perf.sql", "utf8");
    const started = Date.now();
    for (const [i, id] of businesses.entries()) {
      await db.query("begin");
      await db.query("select set_config('seed.business', $1, true), set_config('seed.count', $2, true)", [id, String(PER_BUSINESS[i])]);
      await db.query(seed);
      await db.query("commit");
    }
    await db.query("analyze public.transactions; analyze public.journal_lines; analyze public.accounts");
    for (const id of businesses) await db.query("select private.refresh_patterns($1)", [id]);
    const { rows } = await db.query("select count(*)::int as n from public.transactions where business_id = any($1)", [businesses]);
    expect(rows[0].n).toBe(100_003); // plus one opening balance per business
    console.log(`seeded 100k in ${Date.now() - started} ms`);

    const year = new Date().getUTCFullYear();
    const page1 = (args: Record<string, unknown>) => client.rpc("search_transactions", { p_business_id: main, ...args })
      .select("id, date, description_raw, amount_cents, category_account_id, created_at").order("date", { ascending: false })
      .order("created_at", { ascending: false }).order("id").range(0, 49);
    const office = must(await client.from("accounts").select("id").eq("business_id", main).eq("name", "Office Supplies").single()).id;
    const timings: Record<string, number> = {
      "list: page 1": await median("list: page 1", async () => must(await page1({}))),
      "list: totals": await median("list: totals", async () => must(await client.rpc("summarize_transactions", { p_business_id: main }))),
      "filter: this year": await median("filter: this year", async () => must(await page1({ p_from: `${year}-01-01`, p_to: `${year}-12-31` }))),
      "filter: category": await median("filter: category", async () => must(await page1({ p_category_ids: [office] }))),
      "filter: uncategorized": await median("filter: uncategorized", async () => must(await page1({ p_types: ["uncategorized"] }))),
      "filter: text": await median("filter: text", async () => must(await page1({ p_query: "vendor 12" }))),
      "filter: amount": await median("filter: amount", async () => must(await page1({ p_amount_min: 40000, p_amount_max: 45000 }))),
      "filter: text totals": await median("filter: text totals", async () => must(await client.rpc("summarize_transactions", { p_business_id: main, p_query: "vendor 12" }))),
      "report: P&L YTD": await median("report: P&L YTD", async () => must(await client.rpc("report_pnl", { p_business_id: main, p_from: `${year}-01-01`, p_to: `${year}-12-31` }))),
      "report: P&L with comparison": await median("report: P&L with comparison", async () => must(await client.rpc("report_pnl", {
        p_business_id: main, p_from: `${year - 1}-01-01`, p_to: `${year - 1}-12-31`, p_cmp_from: `${year - 2}-01-01`, p_cmp_to: `${year - 2}-12-31` }))),
      "report: balance sheet with comparison": await median("report: balance sheet with comparison", async () => must(await client.rpc("report_balance_sheet", {
        p_business_id: main, p_as_of: `${year}-12-31`, p_cmp_as_of: `${year - 1}-12-31` }))),
    };
    timings["page: transactions"] = await serverMs(page, `/b/${main}/transactions`, "txn-row");
    timings["page: transactions filtered"] = await serverMs(page, `/b/${main}/transactions?date=ytd&q=vendor+12`, "txn-row");
    timings["page: P&L"] = await serverMs(page, `/b/${main}/reports/pnl?cmp=yoy`, "pnl");
    timings["page: balance sheet"] = await serverMs(page, `/b/${main}/reports/balance-sheet?cmp=fy_end`, "balance-sheet");

    const slow = Object.entries(timings).filter(([, ms]) => ms >= BUDGET_MS);
    expect(slow, `over ${BUDGET_MS}ms`).toEqual([]);
  } finally {
    // Don't leave 100k rows behind for the next run.
    await db.query("rollback").catch(() => {});
    if (businesses.length) await db.query("delete from public.businesses where id = any($1)", [businesses]);
    await db.end();
  }
});
