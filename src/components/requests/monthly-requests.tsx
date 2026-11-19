"use client";

import { useTransition } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteSchedule, setScheduleActive } from "@/app/b/[businessId]/import/request-actions";

export interface ScheduleRow {
  id: string; email: string; day: number; active: boolean; nextSendOn: string; lastSentAt: string | null; lastError: string | null;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
const short = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Recurring statement requests for this client: who gets them, when the next goes, pause or stop. */
export function MonthlyRequests({ businessId, rows }: { businessId: string; rows: ScheduleRow[] }) {
  const [pending, start] = useTransition();
  if (!rows.length) return null;
  const run = (fn: () => Promise<{ ok?: boolean; message?: string; error?: string }>) => start(async () => {
    const r = await fn();
    if (r.ok) toast.success(r.message ?? "Done"); else toast.error(r.error ?? "That didn't work.");
  });
  return (
    <section className="surface space-y-3 p-5" aria-labelledby="monthly-requests" data-testid="monthly-requests">
      <h2 id="monthly-requests" className="flex items-center gap-2 text-[15px] font-semibold">
        <CalendarClock className="size-4 text-brand" aria-hidden /> Monthly requests
      </h2>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="space-y-1.5 text-sm">
            <p className="truncate font-medium">{r.email}</p>
            <p className="text-xs text-muted-foreground">
              {r.active ? <>Every month on the {ordinal(r.day)} · next {short(r.nextSendOn)}</> : "Paused"}
              {r.lastSentAt && <> · last sent {short(r.lastSentAt)}</>}
            </p>
            {r.lastError && <p className="text-xs text-attention-text">{r.lastError}</p>}
            <span className="flex gap-1">
              <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => setScheduleActive(businessId, r.id, !r.active))}>
                {r.active ? "Pause" : "Resume"}
              </Button>
              <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => deleteSchedule(businessId, r.id))}>Stop</Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
