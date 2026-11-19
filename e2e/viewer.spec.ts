import { expect, test } from "@playwright/test";
import { createBusiness, latestLink, signIn, uniqueEmail } from "./helpers";

test("view-only staff can see the client but no edit controls", async ({ page, browser }) => {
  const viewerEmail = uniqueEmail("viewer");

  // The firm's admin creates a client (with its first money account) and invites view-only staff.
  await signIn(page, uniqueEmail("owner"));
  const gamma = await createBusiness(page, "Gamma Studio", "Gamma Checking");
  await page.goto(`/b/${gamma}`);
  await expect(page.getByTestId("import-statement").filter({ visible: true }).first()).toBeVisible(); // owners see actions
  await expect(page.getByRole("button", { name: "Add transaction" }).filter({ visible: true })).toBeVisible();

  await page.goto(`/b/${gamma}/team`);
  const since = Date.now() - 1000;
  await page.getByRole("button", { name: "Invite to team" }).click();
  await page.getByLabel("Email").fill(viewerEmail);
  await page.getByLabel("View only").check();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invited ${viewerEmail}`)).toBeVisible();
  await expect(page.getByTestId("team-invite")).toContainText(viewerEmail);
  await expect(page.getByTestId("team-invite")).toContainText("view only");

  // The invitee opens the emailed link in their own browser and lands in the business.
  const viewer = await browser.newPage();
  await viewer.goto(await latestLink(viewerEmail, since));
  await expect(viewer).toHaveURL(new RegExp(`/b/${gamma}$`));
  await expect(viewer.getByRole("heading", { level: 1, name: "Gamma Studio" })).toBeVisible();
  await expect(viewer.getByTestId("money-accounts")).toContainText("Gamma Checking");

  // No edit controls on the overview...
  await expect(viewer.getByTestId("getting-started")).toHaveCount(0);
  await expect(viewer.getByTestId("import-statement")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Add transaction" })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: /^Add money (in|out)$/ })).toHaveCount(0);

  // ...or in settings: every field is shown but disabled, and no save or archive buttons.
  await viewer.getByRole("link", { name: "Settings" }).filter({ visible: true }).click();
  await expect(viewer.getByTestId("read-only-note")).toBeVisible();
  await expect(viewer.getByLabel("Business name")).toHaveValue("Gamma Studio");
  await expect(viewer.getByLabel("Business name")).toBeDisabled();
  await expect(viewer.getByRole("textbox", { disabled: false })).toHaveCount(0);
  await expect(viewer.getByRole("combobox", { disabled: false })).toHaveCount(0);
  await expect(viewer.getByRole("switch", { disabled: false })).toHaveCount(0);
  for (const name of ["Save changes", "Archive"]) {
    await expect(viewer.getByRole("button", { name, exact: true })).toHaveCount(0);
  }

  // The admin now sees them on the team as view-only staff, and the invite is no longer pending.
  await page.reload();
  await expect(page.getByTestId("team-members").getByRole("listitem").filter({ hasText: viewerEmail })).toContainText("view only");
  await expect(page.getByTestId("team-invite")).toHaveCount(0);
  await viewer.close();
});
