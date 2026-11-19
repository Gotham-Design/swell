// Full business export: accounts, transactions, journal lines, rules and the audit log as
// CSV files in one zip. Read as the signed-in user (RLS), a page at a time.
import "server-only";
import { strToU8, zipSync } from "fflate";
import { getSupabase } from "@/lib/dal";
import { centsToInput } from "@/lib/money";
import { toCsv, type Cell } from "./csv";
import { describeActions, describeConditions, type Action, type Condition } from "@/lib/rules/model";
import { BRAND_NAME } from "@/lib/theme";

const PAGE = 1000;
type Supabase = Awaited<ReturnType<typeof getSupabase>>;

async function all<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}
const money = (c: number | null | undefined) => (c === null || c === undefined ? null : centsToInput(Number(c)));

export async function buildBusinessExport(supabase: Supabase, businessId: string, businessName: string, generatedAt: string) {
  const [accounts, transactions, lines, rules, audit] = await Promise.all([
    all((a, b) => supabase.from("accounts")
      .select("id, name, type, subtype, parent_id, is_money_account, is_system, is_hidden, last4, description, archived_at, created_at")
      .eq("business_id", businessId).order("id").range(a, b)),
    all((a, b) => supabase.from("transactions")
      .select("id, date, description_raw, description_clean, vendor_normalized, amount_cents, money_account_id, category_account_id, kind, source, category_source, memo, reference, import_batch_id, deleted_at, created_at")
      .eq("business_id", businessId).order("id").range(a, b)),
    all((a, b) => supabase.from("journal_lines").select("id, transaction_id, account_id, amount_cents, created_at")
      .eq("business_id", businessId).order("id").range(a, b)),
    all((a, b) => supabase.from("category_rules")
      .select("id, name, priority, status, origin, enabled, match_mode, stop_processing, times_applied, last_applied_at, deleted_at, created_at, rule_conditions(field, operator, value, case_sensitive, position), rule_actions(action, account_id, value, position)")
      .eq("business_id", businessId).order("id").range(a, b)),
    all((a, b) => supabase.from("audit_log").select("seq, created_at, actor, action, entity, entity_id, before, after")
      .eq("business_id", businessId).order("seq").range(a, b)),
  ]);
  const name = new Map(accounts.map((x) => [x.id, x.name]));

  const files: Record<string, string> = {
    "accounts.csv": toCsv(
      ["id", "name", "type", "subtype", "parent_id", "parent", "money_account", "system", "hidden", "last4", "description", "archived_at", "created_at"],
      accounts.map((x) => [x.id, x.name, x.type, x.subtype, x.parent_id, x.parent_id ? name.get(x.parent_id) : null, x.is_money_account,
        x.is_system, x.is_hidden, x.last4, x.description, x.archived_at, x.created_at] as Cell[]),
      new Set(["name", "parent", "description"])),
    "transactions.csv": toCsv(
      ["id", "date", "description", "description_clean", "vendor", "amount", "money_account", "category", "kind", "source",
       "category_source", "memo", "reference", "import_batch_id", "deleted_at", "created_at", "money_account_id", "category_id"],
      transactions.map((t) => [t.id, t.date, t.description_raw, t.description_clean, t.vendor_normalized, money(t.amount_cents),
        name.get(t.money_account_id), t.category_account_id ? name.get(t.category_account_id) : "Uncategorized", t.kind, t.source,
        t.category_source, t.memo, t.reference, t.import_batch_id, t.deleted_at, t.created_at, t.money_account_id, t.category_account_id] as Cell[]),
      new Set(["description", "description_clean", "vendor", "money_account", "category", "memo", "reference"])),
    "journal_lines.csv": toCsv(
      ["id", "transaction_id", "account", "account_id", "debit", "credit", "created_at"],
      lines.map((l) => [l.id, l.transaction_id, name.get(l.account_id), l.account_id,
        l.amount_cents > 0 ? money(l.amount_cents) : null, l.amount_cents < 0 ? money(-l.amount_cents) : null, l.created_at] as Cell[]),
      new Set(["account"])),
    "category_rules.csv": toCsv(
      ["id", "name", "priority", "status", "origin", "enabled", "conditions", "actions", "stop_processing", "times_applied",
       "last_applied_at", "deleted_at", "created_at"],
      rules.map((r) => {
        const conditions = [...r.rule_conditions].sort((x, y) => x.position - y.position) as unknown as Condition[];
        const actions = [...r.rule_actions].sort((x, y) => x.position - y.position) as unknown as Action[];
        const names = Object.fromEntries(name);
        return [r.id, r.name, r.priority, r.status, r.origin, r.enabled,
          describeConditions({ conditions, match_mode: r.match_mode as "all" | "any" }, names), describeActions(actions, names),
          r.stop_processing, r.times_applied, r.last_applied_at, r.deleted_at, r.created_at] as Cell[];
      }),
      new Set(["name", "conditions", "actions"])),
    "audit_log.csv": toCsv(
      ["seq", "created_at", "actor_id", "action", "entity", "entity_id", "before", "after"],
      audit.map((x) => [x.seq, x.created_at, x.actor, x.action, x.entity, x.entity_id, x.before as Cell, x.after as Cell]),
      new Set(["before", "after"])),
    "README.txt": [
      `${BRAND_NAME} export for ${businessName}`, `Generated ${generatedAt}`, "",
      "Amounts are dollars with two decimals. Transactions: negative = money out of the money account.",
      "Journal lines: debit and credit per account; every transaction's lines balance.",
      "Deleted transactions are included with deleted_at set; reports leave them out.",
      `Counts: ${accounts.length} accounts, ${transactions.length} transactions, ${lines.length} journal lines, ${rules.length} rules, ${audit.length} audit entries.`, "",
    ].join("\r\n"),
  };
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
  return { zip, counts: { accounts: accounts.length, transactions: transactions.length, lines: lines.length, rules: rules.length, audit: audit.length } };
}
