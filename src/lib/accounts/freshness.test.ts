import { describe, expect, it } from "vitest";
import { accountFreshness, behind } from "./freshness";

const now = Date.parse("2026-11-16T15:00:00Z");

describe("accountFreshness", () => {
  it("leads with how far the statement goes, then when it was imported", () => {
    expect(accountFreshness({ at: "2026-11-03T09:00:00Z", statementDate: "2026-10-31" }, now))
      .toEqual({ label: "Through Oct 31 · imported Nov 3", stale: false });
  });
  it("is behind when the statement trails today, even if imported today", () => {
    expect(accountFreshness({ at: "2026-11-16T09:00:00Z", statementDate: "2026-09-30" }, now))
      .toEqual({ label: "Through Sep 30 · 6 weeks behind", stale: true });
  });
  it("shows the year for an older statement", () => {
    expect(accountFreshness({ at: "2026-11-16T09:00:00Z", statementDate: "2025-12-31" }, now).label)
      .toBe("Through Dec 31, 2025 · 10 months behind");
  });
  it("falls back to the import date without a statement date", () => {
    expect(accountFreshness({ at: "2026-11-10T09:00:00Z", statementDate: null }, now))
      .toEqual({ label: "Imported Nov 10", stale: false });
  });
  it("is stale when nothing was ever imported", () => {
    expect(accountFreshness(undefined, now).stale).toBe(true);
  });
});

describe("behind", () => {
  it("picks a natural unit", () => {
    expect(behind(1)).toBe("1 day");
    expect(behind(13)).toBe("13 days");
    expect(behind(22)).toBe("3 weeks");
    expect(behind(95)).toBe("3 months");
  });
});
