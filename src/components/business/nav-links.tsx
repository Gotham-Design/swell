"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import {
  RailCategoriesIcon, RailImportIcon, RailMoneyAccountsIcon, RailOverviewIcon, RailReportsIcon,
  RailRulesIcon, RailSettingsIcon, RailTaxIcon, RailTeamIcon, RailTransactionsIcon,
} from "@/components/shell/rail-icons";
import { cn } from "@/lib/utils";

export interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  exact?: boolean;
}

/**
 * The client's pages, grouped the way a bookkeeper works through them. Reconcile is Phase 2:
 * its route still works by URL but has no entry point here.
 */
export function navSections(businessId: string): { label: string; items: NavItem[] }[] {
  const base = `/b/${businessId}`;
  return [
    {
      label: "General",
      items: [
        { key: "overview", href: base, label: "Overview", icon: RailOverviewIcon, exact: true },
        { key: "transactions", href: `${base}/transactions`, label: "Transactions", icon: RailTransactionsIcon },
        { key: "import", href: `${base}/import`, label: "Import", icon: RailImportIcon },
        { key: "reports", href: `${base}/reports`, label: "Reports", icon: RailReportsIcon },
        { key: "tax", href: `${base}/tax`, label: "Tax", icon: RailTaxIcon },
      ],
    },
    {
      label: "Books",
      items: [
        { key: "accounts", href: `${base}/accounts`, label: "Money accounts", icon: RailMoneyAccountsIcon },
        { key: "categories", href: `${base}/categories`, label: "Categories", icon: RailCategoriesIcon },
        { key: "rules", href: `${base}/rules`, label: "Rules", icon: RailRulesIcon },
      ],
    },
    {
      label: "Client",
      items: [
        { key: "team", href: `${base}/team`, label: "Team", icon: RailTeamIcon },
        { key: "settings", href: `${base}/settings`, label: "Settings", icon: RailSettingsIcon },
      ],
    },
  ];
}

/** The rail groups the same pages differently: Overview, Transactions, Import · Reports, Tax, Money accounts, Categories, Rules · Settings. */
export function railGroups(businessId: string): NavItem[][] {
  const all = navSections(businessId).flatMap((s) => s.items);
  const pick = (...keys: string[]) => keys.map((k) => all.find((i) => i.key === k)!);
  return [pick("overview", "transactions", "import"), pick("reports", "tax", "accounts", "categories", "rules"), pick("team", "settings")];
}

export function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Labelled nav rows: the overlay sidebar and the mobile sheet. */
export function NavLinks({ businessId, onNavigate, toReview = 0, received = 0, accounts }: {
  businessId: string;
  onNavigate?: () => void;
  toReview?: number;
  received?: number;
  /** Shortcuts listed under Money accounts. */
  accounts?: { id: string; label: string; balance: string; spoken: string }[];
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-[18px]" aria-label="Business">
      {navSections(businessId).map((s) => (
        <div key={s.label} className="flex flex-col gap-0.5">
          <p className="pb-1 pl-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{s.label}</p>
          {s.items.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <div key={item.key}>
                <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
                  className={cn("flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-brand-soft font-semibold text-brand" : "font-medium text-foreground hover:bg-surface-muted")}>
                  <Icon className={cn("size-4 shrink-0", active ? "text-brand" : "text-muted-foreground")} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.key === "import" && received > 0 && (
                    <span className="rounded-full bg-brand-soft px-1.5 text-xs font-medium tabular-nums text-brand"
                      aria-label={`${received} received from your client`} data-testid="nav-received-count">{received}</span>
                  )}
                  {item.key === "transactions" && toReview > 0 && (
                    <span className="rounded-full bg-attention-soft px-1.5 text-xs font-medium tabular-nums text-attention-text"
                      aria-label={`${toReview} to review`} data-testid="nav-review-count">{toReview}</span>
                  )}
                </Link>
                {item.key === "accounts" && accounts?.map((a) => (
                  <Link key={a.id} href={`${item.href}#account-${a.id}`} onClick={onNavigate}
                    className="flex h-[30px] items-center gap-2 rounded-[10px] pl-9 pr-2.5 text-[13px] hover:bg-surface-muted">
                    <span className="flex-1 truncate">{a.label}</span>
                    <span className="text-xs font-medium tabular-nums text-muted-foreground" aria-label={a.spoken}>{a.balance}</span>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
