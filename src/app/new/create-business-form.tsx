"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormAlert } from "@/components/form-alert";
import { STARTERS } from "@/lib/onboarding/starters";
import { INDUSTRIES, INDUSTRY_LABEL, MONTHS, type FormState, type Industry } from "@/lib/validation/business";
import { cn } from "@/lib/utils";
import { createBusiness } from "./actions";

const KINDS = [
  { value: "checking", label: "Checking", example: "Chase Business Checking" },
  { value: "credit_card", label: "Credit card", example: "Amex Business Gold" },
  { value: "savings", label: "Savings", example: "Ally Business Savings" },
  { value: "cash", label: "Cash", example: "Cash drawer" },
] as const;

const Label = ({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) =>
  <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">{children}</label>;
const Err = ({ e }: { e?: string[] }) => (e?.length ? <p className="mt-1 text-xs text-destructive">{e[0]}</p> : null);

/** The card on the left and the starter categories on the right, which follow the industry. */
export function CreateBusinessForm() {
  const [state, action] = useActionState(createBusiness, {} as FormState);
  const [industry, setIndustry] = useState<Industry | "">("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("checking");
  const e = state.fieldErrors;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[600px_340px] lg:justify-center">
      <form action={action} className="surface space-y-5 p-6 sm:p-8">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Add a client business</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Each client keeps their own books, categories and people. You can change any of this later in Settings.
          </p>
        </div>
        <FormAlert error={state.error} />
        <div>
          <Label htmlFor="nb-name">Business name</Label>
          <Input id="nb-name" name="name" required maxLength={200} autoFocus placeholder="Rivera Landscaping" className="h-11" aria-invalid={!!e?.name} />
          <Err e={e?.name} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="nb-industry">Industry</Label>
            <NativeSelect id="nb-industry" name="industry" value={industry} onChange={(ev) => setIndustry(ev.target.value as Industry | "")}>
              <option value="">Pick one</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{INDUSTRY_LABEL[i]}</option>)}
            </NativeSelect>
            <Err e={e?.industry} />
          </div>
          <div>
            <Label htmlFor="nb-fy">Fiscal year starts</Label>
            <NativeSelect id="nb-fy" name="fiscal_year_start_month" defaultValue={1}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </NativeSelect>
          </div>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Accounting basis</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer gap-3 rounded-xl border-2 border-brand bg-brand-soft p-3.5">
              <input type="radio" name="basis" value="cash" defaultChecked className="mt-1 accent-[var(--color-brand)]" />
              <span><span className="block text-sm font-medium">Cash</span>
                <span className="block text-xs text-muted-foreground">Record money when it moves. Most small clients.</span></span>
            </label>
            <label className="flex cursor-not-allowed gap-3 rounded-xl border p-3.5 opacity-60" title="Coming later">
              <input type="radio" name="basis" value="accrual" disabled className="mt-1" />
              <span><span className="block text-sm font-medium">Accrual <span className="text-xs font-normal text-muted-foreground">· Coming later</span></span>
                <span className="block text-xs text-muted-foreground">Record it when earned or owed.</span></span>
            </label>
          </div>
        </fieldset>
        <div>
          <Label htmlFor="nb-account">Where do their statements come from?</Label>
          <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
            <Input id="nb-account" name="account_name" required maxLength={100} placeholder={KINDS.find((k) => k.value === kind)!.example}
              aria-invalid={!!e?.account_name} />
            <NativeSelect name="account_kind" value={kind} onChange={(ev) => setKind(ev.target.value as typeof kind)} aria-label="Account type">
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </NativeSelect>
          </div>
          <Err e={e?.account_name ?? e?.account_kind} />
          <p className="mt-1.5 text-xs text-muted-foreground">You can add more accounts on the next screen.</p>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted-foreground">Next: import their first statement</p>
          <SubmitButton pendingText="Adding…">Add client</SubmitButton>
        </div>
      </form>
      <StarterPanel industry={industry} />
    </div>
  );
}

function StarterPanel({ industry }: { industry: Industry | "" }) {
  const s = STARTERS[industry || "other"];
  const groups = [
    { label: "Income", names: s.income },
    { label: "Expenses", names: s.expense },
    { label: "Other", names: ["Owner Draws", "Owner Contributions"] },
  ];
  return (
    <aside className="surface p-6" aria-label="Starter categories" data-testid="starter-categories">
      <h2 className="text-[15px] font-semibold">Starter categories</h2>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {industry ? `Picked for ${INDUSTRY_LABEL[industry].toLowerCase()} businesses.` : "Pick an industry to tailor these."} Rename,
        remove or add your own any time.
      </p>
      {groups.map((g) => (
        <div key={g.label} className="mt-4 border-t pt-3">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{g.label}</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {g.names.map((n) => (
              <li key={n} className={cn("rounded-md bg-surface-muted px-2.5 py-1 text-xs")}>{n}</li>
            ))}
          </ul>
        </div>
      ))}
      <p className="mt-4 text-xs text-muted-foreground">Plus the standard set every business gets, like Bank Fees and Meals.</p>
    </aside>
  );
}
