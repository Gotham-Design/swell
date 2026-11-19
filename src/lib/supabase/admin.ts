// Service-role client: BYPASSES RLS. Only for named server jobs (see CLAUDE.md); never
// for handling a user's request on their behalf.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env/public";
import { serverEnv } from "@/lib/env/server";
import type { Database } from "./database.types";

export function createAdminClient(job: string) {
  if (!job) throw new Error("Name the server job that needs the service-role client.");
  return createClient<Database>(publicEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-quick-acct-job": job } },
  });
}
