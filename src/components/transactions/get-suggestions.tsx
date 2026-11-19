"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/submit-button";
import { fileConfidentNow, getSuggestionsNow } from "@/app/b/[businessId]/transactions/ai-actions";

/** Ask for category suggestions on uncategorized rows that don't have one yet. */
export function GetSuggestionsButton({ businessId }: { businessId: string }) {
  const [pending, start] = useTransition();
  const off = !useHydrated();
  return (
    <Button variant="ghost" size="sm" disabled={off || pending} data-testid="get-suggestions"
      onClick={() => start(async () => {
        const r = await getSuggestionsNow(businessId);
        if (r.ok) toast.success(r.message);
        else toast.error(r.error);
      })}>
      {pending ? "Finding categories…" : "Suggest categories"}
    </Button>
  );
}

/** "File the confident ones": for suggestions that came in before auto-filing (or while it was off). */
export function FileConfidentButton({ businessId }: { businessId: string }) {
  const [pending, start] = useTransition();
  const off = !useHydrated();
  return (
    <Button variant="ghost" size="sm" disabled={off || pending} data-testid="file-confident"
      onClick={() => start(async () => {
        const r = await fileConfidentNow(businessId);
        if (r.ok) toast.success(r.message);
        else toast.error(r.error);
      })}>
      {pending ? "Filing…" : "File the confident ones"}
    </Button>
  );
}
