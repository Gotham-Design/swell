"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NativeSelect } from "@/components/ui/native-select";
import { PillTabs } from "@/components/ui-kit/segmented-nav";
import { AttachButton, DocumentList } from "@/components/documents/documents-panel";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABEL, type DocumentKind } from "@/lib/documents/kinds";
import type { DocumentRow } from "@/app/b/[businessId]/tax/document-actions";

/** Every file on this client's books, filtered by kind, with what each is attached to. */
export function DocumentsTab({ businessId, rows, attachedTo, canWrite }: {
  businessId: string; rows: DocumentRow[]; attachedTo: Record<string, string>; canWrite: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | DocumentKind>("all");
  const [kind, setKind] = useState<DocumentKind>("receipt");
  const used = DOCUMENT_KINDS.filter((k) => rows.some((r) => r.kind === k));
  const shown = filter === "all" ? rows : rows.filter((r) => r.kind === filter);
  const groups = new Map<string, DocumentRow[]>();
  for (const r of shown) {
    const key = attachedTo[r.id] ?? "Not attached to anything";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {used.length > 1 ? (
          <PillTabs label="Kind of document" value={filter} onChange={setFilter}
            options={[{ value: "all" as const, label: "All" }, ...used.map((k) => ({ value: k, label: DOCUMENT_KIND_LABEL[k] }))]} />
        ) : <span />}
        {canWrite && (
          <span className="flex items-center gap-2">
            <NativeSelect aria-label="What you're uploading" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)} className="h-9 w-40">
              {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{DOCUMENT_KIND_LABEL[k]}</option>)}
            </NativeSelect>
            <AttachButton businessId={businessId} kind={kind} label="Upload" size="default" variant="default" onDone={() => router.refresh()} />
          </span>
        )}
      </div>
      {!rows.length ? (
        <section className="surface p-10 text-center">
          <h2 className="text-[15px] font-semibold">No documents yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Attach receipts from a transaction, a bill of sale from an asset, or upload anything else for this client here. Files are private to the people on these books.
          </p>
        </section>
      ) : (
        [...groups.entries()].map(([label, list]) => (
          <section key={label} className="surface space-y-2 p-5">
            <h2 className="truncate text-sm font-semibold">{label}</h2>
            <DocumentList businessId={businessId} rows={list} canWrite={canWrite} onRemoved={() => router.refresh()} />
          </section>
        ))
      )}
    </div>
  );
}
