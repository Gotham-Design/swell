// Tax section forms: shared by the dialogs and the server actions that re-check them.
import { z } from "zod";
import { tryParseCents } from "@/lib/money";
import { ASSET_KINDS, ASSET_METHODS } from "@/lib/tax/assets";
import { parseMiles } from "@/lib/tax/miles";

const date = z.iso.date("Use a valid date");
const optionalDate = z.union([z.literal(""), z.iso.date("Use a valid date")]).transform((v) => v || null);
const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters`).transform((v) => v || null);
const money = (what: string, allowZero = false) => z.string().transform((v, ctx) => {
  if (!v.trim() && allowZero) return 0;
  const c = tryParseCents(v);
  if (c === null || c < 0 || (!allowZero && c === 0)) {
    ctx.addIssue({ code: "custom", message: `Enter ${what} like 1,234.56` });
    return z.NEVER;
  }
  return c;
});

export const assetSchema = z.object({
  name: z.string().trim().min(1, "Name the asset, e.g. 2024 Ford F-150").max(120),
  kind: z.enum(ASSET_KINDS, "Pick what kind of asset it is"),
  acquired_on: date,
  in_service_on: optionalDate,
  cost: money("what it cost"),
  salvage: money("a salvage value", true),
  method: z.enum(ASSET_METHODS, "Pick how to depreciate it"),
  life_years: z.string().trim().transform((v, ctx) => {
    if (!v) return null;
    const m = /^(\d{1,2})(?:\.(5))?$/.exec(v);
    if (!m || Number(m[1]) > 50 || (Number(m[1]) === 0 && !m[2])) {
      ctx.addIssue({ code: "custom", message: "Enter years, like 5 or 7.5" });
      return z.NEVER;
    }
    return Number(m[1]) * 12 + (m[2] ? 6 : 0);
  }),
  disposed_on: optionalDate,
  notes: text(2000),
  purchase_transaction_id: z.union([z.literal(""), z.uuid()]).transform((v) => v || null),
}).superRefine((v, ctx) => {
  if (v.method === "straight_line" && !v.life_years) ctx.addIssue({ code: "custom", path: ["life_years"], message: "How many years will it last?" });
  if (v.kind === "land" && v.method !== "none") ctx.addIssue({ code: "custom", path: ["method"], message: "Land isn't depreciated" });
  if (v.salvage >= v.cost) ctx.addIssue({ code: "custom", path: ["salvage"], message: "Salvage value must be less than the cost" });
  if (v.in_service_on && v.in_service_on < v.acquired_on) ctx.addIssue({ code: "custom", path: ["in_service_on"], message: "It can't go into service before it was bought" });
});

export const TAX_ITEM_TYPES = {
  health: ["Health insurance premium", "Dental or vision premium", "HSA contribution", "Medical expense", "Other health"],
  retirement: ["SEP-IRA", "SIMPLE IRA", "401(k) employee deferral", "401(k) employer contribution", "Solo 401(k)", "Traditional or Roth IRA", "Other retirement"],
} as const;

export const taxItemSchema = z.object({
  kind: z.enum(["health", "retirement"]),
  item_type: z.string().trim().min(1, "Pick a type").max(60),
  person: text(120),
  date,
  amount: money("an amount"),
  description: z.string().trim().min(1, "Say what it was, e.g. Blue Cross premium").max(200),
  note: text(1000),
  transaction_id: z.union([z.literal(""), z.uuid()]).transform((v) => v || null),
});

export const tripSchema = z.object({
  date,
  miles: z.string().transform((v, ctx) => {
    const t = parseMiles(v);
    if (t === null) { ctx.addIssue({ code: "custom", message: "Enter miles, like 12.4" }); return z.NEVER; }
    return t;
  }),
  purpose: z.string().trim().min(1, "Say what the trip was for").max(200),
  start_place: text(200),
  end_place: text(200),
  vehicle: text(80),
  round_trip: z.literal("on").optional().transform((v) => v === "on"),
});
