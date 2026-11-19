import { describe, expect, it } from "vitest";
import { axisLabel, niceStep, niceTicks, smoothPath } from "./chart";

describe("chart helpers", () => {
  it("picks nice steps", () => {
    expect(niceStep(3400)).toBe(5000);
    expect(niceStep(240)).toBe(250);
    expect(niceStep(0.9)).toBe(1);
  });
  it("covers the max with nice ticks from zero", () => {
    expect(niceTicks(1_040_358)).toEqual([0, 500000, 1000000, 1500000]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
  it("labels axes in dollars", () => {
    expect(axisLabel(1_400_000)).toBe("14k");
    expect(axisLabel(350_000)).toBe("3.5k");
    expect(axisLabel(80_000)).toBe("800");
  });
  it("draws a path through every point", () => {
    const d = smoothPath([[0, 10], [50, 0], [100, 10]]);
    expect(d.startsWith("M0,10")).toBe(true);
    expect(d.endsWith("100,10")).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
  });
});

describe("smoothPath never overshoots", () => {
  it("keeps a flat run flat and stays within each segment's values", () => {
    const d = smoothPath([[0, 100], [50, 100], [100, 0], [150, 100], [200, 100]]);
    const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });
});
