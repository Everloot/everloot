import { expect, test, vi } from "vitest";
import { runStoredViewsJob, type StoredViewsResult } from "./stored-views-run";

const none: StoredViewsResult = {
  settled: null, itemView: null, aggregates: null, searchNames: null, auctionHistory: null, professions: null, mapPins: null,
  databaseActivity: null, guildLadder: null, marketBoards: null, coverage: null, auctionReports: null, failed: [], timings: {},
};

test("the job builds the views for the heartbeat's snapshot, adding no uploads, and holds the reports while a rollup is pending", async () => {
  const run = vi.fn(async () => ({ ...none, failed: ["coverage"] }));
  const record = vi.fn(async () => {});
  const beat = { generatedAt: "2026-11-21T04:00:30Z", dataAsOf: "2026-11-21T04:00:12Z", completionPending: false };
  expect(await runStoredViewsJob({}, { heartbeat: async () => beat, run, record })).toMatchObject({ dataAsOf: "2026-11-21T04:00:12Z", failed: ["coverage"] });
  expect(run).toHaveBeenLastCalledWith({ added: 0, rebuild: false, dataAsOf: "2026-11-21T04:00:12Z", reportsDue: true });
  await runStoredViewsJob({ rebuild: true }, { heartbeat: async () => ({ ...beat, completionPending: true }), run, record });
  expect(run).toHaveBeenLastCalledWith({ added: 0, rebuild: true, dataAsOf: "2026-11-21T04:00:12Z", reportsDue: false });
});

test("a finished run leaves its heartbeat with the snapshot it built, its failed steps and how long each step took", async () => {
  const run = vi.fn(async () => ({ ...none, failed: ["coverage"], timings: { settled: 1200, coverage: 800 } }));
  const record = vi.fn(async () => {});
  let clock = Date.parse("2026-11-22T13:00:00Z");
  const now = () => (clock += 15_000);
  const beat = { generatedAt: "2026-11-22T12:50:30Z", dataAsOf: "2026-11-22T12:50:12Z", completionPending: false };
  await runStoredViewsJob({}, { heartbeat: async () => beat, run, record, now });
  expect(record).toHaveBeenCalledWith({
    finishedAt: "2026-11-22T13:00:30.000Z", dataAsOf: "2026-11-22T12:50:12Z", failed: ["coverage"], seconds: 15,
    timings: { settled: 1200, coverage: 800 },
  });
});

test("a heartbeat that cannot be written fails the run, so the job shows red", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const beat = { generatedAt: "2026-11-22T12:50:30Z", dataAsOf: "2026-11-22T12:50:12Z", completionPending: false };
  const result = await runStoredViewsJob({}, { heartbeat: async () => beat, run: async () => none, record: async () => { throw new Error("R2 down"); } });
  expect(result.failed).toEqual(["heartbeat"]);
  vi.restoreAllMocks();
});

test("with no heartbeat the snapshot cron has never run, and the job builds nothing", async () => {
  const run = vi.fn(async () => none);
  const record = vi.fn(async () => {});
  await expect(runStoredViewsJob({}, { heartbeat: async () => null, run, record })).rejects.toThrow("no cron heartbeat yet");
  expect(run).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
});
