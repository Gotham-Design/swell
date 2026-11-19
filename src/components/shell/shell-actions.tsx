"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const SHELL_ACTIONS_ID = "shell-actions";

/** A page's buttons, shown in the top row beside the Ask bar. */
export function ShellActions({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // The slot belongs to the shell, which is mounted first.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEl(document.getElementById(SHELL_ACTIONS_ID));
  }, []);
  return el ? createPortal(children, el) : null;
}
