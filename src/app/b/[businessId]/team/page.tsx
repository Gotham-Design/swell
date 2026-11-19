import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getBusiness, getSupabase, getUser } from "@/lib/dal";
import { TeamView } from "./team-view";

export default function TeamPage({ params }: PageProps<"/b/[businessId]/team">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-surface-muted" />}>
      <Team params={params} />
    </Suspense>
  );
}

async function Team({ params }: Pick<PageProps<"/b/[businessId]/team">, "params">) {
  const { businessId } = await params;
  const [{ business }, user] = await Promise.all([getBusiness(businessId), getUser()]);
  if (!business.firm_id) notFound();
  const supabase = await getSupabase();
  const [{ data: firm }, { data: me }, { data: members }, { data: invites }, { data: clients }] = await Promise.all([
    supabase.from("firms").select("id, name").eq("id", business.firm_id).maybeSingle(),
    supabase.from("firm_members").select("role").eq("firm_id", business.firm_id).eq("user_id", user.id).maybeSingle(),
    supabase.rpc("firm_member_list", { p_firm_id: business.firm_id }),
    supabase.from("firm_invites").select("id, email, role, all_clients, client_role, business_ids, created_at")
      .eq("firm_id", business.firm_id).is("accepted_at", null).gt("expires_at", new Date().toISOString()).order("created_at"),
    supabase.from("businesses").select("id, name").eq("firm_id", business.firm_id).is("archived_at", null).order("name"),
  ]);
  // Only people on the firm's team see it.
  if (!firm || !me) notFound();
  return (
    <TeamView businessId={business.id} isAdmin={me.role === "admin"} firmName={firm.name}
      clients={clients ?? []}
      members={(members ?? []).map((m) => ({ ...m, you: m.user_id === user.id })).sort((a, b) => Number(b.you) - Number(a.you))}
      invites={invites ?? []} />
  );
}
