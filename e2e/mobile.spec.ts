import { expect, test } from "@playwright/test";
import { blockRemoteImages, node } from "./helpers";

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
