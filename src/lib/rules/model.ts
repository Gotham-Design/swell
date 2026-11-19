// Rules as the app shows and edits them: fields, operators, values, validation and the
// plain-words summary. Matching itself runs in Postgres (private.match_rules), so the
// import commit, previews and the AI exclusion all use one engine; this module only
// describes and checks rules. Validation mirrors private.validate_rule_condition so
// mistakes show up while typing, before the database refuses them.
import { formatCents, type Cents } from "@/lib/money";

export const FIELDS = [
  "description_clean", "description_raw", "vendor_normalized", "amount", "direction", "money_account_id", "date", "source",
] as const;
export type Field = (typeof FIELDS)[number];
export const FIELD_LABEL: Record<Field, string> = {
  description_clean: "Description", description_raw: "Bank description", vendor_normalized: "Vendor",
  amount: "Amount", direction: "Direction", money_account_id: "Account", date: "Date", source: "Source",
};

export const OPERATORS = [
  "contains", "not_contains", "equals", "starts_with", "ends_with", "regex", "gt", "gte", "lt", "lte", "between", "in",
] as const;
export type Operator = (typeof OPERATORS)[number];

const TEXT_OPS: Operator[] = ["contains", "not_contains", "equals", "starts_with", "ends_with", "regex", "in"];
export const OPERATORS_FOR: Record<Field, Operator[]> = {
  description_clean: TEXT_OPS, description_raw: TEXT_OPS, vendor_normalized: TEXT_OPS,
  amount: ["lt", "lte", "gt", "gte", "equals", "between", "in"],
  direction: ["equals"],
  money_account_id: ["equals", "in"],
  date: ["equals", "lt", "lte", "gt", "gte", "between"],
  source: ["equals", "in"],
};
/** Operator wording per kind of field, as people say it. */
export function operatorLabel(field: Field, op: Operator): string {
  if (field === "amount") {
    return { lt: "under", lte: "at most", gt: "over", gte: "at least", equals: "exactly", between: "between", in: "one of" }[op as "lt"] ?? op;
  }
  if (field === "date") {
    return { lt: "before", lte: "on or before", gt: "after", gte: "on or after", equals: "on", between: "between" }[op as "lt"] ?? op;
  }
  if (field === "direction" || field === "money_account_id" || field === "source") {
    return op === "in" ? "is one of" : "is";
  }
  return {
    contains: "contains", not_contains: "doesn't contain", equals: "is", starts_with: "starts with",
    ends_with: "ends with", regex: "matches pattern", in: "is one of",
  }[op as "contains"] ?? op;
}

export const ACTIONS = ["set_category", "mark_transfer_to_account", "set_memo", "append_memo", "skip_ai"] as const;
export type ActionKind = (typeof ACTIONS)[number];
export const ACTION_LABEL: Record<ActionKind, string> = {
  set_category: "Set category", mark_transfer_to_account: "Mark as transfer to", set_memo: "Set memo",
  append_memo: "Add to memo", skip_ai: "Don't suggest a category",
};

export type ConditionValue = string | number | (string | number)[];
export interface Condition { field: Field; operator: Operator; value: ConditionValue; case_sensitive?: boolean }
export interface Action { action: ActionKind; account_id?: string | null; value?: { text?: string } }
export interface RuleDraft {
  id?: string;
  name: string;
  match_mode: "all" | "any";
  stop_processing: boolean;
  enabled: boolean;
  priority?: number;
  origin?: "user" | "apply_similar";
  conditions: Condition[];
  actions: Action[];
}

export const EMPTY_RULE: RuleDraft = {
  name: "", match_mode: "all", stop_processing: true, enabled: true,
  conditions: [{ field: "description_clean", operator: "contains", value: "" }],
  actions: [{ action: "set_category", account_id: null }],
};

/** A sensible empty value when the field or operator changes. */
export function defaultValue(field: Field, op: Operator): ConditionValue {
  if (op === "between") return field === "date" ? ["", ""] : [0, 0];
  if (op === "in") return [];
  if (field === "amount") return 0;
  if (field === "direction") return "out";
  if (field === "source") return "import";
  return "";
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Regexes that can backtrack badly (nested repeats, backreferences) are refused. */
export function regexProblem(pattern: string): string | null {
  if (pattern.length > 200) return "Keep patterns under 200 characters.";
  if (/\\[1-9]/.test(pattern) || /\([^)]*[+*}][^)]*\)\s*[+*{]/.test(pattern)) {
    return "That pattern could be very slow (nested repeats or backreferences); simplify it.";
  }
  try {
    new RegExp(pattern, "i");
  } catch {
    return "That pattern is not a valid regular expression.";
  }
  return null;
}

