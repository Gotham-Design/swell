import { Suspense } from "react";
import { getBusiness, todayIso } from "@/lib/dal";
import { SettingsView } from "./settings-view";

export default function SettingsPage({ params }: PageProps<"/b/[businessId]/settings">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-surface-muted" />}>
      <Settings params={params} />
    </Suspense>
  );
}

/** What suggestions look at, in plain words. */
function aiNote() {
  return "Suggests a category for each new transaction from its description, amount and date, and learns from how you file. "
    + "Account numbers, balances and statement files are never used.";
}

async function Settings({ params }: Pick<PageProps<"/b/[businessId]/settings">, "params">) {
  const { businessId } = await params;
  const { business: b, canManage } = await getBusiness(businessId);

  return (
    <SettingsView canManage={canManage} today={todayIso()} aiNote={aiNote()} exportHref={`/b/${b.id}/export`}
      data={{ id: b.id, name: b.name, legalName: b.legal_name, industry: b.industry, fiscalStart: b.fiscal_year_start_month,
        lockDate: b.lock_date, aiEnabled: b.ai_enabled, autoFile: b.ai_auto_file, archived: !!b.archived_at }} />
  );
}
