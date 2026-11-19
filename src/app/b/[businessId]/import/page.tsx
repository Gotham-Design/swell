import { accountFreshness } from "@/lib/accounts/freshness";
import { Suspense } from "react";
import Link from "next/link";
import { ImportWizard, type ResumeImport } from "@/components/import/import-wizard";
import { Chip } from "@/components/ui-kit/status-chip";
import { PageHeader } from "@/components/ui-kit/page-header";
import { getBusiness, getLastImports, getMoneyAccounts, getSupabase } from "@/lib/dal";
import { getClientRequests, getRecentImports, getStatementSchedules } from "@/lib/dal-import";
import { MonthlyRequests } from "@/components/requests/monthly-requests";
import { serverEnv } from "@/lib/env/server";
import { ReceivedFiles } from "@/components/requests/received-files";
import { RequestStatementsButton } from "@/components/requests/request-statements";
import { defaultFromName } from "./request-actions";
import { mappingSchema } from "@/lib/validation/import";

export default function ImportPage({ params, searchParams }: PageProps<"/b/[businessId]/import">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-surface-muted" />}>
      <Import params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Import({ params, searchParams }: PageProps<"/b/[businessId]/import">) {
  const { businessId } = await params;
  const { batch: batchParam, account: accountParam } = await searchParams;
  const [{ business, canWrite }, accounts, recent, lastImports, received, fromName, schedules] = await Promise.all([
    getBusiness(businessId), getMoneyAccounts(businessId), getRecentImports(businessId), getLastImports(businessId),
    getClientRequests(businessId), defaultFromName(businessId), getStatementSchedules(businessId),
  ]);
  const header = <PageHeader title="Import a statement" subtitle="Nothing is added to your books until you review and confirm." />;
  if (!canWrite) {
    return <div className="space-y-6">{header}<p className="surface p-8 text-center text-sm text-muted-foreground">Only owners and editors can import transactions.</p></div>;
  }
  const active = accounts.filter((a) => !a.archived);
  if (!active.length) {
    return (
      <div className="space-y-6">
        {header}
        <p className="surface p-8 text-center text-sm text-muted-foreground">
          Statements land in a money account. <Link className="font-medium text-brand hover:underline" href={`/b/${business.id}/accounts`}>Add one first</Link>.
        </p>
      </div>
    );
  }
  // "Back to mapping" from a staged import reopens its file and mapping.
  let resume: ResumeImport | undefined;
  if (typeof batchParam === "string" && /^[0-9a-f-]{36}$/i.test(batchParam)) {
    const supabase = await getSupabase();
    const { data } = await supabase.from("import_batches").select("id, money_account_id, file_name, source_text, mapping, status")
      .eq("id", batchParam).eq("business_id", business.id).in("status", ["staged", "verified"]).maybeSingle();
    const mapping = mappingSchema.safeParse(data?.mapping);
    if (data?.source_text && mapping.success) {
      resume = { batchId: data.id, accountId: data.money_account_id, fileName: data.file_name ?? "import.csv", text: data.source_text, mapping: mapping.data };
    }
  }

  const tiles = active.map((a) => {
    const last = lastImports.get(a.id);
    const fresh = accountFreshness(last);
    return { id: a.id, name: a.name, kind: a.kind, last4: a.last4, freshness: fresh.label, stale: fresh.stale, at: last?.at ?? "" };
  });
  // Preselect ?account=, else the account whose statements are most overdue (never imported first).
  const stalest = [...tiles].sort((x, y) => x.at.localeCompare(y.at))[0];
  const initialAccountId = typeof accountParam === "string" && tiles.some((t) => t.id === accountParam) ? accountParam : stalest?.id;
  const names = new Map(accounts.map((a) => [a.id, a.name]));

  const aside = (
    <div className="space-y-4">
    <section className="surface space-y-3 p-5" aria-labelledby="ask-client">
      <h2 id="ask-client" className="text-[15px] font-semibold">Need the statements from your client?</h2>
      <p className="text-sm text-muted-foreground">Send them a private link. They upload the PDFs or CSVs, no account needed, and the files wait here for you.</p>
      <RequestStatementsButton businessId={business.id} businessName={business.name} defaultFrom={fromName}
        accounts={active.map((a) => ({ id: a.id, name: a.name, last4: a.last4 }))} canEmail={serverEnv.canSendEmail} />
    </section>
    <MonthlyRequests businessId={business.id} rows={schedules} />
    <ReceivedFiles businessId={business.id} files={received.files} links={received.links} />
    <section className="surface p-5" aria-labelledby="recent-imports">
      <h2 id="recent-imports" className="mb-3 text-[15px] font-semibold">Recent imports</h2>
      {recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">Your imported statements will show up here, ready to review or undo.</p>
      ) : (
        <ul className="divide-y text-sm" data-testid="recent-imports">
          {recent.slice(0, 5).map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <span className="min-w-0">
                <Link href={`/b/${business.id}/import/${b.id}`} className="block truncate font-medium hover:underline">{b.file_name ?? "Import"}</Link>
                <span className="block truncate text-xs text-muted-foreground">
                  {names.get(b.money_account_id)} · {(b.status === "committed" ? b.committed_count : b.row_count) ?? 0} rows ·{" "}
                  {new Date(b.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </span>
              {b.status === "committed" ? <Chip tone="categorized">Imported</Chip>
                : b.status === "undone" ? <Chip tone="neutral">Undone</Chip>
                : <Chip tone="review">Not imported yet</Chip>}
            </li>
          ))}
        </ul>
      )}
    </section>
    </div>
  );

  return (
    <ImportWizard key={resume?.batchId ?? "new"} businessId={business.id} resume={resume}
      accounts={tiles} initialAccountId={initialAccountId} aside={aside} />
  );
}
