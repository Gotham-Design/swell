"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { useHydrated } from "@/components/submit-button";
import { RailImportIcon, RailMoneyAccountsIcon } from "@/components/shell/rail-icons";
import { PageHeader } from "@/components/ui-kit/page-header";
import { IMPORT_STEPS, Stepper } from "@/components/ui-kit/stepper";
import { PillTabs } from "@/components/ui-kit/segmented-nav";
import { DATE_FORMATS, DATE_FORMAT_EXAMPLE, detectDateFormat, type DateFormat } from "@/lib/import/dates";
import {
  applyMapping, mappingProblems, suggestMapping, type AmountMode, type ColumnField, type GuessedField, type Mapping,
} from "@/lib/import/mapping";
import { pickStatementAccount, type ParsedFile } from "@/lib/import/parse";
import { readInWorker } from "@/lib/import/read-in-worker";
import { formatCents, sumCents, tryParseCents } from "@/lib/money";
import { MONEY_KIND_LABEL, type MoneyKind } from "@/lib/validation/accounts";
import { cn } from "@/lib/utils";
import { findTemplate, readStatementPdf, saveTemplate, stageImport } from "@/app/b/[businessId]/import/actions";
import { IMPORT_UPLOAD_EVENT, takeHandOff, type ImportUploadDetail } from "@/components/requests/received-files";

export interface ImportAccount {
  id: string; name: string; kind: string; last4?: string | null;
  /** "Imported Oct 21" / "Never imported". */
  freshness?: string;
  /** Last import more than 21 days ago (or never). */
  stale?: boolean;
}

const FIELD_LABEL: Record<ColumnField, string> = {
  date: "Date", amount: "Amount", debit: "Money out", credit: "Money in", description: "Description",
  description2: "Add to description", category: "Category", reference: "Reference", memo: "Memo", balance: "Balance",
};

/** A staged import to reopen at the mapping step ("Back to mapping"). */
export interface ResumeImport { batchId: string; accountId: string; fileName: string; text: string; mapping: Mapping }

