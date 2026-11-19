// Reads for the Tax section. RLS decides what the signed-in user sees.
import "server-only";
import { getBusiness, getSupabase } from "@/lib/dal";

export interface AssetRow {
  id: string; name: string; kind: string; acquiredOn: string; inServiceOn: string; cost: number; salvage: number; method: string;
  lifeMonths: number | null; disposedOn: string | null; notes: string | null; account: string; purchaseId: string | null;
  posted: number; scheduled: number; bookValue: number; monthly: number; lastThrough: string | null;
}

export async function getAssets(businessId: string, asOf: string): Promise<AssetRow[]> {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const [assets, summary] = await Promise.all([
    supabase.from("fixed_assets").select("*").eq("business_id", business.id).order("in_service_on", { ascending: false }),
    supabase.rpc("fixed_asset_summary", { p_business_id: business.id, p_as_of: asOf }),
  ]);
  if (assets.error) throw new Error(assets.error.message);
  if (summary.error) throw new Error(summary.error.message);
  const s = new Map(summary.data.map((r) => [r.asset_id, r]));
  const accountIds = [...new Set(assets.data.map((a) => a.asset_account_id))];
  const { data: accts } = accountIds.length
    ? await supabase.from("accounts").select("id, name").in("id", accountIds)
    : { data: [] as { id: string; name: string }[] };
  const accountName = new Map((accts ?? []).map((a) => [a.id, a.name]));
  return assets.data.map((a) => {
    const x = s.get(a.id);
    return {
      id: a.id, name: a.name, kind: a.kind, acquiredOn: a.acquired_on, inServiceOn: a.in_service_on, cost: a.cost_cents,
      salvage: a.salvage_cents, method: a.method, lifeMonths: a.life_months, disposedOn: a.disposed_on, notes: a.notes,
      account: accountName.get(a.asset_account_id) ?? "", purchaseId: a.purchase_transaction_id,
      posted: x?.posted_cents ?? 0, scheduled: x?.scheduled_cents ?? 0, bookValue: x?.book_value_cents ?? a.cost_cents,
      monthly: x?.monthly_cents ?? 0, lastThrough: x?.last_through ?? null,
    };
  });
}

export async function getLargePurchases(businessId: string) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("large_purchase_candidates", { p_business_id: business.id });
  if (error) throw new Error(error.message);
  return data.map((r) => ({ id: r.transaction_id, date: r.date, description: r.description, amount: r.amount_cents, categoryId: r.category_account_id }));
}

/** Latest month end with depreciation posted, across all assets. */
export function lastPosted(assets: AssetRow[]) {
  return assets.reduce<string | null>((m, a) => (a.lastThrough && (!m || a.lastThrough > m) ? a.lastThrough : m), null);
}

export interface TaxItemRow {
  id: string; kind: "health" | "retirement"; type: string; person: string | null; date: string; amount: number;
  description: string; transactionId: string | null; note: string | null;
}

export async function getTaxItems(businessId: string, from: string, to: string): Promise<TaxItemRow[]> {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("tax_items").select("*").eq("business_id", business.id)
    .gte("date", from).lte("date", to).order("date", { ascending: false });
  if (error) throw new Error(error.message);
  return data.map((r) => ({
    id: r.id, kind: r.kind as "health" | "retirement", type: r.item_type, person: r.person, date: r.date, amount: r.amount_cents,
    description: r.description, transactionId: r.transaction_id, note: r.note,
  }));
}

export async function getTaxCandidates(businessId: string, from: string, to: string) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("tax_item_candidates", { p_business_id: business.id, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data.map((r) => ({ kind: r.kind as "health" | "retirement", id: r.transaction_id, date: r.date, description: r.description, amount: r.amount_cents }));
}

export interface TripRow {
  id: string; date: string; miles: number; purpose: string; from: string | null; to: string | null; vehicle: string | null;
  rate: number | null; deduction: number;
}

export async function getTrips(businessId: string, from: string, to: string): Promise<TripRow[]> {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("mileage_trips_rated").select("*").eq("business_id", business.id)
    .gte("date", from).lte("date", to).order("date", { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  return data.map((t) => ({
    id: t.id!, date: t.date!, miles: t.miles_tenths ?? 0, purpose: t.purpose ?? "", from: t.start_place, to: t.end_place,
    vehicle: t.vehicle, rate: t.rate_tenth_cents, deduction: t.deduction_cents ?? 0,
  }));
}

export async function getMileageRates() {
  const supabase = await getSupabase();
  const { data } = await supabase.from("mileage_rates").select("effective_from, rate_tenth_cents").order("effective_from", { ascending: false });
  return (data ?? []).map((r) => ({ from: r.effective_from, rate: r.rate_tenth_cents }));
}

export async function getAllDocuments(businessId: string) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("documents")
    .select("id, file_name, content_type, size_bytes, kind, created_at, transaction_id, asset_id, tax_item_id, note")
    .eq("business_id", business.id).order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return data.map((d) => ({
    id: d.id, name: d.file_name, type: d.content_type, size: d.size_bytes, kind: d.kind, createdAt: d.created_at,
    transactionId: d.transaction_id, assetId: d.asset_id, taxItemId: d.tax_item_id, note: d.note,
  }));
}

/** Descriptions for the transactions a page links to (by id). */
export async function getTransactionLabels(businessId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { date: string; description: string; amount: number }>();
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data } = await supabase.from("transactions").select("id, date, description_clean, description_raw, amount_cents")
    .eq("business_id", business.id).in("id", ids.slice(0, 500));
  return new Map((data ?? []).map((t) => [t.id, { date: t.date, description: t.description_clean ?? t.description_raw, amount: t.amount_cents }]));
}
