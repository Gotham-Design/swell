import { defineConfig, devices } from "@playwright/test";

// e2e runs against its own production server (built by `npm run test:e2e`), never the
// dev server: `next build` invalidates a running dev server's server actions.
const port = 3201;

export default defineConfig({
  testDir: "./e2e",
  // Sign-in waits on a real email round trip, and dev compiles routes on first hit.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Every test signs in by email; the local auth server stalls sending many at once.
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /\.perf\.spec\.ts$/ },
    // Timing checks run alone, after everything else, and one after the other (the 100k
    // seed would otherwise compete with the 20k import for the database).
    { name: "perf", use: { ...devices["Desktop Chrome"] }, testMatch: /\.perf\.spec\.ts$/, testIgnore: /scale\.perf\.spec\.ts$/, dependencies: ["chromium"] },
    { name: "scale", use: { ...devices["Desktop Chrome"] }, testMatch: /scale\.perf\.spec\.ts$/, dependencies: ["perf"] },
  ],
  webServer: [
    // Stand-in for the Anthropic API: e2e never calls the real one (or needs a key).
    {
      command: "node e2e/mock-anthropic.mjs",
      url: "http://127.0.0.1:3299/health",
      reuseExistingServer: false,
      env: { MOCK_ANTHROPIC_PORT: "3299" },
    },
    {
      command: `npx next start -p ${port}`,
      url: `http://localhost:${port}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      // e2e uses the Anthropic mock; Jev has its own unit tests (src/lib/ai/jev.test.ts).
      env: { AI_PROVIDER: "anthropic", ANTHROPIC_BASE_URL: "http://127.0.0.1:3299", ANTHROPIC_API_KEY: "e2e-mock-key" },
    },
  ],
});
