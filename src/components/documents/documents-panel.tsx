"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { FileText, Image as ImageIcon, Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENT_ACCEPT, MAX_DOCUMENT_BYTES, documentType, safeFileName, type DocumentKind } from "@/lib/documents/kinds";
import { deleteDocument, listDocuments, recordDocument, type DocumentRow } from "@/app/b/[businessId]/tax/document-actions";
import { cn } from "@/lib/utils";

export type DocumentLink = { transactionId?: string; assetId?: string; taxItemId?: string };

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Put files in this business's private folder, then record them. Returns the rows saved. */
export async function uploadDocuments(businessId: string, files: File[], kind: DocumentKind, link: DocumentLink = {}) {
  const supabase = createClient();
  const saved: DocumentRow[] = [];
  for (const file of files) {
    const type = documentType(file.name, file.type);
    if (!type) { toast.error(`${file.name}: use a PDF, photo, CSV or spreadsheet`); continue; }
    if (file.size > MAX_DOCUMENT_BYTES) { toast.error(`${file.name} is over 20 MB`); continue; }
    const path = `${businessId}/${crypto.randomUUID()}/${safeFileName(file.name)}`;
    const up = await supabase.storage.from("documents").upload(path, file, { contentType: type, upsert: false });
    if (up.error) { toast.error(`${file.name}: ${up.error.message}`); continue; }
    const r = await recordDocument(businessId, { path, name: file.name.slice(0, 255), type, size: file.size, kind, ...link });
    if (r.ok) saved.push(r.document); else toast.error(`${file.name}: ${r.error}`);
  }
  return saved;
}

/** "Attach" button: picks files and uploads them. */
export function AttachButton({ businessId, kind, link, onDone, label = "Attach file", size = "sm", variant = "outline", disabled }: {
  businessId: string; kind: DocumentKind; link?: DocumentLink; onDone?: (rows: DocumentRow[]) => void; label?: string;
  size?: "sm" | "xs" | "default"; variant?: "outline" | "ghost" | "default"; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={input} type="file" multiple accept={DOCUMENT_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          const rows = await uploadDocuments(businessId, files, kind, link);
          setBusy(false);
          if (rows.length) { toast.success(rows.length === 1 ? "Attached" : `Attached ${rows.length} files`); onDone?.(rows); }
        }} />
      <Button type="button" size={size} variant={variant} disabled={busy || disabled} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Paperclip aria-hidden />} {busy ? "Uploading…" : label}
      </Button>
    </>
  );
}

/** A short list of files with open and remove. */
export function DocumentList({ businessId, rows, canWrite, onRemoved, compact }: {
  businessId: string; rows: DocumentRow[]; canWrite: boolean; onRemoved?: (id: string) => void; compact?: boolean;
}) {
  const [pending, start] = useTransition();
  if (!rows.length) return null;
  return (
    <ul className={cn("divide-y rounded-xl border", compact && "text-sm")} data-testid="document-list">
      {rows.map((d) => {
        const Icon = d.type.startsWith("image/") ? ImageIcon : FileText;
        return (
          <li key={d.id} className="flex items-center gap-3 px-3 py-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <a href={`/b/${businessId}/documents/${d.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
              {d.name}
            </a>
            <span className="shrink-0 text-xs text-muted-foreground">{kb(d.size)}</span>
            {canWrite && (
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${d.name}`} disabled={pending}
                onClick={() => start(async () => {
                  const r = await deleteDocument(businessId, d.id);
                  if (r.ok) { toast.success("Removed"); onRemoved?.(d.id); } else toast.error(r.error ?? "Couldn't remove it");
                })}>
                <Trash2 aria-hidden />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Documents on one transaction, asset or log entry, loaded when shown. */
export function DocumentsPanel({ businessId, link, kind, canWrite, title = "Documents" }: {
  businessId: string; link: DocumentLink; kind: DocumentKind; canWrite: boolean; title?: string;
}) {
  const [rows, setRows] = useState<DocumentRow[] | null>(null);
  const key = link.transactionId ?? link.assetId ?? link.taxItemId ?? "";
  useEffect(() => {
    let live = true;
    listDocuments(businessId, link).then((r) => { if (live) setRows(r); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, key]);
  return (
    <section className="space-y-2" aria-label={title} data-testid="documents-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Paperclip className="size-4" aria-hidden /> {title}</h3>
        {canWrite && <AttachButton businessId={businessId} kind={kind} link={link} size="xs" onDone={(r) => setRows((cur) => [...r, ...(cur ?? [])])} />}
      </div>
      {rows === null ? <p className="text-xs text-muted-foreground">Loading…</p>
        : rows.length ? <DocumentList businessId={businessId} rows={rows} canWrite={canWrite} compact onRemoved={(id) => setRows((cur) => (cur ?? []).filter((d) => d.id !== id))} />
          : <p className="text-xs text-muted-foreground">Receipts, invoices or a bill of sale. PDF or photo, up to 20 MB.</p>}
    </section>
  );
}
