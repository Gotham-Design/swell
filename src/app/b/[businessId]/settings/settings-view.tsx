"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { FormAlert } from "@/components/form-alert";
import { useHydrated } from "@/components/submit-button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui-kit/page-header";
import { INDUSTRIES, INDUSTRY_LABEL, MONTHS, type FormState } from "@/lib/validation/business";
import { cn } from "@/lib/utils";
import { saveSettings, setBusinessArchived } from "./actions";

export type SettingsData = {
  id: string; name: string; legalName: string | null; industry: string | null; fiscalStart: number;
  lockDate: string | null; aiEnabled: boolean; autoFile: boolean; archived: boolean;
};
const TABS = [{ id: "business", label: "Business" }, { id: "books", label: "Books" }] as const;

const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Month-ends to close through: the last twelve, plus the current lock date if it isn't one. */
function closeOptions(today: string, current: string | null) {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const end = new Date(Date.UTC(y, m - i, 0)); // day 0 of month (m - i + 1) = last day of month (m - i)
    out.push(end.toISOString().slice(0, 10));
  }
  if (current && !out.includes(current)) out.unshift(current);
  return out;
}

/**
 * Settings: one "Save changes" form for the business and its books, then archiving. Viewers
 * and editors see it read-only. People are managed on the Team page.
 */
