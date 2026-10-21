import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * The surface in a real browser: the screens a reviewer would look at, each compared
 * against its baseline, and an axe pass on each one.
 *
 * Everything here runs on the keyless deployment (`playwright.config.ts`), so the numbers
 * on screen are the engine's and the narration is the template's — the same on every run.
 * The figures asserted in text are the pinned ones (AGENTS.md); a screenshot alone would
 * pass a regression that happened to be drawn in the same place.
 */

const HERO = "What are our top rated titles?";

/** WCAG 2.1 AA, the line design §7 sets. */
async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
    "axe violations",
  ).toEqual([]);
}

/** Settle what a screenshot depends on: fonts, the lazily rendered chart, the stream. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#ask [aria-busy='true']")).toHaveCount(0);
  const figures = page.locator("#ask figure");
  if ((await figures.count()) > 0) {
    await expect(figures.first().locator("svg").first()).toBeVisible();
  }
}

async function askStarter(page: Page, question: string) {
  await page.getByRole("button", { name: question }).first().click();
  await expect(page.getByRole("button", { name: "Ask another question" })).toBeVisible();
  await settled(page);
}

/**
 * `main` scrolls inside a viewport-high layout, so a full-page screenshot stops at the
 * fold. Growing the viewport to the column's height shows all of it.
 */
async function fitViewportToColumn(page: Page) {
  const height = await page.locator("#ask").evaluate((el) => el.scrollHeight);
  await page.setViewportSize({ width: 1280, height: Math.max(900, Math.ceil(height)) });
  await settled(page);
}

/** A provenance value that changes on every request, masked out of a screenshot. */
function provenanceValue(page: Page, term: string): Locator {
  return page.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await settled(page);
});

test("zero state", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1, name: "What would you like to know?" })).toBeVisible();
  await fitViewportToColumn(page);
  await expect(page).toHaveScreenshot("zero-state.png");
  await expectNoAxeViolations(page);
});

test("the hero answer shows the catch", async ({ page }) => {
  await askStarter(page, HERO);

  const naive = page.locator("section[aria-labelledby='ga-catch-naive']");
  const honest = page.locator("section[aria-labelledby='ga-catch-honest']");
  await expect(naive).toContainText("296 tied at 5.00");
  await expect(honest.getByRole("listitem").first()).toContainText("Streetcar Named Desire, A (1951)");
  await expect(honest.getByRole("listitem").first()).toContainText("4.47");
  await expect(honest.getByRole("listitem").nth(1)).toContainText("Shawshank Redemption, The (1994)");

  await fitViewportToColumn(page);
  await expect(page).toHaveScreenshot("hero-answer.png");
  await expectNoAxeViolations(page);
});

test("provenance and the table behind the chart are reachable", async ({ page }) => {
  await askStarter(page, HERO);

  await page.getByText("How did you get this?").click();
  await expect(provenanceValue(page, "Data as of")).toBeVisible();

  // The accessible chart is a table behind a disclosure, not one hidden with CSS
  // (architecture §11): opening it must show a real table.
  await page.locator("#ask figure summary").first().click();
  await expect(page.locator("#ask figure table").first()).toBeVisible();

  await fitViewportToColumn(page);
  await expect(page).toHaveScreenshot("provenance-open.png", {
    mask: [provenanceValue(page, "Computed at"), provenanceValue(page, "Request")],
  });
  await expectNoAxeViolations(page);
});

test("turning the checks off says so", async ({ page }) => {
  await askStarter(page, HERO);

  await page.getByRole("button", { name: "Show me the unchecked list anyway" }).click();
  await expect(page.locator("section[aria-labelledby='ga-checks-off-heading']")).toBeVisible();
  await settled(page);

  await fitViewportToColumn(page);
  await expect(page).toHaveScreenshot("checks-off.png");
  await expectNoAxeViolations(page);
});

test("keyboard only: ask, land on the answer, open provenance", async ({ page }) => {
  const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");

  for (let i = 0; i < 40 && !(await focused()).startsWith(HERO); i += 1) {
    await page.keyboard.press("Tab");
  }
  expect(await focused()).toContain(HERO);

  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Ask another question" })).toBeVisible();
  // Focus moves to the answer, not left on a chip that is now off screen.
  await expect(page.locator("#ask [tabindex='-1']")).toBeFocused();

  for (let i = 0; i < 80 && (await focused()) !== "How did you get this?"; i += 1) {
    await page.keyboard.press("Tab");
  }
  expect(await focused()).toBe("How did you get this?");
  await page.keyboard.press("Enter");
  await expect(provenanceValue(page, "Data as of")).toBeVisible();
});
