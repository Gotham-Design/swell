// Email links land here. Two shapes:
//  - ?token_hash=&type=  from our templates (supabase/templates/); works in any browser.
//  - ?code=              from Supabase's default template (PKCE): exchanged for a session;
//                        only works in the browser that asked for the link.
// Either sets the session cookies; then pending invites are accepted and "/" routes on.
import { type NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["magiclink", "signup", "email", "invite"];

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next");
  // Only same-site paths; "//evil.com" and "/\evil.com" are protocol-relative.
  const safeNext = next && /^\/(?![/\\])/.test(next) ? next : "/";

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      await supabase.rpc("accept_my_invites");
      return NextResponse.redirect(new URL(safeNext, request.url));
    }
  }
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await supabase.rpc("accept_my_invites");
      return NextResponse.redirect(new URL(safeNext, request.url));
    }
    return NextResponse.redirect(new URL("/login?error=browser", request.url));
  }
  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
