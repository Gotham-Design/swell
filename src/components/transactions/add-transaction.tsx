"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/submit-button";
import type { Mode } from "@/lib/validation/transaction";

const EVENT = "ag:add-transaction";

/** Opens the add-transaction drawer of whichever list or panel is on the page. */
export function AddTransactionButton({ mode, label = "Add transaction", disabled, iconOnly, className }: {
  mode?: Mode; label?: string; disabled?: boolean; iconOnly?: boolean; className?: string;
}) {
  const off = !useHydrated();
  const open = () => window.dispatchEvent(new CustomEvent<Mode | undefined>(EVENT, { detail: mode }));
  if (iconOnly) {
    return (
      <Button variant="outline" size="icon-sm" aria-label={label} disabled={off || disabled} onClick={open} className={className}>
        <Plus aria-hidden />
      </Button>
    );
  }
  return (
    <Button variant="outline" disabled={off || disabled} onClick={open} className={className}>
      <Plus aria-hidden /> {label}
    </Button>
  );
}

// "Add a transaction" asked for from another page (the Ask bar): the next list to mount opens it.
let pendingAdd = false;
export function requestAddTransaction(onPageWithList: boolean) {
  if (onPageWithList) window.dispatchEvent(new CustomEvent<Mode | undefined>(EVENT, { detail: undefined }));
  else pendingAdd = true;
}

/** Subscribe to add requests; returns the unsubscribe function (for useEffect). */
export function onAddTransaction(handler: (mode?: Mode) => void) {
  if (pendingAdd) { pendingAdd = false; setTimeout(() => handler(undefined), 0); }
  const listener = (e: Event) => handler((e as CustomEvent<Mode | undefined>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
