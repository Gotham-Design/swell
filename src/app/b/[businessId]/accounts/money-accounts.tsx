"use client";

import { FlipImportButton } from "@/components/import/flip-import";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/form-field";
import { ActionDialog } from "@/components/action-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Money } from "@/components/ui-kit/money";
import { ImportStatementButton } from "@/components/ui-kit/import-button";
import { centsToInput } from "@/lib/money";
import { MONEY_KIND_LABEL, MONEY_KINDS, type MoneyKind } from "@/lib/validation/accounts";
import type { FormState } from "@/lib/validation/business";
import { cn } from "@/lib/utils";
import { createMoneyAccount, setMoneyAccountArchived, updateMoneyAccount } from "./actions";
import { undoImport } from "../import/actions";

export type AccountCardData = {
  id: string; name: string; kind: string; last4: string | null; owed: boolean; archived: boolean;
  balance: number; opening_balance_cents: number; opening_date: string | null;
  months: { month: string; cents: number }[];
  freshness: { label: string; stale: boolean };
};

export type HistoryRow = {
  id: string; account: string; period: string; fileName: string | null; rows: number; imported: string;
};

const AVATAR_TONES = [
  "bg-money-in-soft text-money-in-text",
  "bg-attention-soft text-attention-text",
  "bg-[#E8F0FB] text-[#2459A8]",
  "bg-brand-soft text-brand",
];

function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

const monthShort = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

/** "Add account" for the page header: the dialog that runs create_money_account (+ opening balance). */
export function AddMoneyAccountButton({ businessId, defaultDate }: { businessId: string; defaultDate: string }) {
  return (
    <ActionDialog triggerLabel="Add account" triggerVariant="outline" triggerSize="default"
      title="Add a money account" submitLabel="Add account" wide
      description="A bank account, card or cash box your transactions run through."
      action={createMoneyAccount.bind(null, businessId)}>
      {(state) => <MoneyAccountFields state={state} defaultDate={defaultDate} />}
    </ActionDialog>
  );
}

/** One card per money account: balance, six month-end bars, how fresh the last import is. */
export function MoneyAccountCards({ businessId, accounts, canWrite, defaultDate }: {
  businessId: string; accounts: AccountCardData[]; canWrite: boolean; defaultDate: string;
}) {
  if (accounts.length === 0) {
    return (
      <div className="surface flex flex-col items-center gap-3 p-10 text-center" data-testid="money-account-list">
        <h2 className="text-[15px] font-semibold">No money accounts yet</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Add the checking account your business runs through first. Statements import into it.
        </p>
        {canWrite && <AddMoneyAccountButton businessId={businessId} defaultDate={defaultDate} />}
      </div>
    );
  }
  return (
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="money-account-list">
      {accounts.map((a, i) => (
        <AccountCard key={a.id} account={a} tone={AVATAR_TONES[i % AVATAR_TONES.length]}
          businessId={businessId} canWrite={canWrite} defaultDate={defaultDate} />
      ))}
    </ul>
  );
}

