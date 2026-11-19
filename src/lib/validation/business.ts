// Form schemas shared by the client forms and the server actions that re-check them.
import { z } from "zod";
import { tryParseCents } from "@/lib/money";

export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "MXN"] as const;
export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const TAX_FORMS = ["schedule_c", "form_1120s"] as const;
export type TaxForm = (typeof TAX_FORMS)[number];
export const TAX_FORM_LABEL: Record<TaxForm, string> = {
  schedule_c: "Schedule C (sole proprietor or single-member LLC)",
  form_1120s: "Form 1120-S (S corporation)",
};
export const TAX_FORM_SHORT: Record<TaxForm, string> = { schedule_c: "Schedule C", form_1120s: "Form 1120-S" };

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

// "" from an empty <input type="date"> means "not set".
const optionalDate = z.union([z.literal(""), z.iso.date("Use a valid date")]).transform((v) => v || null);

export const businessSchema = z.object({
  name: z.string().trim().min(1, "Enter a business name").max(200, "Keep it under 200 characters"),
  legal_name: z.string().trim().max(200, "Keep it under 200 characters").transform((v) => v || null),
  currency: z.enum(CURRENCIES, "Pick a currency"),
  fiscal_year_start_month: z.coerce.number().int().min(1, "Pick a month").max(12, "Pick a month"),
  books_start_date: optionalDate,
  tax_form: z.union([z.literal(""), z.enum(TAX_FORMS)]).optional().transform((v) => v || null),
});
export type BusinessInput = z.output<typeof businessSchema>;

export const INDUSTRIES = [
  "food_beverage", "retail", "professional_services", "construction_trades", "health_wellness",
  "creative_media", "real_estate", "transportation", "nonprofit", "other",
] as const;
export type Industry = (typeof INDUSTRIES)[number];
export const INDUSTRY_LABEL: Record<Industry, string> = {
  food_beverage: "Food & beverage", retail: "Retail", professional_services: "Professional services",
  construction_trades: "Construction, trades & landscaping", health_wellness: "Health & wellness", creative_media: "Creative & media",
  real_estate: "Real estate", transportation: "Transportation", nonprofit: "Nonprofit", other: "Something else",
};
const industry = z.union([z.literal(""), z.enum(INDUSTRIES)]).optional().transform((v) => v || null);

/** The settings page's one "Save changes" form: business details and books. */
export const settingsSchema = z.object({
  name: z.string().trim().min(1, "Enter a business name").max(200, "Keep it under 200 characters"),
  legal_name: z.string().trim().max(200, "Keep it under 200 characters").transform((v) => v || null),
  industry,
  fiscal_year_start_month: z.coerce.number().int().min(1, "Pick a month").max(12, "Pick a month"),
  lock_date: optionalDate,
  ai_enabled: z.enum(["on", "off"]).transform((v) => v === "on"),
});

/** "Add a client business": the business, its industry, and the account statements come from. */
export const newBusinessSchema = z.object({
  name: z.string().trim().min(1, "Enter a business name").max(200, "Keep it under 200 characters"),
  industry,
  fiscal_year_start_month: z.coerce.number().int().min(1, "Pick a month").max(12, "Pick a month"),
  account_name: z.string().trim().min(1, "Name the account, e.g. Chase Business Checking").max(100, "Keep it under 100 characters"),
  account_kind: z.enum(["checking", "savings", "credit_card", "cash"], "Pick an account type"),
});

export const lockDateSchema = z.object({ lock_date: optionalDate });

// Flag any outflow over this as large ("" = no threshold). Typed as dollars, stored as cents.
export const largeThresholdSchema = z.object({
  large_threshold: z.string().trim().max(20).transform((v, ctx) => {
    if (!v) return null;
    const cents = tryParseCents(v);
    if (cents === null || cents <= 0) {
      ctx.addIssue({ code: "custom", message: "Enter an amount over $0, or leave it blank" });
      return z.NEVER;
    }
    return cents;
  }),
});

export const AI_MODEL_CHOICES = ["", "claude-haiku-5-5", "claude-sonnet-5-5"] as const;
export const AI_MODEL_LABEL: Record<(typeof AI_MODEL_CHOICES)[number], string> = {
  "": "Default (Claude Haiku 5.5)", "claude-haiku-5-5": "Claude Haiku 5.5 (faster, cheaper)", "claude-sonnet-5-5": "Claude Sonnet 5.5 (more careful)",
};
export const aiSettingsSchema = z.object({
  ai_model: z.enum(AI_MODEL_CHOICES, "Pick a model").transform((v) => v || null),
  ai_auto_apply: z.literal("on").optional().transform((v) => v === "on"),
  ai_share_memos: z.literal("on").optional().transform((v) => v === "on"),
  ai_monthly_token_budget: z.string().trim().transform((v) => v.replace(/[,_\s]/g, ""))
    .pipe(z.string().regex(/^\d{1,10}$/, "Enter a whole number of tokens"))
    .transform(Number).pipe(z.number().int().min(10_000, "At least 10,000 tokens").max(1_000_000_000, "At most 1,000,000,000 tokens")),
});

export const aiSchema = z.object({ ai_enabled: z.enum(["on", "off"]).transform((v) => v === "on") });


export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter an email address")),
});

/** Result returned by every form action: field errors, a form error, or success. */
export interface FormState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export function parseForm<T extends z.ZodType>(schema: T, formData: FormData):
  { data: z.output<T>; state?: undefined } | { data?: undefined; state: FormState } {
  const result = schema.safeParse(Object.fromEntries(formData));
  if (result.success) return { data: result.data };
  return { state: { fieldErrors: z.flattenError(result.error).fieldErrors as FormState["fieldErrors"] } };
}
