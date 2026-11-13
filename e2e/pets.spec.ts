import { expect, test } from "@playwright/test";
import { blockRemoteImages, node, watchErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockRemoteImages(page);
});

test("hunter: a new hunter starts with a Cat; None shows the pet note; the pet is in the link", async ({
  page,
}) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Hunter", exact: true }).click();
  const total = page.getByTestId("dps-total");
  await expect(page.getByTestId("pet-select")).toHaveValue("2");
  await expect(page.getByTestId("pet-damage")).toBeVisible();
  await expect(page.getByTestId("pet-row-melee")).toBeVisible();
  await expect(page.getByTestId("dps-split")).toContainText("Cat");
  await expect(page.getByTestId("rotation-note")).toHaveCount(0);
  await expect(page.getByTestId("strip-dps")).toHaveText(await page.getByTestId("dps-total").innerText());
  await expect.poll(() => new URL(page.url()).hash).toBe("#v2.hunter.60.0..CAMCAAA");
  const withCat = Number(await total.textContent());
  await page.getByTestId("pet-select").selectOption("0");
  await expect(page.getByTestId("pet-damage")).toHaveCount(0);
  await expect(page.getByTestId("rotation-note")).toContainText("Choose a pet");
  await expect.poll(async () => Number(await total.textContent())).toBeLessThan(withCat);
  await expect.poll(() => new URL(page.url()).hash).toBe("#v1.hunter.60.0");
  // A link without a pet record keeps "None" (existing links decode unchanged).
  await page.goto("about:blank");
  await page.goto("./#v1.hunter.60.0");
  await expect(page.getByTestId("pet-select")).toHaveValue("0");
  await page.getByTestId("pet-select").selectOption({ label: "Cat (+10% damage)" });
  await expect.poll(() => new URL(page.url()).hash).toBe("#v2.hunter.60.0..CAMCAAA");
  await page.getByTestId("pet-scaling").uncheck();
  await expect.poll(() => new URL(page.url()).hash).toBe("#v2.hunter.60.0..CAMCAAE");
  const url = page.url();
  await page.goto("about:blank");
  await page.goto(url);
  await expect(page.getByTestId("pet-select")).toHaveValue("2");
  await expect(page.getByTestId("pet-scaling")).not.toBeChecked();
  await expect(page.getByTestId("pet-dps")).toBeVisible();
  w.check();
});

test("warlock: Demonic Sacrifice needs the talent and is cancelled by a summoned demon", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Warlock", exact: true }).click();
  await expect(page.getByTestId("pet-select")).toHaveValue("23"); // a new warlock starts with an Imp
  await expect.poll(() => new URL(page.url()).hash).toBe("#v2.warlock.60.0..CAMXAAA");
  await page.getByTestId("pet-select").selectOption("0");
  await expect(page.getByTestId("pet-sacrifice")).toBeDisabled();
  for (let i = 0; i < 5; i++) await node(page, "Demonic Embrace").click();
  for (let i = 0; i < 5; i++) await node(page, "Unholy Power").click();
  await node(page, "Demonic Sacrifice").click();
  await expect(page.getByTestId("pet-sacrifice")).toBeEnabled();
  const total = page.getByTestId("dps-total");
  await expect(total).not.toHaveText("");
  const before = Number(await total.textContent());
  await page.getByTestId("pet-sacrifice").selectOption("23"); // Imp: Burning Shadow, +15% shadow
  await expect.poll(async () => Number(await total.textContent())).toBeGreaterThan(before);
  await page.getByTestId("pet-select").selectOption({ label: "Succubus" });
  await expect(page.getByTestId("pet-note")).toContainText("cancels Demonic Sacrifice");
  await expect(page.getByTestId("pet-damage")).toBeVisible();
  w.check();
});

test("simulation includes the pet as its own actor", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./#v2.hunter.60.0..CAMCAAA");
  await expect(page.getByTestId("pet-dps")).toBeVisible();
  await page.getByTestId("sim-iterations").fill("100");
  await page.getByTestId("sim-run").click();
  await expect(page.getByTestId("sim-results")).toBeVisible();
  await expect(page.getByTestId("sim-pet-dps")).toContainText("Cat");
  await expect(page.getByTestId("sim-row-cat-melee")).toBeVisible();
  await expect(page.getByTestId("sim-row-cat-claw")).toBeVisible();
  w.check();
});
