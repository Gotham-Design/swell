"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getBusiness, getPickerOptions, getRecentCategoryIds, getSupabase, todayIso, type PickerOption } from "@/lib/dal";
import { allowForUser, LIMITS, TOO_MANY } from "@/lib/security/rate-limit";
import { answerAsk, getAskHome, getAskVocabulary, type AskAnswer, type AskHomeItem } from "@/lib/search/answer";
import type { AskQuery, AskVocabulary } from "@/lib/search/parse";
import { askModel } from "@/lib/search/ai";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface AskContext {
  vocab: AskVocabulary;
  home: AskHomeItem[];
  today: string;
  canWrite: boolean;
  options: PickerOption[];
  recentIds: string[];
  /** A model can read full sentences (the key is set on the server). */
  smart: boolean;
}

/** Everything the bar needs when it opens: what words can name, and where to pick up. */
export async function loadAsk(businessId: string): Promise<Result<{ context: AskContext }>> {
  const { business, canWrite } = await getBusiness(businessId);
  const [vocab, home, options, recentIds] = await Promise.all([
    getAskVocabulary(business.id), getAskHome(business.id), getPickerOptions(business.id), getRecentCategoryIds(business.id),
  ]);
  return { ok: true, context: { vocab, home, today: todayIso(), canWrite, options, recentIds, smart: askModel.available() } };
}

const id = z.uuid();
const cents = z.number().int().nonnegative().max(1e13);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z.object({
  measure: z.enum(["spend", "earn", "list"]),
  vendor: z.object({ key: z.string().min(1).max(200), label: z.string().max(200) }).optional(),
  category: z.object({ id, name: z.string().max(200) }).optional(),
  account: z.object({ id, name: z.string().max(200) }).optional(),
  range: z.object({ from: iso, to: iso, label: z.string().max(80) }).optional(),
  min: cents.optional(),
  max: cents.optional(),
  uncategorized: z.boolean().optional(),
  search: z.string().max(200).optional(),
});

/** Answer a question already read into an AskQuery. */
export async function runAsk(businessId: string, query: AskQuery): Promise<Result<{ answer: AskAnswer }>> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return { ok: false, error: "That question couldn't be read." };
  try {
    return { ok: true, answer: await answerAsk(businessId, parsed.data) };
  } catch (e) {
    console.error("ask failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Something went wrong answering that. Try rewording it." };
  }
}

/** A full sentence the local reader couldn't place: the model reads it into an AskQuery. */
export async function readWithModel(businessId: string, text: string): Promise<Result<{ query: AskQuery | null }>> {
  if (!askModel.available()) return { ok: true, query: null };
  const clean = text.trim().slice(0, 300);
  if (!clean) return { ok: true, query: null };
  const { business } = await getBusiness(businessId);
  if (!(await allowForUser(LIMITS.aiPerUser))) return { ok: false, error: TOO_MANY };
  const vocab = await getAskVocabulary(business.id);
  try {
    return { ok: true, query: await askModel.read(clean, vocab, todayIso()) };
  } catch (e) {
    console.error("ask model failed:", e instanceof Error ? e.message : e);
    return { ok: true, query: null };
  }
}

/** "Rule: Restaurant Depot → Ingredients", from the answer's next steps. */
export async function makeVendorRule(businessId: string, vendorKey: string, categoryId: string): Promise<Result<{ message: string }>> {
  const { business, canWrite } = await getBusiness(businessId);
  if (!canWrite) return { ok: false, error: "Only owners and editors can make rules." };
  if (!id.safeParse(categoryId).success || !vendorKey.trim()) return { ok: false, error: "That rule couldn't be made." };
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("save_category_rule", {
    p_business_id: business.id, p_vendor_normalized: vendorKey.trim(), p_category_account_id: categoryId,
  });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, message: "Rule saved. New transactions from this vendor are filed automatically." };
}
