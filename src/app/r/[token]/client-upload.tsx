"use client";

import { useState, type DragEvent } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { useHydrated } from "@/components/submit-button";
import { cn } from "@/lib/utils";
import { uploadStatement } from "./actions";

type Item = { name: string; state: "sending" | "sent" | "failed"; error?: string };

/** The client's drop zone: each file is sent on its own, with a clear sent / failed line per file. */
export function ClientUpload({ token, sent, accountantName }: {
  token: string; sent: { fileName: string; uploadedAt: string }[]; accountantName: string;
}) {
  const hydrated = useHydrated();
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const busy = items.some((i) => i.state === "sending");

  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    setItems((prev) => [...list.map((f) => ({ name: f.name, state: "sending" as const })), ...prev]);
    for (const f of list) {
      const fd = new FormData();
      fd.set("file", f);
      let next: Item;
      try {
        const r = await uploadStatement(token, fd);
        next = r.ok ? { name: f.name, state: "sent" } : { name: f.name, state: "failed", error: r.error };
      } catch {
        next = { name: f.name, state: "failed", error: "That file didn't upload. Please try again." };
      }
      setItems((prev) => {
        const i = prev.findIndex((p) => p.name === f.name && p.state === "sending");
        return i < 0 ? prev : [...prev.slice(0, i), next, ...prev.slice(i + 1)];
      });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void send(e.dataTransfer.files);
  };

  const sentCount = items.filter((i) => i.state === "sent").length;
  return (
    <div className="space-y-3">
      <label htmlFor="client-file"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand/25 px-6 py-12 text-center transition-colors hover:bg-brand-soft/50",
          dragging && "border-brand bg-brand-soft", (!hydrated || busy) && "pointer-events-none opacity-70")}
        data-testid="client-dropzone">
        <span className="mb-1 grid size-12 place-items-center rounded-xl border bg-card text-brand">
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Upload className="size-5" aria-hidden />}
        </span>
        <span className="text-[15px] font-semibold">{busy ? "Sending…" : "Drop your statements here"}</span>
        <span className="text-[13px] text-muted-foreground">or click to choose · PDF, CSV or Excel · up to 4 MB each · several at once is fine</span>
        <input id="client-file" type="file" multiple className="sr-only" disabled={!hydrated || busy}
          accept=".pdf,application/pdf,.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => { void send(e.target.files); e.target.value = ""; }} />
      </label>

      {sentCount > 0 && !busy && (
        <p className="flex items-center gap-2 rounded-xl bg-money-in-soft px-4 py-3 text-sm text-money-in-text" role="status" data-testid="client-sent">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          {sentCount === 1 ? "Your statement is" : `${sentCount} statements are`} with {accountantName}. You can close this page, or send more.
        </p>
      )}

      {(items.length > 0 || sent.length > 0) && (
        <ul className="divide-y rounded-xl border text-sm" aria-label="Files sent">
          {items.map((i, n) => (
            <li key={`${i.name}-${n}`} className="flex items-start gap-3 px-4 py-2.5">
              {i.state === "sending" ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                : i.state === "sent" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-money-in" aria-hidden />
                : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-money-out" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{i.name}</span>
                {i.error && <span className="block text-xs text-money-out-text">{i.error}</span>}
              </span>
              <span className="text-xs text-muted-foreground">{i.state === "sending" ? "Sending" : i.state === "sent" ? "Sent" : "Not sent"}</span>
            </li>
          ))}
          {sent.map((s) => (
            <li key={s.fileName + s.uploadedAt} className="flex items-center gap-3 px-4 py-2.5">
              <CheckCircle2 className="size-4 shrink-0 text-money-in" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{s.fileName}</span>
              <span className="text-xs text-muted-foreground">Sent {new Date(s.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
