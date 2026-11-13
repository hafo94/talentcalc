import { expect, test } from "@playwright/test";
import { blockRemoteImages, node, watchErrors } from "./helpers";

const WARRIOR_V2 = "#v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8"; // Phase 3 golden

test.beforeEach(async ({ page }) => {
  await blockRemoteImages(page);
});

test("talent tooltip shows the DPS of the next and last point; trees show their DPS", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto(`./${WARRIOR_V2}`); // Human, Arcanite Reaper, Cruelty 5/5, raid buffs
  await expect(page.getByTestId("dps-total")).toBeVisible();
  await node(page, "Cruelty").hover();
  const tip = page.locator("#talent-tooltip");
  await expect(tip.getByTestId("impact-prev")).toContainText(/Last point: −\d+\.\d DPS/);
  await expect(tip.getByTestId("impact-prev")).toContainText("−1.00% crit vs target");
  await expect(tip.getByTestId("impact-next")).toHaveCount(0); // maxed
  await node(page, "Deflection").hover(); // Arms, defensive
  await expect(tip.getByTestId("impact-next")).toContainText("Next point: +0.0 DPS (+0.00%)");
  await expect(tip.getByTestId("impact-prev")).toHaveCount(0);
  await expect(page.getByTestId("spec-dps-1")).toContainText(/^\+\d+\.\d DPS$/); // Fury points
  await expect(page.getByTestId("spec-dps-0")).toHaveCount(0); // no points in Arms
  w.check();
});

test("keyboard focus shows the impact; the heat map labels every talent", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./#v1.warrior.60.0");
  await expect(page.getByTestId("dps-total")).toBeVisible();
  await node(page, "Cruelty").focus();
  await expect(page.locator("#talent-tooltip").getByTestId("impact-next")).toBeVisible();
  await page.keyboard.press("+");
  await expect(page.locator("#talent-tooltip").getByTestId("impact-prev")).toBeVisible();
  await page.getByTestId("heatmap-toggle").check();
  await expect.poll(() => page.getByTestId("node-impact").count()).toBeGreaterThan(20);
  await page.getByTestId("heatmap-toggle").uncheck();
  await expect(page.getByTestId("node-impact")).toHaveCount(0);
  w.check();
});
