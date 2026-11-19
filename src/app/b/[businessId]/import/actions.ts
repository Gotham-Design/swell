"use server";

import Papa from "papaparse";
import { refresh } from "next/cache";
import { after } from "next/server";
import { runSuggestions } from "@/lib/ai/run";
import { getBusiness, getSupabase } from "@/lib/dal";
import { allowForUser, LIMITS, TOO_MANY } from "@/lib/security/rate-limit";
import { getTransferCounts } from "@/lib/dal-transfers";
import { applyMapping, mappingProblems, type Mapping, type ProblemField } from "@/lib/import/mapping";
import { ImportFileError, MAX_FILE_BYTES, analyzeFile, pickStatementAccount, type ParsedFile } from "@/lib/import/parse";
import { analyzePdf } from "@/lib/import/pdf/read";
import { isPdf } from "@/lib/import/xlsx";
import { normalizeDescription } from "@/lib/transactions/normalize";
import type { Json } from "@/lib/supabase/database.types";
import type { AccountType } from "@/lib/validation/accounts";
import { mappingSchema, templateSchema } from "@/lib/validation/import";
import { quickCreateCategory } from "@/app/b/[businessId]/transactions/actions";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Any statement file: PDFs are read here, everything else with the same code the browser runs. */
async function readAny(bytes: Uint8Array): Promise<ParsedFile> {
  return isPdf(bytes) ? analyzePdf(bytes) : analyzeFile(bytes);
}

/** Read a PDF statement for the mapping step (PDFs aren't read in the browser). */
export async function readStatementPdf(businessId: string, formData: FormData): Promise<Result<{ file: ParsedFile }>> {
  await getBusiness(businessId);
  if (!(await allowForUser(LIMITS.importPerUser))) return { ok: false, error: TOO_MANY };
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a file to import." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "That file is over 10 MB." };
  try {
    return { ok: true, file: await analyzePdf(new Uint8Array(await file.arrayBuffer())) };
  } catch (e) {
    return { ok: false, error: e instanceof ImportFileError ? e.message : "We couldn't read that PDF." };
  }
}

/** The saved mapping for this account and file layout, if there is one. */
export async function findTemplate(businessId: string, moneyAccountId: string, signature: string): Promise<Mapping | null> {
  await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data } = await supabase.from("import_templates").select("mapping")
    .eq("business_id", businessId).eq("money_account_id", moneyAccountId).eq("header_signature", signature).maybeSingle();
  const parsed = mappingSchema.safeParse(data?.mapping);
  return parsed.success ? parsed.data : null;
}

