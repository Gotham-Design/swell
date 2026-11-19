// Shape of import_batches.balance_check, computed by verify_import in SQL: the file's
// running balance checked row to row, oldest first, with the first row where it breaks.
import type { Cents } from "@/lib/money";

export interface BalanceCheck {
  checked: boolean;
  ok: boolean;
  /** 0-based data row where it first breaks, with what the balance should have been. */
  breakRow?: number;
  expected?: Cents;
  actual?: Cents;
}
