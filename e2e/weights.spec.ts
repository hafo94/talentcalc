import { expect, test } from "@playwright/test";
import { GOLDEN, blockRemoteImages, watchErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockRemoteImages(page);
});

test("stat weights: analytical EP when opened, simulated weights on demand", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto(`./${GOLDEN}`);
  await expect(page.getByTestId("dps-total")).toBeVisible();
  await expect(page.getByTestId("weights-table")).toHaveCount(0); // nothing computed while closed
  await page.getByText("Stat weights", { exact: true }).click();
  const table = page.getByTestId("weights-table");
  await expect(table).toBeVisible();
  await expect(page.getByTestId("weight-spellPower").getByTestId("weight-ep")).toHaveText("1.00");
  await expect(page.getByTestId("weight-spellHit")).toContainText("up to the cap");
  await page.getByTestId("sim-iterations").fill("50");
  await page.getByTestId("weights-sim-run").click();
  await expect(table.getByRole("columnheader", { name: "Sim EP" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("weight-spellPower")).toContainText("±");
  w.check();
});
