"use client";

import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useHydrated } from "@/components/submit-button";

const FORMAT_LABEL = { pdf: "PDF", csv: "CSV", xlsx: "Excel (XLSX)" } as const;

/**
 * Export menu: PDF / CSV / XLSX of the report as shown. The viewer's time zone rides along
 * so the "generated at" stamp reads in local time.
 */
export function DownloadMenu({ businessId, report, query }: { businessId: string; report: "pnl" | "balance-sheet"; query: string }) {
  const hydrated = useHydrated();
  const href = (format: string) => {
    const q = new URLSearchParams(query);
    q.set("report", report);
    q.set("format", format);
    if (hydrated) q.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone);
    return `/b/${businessId}/reports/download?${q}`;
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" data-testid="downloads" />}>
        Export <ChevronDown className="text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {(["pdf", "csv", "xlsx"] as const).map((f) => (
          <DropdownMenuItem key={f} render={<a href={href(f)} download />} nativeButton={false}>
            <Download aria-hidden /> {FORMAT_LABEL[f]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
