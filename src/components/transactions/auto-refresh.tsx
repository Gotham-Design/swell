"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

/**
 * While suggestions are being worked out in the background (right after an import), refresh
 * the list every few seconds so filed rows and suggestions appear on their own. Gives up after
 * `forSeconds` and shows `fallback` (the manual "Suggest categories" button).
 */
export function SortingNotice({ every = 3, forSeconds = 45, fallback }: { every?: number; forSeconds?: number; fallback: ReactNode }) {
  const router = useRouter();
  const [left, setLeft] = useState(Math.ceil(forSeconds / every));
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => { router.refresh(); setLeft((n) => n - 1); }, every * 1000);
    return () => clearTimeout(t);
  }, [left, every, router]);
  if (left <= 0) return <>{fallback}</>;
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft px-4 py-2 text-sm text-brand" role="status" data-testid="sorting">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Sorting your transactions. Confident ones are filed automatically; this takes a few seconds.
    </p>
  );
}
