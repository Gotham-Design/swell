import { Suspense } from "react";
import { FormAlert } from "@/components/form-alert";
import { Logo } from "@/components/brand/logo";
import { LoginDemo } from "./demo";
import { LoginForm } from "./login-form";
import { BRAND_NAME } from "@/lib/theme";

const LINK_ERRORS: Record<string, string> = {
  link: "That sign-in link is invalid or has expired. Request a new one.",
  browser: "That link has to be opened in the browser you requested it from. Request a new one here, or open the link in this browser.",
};

// The form is part of the static shell; only the link-error note waits on the URL, so
// streaming never swaps out a form someone has started typing in.
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid min-h-dvh flex-1 bg-card lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12 sm:py-10">
        <Logo />
        <div className="mx-auto my-auto w-full max-w-[360px] py-16 lg:mx-0 lg:ml-[96px]">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">Welcome back</h1>
          <p className="mt-1.5 text-[15px] text-muted-foreground">Sign in with your email. We&apos;ll send you a link.</p>
          <div className="mt-9 space-y-4">
            <Suspense fallback={null}>
              <LinkError searchParams={searchParams} />
            </Suspense>
            <LoginForm />
          </div>
        </div>
        <p className="text-[13px] text-muted-foreground">© 2026 {BRAND_NAME}</p>
      </div>
      <Showcase />
    </main>
  );
}

async function LinkError({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { error } = await searchParams;
  return <FormAlert error={typeof error === "string" ? LINK_ERRORS[error] : undefined} />;
}

/** The evergreen half: what the product does, shown with a sample import. Decorative. */
function Showcase() {
  return (
    <aside className="relative my-4 mr-4 hidden flex-col overflow-hidden rounded-[20px] bg-brand p-16 pb-12 text-white lg:flex" aria-label={`About ${BRAND_NAME}`}>
      <h2 className="text-[48px] font-semibold leading-[1.1] tracking-[-0.03em]">
        Statements in,<br />clean books out.
      </h2>
      <p className="mt-7 max-w-[440px] text-[17px] leading-relaxed text-white/75">
        Upload a bank statement, check the few it flags, and your client&apos;s month is done.
      </p>
      <LoginDemo />
    </aside>
  );
}
