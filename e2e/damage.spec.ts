import { expect, test } from "@playwright/test";
import { blockRemoteImages, node, watchErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockRemoteImages(page);
});

test("damage panel: frost mage numbers and live recompute", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  const panel = page.getByTestId("damage-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("dps-rotation")).toContainText("Arcane"); // no points: first dps spec
  // 10 points in Frost: Frost rotation, Frostbolt cast 3.0 s -> 2.5 s with Improved Frostbolt 5/5
  const ifb = node(page, "Improved Frostbolt");
  for (let i = 0; i < 5; i++) await ifb.click();
  await expect(page.getByTestId("dps-rotation")).toContainText("Frost: Frostbolt");
  const card = page.getByTestId("ability-frostbolt");
  await expect(card).toContainText("2.50 s cast");
  await expect(card).toContainText("Improved Frostbolt 5/5: −0.5 s cast time");
  await expect(page.getByTestId("ability-frostbolt-hitchance")).toHaveText("83.00%");
  const before = Number(await page.getByTestId("dps-total").textContent());
  const ice = node(page, "Ice Shards");
  for (let i = 0; i < 5; i++) await ice.click();
  await expect(page.getByTestId("dps-total")).not.toHaveText(String(before));
  await expect(page.getByTestId("strip-dps")).toHaveText(await page.getByTestId("dps-total").innerText());
  await expect(page.getByTestId("dps-row-frostbolt")).toBeVisible();
  w.check();
});

test("damage panel: warrior heroic strike golden and reference DPS column", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Warrior", exact: true }).click();
  await page.getByTestId("weapon-mainHand").fill("Arcanite Reaper");
  await page.locator('[role=option][data-item-id="12784"]').click();
  // Protection basic rotation: 1 point in Protection (Improved Bloodrage)
  await node(page, "Improved Bloodrage").click();
  await expect(page.getByTestId("dps-rotation")).toContainText("Basic: Heroic Strike");
  await expect(page.getByTestId("dps-tier")).toHaveText("Tier 3");
  await expect(page.getByTestId("ability-heroic-strike-hit")).toHaveText("290 (259–321)"); // golden G7: (W + 157 +- 51.5) x (1 - DR)
  await expect(page.getByTestId("ability-heroic-strike-crit")).toHaveText("580");
  await expect(page.getByTestId("dps-total")).toHaveText("45.2"); // golden G13
  const ref = page.getByTestId("reference-table");
  await expect(ref.locator("thead")).toContainText("DPS");
  await expect(ref.locator("tbody tr").first().locator("td").last()).toHaveText("45.2");
  w.check();
});