/** Save (or replace) the mapping for this account and file layout. */
export async function saveTemplate(businessId: string, input: unknown): Promise<Result> {
  const { canWrite } = await getBusiness(businessId);
  if (!canWrite) return { ok: false, error: "Only owners and editors can save import mappings." };
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That mapping isn't valid." };
  const problems = mappingProblems(parsed.data.mapping);
  if (problems.length) return { ok: false, error: problems.join(" ") };
  const supabase = await getSupabase();
  const { error } = await supabase.from("import_templates").upsert(
    { business_id: businessId, ...parsed.data },
    { onConflict: "money_account_id,header_signature" },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ---------------------------------------------------------------------------
// Verify and commit (Prompt 7)
// ---------------------------------------------------------------------------

/**
 * Stage a file for verification. The server re-reads the original file with the same
 * code the browser used and the confirmed mapping; it never trusts parsed rows from the
 * client. Returns the new batch id.
 */
export async function stageImport(businessId: string, formData: FormData): Promise<Result<{ batchId: string }>> {
  const { canWrite } = await getBusiness(businessId);
  if (!canWrite) return { ok: false, error: "Only owners and editors can import." };
  if (!(await allowForUser(LIMITS.importPerUser))) return { ok: false, error: TOO_MANY };
  const file = formData.get("file");
  const accountId = String(formData.get("money_account_id") ?? "");
  const replace = String(formData.get("replace_batch_id") ?? "");
  if (!(file instanceof File)) return { ok: false, error: "Choose a file to import." };
  const mappingParse = mappingSchema.safeParse(JSON.parse(String(formData.get("mapping") ?? "null")));
  if (!mappingParse.success) return { ok: false, error: "That mapping isn't valid." };
  const mapping = mappingParse.data;
  const problems = mappingProblems(mapping);
  if (problems.length) return { ok: false, error: problems.join(" ") };

  const supabase = await getSupabase();
  const { data: account } = await supabase.from("accounts").select("id, is_money_account, archived_at")
    .eq("id", accountId).eq("business_id", businessId).maybeSingle();
  if (!account?.is_money_account || account.archived_at) return { ok: false, error: "Pick an active money account." };

  let parsed: ParsedFile;
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    parsed = await readAny(bytes);
    // A combined statement: just the account picked in the mapping step.
    if (parsed.statement) parsed = pickStatementAccount(parsed, Number(formData.get("statement_account") ?? 0) || 0);
  } catch (e) {
    return { ok: false, error: e instanceof ImportFileError ? e.message : "We couldn't read that file." };
  }
  const columns = [mapping.date, mapping.amount, mapping.debit, mapping.credit, mapping.description, mapping.description2,
    mapping.category, mapping.reference, mapping.memo, mapping.balance].filter((c): c is number => c !== null);
  if (columns.some((c) => c >= parsed.headers.length)) return { ok: false, error: "The mapping doesn't fit this file's columns." };

  const mapped = applyMapping(parsed.rows, mapping);
  const { data: batch, error: batchError } = await supabase.from("import_batches").insert({
    business_id: businessId, money_account_id: accountId, status: "staged", file_name: file.name.slice(0, 255),
    file_size_bytes: bytes.byteLength, header_signature: parsed.signature, mapping,
    // Keep the transaction table only, not the file: no bank summary lines or account numbers above it.
    source_text: Papa.unparse([parsed.headers, ...parsed.rows]), encoding: parsed.encoding,
  }).select("id").single();
  if (batchError) return { ok: false, error: batchError.message };
  // A file a client sent through a request link: tie it to this import (deleted once committed).
  const uploadId = String(formData.get("upload_id") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(uploadId)) {
    await supabase.from("statement_uploads").update({ import_batch_id: batch.id })
      .eq("id", uploadId).eq("business_id", businessId).is("deleted_at", null);
  }

  const rows = mapped.map((r) => {
    const { description_clean, vendor_normalized } = normalizeDescription(r.description);
    return {
      business_id: businessId, import_batch_id: batch.id, row_index: r.index, raw: parsed.rows[r.index],
      date: r.date, amount_cents: r.amount_cents, description_raw: r.description || null,
      description_clean: r.description ? description_clean : null, vendor_normalized,
      category_name: r.category, reference: r.reference, memo: r.memo, balance_cents: r.balance_cents,
      parse_issues: toJson(r.problems),
    };
  });
  // A few chunks in flight at once keeps 50k rows well inside the time limit.
  const CHUNK = 2500;
  const chunks = Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));
  for (let i = 0; i < chunks.length; i += 4) {
    const results = await Promise.all(chunks.slice(i, i + 4).map((c) => supabase.from("import_rows").insert(c)));
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      await supabase.from("import_batches").delete().eq("id", batch.id);
      return { ok: false, error: failed.error.message };
    }
  }

  const { error: verifyError } = await supabase.rpc("verify_import", { p_batch_id: batch.id });
  if (verifyError) return { ok: false, error: verifyError.message };
  if (replace) await discardImport(businessId, replace);
  return { ok: true, batchId: batch.id };
}

/** Include or exclude rows (null = back to the default for their status), then re-total. */
export async function setRowDecision(businessId: string, batchId: string, rowIds: string[], decision: "include" | "exclude" | null): Promise<Result> {
  if (!(await getBusiness(businessId)).canWrite) return { ok: false, error: "Only owners and editors can change an import." };
  const supabase = await getSupabase();
  const { error } = await supabase.from("import_rows").update({ decision }).eq("import_batch_id", batchId).in("id", rowIds);
  if (error) return { ok: false, error: error.message };
  return reverify(batchId);
}

