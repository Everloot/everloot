import { expect, test, vi } from "vitest";
import { runStoredViewsJob, type StoredViewsResult } from "./stored-views-run";

const none: StoredViewsResult = {
  settled: null, itemView: null, aggregates: null, searchNames: null, auctionHistory: null, professions: null, mapPins: null,
  databaseActivity: null, guildLadder: null, marketBoards: null, coverage: null, auctionReports: null, failed: [],
};

test("the job builds the views for the heartbeat's snapshot, adding no uploads, and holds the reports while a rollup is pending", async () => {
  const run = vi.fn(async () => ({ ...none, failed: ["coverage"] }));
  const beat = { generatedAt: "2026-11-21T04:00:30Z", dataAsOf: "2026-11-21T04:00:12Z", completionPending: false };
  expect(await runStoredViewsJob({}, { heartbeat: async () => beat, run })).toMatchObject({ dataAsOf: "2026-11-21T04:00:12Z", failed: ["coverage"] });
  expect(run).toHaveBeenLastCalledWith({ added: 0, rebuild: false, dataAsOf: "2026-11-21T04:00:12Z", reportsDue: true });
  await runStoredViewsJob({ rebuild: true }, { heartbeat: async () => ({ ...beat, completionPending: true }), run });
  expect(run).toHaveBeenLastCalledWith({ added: 0, rebuild: true, dataAsOf: "2026-11-21T04:00:12Z", reportsDue: false });
});

test("with no heartbeat the snapshot cron has never run, and the job builds nothing", async () => {
  const run = vi.fn(async () => none);
  await expect(runStoredViewsJob({}, { heartbeat: async () => null, run })).rejects.toThrow("no cron heartbeat yet");
  expect(run).not.toHaveBeenCalled();
});
