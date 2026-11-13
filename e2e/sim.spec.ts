import { expect, test, type Page } from "@playwright/test";
import { blockRemoteImages, node, watchErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockRemoteImages(page);
});

const entries = (page: Page) => page.getByTestId("rotation-list").locator(":scope > li");
const names = async (page: Page) =>
  (await entries(page).allInnerTexts()).map((t) => t.split("\n").find((l) => /[A-Za-z]{3}/.test(l)) ?? t);

async function frostMage(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  const ifb = node(page, "Improved Frostbolt");
  for (let i = 0; i < 5; i++) await ifb.click();
  await expect(page.getByTestId("dps-rotation")).toContainText("Frost: Frostbolt");
}

test("rotation editor: add, reorder (buttons and drag), condition, URL round-trip, reset", async ({
  page,
}) => {
  const w = watchErrors(page);
  await frostMage(page);
  await expect(page.getByTestId("rotation-entry-evocation")).toBeVisible();
  await expect(page.getByTestId("rotation-entry-frostbolt")).toBeVisible();
  await page.getByTestId("rotation-add").selectOption("Fire Blast");
  await page.getByTestId("rotation-add-button").click();
  await expect(page.getByTestId("rotation-edited")).toBeVisible();
  expect(await names(page)).toEqual(["Evocation", "Frostbolt", "Fire Blast"]);
  await page.getByRole("button", { name: "Move Fire Blast up" }).click();
  expect(await names(page)).toEqual(["Evocation", "Fire Blast", "Frostbolt"]);
  await page.getByTestId("rotation-entry-frostbolt").dragTo(page.getByTestId("rotation-entry-evocation"));
  expect(await names(page)).toEqual(["Frostbolt", "Evocation", "Fire Blast"]);
  await page.getByRole("button", { name: "Add a condition to Fire Blast" }).click();
  await page.getByRole("combobox", { name: "Condition type (Fire Blast 1)" }).selectOption("targetHp");
  await expect(page.getByTestId("dps-skipped")).toContainText("Fire Blast");
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#v2\.mage\.60\.0\./);
  const url = page.url();
  await page.goto("about:blank");
  await page.goto(url);
  await expect(page.getByTestId("rotation-edited")).toBeVisible();
  expect(await names(page)).toEqual(["Frostbolt", "Evocation", "Fire Blast"]);
  await expect(page.getByRole("combobox", { name: "Condition type (Fire Blast 1)" })).toHaveValue("targetHp");
  await page.getByTestId("rotation-reset").click();
  expect(await names(page)).toEqual(["Evocation", "Frostbolt"]);
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#v1\./);
  w.check();
});

test("simulation: run shows DPS, breakdown, resource chart and combat log", async ({ page }) => {
  const w = watchErrors(page);
  await frostMage(page);
  await page.getByTestId("sim-iterations").fill("200");
  await page.getByTestId("sim-run").click();
  await expect(page.getByTestId("sim-results")).toBeVisible();
  const dps = Number(await page.getByTestId("sim-dps").textContent());
  const analytical = Number(await page.getByTestId("dps-total").textContent());
  expect(Math.abs(dps / analytical - 1)).toBeLessThan(0.03); // Frostbolt spam, unlimited mana: section 8.3
  await expect(page.getByTestId("sim-row-frostbolt")).toBeVisible();
  await expect(page.getByTestId("sim-ci")).toContainText("95% CI");
  await expect(page.getByTestId("sim-resource-chart")).toBeVisible();
  await page.getByTestId("sim-log").locator("summary").click();
  await expect(page.getByTestId("sim-log")).toContainText("Frostbolt");
  // the same seed gives the same result
  await page.getByTestId("sim-run").click();
  await expect(page.getByTestId("sim-dps")).toHaveText(String(dps.toFixed(1)));
  // a talent change marks the result stale; the analytical DPS stays live
  await node(page, "Ice Shards").click();
  await expect(page.getByTestId("sim-stale")).toBeVisible();
  w.check();
});

test("simulation: cancel stops a long run", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Warrior", exact: true }).click();
  await page.getByTestId("weapon-mainHand").fill("Arcanite Reaper");
  await page.locator('[role=option][data-item-id="12784"]').click();
  await page.getByTestId("sim-fight").fill("900");
  await page.getByTestId("sim-iterations").fill("10000");
  await page.getByTestId("sim-run").click();
  await expect(page.getByTestId("sim-progress")).toBeVisible();
  await page.getByTestId("sim-cancel").click();
  await expect(page.getByTestId("sim-cancelled")).toBeVisible();
  await expect(page.getByTestId("sim-run")).toBeEnabled();
  await expect(page.getByTestId("sim-results")).toHaveCount(0);
  w.check();
});
