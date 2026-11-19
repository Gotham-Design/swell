import { describe, expect, it } from "vitest";
import { formatMiles, formatRate, parseMiles } from "./miles";
import { parseMileageCsv } from "./mileage-csv";
import { lastClosedMonthEnd, lifeLabel, monthEnd } from "./assets";

describe("miles", () => {
  it("parses without floats", () => {
    expect(parseMiles("12.4")).toBe(124);
    expect(parseMiles("12")).toBe(120);
    expect(parseMiles("1,204.56 mi")).toBe(12046);
    expect(parseMiles("0.04")).toBeNull();
    expect(parseMiles("-3")).toBeNull();
    expect(parseMiles("abc")).toBeNull();
  });
  it("formats", () => {
    expect(formatMiles(124)).toBe("12.4");
    expect(formatMiles(12040)).toBe("1,204");
    expect(formatRate(725)).toBe("72.5¢");
    expect(formatRate(760)).toBe("76¢");
  });
});

describe("parseMileageCsv", () => {
  it("reads a MileIQ export and leaves personal drives out", () => {
    const csv = [
      "MileIQ export", "",
      "START_DATE*,END_DATE*,CATEGORY*,START*,STOP*,MILES*,MILES_VALUE,PARKING,TOLLS,TOTAL,VEHICLE,PURPOSE,NOTES",
      "10/02/2026 08:14,10/02/2026 08:41,Business,Office,Client HQ,14.3,$10.87,,,,F-150,Site visit,",
      "10/03/2026 17:00,10/03/2026 17:20,Personal,Office,Home,9.1,,,,,F-150,,",
    ].join("\n");
    const r = parseMileageCsv(csv);
    expect(r.personal).toBe(1);
    expect(r.trips).toEqual([{ date: "2026-10-02", miles_tenths: 143, purpose: "Site visit", start_place: "Office", end_place: "Client HQ", vehicle: "F-150" }]);
  });
  it("reads a simple sheet", () => {
    const r = parseMileageCsv("Date,Miles,Purpose\n2026-01-05,22,Bank run\n2026-01-06,x,bad row\n");
    expect(r.trips).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });
  it("says so when there is no miles column", () => {
    expect(parseMileageCsv("Date,Amount\n2026-01-01,5").error).toMatch(/Miles/);
  });
});

describe("asset dates", () => {
  it("finds month ends", () => {
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(lastClosedMonthEnd("2026-11-16")).toBe("2026-10-31");
    expect(lastClosedMonthEnd("2026-10-31")).toBe("2026-10-31");
    expect(lifeLabel(60)).toBe("5 years");
    expect(lifeLabel(18)).toBe("18 months");
  });
});
