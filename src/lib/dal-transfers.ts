// Transfer matching reads, as the signed-in user (RLS applies). Pairs and one-sided transfers
// come from transfer_match_candidates (SQL); this file adds account names.
import "server-only";
import { getBusiness, getSupabase } from "@/lib/dal";

export interface TransferPair {
  outId: string; inId: string; amount: number; days: number; worded: boolean;
  out: { date: string; description: string; account: string };
  in: { date: string; description: string; account: string };
}
/** Money to or from an account that isn't in the books (amount signed: in > 0). */
export interface LoneTransfer { id: string; amount: number; date: string; description: string; account: string }
export interface TransferCandidates {
  pairs: TransferPair[];
  lone: LoneTransfer[];
  /** Owner Contributions / Owner Draws, found by subtype (people can rename them). */
  owner: { contribution: string | null; draw: string | null };
}

export async function getTransferCandidates(businessId: string): Promise<TransferCandidates> {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const [cands, accounts] = await Promise.all([
    supabase.rpc("transfer_match_candidates", { p_business_id: business.id, p_limit: 200 }),
    supabase.from("accounts").select("id, name, last4, subtype").eq("business_id", business.id),
  ]);
  if (cands.error) throw new Error(cands.error.message);
  if (accounts.error) throw new Error(accounts.error.message);
  const byId = new Map(accounts.data.map((a) => [a.id, `${a.name}${a.last4 ? ` ··${a.last4}` : ""}`]));
  const name = (id: string | null) => (id ? byId.get(id) ?? "" : "");
  return {
    pairs: cands.data.filter((c) => c.kind === "pair" && c.in_transaction_id).map((c) => ({
      outId: c.out_transaction_id, inId: c.in_transaction_id!, amount: Number(c.amount_cents), days: Number(c.days ?? 0), worded: c.worded,
      out: { date: c.out_date, description: c.out_description, account: name(c.out_account_id) },
      in: { date: c.in_date ?? c.out_date, description: c.in_description ?? "", account: name(c.in_account_id) },
    })),
    lone: cands.data.filter((c) => c.kind === "unpaired").map((c) => ({
      id: c.out_transaction_id, amount: Number(c.amount_cents), date: c.out_date, description: c.out_description, account: name(c.out_account_id),
    })),
    owner: {
      contribution: accounts.data.find((a) => a.subtype === "contribution")?.id ?? null,
      draw: accounts.data.find((a) => a.subtype === "draw")?.id ?? null,
    },
  };
}

export interface MatchInfo { matchId: string; otherAccount: string; otherDate: string }

/** For rows on screen that are matched transfers: the match and the other side's account. */
export async function getMatchesFor(businessId: string, transactionIds: string[]): Promise<Record<string, MatchInfo>> {
  if (!transactionIds.length) return {};
  const supabase = await getSupabase();
  const list = transactionIds.join(",");
  const { data: matches, error } = await supabase.from("transfer_matches")
    .select("id, out_transaction_id, in_transaction_id").eq("business_id", businessId).eq("status", "confirmed")
    .or(`out_transaction_id.in.(${list}),in_transaction_id.in.(${list})`);
  if (error) throw new Error(error.message);
  if (!matches.length) return {};
  const others = matches.flatMap((m) => [m.out_transaction_id, m.in_transaction_id!]);
  const [{ data: txns }, { data: accounts }] = await Promise.all([
    supabase.from("transactions").select("id, money_account_id, date").in("id", others),
    supabase.from("accounts").select("id, name, last4").eq("business_id", businessId).eq("is_money_account", true),
  ]);
  const tx = new Map((txns ?? []).map((t) => [t.id, t]));
  const acct = new Map((accounts ?? []).map((a) => [a.id, `${a.name}${a.last4 ? ` ··${a.last4}` : ""}`]));
  const out: Record<string, MatchInfo> = {};
  for (const m of matches) {
    for (const [self, other] of [[m.out_transaction_id, m.in_transaction_id!], [m.in_transaction_id!, m.out_transaction_id]] as const) {
      const o = tx.get(other);
      if (o) out[self] = { matchId: m.id, otherAccount: acct.get(o.money_account_id) ?? "another account", otherDate: o.date };
    }
  }
  return out;
}

/** How many pairs and one-sided transfers wait for the accountant (for banners). */
export async function getTransferCounts(businessId: string) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("transfer_match_candidates", { p_business_id: businessId, p_limit: 500 });
  if (error) throw new Error(error.message);
  return { pairs: data.filter((c) => c.kind === "pair").length, lone: data.filter((c) => c.kind === "unpaired").length };
}
