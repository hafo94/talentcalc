import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yIssues } from "./a11y";
import { GOLDEN, blockRemoteImages, node } from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockRemoteImages(page);
});

test("accessibility: start page, full build with every panel, talent tooltip, simulation", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.getByTestId("data-build")).toContainText(
    /WoW Forever build \d+\.\d+\.\d+\.\d+ · generated/,
  );
  await expectNoSeriousA11yIssues(page, "start");
  await page.goto(`./${GOLDEN}`);
  await expect(page.getByTestId("dps-total")).toBeVisible();
  await page.getByTestId("weights-toggle").click();
  await expect(page.getByTestId("weights-table")).toBeVisible();
  await page.getByTestId("compare-pin").click();
  await expect(page.getByTestId("compare-table")).toBeVisible();
  await page.getByTestId("heatmap-toggle").check();
  await expect.poll(() => page.getByTestId("node-impact").count()).toBeGreaterThan(0);
  await expectNoSeriousA11yIssues(page, "build");
  await node(page, "Ignite").hover();
  await expect(page.locator("#talent-tooltip").getByTestId("talent-impact")).toBeVisible();
  await expectNoSeriousA11yIssues(page, "tooltip");
  await page.getByTestId("sim-iterations").fill("50");
  await page.getByTestId("sim-run").click();
  await expect(page.getByTestId("sim-results")).toBeVisible();
  await expectNoSeriousA11yIssues(page, "simulation");
});

test("keyboard: level, heat map, stat weights and compare work without a mouse", async ({ page }) => {
  await page.goto(`./${GOLDEN}`);
  await expect(page.getByTestId("dps-total")).toBeVisible();
  await page.getByTestId("level-select").focus();
  await page.keyboard.press("ArrowDown"); // 60 -> 59 (options are listed from 60 down)
  await expect(page.getByTestId("level-select")).toHaveValue("59");
  await page.getByTestId("heatmap-toggle").focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("heatmap-toggle")).toBeChecked();
  await page.getByTestId("weights-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("weights-table")).toBeVisible();
  await page.getByTestId("compare-pin").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("compare-table")).toBeVisible();
});
