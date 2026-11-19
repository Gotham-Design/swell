// Fixed-window rate limits, counted in Postgres (`public.rate_limit_hit`) so they hold across
// serverless instances and any host. Runs as the `rate-limit` named server job: the counter
// table is private and only the service role may call the function.
import "server-only";
import { headers } from "next/headers";
import { getUser } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

export type Limit = { bucket: string; max: number; windowSeconds: number };

// One place for every limit, so they're easy to review and tune.
export const LIMITS = {
  signInPerIp: { bucket: "sign-in:ip", max: 10, windowSeconds: 15 * 60 },
  signInPerEmail: { bucket: "sign-in:email", max: 5, windowSeconds: 60 * 60 },
  invitePerUser: { bucket: "invite:user", max: 30, windowSeconds: 60 * 60 },
  requestEmailPerUser: { bucket: "statement-request:user", max: 30, windowSeconds: 60 * 60 },
  uploadPerIp: { bucket: "client-upload:ip", max: 60, windowSeconds: 60 * 60 },
  aiPerUser: { bucket: "ai:user", max: 30, windowSeconds: 10 * 60 },
  importPerUser: { bucket: "import:user", max: 60, windowSeconds: 10 * 60 },
  exportPerUser: { bucket: "export:user", max: 30, windowSeconds: 10 * 60 },
  createBusinessPerUser: { bucket: "create-business:user", max: 20, windowSeconds: 24 * 60 * 60 },
} satisfies Record<string, Limit>;

export const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

/** The caller's IP. On Vercel these headers are set by the platform, not the client. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || h.get("x-real-ip")?.trim()
    || h.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

/**
 * Count one hit against `limit` for `key`; true while under the limit. If the counter can't be
 * reached it lets the request through (and logs), so an outage doesn't lock everyone out.
 */
export async function allow(limit: Limit, key: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient("rate-limit").rpc("rate_limit_hit", {
      p_bucket: limit.bucket, p_key: key.toLowerCase(), p_max: limit.max, p_window_seconds: limit.windowSeconds,
    });
    if (error) throw error;
    return data !== false;
  } catch (e) {
    console.error(`rate limit check failed (${limit.bucket}):`, e instanceof Error ? e.message : e);
    return true;
  }
}

/** True when every limit allows its key (each is counted). */
export async function allowAll(checks: [Limit, string][]): Promise<boolean> {
  const results = await Promise.all(checks.map(([l, k]) => allow(l, k)));
  return results.every(Boolean);
}

/** Count one hit for the signed-in user. */
export async function allowForUser(limit: Limit): Promise<boolean> {
  return allow(limit, (await getUser()).id);
}
