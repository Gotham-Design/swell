// CSV for the full business export: one header row, then rows. Text people typed is
// defused against spreadsheet formulas; amounts are written as plain decimals.
import { defuse } from "@/lib/reports/document";

export type Cell = string | number | boolean | null | undefined | string[] | Record<string, unknown>;

function cell(v: Cell, text: boolean): string {
  if (v === null || v === undefined) return "";
  let s = Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (text) s = defuse(s);
  return /[",\n\r]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Columns listed as `text` are user-entered and get formula defusing. */
export function toCsv(headers: string[], rows: Cell[][], text: Set<string> = new Set()): string {
  const textCols = headers.map((h) => text.has(h));
  return [headers.join(","), ...rows.map((r) => r.map((v, i) => cell(v, textCols[i])).join(","))].join("\r\n") + "\r\n";
}
