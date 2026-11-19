"use client";

import { toast } from "sonner";
import { undoMatching, type Matched } from "@/app/b/[businessId]/transactions/actions";

/** "Also filed 4 more State Farm under Insurance", with Undo. */
export function announceMatched(businessId: string, matched: Matched | null | undefined, categoryName: string | undefined) {
  if (!matched?.count) return;
  const more = `${matched.count} more ${matched.label} transaction${matched.count === 1 ? "" : "s"}`;
  toast.success(`Also filed ${more}${categoryName ? ` under ${categoryName}` : ""}`, {
    duration: 8000,
    action: {
      label: "Undo",
      onClick: async () => {
        const r = await undoMatching(businessId, matched.previous);
        if (!r.ok) toast.error(r.error);
        else toast(`Put back ${more}`);
      },
    },
  });
}
