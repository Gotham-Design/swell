"use client";

import { SubmitButton } from "@/components/submit-button";
import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";
import { FormAlert } from "@/components/form-alert";
import type { FormState } from "@/lib/validation/business";
import { sendMagicLink } from "./actions";

export function LoginForm() {
  const [state, action] = useActionState(sendMagicLink, {} as FormState);

  if (state.ok) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl bg-brand-soft p-5" role="status">
        <MailCheck className="size-8 text-brand" aria-hidden />
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="text-sm text-muted-foreground">
          We sent a sign-in link to <strong className="text-foreground">{state.message}</strong>. Open it on any
          device to sign in. You can close this tab.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <FormAlert error={state.error} />
      <Field label="Email" htmlFor="email" errors={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus placeholder="you@yourfirm.com" className="h-10 rounded-full px-4" />
      </Field>
      <SubmitButton className="h-9 w-full rounded-full" pendingText="Sending…">Email me a sign-in link</SubmitButton>
      <p className="pt-3 text-[13px] text-muted-foreground">New here? The same link creates your account.</p>
    </form>
  );
}
