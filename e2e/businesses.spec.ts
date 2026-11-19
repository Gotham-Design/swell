import { expect, test } from "@playwright/test";
import { createBusiness, signIn, uniqueEmail } from "./helpers";

test("a user creates two businesses, switches between them, and sees only that business's data", async ({ page, browser }) => {
  await signIn(page, uniqueEmail("owner"));
  await expect(page).toHaveURL(/\/new$/); // brand-new user goes to onboarding

  // Onboarding creates each business's first money account.
  const alpha = await createBusiness(page, "Alpha Co", "Alpha Checking");
  const beta = await createBusiness(page, "Beta LLC", "Beta Savings");

  // Next keeps the previous route mounted but hidden for instant back-navigation, so
  // assert on what's on screen.
  const accounts = page.getByTestId("money-accounts").filter({ visible: true });
  const current = page.getByTestId("current-business").filter({ visible: true });

  // On Beta's overview: only Beta's data.
  await page.goto(`/b/${beta}`);
  await expect(current).toHaveAttribute("data-name", "Beta LLC");
  await expect(accounts).toContainText("Beta Savings");
  await expect(accounts).not.toContainText("Alpha Checking");

  // Switch to Alpha with the switcher.
  await page.getByRole("button", { name: /Switch client/ }).filter({ visible: true }).click();
  await page.getByRole("menuitem", { name: /Alpha Co/ }).click();
  await expect(page).toHaveURL(new RegExp(`/b/${alpha}$`));
  await expect(current).toHaveAttribute("data-name", "Alpha Co");
  await expect(accounts).toContainText("Alpha Checking");
  await expect(accounts).not.toContainText("Beta Savings");

  // Context lives in the URL: a reload and a deep link keep it.
  await page.reload();
  await expect(current).toHaveAttribute("data-name", "Alpha Co");
  await page.getByRole("link", { name: "Settings" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(new RegExp(`/b/${alpha}/settings$`));
  await expect(page.getByLabel("Business name")).toHaveValue("Alpha Co");

  // "/" returns to the last business used.
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/b/${alpha}$`));

  // Someone else can't open Alpha, even with the link.
  const outsider = await browser.newPage();
  await signIn(outsider, uniqueEmail("outsider"));
  await outsider.goto(`/b/${alpha}`);
  await expect(outsider.getByRole("heading", { name: "Not found" })).toBeVisible();
  await expect(outsider.getByText("Alpha Checking")).toHaveCount(0);
  await outsider.close();
});
