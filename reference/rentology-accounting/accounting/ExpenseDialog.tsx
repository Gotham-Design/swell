import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { check, supabase, type Enums, type Tables } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { removeFiles, uploadLandlordFile } from "@/lib/storage";
import { centsToInput, toCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { ErrorNote } from "@/components/ui/misc";
import { EXPENSE_CATEGORIES } from "./labels";

type Property = { id: string; name: string; units: { id: string; name: string }[] };

export function ExpenseDialog({ properties, expense, trigger }: {
  properties: Property[]; expense?: Tables<"expenses">; trigger: ReactNode;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const blank = { property: "", unit: "", amount: "", category: "repairs", vendor: "", description: "", date: new Date().toISOString().slice(0, 10) };
  const [form, setForm] = useState(blank);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setForm(expense ? {
      property: expense.property_id ?? "", unit: expense.unit_id ?? "", amount: centsToInput(expense.amount_cents),
      category: expense.category, vendor: expense.vendor ?? "", description: expense.description, date: expense.incurred_on,
    } : blank);
  }, [open, expense]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async () => {
      const amount = toCents(form.amount);
      if (!amount || amount <= 0) throw new Error("Enter an amount.");
      let receipt_path = expense?.receipt_path ?? null;
      if (file) receipt_path = await uploadLandlordFile(user!.id, "receipts", file);
      const values = {
        property_id: form.property || null, unit_id: form.unit || null, amount_cents: amount,
        category: form.category as Enums<"expense_category">, vendor: form.vendor.trim() || null,
        description: form.description.trim(), incurred_on: form.date, receipt_path,
      };
      if (expense) check(await supabase.from("expenses").update(values).eq("id", expense.id));
      else check(await supabase.from("expenses").insert(values));
      if (file && expense?.receipt_path) await removeFiles("landlord-files", [expense.receipt_path]);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["accounting"] });
      toast.success(expense ? "Expense updated" : "Expense added");
      setOpen(false);
    },
  });

  const units = properties.find((p) => p.id === form.property)?.units ?? [];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{expense ? "Edit expense" : "Add an expense"}</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
          {save.error && <ErrorNote>{save.error.message}</ErrorNote>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount ($)" htmlFor="ex-amt"><Input id="ex-amt" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="Date" htmlFor="ex-date"><Input id="ex-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          </div>
          <Field label="Category (Schedule E)" htmlFor="ex-cat">
            <NativeSelect id="ex-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="What for" htmlFor="ex-desc"><Input id="ex-desc" required placeholder="Replaced kitchen faucet" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Vendor (optional)" htmlFor="ex-vendor"><Input id="ex-vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Property" htmlFor="ex-prop">
              <NativeSelect id="ex-prop" value={form.property} onChange={(e) => setForm({ ...form, property: e.target.value, unit: "" })}>
                <option value="">General (all properties)</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Unit" htmlFor="ex-unit">
              <NativeSelect id="ex-unit" value={form.unit} disabled={!units.length} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                <option value="">Whole property</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label={expense?.receipt_path ? "Replace receipt" : "Receipt (optional)"} htmlFor="ex-file" hint="PDF or photo, up to 20 MB">
            <Input id="ex-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
