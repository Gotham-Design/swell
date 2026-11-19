// What a document is, and which files are accepted (the bucket enforces the same).
export const DOCUMENT_KINDS = ["receipt", "bill_of_sale", "mileage_log", "health", "retirement", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  receipt: "Receipt", bill_of_sale: "Bill of sale", mileage_log: "Mileage log", health: "Health", retirement: "Retirement", other: "Other",
};
export const DOCUMENT_TYPES = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel",
];
export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.csv,.xlsx,.xls";
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** The content type to store: the browser's, else guessed from the extension (HEIC often comes blank). */
export function documentType(name: string, browserType: string) {
  if (DOCUMENT_TYPES.includes(browserType)) return browserType;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const byExt: Record<string, string> = {
    pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
    heif: "image/heif", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
  };
  return byExt[ext] ?? null;
}

/** A storage-safe file name that still reads like the original. */
export function safeFileName(name: string) {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "file").slice(-120);
}
