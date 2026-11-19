// Seed a demo business into the LOCAL Supabase so you can click around:
//   node scripts/seed-demo.mjs
// Creates demo@quickacct.test (no password; prints a one-time sign-in link), a bakery with
// six months of transactions, a few rules, pattern suggestions and AI suggestion chips.
// Refuses to run against anything but localhost.
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) {
  console.error(`Refusing to seed: ${URL} is not a local Supabase.`);
  process.exit(1);
}
const APP = process.env.APP_URL ?? "http://localhost:3200";
const EMAIL = "demo@quickacct.test";

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

async function signedIn() {
  await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true }); // fine if it exists
  const link = must(await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL }), "link");
  const db = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  must(await db.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" }), "sign in");
  return db;
}

// Deterministic "random" so every seed looks the same.
let s = 42;
const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const between = (lo, hi) => Math.round(lo + rand() * (hi - lo));
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);

const db = await signedIn();
const today = new Date(`${iso(new Date())}T00:00:00Z`);
const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 6, 1));

// Fresh demo business each run: earlier demo bakeries of this user are removed first.
must(await db.from("businesses").delete().like("name", "Demo Bakery%").select("id"), "cleanup");
const name = "Demo Bakery";
const biz = must(await db.rpc("create_business", { p_name: name, p_legal_name: "Demo Bakery LLC", p_books_start_date: iso(start) }), "business");
const acct = async (n, t) => must(await db.from("accounts").insert({ business_id: biz, name: n, type: t }).select("id").single(), n).id;
const std = async (n) => must(await db.from("accounts").select("id").eq("business_id", biz).eq("name", n).single(), n).id;
const checking = must(await db.rpc("create_money_account", { p_business_id: biz, p_name: "Bakery Checking", p_kind: "checking", p_last4: "4821", p_opening_balance_cents: 1_200_000, p_opening_date: iso(start) }), "checking");
const visa = must(await db.rpc("create_money_account", { p_business_id: biz, p_name: "Business Visa", p_kind: "credit_card", p_last4: "1007" }), "visa");
const savings = must(await db.rpc("create_money_account", { p_business_id: biz, p_name: "Reserve Savings", p_kind: "savings", p_opening_balance_cents: 500_000, p_opening_date: iso(start) }), "savings");
const c = {
  sales: await std("Sales"), service: await std("Service Revenue"), rent: await std("Rent"), payroll: await std("Payroll"),
  utilities: await std("Utilities"), software: await std("Software & Subscriptions"), insurance: await std("Insurance"),
  office: await std("Office Supplies"), meals: await std("Meals"), equipment: await std("Equipment"), draws: await std("Owner Draws"),
  travel: await std("Travel"), ingredients: await acct("Ingredients", "expense"),
};

const rows = [];
const add = (date, money, cents, desc, vendor, cat) => rows.push({ date: iso(date), money, cents, desc, vendor, cat });
for (let d = start; d <= today; d = addDays(d, 1)) {
  const dow = d.getUTCDay();
  const dom = d.getUTCDate();
  const recent = (today - d) / 86_400_000 < 10; // the last ten days stay uncategorized
  const cat = (x) => (recent ? null : x);
  if (dow === 1 || dow === 4) add(d, checking, between(210_000, 320_000), "SQUARE INC DEPOSIT", "square", cat(c.sales));
  if (dow === 3) add(d, visa, -between(40_000, 72_000), "RESTAURANT DEPOT #0412", "restaurant depot", cat(c.ingredients));
  if (dow === 5 && Math.floor(dom / 7) % 2 === 0) add(d, checking, -360_000, "GUSTO PAYROLL", "gusto", cat(c.payroll));
  if (dom === 1) add(d, checking, -320_000, "OAKWOOD PROPERTY MGMT RENT", "oakwood property mgmt", cat(c.rent));
  if (dom === 4) add(d, visa, -5_499, "ADOBE *CREATIVE CLOUD", "adobe", cat(c.software));
  if (dom === 9) add(d, checking, -between(26_000, 36_000), "PG&E WEB ONLINE", "pg&e", cat(c.utilities));
  if (dom === 15) add(d, checking, between(120_000, 180_000), `CLIENT PAYMENT INV-${2000 + d.getUTCMonth()}`, "client payment", cat(c.service));
  if (dom === 20) add(d, checking, -250_000, "PAYMENT THANK YOU VISA", "payment thank you", recent ? null : visa);
  if (dom === 25) add(d, checking, -150_000, "OWNER DRAW", "owner draw", cat(c.draws));
  if (dom === 12 && d.getUTCMonth() % 3 === 0) add(d, checking, -62_000, "HISCOX INSURANCE", "hiscox", cat(c.insurance));
  if (dom === 18 && d.getUTCMonth() % 2 === 1) add(d, savings, 500, "INTEREST PAID", "interest", null);
  if (rand() < 0.08) add(d, visa, -between(1_200, 4_800), "AMZN MKTP US*" + Math.floor(rand() * 1e6).toString(36).toUpperCase(), "amazon", cat(c.office));
  if (rand() < 0.05) add(d, visa, -between(900, 2_800), "UBER TRIP", "uber", cat(c.travel));
  if (rand() < 0.06) add(d, visa, -between(600, 1_900), "SQ *BLUE BOTTLE COFFEE", "blue bottle", cat(c.meals));
}
// One large purchase two months ago.
add(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 11)), visa, -840_000, "HOBART MIXER HL600", "hobart", c.equipment);

