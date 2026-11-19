// Schemas for categories and money accounts, shared by forms and server actions.
import { z } from "zod";
import { tryParseCents } from "@/lib/money";

export const ACCOUNT_TYPES = ["income", "expense", "asset", "liability", "equity"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const TYPE_LABEL: Record<AccountType, string> = {
  income: "Income", expense: "Expense", asset: "Asset", liability: "Liability", equity: "Equity",
};

export const MONEY_KINDS = ["checking", "savings", "credit_card", "cash", "loan"] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];
export const MONEY_KIND_LABEL: Record<MoneyKind, string> = {
  checking: "Checking", savings: "Savings", credit_card: "Credit card", cash: "Cash", loan: "Loan",
};
/** Cards and loans hold what you owe; the rest hold what you have. */
export const isOwedKind = (kind: string | null | undefined) => kind === "credit_card" || kind === "loan";

const uuidOrNone = z.union([z.literal(""), z.uuid()]).transform((v) => v || null);
const optionalDate = z.union([z.literal(""), z.iso.date("Use a valid date")]).transform((v) => v || null);
const name = z.string().trim().min(1, "Enter a name").max(100, "Keep it under 100 characters");
const description = z.string().trim().max(500, "Keep it under 500 characters").transform((v) => v || null);
/** A tax_lines id for the business's form; blank clears the mapping. */
const taxLine = z.string().max(40).optional().transform((v) => v || null);

export const categoryCreateSchema = z.object({
  name,
  type: z.enum(ACCOUNT_TYPES, "Pick a type"),
  parent_id: uuidOrNone,
  description,
  tax_line_id: taxLine,
});

export const categoryEditSchema = z.object({ name, parent_id: uuidOrNone, description, tax_line_id: taxLine });

export const mergeSchema = z.object({ into: z.uuid("Pick a category to merge into") });

/** Blank means zero; otherwise anything parseCents accepts ("$1,234.56", "(45)"). */
const amount = z.string().transform((v, ctx) => {
  if (!v.trim()) return 0;
  const cents = tryParseCents(v);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Enter an amount like 1,234.56" });
    return z.NEVER;
  }
  return cents;
});

const last4 = z.union([z.literal(""), z.string().trim().regex(/^\d{4}$/, "Use the last 4 digits")]).transform((v) => v || null);

export const moneyAccountCreateSchema = z.object({
  name,
  kind: z.enum(MONEY_KINDS, "Pick an account type"),
  last4,
  opening_balance: amount,
  opening_date: optionalDate,
}).refine((v) => v.opening_balance === 0 || v.opening_date, {
  message: "Pick the date of the opening balance", path: ["opening_date"],
});

export const moneyAccountEditSchema = z.object({
  name,
  last4,
  opening_balance: amount,
  opening_date: optionalDate,
}).refine((v) => v.opening_balance === 0 || v.opening_date, {
  message: "Pick the date of the opening balance", path: ["opening_date"],
});
