// Shared e2e helpers: real magic-link sign-in through the local Mailpit inbox, and a
// service-role fixture writer for data the UI can't create yet (named server job: e2e).
import { expect, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "../src/lib/supabase/database.types";

loadEnvConfig(process.cwd(), false, { info() {}, error: console.error });
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:58324";

/** A fresh address per test run, so inboxes and accounts never collide. */
export function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

/**
 * Newest sign-in link Mailpit received for this address after `since`, as a path, so it
 * opens on whichever server the tests run against (emails point at the dev port).
 */
export async function latestLink(email: string, since = 0): Promise<string> {
  let link: string | undefined;
  await expect.poll(async () => {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages = [] } = (await res.json()) as { messages?: { ID: string; Created: string }[] };
    const fresh = messages.find((m) => Date.parse(m.Created) >= since);
    if (!fresh) return undefined;
    const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as { HTML: string };
    link = msg.HTML.match(/href="([^"]*token_hash[^"]*)"/)?.[1]?.replaceAll("&amp;", "&");
    return link;
  }, { message: `sign-in email for ${email}`, timeout: 15_000 }).toBeTruthy();
  const url = new URL(link!);
  return url.pathname + url.search;
}

/** Sign in through the login form and the emailed link. Lands wherever "/" routes. */
export async function signIn(page: Page, email: string) {
  const since = Date.now() - 1000;
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.goto(await latestLink(email, since));
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Sign in without the email round trip, for tests that aren't about signing in. The
 * session cookies come from @supabase/ssr itself (the library the app uses), so the app
 * sees an ordinary signed-in user. Auth flows keep using signIn().
 */
export async function signInDirect(page: Page, email: string) {
  const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  await admin.auth.admin.createUser({ email, email_confirm: true }); // already exists is fine
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const jar: { name: string; value: string }[] = [];
  const ssr = createServerClient<Database>(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => jar,
      setAll: (cookies) => {
        for (const c of cookies) {
          const i = jar.findIndex((j) => j.name === c.name);
          if (i >= 0) jar.splice(i, 1);
          if (c.value) jar.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  const { error: otpError } = await ssr.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (otpError) throw otpError;
  await page.context().addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: "localhost", path: "/", sameSite: "Lax" as const })));
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Create a business through the onboarding form; returns its id. Onboarding also creates the
 * first money account ("Business Checking" unless given) and lands on its import screen.
 */
export async function createBusiness(page: Page, name: string, account = "Business Checking"): Promise<string> {
  await page.goto("/new");
  await page.getByLabel("Business name").fill(name);
  await page.getByLabel("Where do their statements come from?").fill(account);
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/import\?account=/);
  return page.url().split("/b/")[1].split("/")[0];
}

/** Test fixture: insert a money account directly (the accounts UI arrives in Prompt 3). */
export async function seedMoneyAccount(businessId: string, name: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/accounts`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "x-quick-acct-job": "e2e-fixture",
    },
    body: JSON.stringify({ business_id: businessId, name, type: "asset", is_money_account: true }),
  });
  expect(res.status, await res.text()).toBe(201);
}

/**
 * A Supabase client signed in as this user (no email involved), for setting up data the
 * UI can't create yet. Everything it does runs under the user's own RLS and roles.
 */
export async function userClient(email: string): Promise<SupabaseClient<Database>> {
  const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: otpError } = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (otpError) throw otpError;
  return client;
}

/** Throw on a Supabase error or missing data; return the data otherwise. */
export function must<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  if (res.data == null) throw new Error("No data returned");
  return res.data;
}

/** Import step 1: pick the money account tile (its radio is visually hidden inside the tile). */
export async function chooseImportAccount(page: Page, name: string) {
  const tile = page.getByTestId("account-tile").filter({ visible: true }).filter({ has: page.getByRole("radio", { name, exact: true }) });
  await tile.click();
  await expect(tile.getByRole("radio")).toBeChecked();
}

/** Import step 1: hand the file to the (hidden) file input once the page is interactive. */
export async function chooseImportFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const input = page.locator("#import-file");
  await expect(input).toBeEnabled();
  await input.setInputFiles(file);
}

/**
 * From the mapping step (or straight from step 1 when the account has saved columns for this
 * layout) to the review screen. Returns the staged batch id.
 */
export async function continueToReview(page: Page): Promise<string> {
  const proceed = page.getByTestId("continue-to-review");
  await expect(proceed.or(page.getByTestId("review-footer"))).toBeVisible({ timeout: 20_000 });
  if (await proceed.isVisible()) await proceed.click();
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(page.getByTestId("review-footer")).toBeVisible();
  return page.url().split("/import/")[1].split("?")[0];
}
