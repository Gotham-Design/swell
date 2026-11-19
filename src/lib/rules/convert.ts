// Rules as stored (rows with condition/action children) <-> the builder's draft shape.
import type { RuleRow } from "@/lib/dal";
import type { Action, Condition, RuleDraft } from "./model";

export function toDraft(r: RuleRow): RuleDraft {
  return {
    id: r.id, name: r.name, match_mode: r.match_mode as "all" | "any", stop_processing: r.stop_processing, enabled: r.enabled,
    priority: r.priority,
    conditions: r.rule_conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value, case_sensitive: c.case_sensitive }) as Condition),
    actions: r.rule_actions.map((a) => ({ action: a.action, account_id: a.account_id, value: a.value }) as Action),
  };
}

/** A new rule from one transaction: its vendor (or description) and its category. */
export function draftFromTransaction(t: { vendor_normalized: string | null; description: string; category_account_id: string | null },
  categoryName?: string): RuleDraft {
  const vendor = t.vendor_normalized?.trim();
  return {
    name: `${vendor ? vendor[0].toUpperCase() + vendor.slice(1) : t.description.slice(0, 40)}${categoryName ? ` → ${categoryName}` : ""}`.slice(0, 120),
    match_mode: "all", stop_processing: true, enabled: true,
    conditions: [vendor
      ? { field: "vendor_normalized", operator: "equals", value: vendor }
      : { field: "description_clean", operator: "contains", value: t.description }],
    actions: [{ action: "set_category", account_id: t.category_account_id }],
  };
}
