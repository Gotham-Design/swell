import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** A new link token (256 bits, URL-safe) and the hash we store. The token itself is never stored. */
export function newRequestToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRequestToken(token) };
}

export function hashRequestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Tokens are 43 URL-safe characters; anything else is refused before touching the database. */
export const isRequestToken = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s);
