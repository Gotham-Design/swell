import { describe, expect, it } from "vitest";
import { safeFileName, statementFileType } from "./files";

describe("statement files a client may send", () => {
  it("takes the type from the bytes", () => {
    expect(statementFileType(new TextEncoder().encode("%PDF-1.7 ..."))).toEqual({ type: "application/pdf" });
    expect(statementFileType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]))).toMatchObject({ type: expect.stringContaining("spreadsheetml") });
    expect(statementFileType(new TextEncoder().encode("Date,Amount\n10/1,5.00\n"))).toEqual({ type: "text/csv" });
  });
  it("refuses empty, oversized, old Excel and other binary files", () => {
    expect(statementFileType(new Uint8Array())).toHaveProperty("error");
    expect(statementFileType(new Uint8Array(4 * 1024 * 1024 + 1))).toHaveProperty("error");
    expect(statementFileType(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toHaveProperty("error");
    expect(statementFileType(new Uint8Array(100).fill(0))).toHaveProperty("error");
  });
  it("never keeps a path in the name", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\Sept Statement (1).pdf")).toBe("Sept_Statement_1_.pdf");
    expect(safeFileName("")).toBe("statement");
  });
});
