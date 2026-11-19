import { expect, test } from "@playwright/test";

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page).toHaveTitle(process.env.NEXT_PUBLIC_THEME === "always-green" ? "Always Green" : "Swell");
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("protected pages require sign-in", async ({ page }) => {
  for (const path of ["/new", "/b/00000000-0000-0000-0000-000000000000/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});
