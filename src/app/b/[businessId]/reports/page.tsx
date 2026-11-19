import { Suspense } from "react";
import { redirect } from "next/navigation";

/** Reports open on the Profit & Loss; the Balance sheet is a tab beside it. */
export default function ReportsPage({ params }: PageProps<"/b/[businessId]/reports">) {
  return <Suspense fallback={null}><ToPnl params={params} /></Suspense>;
}

async function ToPnl({ params }: Pick<PageProps<"/b/[businessId]/reports">, "params">) {
  const { businessId } = await params;
  redirect(`/b/${businessId}/reports/pnl`);
  return null;
}
