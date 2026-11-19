"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getBusiness, getSupabase } from "@/lib/dal";
import type { Json } from "@/lib/supabase/database.types";
import { ruleProblem, type RuleDraft } from "@/lib/rules/model";
import { normalizeDescription } from "@/lib/transactions/normalize";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const NOT_ALLOWED = { ok: false as const, error: "Only owners and editors can change rules." };
const uuid = z.uuid();
const optDate = z.union([z.literal(""), z.iso.date()]).nullable().optional();

async function writer(businessId: string) {
  return (await getBusiness(businessId)).canWrite;
}

export async function saveRule(businessId: string, rule: RuleDraft): Promise<Result<{ id: string }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const problem = ruleProblem(rule);
  if (problem) return { ok: false, error: problem };
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("save_rule", { p_business_id: businessId, p_rule: rule as unknown as Json });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id: data };
}

export interface DraftMatch { transaction_id: string; date: string; description: string; amount_cents: number; category_id: string | null; category_source: string | null }
export interface Conflict { rule_id: string; name: string; priority: number; category_id: string | null; overlap: number }

/** Live counter and conflicts for the builder (nothing is saved). */
export async function checkDraft(businessId: string, rule: RuleDraft): Promise<Result<{ count: number; sample: DraftMatch[]; conflicts: Conflict[] }>> {
  await getBusiness(businessId);
  const supabase = await getSupabase();
  const [m, c] = await Promise.all([
    supabase.rpc("rule_draft_matches", { p_business_id: businessId, p_rule: rule as unknown as Json, p_limit: 10 }),
    supabase.rpc("rule_conflicts", { p_business_id: businessId, p_rule: rule as unknown as Json }),
  ]);
  if (m.error) return { ok: false, error: m.error.message };
  if (c.error) return { ok: false, error: c.error.message };
  const res = m.data as unknown as { count: number; sample: DraftMatch[] };
  return { ok: true, count: res.count, sample: res.sample, conflicts: (c.data ?? []) as Conflict[] };
}

export interface TestResult {
  matched: { id: string; name: string; priority: number; stop_processing: boolean }[];
  winner: { id: string; name: string; match_mode: string; conditions: { field: string; operator: string; value: unknown; matched: boolean }[] } | null;
  category_id: string | null; memo_set: string | null; memo_append: string | null; skip_ai: boolean;
}

/** Which rule would win for a described transaction, and why. */
export async function testRules(businessId: string, row: {
  description: string; amount_cents: number; money_account_id?: string | null; date?: string | null; vendor?: string | null; source?: string;
}): Promise<Result<{ result: TestResult }>> {
  await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("test_rules", {
    p_business_id: businessId,
    p_row: {
      // Cleaned the same way saved transactions are, so "vendor equals" rules match.
      description_clean: normalizeDescription(row.description).description_clean, description_raw: row.description,
      vendor_normalized: row.vendor ?? normalizeDescription(row.description).vendor_normalized,
      amount_cents: row.amount_cents, money_account_id: row.money_account_id || null, date: row.date || null, source: row.source ?? "manual",
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data as unknown as TestResult };
}

export async function reorderRules(businessId: string, ids: string[]): Promise<Result> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  if (!ids.every((i) => uuid.safeParse(i).success)) return { ok: false, error: "Rule not found." };
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("reorder_rules", { p_business_id: businessId, p_rule_ids: ids });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

async function simple(businessId: string, fn: "set_rule_enabled" | "duplicate_rule" | "approve_rule", args: Record<string, unknown>): Promise<Result> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const { error } = await supabase.rpc(fn, args as never);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}
export async function setRuleEnabled(businessId: string, id: string, enabled: boolean) {
  return simple(businessId, "set_rule_enabled", { p_rule_id: id, p_enabled: enabled });
}
export async function duplicateRule(businessId: string, id: string) {
  return simple(businessId, "duplicate_rule", { p_rule_id: id });
}
export async function approveRule(businessId: string, id: string) {
  return simple(businessId, "approve_rule", { p_rule_id: id });
}

/** Delete a rule, keeping or reverting the categories it set. */
export async function deleteRule(businessId: string, id: string, revert: boolean): Promise<Result<{ reverted: number }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Rule not found." };
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("delete_rule", { p_rule_id: id, p_revert: revert });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, reverted: data ?? 0 };
}

export interface PreviewRow {
  transaction_id: string; date: string; description: string; amount_cents: number; current_category_id: string | null;
  new_category_id: string | null; current_memo: string | null; new_memo: string | null; rule_id: string; rule_name: string;
}

/** Every row that would change if the rules ran now (all active rules, or just these). */
export async function previewRun(businessId: string, ruleIds: string[] | null, from?: string | null, to?: string | null): Promise<Result<{ rows: PreviewRow[] }>> {
  await getBusiness(businessId);
  if (!optDate.safeParse(from).success || !optDate.safeParse(to).success) return { ok: false, error: "Pick valid dates." };
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("preview_rule_run", {
    p_business_id: businessId, p_rule_ids: ruleIds ?? undefined, p_from: from || undefined, p_to: to || undefined,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []).map((r) => ({ ...r, amount_cents: Number(r.amount_cents) })) as PreviewRow[] };
}

export async function applyRun(businessId: string, ruleIds: string[] | null, from: string | null, to: string | null, ids: string[], expected: number): Promise<Result<{ runId: string | null; changed: number }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("apply_rule_run", {
    p_business_id: businessId, p_rule_ids: ruleIds as string[], p_from: from as string, p_to: to as string,
    p_transaction_ids: ids, p_expected_count: expected,
  });
  if (error) return { ok: false, error: error.message };
  refresh();
  const r = data as unknown as { run_id: string | null; changed: number };
  return { ok: true, runId: r.run_id, changed: r.changed };
}

export async function undoRun(businessId: string, runId: string): Promise<Result<{ restored: number; skipped: number }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  if (!uuid.safeParse(runId).success) return { ok: false, error: "Run not found." };
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("undo_rule_run", { p_run_id: runId });
  if (error) return { ok: false, error: error.message };
  refresh();
  const r = data as unknown as { restored: number; skipped: number };
  return { ok: true, restored: r.restored, skipped: r.skipped };
}
