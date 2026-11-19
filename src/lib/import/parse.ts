// Reading a bank CSV: bytes -> text (encoding), text -> rows (delimiter), rows -> header
// + data (skipping bank preamble lines). Pure functions: the web worker and the tests run
// exactly this code.
import Papa from "papaparse";
import { isLegacyXls, isPdf, isZip, looksBinary, readXlsxRows } from "./xlsx";
import type { StatementAccount } from "./pdf/statement";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 50_000;

export type Encoding = "utf-8" | "utf-8-bom" | "windows-1252" | "xlsx" | "pdf";
export const ENCODING_LABEL: Record<Encoding, string> = {
  "utf-8": "UTF-8", "utf-8-bom": "UTF-8 (with BOM)", "windows-1252": "Windows-1252", xlsx: "Excel workbook", pdf: "PDF statement",
};
const DELIMITERS = [",", ";", "\t", "|"] as const;
export type Delimiter = (typeof DELIMITERS)[number];
export const DELIMITER_LABEL: Record<Delimiter, string> = { ",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe" };

/** UTF-8 with or without a BOM if it decodes cleanly, else Windows-1252 (old Excel exports). */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: Encoding } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8-bom" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

function parseWith(text: string, delimiter: string, preview = 0): string[][] {
  const result = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: "greedy", preview });
  return result.data.map((r) => r.map((c) => (c ?? "").trim()));
}

/** Most common column count among rows with more than one column. */
function modalWidth(rows: string[][]): number {
  const counts = new Map<number, number>();
  for (const r of rows) if (r.length > 1) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [width, n] of counts) if (n > bestCount || (n === bestCount && width > best)) { best = width; bestCount = n; }
  return best;
}

/** The delimiter that splits the most lines into the same number of columns. */
export function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const rows = parseWith(text, d, 60);
    const width = modalWidth(rows);
    if (width < 2) continue;
    const score = rows.filter((r) => r.length === width).length * Math.min(width, 12);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

const looksNumeric = (s: string) => /^[-+($£€]*[\d,.\s]+\)?$/.test(s) && /\d/.test(s);
const looksDate = (s: string) => /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(s) || /^\d{1,2}[ -][A-Za-z]{3}[ -]\d{2,4}$/.test(s);
const HEADER_WORDS = /\b(date|posted|posting|amount|debit|credit|description|payee|memo|balance|details|reference|category|withdrawal|deposit|merchant|narrative|transaction)\b/i;

/**
 * Index of the header row. Banks often put an account summary above it, so: the first
 * row that names (nearly) every column of the data, mostly with text rather than numbers
 * or dates, and is followed by a data row.
 * Rows naming known columns win ties.
 */
export function findHeaderRow(rows: string[][]): number {
  // Measure the data's width from the end of the file: a preamble sits on top and, in a
  // short export, can outnumber the transactions.
  const width = modalWidth(rows.slice(-Math.min(200, Math.max(3, Math.ceil(rows.length / 4)))));
  let fallback = -1;
  for (let i = 0; i < Math.min(rows.length - 1, 100); i++) {
    const r = rows[i];
    const filled = r.filter(Boolean);
    // A header names (nearly) every column; preamble lines leave cells empty.
    if (r.length < width - 1 || filled.length < Math.max(2, width - 1)) continue;
    const texty = filled.filter((c) => !looksNumeric(c) && !looksDate(c)).length;
    if (texty < Math.ceil(filled.length * 0.75)) continue;
    const next = rows[i + 1];
    if (!next || next.length < width - 1) continue;
    if (filled.some((c) => HEADER_WORDS.test(c))) return i;
    if (fallback < 0) fallback = i;
  }
  return fallback < 0 ? 0 : fallback;
}

export interface ParsedFile {
  encoding: Encoding;
  delimiter: Delimiter;
  /** Lines above the header (bank preamble), as text. */
  preamble: string[];
  headers: string[];
  /** Data rows, each padded/truncated to the header width. */
  rows: string[][];
  /** Stable key for this file layout, used to find a saved mapping. */
  signature: string;
  /** The file as text, kept with the import: the CSV itself, or an Excel sheet / PDF table written out as CSV. */
  sourceText: string;
  /** PDF statements: the accounts it covers, each row's account, and the one picked (null = all). */
  statement?: { accounts: StatementAccount[]; rowAccount: number[]; account: number | null };
}

