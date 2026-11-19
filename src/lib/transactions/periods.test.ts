import { describe, expect, it } from "vitest";
import { periodLabel, previousRange } from "./filters";

describe("previousRange", () => {
  it("steps back whole months", () => {
    expect(previousRange("2026-10-01", "2026-10-31")).toEqual({ from: "2026-09-01", to: "2026-09-30", months: 1 });
    expect(previousRange("2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28", months: 1 });
    expect(previousRange("2026-07-01", "2026-09-30")).toEqual({ from: "2026-04-01", to: "2026-06-30", months: 3 });
    expect(previousRange("2026-01-01", "2026-01-31")).toEqual({ from: "2025-12-01", to: "2025-12-31", months: 1 });
  });
  it("steps back by length for other ranges", () => {
    expect(previousRange("2026-10-05", "2026-10-11")).toEqual({ from: "2026-09-28", to: "2026-10-04", months: null });
  });
});

describe("periodLabel", () => {
  it("names a single month", () => {
    expect(periodLabel("2026-10-01", "2026-10-31")).toBe("October 2026");
    expect(periodLabel(null, null)).toBe("All dates");
    expect(periodLabel("2026-10-05", "2026-10-11")).toBe("Oct 5, 2026 – Oct 11, 2026");
  });
});
