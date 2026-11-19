"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

const noop = () => () => {};

/** true once React has hydrated this page; false during SSR and before hydration. */
export function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}

/**
 * Submit button for server-action forms. Disabled until the page is interactive, so a
 * click can't fall through to a plain HTML post that loses the action's result, and
 * while the form is submitting.
 */
export function SubmitButton({ children, pendingText, ...props }: ComponentProps<typeof Button> & { pendingText: string }) {
  const hydrated = useHydrated();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={!hydrated || pending || props.disabled} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}
