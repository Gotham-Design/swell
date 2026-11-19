import { Suspense } from "react";
import { PageHeader } from "@/components/ui-kit/page-header";
import { SegmentedNav } from "@/components/ui-kit/segmented-nav";
import { Money } from "@/components/ui-kit/money";
import { getBusiness, getPickerOptions, todayIso } from "@/lib/dal";
import {
  getAllDocuments, getAssets, getLargePurchases, getMileageRates, getTaxCandidates, getTaxItems, getTransactionLabels, getTrips, lastPosted,
} from "@/lib/dal-tax";
import { lastClosedMonthEnd, monthEnd } from "@/lib/tax/assets";
import { formatMiles, formatRate } from "@/lib/tax/miles";
import { formatCents, sumCents } from "@/lib/money";
import { AssetDialog, AssetsTable, LargePurchases, PostDepreciation } from "@/components/tax/assets";
import { AddTripButton, ImportTripsButton, TripsTable } from "@/components/tax/mileage";
import { TaxCandidates, TaxItemsTable } from "@/components/tax/health";
import { DocumentsTab } from "@/components/tax/documents-tab";
import { AttachButton } from "@/components/documents/documents-panel";

const TABS = [
  { key: "assets", label: "Assets" },
  { key: "mileage", label: "Mileage" },
  { key: "health", label: "Health & retirement" },
  { key: "documents", label: "Documents" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function TaxPage({ params, searchParams }: PageProps<"/b/[businessId]/tax">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-surface-muted" />}>
      <Tax params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Tax({ params, searchParams }: PageProps<"/b/[businessId]/tax">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "assets";
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));
  const year = typeof sp.year === "string" && /^\d{4}$/.test(sp.year) && +sp.year >= thisYear - 6 && +sp.year <= thisYear ? +sp.year : thisYear;
  const { business, canWrite } = await getBusiness(businessId);
  const base = `/b/${business.id}/tax`;
  const href = (t: Tab, y = year) => `${base}?tab=${t}${y !== thisYear && t !== "assets" && t !== "documents" ? `&year=${y}` : ""}`;

  const years = (
    <SegmentedNav label="Year" items={[thisYear, thisYear - 1, thisYear - 2].map((y) => ({ href: href(tab, y), label: String(y), active: y === year }))} />
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Tax" subtitle="Assets and depreciation, mileage, health and retirement, and the paperwork behind them." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-4 max-w-[calc(100%+2rem)] overflow-x-auto px-4 md:mx-0 md:max-w-full md:px-0 [&_a]:whitespace-nowrap">
          <SegmentedNav label="Tax sections" items={TABS.map((t) => ({ href: href(t.key), label: t.label, active: t.key === tab, testId: `tax-tab-${t.key}` }))} />
        </div>
        {(tab === "mileage" || tab === "health") && years}
      </div>
      {tab === "assets" && <AssetsSection businessId={business.id} canWrite={canWrite} today={today} />}
      {tab === "mileage" && <MileageSection businessId={business.id} canWrite={canWrite} year={year} today={today} />}
      {tab === "health" && <HealthSection businessId={business.id} canWrite={canWrite} year={year} />}
      {tab === "documents" && <DocumentsSection businessId={business.id} canWrite={canWrite} />}
    </div>
  );
}

function Stats({ items }: { items: { label: string; value: React.ReactNode; foot?: React.ReactNode }[] }) {
  return (
    <dl className="surface grid gap-4 p-5 sm:grid-cols-3">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-sm text-muted-foreground">{i.label}</dt>
          <dd className="truncate text-2xl font-semibold tracking-tight tabular-nums">{i.value}</dd>
          {i.foot && <dd className="text-xs text-muted-foreground">{i.foot}</dd>}
        </div>
      ))}
    </dl>
  );
}