export function SettingsView({ data: b, canManage, today, aiNote, exportHref }: {
  data: SettingsData; canManage: boolean; today: string; aiNote: string; exportHref: string;
}) {
  const [state, action, pending] = useActionState(saveSettings.bind(null, b.id), {} as FormState);
  const [ai, setAi] = useState(b.aiEnabled);
  const [autoFile, setAutoFile] = useState(b.autoFile);
  const [tab, setTab] = useState<string>("business");
  const hydrated = useHydrated();
  const e = state.fieldErrors;
  const off = !canManage;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle={<>{b.name} · how this business&apos;s books are set up.</>}
        actions={canManage && (
          <Button type="submit" form="settings-form" disabled={!hydrated || pending} data-testid="save-settings">
            {pending ? "Saving…" : "Save changes"}
          </Button>
        )} />

      <nav aria-label="Settings sections" className="inline-flex items-center rounded-full bg-surface-muted p-1">
        {TABS.map((t) => (
          <a key={t.id} href={`#${t.id}`} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "true" : undefined}
            className={cn("inline-flex h-8 items-center rounded-full px-4 text-sm transition-colors",
              tab === t.id ? "bg-card font-medium shadow-[0_1px_2px_rgb(15_31_23/0.08)]" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </a>
        ))}
      </nav>

      {!canManage && (
        <p className="text-sm text-muted-foreground" data-testid="read-only-note">Only owners can change these settings.</p>
      )}
      <FormAlert error={state.error} success={state.ok ? state.message : undefined} />

      <form id="settings-form" action={action} className="space-y-6">
        <Section id="business" title="Business details">
          <Row label="Business name" hint="Shown in the switcher and on every report." htmlFor="s-name" errors={e?.name}>
            <Input id="s-name" name="name" required maxLength={200} defaultValue={b.name} disabled={off} />
          </Row>
          <Row label="Legal name" hint="Printed on exported statements." htmlFor="s-legal" errors={e?.legal_name}>
            <Input id="s-legal" name="legal_name" maxLength={200} defaultValue={b.legalName ?? ""} disabled={off} />
          </Row>
          <Row label="Industry" hint="Helps us suggest a starting set of categories." htmlFor="s-industry" errors={e?.industry}>
            <NativeSelect id="s-industry" name="industry" defaultValue={b.industry ?? ""} disabled={off}>
              <option value="">Not set</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{INDUSTRY_LABEL[i]}</option>)}
            </NativeSelect>
          </Row>
        </Section>

        <Section id="books" title="Books">
          <Row label="Accounting basis" hint="Cash records money when it moves. Accrual records it when it's earned or owed.">
            <div role="radiogroup" aria-label="Accounting basis" className="inline-flex items-center rounded-full bg-surface-muted p-1">
              <span role="radio" aria-checked="true" className="inline-flex h-7 items-center rounded-full bg-card px-3.5 text-sm font-medium shadow-[0_1px_2px_rgb(15_31_23/0.08)]">Cash</span>
              <span role="radio" aria-checked="false" aria-disabled="true" title="Coming later"
                className="inline-flex h-7 cursor-not-allowed items-center gap-1.5 rounded-full px-3.5 text-sm text-muted-foreground">
                Accrual <span className="text-[11px]">· Coming later</span>
              </span>
            </div>
          </Row>
          <Row label="Fiscal year starts" htmlFor="s-fy" errors={e?.fiscal_year_start_month}>
            <NativeSelect id="s-fy" name="fiscal_year_start_month" defaultValue={b.fiscalStart} disabled={off}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </NativeSelect>
          </Row>
          <Row label="Close books through" hint="Locks earlier transactions so finished months can't change by accident." htmlFor="s-lock" errors={e?.lock_date}>
            <NativeSelect id="s-lock" name="lock_date" defaultValue={b.lockDate ?? ""} disabled={off}>
              <option value="">Not closed</option>
              {closeOptions(today, b.lockDate).map((d) => <option key={d} value={d}>{longDate(d)}</option>)}
            </NativeSelect>
          </Row>
          <Row label="Category suggestions" hint={aiNote}>
            <input type="hidden" name="ai_enabled" value={ai ? "on" : "off"} />
            <label className="flex items-center justify-end gap-3 text-sm">
              {ai ? "On" : "Off"}
              <Switch checked={ai} onCheckedChange={setAi} disabled={off} aria-label="Category suggestions" />
            </label>
          </Row>
          <Row label="File confident suggestions automatically"
            hint="Vendors you've filed the same way twice, and suggestions 90%+ sure with nothing unusual about them, are filed for you and marked Auto-filed. Anything flagged (a possible transfer, owner draw or personal purchase) waits for you.">
            <input type="hidden" name="ai_auto_file" value={autoFile ? "on" : "off"} />
            <label className="flex items-center justify-end gap-3 text-sm">
              {autoFile ? "On" : "Off"}
              <Switch checked={autoFile} onCheckedChange={setAutoFile} disabled={off || !ai} aria-label="File confident suggestions automatically" />
            </label>
          </Row>
          <Row label="Export everything" hint="Every account, transaction and change as CSV files in one zip.">
            <a href={exportHref} download className="inline-flex h-9 items-center justify-center rounded-full border bg-card px-4 text-sm font-medium hover:bg-surface-muted"
              data-testid="export-link">Download .zip</a>
          </Row>
        </Section>
        {/* The page header's button submits this form; Enter in a field does too. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>

      {canManage && <ArchiveCard businessId={b.id} archived={b.archived} />}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="surface scroll-mt-6 px-5 pt-5 pb-1">
      <h2 id={`${id}-title`} className="text-[15px] font-semibold">{title}</h2>
      <div className="mt-2 divide-y">{children}</div>
    </section>
  );
}

function Row({ label, hint, htmlFor, errors, children }: { label: string; hint?: string; htmlFor?: string; errors?: string[]; children: ReactNode }) {
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[1fr_minmax(0,340px)] sm:items-center">
      <div className="min-w-0">
        {htmlFor ? <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label> : <p className="text-sm font-medium">{label}</p>}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {errors?.map((err) => <p key={err} className="mt-1 text-xs text-destructive">{err}</p>)}
      </div>
      <div className="sm:justify-self-end sm:w-full">{children}</div>
    </div>
  );
}

function ArchiveCard({ businessId, archived }: { businessId: string; archived: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = (value: boolean) => start(async () => {
    const r = await setBusinessArchived(businessId, value);
    if (r?.error) toast.error(r.error); else if (r?.message) toast.success(r.message);
  });
  return (
    <section className="surface flex flex-wrap items-center gap-4 p-5" data-testid="archive-business">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium">{archived ? "This client is archived" : "Archive this client"}</h2>
        <p className="text-xs text-muted-foreground">
          {archived ? "It's hidden from the switcher. Restore it to bring it back." : "Hides it from the switcher. Books and statements are kept and can be restored."}
        </p>
      </div>
      {archived ? (
        <Button variant="outline" disabled={pending} onClick={() => run(false)}>Restore</Button>
      ) : (
        <Button variant="destructive" onClick={() => setOpen(true)}>Archive</Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this client?</DialogTitle>
            <DialogDescription>It leaves the switcher for everyone. Nothing is deleted, and an owner can restore it from Settings.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Keep it</Button>
            <Button variant="destructive" disabled={pending} onClick={() => run(true)}>{pending ? "Archiving…" : "Archive"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
