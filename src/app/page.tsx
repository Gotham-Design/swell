import Link from "next/link";
import { BRAND_NAME } from "@/lib/theme";

// The proxy redirects "/" to your last business (or onboarding) before this renders.
// This only shows if that redirect couldn't happen.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-2 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">{BRAND_NAME}</h1>
      <p className="text-muted-foreground"><Link className="underline" href="/login">Sign in</Link> to continue.</p>
    </main>
  );
}
