import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const SERVER_SECRETS = "/^(SUPABASE_SERVICE_ROLE_KEY|ANTHROPIC_API_KEY)$/";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Server-only secrets are read in exactly one place, which is marked `server-only`.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/env/server.ts"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: `MemberExpression[object.object.name='process'][object.property.name='env'][property.name=${SERVER_SECRETS}]`,
        message: "Read server secrets only through serverEnv in src/lib/env/server.ts.",
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated or reference-only:
    "src/lib/supabase/database.types.ts",
    "reference/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
