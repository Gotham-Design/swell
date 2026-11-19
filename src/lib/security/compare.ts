import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison (hashing first so length differences don't leak either). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** True when a state-changing request came from this site (Origin, else Referer, matches Host). */
export function sameOrigin(request: Request): boolean {
  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) return false;
  try {
    return new URL(source).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
