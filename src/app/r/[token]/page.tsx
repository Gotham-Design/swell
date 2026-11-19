import { Suspense } from "react";
import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { openRequest } from "@/lib/requests/public";
import { ClientUpload } from "./client-upload";

export const metadata: Metadata = {
  title: "Send your statements",
  // A private link: keep it out of search engines and away from link previews.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function RequestPage({ params }: PageProps<"/r/[token]">) {
  return (
    <main className="min-h-dvh flex-1 bg-background px-4 pb-16 sm:px-10">
      <header className="flex items-center justify-between py-7">
        <Logo />
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <LockIcon /> Private, encrypted upload
        </span>
      </header>
      <Suspense fallback={<div className="mx-auto h-96 max-w-5xl animate-pulse rounded-2xl bg-surface-muted" />}>
        <Request params={params} />
      </Suspense>
    </main>
  );
}

async function Request({ params }: Pick<PageProps<"/r/[token]">, "params">) {
  const { token } = await params;
  const found = await openRequest(token);
  if (!found.ok) {
    const copy = {
      missing: ["This link doesn't work", "It may have been copied incompletely. Ask your accountant to send it again."],
      expired: ["This link has expired", "For your security, upload links only stay open for a short time. Ask your accountant for a new one."],
      revoked: ["This link was closed", "Your accountant closed it. If you still need to send statements, ask them for a new link."],
    }[found.reason];
    return (
      <section className="surface mx-auto max-w-lg p-8 text-center" data-testid="request-closed">
        <h1 className="text-[22px] font-semibold">{copy[0]}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{copy[1]}</p>
      </section>
    );
  }
  const r = found.request;
  const until = new Date(r.expiresAt).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return (
    <div className="mx-auto grid max-w-5xl items-start gap-5 lg:grid-cols-[1fr_340px]">
      <section className="surface space-y-5 p-6 sm:p-8">
        <div>
          <p className="text-[13px] text-muted-foreground">Statement request for {r.businessName}</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{r.fromName} asked you to send your statements</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Drop in the statements from your bank or card company. That&apos;s it: no account to create, nothing to sign in to.
          </p>
        </div>
        {r.note && (
          <blockquote className="rounded-xl border-l-4 border-brand bg-brand-soft px-4 py-3 text-sm" data-testid="request-note">
            <span className="block text-xs font-medium text-brand">Note from {r.fromName}</span>
            {r.note}
          </blockquote>
        )}
        {r.accounts.length > 0 && (
          <div>
            <h2 className="text-sm font-medium">Statements requested</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {r.accounts.map((a) => (
                <li key={`${a.name}${a.last4}`} className="rounded-lg bg-surface-muted px-2.5 py-1 text-xs">
                  {a.name}{a.last4 ? ` ··${a.last4}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ClientUpload token={(await params).token} sent={r.uploads} accountantName={r.fromName} />
        <p className="text-xs text-muted-foreground">This link works until {until}.</p>
      </section>

      <aside className="surface space-y-4 p-6" aria-labelledby="safety">
        <h2 id="safety" className="flex items-center gap-2 text-[15px] font-semibold"><LockIcon /> How your statements are kept safe</h2>
        <ul className="space-y-3 text-sm">
          {[
            ["Private to you", "This link was made for you alone, can't be guessed, and stops working on " + until + "."],
            ["Encrypted all the way", "Files travel over an encrypted connection and are stored encrypted."],
            [`Only ${r.fromName} can open them`, "Nobody else, including other clients, can see or download what you send."],
            ["Never sent to an AI service", "Your statements are read on our own servers. They aren't uploaded to ChatGPT, Claude or any similar service."],
            ["Deleted once they're in", "The files are removed as soon as your accountant has imported them."],
            ["No bank login, ever", "We'll never ask for your bank username or password. Just the statement files."],
          ].map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-money-in-soft text-[11px] text-money-in-text" aria-hidden>✓</span>
              <span><span className="block font-medium">{title}</span><span className="text-muted-foreground">{body}</span></span>
            </li>
          ))}
        </ul>
        <p className="border-t pt-3 text-xs text-muted-foreground">
          Safer than email: attachments sit in inboxes for years. Here, the files go straight to your accountant&apos;s books.
        </p>
      </aside>
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 text-brand" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
