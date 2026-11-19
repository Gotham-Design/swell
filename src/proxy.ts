import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const LAST_BUSINESS_COOKIE = "qa_last_business";
const PUBLIC_PATHS = ["/login", "/auth/", "/r/", "/api/cron/", ...(process.env.NODE_ENV === "development" ? ["/dev/"] : [])];
const BUSINESS_PATH = /^\/b\/([0-9a-f-]{36})(?:\/|$)/i;

// Optimistic checks only: every page and action still reads data as the user under RLS.
export async function proxy(request: NextRequest) {
  const { supabase, user, response } = await updateSession(request);
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));

  const redirect = (to: string) => {
    const res = NextResponse.redirect(new URL(to, request.url));
    for (const c of response().cookies.getAll()) res.cookies.set(c);
    return res;
  };

  // A sign-in link that landed on the Site URL instead of /auth/confirm (Supabase falls back
  // to it when the redirect isn't allow-listed): pass its code or token on.
  const sp = request.nextUrl.searchParams;
  if (pathname === "/" && (sp.has("code") || sp.has("token_hash"))) {
    return redirect(`/auth/confirm?${sp}`);
  }

  if (!user) {
    if (isPublic) return response();
    return redirect("/login");
  }
  if (pathname === "/login") return redirect("/");

  // "/" goes to the last business used, else the first one, else onboarding. Pending
  // invites are picked up here too, so an already-signed-in invitee sees new businesses.
  if (pathname === "/") {
    await supabase.rpc("accept_my_invites");
    const { data: memberships } = await supabase
      .from("business_members").select("business_id, created_at, businesses(archived_at)").eq("user_id", user.id).order("created_at");
    // Archived businesses are skipped unless they're all there is.
    const live = (memberships ?? []).filter((m) => !m.businesses?.archived_at);
    if (!memberships?.length) return redirect("/new");
    if (!live.length) return redirect("/new");
    const last = request.cookies.get(LAST_BUSINESS_COOKIE)?.value;
    const target = live.find((m) => m.business_id === last) ?? live[0];
    return redirect(`/b/${target.business_id}`);
  }

  const match = pathname.match(BUSINESS_PATH);
  const res = response();
  if (match) res.cookies.set(LAST_BUSINESS_COOKIE, match[1], { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
