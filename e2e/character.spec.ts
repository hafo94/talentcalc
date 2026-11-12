import { expect, test, type Page } from "@playwright/test";
import { GOLDEN, blockRemoteImages, node, watchErrors } from "./helpers";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const V2_GOLDEN = "#v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8";

test.beforeEach(async ({ page }) => {
  await blockRemoteImages(page);
});

async function warriorWithReaper(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Warrior", exact: true }).click();
  await expect(page.getByTestId("stat-ap")).toHaveText("400");
  const cruelty = node(page, "Cruelty");
  for (let i = 0; i < 5; i++) await cruelty.click();
  await page.getByTestId("weapon-mainHand").fill("Arcanite Reaper");
  await page.locator('[role=option][data-item-id="12784"]').click();
}

test("stats update with talents and weapons", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Warrior", exact: true }).click();
  await expect(page.getByTestId("stat-ap")).toHaveText("400");
  await expect(page.getByTestId("stat-crit-mh")).toHaveText("5.00%");
  await expect(page.getByTestId("vs-crit-mainHand")).toHaveText("2.60%");
  await expect(page.getByTestId("strip-ap")).toHaveText("400");

  const cruelty = node(page, "Cruelty");
  for (let i = 0; i < 5; i++) await cruelty.click();
  await expect(page.getByTestId("stat-crit-mh")).toHaveText("5.00%");
  const note = page.getByTestId("not-modeled");
  await note.locator("summary").click();
  await expect(note).toContainText("Cruelty 5/5 — requires a melee weapon");

  await page.getByTestId("weapon-mainHand").fill("Arcanite Reaper");
  await page.locator('[role=option][data-item-id="12784"]').click();
  await expect(page.getByTestId("stat-ap")).toHaveText("462");
  await expect(page.getByTestId("stat-crit-mh")).toHaveText("10.00%");
  await expect(page.getByTestId("vs-crit-mainHand")).toHaveText("7.60%");
  await expect(page.getByTestId("weapon-dps-mainHand")).toHaveText("86.8");
  await expect(page.getByTestId("not-modeled").filter({ hasText: "Cruelty" })).toHaveCount(0);

  await page.getByTestId("stat-crit-mh").hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Cruelty 5/5");
  await expect(tip).toContainText("Ruthless (racial)");
  w.check();
});

test("raid buffs preset and URL round trip", async ({ page, browser }) => {
  const w = watchErrors(page);
  await warriorWithReaper(page);
  const preset = page.getByTestId("preset-raidBuffs");
  await preset.click();
  await expect(preset).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("buff-battle_shout")).toBeChecked();
  await expect(page.getByTestId("stat-ap")).toHaveText("910");
  await expect(page).toHaveURL(/#v2\.warrior\.60\.0\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await blockRemoteImages(p2);
  await p2.goto(page.url());
  await expect(p2.getByTestId("stat-ap")).toHaveText("910");
  await expect(p2.getByTestId("race-select")).toHaveValue("1");
  await expect(p2.getByTestId("weapon-mainHand")).toHaveValue("Arcanite Reaper");
  await expect(node(p2, "Cruelty").getByTestId("rank")).toHaveText("5/5");
  await p2.getByTestId("preset-raidBuffs").click();
  await expect(p2.getByTestId("stat-ap")).toHaveText("462");
  await ctx.close();
  w.check();
});

test("v2 golden link", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./" + V2_GOLDEN);
  await expect(page.getByTestId("stat-ap")).toHaveText("1130");
  await expect(page.getByTestId("target-armor")).toHaveText("471");
  await expect(page.getByTestId("target-dr")).toHaveText("7.89%");
  await expect(page.getByTestId("buff-sunder_armor")).toBeChecked();
  await expect(page.getByTestId("bonus-str")).toHaveValue("100");
  await expect(page.getByTestId("notice")).toHaveCount(0);
  w.check();
});

test("v1 links still work", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./" + GOLDEN);
  await expect(page.getByTestId("points-by-spec")).toHaveText("0/33/18");
  await expect(page.getByTestId("stat-crit-spell")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(escape(GOLDEN) + "$"));
  await expect(page.getByTestId("notice")).toHaveCount(0);
  w.check();
});

test("targets", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Warrior", exact: true }).click();
  await page.getByRole("radio", { name: /Same-level mob/ }).check();
  await expect(page.getByTestId("target-armor")).toHaveText("3566");
  await expect(page.getByTestId("target-dr")).toHaveText("39.33%");
  await expect(page.getByTestId("vs-glance-mainHand")).toHaveText("10.00%");
  await expect(page.getByTestId("reference-table").locator("tbody tr")).toHaveCount(4);
  await page.getByRole("radio", { name: "Custom" }).check();
  await page.getByTestId("custom-armor").fill("0");
  await expect(page.getByTestId("target-dr")).toHaveText("0.00%");
  await expect(page.getByTestId("reference-table").locator("tbody tr")).toHaveCount(5);
  w.check();
});

test("race and proficiency", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  await expect(page.getByTestId("race-select").locator("option")).toHaveText([
    "Human",
    "Orc",
    "Undead",
    "Gnome",
    "Troll",
  ]);
  await expect(page.getByTestId("weapon-offHand")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Wand" })).toBeVisible();

  await page.getByRole("button", { name: "Rogue", exact: true }).click();
  const mh = page.getByTestId("weapon-mainHand");
  await mh.fill("Arcanite Reaper");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.locator('[role=option][data-item-id="12784"]')).toHaveCount(0);
  w.check();
});

test("keyboard weapon selection", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Warrior", exact: true }).click();
  const mh = page.getByTestId("weapon-mainHand");
  await mh.fill("Arcanite Reaper");
  // Results are sorted by item level: "Refined Arcanite Reaper" first, "Arcanite Reaper" second.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(mh).toHaveValue("Refined Arcanite Reaper");
  await mh.fill("Arcanite Reaper");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(mh).toHaveValue("Arcanite Reaper");
  await expect(page.getByTestId("stat-ap")).toHaveText("462");
  await page.getByRole("button", { name: "Remove main hand" }).click();
  await expect(page.getByTestId("stat-ap")).toHaveText("400");
});
