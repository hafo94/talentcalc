import { expect, test } from "@playwright/test";
import { blockRemoteImages, node } from "./helpers";

test("mobile tabs and long press", async ({ page }) => {
  await blockRemoteImages(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  await expect(page.getByRole("tablist")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.getByTestId("tree-0")).toBeVisible();
  await expect(page.getByTestId("tree-1")).toBeHidden();
  await page.getByRole("tab", { name: /Fire/ }).click();
  await expect(page.getByTestId("tree-1")).toBeVisible();
  const inc = node(page, "Incineration");
  await inc.tap();
  await expect(inc.getByTestId("rank")).toHaveText("1/5");
  await inc.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
  await page.waitForTimeout(600);
  await inc.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true });
  await expect(inc.getByTestId("rank")).toHaveText("0/5");
});
