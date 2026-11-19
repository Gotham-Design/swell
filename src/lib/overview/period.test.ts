import { describe, expect, it } from "vitest";
import { periodHref, rangeName, resolveOverviewPeriod } from "./period";

const T = "2026-10-23";
const p = (params: Record<string, string>, fy = 1) => resolveOverviewPeriod({ cmp: "prev", ...params }, T, fy);

describe("overview periods", () => {
  it.each([
    [{}, "2026-10-01", "2026-10-31", "Oct 2026", "September 2026"],
    [{ period: "last_month" }, "2026-09-01", "2026-09-30", "Sep 2026", "August 2026"],
    [{ period: "last_30" }, "2026-09-24", "2026-10-23", "Last 30 days", "Aug 25, 2026 – Sep 23, 2026"],
    [{ period: "this_quarter" }, "2026-10-01", "2026-12-31", "Q4 2026", "Q3 2026"],
    [{ period: "last_quarter" }, "2026-07-01", "2026-09-30", "Q3 2026", "Q2 2026"],
    [{ period: "ytd" }, "2026-01-01", "2026-10-23", "Year to date", "Jan 1, 2025 – Oct 23, 2025"],
    [{ period: "last_12" }, "2025-11-01", "2026-10-31", "Last 12 months", "Nov 1, 2024 – Oct 31, 2025"],
    [{ period: "last_year" }, "2025-01-01", "2025-12-31", "2025", "2024"],
    [{ month: "2026-07" }, "2026-07-01", "2026-07-31", "Jul 2026", "June 2026"],
  ])("%j", (params, from, to, short, cmpName) => {
    const r = p(params);
    expect([r.from, r.to, r.short, r.cmp?.name]).toEqual([from, to, short, cmpName]);
  });

  it("same period last year", () => {
    const r = p({ period: "2026-09", cmp: "yoy" });
    expect(r.cmp).toEqual({ from: "2025-09-01", to: "2025-09-30", name: "September 2025" });
    expect(p({ cmp: "none" }).cmp).toBeNull();
    expect(resolveOverviewPeriod({}, T).cmp).toBeNull(); // no comparison unless asked
  });
  it("a fiscal year starting in July", () => {
    expect(p({ period: "ytd" }, 7)).toMatchObject({ from: "2026-07-01", to: "2026-10-23" });
    expect(p({ period: "last_year" }, 7)).toMatchObject({ from: "2025-07-01", to: "2026-06-30", short: "Last year" });
  });
  it("ignores anything else and charts at least 7 months", () => {
    expect(p({ period: "bogus" }).key).toBe("this_month");
    expect(p({}).chartMonths).toBe(7);
    expect(p({ period: "last_12" }).chartMonths).toBe(12);
  });
  it("names and links", () => {
    expect(rangeName({ from: "2026-01-01", to: "2026-12-31" })).toBe("2026");
    expect(periodHref("/b/x", { key: "this_month", compare: "none" })).toBe("/b/x");
    expect(periodHref("/b/x", { key: "last_30", compare: "yoy" }, { recent: "in" })).toBe("/b/x?period=last_30&cmp=yoy&recent=in");
  });
});