/** Fix one cell of a row (the value is what the bank's column should have said), then re-check. */
export async function fixRowCell(businessId: string, batchId: string, rowId: string, field: ProblemField, value: string): Promise<Result> {
  if (!(await getBusiness(businessId)).canWrite) return { ok: false, error: "Only owners and editors can change an import." };
  const supabase = await getSupabase();
  const [{ data: batch }, { data: row }] = await Promise.all([
    supabase.from("import_batches").select("mapping").eq("id", batchId).single(),
    supabase.from("import_rows").select("raw, row_index").eq("id", rowId).eq("import_batch_id", batchId).single(),
  ]);
  const mapping = mappingSchema.safeParse(batch?.mapping);
  if (!mapping.success || !row) return { ok: false, error: "Import not found." };
  const column = mapping.data[field];
  if (column === null) return { ok: false, error: "That field isn't mapped." };
  const raw = [...row.raw];
  raw[column] = value.slice(0, 1000);
  const [m] = applyMapping([raw], mapping.data);
  const { description_clean, vendor_normalized } = normalizeDescription(m.description);
  const { error } = await supabase.from("import_rows").update({
    raw, date: m.date, amount_cents: m.amount_cents, description_raw: m.description || null,
    description_clean: m.description ? description_clean : null, vendor_normalized, parse_issues: toJson(m.problems),
  }).eq("id", rowId);
  if (error) return { ok: false, error: error.message };
  return reverify(batchId);
}

export async function flipSign(businessId: string, batchId: string): Promise<Result> {
  await getBusiness(businessId);
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("flip_import_sign", { p_batch_id: batchId });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** Point a category name from the file at an existing category (null clears it). */
export async function mapCategoryName(businessId: string, batchId: string, name: string, accountId: string | null): Promise<Result> {
  if (!(await getBusiness(businessId)).canWrite) return { ok: false, error: "Only owners and editors can change an import." };
  const supabase = await getSupabase();
  const { data: batch } = await supabase.from("import_batches").select("category_map").eq("id", batchId).single();
  const map = { ...((batch?.category_map ?? {}) as Record<string, string>) };
  const key = name.trim().toLowerCase();
  if (accountId) map[key] = accountId;
  else delete map[key];
  const { error } = await supabase.from("import_batches").update({ category_map: map }).eq("id", batchId);
  if (error) return { ok: false, error: error.message };
  return reverify(batchId);
}

/** "Create" for an unmatched category name: make it, then map the name to it. */
export async function createCategoryForName(businessId: string, batchId: string, name: string, type: AccountType): Promise<Result> {
  const created = await quickCreateCategory(businessId, name, type);
  if (!created.ok) return created;
  return mapCategoryName(businessId, batchId, name, created.id);
}

export type ImportOutcome = {
  committed: number;
  /** Filed by a rule, by vendor history or a confident suggestion, or by the file's own category. */
  autoFiled: number;
  /** Left for a person: with a suggestion to confirm, a likely transfer / owner draw, or nothing yet. */
  toReview: number;
  flagged: number;
  /** Suggestions are still being worked out in the background (a large import, or a slow reply). */
  stillSorting: boolean;
  /** Payments that look like the same transfer on two accounts, waiting to be matched. */
  transfers: number;
};

export async function commitImport(businessId: string, batchId: string, expectedCount: number): Promise<Result<{ committed: number; outcome: ImportOutcome }>> {
  const ctx = await getBusiness(businessId);
  if (!ctx.canWrite) return { ok: false, error: "Only owners and editors can import." };
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("commit_import", { p_batch_id: batchId, p_expected_count: expectedCount });
  if (error) return { ok: false, error: error.message };
  // Files clients sent for this import are deleted from storage now that it's in the books.
  const { data: sent } = await supabase.from("statement_uploads").select("id, storage_path")
    .eq("business_id", businessId).eq("import_batch_id", batchId).is("deleted_at", null);
  if (sent?.length) {
    const removed = await supabase.storage.from("client-statements").remove(sent.map((u) => u.storage_path));
    if (removed.error) console.error("removing imported client files failed:", removed.error.message);
    else {
      const now = new Date().toISOString();
      await supabase.from("statement_uploads").update({ imported_at: now, deleted_at: now }).in("id", sent.map((u) => u.id));
    }
  }
  // Patterns and auto rules follow every commit. The import is already saved, so a
  // failure here is logged, not reported; the nightly run catches up.
  const patterns = await supabase.rpc("refresh_patterns", { p_business_id: businessId });
  if (patterns.error) console.error("refresh_patterns after import failed:", patterns.error.message);

  // Sort the new rows now, so the person sees the outcome rather than a list still filling in.
  // A large import keeps going in the background after ~25 seconds.
  let stillSorting = false;
  if (ctx.business.ai_enabled) {
    const run = runSuggestions(businessId, 6);
    const done = await Promise.race([run.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 25_000))]);
    if (!done) { stillSorting = true; after(() => run); }
  }

  const { data: rows } = await supabase.from("transactions").select("id, category_account_id, category_source")
    .eq("business_id", businessId).eq("import_batch_id", batchId).is("deleted_at", null);
  const open = (rows ?? []).filter((r) => !r.category_account_id).map((r) => r.id);
  const { data: flags } = open.length
    ? await supabase.from("ai_suggestions").select("transaction_id, flags").eq("business_id", businessId).eq("status", "pending").in("transaction_id", open)
    : { data: [] as { transaction_id: string; flags: string[] }[] };
  const autoFiled = (rows ?? []).filter((r) => r.category_account_id && r.category_source !== "user").length;
  if (stillSorting === false && open.length > 0 && ctx.business.ai_enabled && (flags ?? []).length < open.length) {
    // Rows the run didn't reach (over the batch limit): finish them in the background.
    after(() => runSuggestions(businessId));
  }
  return {
    ok: true, committed: data,
    outcome: {
      committed: data, autoFiled, toReview: open.length,
      flagged: (flags ?? []).filter((f) => f.flags.some((x) => x === "possible transfer" || x === "possible owner draw")).length,
      stillSorting,
      transfers: await getTransferCounts(businessId).then((c) => c.pairs + c.lone).catch(() => 0),
    },
  };
}

