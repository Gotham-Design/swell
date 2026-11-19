"use server";

import { storeUpload } from "@/lib/requests/public";
import { allow, clientIp, LIMITS, TOO_MANY } from "@/lib/security/rate-limit";

export type UploadResult = { ok: true; fileName: string } | { ok: false; error: string };

/** A client sends one statement file through their private link. */
export async function uploadStatement(token: string, formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a file to send." };
  if (!(await allow(LIMITS.uploadPerIp, await clientIp()))) return { ok: false, error: TOO_MANY };
  return storeUpload(token, file);
}
