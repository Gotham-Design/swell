// Server-only secrets. `server-only` makes `next build` fail if this module is imported,
// directly or transitively, from a Client Component; scripts/check-client-bundle.mjs
// double-checks the built browser bundle after every build.
import "server-only";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}. Set it in .env.local (never NEXT_PUBLIC_).`);
  return value;
}

// Getters, so a missing key fails the request that needs it rather than the whole build.
export const serverEnv = {
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
  /** Whether an Anthropic key is set (features that can do without it check this first). */
  get hasAnthropicKey() {
    return !!process.env.ANTHROPIC_API_KEY;
  },
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);
  },
  /** Jev (TypeSafe) key. When set, Jev answers category suggestions instead of Anthropic. */
  get typesafeApiKey() {
    return process.env.TYPESAFE_API_KEY || undefined;
  },
  /** Jev model id; defaults to jev-latest. Pin a version (e.g. jev-1.13.0) for steady results. */
  get jevModel() {
    return process.env.JEV_MODEL || undefined;
  },
  /** "jev" (default when a TypeSafe key is set) or "anthropic". */
  get aiProvider(): "jev" | "anthropic" {
    const pick = process.env.AI_PROVIDER;
    if (pick === "anthropic" || pick === "jev") return pick;
    return process.env.TYPESAFE_API_KEY ? "jev" : "anthropic";
  },
  /** Default model for category suggestions (a business setting can override it). */
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL || undefined;
  },
  /** Resend key for app emails (recurring statement requests). Unset: nothing is emailed. */
  get resendApiKey() {
    return process.env.RESEND_API_KEY || undefined;
  },
  /** The From line, e.g. "Swell <statements@mail.example.com>" (a Resend-verified domain). */
  get emailFrom() {
    return process.env.EMAIL_FROM || undefined;
  },
  get canSendEmail() {
    return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
  },
  /** Vercel sends it as a Bearer token on cron calls; other callers are turned away. */
  get cronSecret() {
    return process.env.CRON_SECRET || undefined;
  },
  /** The site's address for links in emails sent by server jobs (defaults to the request's origin). */
  get appOrigin() {
    return process.env.APP_ORIGIN || undefined;
  },
};
