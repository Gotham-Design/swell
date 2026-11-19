// Reads for the Categories screen, as the signed-in user (RLS applies). Counts and totals come
// from SQL (category_period_stats, category_monthly, category_top_vendors); this file only
// groups rows and works out display shares.
import "server-only";
import { getBusiness, getSupabase, todayIso } from "@/lib/dal";
import { sumCents } from "@/lib/money";
import type { resolveMonth } from "@/lib/dal-overview";

export type CategoryGroupKey = "income" | "expense" | "other" | "transfer";

export type CategoryListRow = {
  id: string; name: string; type: string; parentId: string | null; isSystem: boolean; isStandard: boolean;
  description: string | null; count: number; total: number;
  /** Share of the group's total, 0–100 with one decimal (display only); null for transfers. */
  share: number | null;
  isNew: boolean; used: boolean;
};

export type CategoryGroup = { key: CategoryGroupKey; label: string; rows: CategoryListRow[] };

const GROUP_LABEL: Record<CategoryGroupKey, string> = {
  income: "Income", expense: "Expenses", other: "Balance sheet", transfer: "Transfers",
};

export async function getCategoryScreen(businessId: string, month: ReturnType<typeof resolveMonth>) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const [accounts, stats] = await Promise.all([
    supabase.from("accounts")
      .select("id, name, type, subtype, parent_id, description, is_system, is_standard, is_money_account, is_hidden, archived_at")
      .eq("business_id", business.id).order("name"),
    supabase.rpc("category_period_stats", { p_business_id: business.id, p_from: month.from, p_to: month.to }),
  ]);
  if (accounts.error) throw new Error(accounts.error.message);
  if (stats.error) throw new Error(stats.error.message);

  const byId = new Map(accounts.data.map((a) => [a.id, a]));
  const statOf = new Map(stats.data.flatMap((s) => (s.category_account_id ? [[s.category_account_id, s] as const] : [])));
  const uncategorized = stats.data.find((s) => s.grp === "uncategorized");

  const row = (id: string): CategoryListRow | null => {
    const a = byId.get(id);
    if (!a) return null;
    const s = statOf.get(id);
    return {
      id, name: a.name, type: a.type, parentId: a.parent_id, isSystem: a.is_system, isStandard: a.is_standard,
      description: a.description, count: Number(s?.tx_count ?? 0), total: Number(s?.total_cents ?? 0),
      share: null, isNew: !!s?.is_new, used: !!s,
    };
  };

  const groups: CategoryGroup[] = (["income", "expense", "other", "transfer"] as const).map((key) => {
    const ids = key === "transfer"
      ? stats.data.filter((s) => s.grp === "transfer" && s.category_account_id).map((s) => s.category_account_id!)
      : key === "other"
        ? stats.data.filter((s) => ["asset", "liability", "equity"].includes(s.grp) && s.category_account_id).map((s) => s.category_account_id!)
        // Income and expense: every active, visible, non-system category, used or not.
        : accounts.data.filter((a) => a.type === key && !a.archived_at && !a.is_hidden && !a.is_system && !a.is_money_account).map((a) => a.id);
    const rows = ids.flatMap((id) => row(id) ?? []);
    const total = sumCents(rows.filter((r) => r.total > 0).map((r) => r.total));
    for (const r of rows) {
      // Display ratio of SQL totals, one decimal.
      if (key !== "transfer" && total > 0) r.share = Math.round((Math.max(r.total, 0) / total) * 1000) / 10;
    }
    rows.sort((a, b) => Number(b.used) - Number(a.used) || b.total - a.total || a.name.localeCompare(b.name));
    return { key, label: GROUP_LABEL[key], rows };
  }).filter((g) => g.rows.length > 0);

  const archived = accounts.data.filter((a) => a.archived_at && !a.is_money_account && !a.is_hidden)
    .map((a) => ({ id: a.id, name: a.name, type: a.type }));

  return {
    groups, archived,
    uncategorized: uncategorized ? { count: Number(uncategorized.tx_count), total: Number(uncategorized.total_cents) } : null,
    usedCount: groups.reduce((n, g) => n + g.rows.filter((r) => r.used).length, 0),
    parentName: (id: string | null) => (id ? byId.get(id)?.name ?? null : null),
  };
}

/** The detail panel: month totals for the last six months and the top vendors this month. */
export async function getCategoryDetail(businessId: string, accountId: string, month: ReturnType<typeof resolveMonth>) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const [monthly, vendors] = await Promise.all([
    supabase.rpc("category_monthly", { p_business_id: business.id, p_account_id: accountId, p_months: 6, p_through: month.to < todayIso() ? month.to : todayIso() }),
    supabase.rpc("category_top_vendors", { p_business_id: business.id, p_account_id: accountId, p_from: month.from, p_to: month.to, p_limit: 3 }),
  ]);
  if (monthly.error) throw new Error(monthly.error.message);
  if (vendors.error) throw new Error(vendors.error.message);
  const months = monthly.data.map((m) => ({ month: m.month, cents: Number(m.total_cents), count: Number(m.tx_count) }));
  // Average over the months that had any activity (integer cents, rounded).
  const active = months.filter((m) => m.count > 0);
  const average = active.length ? Math.round(sumCents(active.map((m) => m.cents)) / active.length) : 0;
  return {
    months, average,
    vendors: vendors.data.map((v) => ({ name: v.vendor, cents: Number(v.total_cents), count: Number(v.tx_count) })),
  };
}
