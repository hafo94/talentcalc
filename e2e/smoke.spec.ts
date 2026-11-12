import { expect, test, type Page } from "@playwright/test";
import { GOLDEN, blockRemoteImages, expectedCounts, node, watchErrors } from "./helpers";

const summary = (p: Page) => ({
  spec: p.getByTestId("points-by-spec"),
  left: p.getByTestId("points-left"),
  level: p.getByTestId("required-level"),
});
const rank = (p: Page, name: string) => node(p, name).getByTestId("rank");

test.beforeEach(async ({ page }) => {
  await blockRemoteImages(page);
});

test("load", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await expect(page).toHaveTitle("WoW Forever Talent Calculator");
  await expect(page.getByRole("group", { name: "Class" }).getByRole("button")).toHaveCount(9);
  await expect(page.getByText("Choose a class to start.")).toBeVisible();
  w.check();
});

test("all 27 specs render", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  for (const c of expectedCounts()) {
    await page.getByRole("button", { name: c.name, exact: true }).click();
    for (let i = 0; i < 3; i++) {
      const tree = page.getByTestId(`tree-${i}`);
      await expect(tree).toBeVisible();
      await expect(tree.locator("[data-node-id]")).toHaveCount(c.specs[i]!);
    }
  }
  w.check();
});

test("spend points", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  const inc = node(page, "Incineration");
  for (let i = 0; i < 5; i++) await inc.click();
  await expect(rank(page, "Incineration")).toHaveText("5/5");
  await expect(inc).toHaveAttribute("data-state", "maxed");
  const s = summary(page);
  await expect(s.spec).toHaveText("0/5/0");
  await expect(s.left).toHaveText("Points left: 46");
  await expect(s.level).toHaveText("Required level: 14");
  await expect(node(page, "Ignite")).toHaveAttribute("data-state", "available");
  await inc.click({ button: "right" });
  await expect(rank(page, "Incineration")).toHaveText("4/5");
  await expect(node(page, "Ignite")).toHaveAttribute("data-state", "locked");
  await inc.click({ modifiers: ["Shift"] });
  await expect(rank(page, "Incineration")).toHaveText("3/5");
  w.check();
});

test("remove blocked", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  const inc = node(page, "Incineration");
  for (let i = 0; i < 5; i++) await inc.click();
  await node(page, "Ignite").click();
  await expect(rank(page, "Ignite")).toHaveText("1/5");
  await inc.click({ button: "right" });
  await expect(rank(page, "Incineration")).toHaveText("5/5");
});

test("URL round-trip", async ({ page, browser }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  const inc = node(page, "Incineration");
  for (let i = 0; i < 5; i++) await inc.click();
  await inc.click({ button: "right" });
  await expect(rank(page, "Incineration")).toHaveText("4/5");
  await expect(page).toHaveURL(/#v1\.mage\.60\.0\.[A-Za-z0-9_-]+$/);
  const url = page.url();
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await blockRemoteImages(p2);
  await p2.goto(url);
  await expect(rank(p2, "Incineration")).toHaveText("4/5");
  await expect(summary(p2).spec).toHaveText("0/4/0");
  await ctx.close();
});

test("golden link", async ({ page }) => {
  await page.goto("./" + GOLDEN);
  const s = summary(page);
  await expect(s.spec).toHaveText("0/33/18");
  await expect(s.left).toHaveText("Points left: 0");
  await expect(s.level).toHaveText("Required level: 60");
  await expect(rank(page, "Combustion")).toHaveText("1/1");
  await page.getByLabel(/Talented/).check();
  await expect(s.level).toHaveText("Required level: 55");
  expect(page.url()).toContain(".60.5.");
});

test("tooltip", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  const tip = page.getByRole("tooltip");
  await node(page, "Ignite").hover();
  await expect(tip).toContainText("Ignite");
  await expect(tip).toContainText("Rank 0/5");
  const req = tip.getByText("Requires 5 points in Fire Talents");
  await expect(req).toBeVisible();
  await expect(req).toHaveCSS("color", "rgb(255, 25, 25)");
  const inc = node(page, "Incineration");
  for (let i = 0; i < 5; i++) await inc.click();
  await node(page, "Ignite").hover();
  await expect(tip).not.toContainText("Requires");
  await expect(tip.getByText("Click to learn")).toBeVisible();
  await node(page, "Impact").click();
  await node(page, "Impact").hover();
  await expect(tip.getByText("Next rank:")).toBeVisible();
  w.check();
});

test("reset", async ({ page }) => {
  await page.goto("./" + GOLDEN);
  await page.getByRole("button", { name: "Reset Fire" }).click();
  await expect(summary(page).spec).toHaveText("0/0/18");
  await page.getByRole("button", { name: "Reset all" }).click();
  await expect(summary(page).spec).toHaveText("0/0/0");
  await expect(page).toHaveURL(/#v1\.mage\.60\.0$/);
});

test("keyboard", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  const inc = node(page, "Incineration");
  await inc.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("+");
  await expect(rank(page, "Incineration")).toHaveText("3/5");
  await page.keyboard.press("-");
  await expect(rank(page, "Incineration")).toHaveText("2/5");
  await page.keyboard.press("ArrowRight");
  await expect(node(page, "Accelerant")).toBeFocused();
});

test("icon fallback", async ({ page }) => {
  await page.unroute(/render\.worldofwarcraft\.com|zamimg\.com/).catch(() => {});
  await page.route(/render\.worldofwarcraft\.com/, (r) => r.fulfill({ status: 404 }));
  await page.route(/zamimg\.com/, (r) =>
    r.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  await expect(node(page, "Incineration").locator("img")).toHaveAttribute("src", /wow\.zamimg\.com/);
});

test("icon placeholder when both CDNs fail", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  await expect(node(page, "Incineration").locator("span[aria-hidden]").first()).toBeVisible();
});

test("bad link", async ({ page }) => {
  await page.goto("./#v1.mage.60.0.***");
  await expect(page.getByTestId("notice")).toContainText("could not be read");
  await page.goto("./#v1.mage.60.0.0dMz");
  await page.reload();
  await expect(page.getByTestId("notice")).toContainText("were not valid and were removed");
  await expect(summary(page).spec).toHaveText("0/0/0");
});
