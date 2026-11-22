import { expect, test, vi } from "vitest";
import { runStoredViewsJob, stepRunner, type StoredViewsResult } from "./stored-views-run";

const history = async () => {};
const none: StoredViewsResult = {
  settled: null, itemView: null, aggregates: null, searchNames: null, farmAreas: null, auctionHistory: null, professions: null, mapPins: null,
  databaseActivity: null, guildLadder: null, marketBoards: null, coverage: null, auctionReports: null, failed: [], timings: {},
};

test("the job builds the views for the heartbeat's snapshot, adding no uploads, and holds the reports while a rollup is pending", async () => {
  const run = vi.fn(async () => ({ ...none, failed: ["coverage"] }));
  const record = vi.fn(async () => {});
  const beat = { generatedAt: "2026-11-21T04:00:30Z", dataAsOf: "2026-11-21T04:00:12Z", completionPending: false };
  expect(await runStoredViewsJob({}, { heartbeat: async () => beat, run, record, history })).toMatchObject({ dataAsOf: "2026-11-21T04:00:12Z", failed: ["coverage"] });
  expect(run).toHaveBeenLastCalledWith({ added: 0, rebuild: false, dataAsOf: "2026-11-21T04:00:12Z", reportsDue: true, retries: 1 });
  await runStoredViewsJob({ rebuild: true }, { heartbeat: async () => ({ ...beat, completionPending: true }), run, record, history });
  expect(run).toHaveBeenLastCalledWith({ added: 0, rebuild: true, dataAsOf: "2026-11-21T04:00:12Z", reportsDue: false, retries: 1 });
});

test("a finished run leaves its heartbeat with the snapshot it built, its failed steps and how long each step took", async () => {
  const run = vi.fn(async () => ({ ...none, failed: ["coverage"], timings: { settled: 1200, coverage: 800 } }));
  const record = vi.fn(async () => {});
  let clock = Date.parse("2026-11-22T13:00:00Z");
  const now = () => (clock += 15_000);
  const beat = { generatedAt: "2026-11-22T12:50:30Z", dataAsOf: "2026-11-22T12:50:12Z", completionPending: false };
  await runStoredViewsJob({}, { heartbeat: async () => beat, run, record, now, history });
  expect(record).toHaveBeenCalledWith({
    finishedAt: "2026-11-22T13:00:30.000Z", dataAsOf: "2026-11-22T12:50:12Z", failed: ["coverage"], seconds: 15,
    timings: { settled: 1200, coverage: 800 },
  });
});

test("a heartbeat that cannot be written fails the run, so the job shows red", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const beat = { generatedAt: "2026-11-22T12:50:30Z", dataAsOf: "2026-11-22T12:50:12Z", completionPending: false };
  const result = await runStoredViewsJob({}, { heartbeat: async () => beat, run: async () => none, record: async () => { throw new Error("R2 down"); }, history });
  expect(result.failed).toEqual(["heartbeat"]);
  vi.restoreAllMocks();
});

test("with no heartbeat the snapshot cron has never run, and the job builds nothing", async () => {
  const run = vi.fn(async () => none);
  const record = vi.fn(async () => {});
  await expect(runStoredViewsJob({}, { heartbeat: async () => null, run, record, history })).rejects.toThrow("no cron heartbeat yet");
  expect(run).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
});

test("a failed step is tried again once when retries allow, and named in failed only when the retry fails too", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const beforeRetry = vi.fn();
  const { step, failed, timings } = stepRunner({ retries: 1, waitMs: 0, beforeRetry });
  let calls = 0;
  expect(await step("settled", "settled list", async () => { if (++calls === 1) throw new Error("read ECONNRESET"); return { written: true }; }))
    .toEqual({ written: true });
  expect(calls).toBe(2);
  // The run forgets a failed shared corpus read there, so the retry reads it again.
  expect(beforeRetry).toHaveBeenCalledOnce();
  expect(await step("coverage", "coverage", async () => { throw new Error("still down"); })).toBeNull();
  expect(failed).toEqual(["coverage"]);
  expect(Object.keys(timings)).toEqual(["settled", "coverage"]);
  const once = stepRunner({ retries: 0, waitMs: 0 });
  let tries = 0;
  expect(await once.step("settled", "settled list", async () => { tries++; throw new Error("down"); })).toBeNull();
  expect(tries).toBe(1);
  expect(once.failed).toEqual(["settled"]);
  vi.restoreAllMocks();
});
test("the day's platform history is written after the views; a failure is named in failed and the heartbeat still lands", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const order: string[] = [];
  const beat = { generatedAt: "2026-11-23T00:00:30Z", dataAsOf: "2026-11-23T00:00:12Z", completionPending: false };
  const record = vi.fn(async () => { order.push("heartbeat"); });
  const result = await runStoredViewsJob({}, {
    heartbeat: async () => beat, record,
    run: async () => { order.push("views"); return none; },
    history: async () => { order.push("history"); throw new Error("R2 down"); },
  });
  expect(order).toEqual(["views", "history", "heartbeat"]);
  expect(result.failed).toEqual(["history"]);
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ failed: ["history"] }));
  vi.restoreAllMocks();
});
test("a fold that failed before the views is named first in failed and in the heartbeat, and the views are still built", async () => {
  const beat = { generatedAt: "2026-11-22T15:00:30Z", dataAsOf: "2026-11-22T14:50:12Z", completionPending: false };
  const run = vi.fn(async () => ({ ...none, failed: ["coverage"] }));
  const record = vi.fn(async () => {});
  const result = await runStoredViewsJob({ failedBefore: ["snapshot"] }, { heartbeat: async () => beat, run, record, history });
  expect(run).toHaveBeenCalledOnce();
  expect(result.failed).toEqual(["snapshot", "coverage"]);
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ dataAsOf: "2026-11-22T14:50:12Z", failed: ["snapshot", "coverage"] }));
});