function AccountCard({ account: a, tone, businessId, canWrite, defaultDate }: {
  account: AccountCardData; tone: string; businessId: string; canWrite: boolean; defaultDate: string;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const kind = MONEY_KIND_LABEL[a.kind as MoneyKind] ?? a.kind;
  // Bars are display ratios of SQL month-end balances, scaled between the lowest and highest
  // month so a steady account still shows its drift; never below a sliver.
  const sizes = a.months.map((m) => Math.abs(m.cents));
  const lo = Math.min(...sizes), hi = Math.max(...sizes);
  const height = (c: number) => (hi === lo ? 70 : 35 + (65 * (Math.abs(c) - lo)) / (hi - lo));
  const archive = () => start(async () => {
    const r = await setMoneyAccountArchived(businessId, a.id, !a.archived);
    if (r.ok) toast.success(r.message); else toast.error(r.error ?? "Couldn't change that account.");
  });

  return (
    <li className={cn("surface flex flex-col p-5", a.archived && "opacity-70")} data-testid="money-account" data-name={a.name}>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold", tone)} aria-hidden>
          {initials(a.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">{a.name}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {kind}{a.last4 ? ` ··${a.last4}` : ""}{a.archived ? " · Archived" : ""}
          </p>
        </div>
        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${a.name}`} disabled={pending} />}>
              <MoreHorizontal aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuItem onClick={() => setEditing(true)}>Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={archive}>{a.archived ? "Restore" : "Archive"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">{a.owed ? "Balance owed" : "Balance"}</p>
      <div className="text-[26px] font-semibold leading-tight tracking-[-0.02em]" data-testid="balance">
        <Money cents={a.balance} split />
      </div>

      {a.months.length > 0 && (
        <figure className="mt-4" aria-label={`Month-end balances for ${a.name}`}>
          <div className="flex h-10 items-end gap-1.5" aria-hidden>
            {a.months.map((m, i) => (
              <span key={m.month} className={cn("flex-1 rounded-[3px]", i === a.months.length - 1 ? "bg-brand" : "bg-bar-muted")}
                style={{ height: `${height(m.cents)}%` }} />
            ))}
          </div>
          <div className="mt-2 flex gap-1.5 text-[11px] text-muted-foreground" aria-hidden>
            {a.months.map((m) => <span key={m.month} className="flex-1 text-center">{monthShort(m.month)}</span>)}
          </div>
        </figure>
      )}

      <div className="mt-4 border-t pt-3">
        <p className={cn("flex items-center gap-2 text-xs", a.freshness.stale ? "text-attention-text" : "text-foreground")} data-testid="freshness">
          <span className={cn("size-1.5 rounded-full", a.freshness.stale ? "bg-attention" : "bg-money-in")} aria-hidden />
          {a.freshness.label}
        </p>
        {canWrite && !a.archived && (
          <div className="mt-3">
            <ImportStatementButton businessId={businessId} accountId={a.id} variant={a.freshness.stale ? "default" : "outline"} />
          </div>
        )}
      </div>

      {canWrite && (
        <ActionDialog open={editing} onOpenChange={setEditing} title={`Edit ${a.name}`} submitLabel="Save" wide
          action={updateMoneyAccount.bind(null, businessId, a.id)}>
          {(state) => <MoneyAccountFields state={state} account={a} defaultDate={defaultDate} />}
        </ActionDialog>
      )}
    </li>
  );
}

/** Committed imports, newest first. Undo takes back every transaction that import added. */
export function StatementHistory({ businessId, rows, canWrite }: { businessId: string; rows: HistoryRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<HistoryRow | null>(null);
  const [pending, start] = useTransition();
  const undo = (row: HistoryRow) => start(async () => {
    const r = await undoImport(businessId, row.id);
    if (r.ok) {
      toast.success(`Took out ${r.deleted} transaction${r.deleted === 1 ? "" : "s"} from ${row.fileName ?? "that import"}`);
      setConfirm(null);
      router.refresh();
    } else toast.error(r.error);
  });

  return (
    <section className="surface overflow-hidden" aria-labelledby="history-title">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
        <h2 id="history-title" className="text-[15px] font-semibold">Statement history</h2>
        <p className="text-xs text-muted-foreground">Flip fixes money in and out coming in backwards · Undo takes an import out</p>
      </div>
      {rows.length === 0 ? (
        <p className="border-t px-5 py-8 text-center text-sm text-muted-foreground">No statements imported yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm" data-testid="statement-history">
            <thead>
              <tr className="bg-surface-muted text-left text-xs text-muted-foreground [&_th]:h-10 [&_th]:font-medium">
                <th className="pl-5">Account</th>
                <th className="px-3">Covers</th>
                <th className="px-3">File</th>
                <th className="px-3 text-right">Rows</th>
                <th className="px-3">Imported on</th>
                <th className="pr-5"><span className="sr-only">Undo</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t [&_td]:py-2.5">
                  <td className="pl-5 font-medium">{r.account}</td>
                  <td className="px-3">{r.period}</td>
                  <td className="max-w-56 truncate px-3">{r.fileName ?? "—"}</td>
                  <td className="px-3 text-right tabular-nums">{r.rows}</td>
                  <td className="px-3 text-muted-foreground">{r.imported}</td>
                  <td className="pr-5 text-right">
                    {canWrite && (
                      <span className="inline-flex gap-1">
                        <FlipImportButton businessId={businessId} batchId={r.id} fileName={r.fileName} compact />
                        <Button variant="ghost" size="sm" onClick={() => setConfirm(r)} aria-label={`Undo ${r.fileName ?? "import"}`}>Undo</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo this import?</DialogTitle>
            <DialogDescription>
              {confirm && <>The {confirm.rows} transaction{confirm.rows === 1 ? "" : "s"} from {confirm.fileName ?? "this file"} ({confirm.account}, {confirm.period}) come out of the books. Anything you categorized in them goes too.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Keep it</Button>
            <Button variant="destructive" disabled={pending} onClick={() => confirm && undo(confirm)}>
              {pending ? "Undoing…" : "Undo import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function MoneyAccountFields({ state, account, defaultDate }: { state: FormState; account?: AccountCardData; defaultDate: string }) {
  const e = state.fieldErrors;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" htmlFor="ma-name" errors={e?.name}>
        <Input id="ma-name" name="name" required maxLength={100} defaultValue={account?.name} placeholder="Chase Business Checking" />
      </Field>
      {account ? (
        <Field label="Type" htmlFor="ma-kind-ro">
          <Input id="ma-kind-ro" disabled value={MONEY_KIND_LABEL[account.kind as MoneyKind] ?? account.kind} />
        </Field>
      ) : (
        <Field label="Type" htmlFor="ma-kind" errors={e?.kind}>
          <NativeSelect id="ma-kind" name="kind" defaultValue="checking">
            {MONEY_KINDS.map((k) => <option key={k} value={k}>{MONEY_KIND_LABEL[k]}</option>)}
          </NativeSelect>
        </Field>
      )}
      <Field label="Last 4 digits (optional)" htmlFor="ma-last4" errors={e?.last4}>
        <Input id="ma-last4" name="last4" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" defaultValue={account?.last4 ?? ""} />
      </Field>
      <div />
      <Field label="Opening balance" htmlFor="ma-opening" errors={e?.opening_balance}
        hint="What it held (or, for a card or loan, what you owed) on the opening date. Leave blank for none.">
        <Input id="ma-opening" name="opening_balance" inputMode="decimal" placeholder="0.00"
          defaultValue={account && account.opening_balance_cents !== 0 ? centsToInput(account.opening_balance_cents) : ""} />
      </Field>
      <Field label="Opening balance date" htmlFor="ma-opening-date" errors={e?.opening_date}>
        <Input id="ma-opening-date" name="opening_date" type="date" defaultValue={account?.opening_date ?? defaultDate} />
      </Field>
    </div>
  );
}
