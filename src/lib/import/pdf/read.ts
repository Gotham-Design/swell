import "server-only";
import Papa from "papaparse";
import { extractTextItems } from "unpdf";
import { ImportFileError, MAX_ROWS, headerSignature, type ParsedFile } from "../parse";
import { bankName, readStatement, statementReconciles } from "./statement";

/**
 * A statement PDF as a ParsedFile, read here on our server (nothing is sent anywhere else).
 * Combined statements carry every account; `pickStatementAccount` narrows to one.
 */
export async function analyzePdf(bytes: Uint8Array): Promise<ParsedFile> {
  let pages;
  try {
    pages = (await extractTextItems(bytes)).items;
  } catch {
    throw new ImportFileError("We couldn't open that PDF. If it's password-protected, download it again without a password.");
  }
  const text = pages.flat().map((i) => i.str).join("").trim();
  if (!text) {
    throw new ImportFileError("That PDF is a scanned image, so there's no text to read. Download the statement from your bank's website instead of scanning it.");
  }
  const items = pages.map((p) => p.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height })));
  const t = readStatement(items);
  // Only import a PDF we read cleanly: rows that add up from the beginning balance to the
  // ending one. Otherwise ask for the bank's CSV rather than import something slightly off.
  const check = statementReconciles(t);
  if (!check.ok) {
    const bank = bankName(items);
    console.info("pdf statement not supported", JSON.stringify({ bank, reason: check.reason, rows: t.rows.length }));
    throw new ImportFileError(
      `PDF statements from ${bank ?? "this bank"} aren't available yet. Download the activity as a CSV or Excel file from `
      + `${bank ? `${bank}'s` : "your bank's"} website instead (usually Download or Export on the account's transactions page), and import that.`);
  }
  if (t.rows.length > MAX_ROWS) throw new ImportFileError(`That file has ${t.rows.length.toLocaleString("en-US")} rows; the limit is 50,000.`);
  return {
    encoding: "pdf", delimiter: ",", headers: t.headers, rows: t.rows, preamble: [],
    signature: headerSignature(t.headers),
    sourceText: Papa.unparse([t.headers, ...t.rows]),
    statement: { accounts: t.accounts, rowAccount: t.rowAccount, account: null },
  };
}