/**
 * Money in and out came in the wrong way round: flip every transaction from this import,
 * then sort the ones whose categories were cleared again.
 */
export async function flipCommittedImport(businessId: string, batchId: string): Promise<Result<{ flipped: number }>> {
  const { business, canWrite } = await getBusiness(businessId);
  if (!canWrite) return { ok: false, error: "Only owners and editors can change an import." };
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("flip_committed_import", { p_batch_id: batchId });
  if (error) return { ok: false, error: error.message };
  if (business.ai_enabled) {
    const run = runSuggestions(businessId, 6);
    const done = await Promise.race([run.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 20_000))]);
    if (!done) after(() => run);
  }
  refresh();
  return { ok: true, flipped: data };
}

export async function undoImport(businessId: string, batchId: string): Promise<Result<{ deleted: number }>> {
  if (!(await getBusiness(businessId)).canWrite) return { ok: false, error: "Only owners and editors can undo an import." };
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("undo_import", { p_batch_id: batchId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, deleted: data };
}

/** Throw away an import that hasn't been committed. */
export async function discardImport(businessId: string, batchId: string): Promise<Result> {
  if (!(await getBusiness(businessId)).canWrite) return { ok: false, error: "Only owners and editors can change an import." };
  const supabase = await getSupabase();
  const { error } = await supabase.from("import_batches").delete().eq("id", batchId).eq("business_id", businessId)
    .in("status", ["staged", "verified"]);
  return error ? { ok: false, error: error.message } : { ok: true };
}

async function reverify(batchId: string): Promise<Result> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("verify_import", { p_batch_id: batchId });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** Plain JSON for jsonb columns. */
const toJson = <T,>(v: T) => JSON.parse(JSON.stringify(v)) as NonNullable<Json>;
