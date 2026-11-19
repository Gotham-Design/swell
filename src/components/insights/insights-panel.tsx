import Link from "next/link";
import { CalendarClock, Flag, Store, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { InsightsData } from "@/lib/dal-insights";
import { centsToInput, formatCents } from "@/lib/money";
import { formatRange } from "@/lib/reports/document";
import { ExplainPeriod, ReviewWithAi } from "./insights-actions";

export const LARGE_RULE_LABEL: Record<string, string> = {
  vendor_median: "3× this vendor's usual",
  p95: "Top 5% of money out (12 months)",
  threshold: "Over your threshold",
};
const CADENCE: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", annual: "Yearly" };

/** Transactions filtered down to one large payment (same day, vendor and amount). */
function largeHref(businessId: string, l: InsightsData["insights"]["large"][number]) {
  const q = new URLSearchParams({ date: "custom", from: l.date, to: l.date });
  if (l.vendor) q.set("q", l.vendor);
  const amount = centsToInput(Math.abs(l.amount_cents));
  q.set("min", amount);
  q.set("max", amount);
  return `/b/${businessId}/transactions?${q}`;
}

export function InsightsPanel({ businessId, data, aiEnabled, canWrite, pendingSuggestions }: {
  businessId: string; data: InsightsData; aiEnabled: boolean; canWrite: boolean; pendingSuggestions: number;
}) {
  const { insights: ins } = data;
  const period = formatRange({ from: ins.from, to: ins.to });
  return (
    <Card data-testid="insights">
      <CardHeader>
        <CardTitle>Insights</CardTitle>
        <CardDescription>{period} · from your recurring charges, vendors and flags{ins.patterns_computed_at ? "" : " (not computed yet)"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {aiEnabled && (
          <ExplainPeriod businessId={businessId} from={ins.from} to={ins.to} canWrite={canWrite} explanation={data.explanation} />
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="ins-recurring" className="space-y-2 lg:col-span-2" data-testid="insights-recurring">
            <h3 id="ins-recurring" className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4" aria-hidden /> Recurring</h3>
            {ins.recurring.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="text-left text-sm text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Vendor</th><th className="py-1 pr-3 font-medium">Cadence</th>
                      <th className="py-1 pr-3 text-right font-medium">Expected</th><th className="py-1 pr-3 font-medium">Next</th>
                      <th className="py-1 pr-3 text-right font-medium">Per year</th><th className="py-1 font-medium"><span className="sr-only">Status</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ins.recurring.map((r) => (
                      <tr key={`${r.vendor}:${r.direction}`} className="border-t" data-testid="recurring-row" data-vendor={r.vendor}>
                        <td className="py-1.5 pr-3 font-medium">{r.vendor}</td>
                        <td className="py-1.5 pr-3">{CADENCE[r.cadence] ?? r.cadence}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums" data-testid="recurring-expected">{formatCents(r.expected_amount_cents)}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{r.expected_next_date}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums" data-testid="recurring-annual">{formatCents(r.annualized_cents)}</td>
                        <td className="py-1.5">
                          {r.status === "missed" && <Badge variant="destructive" data-testid="recurring-status">Missed</Badge>}
                          {r.status === "amount_changed" && (
                            <Badge variant="outline" data-testid="recurring-status"
                              className={r.price_increase ? "border-amber-400 text-amber-800 dark:text-amber-300" : ""}>
                              {r.price_increase ? "Price up" : "Amount changed"}
                              {r.regular_amount_cents !== null && r.last_amount_cents !== null &&
                                `: ${formatCents(Math.abs(r.regular_amount_cents))} → ${formatCents(Math.abs(r.last_amount_cents))}`}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-muted-foreground">No recurring charges found yet (it takes 3 regular charges).</p>}
          </section>

          <section aria-labelledby="ins-large" className="space-y-2" data-testid="insights-large">
            <h3 id="ins-large" className="flex items-center gap-2 text-sm font-semibold"><Flag className="size-4" aria-hidden /> Large transactions</h3>
            {ins.large.length ? (
              <ul className="divide-y text-sm">
                {ins.large.map((l) => (
                  <li key={l.transaction_id} className="flex items-start justify-between gap-3 py-1.5" data-testid="large-row">
                    <div className="min-w-0">
                      <Link href={largeHref(businessId, l)} className="block truncate font-medium hover:underline">{l.description}</Link>
                      <span className="text-xs text-muted-foreground">{l.date} · {l.rules.map((r) => LARGE_RULE_LABEL[r] ?? r).join(", ")}</span>
                    </div>
                    <span className="tabular-nums text-red-700 dark:text-red-400">{formatCents(l.amount_cents)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Nothing unusually large in this period.</p>}
          </section>

          <section aria-labelledby="ins-vendors" className="space-y-3" data-testid="insights-vendors">
            <h3 id="ins-vendors" className="flex items-center gap-2 text-sm font-semibold"><Store className="size-4" aria-hidden /> Vendors</h3>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">New this period</p>
              {ins.new_vendors.length ? (
                <ul className="text-sm" data-testid="new-vendors">
                  {ins.new_vendors.slice(0, 8).map((v) => (
                    <li key={v.vendor} className="flex justify-between py-0.5"><span>{v.vendor}</span>
                      <span className="text-muted-foreground">{v.txn_count} txn{v.txn_count === 1 ? "" : "s"}</span></li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">None.</p>}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Top by spend</p>
              {ins.top_vendors.length ? (
                <ol className="text-sm" data-testid="top-vendors">
                  {ins.top_vendors.map((v) => (
                    <li key={v.vendor} className="flex justify-between py-0.5"><span>{v.vendor}</span>
                      <span className="tabular-nums">{formatCents(v.spend_cents)}</span></li>
                  ))}
                </ol>
              ) : <p className="text-sm text-muted-foreground">No spending in this period.</p>}
            </div>
          </section>
        </div>

        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2" data-testid="insights-uncategorized">
          <span className="flex items-center gap-2 text-sm">
            <TriangleAlert className={ins.uncategorized ? "size-4 text-amber-600" : "size-4 text-muted-foreground"} aria-hidden />
            <span><span className="font-semibold tabular-nums" data-testid="uncategorized-count">{ins.uncategorized}</span> uncategorized transaction{ins.uncategorized === 1 ? "" : "s"}</span>
          </span>
          {aiEnabled && canWrite && ins.uncategorized > 0 && <ReviewWithAi businessId={businessId} pending={pendingSuggestions} />}
          {!aiEnabled && ins.uncategorized > 0 && (
            <Link href={`/b/${businessId}/transactions?type=uncategorized`} className="text-sm underline">Show them</Link>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
