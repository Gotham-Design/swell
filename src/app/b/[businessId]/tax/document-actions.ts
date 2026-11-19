"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getBusiness, getSupabase } from "@/lib/dal";
import { DOCUMENT_KINDS, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/lib/documents/kinds";
import type { FormState } from "@/lib/validation/business";

const BUCKET = "documents";

export interface DocumentRow {
  id: string; name: string; type: string; size: number; kind: string; createdAt: string;
  transactionId: string | null; assetId: string | null; taxItemId: string | null; note: string | null;
}

const linkSchema = z.object({
  transactionId: z.uuid().nullish(), assetId: z.uuid().nullish(), taxItemId: z.uuid().nullish(),
});
const recordSchema = linkSchema.extend({
  path: z.string().min(40).max(500), name: z.string().trim().min(1).max(255), type: z.enum(DOCUMENT_TYPES as [string, ...string[]]),
  size: z.number().int().min(1).max(MAX_DOCUMENT_BYTES), kind: z.enum(DOCUMENT_KINDS),
});

const toRow = (d: { id: string; file_name: string; content_type: string; size_bytes: number; kind: string; created_at: string;
  transaction_id: string | null; asset_id: string | null; tax_item_id: string | null; note: string | null }): DocumentRow => ({
  id: d.id, name: d.file_name, type: d.content_type, size: d.size_bytes, kind: d.kind, createdAt: d.created_at,
  transactionId: d.transaction_id, assetId: d.asset_id, taxItemId: d.tax_item_id, note: d.note,
});
const COLS = "id, file_name, content_type, size_bytes, kind, created_at, transaction_id, asset_id, tax_item_id, note";

/** After the browser put the file in storage (under this business's folder), record it. */
export async function recordDocument(businessId: string, input: z.input<typeof recordSchema>): Promise<{ ok: true; document: DocumentRow } | { ok: false; error: string }> {
  const { business, canWrite } = await getBusiness(businessId);
  if (!canWrite) return { ok: false, error: "Only owners and editors can add documents." };
  const v = recordSchema.safeParse(input);
  if (!v.success || !v.data.path.startsWith(`${business.id}/`)) return { ok: false, error: "That file couldn't be saved." };
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("documents").insert({
    business_id: business.id, storage_path: v.data.path, file_name: v.data.name, content_type: v.data.type, size_bytes: v.data.size,
    kind: v.data.kind, transaction_id: v.data.transactionId ?? null, asset_id: v.data.assetId ?? null, tax_item_id: v.data.taxItemId ?? null,
  }).select(COLS).single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([v.data.path]);
    return { ok: false, error: error.message };
  }
  refresh();
  return { ok: true, document: toRow(data) };
}

/** Documents attached to one transaction, asset or log entry. */
export async function listDocuments(businessId: string, link: z.input<typeof linkSchema>): Promise<DocumentRow[]> {
  const { business } = await getBusiness(businessId);
  const l = linkSchema.parse(link);
  const supabase = await getSupabase();
  let q = supabase.from("documents").select(COLS).eq("business_id", business.id).order("created_at", { ascending: false }).limit(50);
  if (l.transactionId) q = q.eq("transaction_id", l.transactionId);
  else if (l.assetId) q = q.eq("asset_id", l.assetId);
  else if (l.taxItemId) q = q.eq("tax_item_id", l.taxItemId);
  else return [];
  const { data } = await q;
  return (data ?? []).map(toRow);
}

/** Remove a document and its file. */
export async function deleteDocument(businessId: string, documentId: string): Promise<FormState> {
  const { business, canWrite } = await getBusiness(businessId);
  if (!canWrite) return { error: "Only owners and editors can remove documents." };
  const supabase = await getSupabase();
  const { data: d } = await supabase.from("documents").select("id, storage_path").eq("id", documentId).eq("business_id", business.id).maybeSingle();
  if (!d) return { error: "That document is already gone." };
  const removed = await supabase.storage.from(BUCKET).remove([d.storage_path]);
  if (removed.error) return { error: removed.error.message };
  const { error } = await supabase.from("documents").delete().eq("id", d.id);
  if (error) return { error: error.message };
  refresh();
  return { ok: true, message: "Document removed" };
}
