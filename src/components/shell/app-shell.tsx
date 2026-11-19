"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LogOut } from "lucide-react";
import { BusinessSwitcher } from "@/components/business/business-switcher";
import { MobileNav } from "@/components/business/mobile-nav";
import { NavLinks, isActive, railGroups } from "@/components/business/nav-links";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RailExpandIcon, RailTransactionsIcon } from "./rail-icons";
import { cn } from "@/lib/utils";
import { SMART_SEARCH } from "@/lib/flags";
import { AskBar } from "@/components/ask/ask-bar";
import { SHELL_ACTIONS_ID } from "./shell-actions";
import { BRAND_NAME } from "@/lib/theme";

export interface ShellData {
  business: { id: string; name: string };
  businesses: { id: string; name: string; role: string }[];
  user: { id: string; email: string };
  /** Transactions waiting for a category (pending suggestion or none). */
  toReview: number;
  /** Statement files clients sent, waiting to be imported. */
  received?: number;
  accounts: { id: string; label: string; balance: string; spoken: string }[];
}

const storageKey = (userId: string) => `ag:sidebar-open:${userId}`;
const CHANGE = "ag:sidebar-change";

// Open/closed lives in localStorage per user (default closed). Browser storage can be
// missing or throw (private mode): then it lives in memory for this page.
const memory = new Map<string, boolean>();
function readOpen(userId: string) {
  try { return window.localStorage.getItem(storageKey(userId)) === "1"; } catch { return memory.get(userId) ?? false; }
}
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE, onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(CHANGE, onChange); };
}

/**
 * The signed-in frame. Desktop: a 72px icon rail; its expand button opens a 248px sidebar
 * that slides over the content (never pushes it) with a scrim. Below 768px the rail gives
 * way to a top bar with the slide-in sheet.
 */
