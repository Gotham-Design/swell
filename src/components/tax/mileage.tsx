"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";
import { ActionDialog } from "@/components/action-dialog";
import { Money } from "@/components/ui-kit/money";
import { formatMiles, formatRate } from "@/lib/tax/miles";
import type { TripRow } from "@/lib/dal-tax";
import { addTrip, deleteTrips, importTrips } from "@/app/b/[businessId]/tax/actions";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function AddTripButton({ businessId, today, lastVehicle }: { businessId: string; today: string; lastVehicle: string | null }) {
  return (
    <ActionDialog triggerLabel="Log a trip" triggerVariant="default" triggerSize="default" title="Log a business trip" submitLabel="Log trip" wide
      description="Driving between work sites, to clients, the bank or suppliers counts. The commute from home doesn't."
      action={addTrip.bind(null, businessId)}>
      {(state) => {
        const e = state.fieldErrors;
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="tr-date" errors={e?.date}><Input id="tr-date" name="date" type="date" required defaultValue={today} /></Field>
            <Field label="Miles" htmlFor="tr-miles" errors={e?.miles}><Input id="tr-miles" name="miles" inputMode="decimal" required placeholder="12.4" /></Field>
            <div className="sm:col-span-2">
              <Field label="Purpose" htmlFor="tr-purpose" errors={e?.purpose}><Input id="tr-purpose" name="purpose" required maxLength={200} placeholder="Site visit at Harper job" /></Field>
            </div>
            <Field label="From (optional)" htmlFor="tr-from" errors={e?.start_place}><Input id="tr-from" name="start_place" maxLength={200} placeholder="Office" /></Field>
            <Field label="To (optional)" htmlFor="tr-to" errors={e?.end_place}><Input id="tr-to" name="end_place" maxLength={200} placeholder="Client" /></Field>
            <Field label="Vehicle (optional)" htmlFor="tr-veh" errors={e?.vehicle}><Input id="tr-veh" name="vehicle" maxLength={80} defaultValue={lastVehicle ?? ""} placeholder="F-150" /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="round_trip" className="size-4 accent-[var(--color-brand)]" /> Round trip (doubles the miles)
            </label>
          </div>
        );
      }}
    </ActionDialog>
  );
}

/** Upload a mileage log export (MileIQ, Everlance, TripLog or a sheet with Date and Miles). */
export function ImportTripsButton({ businessId }: { businessId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-hidden onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setBusy(true);
        const r = await importTrips(businessId, await file.text());
        setBusy(false);
        if (r.ok) toast.success(r.message); else toast.error(r.error ?? "Couldn't read that file");
      }} />
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />} {busy ? "Reading…" : "Import mileage log"}
      </Button>
    </>
  );
}

export function TripsTable({ businessId, rows, canWrite }: { businessId: string; rows: TripRow[]; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const [shown, setShown] = useState(100);
  if (!rows.length) {
    return (
      <section className="surface p-10 text-center">
        <h2 className="text-[15px] font-semibold">No trips this year</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Log trips as they happen, or import the export from a mileage app. The deduction uses the IRS rate for each trip&apos;s date.</p>
      </section>
    );
  }
  return (
    <section className="surface overflow-hidden" aria-labelledby="trips-title">
      <h2 id="trips-title" className="px-5 py-4 text-[15px] font-semibold">Trips · {rows.length}</h2>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm" data-testid="trips-table">
          <thead>
            <tr className="bg-surface-muted text-left text-xs text-muted-foreground [&_th]:h-10 [&_th]:font-medium">
              <th className="pl-5">Date</th><th className="px-3">Purpose</th><th className="px-3 text-right">Miles</th>
              <th className="px-3 text-right">Rate</th><th className="px-3 text-right">Deduction</th><th className="pr-5"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((t) => (
              <tr key={t.id} className="border-t [&_td]:py-2.5">
                <td className="pl-5 whitespace-nowrap">{day(t.date)}</td>
                <td className="max-w-80 px-3">
                  <p className="truncate">{t.purpose}</p>
                  {(t.from || t.to || t.vehicle) && <p className="truncate text-xs text-muted-foreground">{[t.from && t.to ? `${t.from} → ${t.to}` : t.from || t.to, t.vehicle].filter(Boolean).join(" · ")}</p>}
                </td>
                <td className="px-3 text-right tabular-nums">{formatMiles(t.miles)}</td>
                <td className="px-3 text-right text-muted-foreground tabular-nums">{t.rate ? formatRate(t.rate) : "—"}</td>
                <td className="px-3 text-right tabular-nums"><Money cents={t.deduction} /></td>
                <td className="pr-5 text-right">
                  {canWrite && (
                    <Button variant="ghost" size="icon-xs" aria-label={`Remove trip on ${day(t.date)}`} disabled={pending}
                      onClick={() => start(async () => {
                        const r = await deleteTrips(businessId, [t.id]);
                        if (r.ok) toast.success(r.message); else toast.error(r.error ?? "Couldn't remove it");
                      })}><Trash2 aria-hidden /></Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <div className="border-t p-3 text-center"><Button variant="ghost" size="sm" onClick={() => setShown((n) => n + 200)}>Show more</Button></div>
      )}
    </section>
  );
}
