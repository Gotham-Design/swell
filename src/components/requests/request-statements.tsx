"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { createStatementRequest, type RequestState } from "@/app/b/[businessId]/import/request-actions";

type Account = { id: string; name: string; last4: string | null };

/**
 * "Request statements": a private link the client uses to send statement files, no account
 * needed. The link is shown once (only a hash is stored), with copy and email.
 */
export function RequestStatementsButton({ businessId, businessName, accounts, defaultFrom, variant = "outline", canEmail = false }: {
  businessId: string; businessName: string; accounts: Account[]; defaultFrom: string; variant?: "outline" | "default";
  /** Whether this deployment can send email (else the link is copied and sent by hand). */
  canEmail?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setGeneration((g) => g + 1); }}>
      <Button variant={variant} onClick={() => setOpen(true)} data-testid="request-statements">
        <Send aria-hidden /> Request statements
      </Button>
      <DialogContent className="sm:max-w-lg">
        <RequestForm key={generation} businessId={businessId} businessName={businessName} accounts={accounts} defaultFrom={defaultFrom}
          canEmail={canEmail} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RequestForm({ businessId, businessName, accounts, defaultFrom, canEmail, onClose }: {
  businessId: string; businessName: string; accounts: Account[]; defaultFrom: string; canEmail: boolean; onClose: () => void;
}) {
  const [state, action] = useActionState<RequestState, FormData>(createStatementRequest.bind(null, businessId), {});
  const [copied, setCopied] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [emailNow, setEmailNow] = useState(canEmail);
  const e = state.fieldErrors;

  if (state.ok && state.url) {
    const until = new Date(state.expiresAt!).toLocaleDateString("en-US", { month: "long", day: "numeric" });
    const subject = `Upload your statements for ${businessName}`;
    const body = `Hi,\n\nPlease upload your bank and card statements for ${businessName} here:\n\n${state.url}\n\n`
      + `The link is private to you and works until ${until}. You can drop in the PDF statements or CSV downloads from your bank, no account needed. `
      + `Files are encrypted and only I can open them.\n\nThanks!`;
    return (
      <>
        <DialogHeader>
          <DialogTitle>Link ready for {businessName}</DialogTitle>
          <DialogDescription>
            {state.emailed ? <>Emailed to {state.emailed}. </> : <>Send it to your client. </>}
            It works until {until}, and you can close it any time from the import screen.
          </DialogDescription>
        </DialogHeader>
        {state.repeatDay && (
          <p className="rounded-xl bg-brand-soft px-3 py-2 text-xs">
            Every month on the {ordinal(state.repeatDay)}, they&apos;ll get a fresh link for last month&apos;s statements, with up to two
            weekly reminders. It skips any month whose statements are already in.
          </p>
        )}
        {state.error && <p className="rounded-xl bg-attention-soft px-3 py-2 text-xs text-attention-text">{state.error}</p>}
        <div className="flex items-center gap-2">
          <Input readOnly value={state.url} aria-label="Upload link" className="font-mono text-xs" onFocus={(ev) => ev.currentTarget.select()} data-testid="request-link" />
          <Button variant="outline" onClick={async () => {
            await navigator.clipboard.writeText(state.url!);
            setCopied(true);
            toast.success("Link copied");
          }}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="rounded-xl bg-attention-soft px-3 py-2 text-xs text-attention-text">
          This is the only time the full link is shown. We keep a scrambled copy, so it can&apos;t be looked up later. Make a new one if it&apos;s lost.
        </p>
        <DialogFooter>
          <Button variant="outline" nativeButton={false}
            render={<a href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} />}>
            <Mail aria-hidden /> Email it
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Request statements from {businessName}</DialogTitle>
        <DialogDescription>
          Your client gets a private link to upload their statements: no account, no passwords. The files wait here, encrypted, until you import them.
        </DialogDescription>
      </DialogHeader>
      <FormAlert error={state.error} />
      <div>
        <label htmlFor="rq-from" className="mb-1.5 block text-sm font-medium">Who&apos;s asking</label>
        <Input id="rq-from" name="from_name" required maxLength={120} defaultValue={defaultFrom} placeholder="Jordan at Mainland Bookkeeping" />
        <p className="mt-1 text-xs text-muted-foreground">Your client sees this, so they know the link is from you.</p>
        {e?.from_name && <p className="mt-1 text-xs text-destructive">{e.from_name[0]}</p>}
      </div>
      {accounts.length > 0 && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Statements you need (optional)</legend>
          <div className="space-y-2">
            {accounts.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="account_ids" value={a.id} className="size-4 accent-[var(--color-brand)]" />
                {a.name}{a.last4 ? <span className="text-muted-foreground">··{a.last4}</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div>
        <label htmlFor="rq-note" className="mb-1.5 block text-sm font-medium">Note to your client (optional)</label>
        <Textarea id="rq-note" name="note" rows={2} maxLength={1000} placeholder="September and October, please." />
      </div>
      <fieldset className="space-y-3 rounded-xl border p-3">
        <legend className="px-1 text-sm font-medium">Email it</legend>
        <div>
          <label htmlFor="rq-email" className="mb-1.5 block text-sm">Client&apos;s email {repeat || emailNow ? "" : "(optional)"}</label>
          <Input id="rq-email" name="client_email" type="email" maxLength={254} placeholder="owner@theirbusiness.com" required={repeat || emailNow} />
          {e?.client_email && <p className="mt-1 text-xs text-destructive">{e.client_email[0]}</p>}
        </div>
        {canEmail && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="email_now" checked={emailNow} onChange={(ev) => setEmailNow(ev.target.checked)} className="size-4 accent-[var(--color-brand)]" />
            Email this link now
          </label>
        )}
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input type="checkbox" name="repeat" checked={repeat} onChange={(ev) => setRepeat(ev.target.checked)} className="size-4 accent-[var(--color-brand)]" data-testid="request-repeat" />
          Ask again every month on the
          <NativeSelect name="day_of_month" defaultValue="5" aria-label="Day of the month" className="h-8 w-20" disabled={!repeat}>
            {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{ordinal(i + 1)}</option>)}
          </NativeSelect>
        </label>
        {repeat && (
          <p className="text-xs text-muted-foreground">
            {canEmail
              ? "They get a fresh link for last month's statements, then up to two weekly reminders. Months already imported are skipped."
              : "Email isn't switched on for this site yet. The schedule is saved and starts sending once it is."}
          </p>
        )}
      </fieldset>
      <div>
        <label htmlFor="rq-days" className="mb-1.5 block text-sm font-medium">Link stays open for</label>
        <NativeSelect id="rq-days" name="days" defaultValue="14" className="max-w-48">
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
        </NativeSelect>
      </div>
      <DialogFooter>
        <SubmitButton pendingText="Making the link…">Make the link</SubmitButton>
      </DialogFooter>
    </form>
  );
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}
