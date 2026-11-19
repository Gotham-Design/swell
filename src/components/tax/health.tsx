"use client";

import { useState, useTransition } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/form-field";
import { ActionDialog } from "@/components/action-dialog";
import { Money } from "@/components/ui-kit/money";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { centsToInput } from "@/lib/money";
import { TAX_ITEM_TYPES } from "@/lib/validation/tax";
import type { TaxItemRow } from "@/lib/dal-tax";
import { deleteTaxItem, saveTaxItem, skipForTax } from "@/app/b/[businessId]/tax/actions";
import { cn } from "@/lib/utils";

type Kind = "health" | "retirement";
const KIND_LABEL: Record<Kind, string> = { health: "Health", retirement: "Retirement" };
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
type Prefill = { kind: Kind; date: string; amount: number; description: string; transactionId: string };

export function TaxItemDialog({ businessId, item, prefill, kind, open, onOpenChange, triggerLabel, people }: {
  businessId: string; item?: TaxItemRow; prefill?: Prefill; kind?: Kind; open?: boolean; onOpenChange?: (o: boolean) => void;
  triggerLabel?: string; people: string[];
}) {
  const k: Kind = item?.kind ?? prefill?.kind ?? kind ?? "health";
  return (
    <ActionDialog triggerLabel={triggerLabel} triggerVariant="outline" triggerSize="default" open={open} onOpenChange={onOpenChange} wide
      title={item ? "Edit entry" : `Log ${k === "health" ? "a health cost" : "a retirement contribution"}`} submitLabel={item ? "Save" : "Log it"}
      description="For the return: who it's for and what type. It doesn't change the books."
      action={saveTaxItem.bind(null, businessId, item?.id ?? null)}>
      {(state) => {
        const e = state.fieldErrors;
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="kind" value={k} />
            <input type="hidden" name="transaction_id" value={item?.transactionId ?? prefill?.transactionId ?? ""} />
            <Field label="Type" htmlFor="ti-type" errors={e?.item_type}>
              <NativeSelect id="ti-type" name="item_type" defaultValue={item?.type ?? TAX_ITEM_TYPES[k][0]}>
                {TAX_ITEM_TYPES[k].map((t) => <option key={t} value={t}>{t}</option>)}
                {item && !(TAX_ITEM_TYPES[k] as readonly string[]).includes(item.type) && <option value={item.type}>{item.type}</option>}
              </NativeSelect>
            </Field>
            <Field label="For" htmlFor="ti-person" errors={e?.person} hint="Owner, a shareholder or an employee">
              <Input id="ti-person" name="person" maxLength={120} list="ti-people" defaultValue={item?.person ?? "Owner"} />
              <datalist id="ti-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description" htmlFor="ti-desc" errors={e?.description}>
                <Input id="ti-desc" name="description" required maxLength={200} defaultValue={item?.description ?? prefill?.description} placeholder="Blue Cross premium" />
              </Field>
            </div>
            <Field label="Date" htmlFor="ti-date" errors={e?.date}><Input id="ti-date" name="date" type="date" required defaultValue={item?.date ?? prefill?.date} /></Field>
            <Field label="Amount" htmlFor="ti-amt" errors={e?.amount}>
              <Input id="ti-amt" name="amount" inputMode="decimal" required placeholder="0.00"
                defaultValue={item ? centsToInput(item.amount) : prefill ? centsToInput(prefill.amount) : ""} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Note (optional)" htmlFor="ti-note" errors={e?.note}>
                <Textarea id="ti-note" name="note" rows={2} maxLength={1000} defaultValue={item?.note ?? ""} placeholder="Paid from personal account, reimbursed in March…" />
              </Field>
            </div>
          </div>
        );
      }}
    </ActionDialog>
  );
}

