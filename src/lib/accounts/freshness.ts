/** Days a statement's last date can trail today before the account reads as behind (amber). */
export const STALE_COVERAGE_DAYS = 40;
/** Without a statement date, days since the last import before it reads as stale. */
export const STALE_IMPORT_DAYS = 21;

const DAY = 86_400_000;
const short = (iso: string, now: number) => {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  const sameYear = d.getUTCFullYear() === new Date(now).getUTCFullYear();
  return d.toLocaleDateString("en-US", sameYear
    ? { month: "short", day: "numeric", timeZone: "UTC" }
    : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

/** "3 days", "3 weeks", "2 months": how far behind, in the coarsest unit that reads naturally. */
export function behind(days: number) {
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  return `${Math.floor(days / 30)} months`;
}

/**
 * The line under an account: how far the books go (the statement's last date), then when it was
 * imported. "Through Oct 31 · imported Nov 3", or amber "Through Sep 30 · 7 weeks behind" once the
 * statements trail today by more than 40 days. A statement imported today can still be behind.
 */
export function accountFreshness(last: { at: string; statementDate: string | null } | undefined, now = Date.now()) {
  if (!last) return { label: "No statements imported yet", stale: true };
  if (!last.statementDate) {
    const days = Math.floor((now - new Date(last.at).getTime()) / DAY);
    return days > STALE_IMPORT_DAYS
      ? { label: `Last import ${short(last.at, now)} · ${behind(days)} ago`, stale: true }
      : { label: `Imported ${short(last.at, now)}`, stale: false };
  }
  const gap = Math.floor((now - new Date(`${last.statementDate}T00:00:00Z`).getTime()) / DAY);
  const through = `Through ${short(last.statementDate, now)}`;
  if (gap > STALE_COVERAGE_DAYS) return { label: `${through} · ${behind(gap)} behind`, stale: true };
  return { label: `${through} · imported ${short(last.at, now)}`, stale: false };
}
