// What every download of a report carries: title block, column labels, filename, and the
// CSV rendering. (XLSX and PDF render the same ReportDocument in their own modules.)
import { centsToInput, type Cents } from "@/lib/money";
import { percentChange, type ReportLine, type Statement } from "./lines";
import type { Range } from "./periods";

export interface ReportDocument {
  businessName: string;
  title: string;
  /** "Jul 1, 2025 – Sep 30, 2025" or "As of Sep 30, 2025". */
  period: string;
  basis: "Cash";
  generatedAt: string;
  columns: { main: string; cmp: string | null };
  statement: Statement;
  filename: (ext: "pdf" | "csv" | "xlsx") => string;
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2025-09-30 -> "Sep 30, 2025". */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH[m - 1]} ${d}, ${y}`;
}
export function formatRange(r: Range): string {
  return `${formatDate(r.from)} – ${formatDate(r.to)}`;
}

/** "Acme Plumbing, LLC" -> "acme-plumbing-llc". */
export function slugify(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "business";
}

/** {business-slug}_{report}_{YYYY-MM-DD}_{YYYY-MM-DD}.{ext} */
export function reportFilename(businessName: string, report: string, from: string, to: string, ext: string): string {
  return `${slugify(businessName)}_${report}_${from}_${to}.${ext}`;
}

/** "Oct 18, 2026, 3:04 PM PDT" in the viewer's time zone (UTC if it's unknown or invalid). */
export function generatedAt(now: Date, timeZone: string | null): string {
  const fmt = (tz: string) => new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(now);
  try { return fmt(timeZone || "UTC"); } catch { return fmt("UTC"); }
}

/** The figures a line shows, as cents: amount, comparison, $ change. */
export function lineFigures(l: ReportLine, hasCmp: boolean) {
  const change = hasCmp && l.cents !== null && l.cmpCents !== null ? l.cents - l.cmpCents : null;
  const pct = change !== null ? percentChange(l.cents!, l.cmpCents!) : null;
  return { cents: l.cents, cmpCents: hasCmp ? l.cmpCents : null, change, pct };
}

export function headerRow(doc: ReportDocument): string[] {
  const { main, cmp } = doc.columns;
  return cmp ? ["Account", main, cmp, "$ change", "% change"] : ["Account", main];
}

export function titleBlock(doc: ReportDocument): string[] {
  return [doc.businessName, doc.title, doc.period, `Basis: ${doc.basis}`, `Generated ${doc.generatedAt}`];
}

// Text people typed (business and account names) that a spreadsheet would read as a
// formula ("=SUM(...)") gets a leading apostrophe. Our own figures never need it.
export const defuse = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const csvCell = (s: string) => (/[",\n\r]|^\s/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const plain = (c: Cents | null) => (c === null ? "" : centsToInput(c));

/** CSV: title block, a blank line, then one row per statement line (labels indented by depth). */
export function toCsv(doc: ReportDocument): string {
  const hasCmp = doc.statement.hasComparison;
  const rows: string[][] = [...titleBlock(doc).map((t) => [defuse(t)]), [], headerRow(doc)];
  for (const l of doc.statement.lines) {
    const f = lineFigures(l, hasCmp);
    // Indented labels start with spaces, so they're quoted (and a formula-like name stays text).
    const label = `${"  ".repeat(l.depth)}${defuse(l.label)}`;
    rows.push(hasCmp ? [label, plain(f.cents), plain(f.cmpCents), plain(f.change), f.pct ?? ""] : [label, plain(f.cents)]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
