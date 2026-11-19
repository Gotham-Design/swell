import { Suspense } from "react";
import { getAccountNames, getBusiness, getMoneyAccounts, getPickerOptions, getRules } from "@/lib/dal";
import { RulesView } from "@/components/rules/rules-view";

export default function RulesPage({ params, searchParams }: PageProps<"/b/[businessId]/rules">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-surface-muted" />}>
      <Rules params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Rules({ params, searchParams }: PageProps<"/b/[businessId]/rules">) {
  const { businessId } = await params;
  const { edit } = await searchParams;
  const [{ business, canWrite }, rules, options, names, moneyAccounts] = await Promise.all([
    getBusiness(businessId), getRules(businessId), getPickerOptions(businessId), getAccountNames(businessId), getMoneyAccounts(businessId),
  ]);
  return (
    <RulesView businessId={business.id} rules={rules} canWrite={canWrite} options={options} names={names}
      moneyAccounts={moneyAccounts.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name }))}
      editId={typeof edit === "string" ? edit : null} />
  );
}
