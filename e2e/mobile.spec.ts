import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yIssues } from "./a11y";
import { GOLDEN, blockRemoteImages, node } from "./helpers";

test("mobile tabs and long press", async ({ page }) => {
  await blockRemoteImages(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  const trees = page.getByRole("tablist", { name: "Talent trees" });
  await expect(trees).toBeVisible();
  await expect(trees.getByRole("tab")).toHaveCount(3);
  await expect(page.getByTestId("tree-0")).toBeVisible();
  await expect(page.getByTestId("tree-1")).toBeHidden();
  await trees.getByRole("tab", { name: /Fire/ }).click();
  await expect(page.getByTestId("tree-1")).toBeVisible();
  const inc = node(page, "Incineration");
  await inc.tap();
  await expect(inc.getByTestId("rank")).toHaveText("1/5");
  await inc.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
  await page.waitForTimeout(600);
  await inc.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true });
  await expect(inc.getByTestId("rank")).toHaveText("0/5");
});

test("mobile sections", async ({ page }) => {
  await blockRemoteImages(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  await page.getByRole("tab", { name: "Stats" }).click();
  await expect(page.getByTestId("stat-crit-spell")).toBeVisible();
  await page.getByRole("tab", { name: "Gear" }).click();
  await expect(page.getByTestId("race-select")).toBeVisible();
  await page.getByRole("tab", { name: "Talents" }).click();
  await expect(page.getByTestId("tree-0")).toBeVisible();
});

test("mobile: Damage tab shows the damage panel", async ({ page }) => {
  await blockRemoteImages(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  await page.getByRole("tab", { name: "Damage" }).click();
  await expect(page.getByTestId("damage-panel")).toBeVisible();
  await expect(page.getByTestId("dps-total")).not.toHaveText("");
});

test("mobile: Sim tab shows the rotation editor and runs the simulation", async ({ page }) => {
  await blockRemoteImages(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  await page.getByRole("tab", { name: "Sim" }).click();
  await expect(page.getByTestId("rotation-editor")).toBeVisible();
  await page.getByTestId("sim-iterations").fill("100");
  await page.getByTestId("sim-run").click();
  await expect(page.getByTestId("sim-dps")).not.toHaveText("");
  expect(await page.evaluate<number>("document.documentElement.scrollWidth")).toBeLessThanOrEqual(393);
});

test("mobile: reference targets are cards (no sideways scroll); no serious accessibility issues", async ({
  page,
}) => {
  await blockRemoteImages(page);
  await page.goto(`./${GOLDEN}`);
  await expectNoSeriousA11yIssues(page, "mobile talents");
  await page.getByRole("tab", { name: "Stats" }).click();
  const boss = page.getByTestId("ref-row-boss");
  await expect(boss).toBeVisible();
  await expect(boss.locator('[data-label="DPS"]')).toBeVisible();
  const head = await page.getByTestId("reference-table").locator("thead").boundingBox();
  expect(head!.height).toBeLessThanOrEqual(1); // visually hidden, still read by screen readers
  const box = await page.getByTestId("reference-table").boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(393);
  expect(await page.evaluate<number>("document.documentElement.scrollWidth")).toBeLessThanOrEqual(393);
  await expectNoSeriousA11yIssues(page, "mobile stats");
  await page.getByRole("tab", { name: "Damage" }).click();
  await expect(page.getByTestId("compare-panel")).toBeVisible();
  await expectNoSeriousA11yIssues(page, "mobile damage");
});
