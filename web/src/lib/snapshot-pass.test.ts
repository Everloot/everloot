import { expect, test, vi } from "vitest";
vi.mock("@/lib/upload-store", () => ({ uploadStore: {}, sharingStore: {} }));
vi.mock("@/lib/stored-views-run", () => ({ releaseKept: () => {} }));
import { nothingToFold, runJobFold, type SnapshotPass, type SnapshotWork } from "./snapshot-pass";

const work = (idle: boolean, retryRollups = false): SnapshotWork => ({ idle, retryRollups, dataAsOf: "2026-11-22T14:10:12Z", settledWeek: null });
const folded: SnapshotPass = {
  ok: true, folded: true, result: { added: 2, dataAsOf: "2026-11-22T14:20:12Z" }, market: { added: 1, scans: 1 },
  completion: { added: 0, remaining: 0, trimmed: 0, rebuilding: false }, census: null,
};

test("a run has nothing to fold only when no upload is new, every rollup is caught up, and it is not a rebuild", () => {
  expect(nothingToFold(work(true))).toBe(true);
  expect(nothingToFold(work(true, true))).toBe(false);
  expect(nothingToFold(work(false))).toBe(false);
  expect(nothingToFold(work(true), true)).toBe(false);
});

test("the job folds when the probe finds new uploads or a pending rollup, and never on a run with nothing to fold", async () => {
  const pass = vi.fn(async () => folded);
  const sweep = vi.fn(async () => ({ folders: 0, objects: 0 }));
  expect(await runJobFold({ work: async () => work(false), pass, sweep })).toMatchObject({ status: "folded" });
  expect(pass).toHaveBeenLastCalledWith(false, work(false));
  expect(await runJobFold({ work: async () => work(true, true), pass, sweep })).toMatchObject({ status: "folded" });
  expect(await runJobFold({ work: async () => work(true), pass, sweep })).toMatchObject({ status: "idle", pass: null });
  expect(pass).toHaveBeenCalledTimes(2);
  expect(sweep).toHaveBeenCalledTimes(3);
});

test("a failed fold is reported, and a failed sweep is logged without failing the fold", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const failed: SnapshotPass = { ok: false, error: "market rollup failed", result: { added: 2, dataAsOf: null }, market: null, completion: null };
  expect(await runJobFold({ work: async () => work(false), pass: async () => failed, sweep: async () => ({ folders: 1, objects: 20 }) }))
    .toMatchObject({ status: "failed", swept: { folders: 1, objects: 20 } });
  expect(await runJobFold({ work: async () => work(false), pass: async () => folded, sweep: async () => { throw new Error("list failed"); } }))
    .toMatchObject({ status: "folded", swept: null });
  vi.restoreAllMocks();
});
