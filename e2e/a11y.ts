import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Phase 7: axe-core (WCAG 2.1 A/AA rules); serious and critical violations fail the test. */
export async function expectNoSeriousA11yIssues(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(bad).toEqual([]);
}
