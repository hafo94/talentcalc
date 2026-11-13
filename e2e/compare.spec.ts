import { expect, test } from "@playwright/test";
import { GOLDEN, blockRemoteImages, node, watchErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockRemoteImages(page);
});

test("compare: pin A, edit B, the link carries both, swap and stop", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto(`./${GOLDEN}`);
  await expect(page.getByTestId("dps-total")).toBeVisible();
  await page.getByTestId("compare-pin").click();
  await expect.poll(() => new URL(page.url()).hash).toBe(`${GOLDEN}~${GOLDEN.slice(1)}`);
  await expect(page.getByTestId("compare-dps-delta")).toHaveText("+0.0");
  await expect(page.getByTestId("compare-talents")).toHaveText("Same talents.");
  await node(page, "Ignite").click({ button: "right" });
  await expect(page.getByTestId("compare-dps-delta")).toHaveText(/^−\d+\.\d$/);
  await expect(page.getByTestId("compare-talents")).toContainText("Ignite: 5 → 4");
  const hash = new URL(page.url()).hash;
  expect(hash.split("~")).toHaveLength(2);
  expect(hash.endsWith(`~${GOLDEN.slice(1)}`)).toBe(true);
  // The link opens with both builds.
  await page.goto("about:blank");
  await page.goto(`./${hash}`);
  await expect(page.getByTestId("compare-talents")).toContainText("Ignite: 5 → 4");
  await page.getByTestId("compare-swap").click();
  await expect(page.getByTestId("compare-talents")).toContainText("Ignite: 4 → 5");
  await expect(page.getByTestId("compare-dps-delta")).toHaveText(/^\+\d+\.\d$/);
  await page.getByTestId("compare-clear").click();
  await expect.poll(() => new URL(page.url()).hash).toBe(GOLDEN);
  await expect(page.getByTestId("compare-table")).toHaveCount(0);
  w.check();
});
