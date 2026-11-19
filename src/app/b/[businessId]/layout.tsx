import { Suspense } from "react";
import { OctagonAlert } from "lucide-react";
import { AppShell, type ShellData } from "@/components/shell/app-shell";
import { formatCents, spokenCents } from "@/lib/money";
import { getBusiness, getMoneyAccounts, getMyBusinesses, getSupabase, getToReviewCount, getReceivedCount, getUser } from "@/lib/dal";

const SHORT_KIND: Record<string, string> = { checking: "Checking", savings: "Savings", cash: "Cash", credit_card: "Card", loan: "Loan" };

/** Icon rail + overlay sidebar on wide screens; a top bar with a slide-in sheet on narrow ones. */
export default function BusinessLayout({ children, params }: LayoutProps<"/b/[businessId]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Shell params={params}>
        <Suspense fallback={null}>
          <LedgerAlerts params={params} />
        </Suspense>
        {children}
      </Shell>
    </Suspense>
  );
}

async function Shell({ params, children }: Pick<LayoutProps<"/b/[businessId]">, "params" | "children">) {
  const { businessId } = await params;
  const [{ business }, businesses, user, toReview, accounts, received] = await Promise.all([
    getBusiness(businessId), getMyBusinesses(), getUser(), getToReviewCount(businessId), getMoneyAccounts(businessId),
    getReceivedCount(businessId),
  ]);
  const data: ShellData = {
    business: { id: business.id, name: business.name },
    // Archived businesses leave the switcher (the current one stays so you can see where you are).
    businesses: businesses.filter((b) => !b.archived || b.id === business.id),
    user,
    toReview,
    received,
    accounts: accounts.filter((a) => !a.archived).map((a) => {
      // Whole dollars in the shortcut list, as people read the balance (cards: amount owed).
      const dollars = a.balance_cents - (a.balance_cents % 100);
      return {
        id: a.id,
        label: `${SHORT_KIND[a.kind] ?? a.name} ${a.last4 ? `··${a.last4}` : ""}`.trim(),
        balance: formatCents(dollars).replace(/\.00$/, ""),
        spoken: spokenCents(a.balance_cents),
      };
    }),
  };
  return <AppShell data={data}>{children}</AppShell>;
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-full flex-1">
      <div className="hidden h-dvh w-[72px] shrink-0 border-r bg-card md:block" />
      <div className="flex-1 p-8"><div className="h-10 w-72 animate-pulse rounded-full bg-surface-muted" /></div>
    </div>
  );
}

/** Open findings from the nightly ledger check: the books may be wrong until they're fixed. */
async function LedgerAlerts({ params }: Pick<LayoutProps<"/b/[businessId]">, "params">) {
  const { businessId } = await params;
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { count } = await supabase.from("ledger_alerts").select("id", { count: "exact", head: true })
    .eq("business_id", business.id).is("resolved_at", null);
  if (!count) return null;
  return (
    <div role="alert" data-testid="ledger-alert"
      className="mb-6 flex items-start gap-3 rounded-2xl border border-money-out/40 bg-money-out-soft px-4 py-3 text-sm text-money-out-text">
      <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">The nightly ledger check found {count} problem{count === 1 ? "" : "s"} in these books.</p>
        <p>Reports may be wrong until this is fixed. This shouldn&apos;t happen through the app; contact support with this business&apos;s name.</p>
      </div>
    </div>
  );
}
