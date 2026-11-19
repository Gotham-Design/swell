"use client";

import { useState, useTransition } from "react";
import { ChevronDown, MoreHorizontal, Undo2 } from "lucide-react";
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
import { ASSET_KINDS, ASSET_KIND_LABEL, ASSET_METHODS, ASSET_METHOD_LABEL, DEFAULT_LIFE_MONTHS, lifeLabel, type AssetKind, type AssetMethod } from "@/lib/tax/assets";
import type { AssetRow } from "@/lib/dal-tax";
import type { FormState } from "@/lib/validation/business";
import { deleteAsset, postDepreciation, saveAsset, skipForTax, undoDepreciation } from "@/app/b/[businessId]/tax/actions";
import { cn } from "@/lib/utils";

const day = (iso: string, year = true) => new Date(`${iso}T00:00:00Z`)
  .toLocaleDateString("en-US", year ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
const monthYear = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

type Prefill = { name?: string; cost?: number; acquiredOn?: string; purchaseId?: string };

/** Add or edit an asset. From a large purchase, it arrives prefilled and linked. */
export function AssetDialog({ businessId, asset, prefill, open, onOpenChange, triggerLabel }: {
  businessId: string; asset?: AssetRow; prefill?: Prefill; open?: boolean; onOpenChange?: (o: boolean) => void; triggerLabel?: string;
}) {
  return (
    <ActionDialog triggerLabel={triggerLabel} triggerVariant="default" triggerSize="default" open={open} onOpenChange={onOpenChange} wide
      title={asset ? `Edit ${asset.name}` : prefill?.purchaseId ? "Make it an asset" : "Add an asset"} submitLabel={asset ? "Save" : "Add asset"}
      description={asset ? "Changes are trued up the next time you post depreciation."
        : prefill?.purchaseId ? "Its purchase moves from expenses to the balance sheet, and it's depreciated from here."
          : "Equipment, a vehicle or a building the business keeps for more than a year."}
      action={saveAsset.bind(null, businessId, asset?.id ?? null)}>
      {(state) => <AssetFields state={state} asset={asset} prefill={prefill} />}
    </ActionDialog>
  );
}

function AssetFields({ state, asset, prefill }: { state: FormState; asset?: AssetRow; prefill?: Prefill }) {
  const e = state.fieldErrors;
  const [kind, setKind] = useState<AssetKind>((asset?.kind as AssetKind) ?? "equipment");
  const [method, setMethod] = useState<AssetMethod>((asset?.method as AssetMethod) ?? "straight_line");
  const [life, setLife] = useState(() => {
    const m = asset?.lifeMonths ?? DEFAULT_LIFE_MONTHS.equipment;
    return m ? String(m % 12 ? (m / 12).toFixed(1) : m / 12) : "";
  });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="purchase_transaction_id" value={prefill?.purchaseId ?? ""} />
      <div className="sm:col-span-2">
        <Field label="Name" htmlFor="as-name" errors={e?.name}>
          <Input id="as-name" name="name" required maxLength={120} defaultValue={asset?.name ?? prefill?.name} placeholder="2024 Ford F-150" />
        </Field>
      </div>
      <Field label="What it is" htmlFor="as-kind" errors={e?.kind}>
        <NativeSelect id="as-kind" name="kind" value={kind} onChange={(ev) => {
          const k = ev.target.value as AssetKind;
          setKind(k);
          if (k === "land") setMethod("none");
          else if (!asset && DEFAULT_LIFE_MONTHS[k]) setLife(String((DEFAULT_LIFE_MONTHS[k] as number) / 12));
        }}>
          {ASSET_KINDS.map((k) => <option key={k} value={k}>{ASSET_KIND_LABEL[k]}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Cost" htmlFor="as-cost" errors={e?.cost}>
        <Input id="as-cost" name="cost" inputMode="decimal" required placeholder="0.00"
          defaultValue={asset ? centsToInput(asset.cost) : prefill?.cost ? centsToInput(prefill.cost) : ""} />
      </Field>
      <Field label="Bought on" htmlFor="as-acq" errors={e?.acquired_on}>
        <Input id="as-acq" name="acquired_on" type="date" required defaultValue={asset?.acquiredOn ?? prefill?.acquiredOn} />
      </Field>
      <Field label="Put to use on" htmlFor="as-svc" errors={e?.in_service_on} hint="Leave blank if the same day">
        <Input id="as-svc" name="in_service_on" type="date" defaultValue={asset && asset.inServiceOn !== asset.acquiredOn ? asset.inServiceOn : ""} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Depreciation" htmlFor="as-method" errors={e?.method}>
          <NativeSelect id="as-method" name="method" value={method} onChange={(ev) => setMethod(ev.target.value as AssetMethod)} disabled={kind === "land"}>
            {ASSET_METHODS.map((m) => <option key={m} value={m}>{ASSET_METHOD_LABEL[m]}</option>)}
          </NativeSelect>
          {kind === "land" && <input type="hidden" name="method" value="none" />}
        </Field>
      </div>
      {method === "straight_line" && (
        <>
          <Field label="Useful life (years)" htmlFor="as-life" errors={e?.life_years}>
            <Input id="as-life" name="life_years" inputMode="decimal" value={life} onChange={(ev) => setLife(ev.target.value)} placeholder="5" />
          </Field>
          <Field label="Salvage value (optional)" htmlFor="as-salv" errors={e?.salvage} hint="What it's worth at the end">
            <Input id="as-salv" name="salvage" inputMode="decimal" placeholder="0.00" defaultValue={asset?.salvage ? centsToInput(asset.salvage) : ""} />
          </Field>
        </>
      )}
      {method !== "straight_line" && <input type="hidden" name="salvage" value="" />}
      {method !== "straight_line" && <input type="hidden" name="life_years" value="" />}
      {asset ? (
        <Field label="Sold or retired on (optional)" htmlFor="as-disp" errors={e?.disposed_on} hint="Depreciation stops after that month">
          <Input id="as-disp" name="disposed_on" type="date" defaultValue={asset.disposedOn ?? ""} />
        </Field>
      ) : <input type="hidden" name="disposed_on" value="" />}
      <div className="sm:col-span-2">
        <Field label="Notes (optional)" htmlFor="as-notes" errors={e?.notes}>
          <Textarea id="as-notes" name="notes" rows={2} maxLength={2000} defaultValue={asset?.notes ?? ""} placeholder="VIN, serial number, where it's kept…" />
        </Field>
      </div>
    </div>
  );
}

/** Post (or take back) depreciation for a month end. */
export function PostDepreciation({ businessId, monthEnds, defaultThrough, lastPosted, canWrite, hasAssets }: {
  businessId: string; monthEnds: string[]; defaultThrough: string; lastPosted: string | null; canWrite: boolean; hasAssets: boolean;
}) {
  const [through, setThrough] = useState(defaultThrough);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>) => start(async () => {
    const r = await fn();
    if (r.ok) toast.success(r.message); else toast.error(r.error ?? "That didn't work.");
  });
  return (
    <section className="surface flex flex-wrap items-center gap-x-6 gap-y-3 p-5" aria-labelledby="dep-title" data-testid="post-depreciation">
      <div className="min-w-0 flex-1">
        <h2 id="dep-title" className="text-[15px] font-semibold">Depreciation</h2>
        <p className="text-sm text-muted-foreground">
          {lastPosted ? <>Posted through {monthYear(lastPosted)}. </> : <>Nothing posted yet. </>}
          Each posting brings every asset up to its schedule, so run it monthly or once at year end.
        </p>
      </div>
      {canWrite && hasAssets && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="dep-through" className="text-sm text-muted-foreground">Through</label>
          <NativeSelect id="dep-through" value={through} onChange={(e) => setThrough(e.target.value)} className="h-9 w-44">
            {monthEnds.map((m) => <option key={m} value={m}>{monthYear(m)}</option>)}
          </NativeSelect>
          <Button disabled={pending} onClick={() => run(() => postDepreciation(businessId, through))} data-testid="post-depreciation-button">
            {pending ? "Posting…" : "Post depreciation"}
          </Button>
          {lastPosted && (
            <Button variant="ghost" disabled={pending} onClick={() => run(() => undoDepreciation(businessId))} aria-label="Undo the last posting">
              <Undo2 aria-hidden /> Undo last
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** Big payments that may be equipment or a vehicle: make each an asset, or wave it off. */
export function LargePurchases({ businessId, rows, names }: {
  businessId: string; rows: { id: string; date: string; description: string; amount: number; categoryId: string | null }[];
  names: Record<string, string>;
}) {
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [pending, start] = useTransition();
  if (!rows.length) return null;
  return (
    <section className="surface overflow-hidden" aria-labelledby="large-title" data-testid="large-purchases">
      <div className="px-5 py-4">
        <h2 id="large-title" className="text-[15px] font-semibold">Large purchases to look at · {rows.length}</h2>
        <p className="text-sm text-muted-foreground">Payments of $2,500 or more. Equipment or a vehicle usually belongs on the balance sheet and is depreciated, not expensed.</p>
      </div>
      <ul className="divide-y border-t">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.description}</p>
              <p className="text-xs text-muted-foreground">{day(r.date)} · {r.categoryId ? names[r.categoryId] ?? "Categorized" : "Uncategorized"}</p>
            </div>
            <Money cents={-r.amount} tone="signed" className="text-sm font-semibold" />
            <span className="flex gap-1">
              <Button size="sm" onClick={() => setPrefill({ name: r.description, cost: r.amount, acquiredOn: r.date, purchaseId: r.id })}>Make it an asset</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
                const x = await skipForTax(businessId, r.id, "asset");
                if (x.ok) toast.success("Left as is"); else toast.error(x.error ?? "That didn't work.");
              })}>Not an asset</Button>
            </span>
          </li>
        ))}
      </ul>
      {prefill && <AssetDialog businessId={businessId} prefill={prefill} open onOpenChange={(o) => { if (!o) setPrefill(null); }} />}
    </section>
  );
}

