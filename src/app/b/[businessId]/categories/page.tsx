import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui-kit/page-header";
import { Chip } from "@/components/ui-kit/status-chip";
import { MonthPicker } from "@/components/overview/month-picker";
import { getBusiness, getPickerOptions } from "@/lib/dal";
import { getCategoryDetail, getCategoryScreen } from "@/lib/dal-categories";
import { resolveMonth } from "@/lib/dal-overview";
import { formatCents } from "@/lib/money";
import { ArchivedCategories, CategoryDetail, CategoryTable, NewCategoryButton } from "./categories-list";

export default function CategoriesPage({ params, searchParams }: PageProps<"/b/[businessId]/categories">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-surface-muted" />}>
      <Categories params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Categories({ params, searchParams }: PageProps<"/b/[businessId]/categories">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const month = resolveMonth(sp.month);
  const [{ business, canWrite }, screen, options] = await Promise.all([
    getBusiness(businessId), getCategoryScreen(businessId, month), getPickerOptions(businessId),
  ]);
  const base = `/b/${business.id}`;
  const all = screen.groups.flatMap((g) => g.rows);
  // Selected: ?cat=, else the biggest expense this month, else the first used row.
  const selected = all.find((r) => r.id === sp.cat)
    ?? screen.groups.find((g) => g.key === "expense")?.rows.find((r) => r.used)
    ?? all.find((r) => r.used) ?? all[0] ?? null;
  const detail = selected ? await getCategoryDetail(business.id, selected.id, month) : null;
  const hrefFor = Object.fromEntries(all.map((r) => [r.id,
    `${base}/categories?${new URLSearchParams({ ...(sp.month ? { month: month.key } : {}), cat: r.id })}`]));
  const txHref = (id: string) => `${base}/transactions?${new URLSearchParams({ date: "custom", from: month.from, to: month.to, cat: id })}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Categories" subtitle="The buckets every transaction lands in. These become the lines on your reports."
        actions={<>
          <MonthPicker value={month.key} months={month.months} />
          {canWrite && <NewCategoryButton businessId={business.id} options={options} />}
        </>} />

      {screen.uncategorized && (
        <div className="surface flex flex-wrap items-center gap-3 px-5 py-3 text-sm" data-testid="uncategorized-banner">
          <Chip tone="review">{screen.uncategorized.count} uncategorized</Chip>
          <span className="flex-1 text-muted-foreground">
            {formatCents(screen.uncategorized.total)} in {month.name} isn&apos;t in a category yet, so it&apos;s missing from these totals.
          </span>
          <Link href={`${base}/transactions?type=uncategorized`} className="font-medium hover:underline">Review now</Link>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_384px]">
        <CategoryTable groups={screen.groups} selectedId={selected?.id ?? null} hrefFor={hrefFor}
          monthName={month.name} usedCount={screen.usedCount} />
        {selected && detail && (
          <div className="lg:sticky lg:top-6">
            <CategoryDetail businessId={business.id} options={options} canWrite={canWrite}
              data={{ row: selected, parentName: screen.parentName(selected.parentId), monthName: month.name,
                transactionsHref: txHref(selected.id), months: detail.months, average: detail.average, vendors: detail.vendors }} />
          </div>
        )}
      </div>

      {screen.archived.length > 0 && <ArchivedCategories businessId={business.id} rows={screen.archived} canWrite={canWrite} />}
    </div>
  );
}
