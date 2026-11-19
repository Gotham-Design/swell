import { useMemo, useState } from "react";
import { memberName } from "@/lib/tenants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Lock, Pencil, Plus, Trash2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { toast } from "sonner";
import { check, must, supabase } from "@/lib/supabase";
import { removeFiles, signedLandlordFileUrl } from "@/lib/storage";
import { fmtCents, fmtDate } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { PageHeader, PageLoader } from "@/components/ui/misc";
import { ExpenseDialog } from "@/components/accounting/ExpenseDialog";
import { DepositsCard } from "@/components/accounting/Deposits";
import { expenseLabel, KIND_LABEL } from "@/components/accounting/labels";

interface Pnl {
  rent_income: number; other_income: number; deposits_kept: number; income: number;
  expenses: number; net: number; expenses_by_category: Record<string, number>;
  deposits_held: number; refundable_held: number;
}

const thisYear = new Date().getFullYear();
const YEARS = [thisYear, thisYear - 1, thisYear - 2];

function csvCell(v: string | number | null) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Accounting() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<string>(String(thisYear));
  const [custom, setCustom] = useState({ from: `${thisYear}-01-01`, to: new Date().toISOString().slice(0, 10) });
  const [propertyId, setPropertyId] = useState("");
  const range = period === "custom" ? custom : { from: `${period}-01-01`, to: `${period}-12-31` };

  const meta = useQuery({
    queryKey: ["accounting", "meta"],
    queryFn: async () => {
      const [props, tenancies] = await Promise.all([
        supabase.from("properties").select("id, name, units(id, name)").order("name"),
        supabase.from("tenancies").select("id, status, units(name), properties(name), tenancy_members(invited_email, status, tenant_details(full_name))").order("created_at", { ascending: false }),
      ]);
      return { properties: must(props), tenancies: must(tenancies) };
    },
  });
  const pnl = useQuery({
    queryKey: ["accounting", "pnl", range.from, range.to, propertyId],
    queryFn: async () => must(await supabase.rpc("landlord_pnl", { p_from: range.from, p_to: range.to, p_property_id: propertyId || undefined })) as unknown as Pnl,
  });
  const expenses = useQuery({
    queryKey: ["accounting", "expenses", range.from, range.to, propertyId],
    queryFn: async () => {
      let q = supabase.from("expenses").select("*, properties(name), units(name)")
        .gte("incurred_on", range.from).lte("incurred_on", range.to).order("incurred_on", { ascending: false });
      if (propertyId) q = q.eq("property_id", propertyId);
      return must(await q);
    },
  });
  const remove = useMutation({
    mutationFn: async (e: { id: string; receipt_path: string | null }) => {
      check(await supabase.from("expenses").delete().eq("id", e.id));
      if (e.receipt_path) await removeFiles("landlord-files", [e.receipt_path]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounting"] }),
    onError: (e) => toast.error(e.message),
  });

  const exportCsv = async () => {
    try {
      const rows = must(await supabase.rpc("landlord_ledger", { p_from: range.from, p_to: range.to, p_property_id: propertyId || undefined }));
      const header = ["Date", "Type", "Category", "Property", "Unit", "Description", "Amount"];
      const lines = rows.map((r) => [
        r.entry_date, KIND_LABEL[r.kind] ?? r.kind, r.kind === "expense" ? expenseLabel(r.category) : r.category,
        r.property_name ?? "General", r.unit_name ?? "", r.description, (r.amount_cents / 100).toFixed(2),
      ].map(csvCell).join(","));
      const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(blob),
        download: `quick-acct-ledger-${range.from}-to-${range.to}${propertyId ? "-" + (props.find((p) => p.id === propertyId)?.name ?? "property").toLowerCase().replace(/\W+/g, "-") : ""}.csv`,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const props = meta.data?.properties ?? [];
  const tenancyOptions = useMemo(() => (meta.data?.tenancies ?? [])
    .filter((t) => !propertyId || props.find((p) => p.id === propertyId)?.name === t.properties?.name)
    .map((t) => ({
      id: t.id,
      label: `${t.properties?.name} · ${t.units?.name} · ${t.tenancy_members.filter((m) => m.status !== "removed").map((m) => memberName(m)).join(", ") || "no tenants"}${t.status === "ended" ? " (ended)" : ""}`,
    })), [meta.data, propertyId, props]);

  if (meta.isPending) return <PageLoader />;
  const p = pnl.data;

  return (
    <>
      <PageHeader
        title="Accounting"
        description="Settled income and expenses by date. Deposits you hold are shown separately because they belong to tenants."
        actions={<>
          <Button variant="outline" onClick={exportCsv}><Download /> Export CSV</Button>
          <ExpenseDialog properties={props} trigger={<Button><Plus /> Add expense</Button>} />
        </>}
      />

      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-4">
          <Field label="Period" htmlFor="ac-period">
            <NativeSelect id="ac-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {YEARS.map((y) => <option key={y} value={y}>{y}{y === thisYear ? " (year to date)" : ""}</option>)}
              <option value="custom">Custom range</option>
            </NativeSelect>
          </Field>
          {period === "custom" && (
            <>
              <Field label="From" htmlFor="ac-from"><Input id="ac-from" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field>
              <Field label="To" htmlFor="ac-to"><Input id="ac-to" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field>
            </>
          )}
          <Field label="Property" htmlFor="ac-prop">
            <NativeSelect id="ac-prop" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">All properties</option>
              {props.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={TrendingUp} label="Income" value={p?.income} tone="text-success" />
        <Stat icon={TrendingDown} label="Expenses" value={p?.expenses} tone="text-destructive" />
        <Stat icon={Wallet} label="Net" value={p?.net} tone={(p?.net ?? 0) >= 0 ? "text-success" : "text-destructive"} />
        <Stat icon={Lock} label="Held for tenants" value={p ? p.deposits_held + p.refundable_held : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Income</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Rent" value={p?.rent_income} />
            <Row label="Fees and other payments" value={p?.other_income} />
            <Row label="Kept from deposits" value={p?.deposits_kept} />
            <p className="pt-2 text-xs text-muted-foreground">Only payments that have cleared, minus refunds. Tenant processing fees aren't your income and aren't counted.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Expenses by category</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {!p || !Object.keys(p.expenses_by_category).length ? <p className="text-muted-foreground">No expenses in this period.</p>
              : Object.entries(p.expenses_by_category).sort((a, b) => b[1] - a[1]).map(([cat, total]) => <Row key={cat} label={expenseLabel(cat)} value={total} />)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Expenses</CardTitle></CardHeader>
        <CardContent>
          {!expenses.data?.length ? <p className="text-sm text-muted-foreground">No expenses in this period.</p> : (
            <ul className="divide-y">
              {expenses.data.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{e.description}{e.vendor && <span className="font-normal text-muted-foreground"> · {e.vendor}</span>}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(e.incurred_on)} · {expenseLabel(e.category)} · {e.properties?.name ?? "General"}{e.units?.name ? ` · ${e.units.name}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="mr-2 font-medium">{fmtCents(e.amount_cents)}</span>
                    {e.receipt_path && (
                      <Button variant="ghost" size="icon" aria-label="Open receipt"
                        onClick={async () => window.open(await signedLandlordFileUrl(e.receipt_path!), "_blank", "noopener")}><FileText /></Button>
                    )}
                    <ExpenseDialog properties={props} expense={e} trigger={<Button variant="ghost" size="icon" aria-label={`Edit ${e.description}`}><Pencil /></Button>} />
                    <Button variant="ghost" size="icon" aria-label={`Delete ${e.description}`} onClick={() => confirm(`Delete "${e.description}"?`) && remove.mutate(e)}><Trash2 /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DepositsCard propertyId={propertyId} tenancies={tenancyOptions} />
    </>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Wallet; label: string; value: number | undefined; tone?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" /> {label}</div>
        <div className={`mt-1 text-2xl font-semibold ${tone ?? ""}`}>{value === undefined ? "—" : fmtCents(value)}</div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: number | undefined }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="font-medium">{fmtCents(value ?? 0)}</span></div>;
}
