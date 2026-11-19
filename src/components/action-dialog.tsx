"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/validation/business";
import { toast } from "sonner";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * A dialog wrapping one server-action form. Closes and toasts on success; shows the
 * form error and per-field errors (passed to `children`) otherwise.
 */
export function ActionDialog({
  triggerLabel, triggerVariant = "outline", triggerSize = "sm", triggerAriaLabel,
  title, description, submitLabel, pendingText = "Saving…", action, children, wide, open: openProp, onOpenChange,
}: {
  /** Omit with `open` to drive the dialog from elsewhere (a menu item). */
  triggerLabel?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerVariant?: "default" | "outline" | "ghost" | "secondary" | "destructive";
  triggerSize?: "default" | "sm" | "xs";
  triggerAriaLabel?: string;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  pendingText?: string;
  action: Action;
  children: (state: FormState) => ReactNode;
  wide?: boolean;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (o: boolean) => { setOwnOpen(o); onOpenChange?.(o); };
  // Remount the form per opening (generation bumps on open, including controlled opens).
  const [generation, setGeneration] = useState(0);
  const [seen, setSeen] = useState(open);
  if (open !== seen) { setSeen(open); if (open) setGeneration((g) => g + 1); }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerLabel !== undefined && (
        <DialogTrigger render={<Button variant={triggerVariant} size={triggerSize} aria-label={triggerAriaLabel} />}>
          {triggerLabel}
        </DialogTrigger>
      )}
      <DialogContent className={wide ? "sm:max-w-lg" : undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {/* Remount per opening so fields and errors start fresh. */}
        <DialogForm key={generation} action={action} submitLabel={submitLabel} pendingText={pendingText}
          onDone={(message) => { setOpen(false); if (message) toast.success(message); }}>
          {children}
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}

function DialogForm({ action, submitLabel, pendingText, onDone, children }: {
  action: Action; submitLabel: string; pendingText: string;
  onDone: (message?: string) => void; children: (state: FormState) => ReactNode;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.ok) onDone(result.message);
    return result;
  }, {});
  return (
    <form action={formAction} className="space-y-4">
      <FormAlert error={state.error} />
      {children(state)}
      <DialogFooter>
        <SubmitButton pendingText={pendingText}>{submitLabel}</SubmitButton>
      </DialogFooter>
    </form>
  );
}
