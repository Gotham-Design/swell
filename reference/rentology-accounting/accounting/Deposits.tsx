import { useState, type FormEvent } from "react";
import { memberName } from "@/lib/tenants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { check, must, supabase } from "@/lib/supabase";
import { fmtCents, fmtDate, toCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { ErrorNote } from "@/components/ui/misc";
import { StatusBadge } from "@/components/StatusBadge";

function useDeposits(propertyId: string) {
  return useQuery({
    queryKey: ["accounting", "deposits", propertyId],
    queryFn: async () => {
      let q = supabase.from("security_deposits")
        .select("*, units(name), properties(name), deposit_deductions(id, description, amount_cents), tenancy_members(invited_email, tenant_details(full_name)), tenancies(tenancy_members(invited_email, status, tenant_details(full_name)))")
        .order("received_on", { ascending: false });
      if (propertyId) q = q.eq("property_id", propertyId);
      return must(await q);
    },
  });
}
type Deposit = NonNullable<ReturnType<typeof useDeposits>["data"]>[number];

export function DepositsCard({ propertyId, tenancies }: {
  propertyId: string; tenancies: { id: string; label: string }[];
}) {
  const { data } = useDeposits(propertyId);
  const held = (data ?? []).filter((d) => d.status === "held");
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> Security deposits</CardTitle>
          <CardDescription>Held deposits are owed back to tenants, so they're a liability, not income. Deposit requests paid online appear here automatically.</CardDescription>
        </div>
        {tenancies.length > 0 && <RecordDepositDialog tenancies={tenancies} />}
      </CardHeader>
      <CardContent>
        {!data?.length ? <p className="text-sm text-muted-foreground">No deposits yet.</p> : (
          <ul className="divide-y">
            {data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{fmtCents(d.amount_cents)} · {d.properties?.name} · {d.units?.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.tenancy_members ? memberName(d.tenancy_members) : (d.tenancies?.tenancy_members.filter((m) => m.status !== "removed").map((m) => memberName(m)).join(", ") || "Tenancy")} · received {fmtDate(d.received_on)}
                    {!d.refundable && " · non-refundable"}
                  </div>
                  {d.status !== "held" && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Returned {fmtCents(d.returned_cents)}{d.returned_at && ` on ${fmtDate(d.returned_at)}`}
                      {d.deposit_deductions.length > 0 && <> · kept {d.deposit_deductions.map((x) => `${x.description} ${fmtCents(x.amount_cents)}`).join(", ")}</>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={d.status} label={d.status === "partially_released" ? "Partly returned" : d.status === "released" ? "Returned" : undefined} />
                  {d.status === "held" && <SettleDialog deposit={d} />}
                </div>
              </li>
            ))}
          </ul>
        )}
        {held.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Holding {fmtCents(held.reduce((s, d) => s + d.amount_cents, 0))} for tenants.</p>}
      </CardContent>
    </Card>
  );
}

function RecordDepositDialog({ tenancies }: { tenancies: { id: string; label: string }[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ tenancy: "", amount: "", date: new Date().toISOString().slice(0, 10) });
  const save = useMutation({
    mutationFn: async () => {
      const amount = toCents(form.amount);
      if (!amount || amount <= 0) throw new Error("Enter the deposit amount.");
      check(await supabase.from("security_deposits").insert({ tenancy_id: form.tenancy, amount_cents: amount, received_on: form.date }));
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["accounting"] });
      toast.success("Deposit recorded");
      setOpen(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setForm({ tenancy: "", amount: "", date: new Date().toISOString().slice(0, 10) }); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus /> Record deposit</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a deposit</DialogTitle>
          <DialogDescription>For deposits collected outside Quick Acct (check, cash). To collect one online, request a refundable "Deposit" payment instead.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
          {save.error && <ErrorNote>{save.error.message}</ErrorNote>}
          <Field label="Tenancy" htmlFor="dep-t">
            <NativeSelect id="dep-t" required value={form.tenancy} onChange={(e) => setForm({ ...form, tenancy: e.target.value })}>
              <option value="">Select</option>
              {tenancies.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount ($)" htmlFor="dep-amt"><Input id="dep-amt" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="Received" htmlFor="dep-date"><Input id="dep-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          </div>
          <DialogFooter><Button type="submit" disabled={save.isPending}>Record deposit</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Line { description: string; amount: string }

function SettleDialog({ deposit }: { deposit: Deposit }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [keepAll, setKeepAll] = useState(!deposit.refundable);
  const [notes, setNotes] = useState("");
  const kept = keepAll ? deposit.amount_cents : lines.reduce((s, l) => s + (toCents(l.amount) ?? 0), 0);
  const returned = deposit.amount_cents - kept;

  const settle = useMutation({
    mutationFn: async () => must(await supabase.rpc("dispose_deposit", {
      p_deposit_id: deposit.id,
      p_deductions: keepAll ? [] : lines.map((l) => ({ description: l.description.trim(), amount_cents: toCents(l.amount) ?? 0 })),
      p_forfeit: keepAll,
      p_notes: notes.trim() || undefined,
    })),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["accounting"] });
      toast.success(returned > 0 ? `Settled — return ${fmtCents(returned)} to the tenant` : "Settled");
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setLines([]); setKeepAll(!deposit.refundable); setNotes(""); } }}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Settle</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settle {fmtCents(deposit.amount_cents)} deposit</DialogTitle>
          <DialogDescription>
            List anything you're keeping and why. Many states require an itemized statement within a set number of days after move-out. This records the
            settlement; send the refund to the tenant yourself.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); settle.mutate(); }}>
          {settle.error && <ErrorNote>{settle.error.message}</ErrorNote>}
          {deposit.refundable && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={keepAll} onChange={(e) => setKeepAll(e.target.checked)} /> Keep the entire deposit
            </label>
          )}
          {!keepAll && (
            <div className="space-y-2">
              <Label>Deductions</Label>
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <Input placeholder="Carpet cleaning" aria-label={`Deduction ${i + 1} description`} required value={l.description}
                    onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                  <Input className="w-28" inputMode="decimal" placeholder="$" aria-label={`Deduction ${i + 1} amount`} required value={l.amount}
                    onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove deduction ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { description: "", amount: "" }])}><Plus /> Add deduction</Button>
            </div>
          )}
          <Field label="Notes (optional)" htmlFor="st-notes"><Textarea id="st-notes" rows={2} placeholder="Moved out June 30; keys returned" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="rounded-md border p-3 text-sm">
            <div className="flex justify-between"><span>Kept</span><span>{fmtCents(kept)}</span></div>
            <div className={`flex justify-between font-semibold ${returned < 0 ? "text-destructive" : ""}`}><span>Return to tenant</span><span>{fmtCents(returned)}</span></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="accent" disabled={settle.isPending || returned < 0}>Settle deposit</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

