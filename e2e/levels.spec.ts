import { expect, test } from "@playwright/test";
import { GOLDEN, blockRemoteImages, watchErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockRemoteImages(page);
});

test("level selector: fewer points, level-based targets and buffs, level in the link", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto(`./${GOLDEN}`);
  await expect(page.getByTestId("points-by-spec")).toHaveText("0/33/18");
  await page.getByTestId("level-select").selectOption("30");
  await expect(page.getByTestId("notice")).toContainText("Talent points above level 30 were removed.");
  await expect(page.getByTestId("points-left")).toHaveText("Points left: 0");
  await expect(page.getByTestId("points-by-spec")).toHaveText("0/21/0");
  await expect(page.getByTestId("character-level")).toHaveText("Level 30");
  await expect(page.getByTestId("target-panel")).toContainText("Boss (33, 1317 armor)");
  await expect(page.locator("label", { has: page.getByTestId("buff-arcane_intellect") })).toContainText(
    "(level 56)",
  );
  await expect(page.getByTestId("dps-total")).not.toHaveText("");
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#v1\.mage\.30\.0\./);
  const url = page.url();
  await page.goto("about:blank");
  await page.goto(url);
  await expect(page.getByTestId("level-select")).toHaveValue("30");
  await expect(page.getByTestId("points-by-spec")).toHaveText("0/21/0");
  w.check();
});
