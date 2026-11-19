import { describe, expect, it } from "vitest";
import { monthCovered, nextDay, planRun, previousMonth } from "./schedule";

const base = { day_of_month: 5, next_send_on: "2026-11-05", period_month: null, sends_in_period: 0 };

describe("planRun", () => {
  it("waits until the day comes", () => {
    expect(planRun(base, "2026-11-04", () => false)).toBeNull();
  });
  it("asks for last month, then reminds a week later", () => {
    expect(planRun(base, "2026-11-05", () => false)).toEqual({
      send: true, period: "2026-10-01", next_send_on: "2026-11-12", period_month: "2026-10-01", sends_in_period: 1,
    });
  });
  it("keeps chasing the same month in reminders, three emails at most", () => {
    const second = planRun({ ...base, next_send_on: "2026-11-12", period_month: "2026-10-01", sends_in_period: 1 }, "2026-11-12", () => false)!;
    expect(second).toMatchObject({ send: true, period: "2026-10-01", next_send_on: "2026-11-19", sends_in_period: 2 });
    const third = planRun({ ...base, next_send_on: "2026-11-19", period_month: "2026-10-01", sends_in_period: 2 }, "2026-11-19", () => false)!;
    expect(third).toMatchObject({ send: true, period: "2026-10-01", next_send_on: "2026-12-05", sends_in_period: 0 });
  });
  it("sends nothing once the statements are in, and waits for next month", () => {
    expect(planRun({ ...base, next_send_on: "2026-11-12", period_month: "2026-10-01", sends_in_period: 1 }, "2026-11-12", (p) => p === "2026-10-01"))
      .toEqual({ send: false, period: "2026-10-01", next_send_on: "2026-12-05", period_month: "2026-10-01", sends_in_period: 0 });
  });
  it("after a long gap, asks for the latest month, not an old one", () => {
    expect(planRun({ ...base, next_send_on: "2026-06-05", period_month: "2026-05-01", sends_in_period: 1 }, "2026-11-16", () => false))
      .toMatchObject({ period: "2026-10-01" });
  });
});

describe("helpers", () => {
  it("finds the next day of the month", () => {
    expect(nextDay(5, "2026-11-05")).toBe("2026-11-05");
    expect(nextDay(5, "2026-11-06")).toBe("2026-12-05");
    expect(nextDay(28, "2026-12-29")).toBe("2027-01-28");
  });
  it("knows last month across a year", () => {
    expect(previousMonth("2027-01-05")).toBe("2026-12-01");
  });
  it("counts a month covered once every account's statement reaches its last two weeks", () => {
    expect(monthCovered("2026-10-01", ["2026-10-31", "2026-10-20"])).toBe(true);
    expect(monthCovered("2026-10-01", ["2026-10-31", "2026-09-30"])).toBe(false);
    expect(monthCovered("2026-10-01", ["2026-10-31", null])).toBe(false);
    expect(monthCovered("2026-10-01", [])).toBe(false);
  });
});
