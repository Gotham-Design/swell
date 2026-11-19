// Sample data for the development previews (Demo Bakery, as in the Figma file).
import type { PickerOption, SuggestionChipData, TransactionRow } from "@/lib/dal";

export const BIZ = "00000000-0000-4000-8000-000000000001";
export const ACCTS = {
  chk: { id: "00000000-0000-4000-8000-0000000000a1", name: "Bakery Checking", last4: "4821" },
  visa: { id: "00000000-0000-4000-8000-0000000000a2", name: "Business Visa", last4: "1007" },
  sav: { id: "00000000-0000-4000-8000-0000000000a3", name: "Reserve Savings", last4: "3458" },
};
const cat = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
export const CATS: PickerOption[] = [
  ["Sales", "income"], ["Service Revenue", "income"], ["Interest Income", "income"], ["Payroll", "expense"],
  ["Ingredients", "expense"], ["Insurance", "expense"], ["Office Supplies", "expense"], ["Contractors", "expense"],
  ["Meals", "expense"], ["Rent", "expense"], ["Utilities", "expense"], ["Software", "expense"],
].map(([name, type], i) => ({ id: cat(i), name, type: type as PickerOption["type"], parent_id: null, is_money_account: false }));
const catId = (name: string) => CATS.find((c) => c.name === name)!.id;
export const NAMES: Record<string, string> = Object.fromEntries([
  ...CATS.map((c) => [c.id, c.name]), ...Object.values(ACCTS).map((a) => [a.id, a.name]),
]);

let n = 0;
const row = (date: string, desc: string, vendor: string, acct: keyof typeof ACCTS, cents: number, category?: string): TransactionRow => ({
  id: `00000000-0000-4000-8000-0000000002${String(++n).padStart(2, "0")}`, date, description_raw: desc.toUpperCase(),
  description_clean: desc, vendor_normalized: vendor, amount_cents: cents, money_account_id: ACCTS[acct].id,
  category_account_id: category ? catId(category) : null, category_source: category ? "user" : null, category_rule_id: null,
  kind: cents > 0 ? "income" : "expense", source: "import", memo: null, reference: null, deleted_at: null,
  created_at: "2026-10-21T14:00:00Z",
} as TransactionRow);

export const ROWS: TransactionRow[] = [
  row("2026-10-22", "Square Inc Deposit", "square", "chk", 227355),
  row("2026-10-21", "Restaurant Depot #0412", "restaurant depot", "visa", -66471),
  row("2026-10-20", "Payment Thank You Visa", "payment thank you", "chk", -250000),
  row("2026-10-19", "Square Inc Deposit", "square", "chk", 218680),
  row("2026-10-18", "Interest Paid", "interest", "sav", 500),
  row("2026-10-17", "Sq *blue Bottle Coffee", "blue bottle", "visa", -692),
  row("2026-10-17", "Amzn Mktp Us*81sj", "amazon", "visa", -3040),
  row("2026-10-16", "Gusto Payroll", "gusto", "chk", -360000, "Payroll"),
  row("2026-10-16", "Venmo *J Rivera", "venmo", "chk", -18000),
  row("2026-10-15", "Client Payment Inv-2009", "client payment", "chk", 172122, "Service Revenue"),
  row("2026-10-14", "Restaurant Depot #0412", "restaurant depot", "visa", -40108),
  row("2026-10-12", "Hiscox Insurance", "hiscox", "chk", -62000, "Insurance"),
];

const sug = (i: number, category: string, confidence: number, runnerUp?: string, history = false): [string, SuggestionChipData] => [
  ROWS[i].id, {
    id: `00000000-0000-4000-8000-0000000003${String(i).padStart(2, "0")}`, category_account_id: catId(category),
    category_name: category, confidence, reason: null, flags: [],
    runner_up_id: runnerUp ? catId(runnerUp) : null, runner_up_name: runnerUp ?? null,
    vendor: ROWS[i].vendor_normalized, vendor_has_history: history,
  },
];
export const SUGGESTIONS: Record<string, SuggestionChipData> = Object.fromEntries([
  sug(0, "Sales", 0.97), sug(1, "Ingredients", 0.95), sug(2, "Rent", 0.5), sug(3, "Sales", 0.97),
  sug(4, "Interest Income", 0.91), sug(5, "Meals", 0.86), sug(6, "Office Supplies", 0.62, "Ingredients", true),
  sug(8, "Contractors", 0.41), sug(10, "Ingredients", 0.95),
]);