/** Payments worded like premiums or retirement contributions that aren't logged yet. */
export function TaxCandidates({ businessId, rows, people }: {
  businessId: string; rows: { kind: Kind; id: string; date: string; description: string; amount: number }[]; people: string[];
}) {
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [pending, start] = useTransition();
  if (!rows.length) return null;
  return (
    <section className="surface overflow-hidden" aria-labelledby="found-title" data-testid="tax-candidates">
      <div className="px-5 py-4">
        <h2 id="found-title" className="text-[15px] font-semibold">Found in the transactions · {rows.length}</h2>
        <p className="text-sm text-muted-foreground">These look like health or retirement payments. Log the ones that are, so they&apos;re ready for the return.</p>
      </div>
      <ul className="divide-y border-t">
        {rows.map((r) => (
          <li key={r.kind + r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">{KIND_LABEL[r.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.description}</p>
              <p className="text-xs text-muted-foreground">{day(r.date)}</p>
            </div>
            <Money cents={r.amount} className="text-sm font-semibold" />
            <span className="flex gap-1">
              <Button size="sm" onClick={() => setPrefill({ kind: r.kind, date: r.date, amount: r.amount, description: r.description, transactionId: r.id })}>Log it</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
                const x = await skipForTax(businessId, r.id, r.kind);
                if (x.ok) toast.success("Won't suggest it again"); else toast.error(x.error ?? "That didn't work.");
              })}>Not {r.kind === "health" ? "health" : "retirement"}</Button>
            </span>
          </li>
        ))}
      </ul>
      {prefill && <TaxItemDialog businessId={businessId} prefill={prefill} people={people} open onOpenChange={(o) => { if (!o) setPrefill(null); }} />}
    </section>
  );
}

export function TaxItemsTable({ businessId, kind, rows, canWrite, people }: {
  businessId: string; kind: Kind; rows: TaxItemRow[]; canWrite: boolean; people: string[];
}) {
  const [editing, setEditing] = useState<TaxItemRow | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="surface overflow-hidden" aria-labelledby={`${kind}-title`} data-testid={`${kind}-log`}>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <h2 id={`${kind}-title`} className="text-[15px] font-semibold">{KIND_LABEL[kind]} · {rows.length}</h2>
        {canWrite && <TaxItemDialog businessId={businessId} kind={kind} people={people} triggerLabel={kind === "health" ? "Log a health cost" : "Log a contribution"} />}
      </div>
      {rows.length === 0 ? (
        <p className="border-t px-5 py-6 text-center text-sm text-muted-foreground">
          {kind === "health" ? "Premiums, HSA contributions and medical costs for the owner or staff." : "SEP, SIMPLE, 401(k) and IRA contributions."} Nothing logged this year.
        </p>
      ) : (
        <ul className="divide-y border-t">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                <button type="button" className="flex min-w-0 flex-1 items-start gap-1.5 text-left" aria-expanded={openId === r.id} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                  <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", openId === r.id && "rotate-180")} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.description}</span>
                    <span className="block truncate text-xs text-muted-foreground">{day(r.date)} · {r.type}{r.person ? ` · ${r.person}` : ""}{r.transactionId ? " · from the books" : ""}</span>
                  </span>
                </button>
                <Money cents={r.amount} className="text-sm font-semibold tabular-nums" />
                {canWrite && (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${r.description}`} disabled={pending} />}>
                      <MoreHorizontal aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-32">
                      <DropdownMenuItem onClick={() => setEditing(r)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => start(async () => {
                        const x = await deleteTaxItem(businessId, r.id);
                        if (x.ok) toast.success(x.message); else toast.error(x.error ?? "Couldn't remove it");
                      })}>Remove</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {openId === r.id && (
                <div className="bg-surface-muted/50 px-5 py-4">
                  {r.note && <p className="mb-3 whitespace-pre-line text-sm">{r.note}</p>}
                  <DocumentsPanel businessId={businessId} link={{ taxItemId: r.id }} kind={kind} canWrite={canWrite} title="Statements and forms" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <TaxItemDialog businessId={businessId} item={editing} people={people} open onOpenChange={(o) => { if (!o) setEditing(null); }} />}
    </section>
  );
}
