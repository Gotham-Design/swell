"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getBusiness, getSupabase } from "@/lib/dal";
import { assetSchema, taxItemSchema, tripSchema } from "@/lib/validation/tax";
import { parseForm, type FormState } from "@/lib/validation/business";
import { parseMileageCsv } from "@/lib/tax/mileage-csv";
import { formatMiles } from "@/lib/tax/miles";

const fail = (e: { message: string }): FormState => ({ error: e.message });
async function writer(businessId: string) {
  const b = await getBusiness(businessId);
  if (!b.canWrite) throw new Error("Only owners and editors can change the tax records.");
  return { business: b.business, supabase: await getSupabase() };
}
const guard = async (fn: () => Promise<FormState>): Promise<FormState> => {
  try { return await fn(); } catch (e) { return { error: e instanceof Error ? e.message : "That didn't work." }; }
};

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
export async function saveAsset(businessId: string, assetId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  return guard(async () => {
    const { business, supabase } = await writer(businessId);
    const { data: v, state } = parseForm(assetSchema, formData);
    if (state) return state;
    const inService = v.in_service_on ?? v.acquired_on;
    const life = v.method === "straight_line" ? v.life_years : null;
    if (assetId) {
      const { error } = await supabase.rpc("update_fixed_asset", {
        p_asset_id: assetId, p_name: v.name, p_kind: v.kind, p_acquired_on: v.acquired_on, p_in_service_on: inService,
        p_cost_cents: v.cost, p_salvage_cents: v.salvage, p_method: v.method, p_life_months: life as number,
        p_disposed_on: v.disposed_on as string, p_notes: v.notes as string,
      });
      if (error) return fail(error);
      refresh();
      return { ok: true, message: "Asset updated. Post depreciation to true it up." };
    }
    const { error } = await supabase.rpc("create_fixed_asset", {
      p_business_id: business.id, p_name: v.name, p_kind: v.kind, p_acquired_on: v.acquired_on, p_in_service_on: inService,
      p_cost_cents: v.cost, p_salvage_cents: v.salvage, p_method: v.method,
      ...(life ? { p_life_months: life } : {}),
      ...(v.purchase_transaction_id ? { p_purchase_transaction_id: v.purchase_transaction_id } : {}),
      ...(v.notes ? { p_notes: v.notes } : {}),
    });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: v.purchase_transaction_id ? "Asset added, and its purchase moved to the balance sheet" : "Asset added" };
  });
}

export async function deleteAsset(businessId: string, assetId: string): Promise<FormState> {
  return guard(async () => {
    const { supabase } = await writer(businessId);
    const { error } = await supabase.rpc("delete_fixed_asset", { p_asset_id: assetId });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Asset removed" };
  });
}

export async function postDepreciation(businessId: string, through: string): Promise<FormState> {
  return guard(async () => {
    const { business, supabase } = await writer(businessId);
    if (!z.iso.date().safeParse(through).success) return { error: "Pick a month" };
    const { data, error } = await supabase.rpc("post_depreciation", { p_business_id: business.id, p_through: through });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: data ? `Posted ${data} depreciation entr${data === 1 ? "y" : "ies"}` : "Already up to date: nothing to post" };
  });
}

export async function undoDepreciation(businessId: string): Promise<FormState> {
  return guard(async () => {
    const { business, supabase } = await writer(businessId);
    const { data, error } = await supabase.rpc("undo_depreciation", { p_business_id: business.id });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: data ? `Took back ${data} entr${data === 1 ? "y" : "ies"}` : "Nothing to undo" };
  });
}

/** "Not an asset" / "Not health" / "Not retirement". */
export async function skipForTax(businessId: string, transactionId: string, what: "asset" | "health" | "retirement"): Promise<FormState> {
  return guard(async () => {
    const { business, supabase } = await writer(businessId);
    const { error } = await supabase.from("tax_skips").upsert({ business_id: business.id, transaction_id: transactionId, what },
      { onConflict: "business_id,transaction_id,what", ignoreDuplicates: true });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Won't suggest it again" };
  });
}

// ---------------------------------------------------------------------------
// Health and retirement
// ---------------------------------------------------------------------------
export async function saveTaxItem(businessId: string, itemId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  return guard(async () => {
    const { business, supabase } = await writer(businessId);
    const { data: v, state } = parseForm(taxItemSchema, formData);
    if (state) return state;
    const row = {
      kind: v.kind, item_type: v.item_type, person: v.person, date: v.date, amount_cents: v.amount, description: v.description,
      note: v.note, transaction_id: v.transaction_id,
    };
    const { error } = itemId
      ? await supabase.from("tax_items").update(row).eq("id", itemId).eq("business_id", business.id)
      : await supabase.from("tax_items").insert({ ...row, business_id: business.id });
    if (error) return fail(error.code === "23505" ? { message: "That transaction is already logged here" } : error);
    refresh();
    return { ok: true, message: itemId ? "Saved" : "Logged" };
  });
}

export async function deleteTaxItem(businessId: string, itemId: string): Promise<FormState> {
  return guard(async () => {
    const { business, supabase } = await writer(businessId);
    const { error } = await supabase.from("tax_items").delete().eq("id", itemId).eq("business_id", business.id);
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Removed from the log" };
  });
}

// ---------------------------------------------------------------------------
// Mileage
// ---------------------------------------------------------------------------
export async function addTrip(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return guard(async () => {
    const { business, supabase } = await writer(businessId);
    const { data: v, state } = parseForm(tripSchema, formData);
    if (state) return state;
    const miles = v.round_trip ? Math.min(v.miles * 2, 100000) : v.miles;
    const { error } = await supabase.from("mileage_trips").insert({
      business_id: business.id, date: v.date, miles_tenths: miles, purpose: v.purpose, start_place: v.start_place,
      end_place: v.end_place, vehicle: v.vehicle,
    });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: `Logged ${formatMiles(miles)} miles` };
  });
}

export async function deleteTrips(businessId: string, ids: string[]): Promise<FormState> {
  return guard(async () => {
    const { business, supabase } = await writer(businessId);
    const parsed = z.array(z.uuid()).max(2000).safeParse(ids);
    if (!parsed.success) return { error: "Pick trips to remove" };
    const { error } = await supabase.from("mileage_trips").delete().in("id", parsed.data).eq("business_id", business.id);
    if (error) return fail(error);
    refresh();
    return { ok: true, message: parsed.data.length === 1 ? "Trip removed" : `${parsed.data.length} trips removed` };
  });
}

/** A mileage log export: re-read on the server, then every business trip added at once. */
export async function importTrips(businessId: string, csvText: string): Promise<FormState & { added?: number }> {
  return guard(async () => {
    const { business, supabase } = await writer(businessId);
    if (csvText.length > 5_000_000) return { error: "That file is too big (5 MB at most)." };
    const parsed = parseMileageCsv(csvText);
    if (parsed.error) return { error: parsed.error };
    if (!parsed.trips.length) return { error: "No business trips found in that file." };
    if (parsed.trips.length > 5000) return { error: "Import at most 5,000 trips at a time." };
    const { error } = await supabase.from("mileage_trips").insert(parsed.trips.map((t) => ({ ...t, business_id: business.id })));
    if (error) return fail(error);
    refresh();
    const extra = [parsed.personal && `${parsed.personal} personal left out`, parsed.skipped && `${parsed.skipped} rows unreadable`].filter(Boolean).join(", ");
    return { ok: true, message: `Added ${parsed.trips.length} trip${parsed.trips.length === 1 ? "" : "s"}${extra ? ` (${extra})` : ""}` };
  }) as Promise<FormState & { added?: number }>;
}
