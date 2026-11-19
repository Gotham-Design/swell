// Schedule E (Form 1040) line labels for the expense_category enum.
export const EXPENSE_CATEGORIES = [
  { value: "advertising", label: "Advertising" },
  { value: "auto_travel", label: "Auto and travel" },
  { value: "cleaning_maintenance", label: "Cleaning and maintenance" },
  { value: "commissions", label: "Commissions" },
  { value: "insurance", label: "Insurance" },
  { value: "legal_professional", label: "Legal and other professional fees" },
  { value: "management_fees", label: "Management fees" },
  { value: "mortgage_interest", label: "Mortgage interest" },
  { value: "other_interest", label: "Other interest" },
  { value: "repairs", label: "Repairs" },
  { value: "supplies", label: "Supplies" },
  { value: "taxes", label: "Taxes" },
  { value: "utilities", label: "Utilities" },
  { value: "hoa", label: "HOA dues" },
  { value: "other", label: "Other" },
] as const;

export const expenseLabel = (c: string) => EXPENSE_CATEGORIES.find((x) => x.value === c)?.label ?? c;

export const KIND_LABEL: Record<string, string> = {
  rent: "Rent",
  other_income: "Other income",
  deposit_kept: "Deposit kept",
  expense: "Expense",
};
