// Recurring statement requests: when the next email goes and which month it asks for. Pure:
// pass today and whether the month's statements are already in.

export const MAX_SENDS_PER_MONTH = 3; // the request, then two weekly reminders

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];

/** First day of the month before `iso`'s month. */
export function previousMonth(iso: string) {
  const [y, m] = parts(iso);
  return ymd(y, m - 1, 1);
}
/** Last day of the month that starts on `monthStart`. */
export function monthLast(monthStart: string) {
  const [y, m] = parts(monthStart);
  return ymd(y, m + 1, 0);
}
/** The first `day` of a month on or after `from` (day 1–28). */
export function nextDay(day: number, from: string) {
  const [y, m, d] = parts(from);
  return d <= day ? ymd(y, m, day) : ymd(y, m + 1, day);
}
export function addDaysIso(iso: string, n: number) {
  const [y, m, d] = parts(iso);
  return ymd(y, m, d + n);
}
/** "September 2026". */
export function monthLabel(monthStart: string) {
  const [y, m] = parts(monthStart);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Statements are "in" for a month once each account's latest imported statement reaches the
 * month's last two weeks (card cycles rarely close on the 31st).
 */
export function monthCovered(monthStart: string, lastStatementDates: (string | null)[]) {
  if (!lastStatementDates.length) return false;
  const cutoff = addDaysIso(monthLast(monthStart), -15);
  return lastStatementDates.every((d) => d !== null && d >= cutoff);
}

export interface ScheduleState {
  day_of_month: number;
  next_send_on: string;
  period_month: string | null;
  sends_in_period: number;
}
export interface Plan {
  send: boolean;
  /** The statement month this run is about. */
  period: string;
  next_send_on: string;
  period_month: string;
  sends_in_period: number;
}

/**
 * What a due schedule does today. A first email asks for last month; reminders go weekly
 * (at most 3 emails a month) until the statements arrive; then it waits for next month's day.
 * `done` = the month's statements are in, or the client already sent files for this request.
 */
export function planRun(s: ScheduleState, today: string, done: (period: string) => boolean): Plan | null {
  if (s.next_send_on > today) return null;
  // A reminder chases the month already asked for (if it's still recent).
  const reminder = s.sends_in_period > 0 && s.period_month !== null && s.period_month >= previousMonth(addDaysIso(today, -31));
  const period = reminder ? s.period_month! : previousMonth(today);
  const regularNext = nextDay(s.day_of_month, addDaysIso(monthLast(addDaysIso(monthLast(period), 1)), 1));
  if (done(period)) {
    return { send: false, period, next_send_on: regularNext, period_month: period, sends_in_period: 0 };
  }
  const sends = (reminder ? s.sends_in_period : 0) + 1;
  if (sends >= MAX_SENDS_PER_MONTH) {
    return { send: true, period, next_send_on: regularNext, period_month: period, sends_in_period: 0 };
  }
  return { send: true, period, next_send_on: addDaysIso(today, 7), period_month: period, sends_in_period: sends };
}
