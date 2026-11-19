// Insights panel reads: public.insights() for the period, the P&L for the same period
// (for "Explain this month"), and the cached explanation with whether it's out of date.
import "server-only";
import { getBusiness, getSupabase } from "@/lib/dal";
import { resolveModel } from "@/lib/ai/engine";
import { EXPLAIN_PROMPT_VERSION, explainAggregates, explainHash, type Insights, type PnlLine } from "@/lib/ai/explain";
import { serverEnv } from "@/lib/env/server";

export async function getInsightsData(businessId: string, from: string, to: string) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const [ins, pnl, cached] = await Promise.all([
    supabase.rpc("insights", { p_business_id: business.id, p_from: from, p_to: to }),
    supabase.rpc("report_pnl", { p_business_id: business.id, p_from: from, p_to: to }),
    supabase.from("ai_explanations").select("summary, input_hash, prompt_version, model, created_at")
      .eq("business_id", business.id).eq("period_from", from).eq("period_to", to).maybeSingle(),
  ]);
  if (ins.error) throw new Error(ins.error.message);
  if (pnl.error) throw new Error(pnl.error.message);
  if (cached.error) throw new Error(cached.error.message);
  const insights = ins.data as unknown as Insights;
  const aggregates = explainAggregates(insights, pnl.data as PnlLine[]);
  const model = resolveModel(business.ai_model, serverEnv.anthropicModel);
  const hash = explainHash(model, aggregates);
  const total = (key: string) => Number((pnl.data as PnlLine[]).find((r) => r.key === key)?.total_cents ?? 0);
  return {
    totals: { income: total("income_total"), expenses: total("expense_total"), net: total("net_income") },
    business,
    insights,
    aggregates,
    model,
    hash,
    explanation: cached.data
      ? { summary: cached.data.summary, createdAt: cached.data.created_at,
          stale: cached.data.input_hash !== hash || cached.data.prompt_version !== EXPLAIN_PROMPT_VERSION }
      : null,
  };
}
export type InsightsData = Awaited<ReturnType<typeof getInsightsData>>;
