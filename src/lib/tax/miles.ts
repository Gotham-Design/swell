// Miles are stored in tenths (12.4 mi = 124), parsed from text without floats.

/** "12.4", "12", "1,204.5 mi" -> tenths of a mile, or null. Rounds to the nearest tenth. */
export function parseMiles(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, "").replace(/\s*(mi|miles?)$/, "");
  const m = /^(\d{1,6})(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] ?? "0";
  const tenth = Number(frac[0]);
  const roundUp = frac.length > 1 && Number(frac[1]) >= 5;
  const tenths = whole * 10 + tenth + (roundUp ? 1 : 0);
  return tenths > 0 && tenths <= 100000 ? tenths : null;
}

/** 124 -> "12.4", 120 -> "12". */
export function formatMiles(tenths: number) {
  const whole = Math.floor(tenths / 10);
  const t = tenths % 10;
  const w = whole.toLocaleString("en-US");
  return t ? `${w}.${t}` : w;
}

/** Tenths of a cent per mile -> "72.5¢". */
export function formatRate(tenthCents: number) {
  return `${Math.floor(tenthCents / 10)}${tenthCents % 10 ? `.${tenthCents % 10}` : ""}¢`;
}
