"use client";

import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NavLinks } from "./nav-links";
import { BRAND_NAME } from "@/lib/theme";

/** Narrow screens: the sidebar slides in from the left. */
export function MobileNav({ businessId, top, toReview, accounts }: {
  businessId: string;
  top: ReactNode;
  toReview?: number;
  accounts?: { id: string; label: string; balance: string; spoken: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open navigation" />}>
        <Menu aria-hidden />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-5 overflow-y-auto bg-card px-4 py-5">
        <SheetTitle className="px-2.5 text-base">{BRAND_NAME}</SheetTitle>
        {top}
        <NavLinks businessId={businessId} onNavigate={() => setOpen(false)} toReview={toReview} accounts={accounts} />
        <form action="/auth/signout" method="post" className="mt-auto">
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">Sign out</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
