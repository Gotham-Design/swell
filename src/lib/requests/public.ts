// The client side of a statement request: no sign-in, so it runs as the named server job
// `statement-request` (service role). Every read and write here is scoped to the one request
// whose token hash matches, and only while it's open.
import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_UPLOADS_PER_REQUEST, safeFileName, statementFileType } from "./files";
import { hashRequestToken, isRequestToken } from "./token";

const BUCKET = "client-statements";
const job = () => createAdminClient("statement-request");

export type OpenRequest = {
  id: string; businessId: string; businessName: string; fromName: string; note: string | null;
  expiresAt: string; accounts: { name: string; last4: string | null }[];
  uploads: { fileName: string; uploadedAt: string }[];
};

export type RequestLookup = { ok: true; request: OpenRequest } | { ok: false; reason: "missing" | "expired" | "revoked" };

export async function openRequest(token: string): Promise<RequestLookup> {
  if (!isRequestToken(token)) return { ok: false, reason: "missing" };
  const db = job();
  const { data: r } = await db.from("statement_requests")
    .select("id, business_id, from_name, note, account_ids, expires_at, revoked_at")
    .eq("token_hash", hashRequestToken(token)).maybeSingle();
  if (!r) return { ok: false, reason: "missing" };
  if (r.revoked_at) return { ok: false, reason: "revoked" };
  if (Date.parse(r.expires_at) <= Date.now()) return { ok: false, reason: "expired" };
  const [business, accounts, uploads] = await Promise.all([
    db.from("businesses").select("name, archived_at").eq("id", r.business_id).single(),
    r.account_ids.length
      ? db.from("accounts").select("name, last4").eq("business_id", r.business_id).in("id", r.account_ids)
      : Promise.resolve({ data: [] as { name: string; last4: string | null }[] }),
    db.from("statement_uploads").select("file_name, uploaded_at").eq("business_id", r.business_id).eq("request_id", r.id)
      .order("uploaded_at"),
  ]);
  if (!business.data || business.data.archived_at) return { ok: false, reason: "revoked" };
  return {
    ok: true,
    request: {
      id: r.id, businessId: r.business_id, businessName: business.data.name, fromName: r.from_name, note: r.note,
      expiresAt: r.expires_at, accounts: accounts.data ?? [],
      uploads: (uploads.data ?? []).map((u) => ({ fileName: u.file_name, uploadedAt: u.uploaded_at })),
    },
  };
}

/** Store one file for an open request. Returns a message for the client on refusal. */
export async function storeUpload(token: string, file: File): Promise<{ ok: true; fileName: string } | { ok: false; error: string }> {
  const found = await openRequest(token);
  if (!found.ok) return { ok: false, error: "This link is no longer open. Ask your accountant for a new one." };
  const r = found.request;
  if (r.uploads.length >= MAX_UPLOADS_PER_REQUEST) {
    return { ok: false, error: `This link has already received ${MAX_UPLOADS_PER_REQUEST} files. Ask your accountant for a new one.` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = statementFileType(bytes);
  if ("error" in kind) return { ok: false, error: kind.error };

  const name = safeFileName(file.name);
  const path = `${r.businessId}/${r.id}/${randomUUID()}-${name}`;
  const db = job();
  const stored = await db.storage.from(BUCKET).upload(path, bytes, { contentType: kind.type, upsert: false });
  if (stored.error) {
    console.error("statement upload failed:", stored.error.message);
    return { ok: false, error: "That file didn't upload. Please try again." };
  }
  const { error } = await db.from("statement_uploads").insert({
    business_id: r.businessId, request_id: r.id, file_name: name, file_size_bytes: bytes.byteLength,
    content_type: kind.type, storage_path: path,
  });
  if (error) {
    await db.storage.from(BUCKET).remove([path]);
    console.error("statement upload record failed:", error.message);
    return { ok: false, error: "That file didn't upload. Please try again." };
  }
  return { ok: true, fileName: name };
}
