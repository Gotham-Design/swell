// Date formats banks use, detection over a column of values, and parsing to YYYY-MM-DD.

export const DATE_FORMATS = [
  "MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YY", "DD/MM/YY", "DD.MM.YYYY", "YYYY/MM/DD", "DD-MMM-YYYY", "MMM D, YYYY",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const DATE_FORMAT_EXAMPLE: Record<DateFormat, string> = {
  "MM/DD/YYYY": "10/31/2026", "DD/MM/YYYY": "31/10/2026", "YYYY-MM-DD": "2026-10-31", "MM/DD/YY": "10/31/26",
  "DD/MM/YY": "31/10/26", "DD.MM.YYYY": "31.10.2026", "YYYY/MM/DD": "2026/10/31", "DD-MMM-YYYY": "31-Oct-2026",
  "MMM D, YYYY": "Oct 31, 2026",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const year = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

/** Parse one cell in a format; null if it doesn't fit or isn't a real date. A trailing time is ignored. */
export function parseDate(value: string, format: DateFormat): string | null {
  const v = value.trim().replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*([AaPp][Mm])?(Z|[+-]\d{2}:?\d{2})?$/, "");
  let m: RegExpMatchArray | null;
  switch (format) {
    case "MM/DD/YYYY": return (m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)) ? iso(+m[3], +m[1], +m[2]) : null;
    case "DD/MM/YYYY": return (m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)) ? iso(+m[3], +m[2], +m[1]) : null;
    case "MM/DD/YY": return (m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)) ? iso(year(m[3]), +m[1], +m[2]) : null;
    case "DD/MM/YY": return (m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)) ? iso(year(m[3]), +m[2], +m[1]) : null;
    case "YYYY-MM-DD": return (m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)) ? iso(+m[1], +m[2], +m[3]) : null;
    case "YYYY/MM/DD": return (m = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)) ? iso(+m[1], +m[2], +m[3]) : null;
    case "DD.MM.YYYY": return (m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)) ? iso(+m[3], +m[2], +m[1]) : null;
    case "DD-MMM-YYYY": {
      m = v.match(/^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ](\d{2,4})$/);
      const mon = m ? MONTHS.indexOf(m[2].toLowerCase()) + 1 : 0;
      return m && mon ? iso(year(m[3]), mon, +m[1]) : null;
    }
    case "MMM D, YYYY": {
      m = v.match(/^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4})$/);
      const mon = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
      return m && mon ? iso(+m[3], mon, +m[2]) : null;
    }
  }
}

export interface DateDetection {
  format: DateFormat | null;
  /** Every value fits both month-first and day-first (no part is over 12). */
  ambiguous: boolean;
  /** Every format that fits all the values. */
  candidates: DateFormat[];
}

/**
 * The format that fits the most values (a stray bad cell shouldn't block detection;
 * verification flags it). Month-first wins a tie with day-first, flagged as ambiguous.
 * No format if none fits a majority.
 */
export function detectDateFormat(values: string[]): DateDetection {
  const sample = values.map((v) => v.trim()).filter(Boolean).slice(0, 500);
  if (!sample.length) return { format: null, ambiguous: false, candidates: [] };
  const fits = DATE_FORMATS.map((f) => [f, sample.filter((v) => parseDate(v, f) !== null).length] as const);
  const best = Math.max(...fits.map(([, n]) => n));
  if (best * 2 <= sample.length) return { format: null, ambiguous: false, candidates: [] };
  const candidates = fits.filter(([, n]) => n === best).map(([f]) => f);
  const pairs: [DateFormat, DateFormat][] = [["MM/DD/YYYY", "DD/MM/YYYY"], ["MM/DD/YY", "DD/MM/YY"]];
  const ambiguous = pairs.some(([a, b]) => candidates.includes(a) && candidates.includes(b));
  return { format: candidates[0], ambiguous, candidates };
}