/** The problem with a condition, or null. Amount values are cents. */
export function conditionProblem(c: Condition): string | null {
  if (!OPERATORS_FOR[c.field]?.includes(c.operator)) return `${FIELD_LABEL[c.field]} can't use "${operatorLabel(c.field, c.operator)}".`;
  const list = Array.isArray(c.value) ? c.value : [c.value];
  if (c.operator === "in" && (!Array.isArray(c.value) || c.value.length === 0)) return "Give at least one value.";
  if (c.operator === "between" && (!Array.isArray(c.value) || c.value.length !== 2)) return "Give a from and a to value.";
  switch (c.field) {
    case "description_clean": case "description_raw": case "vendor_normalized":
      if (list.some((v) => typeof v !== "string" || !v.trim())) return "Enter some text to match.";
      if (c.operator === "regex") return regexProblem(String(c.value));
      return null;
    case "amount":
      if (list.some((v) => typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)) return "Enter an amount, like 50 or 49.99.";
      if (c.operator === "between" && (list[0] as number) > (list[1] as number)) return "The first amount must not be larger than the second.";
      return null;
    case "direction":
      return c.value === "in" || c.value === "out" ? null : "Pick money in or money out.";
    case "money_account_id":
      return list.every((v) => typeof v === "string" && UUID.test(v)) ? null : "Pick an account.";
    case "date":
      if (list.some((v) => typeof v !== "string" || !ISO.test(v))) return "Pick a date.";
      if (c.operator === "between" && String(list[0]) > String(list[1])) return "The start date must not be after the end date.";
      return null;
    case "source":
      return list.every((v) => v === "manual" || v === "import" || v === "api") ? null : "Pick a source.";
  }
}

export function ruleProblem(r: RuleDraft): string | null {
  if (!r.name.trim()) return "Give the rule a name.";
  if (!r.conditions.length) return "Add at least one condition.";
  for (const c of r.conditions) {
    const p = conditionProblem(c);
    if (p) return p;
  }
  if (!r.actions.length) return "Add at least one action.";
  if (r.actions.filter((a) => a.action === "set_category" || a.action === "mark_transfer_to_account").length > 1) {
    return "A rule sets one category.";
  }
  for (const a of r.actions) {
    if ((a.action === "set_category" || a.action === "mark_transfer_to_account") && !a.account_id) return "Pick a category.";
    if ((a.action === "set_memo" || a.action === "append_memo") && !a.value?.text?.trim()) return "Enter the memo text.";
  }
  return null;
}

const SOURCE_WORD: Record<string, string> = { manual: "added by hand", import: "imported", api: "bank feed" };
const money = (c: unknown) => formatCents(Number(c) as Cents);

/** One condition in plain words: "description contains AMZN", "amount under $50.00". */
export function describeCondition(c: Condition, names: Record<string, string> = {}): string {
  const field = FIELD_LABEL[c.field].toLowerCase();
  const op = operatorLabel(c.field, c.operator);
  const list = Array.isArray(c.value) ? c.value : [c.value];
  switch (c.field) {
    case "amount":
      if (c.operator === "between") return `amount between ${money(list[0])} and ${money(list[1])}`;
      if (c.operator === "in") return `amount ${op} ${list.map(money).join(", ")}`;
      return `amount ${op} ${money(c.value)}`;
    case "direction":
      return c.value === "in" ? "money in" : "money out";
    case "money_account_id":
      return `account ${op} ${list.map((v) => names[String(v)] ?? "an account").join(" or ")}`;
    case "date":
      return c.operator === "between" ? `date between ${list[0]} and ${list[1]}` : `date ${op} ${c.value}`;
    case "source":
      return list.map((v) => SOURCE_WORD[String(v)] ?? String(v)).join(" or ");
    default:
      if (c.operator === "in") return `${field} ${op} ${list.map((v) => `“${v}”`).join(", ")}`;
      return `${field} ${op} ${c.operator === "regex" ? `/${c.value}/` : String(c.value)}`;
  }
}

/** "Description contains AMZN and amount under $50.00" */
export function describeConditions(r: Pick<RuleDraft, "conditions" | "match_mode">, names: Record<string, string> = {}): string {
  const text = r.conditions.map((c) => describeCondition(c, names)).join(r.match_mode === "any" ? " or " : " and ");
  return text ? text[0].toUpperCase() + text.slice(1) : "No conditions";
}

export function describeActions(actions: Action[], names: Record<string, string> = {}): string {
  return actions.map((a) => {
    switch (a.action) {
      case "set_category": return `Category: ${names[a.account_id ?? ""] ?? "a category"}`;
      case "mark_transfer_to_account": return `Transfer to ${names[a.account_id ?? ""] ?? "an account"}`;
      case "set_memo": return `Memo: “${a.value?.text ?? ""}”`;
      case "append_memo": return `Add “${a.value?.text ?? ""}” to memo`;
      case "skip_ai": return "Don't suggest a category";
    }
  }).join(" · ");
}
