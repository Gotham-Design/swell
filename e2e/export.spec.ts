// Full business export: a zip of CSVs with every table's rows, for members only.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { must, signInDirect, uniqueEmail } from "./helpers";
import { post, setup } from "./transactions-fixtures";

test("export: zipped CSVs of accounts, transactions, lines, rules and audit log", async ({ page, browser }) => {
  const { db, ids } = await setup(page);
  await post(db, ids.id, { date: "2026-09-01", money: ids.checking, amount: 250000, desc: "Client payment", cat: ids.sales });
  await post(db, ids.id, { date: "2026-09-02", money: ids.visa, amount: -4550, desc: "=HYPERLINK(\"x\")", cat: ids.meals });
  must(await db.rpc("save_category_rule", { p_business_id: ids.id, p_vendor_normalized: "blue bottle", p_category_account_id: ids.meals }));

  await page.goto(`/b/${ids.id}/settings`);
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-link").click()]);
  expect(d.suggestedFilename()).toMatch(/^hotel-hardware_export_\d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzipSync(new Uint8Array(await readFile((await d.path())!)));
  expect(Object.keys(files).sort()).toEqual(["README.txt", "accounts.csv", "audit_log.csv", "category_rules.csv", "journal_lines.csv", "transactions.csv"]);

  const csv = (name: string) => strFromU8(files[name]).trim().split("\r\n");
  const txns = csv("transactions.csv");
  expect(txns[0]).toMatch(/^id,date,description,description_clean,vendor,amount,money_account,category,/);
  expect(txns).toHaveLength(3);
  expect(txns.join("\n")).toContain(",2500.00,Ops Checking,Sales,");
  expect(txns.join("\n")).toContain(`"'=HYPERLINK(""x"")"`); // formula defused
  expect(csv("journal_lines.csv")).toHaveLength(5);
  expect(csv("category_rules.csv").join("\n")).toContain("Vendor is blue bottle,10,active,apply_similar,true,Vendor is blue bottle,Category: Meals,");
  expect(csv("accounts.csv").join("\n")).toContain("Ops Visa");
  expect(csv("audit_log.csv").length).toBeGreaterThan(3);
  expect(strFromU8(files["README.txt"])).toContain("2 transactions, 4 journal lines");

  const other = await browser.newPage();
  await signInDirect(other, uniqueEmail("stranger"));
  const res = await other.goto(`/b/${ids.id}/export`);
  expect(res?.status()).toBe(404);
  await other.close();
});
