// Which look the app ships with. "swell" is the trial rename (branch swell-theme);
// set NEXT_PUBLIC_THEME=always-green to get the original back without a code change.
// Read as a literal so Next inlines it at build time.
export const THEME: "swell" | "always-green" =
  process.env.NEXT_PUBLIC_THEME === "always-green" ? "always-green" : "swell";

export const BRAND_NAME = THEME === "swell" ? "Swell" : "Always Green";