/** The asset register: cost, what's been depreciated, what's left. */
export function AssetsTable({ businessId, rows, canWrite }: { businessId: string; rows: AssetRow[]; canWrite: boolean }) {
  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!rows.length) {
    return (
      <section className="surface p-10 text-center" data-testid="assets-empty">
        <h2 className="text-[15px] font-semibold">No assets yet</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Add equipment, vehicles or property the business keeps for more than a year. Attach the bill of sale, and depreciation posts to the books for you.
        </p>
      </section>
    );
  }
  return (
    <section className="surface overflow-hidden" aria-labelledby="assets-title">
      <h2 id="assets-title" className="px-5 py-4 text-[15px] font-semibold">Assets · {rows.length}</h2>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm" data-testid="assets-table">
          <thead>
            <tr className="bg-surface-muted text-left text-xs text-muted-foreground [&_th]:h-10 [&_th]:font-medium">
              <th className="pl-5">Asset</th>
              <th className="px-3">In service</th>
              <th className="px-3">Method</th>
              <th className="px-3 text-right">Cost</th>
              <th className="px-3 text-right">Depreciated</th>
              <th className="px-3 text-right">Book value</th>
              <th className="pr-5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const behind = a.scheduled - a.posted;
              return [
                <tr key={a.id} className="border-t align-top [&_td]:py-3">
                  <td className="pl-5">
                    <button type="button" className="flex items-start gap-1.5 text-left font-medium hover:underline" aria-expanded={openId === a.id}
                      onClick={() => setOpenId(openId === a.id ? null : a.id)}>
                      <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", openId === a.id && "rotate-180")} aria-hidden />
                      {a.name}
                    </button>
                    <p className="pl-5.5 text-xs text-muted-foreground">
                      {ASSET_KIND_LABEL[a.kind as AssetKind] ?? a.kind} · {a.account}{a.disposedOn ? ` · sold ${day(a.disposedOn)}` : ""}
                    </p>
                  </td>
                  <td className="px-3 whitespace-nowrap">{day(a.inServiceOn)}</td>
                  <td className="px-3 text-muted-foreground">
                    {a.method === "straight_line" ? <>{lifeLabel(a.lifeMonths)} · <Money cents={a.monthly} />/mo</> : a.method === "expense_now" ? "Expensed" : "Not depreciated"}
                  </td>
                  <td className="px-3 text-right tabular-nums"><Money cents={a.cost} /></td>
                  <td className="px-3 text-right tabular-nums">
                    <Money cents={a.posted} />
                    {behind !== 0 && <p className="text-xs text-attention-text"><Money cents={behind} /> to post</p>}
                  </td>
                  <td className="px-3 text-right font-medium tabular-nums"><Money cents={a.bookValue} /></td>
                  <td className="pr-5 text-right">
                    {canWrite && (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${a.name}`} disabled={pending} />}>
                          <MoreHorizontal aria-hidden />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-36">
                          <DropdownMenuItem onClick={() => setEditing(a)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setOpenId(a.id)}>Documents</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => start(async () => {
                            const r = await deleteAsset(businessId, a.id);
                            if (r.ok) toast.success(r.message); else toast.error(r.error ?? "Couldn't remove it");
                          })}>Remove</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>,
                openId === a.id && (
                  <tr key={`${a.id}-docs`} className="bg-surface-muted/50">
                    <td colSpan={7} className="px-5 py-4">
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <DocumentsPanel businessId={businessId} link={{ assetId: a.id }} kind="bill_of_sale" canWrite={canWrite} title="Bill of sale and paperwork" />
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <dt className="text-muted-foreground">Bought</dt><dd>{day(a.acquiredOn)}</dd>
                          <dt className="text-muted-foreground">Salvage value</dt><dd><Money cents={a.salvage} /></dd>
                          <dt className="text-muted-foreground">Posted through</dt><dd>{a.lastThrough ? monthYear(a.lastThrough) : "—"}</dd>
                          {a.notes && <><dt className="text-muted-foreground">Notes</dt><dd className="whitespace-pre-line">{a.notes}</dd></>}
                        </dl>
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
      {editing && <AssetDialog businessId={businessId} asset={editing} open onOpenChange={(o) => { if (!o) setEditing(null); }} />}
    </section>
  );
}
