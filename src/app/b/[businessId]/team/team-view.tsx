"use client";

import { useActionState, useState, useTransition } from "react";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ActionDialog } from "@/components/action-dialog";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/ui-kit/page-header";
import { Chip } from "@/components/ui-kit/status-chip";
import { accessSummary } from "@/lib/validation/team";
import type { FormState } from "@/lib/validation/business";
import { cn } from "@/lib/utils";
import { cancelTeamInvite, inviteToTeam, removeTeamMember, renameFirm, updateTeamMember } from "./actions";

type Role = "admin" | "staff";
type ClientRole = "owner" | "editor" | "viewer";
interface Member { user_id: string; email: string; role: Role; all_clients: boolean; client_role: ClientRole; business_ids: string[]; you: boolean }
interface Invite { id: string; email: string; role: Role; all_clients: boolean; client_role: ClientRole; business_ids: string[] }
interface Client { id: string; name: string }

/** Drawn, not native, so every browser shows the same full circle. */
const RADIO = "size-4 shrink-0 cursor-pointer appearance-none rounded-full border border-input bg-card transition-[border-width] checked:border-[5px] checked:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const AVATAR = ["bg-brand-soft text-brand", "bg-money-in-soft text-money-in-text", "bg-attention-soft text-attention-text", "bg-surface-muted text-foreground"];
const initials = (email: string) => email.split("@")[0].split(/[._-]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?";

/** The firm's people: who's on the team and which clients each can see. */
export function TeamView({ businessId, isAdmin, firmName, members, invites, clients }: {
  businessId: string; isAdmin: boolean; firmName: string; members: Member[]; invites: Invite[]; clients: Client[];
}) {
  const [editing, setEditing] = useState<Member | null>(null);
  const [pending, start] = useTransition();
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const run = (fn: () => Promise<FormState>) => start(async () => {
    const r = await fn();
    if (r.ok) toast.success(r.message); else toast.error(r.error ?? "That didn't work.");
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Team" subtitle={`Everyone at ${firmName} and which clients they can see.`}
        actions={isAdmin ? <InviteDialog businessId={businessId} clients={clients} /> : undefined} />

      <section aria-labelledby="people-title" className="surface p-5">
        <h2 id="people-title" className="text-[15px] font-semibold">People · {members.length}</h2>
        <ul className="mt-2 divide-y" data-testid="team-members">
          {members.map((m, i) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold", AVATAR[i % AVATAR.length])} aria-hidden>{initials(m.email)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.you ? `${m.email} (you)` : m.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {accessSummary(m)}
                  {!m.all_clients && m.role === "staff" && `: ${m.business_ids.map((id) => clientName.get(id)).filter(Boolean).join(", ")}`}
                </p>
              </div>
              <Chip tone={m.role === "admin" ? "categorized" : "neutral"}>{m.role === "admin" ? "Admin" : "Staff"}</Chip>
              {isAdmin && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${m.email}`} disabled={pending} />}>
                    <MoreHorizontal aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-40">
                    <DropdownMenuItem onClick={() => setEditing(m)}>Change access</DropdownMenuItem>
                    {!m.you && <DropdownMenuItem onClick={() => run(() => removeTeamMember(businessId, m.user_id))}>Remove from team</DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
          {isAdmin && invites.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3" data-testid="team-invite">
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-dashed text-xs text-muted-foreground" aria-hidden>{initials(inv.email)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{inv.email}</p>
                <p className="truncate text-xs text-muted-foreground">Invited · {accessSummary(inv)}</p>
              </div>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => cancelTeamInvite(businessId, inv.id))}>Cancel invite</Button>
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && <FirmName businessId={businessId} name={firmName} />}

      {editing && (
        <ActionDialog open onOpenChange={(o) => { if (!o) setEditing(null); }} title={`Access for ${editing.email}`} submitLabel="Save" wide
          action={updateTeamMember.bind(null, businessId, editing.user_id)}>
          {(state) => <AccessFields state={state} clients={clients} initial={editing} />}
        </ActionDialog>
      )}
    </div>
  );
}

function InviteDialog({ businessId, clients }: { businessId: string; clients: Client[] }) {
  return (
    <ActionDialog triggerLabel={<><UserPlus aria-hidden /> Invite to team</>} triggerVariant="default" triggerSize="default" wide
      title="Invite to the team" submitLabel="Send invite"
      description="They get a sign-in link by email. Signing in adds them to the team."
      action={inviteToTeam.bind(null, businessId)}>
      {(state) => (
        <div className="space-y-4">
          <div>
            <label htmlFor="team-email" className="mb-1.5 block text-sm font-medium">Email</label>
            <Input id="team-email" name="email" type="email" required placeholder="name@yourfirm.com" aria-invalid={!!state.fieldErrors?.email} />
            {state.fieldErrors?.email && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.email[0]}</p>}
          </div>
          <AccessFields state={state} clients={clients} />
        </div>
      )}
    </ActionDialog>
  );
}

/** Role, which clients, and edit or view only. */
function AccessFields({ state, clients, initial }: { state: FormState; clients: Client[]; initial?: Member }) {
  const [role, setRole] = useState<Role>(initial?.role ?? "staff");
  const [scope, setScope] = useState<"all" | "selected">(initial && !initial.all_clients ? "selected" : "all");
  const option = "flex cursor-pointer items-start gap-3 rounded-xl border p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft";
  return (
    <div className="space-y-4 px-0.5">
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Role</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={option}>
            <input type="radio" name="role" value="staff" checked={role === "staff"} onChange={() => setRole("staff")} className={cn(RADIO, "mt-0.5")} />
            <span><span className="block text-sm font-medium">Staff</span><span className="block text-xs text-muted-foreground">Works on the clients you give them</span></span>
          </label>
          <label className={option}>
            <input type="radio" name="role" value="admin" checked={role === "admin"} onChange={() => setRole("admin")} className={cn(RADIO, "mt-0.5")} />
            <span><span className="block text-sm font-medium">Admin</span><span className="block text-xs text-muted-foreground">Every client, and manages the team</span></span>
          </label>
        </div>
      </fieldset>
      {role === "staff" ? (
        <>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Clients</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="clients" value="all" checked={scope === "all"} onChange={() => setScope("all")} className={RADIO} /> Every client, including new ones</label>
              <label className="flex items-center gap-2"><input type="radio" name="clients" value="selected" checked={scope === "selected"} onChange={() => setScope("selected")} className={RADIO} /> Only these</label>
            </div>
            {scope === "selected" && (
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-xl border p-2" data-testid="team-clients">
                {clients.length ? clients.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-muted">
                    <input type="checkbox" name="business_ids" value={c.id} defaultChecked={initial?.business_ids.includes(c.id)} className="size-4 accent-[var(--color-brand)]" />
                    {c.name}
                  </label>
                )) : <p className="px-2 py-1.5 text-sm text-muted-foreground">No clients yet.</p>}
              </div>
            )}
            {state.fieldErrors?.business_ids && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.business_ids[0]}</p>}
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">They can</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="client_role" value="editor" defaultChecked={initial?.client_role !== "viewer"} className={RADIO} /> Edit the books</label>
              <label className="flex items-center gap-2"><input type="radio" name="client_role" value="viewer" defaultChecked={initial?.client_role === "viewer"} className={RADIO} /> View only</label>
            </div>
          </fieldset>
        </>
      ) : (
        <>
          <input type="hidden" name="clients" value="all" />
          <input type="hidden" name="client_role" value="editor" />
        </>
      )}
    </div>
  );
}

function FirmName({ businessId, name }: { businessId: string; name: string }) {
  const [state, action] = useActionState(renameFirm.bind(null, businessId), {} as FormState);
  return (
    <section aria-labelledby="firm-title" className="surface p-5">
      <h2 id="firm-title" className="text-[15px] font-semibold">Firm name</h2>
      <form action={action} className="mt-3 flex flex-wrap gap-2">
        <Input name="name" defaultValue={name} maxLength={120} required aria-label="Firm name" className="max-w-sm" />
        <SubmitButton variant="outline" pendingText="Saving…">Save</SubmitButton>
      </form>
      <FormAlert error={state.error ?? state.fieldErrors?.name?.[0]} success={state.ok ? state.message : undefined} />
    </section>
  );
}
