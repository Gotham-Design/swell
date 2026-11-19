// Fixed asset kinds, methods and the useful lives offered by default (book depreciation).
export const ASSET_KINDS = ["vehicle", "equipment", "computer", "furniture", "building", "improvement", "land", "other"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  vehicle: "Vehicle", equipment: "Machinery & equipment", computer: "Computer or phone", furniture: "Furniture & fixtures",
  building: "Building", improvement: "Property improvement", land: "Land", other: "Other",
};
/** Typical book lives in months (close to the IRS recovery periods accountants start from). */
export const DEFAULT_LIFE_MONTHS: Record<AssetKind, number | null> = {
  vehicle: 60, equipment: 84, computer: 60, furniture: 84, building: 468, improvement: 180, land: null, other: 60,
};

export const ASSET_METHODS = ["straight_line", "expense_now", "none"] as const;
export type AssetMethod = (typeof ASSET_METHODS)[number];
export const ASSET_METHOD_LABEL: Record<AssetMethod, string> = {
  straight_line: "Straight-line over its life",
  expense_now: "Expense it all now (Section 179 / bonus)",
  none: "Don't depreciate",
};

/** "5 years", "18 months", "39 years". */
export function lifeLabel(months: number | null) {
  if (!months) return "—";
  if (months % 12 === 0) return `${months / 12} year${months === 12 ? "" : "s"}`;
  return `${months} months`;
}

/** The last day of the month a date falls in (YYYY-MM-DD). */
export function monthEnd(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The last month end on or before a date: what "post through" offers by default. */
export function lastClosedMonthEnd(today: string) {
  const end = monthEnd(today);
  if (end === today) return today;
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
}
