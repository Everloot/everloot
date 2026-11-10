import { expect, test } from "vitest";
import { reportsView } from "../src/renderer/reports";
import { indexLedger, reportAt } from "../src/main/reports";

test("missing ledger explains the local recording requirement and offers one action", () => {
  const html = reportsView(reportAt([], {}), {});
  expect(html).toContain("Everloot Desktop App");
  expect(html).toContain("addon 0.3.22+");
  expect(html).toContain("records locally");
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain('data-page="addon"');
});

test("report renders labeled controls, accessible chart and item totals with escaped local names", () => {
  const info = reportAt([{ account: "Account", index: indexLedger({ roster: { a: { name: "Hero", realm: "Realm" } }, ledger: { events: [{ key: "a", at: Date.parse("2026-11-10") / 1000, category: "vendor", copper: 100, count: 2, itemName: "<Ore>" }] } }) }], {}, Date.parse("2026-11-10T12:00Z"));
  const html = reportsView(info, { cumulative: true });
  for (const label of ["Period", "Metric", "Scope", "Item", "Cumulative", "Average per unit", "Previous total"]) expect(html).toContain(label);
  expect(html).toContain('role="img"');
  expect(html).toContain("Daily values");
  expect(html).toContain("&lt;Ore&gt;");
  expect(html).not.toContain("<Ore>");
  expect(html).toContain("50c");
  expect(html).toContain("does not cover the whole previous period");
});

test("empty filter result keeps controls and offers reset", () => {
  const info = reportAt([{ account: "A", index: indexLedger({ ledger: { events: [] } }) }], {});
  expect(reportsView(info, {})).toContain('data-page="reports-reset"');
  expect(reportsView(info, {})).toContain('id="reportPeriod"');
});
