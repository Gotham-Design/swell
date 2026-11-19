import { describe, expect, it } from "vitest";
import { pct, txnStatus } from "./status";
import { searchCents } from "./search";

describe("status", () => {
  it("follows the 85% line", () => {
    expect(txnStatus(null, 0.85)).toBe("suggested");
    expect(txnStatus(null, 0.849)).toBe("review");
    expect(txnStatus(null, null)).toBe("review");
    expect(txnStatus("cat", 0.2)).toBe("categorized");
  });
  it("never shows 85% for something under the line", () => {
    expect(pct(0.849)).toBe("84%");
    expect(pct(0.97)).toBe("97%");
  });
});

describe("money search", () => {
  it("reads amounts as cents, any sign or format", () => {
    expect(searchCents("30.40")).toBe(3040);
    expect(searchCents("$1,200")).toBe(120000);
    expect(searchCents("-664.71")).toBe(66471);
    expect(searchCents("1007")).toBe(100700);
  });
  it("leaves words and odd numbers to the text search", () => {
    expect(searchCents("amazon")).toBeNull();
    expect(searchCents("inv-2009")).toBeNull();
    expect(searchCents("1.234")).toBeNull();
    expect(searchCents("0")).toBeNull();
    expect(searchCents("")).toBeNull();
  });
});
