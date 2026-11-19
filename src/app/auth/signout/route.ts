import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/security/compare";

export async function POST(request: NextRequest) {
  // A form on another site must not be able to sign people out (CSRF).
  if (!sameOrigin(request)) return new Response("Not allowed", { status: 403 });
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
