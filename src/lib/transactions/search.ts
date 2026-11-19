// The search box: text matches description, vendor and memo; text that reads as money
// ("30.40", "$1,200", "-664.71") also matches transactions of that size.
import { tryParseCents, type Cents } from "@/lib/money";

const MONEY = /^[-+]?\$?\s*\d{1,3}(,\d{3})*(\.\d{1,2})?$|^[-+]?\$?\s*\d+(\.\d{1,2})?$/;

/** The size of the amount a search names, in cents, or null when it isn't money. */
export function searchCents(q: string): Cents | null {
  const s = q.trim();
  if (!s || !MONEY.test(s)) return null;
  const c = tryParseCents(s.replace(/^\+/, ""));
  return c === null || c === 0 ? null : Math.abs(c);
}
