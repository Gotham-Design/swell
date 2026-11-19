"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronDown, Plus } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** "Demo Bakery" → "DB"; one word → its first two letters. */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const pick = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return pick.toUpperCase();
}

/**
 * Switch between the user's businesses or add one. `rail`: the evergreen initials square at
 * the top of the icon rail. `card`: the full row at the top of the sidebar and mobile sheet.
 */
export function BusinessSwitcher({ current, businesses, look = "card" }: {
  current: { id: string; name: string };
  businesses: { id: string; name: string; role: string }[];
  look?: "rail" | "card";
}) {
  const router = useRouter();
  const label = `Switch client. Current: ${current.name}`;
  return (
    <DropdownMenu>
      {look === "rail" ? (
        <DropdownMenuTrigger aria-label={label} data-testid="current-business" data-name={current.name}
          className="grid h-11 w-10 shrink-0 place-items-center rounded-xl bg-brand text-[13px] font-semibold text-brand-foreground outline-none hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {initials(current.name)}
        </DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger aria-label={label}
          className="flex w-full items-center gap-2.5 rounded-xl border bg-card px-2.5 py-[5px] text-left outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-medium text-brand" aria-hidden>
            {initials(current.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] text-muted-foreground">Client</span>
            <span className="block truncate text-sm font-semibold" data-testid="current-business-name">{current.name}</span>
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent className={cn("min-w-64")} side={look === "rail" ? "right" : "bottom"} align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Clients</DropdownMenuLabel>
          {businesses.map((b) => (
            <DropdownMenuItem key={b.id} onClick={() => router.push(`/b/${b.id}`)}>
              <span className="flex-1 truncate">{b.name}</span>
              <span className="text-xs capitalize text-muted-foreground">{b.role}</span>
              {b.id === current.id && <Check aria-label="Current" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/new")}>
          <Plus aria-hidden /> Add a client
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