export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const open = useSyncExternalStore(subscribe, () => readOpen(data.user.id), () => false);
  const set = useCallback((next: boolean) => {
    memory.set(data.user.id, next);
    try { window.localStorage.setItem(storageKey(data.user.id), next ? "1" : "0"); } catch { /* memory only */ }
    window.dispatchEvent(new Event(CHANGE));
  }, [data.user.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") set(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, set]);

  return (
    <TooltipProvider delay={150}>
      <div className="flex min-h-full flex-1">
        <Rail data={data} onExpand={() => set(true)} />
        <Sidebar data={data} open={open} onClose={() => set(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-3 md:hidden">
            <MobileNav businessId={data.business.id} toReview={data.toReview} accounts={data.accounts}
              top={<BusinessSwitcher current={data.business} businesses={data.businesses} />} />
            <span className="text-base font-semibold tracking-tight">{BRAND_NAME}</span>
          </header>
          <main className="w-full flex-1 px-4 py-6 md:px-8 md:py-6">
            <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 empty:hidden">
              {SMART_SEARCH && <div className="w-full min-w-0 lg:max-w-[680px] lg:flex-1"><AskBar businessId={data.business.id} /></div>}
              <div id={SHELL_ACTIONS_ID} className="flex flex-wrap items-center gap-2 lg:ml-auto" />
            </div>
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function Rail({ data, onExpand }: { data: ShellData; onExpand: () => void }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 z-20 hidden h-dvh w-[72px] shrink-0 flex-col items-center gap-1 border-r bg-card px-4 pb-4 pt-5 md:flex"
      aria-label="Navigation">
      <BusinessSwitcher current={data.business} businesses={data.businesses} look="rail" />
      {railGroups(data.business.id).map((group, g) => (
        <div key={g} className="flex flex-col items-center gap-1">
          <div className="py-2.5" aria-hidden><div className="h-px w-6 bg-border" /></div>
          {group.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            const review = item.key === "transactions" && data.toReview > 0;
            const inbox = item.key === "import" && (data.received ?? 0) > 0;
            const label = review ? `${item.label} · ${data.toReview} to review`
              : inbox ? `${item.label} · ${data.received} received from your client` : item.label;
            return (
              <Tooltip key={item.key}>
                <TooltipTrigger render={
                  <Link href={item.href} aria-label={label} aria-current={active ? "page" : undefined}
                    className={cn("relative grid size-10 place-items-center rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-brand-soft text-brand" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground")} />
                }>
                  <Icon className="size-[18px]" />
                  {review && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-attention" data-testid="rail-review-dot" />}
                  {inbox && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-brand" data-testid="rail-received-dot" />}
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ))}
      <div className="flex-1" />
      <Tooltip>
        <TooltipTrigger render={
          <button type="button" onClick={onExpand} aria-label="Expand sidebar"
            className="grid size-10 place-items-center rounded-xl text-muted-foreground outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" />
        }>
          <RailExpandIcon />
        </TooltipTrigger>
        <TooltipContent side="right">Expand sidebar</TooltipContent>
      </Tooltip>
      <UserMenu email={data.user.email} look="rail" />
    </aside>
  );
}

function Sidebar({ data, open, onClose }: { data: ShellData; open: boolean; onClose: () => void }) {
  const review = `/b/${data.business.id}/transactions?type=uncategorized`;
  return (
    <>
      <div aria-hidden onClick={onClose}
        className={cn("fixed inset-0 z-40 hidden transition-opacity duration-250 md:block",
          open ? "opacity-100" : "pointer-events-none opacity-0")} style={{ backgroundColor: "var(--scrim)" }} />
      <aside aria-label="Sidebar" inert={!open}
        className={cn("overlay-shadow fixed inset-y-0 left-0 z-50 hidden w-[248px] flex-col justify-between border-r bg-card px-4 pb-4 pt-5 transition-transform duration-250 ease-out md:flex",
          open ? "translate-x-0" : "invisible -translate-x-full")}>
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto">
          <BusinessSwitcher current={data.business} businesses={data.businesses} />
          <NavLinks businessId={data.business.id} onNavigate={onClose} toReview={data.toReview} received={data.received} accounts={data.accounts} />
        </div>
        <div className="flex flex-col">
          {data.toReview > 0 && (
            <div className="mb-1 flex flex-col gap-2.5 rounded-[14px] bg-brand-soft p-3.5" data-testid="review-card">
              <span className="grid size-7 place-items-center rounded-lg bg-card text-brand"><RailTransactionsIcon className="size-4" /></span>
              <p className="text-sm font-semibold">
                {data.toReview} transaction{data.toReview === 1 ? "" : "s"} need{data.toReview === 1 ? "s" : ""} a category
              </p>
              <p className="text-xs leading-[17px] text-muted-foreground">
                Sort them in one pass, with suggestions based on how you&apos;ve categorized before.
              </p>
              <Button size="sm" className="w-full" nativeButton={false} render={<Link href={review} onClick={onClose} />}>Run review</Button>
            </div>
          )}
          <button type="button" onClick={onClose}
            className="flex h-10 items-center gap-2 rounded-[10px] px-2.5 text-left text-[13px] font-medium text-muted-foreground outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex-1">Collapse sidebar</span>
            <RailExpandIcon className="-scale-x-100" />
          </button>
          <div className="border-t pl-1 pt-[7px]">
            <UserMenu email={data.user.email} look="row" />
          </div>
        </div>
      </aside>
    </>
  );
}

function UserMenu({ email, look }: { email: string; look: "rail" | "row" }) {
  const letter = (email[0] ?? "?").toUpperCase();
  const signOut = useRef<HTMLFormElement>(null);
  return (
    <>
    <form ref={signOut} action="/auth/signout" method="post" hidden />
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Account: ${email}`}
        className={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring",
          look === "rail" ? "mt-1 grid size-8 place-items-center rounded-full bg-surface-muted text-xs font-semibold"
            : "flex w-full items-center gap-2.5 rounded-lg py-1 text-left hover:bg-surface-muted")}>
        {look === "rail" ? letter : (
          <>
            <span className="grid size-7 place-items-center rounded-full bg-surface-muted text-[10px] font-medium" aria-hidden>{letter}</span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{email}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={look === "rail" ? "right" : "top"} align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut.current?.requestSubmit()}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}
