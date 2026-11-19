// The add/edit transaction form. Shared by the drawer (validates before sending) and the
// server action (validates again; the client is never trusted).
import { z } from "zod";
import { tryParseCents } from "@/lib/money";

export const MODES = ["out", "in", "transfer"] as const;
export type Mode = (typeof MODES)[number];
export const MODE_LABEL: Record<Mode, string> = { out: "Money out", in: "Money in", transfer: "Transfer" };

// Fields a mode doesn't show (no "To" for money out) are simply absent from the form.
const optionalText = (max: number) =>
  z.string().trim().max(max, `Keep it under ${max} characters`).optional().transform((v) => v || null);
const uuidOrNone = z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || null);

export const transactionSchema = z.object({
  mode: z.enum(MODES, "Pick money in, money out or transfer"),
  date: z.iso.date("Pick a date"),
  money_account_id: z.uuid("Pick an account"),
  to_account_id: uuidOrNone,
  amount: z.string().transform((v, ctx) => {
    const cents = tryParseCents(v);
    if (cents === null || cents === 0) {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 45.99" });
      return z.NEVER;
    }
    if (cents < 0) {
      ctx.addIssue({ code: "custom", message: "Enter the amount without a minus sign; pick money in or out instead" });
      return z.NEVER;
    }
    return cents;
  }),
  description: z.string().trim().min(1, "Describe the transaction").max(500, "Keep it under 500 characters"),
  category_account_id: uuidOrNone,
  memo: optionalText(1000),
  reference: optionalText(100),
}).superRefine((v, ctx) => {
  if (v.mode !== "transfer") return;
  if (!v.to_account_id) ctx.addIssue({ code: "custom", path: ["to_account_id"], message: "Pick the account the money went to" });
  else if (v.to_account_id === v.money_account_id) ctx.addIssue({ code: "custom", path: ["to_account_id"], message: "Pick a different account" });
});
export type TransactionInput = z.output<typeof transactionSchema>;

/**
 * What the posting functions take. A transfer is one transaction on the "from" account,
 * categorized to the "to" money account, so it never touches income or expense.
 */
export function toPosting(v: TransactionInput) {
  if (v.mode === "transfer") {
    return {
      date: v.date, money_account_id: v.money_account_id, amount_cents: -v.amount,
      category_account_id: v.to_account_id, description_raw: v.description, memo: v.memo, reference: v.reference,
    };
  }
  return {
    date: v.date, money_account_id: v.money_account_id, amount_cents: v.mode === "in" ? v.amount : -v.amount,
    category_account_id: v.category_account_id, description_raw: v.description, memo: v.memo, reference: v.reference,
  };
}

/** The form's starting values for an existing transaction (reverse of toPosting). */
export function fromPosting(t: {
  date: string; money_account_id: string; amount_cents: number; category_account_id: string | null;
  description_raw: string; memo: string | null; reference: string | null;
}, moneyAccountIds: Set<string>) {
  const isTransfer = !!t.category_account_id && moneyAccountIds.has(t.category_account_id);
  const abs = Math.abs(t.amount_cents);
  if (isTransfer) {
    // Show it as "from -> to" whichever side the row was posted on.
    const out = t.amount_cents < 0;
    return {
      mode: "transfer" as Mode, date: t.date, amount_cents: abs, description: t.description_raw,
      money_account_id: out ? t.money_account_id : t.category_account_id!,
      to_account_id: out ? t.category_account_id! : t.money_account_id,
      category_account_id: null, memo: t.memo ?? "", reference: t.reference ?? "",
    };
  }
  return {
    mode: (t.amount_cents > 0 ? "in" : "out") as Mode, date: t.date, amount_cents: abs, description: t.description_raw,
    money_account_id: t.money_account_id, to_account_id: null, category_account_id: t.category_account_id,
    memo: t.memo ?? "", reference: t.reference ?? "",
  };
}
