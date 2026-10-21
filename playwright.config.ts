import { defineConfig, devices } from "@playwright/test";

/**
 * The browser layer (architecture §9): the shipped surface in a real Chromium, for the
 * two things `tests/ui/`'s static markup cannot see — what the screen looks like, and what
 * axe finds once scripts have run.
 *
 * Screenshots are compared against baselines rendered on Linux. A baseline's file name
 * carries its platform, so a run on another OS writes new files rather than comparing
 * against Linux pixels; the `Update screenshots` workflow is how a change to the surface
 * regenerates them on the machine CI uses.
 */
const port = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  expect: {
    toHaveScreenshot: { animations: "disabled", caret: "hide" },
  },
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 900 },
    // Dates on the surface format in UTC (AGENTS.md); the browser agrees so a screenshot
    // cannot depend on where it was taken.
    timezoneId: "UTC",
    locale: "en-US",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
  webServer: {
    command: `npm run ingest && npm run build && npm run start -- --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    // The keyless deployment (invariant 13): every figure on screen comes from the engine
    // and the narration from the template, so a screenshot is the same on every run. An
    // empty key reads as absent (`ai/mode.ts`).
    env: { ANTHROPIC_API_KEY: "" },
  },
});
