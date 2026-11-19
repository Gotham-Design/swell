// Dev helper: screenshot preview pages. `node scripts/shot.mjs <screen> [width] [--open]`.
import { chromium } from "@playwright/test";
const [screen, width = "1440", ...flags] = process.argv.slice(2);
const out = process.env.SHOT_DIR ?? ".";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 } });
await page.goto(`http://localhost:3200/dev/preview/${screen}`, { waitUntil: "networkidle", timeout: 120_000 });
if (flags.includes("--open")) { await page.getByRole("button", { name: "Expand sidebar" }).click(); await page.waitForTimeout(400); }
if (flags.includes("--hover")) { await page.getByRole("link", { name: /Transactions/ }).first().hover(); await page.waitForTimeout(400); }
if (flags.includes("--select")) { const boxes = page.getByRole("checkbox", { name: /^Select (Restaurant|Payment)/ }); await boxes.nth(0).click(); await boxes.nth(1).click(); await page.waitForTimeout(300); }
if (flags.includes("--drawer")) { await page.getByRole("button", { name: /^Open Amzn/ }).click(); await page.waitForTimeout(600); }
await page.screenshot({ path: `${out}/${screen}-${width}${flags.join("")}.png`, fullPage: true });
await browser.close();
