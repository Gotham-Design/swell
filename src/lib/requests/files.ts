// Which statement files a client may send, decided from the bytes, not the name or the browser.
import { isLegacyXls, isPdf, isZip, looksBinary } from "@/lib/import/xlsx";

// Vercel caps a request body at 4.5 MB; statement PDFs are usually well under 1 MB.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOADS_PER_REQUEST = 25;

export type StatementFileType = "application/pdf" | "text/csv" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The file's real type, or a reason to refuse it. */
export function statementFileType(bytes: Uint8Array): { type: StatementFileType } | { error: string } {
  if (bytes.byteLength === 0) return { error: "That file is empty." };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { error: "That file is over 4 MB. Split it into smaller date ranges, or send the CSV download instead." };
  if (isPdf(bytes)) return { type: "application/pdf" };
  if (isZip(bytes)) return { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  if (isLegacyXls(bytes)) return { error: "That's an older Excel file (.xls). Save it as .xlsx or CSV and try again." };
  if (looksBinary(bytes)) return { error: "Only PDF, CSV or Excel (.xlsx) statements can be sent." };
  return { type: "text/csv" };
}

/** A safe file name for storage: letters, digits, dot, dash and underscore; never a path. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "statement";
  const cleaned = base.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/^\.+/, "").slice(-120);
  return cleaned || "statement";
}
