import { expect, test } from "vitest";
import { activityMetrics, contributorMetrics } from "./metrics";
import type { ActivityRow } from "./types";
const row = (day: string, install_key: string, receipts = 1): ActivityRow => ({ day, install_key, receipts,
  records: 0, last_received_at: `${day}T12:00:00Z`, realms: ["CAMWOW US1 Realm 4 PvP"], kinds: ["quest"] });
test("counts successful receipt time, including no-new-record receipts, and excludes owner installs", () => {
  const rows = [row("2026-11-12", "a"), row("2026-11-12", "owner", 5), row("2026-11-07", "b"), row("2026-10-31", "b")];
  const result = activityMetrics(rows, [], new Set(["owner"]), "2026-10-01", "2026-11-12T15:00:00Z");
  expect(result.activity.today).toBe(1);
  expect(result.activity.past7Days).toBe(2);
  expect(result.activity.returning).toEqual({ count: 1, earlier: 1, rate: 1 });
  expect(result.daily.at(-1)).toMatchObject({ contributors: 1, successfulReceipts: 1, records: 0, partial: true });
});
test("does not invent retention or zero history before instrumentation onset", () => {
  const result = activityMetrics([], [], new Set(), "2026-11-12", "2026-11-12T15:00:00Z");
  expect(result.activity.returning).toBeNull();
  expect(result.daily).toHaveLength(1);
});
test("explorer keeps installations separate and exposes aliases, observed realms and receipt days", () => {
  const result = contributorMetrics([row("2026-11-11", "abc"), row("2026-11-12", "def"), row("2026-11-12", "abc")], new Set(["def"]));
  expect(result).toHaveLength(2);
  expect(result.find(r => r.id === "abc")).toMatchObject({ alias: "Install abc", daysActive: ["2026-11-11", "2026-11-12"], successfulReceipts: 2 });
  expect(result.find(r => r.id === "def")?.excluded).toBe(true);
});
