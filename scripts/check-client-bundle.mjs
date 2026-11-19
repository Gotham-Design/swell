// Runs after `next build`. Fails the build if a server-only secret, by name or by value,
// shows up in anything shipped to the browser (.next/static).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SECRETS = ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"];
const root = ".next/static";

// Values come from the same env files Next.js loads, so a leaked value is caught even if
// the variable name was minified away.
const { loadEnvConfig } = (await import("@next/env")).default;
loadEnvConfig(process.cwd(), false, { info() {}, error: console.error });
const needles = SECRETS.flatMap((name) => {
  const value = process.env[name];
  return value && value.length >= 16 ? [name, value] : [name];
});

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|mjs|json|html|txt|map)$/.test(p)) yield p;
  }
}

let leaks = 0;
try {
  for (const file of files(root)) {
    const text = readFileSync(file, "utf8");
    for (const needle of needles) {
      if (text.includes(needle)) {
        const label = SECRETS.includes(needle) ? needle : `value of ${SECRETS.find((s) => process.env[s] === needle)}`;
        console.error(`✗ ${label} found in client bundle: ${file}`);
        leaks++;
      }
    }
  }
} catch (e) {
  console.error(`✗ Could not scan ${root}: ${e.message}`);
  process.exit(1);
}

if (leaks) {
  console.error("\nServer-only secrets must never reach the browser. Import them only via src/lib/env/server.ts from server code.");
  process.exit(1);
}
console.log(`✓ Client bundle clean: no ${SECRETS.join(" / ")} in ${root}`);