async function AssetsSection({ businessId, canWrite, today }: { businessId: string; canWrite: boolean; today: string }) {
  const [assets, large, options] = await Promise.all([
    getAssets(businessId, monthEnd(today)), canWrite ? getLargePurchases(businessId) : Promise.resolve([]), getPickerOptions(businessId),
  ]);
  const inUse = assets.filter((a) => !a.disposedOn);
  const posted = lastPosted(assets);
  const defaultThrough = lastClosedMonthEnd(today);
  const monthEnds = Array.from({ length: 24 }, (_, i) => {
    const [y, m] = defaultThrough.split("-").map(Number);
    return new Date(Date.UTC(y, m - i, 0)).toISOString().slice(0, 10);
  });
  const names = Object.fromEntries(options.map((o) => [o.id, o.name]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Book depreciation. Tax depreciation (MACRS) stays in the tax software.</p>
        {canWrite && <AssetDialog businessId={businessId} triggerLabel="Add asset" />}
      </div>
      {assets.length > 0 && (
        <Stats items={[
          { label: "Cost of assets in use", value: <Money cents={sumCents(inUse.map((a) => a.cost))} />, foot: `${inUse.length} asset${inUse.length === 1 ? "" : "s"}` },
          { label: "Depreciation posted", value: <Money cents={sumCents(assets.map((a) => a.posted))} /> },
          { label: "Book value", value: <Money cents={sumCents(inUse.map((a) => a.bookValue))} /> },
        ]} />
      )}
      <PostDepreciation businessId={businessId} monthEnds={monthEnds} defaultThrough={defaultThrough} lastPosted={posted} canWrite={canWrite}
        hasAssets={assets.some((a) => a.method !== "none")} />
      {canWrite && <LargePurchases businessId={businessId} rows={large} names={names} />}
      <AssetsTable businessId={businessId} rows={assets} canWrite={canWrite} />
    </div>
  );
}

async function MileageSection({ businessId, canWrite, year, today }: { businessId: string; canWrite: boolean; year: number; today: string }) {
  const [trips, rates] = await Promise.all([getTrips(businessId, `${year}-01-01`, `${year}-12-31`), getMileageRates()]);
  const miles = trips.reduce((s, t) => s + t.miles, 0);
  const yearRates = rates.filter((r) => r.from <= `${year}-12-31`);
  const inForce = yearRates.filter((r) => r.from >= `${year}-01-01`);
  const rateNote = (inForce.length ? inForce : yearRates.slice(0, 1)).slice().reverse()
    .map((r) => `${formatRate(r.rate)}${r.from > `${year}-01-01` ? ` from ${new Date(`${r.from}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : ""}`).join(", ");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">IRS business rate for {year}: {rateNote ? rateNote.replace(/¢/, "¢ a mile") : "not set"}.</p>
        {canWrite && (
          <span className="flex flex-wrap gap-2">
            <AttachButton businessId={businessId} kind="mileage_log" label="Attach log file" size="default" />
            <ImportTripsButton businessId={businessId} />
            <AddTripButton businessId={businessId} today={today} lastVehicle={trips.find((t) => t.vehicle)?.vehicle ?? null} />
          </span>
        )}
      </div>
      <Stats items={[
        { label: `Business miles in ${year}`, value: formatMiles(miles) },
        { label: "Standard mileage deduction", value: <Money cents={sumCents(trips.map((t) => t.deduction))} />, foot: "Miles × the IRS rate on each trip's date" },
        { label: "Trips", value: trips.length.toLocaleString("en-US") },
      ]} />
      <TripsTable businessId={businessId} rows={trips} canWrite={canWrite} />
    </div>
  );
}

async function HealthSection({ businessId, canWrite, year }: { businessId: string; canWrite: boolean; year: number }) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [items, candidates] = await Promise.all([
    getTaxItems(businessId, from, to), canWrite ? getTaxCandidates(businessId, from, to) : Promise.resolve([]),
  ]);
  const people = [...new Set(["Owner", ...items.map((i) => i.person).filter((p): p is string => !!p)])];
  const health = items.filter((i) => i.kind === "health");
  const retirement = items.filter((i) => i.kind === "retirement");
  const byPerson = (rows: typeof items) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.person ?? "Unassigned", (m.get(r.person ?? "Unassigned") ?? 0) + r.amount);
    return [...m.entries()].map(([p, c]) => `${p} ${formatCents(c)}`).join(" · ");
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A record for the return, kept by person. Logging doesn&apos;t change the books: an owner&apos;s premiums are often an owner draw or wages, which stays as filed.
      </p>
      <Stats items={[
        { label: `Health in ${year}`, value: <Money cents={sumCents(health.map((i) => i.amount))} />, foot: byPerson(health) || "Nothing logged" },
        { label: `Retirement in ${year}`, value: <Money cents={sumCents(retirement.map((i) => i.amount))} />, foot: byPerson(retirement) || "Nothing logged" },
        { label: "Waiting to look at", value: candidates.length.toLocaleString("en-US"), foot: "Found in the transactions" },
      ]} />
      {canWrite && <TaxCandidates businessId={businessId} rows={candidates} people={people} />}
      <div className="grid gap-4 xl:grid-cols-2">
        <TaxItemsTable businessId={businessId} kind="health" rows={health} canWrite={canWrite} people={people} />
        <TaxItemsTable businessId={businessId} kind="retirement" rows={retirement} canWrite={canWrite} people={people} />
      </div>
    </div>
  );
}

async function DocumentsSection({ businessId, canWrite }: { businessId: string; canWrite: boolean }) {
  const [docs, assets, items] = await Promise.all([
    getAllDocuments(businessId), getAssets(businessId, todayIso()), getTaxItems(businessId, "1900-01-01", "2999-12-31"),
  ]);
  const tx = await getTransactionLabels(businessId, [...new Set(docs.map((d) => d.transactionId).filter((x): x is string => !!x))]);
  const assetName = new Map(assets.map((a) => [a.id, a.name]));
  const itemName = new Map(items.map((i) => [i.id, i.description]));
  const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const attachedTo: Record<string, string> = {};
  for (const d of docs) {
    const t = d.transactionId ? tx.get(d.transactionId) : undefined;
    if (t) attachedTo[d.id] = `${t.description} · ${short(t.date)} · ${formatCents(t.amount)}`;
    else if (d.assetId && assetName.has(d.assetId)) attachedTo[d.id] = `Asset: ${assetName.get(d.assetId)}`;
    else if (d.taxItemId && itemName.has(d.taxItemId)) attachedTo[d.id] = `Log: ${itemName.get(d.taxItemId)}`;
  }
  return <DocumentsTab businessId={businessId} rows={docs} attachedTo={attachedTo} canWrite={canWrite} />;
}