const ids = {};
for (const r of rows) {
  ids[r.desc + r.date] = must(await db.rpc("post_transaction", {
    p_business_id: biz, p_date: r.date, p_money_account_id: r.money, p_amount_cents: r.cents, p_description_raw: r.desc,
    p_category_account_id: r.cat ?? undefined, p_description_clean: r.desc.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()),
    p_vendor_normalized: r.vendor, p_source: "manual",
  }), r.desc);
}

// Rules: one hand-made, plus the pattern engine's suggestions.
must(await db.rpc("save_rule", { p_business_id: biz, p_rule: {
  name: "Small Amazon orders are office supplies", match_mode: "all", stop_processing: true, enabled: true,
  conditions: [{ field: "vendor_normalized", operator: "equals", value: "amazon" }, { field: "amount", operator: "lt", value: 5000 }],
  actions: [{ action: "set_category", account_id: c.office }] } }), "rule");
must(await db.rpc("save_rule", { p_business_id: biz, p_rule: {
  name: "Card payments are transfers", match_mode: "all", stop_processing: true, enabled: true,
  conditions: [{ field: "description_raw", operator: "contains", value: "payment thank you" }],
  actions: [{ action: "mark_transfer_to_account", account_id: visa }] } }), "rule");
must(await db.from("businesses").update({ ai_enabled: true, large_threshold_cents: 500_000 }).eq("id", biz).select("id"), "settings");
must(await db.rpc("refresh_patterns", { p_business_id: biz }), "patterns");

// A few AI suggestion chips on recent uncategorized rows (no API call: recorded directly).
const recent = must(await db.from("transactions").select("id, vendor_normalized").eq("business_id", biz).is("category_account_id", null)
  .in("vendor_normalized", ["uber", "blue bottle", "restaurant depot", "square"]).limit(6), "recent");
const guess = { uber: [c.travel, 0.91, "Rideshare trip"], "blue bottle": [c.meals, 0.86, "Coffee shop"],
  "restaurant depot": [c.ingredients, 0.95, "Restaurant supply store"], square: [c.sales, 0.97, "Card sales deposit"] };
must(await db.rpc("record_ai_suggestions", {
  p_business_id: biz, p_request_key: `demo-${Date.now()}`, p_model: "claude-haiku-5-5", p_prompt_version: "demo",
  p_latency_ms: 0, p_input_tokens: 0, p_output_tokens: 0,
  p_suggestions: recent.map((t) => ({ transaction_id: t.id, category_id: guess[t.vendor_normalized][0], confidence: guess[t.vendor_normalized][1],
    reason: guess[t.vendor_normalized][2], flags: [] })),
}), "suggestions");

const link = must(await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL }), "link");
console.log(`Seeded "${name}": ${rows.length} transactions, 3 money accounts, rules and suggestions.`);
console.log(`Business: ${APP}/b/${biz}`);
console.log(`Sign in (one-time link): ${APP}/auth/confirm?token_hash=${link.properties.hashed_token}&type=magiclink&next=/b/${biz}`);
