"use client";

import { useState, useTransition } from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui-kit/status-chip";
import { deleteClientUpload, revokeStatementRequest } from "@/app/b/[businessId]/import/request-actions";

export type ReceivedFile = { id: string; fileName: string; uploadedAt: string; size: number; fromName: string };
export type OpenLink = { id: string; fromName: string; createdAt: string; expiresAt: string; received: number };

/** Event the import wizard listens for: read this file as if it had been dropped. */
export const IMPORT_UPLOAD_EVENT = "ag:import-upload";
export type ImportUploadDetail = { file: File; uploadId: string };

const short = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files clients sent through request links, ready to import, and the links still open. */
export function ReceivedFiles({ businessId, files, links }: { businessId: string; files: ReceivedFile[]; links: OpenLink[] }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const importFile = async (f: ReceivedFile) => {
    setLoading(f.id);
    try {
      const res = await fetch(`/b/${businessId}/import/uploads/${f.id}`);
      if (!res.ok) throw new Error("That file couldn't be opened.");
      const blob = await res.blob();
      const file = new File([blob], f.fileName, { type: blob.type });
      window.dispatchEvent(new CustomEvent<ImportUploadDetail>(IMPORT_UPLOAD_EVENT, { detail: { file, uploadId: f.id } }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  if (!files.length && !links.length) return null;
  return (
    <section className="surface p-5" aria-labelledby="received-title" data-testid="received-files">
      <h2 id="received-title" className="text-[15px] font-semibold">Received from your client</h2>
      {files.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing yet. Files show up here as soon as your client sends them.</p>
      ) : (
        <ul className="mt-2 divide-y">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-3" data-testid="received-file">
              <FileText className="size-4 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{f.fileName}</span>
                <span className="block text-xs text-muted-foreground">{short(f.uploadedAt)} · {kb(f.size)}</span>
              </span>
              <Button size="sm" disabled={loading !== null} onClick={() => importFile(f)}>
                {loading === f.id ? <Loader2 className="animate-spin" aria-hidden /> : null} Import
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} aria-label={`Delete ${f.fileName}`}
                onClick={() => start(async () => {
                  const r = await deleteClientUpload(businessId, f.id);
                  if (r.error) toast.error(r.error); else toast.success(r.message ?? "Deleted");
                })}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
      {links.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Open links</p>
          <ul className="space-y-1.5">
            {links.map((l) => (
              <li key={l.id} className="flex items-center gap-2 text-xs">
                <Chip tone="suggested">Open until {short(l.expiresAt)}</Chip>
                <span className="flex-1 text-muted-foreground">Sent {short(l.createdAt)} · {l.received} file{l.received === 1 ? "" : "s"}</span>
                <Button size="xs" variant="ghost" disabled={pending}
                  onClick={() => start(async () => {
                    const r = await revokeStatementRequest(businessId, l.id);
                    if (r.error) toast.error(r.error); else toast.success(r.message ?? "Link closed");
                  })}>
                  Close link
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// A statement dropped somewhere else (the Ask bar) on its way to the import page: kept in
// memory for the page to pick up when it mounts. Never stored anywhere.
let handedOff: File | null = null;
export function handOffImport(file: File) { handedOff = file; }
export function takeHandOff(): File | null { const f = handedOff; handedOff = null; return f; }
