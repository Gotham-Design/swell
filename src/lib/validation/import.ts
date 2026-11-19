// A column mapping sent from the browser, checked before it's saved as a template.
import { z } from "zod";
import { DATE_FORMATS } from "@/lib/import/dates";

const column = z.number().int().min(0).max(500).nullable();

export const mappingSchema = z.object({
  date: column,
  dateFormat: z.enum(DATE_FORMATS).nullable(),
  amountMode: z.enum(["signed", "split"]),
  amount: column,
  debit: column,
  credit: column,
  signConvention: z.enum(["positive_in", "positive_out"]),
  description: column,
  description2: column,
  category: column,
  reference: column,
  memo: column,
  balance: column,
}).strict();

export const templateSchema = z.object({
  money_account_id: z.uuid(),
  header_signature: z.string().min(1).max(4000),
  mapping: mappingSchema,
});