export function ImportWizard({ businessId, accounts, resume, initialAccountId, aside }: {
  businessId: string;
  accounts: ImportAccount[];
  resume?: ResumeImport;
  /** Preselected tile: ?account=, else the stalest account. */
  initialAccountId?: string;
  /** Shown beside step 1 (recent imports). */
  aside?: ReactNode;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [accountId, setAccountId] = useState(resume?.accountId ?? initialAccountId ?? accounts[0]?.id ?? "");
  const [file, setFile] = useState<{ name: string; parsed: ParsedFile; raw: File } | null>(null);
  const [replaceBatchId, setReplaceBatchId] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [guessed, setGuessed] = useState<Set<GuessedField>>(new Set());
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saveMapping, setSaveMapping] = useState(true);
  /** A file a client sent through a request link: tied to the import so it's deleted once committed. */
  const [uploadId, setUploadId] = useState<string | null>(null);
  /** A PDF statement as read, with every account it covers (file.parsed is the picked one). */
  const [statement, setStatement] = useState<ParsedFile | null>(null);

  const account = accounts.find((a) => a.id === accountId);

  // Reopen a staged import: the file text and mapping come from the server.
  const resumed = useRef(false);
  useEffect(() => {
    if (!resume || resumed.current) return;
    resumed.current = true;
    const raw = new File([resume.text], resume.fileName, { type: "text/csv" });
    readInWorker(raw).then((parsed) => {
      setFile({ name: resume.fileName, parsed, raw });
      setMapping(resume.mapping);
      setGuessed(new Set());
      setReplaceBatchId(resume.batchId);
    }).catch((e: Error) => setError(e.message));
  }, [resume]);

  /** Re-read and check every row on the server, then go to Review. */
  const stage = async (raw: File, m: Mapping, replace: string | null, upload: string | null = uploadId) => {
    const fd = new FormData();
    fd.set("file", raw);
    fd.set("money_account_id", account!.id);
    fd.set("mapping", JSON.stringify(m));
    if (replace) fd.set("replace_batch_id", replace);
    if (upload) fd.set("upload_id", upload);
    const picked = file?.parsed.statement?.account;
    if (picked !== undefined && picked !== null) fd.set("statement_account", String(picked));
    const r = await stageImport(businessId, fd);
    if (!r.ok) { toast.error(r.error); return false; }
    router.push(`/b/${businessId}/import/${r.batchId}`);
    return true;
  };

  const read = async (picked: File | undefined, fromUpload: string | null = null) => {
    if (!picked || !account) return;
    if (!fromUpload) setUploadId(null);
    setError(null);
    setReading(true);
    try {
      let parsed: ParsedFile;
      const head = new Uint8Array(await picked.slice(0, 4).arrayBuffer());
      if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
        // A PDF statement: read on our server (not in the browser, and not by anyone else).
        const fd = new FormData();
        fd.set("file", picked);
        const r = await readStatementPdf(businessId, fd);
        if (!r.ok) throw new Error(r.error);
        setStatement(r.file);
        // A combined statement: start on the account whose last 4 digits match, else the first.
        const match = r.file.statement?.accounts.findIndex((a) => a.last4 && a.last4 === account.last4) ?? -1;
        parsed = pickStatementAccount(r.file, Math.max(0, match));
      } else {
        setStatement(null);
        parsed = await readInWorker(picked);
      }
      const saved = await findTemplate(businessId, account.id, parsed.signature);
      // A combined statement waits on the mapping step so the right account can be picked.
      const choose = (parsed.statement?.accounts.length ?? 0) > 1;
      if (saved && !choose) {
        // Same columns as last time: skip straight to Review.
        toast.success(`Using your saved columns for ${account.name}`);
        if (await stage(picked, saved, null, fromUpload)) return;
        setMapping(saved);
        setGuessed(new Set());
      } else if (saved) {
        setMapping(saved);
        setGuessed(new Set());
      } else {
        const s = suggestMapping(parsed.headers, parsed.rows, account.kind);
        setMapping(s.mapping);
        setGuessed(new Set(s.guessed));
      }
      setFile({ name: picked.name, parsed, raw: picked });
      setReplaceBatchId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  };

  // A statement dropped on the Ask bar elsewhere in the app: read it as if dropped here.
  useEffect(() => {
    const f = takeHandOff();
    // Not cancelled on cleanup: the file is taken once, so it must be read once.
    if (f) setTimeout(() => void read(f), 0);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Import" on a file a client sent: read it as if it had been dropped here.
  useEffect(() => {
    const onUpload = (e: Event) => {
      const { file: f, uploadId: id } = (e as CustomEvent<ImportUploadDetail>).detail;
      setUploadId(id);
      void read(f, id);
    };
    window.addEventListener(IMPORT_UPLOAD_EVENT, onUpload);
    return () => window.removeEventListener(IMPORT_UPLOAD_EVENT, onUpload);
  });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void read(e.dataTransfer.files[0]);
  };

  if (resume && !file && !error) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Reopening {resume.fileName}…</div>;
  }

  // Step 1: account, then file.
  if (!file || !mapping) {
    return (
      <div className="space-y-6">
        <PageHeader title="Import a statement" subtitle="Nothing is added to your books until you review and confirm."
          actions={<Stepper steps={IMPORT_STEPS} current={1} />} />
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
          <section className="surface space-y-5 p-6">
            <fieldset className="space-y-3">
              <legend className="mb-3 text-[15px] font-semibold">1. Which account is this statement for?</legend>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Money account">
                {accounts.map((a) => {
                  const on = a.id === accountId;
                  const card = a.kind === "credit_card";
                  return (
                    <label key={a.id} data-testid="account-tile"
                      className={cn("relative flex cursor-pointer flex-col gap-1 rounded-2xl border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                        on ? "border-brand bg-brand-soft" : "bg-card hover:bg-surface-muted/60", (!hydrated || reading) && "pointer-events-none opacity-70")}>
                      <input type="radio" name="import-account" value={a.id} checked={on} className="sr-only"
                        disabled={!hydrated || reading} onChange={() => setAccountId(a.id)} aria-label={a.name} />
                      <span className={cn("mb-2 grid size-8 place-items-center rounded-lg", card ? "bg-money-out-soft text-money-out" : "bg-money-in-soft text-money-in-text")}>
                        <RailMoneyAccountsIcon className="size-4" />
                      </span>
                      <span className={cn("absolute top-4 right-4 grid size-4 place-items-center rounded-full border", on ? "border-brand" : "border-muted-foreground/60")} aria-hidden>
                        {on && <span className="size-2 rounded-full bg-brand" />}
                      </span>
                      <span className="font-semibold">{a.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.last4 ? `··${a.last4} · ` : ""}{MONEY_KIND_LABEL[a.kind as MoneyKind] ?? a.kind}
                      </span>
                      <span className={cn("mt-2 text-xs", a.stale ? "font-medium text-attention-text" : "text-muted-foreground")} data-testid="tile-freshness">
                        {a.freshness}{a.stale && a.freshness !== "Never imported" ? " · due" : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-3">
              <h2 className="text-[15px] font-semibold">2. Add the statement</h2>
              <label htmlFor="import-file"
                onDragOver={(e) => { e.preventDefault(); if (account) setDragging(true); }}
                onDragLeave={() => setDragging(false)} onDrop={account ? onDrop : (e) => e.preventDefault()}
                className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand/25 px-6 py-12 text-center transition-colors",
                  account ? "cursor-pointer hover:bg-brand-soft/50" : "cursor-not-allowed opacity-50", dragging && "border-brand bg-brand-soft")}
                data-testid="dropzone">
                <span className="mb-2 grid size-12 place-items-center rounded-xl border bg-card text-brand">
                  {reading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <RailImportIcon className="size-5" />}
                </span>
                <span className="text-[15px] font-semibold">
                  {reading ? "Reading the file…" : account ? `Drop your ${account.name} statement here` : "Pick the account first"}
                </span>
                <span className="text-[13px] text-muted-foreground">or click to choose a file · the PDF statement, or a CSV or Excel download, from any bank</span>
                <input id="import-file" type="file" accept=".pdf,application/pdf,.csv,text/csv,.txt,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={!hydrated || !account || reading}
                  onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              {error && (
                <p role="alert" className="flex items-start gap-2 rounded-xl bg-money-out-soft p-3 text-sm text-money-out-text">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
                </p>
              )}
              <p className="text-xs text-muted-foreground">We remember each account&apos;s columns, so the next statement from the same bank skips straight to review.</p>
              <PrivacyNote />
            </div>
          </section>
          {aside}
        </div>
      </div>
    );
  }

  return (
    <MappingStep
      account={account!} fileName={file.name} parsed={file.parsed} mapping={mapping} guessed={guessed}
      continuing={continuing} saveMapping={saveMapping} onSaveMappingChange={setSaveMapping}
      statement={statement && file.parsed.statement ? (
        <StatementCheck parsed={file.parsed} mapping={mapping} accountKind={account!.kind}
          onPick={(i) => setFile({ ...file, parsed: pickStatementAccount(statement, i) })} />
      ) : undefined}
      onContinue={async () => {
        setContinuing(true);
        if (saveMapping) {
          const r = await saveTemplate(businessId, { money_account_id: account!.id, header_signature: file.parsed.signature, mapping });
          if (!r.ok) toast.error(`Couldn't save the columns: ${r.error}`);
        }
        if (!(await stage(file.raw, mapping, replaceBatchId))) setContinuing(false);
      }}
      onChange={(patch, fields) => {
        setMapping({ ...mapping, ...patch });
        setGuessed((g) => { const next = new Set(g); for (const f of fields) next.delete(f); return next; });
      }}
      onBack={() => { setFile(null); setMapping(null); setStatement(null); }}
    />
  );
}

/** What happens to a statement, in plain words, under the drop zone. */
function PrivacyNote() {
  return (
    <div className="flex gap-3 rounded-2xl bg-surface-muted p-4 text-[13px]" data-testid="privacy-note">
      <Lock className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">Your statements stay private</p>
        <p className="text-muted-foreground">
          The file is read on our own servers. It&apos;s never sent to an AI service, and the file itself isn&apos;t kept, only the
          transactions you import. Category suggestions look at each transaction&apos;s description, amount and date, never account
          numbers, balances or the statement.
        </p>
      </div>
    </div>
  );
}

/**
 * For a PDF statement: which account (combined statements), and whether the rows add up from
 * the statement's beginning balance to its ending balance. That catches a missed or doubled row.
 */
function StatementCheck({ parsed, mapping, accountKind, onPick }: {
  parsed: ParsedFile; mapping: Mapping; accountKind: string; onPick: (index: number) => void;
}) {
  const st = parsed.statement!;
  const current = st.account ?? 0;
  const a = st.accounts[current];
  const mapped = useMemo(() => applyMapping(parsed.rows, mapping), [parsed.rows, mapping]);
  const net = sumCents(mapped.map((r) => r.amount_cents ?? 0));
  const opening = a?.opening ? tryParseCents(a.opening) : null;
  const closing = a?.closing ? tryParseCents(a.closing) : null;
  const owed = accountKind === "credit_card" || accountKind === "loan";
  // Cards and loans print what's owed, so money out raises the balance.
  const expected = opening === null ? null : owed ? opening - net : opening + net;
  const adds = expected !== null && closing !== null && Math.abs(expected - closing) <= 1;
  return (
    <section className="surface space-y-3 p-5" aria-label="Statement check" data-testid="statement-check">
      {st.accounts.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="statement-account" className="text-sm font-medium">This statement covers {st.accounts.length} accounts. Import:</label>
          <NativeSelect id="statement-account" className="w-auto min-w-72" value={current} onChange={(e) => onPick(Number(e.target.value))}>
            {st.accounts.map((x, i) => <option key={i} value={i}>{x.label}</option>)}
          </NativeSelect>
        </div>
      )}
      {opening !== null && closing !== null ? (
        <p className={cn("flex items-start gap-2 text-sm", adds ? "text-money-in-text" : "text-attention-text")} role="status" data-testid="statement-balance">
          {adds ? "✓" : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span>
            Beginning balance {formatCents(opening)}, {mapped.length} transactions, ending balance {formatCents(closing)}.{" "}
            {adds ? "Every row is accounted for." : `The rows come to ${formatCents(expected!)}, ${formatCents(Math.abs(expected! - closing))} off. Check the amount columns, or flip signs.`}
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{mapped.length} transactions found. The statement&apos;s balances weren&apos;t readable, so check the totals on the next step.</p>
      )}
    </section>
  );
}

export function MappingStep({
  account, fileName, parsed, mapping, guessed, continuing, saveMapping, onSaveMappingChange, onChange, onBack, onContinue, statement,
}: {
  account: ImportAccount;
  /** PDF statements: the account picker and balance check. */
  statement?: ReactNode;
  fileName: string;
  parsed: ParsedFile;
  mapping: Mapping;
  guessed: Set<GuessedField>;
  continuing: boolean;
  saveMapping: boolean;
  onSaveMappingChange: (v: boolean) => void;
  onContinue: () => void;
  onChange: (patch: Partial<Mapping>, fields: GuessedField[]) => void;
  onBack: () => void;
}) {
  const { headers, rows } = parsed;
  const [view, setView] = useState<"mapped" | "raw">("mapped");
  const preview = useMemo(() => applyMapping(rows.slice(0, 6), mapping), [rows, mapping]);
  const problems = mappingProblems(mapping);
  const dates = useMemo(() => (mapping.date === null ? null : detectDateFormat(rows.map((r) => r[mapping.date!] ?? ""))), [rows, mapping.date]);
  const ambiguous = !!dates?.ambiguous && !!mapping.dateFormat && /^(MM|DD)\//.test(mapping.dateFormat);
  const isGuessed = (f: GuessedField) => guessed.has(f);

  const column = (field: ColumnField, required = false) => (
    <ColumnRow key={field} field={field} headers={headers} value={mapping[field]} required={required} guessed={isGuessed(field)}
      onChange={(v) => {
        const patch: Partial<Mapping> = { [field]: v };
        if (field === "date") patch.dateFormat = v === null ? null : detectDateFormat(rows.map((r) => r[v] ?? "")).format;
        onChange(patch, [field, ...(field === "date" ? ["dateFormat" as const] : [])]);
      }} />
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Match the columns"
        subtitle={<span data-testid="file-summary">{account.name} · {fileName} · {rows.length.toLocaleString("en-US")} rows
          {parsed.preamble.length > 0 && ` · skipped ${parsed.preamble.length} line${parsed.preamble.length === 1 ? "" : "s"} above the header`}</span>}
        actions={<Stepper steps={IMPORT_STEPS} current={2} />} />

      <p role="status" className="rounded-xl bg-brand-soft px-4 py-3 text-sm" data-testid="guess-note">
        {guessed.size > 0
          ? <>Columns guessed from the file headers. Check the ones marked <strong className="font-medium">Guessed</strong> against the preview.</>
          : <>Check each column against the preview.</>}
        {" "}Save the mapping and future {account.name} statements go straight to review.
      </p>
      {statement}

      <div className="grid items-start gap-4 lg:grid-cols-[440px_1fr]">
        <section className="surface p-5" aria-labelledby="map-title">
          <h2 id="map-title" className="mb-4 text-[15px] font-semibold">Which column is which?</h2>
          <div className={cn("mb-2 inline-flex rounded-full", isGuessed("amountMode") && "ring-2 ring-attention/40")}>
            <PillTabs label="How are amounts shown?" value={mapping.amountMode}
              onChange={(v: AmountMode) => onChange({ amountMode: v }, ["amountMode"])}
              options={[{ value: "signed", label: "One amount column" }, { value: "split", label: "Separate in & out" }]} />
          </div>
          <div className="divide-y">
            {column("date", true)}
            {column("description", true)}
            {mapping.amountMode === "signed" ? column("amount", true) : <>{column("debit", true)}{column("credit", true)}</>}
            {column("memo")}
            {column("reference")}
            <Row label="Date format" required guessed={isGuessed("dateFormat")} htmlFor="map-date-format">
              <NativeSelect id="map-date-format" value={mapping.dateFormat ?? ""}
                onChange={(e) => onChange({ dateFormat: (e.target.value || null) as DateFormat | null }, ["dateFormat"])}>
                <option value="">Pick a format</option>
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>{f} (e.g. {DATE_FORMAT_EXAMPLE[f]}){dates?.candidates.includes(f) ? "" : " — doesn't fit"}</option>
                ))}
              </NativeSelect>
            </Row>
          </div>
          {ambiguous && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-attention-soft p-3 text-xs text-attention-text" role="alert" data-testid="date-ambiguous">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              Every day in this file is 12 or less, so 01/02 could be January 2 or February 1. Check the preview dates and
              switch between MM/DD and DD/MM if they look wrong.
            </p>
          )}
          {mapping.amountMode === "signed" && (
            <p className={cn("mt-4 text-[13px] text-muted-foreground", isGuessed("signConvention") && "rounded-lg bg-attention-soft px-2 py-1 text-attention-text")} data-testid="sign-note">
              Money in is {mapping.signConvention === "positive_in" ? "positive" : "negative"} in this file.{" "}
              <button type="button" className="font-medium text-brand hover:underline" data-testid="flip-signs"
                onClick={() => onChange({ signConvention: mapping.signConvention === "positive_in" ? "positive_out" : "positive_in" }, ["signConvention"])}>
                Flip signs
              </button>
            </p>
          )}
          <details className="mt-4 rounded-xl border px-4 py-2 text-sm" data-testid="more-columns">
            <summary className="cursor-pointer py-1 font-medium text-muted-foreground">More columns: category, balance, extra description</summary>
            <div className="divide-y">{column("category")}{column("balance")}{column("description2")}</div>
          </details>
        </section>

        <section className="surface overflow-hidden" aria-labelledby="preview-title">
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
            <div>
              <h2 id="preview-title" className="text-[15px] font-semibold">How the rows will read</h2>
              <p className="text-xs text-muted-foreground">First {Math.min(6, rows.length)} of {rows.length.toLocaleString("en-US")} rows with this mapping</p>
            </div>
            <PillTabs label="Preview" value={view} onChange={setView} options={[{ value: "mapped", label: "Mapped" }, { value: "raw", label: "Your file" }]} />
          </div>
          <div className="overflow-x-auto">
            {view === "raw" ? (
              <table className="w-full text-xs" data-testid="raw-preview">
                <thead className="bg-surface-muted"><tr>{headers.map((h, i) => <th key={i} className="h-9 px-3 text-left font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(0, 6).map((r, ri) => (
                    <tr key={ri} className="border-t">{headers.map((_, ci) => <td key={ci} className="max-w-56 truncate px-3 py-2">{r[ci]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            ) : problems.length > 0 ? (
              <ul className="list-inside list-disc px-5 pb-5 text-sm text-muted-foreground" data-testid="mapping-problems">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            ) : (
              <table className="w-full text-sm" data-testid="parsed-preview">
                <thead className="bg-surface-muted text-left text-[13px] text-muted-foreground">
                  <tr className="[&_th]:h-9 [&_th]:font-normal">
                    <th className="pl-5">Date</th><th className="px-3">Description</th><th className="px-3">Reference</th><th className="pr-5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.index} className="h-[39px] border-t" data-testid="parsed-row">
                      <td className="pl-5 whitespace-nowrap text-muted-foreground tabular-nums">{r.date ? longDate(r.date) : "—"}</td>
                      <td className="max-w-80 truncate px-3">{r.description}{r.problems.length > 0 && <span className="block text-xs text-attention-text">{r.problems.map((p) => p.message).join("; ")}</span>}</td>
                      <td className="px-3 text-muted-foreground">{r.reference || "—"}</td>
                      <td className={cn("pr-5 text-right font-medium tabular-nums", r.amount_cents !== null && r.amount_cents !== 0 && (r.amount_cents > 0 ? "text-money-in-text" : "text-money-out-text"))}>
                        {r.amount_cents === null ? "—" : formatCents(r.amount_cents, { signPositive: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={saveMapping} onCheckedChange={(c) => onSaveMappingChange(!!c)} data-testid="save-mapping" />
          Save mapping for {account.name}
        </label>
        <Button disabled={continuing || problems.length > 0} onClick={onContinue} data-testid="continue-to-review">
          {continuing ? <><Loader2 className="animate-spin" aria-hidden /> Checking {rows.length.toLocaleString("en-US")} rows…</> : "Continue to review"}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, required, guessed, htmlFor, children }: { label: string; required: boolean; guessed: boolean; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr_auto] items-center gap-3 py-3" data-guessed={guessed || undefined}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        <span className="block text-xs font-normal text-muted-foreground">{required ? "Required" : "Optional"}</span>
      </label>
      {children}
      <span className={cn("rounded-md bg-surface-muted px-1.5 py-0.5 text-xs font-medium", !guessed && "invisible")}>Guessed</span>
    </div>
  );
}

function ColumnRow({ field, headers, value, required, guessed, onChange }: {
  field: ColumnField; headers: string[]; value: number | null; required: boolean; guessed: boolean; onChange: (v: number | null) => void;
}) {
  const id = `map-${field}`;
  return (
    <Row label={FIELD_LABEL[field]} required={required} guessed={guessed} htmlFor={id}>
      <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
        <option value="">{required ? "Pick a column" : "Not in this file"}</option>
        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
      </NativeSelect>
    </Row>
  );
}

function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
