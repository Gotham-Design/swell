// XLSX rendering of a report: the same title block and lines as the CSV, with amounts as
// numeric cells (so the accountant can sum and re-check them), indented labels and bold totals.
import "server-only";
import ExcelJS from "exceljs";
import { centsToInput, type Cents } from "@/lib/money";
import { headerRow, lineFigures, titleBlock, type ReportDocument } from "./document";
import { BRAND_NAME } from "@/lib/theme";

// Spreadsheet cells hold doubles. Cents become dollars only here, at the file boundary, by
// reading the exact decimal text ("1234.56"), not by dividing.
const dollars = (c: Cents | null) => (c === null ? null : Number(centsToInput(c)));
const MONEY = '#,##0.00;(#,##0.00);"–"';

export async function toXlsx(doc: ReportDocument): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND_NAME;
  const ws = wb.addWorksheet(doc.title.slice(0, 31), { views: [{ state: "frozen", ySplit: 7 }] });
  const hasCmp = doc.statement.hasComparison;

  titleBlock(doc).forEach((t, i) => {
    const row = ws.addRow([t]);
    if (i < 2) row.font = { bold: true, size: i === 0 ? 14 : 12 };
  });
  ws.addRow([]);
  const head = ws.addRow(headerRow(doc));
  head.font = { bold: true };
  head.eachCell((c, col) => { if (col > 1) c.alignment = { horizontal: "right" }; });

  for (const l of doc.statement.lines) {
    const f = lineFigures(l, hasCmp);
    // Text cells: exceljs writes strings as strings, so a name like "=X" is never a formula.
    const row = ws.addRow(hasCmp
      ? [l.label, dollars(f.cents), dollars(f.cmpCents), dollars(f.change), f.pct ?? ""]
      : [l.label, dollars(f.cents)]);
    row.getCell(1).alignment = { indent: l.depth };
    for (let c = 2; c <= (hasCmp ? 4 : 2); c++) row.getCell(c).numFmt = MONEY;
    if (hasCmp) row.getCell(5).alignment = { horizontal: "right" };
    if (l.kind !== "account") row.font = { bold: l.kind !== "parent" || undefined, italic: l.warn || undefined };
    if (l.kind === "total" || l.kind === "grand" || l.kind === "subtotal") {
      for (let c = 2; c <= (hasCmp ? 4 : 2); c++) row.getCell(c).border = { top: { style: l.kind === "grand" ? "double" : "thin" } };
    }
  }
  ws.getColumn(1).width = 42;
  for (let c = 2; c <= (hasCmp ? 5 : 2); c++) ws.getColumn(c).width = 18;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
