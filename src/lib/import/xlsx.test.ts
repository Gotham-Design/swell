import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { ImportFileError, analyzeFile } from "./parse";
import { columnIndex, serialToIso } from "./xlsx";

async function workbook(build: (ws: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  build(wb.addWorksheet("Statement"));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("Excel statements", () => {
  it("reads the first sheet: preamble skipped, dates as ISO, numbers without float noise", async () => {
    const bytes = await workbook((ws) => {
      ws.addRow(["Business Checking ...4821"]);
      ws.addRow([]);
      ws.addRow(["Date", "Description", "Amount", "Balance"]);
      const r1 = ws.addRow([new Date(Date.UTC(2026, 9, 1)), "SQUARE INC DEPOSIT", 2273.55, 10_000.1 + 0.2]);
      r1.getCell(1).numFmt = "mm/dd/yyyy";
      const r2 = ws.addRow([new Date(Date.UTC(2026, 9, 2)), "RESTAURANT DEPOT & CO", -664.71]);
      r2.getCell(1).numFmt = "m/d/yy";
    });
    const f = analyzeFile(bytes);
    expect(f.encoding).toBe("xlsx");
    expect(f.headers).toEqual(["Date", "Description", "Amount", "Balance"]);
    expect(f.rows).toEqual([
      ["2026-10-01", "SQUARE INC DEPOSIT", "2273.55", "10000.3"],
      ["2026-10-02", "RESTAURANT DEPOT & CO", "-664.71", ""],
    ]);
    expect(f.sourceText.split(/\r?\n/)[1]).toBe("Date,Description,Amount,Balance");
  });

  it("turns PDFs, old .xls and other binary files away with a plain message", () => {
    expect(() => analyzeFile(new TextEncoder().encode("%PDF-1.7 ..."))).toThrow(/PDF/);
    expect(() => analyzeFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]))).toThrow(/\.xls/);
    expect(() => analyzeFile(new Uint8Array(200).fill(1))).toThrow(ImportFileError);
  });

  it("maps cell references and serial dates", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("AB7")).toBe(27);
    expect(serialToIso(46296)).toBe("2026-10-01");
  });
});
