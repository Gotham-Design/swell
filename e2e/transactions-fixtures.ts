// Shared setup for the transaction-list specs: a business with money accounts and a way
// to post transactions as the signed-in user (through post_transaction, under RLS).
import type { Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { createBusiness, must, signInDirect, uniqueEmail, userClient } from "./helpers";

export type Db = SupabaseClient<Database>;

/** YYYY-MM-DD for today shifted by whole months/years (day clamped to 28 to stay valid). */
export function shifted(months: number, day?: number) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, day ?? Math.min(now.getUTCDate(), 28)));
  return d.toISOString().slice(0, 10);
}
export const today = new Date().toISOString().slice(0, 10);

export async function setup(page: Page) {
  const email = uniqueEmail("owner");
  await signInDirect(page, email);
  const id = await createBusiness(page, "Hotel Hardware");
  const db = await userClient(email);
  const acct = async (name: string) => must(await db.from("accounts").select("id").eq("business_id", id).eq("name", name).single()).id;
  const checking = must(await db.rpc("create_money_account", { p_business_id: id, p_name: "Ops Checking", p_kind: "checking" }));
  const visa = must(await db.rpc("create_money_account", { p_business_id: id, p_name: "Ops Visa", p_kind: "credit_card" }));
  const ids = { id, checking, visa, sales: await acct("Sales"), meals: await acct("Meals"), draws: await acct("Owner Draws"),
    fees: await acct("Bank Fees"), uncat: await acct("Uncategorized"), office: await acct("Office Supplies") };
  return { email, db, ids };
}

export async function post(db: Db, businessId: string, t: {
  date: string; money: string; amount: number; desc: string; cat?: string; vendor?: string; memo?: string;
  source?: "manual" | "import"; batch?: string;
}) {
  return must(await db.rpc("post_transaction", {
    p_business_id: businessId, p_date: t.date, p_money_account_id: t.money, p_amount_cents: t.amount,
    p_description_raw: t.desc, p_category_account_id: t.cat, p_vendor_normalized: t.vendor, p_memo: t.memo,
    p_source: t.source ?? "manual", p_import_batch_id: t.batch,
  }));
}


export const visibleRows = (page: Page) => page.getByTestId("txn-row").filter({ visible: true });
export const count = (page: Page) => page.getByTestId("summary-count").filter({ visible: true });
