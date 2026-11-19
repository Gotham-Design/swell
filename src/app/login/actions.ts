"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, parseForm, type FormState } from "@/lib/validation/business";
import { allowAll, clientIp, LIMITS, TOO_MANY } from "@/lib/security/rate-limit";

export async function sendMagicLink(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(loginSchema, formData);
  if (parsed.state) return parsed.state;
  if (!(await allowAll([[LIMITS.signInPerIp, await clientIp()], [LIMITS.signInPerEmail, parsed.data.email]]))) {
    return { error: TOO_MANY };
  }

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) return { error: error.message };
  return { ok: true, message: parsed.data.email };
}
