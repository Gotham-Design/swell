import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { chooseImportAccount, chooseImportFile, continueToReview } from "./helpers";
import { setup } from "./transactions-fixtures";

const FIXTURES = join(__dirname, "..", "src", "lib", "import", "__fixtures__");
const file = (name: string) => ({ name, mimeType: "text/csv", buffer: readFileSync(join(FIXTURES, name)) });

// Field rows carry a "Guessed" badge while guessed, so target the controls by id.
const field = (page: Page, f: string) => page.locator(`#map-${f}`);
const guessedWrap = (page: Page, f: string) => page.locator("[data-guessed]").filter({ has: field(page, f) });
const amountsShown = (page: Page) => page.getByRole("radiogroup", { name: "How are amounts shown?" });
const preview = (page: Page) => page.getByRole("radiogroup", { name: "Preview" });

async function upload(page: Page, account: string, f: { name: string; mimeType: string; buffer: Buffer }) {
  await chooseImportAccount(page, account);
  await chooseImportFile(page, f);
  await expect(page.getByTestId("file-summary")).toBeVisible();
}

/** The mapping step's "Back" returns to step 1 (account and file). */
async function back(page: Page) {
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("dropzone")).toBeVisible();
}

test("upload, auto-suggested mapping, saved mapping skips to review next time", async ({ page }) => {
  const { ids } = await setup(page);
  await page.goto(`/b/${ids.id}/import`);

  // Credit card statement: charges are positive, so "money in is negative" is suggested.
  await upload(page, "Ops Visa", file("amex-card.csv"));
  await expect(page.getByTestId("file-summary")).toContainText("Ops Visa · amex-card.csv · 4 rows");
  await expect(page.getByTestId("guess-note")).toContainText("Guessed");
  for (const f of ["date", "amount", "description", "date-format"]) await expect(guessedWrap(page, f)).toBeVisible();
  await expect(field(page, "date")).toHaveValue("0");
  await expect(field(page, "amount")).toHaveValue("4");
  await expect(page.getByTestId("sign-note")).toContainText("Money in is negative in this file.");
  await preview(page).getByRole("radio", { name: "Your file" }).click();
  await expect(page.getByTestId("raw-preview")).toContainText("Card Member");
  await preview(page).getByRole("radio", { name: "Mapped" }).click();
  const parsed = page.getByTestId("parsed-row");
  await expect(parsed).toHaveCount(4);
  await expect(parsed.first()).toContainText("Oct 15, 2026");
  await expect(parsed.first()).toContainText("-$24.18");
  await expect(parsed.nth(1)).toContainText("+$500.00");

  // Changing a guessed field clears its "Guessed" mark. The extra description column is under "More columns".
  await page.getByTestId("more-columns").locator("summary").click();
  await field(page, "description2").selectOption({ label: "Card Member" });
  await field(page, "description").selectOption({ label: "Description" });
  await expect(guessedWrap(page, "description")).toHaveCount(0);
  await expect(guessedWrap(page, "date")).toBeVisible();
  await expect(parsed.first()).toContainText("UBER *TRIP HELP.UBER.COM CA · JANE DOE");

  // "Save mapping" is on by default and saves when continuing to review.
  await expect(page.getByTestId("save-mapping")).toBeChecked();
  await continueToReview(page);

  // The same layout again: the saved mapping applies and goes straight to review.
  await page.goto(`/b/${ids.id}/import`);
  await chooseImportAccount(page, "Ops Visa");
  await chooseImportFile(page, file("amex-card.csv"));
  await expect(page.getByText("Using your saved columns for Ops Visa")).toBeVisible();
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(page.getByTestId("import-row").first()).toContainText("UBER *TRIP HELP.UBER.COM CA · JANE DOE");

  // Another account with the same layout has no saved mapping yet.
  await page.goto(`/b/${ids.id}/import`);
  await upload(page, "Ops Checking", file("amex-card.csv"));
  await expect(page.locator("[data-guessed]").first()).toBeVisible();
  await expect(page.getByTestId("sign-note")).toContainText("Money in is positive in this file.");
});

test("preamble rows, debit/credit columns and ambiguous dates", async ({ page }) => {
  const { ids } = await setup(page);
  await page.goto(`/b/${ids.id}/import`);

  await upload(page, "Ops Checking", file("bofa-preamble.csv"));
  await expect(page.getByTestId("file-summary")).toContainText("skipped 5 lines above the header");
  await expect(page.getByTestId("parsed-row").first()).toContainText("No amount");
  await expect(page.getByTestId("parsed-row").nth(1)).toContainText("+$2,000.00");
  await preview(page).getByRole("radio", { name: "Your file" }).click();
  await expect(page.getByTestId("raw-preview")).toContainText("Running Bal.");

  await back(page);
  await upload(page, "Ops Checking", file("credit-union-split.csv"));
  await expect(amountsShown(page).getByRole("radio", { name: "Separate in & out" })).toHaveAttribute("aria-checked", "true");
  await expect(field(page, "debit")).toHaveValue("3");
  await expect(field(page, "credit")).toHaveValue("4");
  await expect(page.getByTestId("parsed-row").nth(1)).toContainText("-$23.50");

  // Every day value is 12 or less: flag it, and the user's choice changes the dates.
  await back(page);
  const csv = "Date,Description,Amount\n01/02/2026,Coffee,-4.50\n03/04/2026,Tea,-3.00\n12/11/2026,Cake,-6.00\n";
  await upload(page, "Ops Checking", { name: "ambiguous.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByTestId("date-ambiguous")).toBeVisible();
  await expect(page.getByTestId("parsed-row").first()).toContainText("Jan 2, 2026");
  await field(page, "date-format").selectOption("DD/MM/YYYY");
  await expect(page.getByTestId("parsed-row").first()).toContainText("Feb 1, 2026");
});

test("files that can't be imported say why", async ({ page }) => {
  const { ids } = await setup(page);
  await page.goto(`/b/${ids.id}/import`);
  await chooseImportAccount(page, "Ops Checking");
  const error = page.getByRole("alert").filter({ hasText: /\w/ });
  await chooseImportFile(page, { name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from("Date,Description,Amount\n") });
  await expect(error).toContainText("no transactions under it");
  await chooseImportFile(page, { name: "photo.csv", mimeType: "text/csv", buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]) });
  await expect(error).toContainText("couldn't find any rows");
  await expect(page.getByTestId("file-summary")).toHaveCount(0);
});
