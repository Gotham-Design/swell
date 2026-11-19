import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { spokenCents } from "@/lib/money";

describe("export csv", () => {
  it("quotes, defuses text columns only, flattens arrays and objects", () => {
    expect(toCsv(["name", "amount", "tags", "after"], [
      ["=SUM(A1)", "-45.00", ["a", "b"], { x: 1 }],
      ["Acme, Inc.", null, [], null],
      [" padded", "12.00", undefined, "quote \"q\""],
    ], new Set(["name"]))).toBe([
      "name,amount,tags,after",
      "'=SUM(A1),-45.00,a; b,\"{\"\"x\"\":1}\"",
      "\"Acme, Inc.\",,,",
      "\" padded\",12.00,,\"quote \"\"q\"\"\"",
      "",
    ].join("\r\n"));
  });
});

describe("spoken amounts", () => {
  it("reads cents the way a screen reader should", () => {
    expect(spokenCents(-4500)).toBe("minus 45 dollars");
    expect(spokenCents(123456)).toBe("1,234 dollars and 56 cents");
    expect(spokenCents(1)).toBe("1 cent");
    expect(spokenCents(100)).toBe("1 dollar");
    expect(spokenCents(0)).toBe("0 dollars");
    expect(spokenCents(-4550)).toBe("minus 45 dollars and 50 cents");
  });
});
