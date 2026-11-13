import { expect, type Locator, type Page } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";

const DATA_DIR = "data/generated/1.60.1.70888"; // tools/refresh_build.py --switch rewrites this
const TALENTS_DIR = `${DATA_DIR}/talents`;

export const GOLDEN = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N";

export async function blockRemoteImages(page: Page) {
  await page.route(/render\.worldofwarcraft\.com|zamimg\.com/, (r) => r.abort());
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function node(page: Page, name: string): Locator {
  return page.getByRole("button", { name: new RegExp("^" + escape(name) + ",") });
}

export interface ClassCounts {
  token: string;
  name: string;
  specs: number[];
}

/** Expected node counts per class/spec, read from the generated data. */
export function expectedCounts(): ClassCounts[] {
  const classes = JSON.parse(readFileSync(`${DATA_DIR}/classes.json`, "utf8")).classes as {
    token: string;
    name: string;
  }[];
  return readdirSync(TALENTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const d = JSON.parse(readFileSync(`${TALENTS_DIR}/${f}`, "utf8")) as {
        token: string;
        specs: { talents: unknown[] }[];
      };
      return {
        token: d.token,
        name: classes.find((c) => c.token === d.token)!.name,
        specs: d.specs.map((s) => s.talents.length),
      };
    });
}

/** Collects console errors and page errors; call check() at the end of the test. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    // Blocked/failed remote images are expected (blockRemoteImages); everything else is a real error.
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return { check: () => expect(errors).toEqual([]) };
}
