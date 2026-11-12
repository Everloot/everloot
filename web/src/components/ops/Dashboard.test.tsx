import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { OpsSummary } from "@/lib/ops/types";
import Dashboard from "./Dashboard";

const snapshot: OpsSummary = {
  version: 1, generatedAt: "2026-11-12T12:00:00Z", exclusionVersion: "fixture-1", excludedInstalls: 2,
  sources: { receipts: { status: "unavailable", asOf: null, detail: "No receipt coverage" } },
  activity: { today: null, past7Days: null, returning: null, historySince: null }, daily: [], contributors: [], historical: null,
  health: { snapshot: null, attention: ["Collector source unavailable"] }, costs: { cpu: null, actualBilled: null }, usage: { mcp: null, browser: null },
};
it("keeps missing sources, costs, activity and identity coverage visibly unavailable", () => {
  const html = renderToStaticMarkup(<Dashboard snapshot={snapshot} />);
  expect(html).toContain("Daily receipt activity unavailable");
  expect(html).toContain("CPU estimate and monthly pace unavailable");
  expect(html).toContain("Actual billed total: unavailable");
  expect(html).toContain("No receipt coverage");
  expect(html).toContain("Collector source unavailable");
  expect(html).toContain("Excluding 2 known owner/test installs");
  expect(html).not.toContain("0.0%");
});
it("renders the exact snapshot daily counts and labels partial UTC periods", () => {
  const html = renderToStaticMarkup(<Dashboard snapshot={{ ...snapshot, activity: { today: 3, past7Days: 8, returning: { count: 2, earlier: 4, rate: 0.5 }, historySince: "2026-11-01" }, daily: [{ day: "2026-11-12", contributors: 3, successfulReceipts: 11, records: 42, rejected: 1, limited: 2, storageFailures: 0, reasons: { schema: 1 }, partial: true }] }} />);
  expect(html).toContain("50.0%");
  expect(html).toContain("2026-11-12 (partial)");
  expect(html).toContain("schema: 1");
  expect(html).toContain("Daily values and upload outcomes");
});
it("keeps unmeasured rejection counters unavailable alongside known receipt counts", () => {
  const html = renderToStaticMarkup(<Dashboard snapshot={{ ...snapshot, daily: [{ day: "2026-11-12", contributors: 3, successfulReceipts: 11, records: 42, rejected: null, limited: null, storageFailures: null, reasons: null, partial: true }] }} />);
  expect(html).toContain("<td class=\"p-2 font-mono\">Unavailable</td>");
  expect(html).not.toContain("None measured");
});