/** One account of a combined PDF statement: its rows only, and its CSV text. */
export function pickStatementAccount(file: ParsedFile, index: number): ParsedFile {
  const st = file.statement;
  if (!st || st.accounts.length <= 1) return { ...file, statement: st && { ...st, account: 0 } };
  const rows = file.rows.filter((_, i) => st.rowAccount[i] === index);
  return {
    ...file, rows,
    sourceText: Papa.unparse([file.headers, ...rows]),
    statement: { ...st, account: index, rowAccount: rows.map(() => index) },
  };
}

export class ImportFileError extends Error {}

export function headerSignature(headers: string[]): string {
  return headers.map((h) => h.trim().toLowerCase().replace(/\s+/g, " ")).join("|");
}

/** The whole read step. Throws ImportFileError with a message for the user. */
export function analyzeFile(bytes: Uint8Array): ParsedFile {
  if (bytes.byteLength === 0) throw new ImportFileError("That file is empty.");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ImportFileError("That file is over 10 MB. Split it into smaller date ranges.");
  if (isPdf(bytes)) {
    // PDFs are read on the server (analyzePdf); this synchronous path only sees one by mistake.
    throw new ImportFileError("PDF statements are read on the server. Try again.");
  }
  if (isLegacyXls(bytes)) throw new ImportFileError("That's an older Excel file (.xls). Open it and save it as .xlsx or CSV, then try again.");

  let encoding: Encoding, delimiter: Delimiter, all: string[][], sourceText: string;
  if (isZip(bytes)) {
    try {
      const sheet = readXlsxRows(bytes).filter((r) => r.some(Boolean));
      // Spreadsheets drop trailing empty cells; square the rows up like a CSV's.
      const width = Math.max(0, ...sheet.map((r) => r.length));
      all = sheet.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill("")] : r));
    } catch {
      throw new ImportFileError("We couldn't read that file. If it's a spreadsheet, save it as .xlsx or CSV and try again.");
    }
    encoding = "xlsx";
    delimiter = ",";
    sourceText = Papa.unparse(all);
  } else {
    if (looksBinary(bytes)) throw new ImportFileError("That doesn't look like a CSV or Excel file. Export the statement from your bank as CSV.");
    const decoded = decodeBytes(bytes);
    encoding = decoded.encoding;
    delimiter = detectDelimiter(decoded.text);
    all = parseWith(decoded.text, delimiter);
    sourceText = decoded.text;
  }
  if (all.length === 1 && all[0].filter(Boolean).length > 1) {
    throw new ImportFileError("The file has a header row but no transactions under it.");
  }
  if (all.length < 2) throw new ImportFileError("We couldn't find any rows in that file. Is it a CSV export?");

  const h = findHeaderRow(all);
  // Blank trailing header cells come from a trailing delimiter; name them so they show.
  const headers = all[h].map((c, i) => c || `Column ${i + 1}`);
  while (headers.length > 1 && /^Column \d+$/.test(headers[headers.length - 1]) && all.slice(h + 1, h + 50).every((r) => !r[headers.length - 1])) {
    headers.pop();
  }
  const rows = all.slice(h + 1)
    .filter((r) => r.some(Boolean))
    .map((r) => (r.length >= headers.length ? r.slice(0, headers.length) : [...r, ...Array(headers.length - r.length).fill("")]));
  if (rows.length === 0) throw new ImportFileError("The file has a header row but no transactions under it.");
  if (rows.length > MAX_ROWS) throw new ImportFileError(`That file has ${rows.length.toLocaleString("en-US")} rows; the limit is 50,000.`);

  return {
    encoding, delimiter, headers, rows, sourceText,
    preamble: all.slice(0, h).map((r) => r.filter(Boolean).join(" ")),
    signature: headerSignature(headers),
  };
}
