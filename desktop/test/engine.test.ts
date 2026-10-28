import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createEngine, type EngineDeps } from "../src/main/engine";
import { defaultSettings, mergeSettings } from "../src/main/settings";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function harness(files = ["A/Everloot.lua", "B/Everloot.lua"]) {
  const changes = new Map<string, () => void>();
  const deps = {
    findFiles: vi.fn(() => files),
    upload: vi.fn(async (f: string) => `sent 3 from ${f}`),
    prices: vi.fn(async () => "12 items on 1 realm"),
    ask: vi.fn(async () => "answered 1"),
    watch: vi.fn((file: string, onChange: () => void) => { changes.set(file, onChange); return () => changes.delete(file); }),
  } satisfies EngineDeps;
  const settings = mergeSettings(defaultSettings(), { gameFolder: "C:/WoW/_classic_era_", consentedAt: "2026-10-18T00:00:00Z" });
  const engine = createEngine(deps, { uploadSettleMs: 5000, askSettleMs: 2000, pricesEveryMs: 60_000 });
  const flush = async () => { await vi.advanceTimersByTimeAsync(0); };
  return { deps, settings, engine, changes, flush };
}

test("start uploads every account file once, then refreshes prices, and watches each file", async () => {
  const { deps, settings, engine, flush } = harness();
  engine.start(settings);
  await flush();
  expect(deps.upload.mock.calls.map((c) => c[0])).toEqual(["A/Everloot.lua", "B/Everloot.lua"]);
  expect(deps.prices).toHaveBeenCalledTimes(1);
  expect(deps.watch).toHaveBeenCalledTimes(2);
  const s = engine.snapshot();
  expect(s.jobs.upload).toMatchObject({ state: "ok", message: "sent 3 from B/Everloot.lua" });
  expect(s.jobs.prices.state).toBe("ok");
  expect(s.jobs.ask.state).toBe("off");
  expect(s.log.some((l) => l.text.startsWith("Watching 2 account file(s)"))).toBe(true);
});

test("a burst of writes during a save runs one upload after it settles", async () => {
  const { deps, settings, engine, changes, flush } = harness();
  engine.start(settings);
  await flush();
  deps.upload.mockClear();
  const change = changes.get("A/Everloot.lua")!;
  change(); await vi.advanceTimersByTimeAsync(4000); change();
  await vi.advanceTimersByTimeAsync(4999);
  expect(deps.upload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(deps.upload).toHaveBeenCalledTimes(2); // both account files, once each
});

test("prices refresh on the hour even with no upload", async () => {
  const { deps, settings, engine, flush } = harness();
  engine.start(settings);
  await flush();
  deps.prices.mockClear();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(deps.prices).toHaveBeenCalledTimes(1);
});

test("a failing upload is recorded and the other jobs keep going", async () => {
  const { deps, settings, engine, flush } = harness();
  deps.upload.mockRejectedValueOnce(new Error("intake answered 429"));
  engine.start(settings);
  await flush();
  const s = engine.snapshot();
  expect(s.jobs.upload).toMatchObject({ state: "error", message: "intake answered 429" });
  expect(deps.upload).toHaveBeenCalledTimes(2);
  expect(s.log.some((l) => l.level === "error" && l.text.includes("429"))).toBe(true);
  // Prices do not chain after a failed upload; a direct run still works.
  expect(deps.prices).not.toHaveBeenCalled();
  await engine.runNow("prices");
  expect(deps.prices).toHaveBeenCalledTimes(1);
});

test("the ask bridge answers after a write settles and only when enabled", async () => {
  const { deps, settings, engine, changes, flush } = harness(["A/Everloot.lua"]);
  engine.start(settings);
  await flush();
  expect(deps.ask).not.toHaveBeenCalled();
  engine.start(mergeSettings(settings, { ask: { enabled: true, tokenFile: "t" } }));
  await flush();
  expect(deps.ask).toHaveBeenCalledTimes(1);
  changes.get("A/Everloot.lua")!();
  await vi.advanceTimersByTimeAsync(2000);
  expect(deps.ask).toHaveBeenCalledTimes(2);
});

test("switching upload off stops the watchers and marks the job off; stop clears everything", async () => {
  const { deps, settings, engine, changes, flush } = harness();
  engine.start(settings);
  await flush();
  engine.start(mergeSettings(settings, { upload: false, prices: false }));
  await flush();
  expect(engine.snapshot().jobs.upload.state).toBe("off");
  deps.upload.mockClear();
  for (const c of changes.values()) c();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(deps.upload).not.toHaveBeenCalled();
  engine.stop();
  expect(changes.size).toBe(0);
  expect(engine.snapshot().files).toEqual([]);
});

test("before setup or without a game folder nothing runs, and a folder with no file says so", async () => {
  const { deps, engine, flush } = harness([]);
  engine.start(defaultSettings());
  await flush();
  expect(deps.findFiles).not.toHaveBeenCalled();
  engine.start(mergeSettings(defaultSettings(), { consentedAt: "2026-10-18T00:00:00Z" }));
  expect(engine.snapshot().log.at(-1)?.text).toBe("No game folder set");
  engine.start(mergeSettings(defaultSettings(), { consentedAt: "2026-10-18T00:00:00Z", gameFolder: "C:/WoW/_retail_" }));
  await flush();
  expect(engine.snapshot().log.at(-1)?.text).toMatch(/No Everloot\.lua under C:\/WoW\/_retail_/);
  expect(deps.upload).not.toHaveBeenCalled();
});

test("paused skips scheduled work and a run during a run queues one more", async () => {
  const { deps, settings, engine, flush } = harness(["A/Everloot.lua"]);
  let release!: () => void;
  deps.upload.mockImplementationOnce(() => new Promise<string>((r) => { release = () => r("late"); }));
  engine.start(settings);
  await flush();
  void engine.runNow("upload");
  release();
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(2);
  engine.setPaused(true);
  deps.upload.mockClear();
  await engine.runNow("upload");
  expect(deps.upload).not.toHaveBeenCalled();
  expect(engine.snapshot().paused).toBe(true);
  // A logout while paused was skipped; resuming catches up on it once.
  engine.setPaused(false);
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(1);
  expect(engine.snapshot().log.map((l) => l.text)).toContain("Resumed");
  // Resuming when not paused does nothing.
  engine.setPaused(false);
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(1);
});

test("an account file written after start is found on the next rescan and uploaded", async () => {
  const { deps, settings, engine, changes, flush } = harness([]);
  engine.start(settings);
  await flush();
  expect(deps.upload).not.toHaveBeenCalled();
  // The first logout writes the file.
  deps.findFiles.mockReturnValue(["A/Everloot.lua"]);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(deps.upload.mock.calls.map((c) => c[0])).toEqual(["A/Everloot.lua"]);
  expect(changes.has("A/Everloot.lua")).toBe(true);
  expect(engine.snapshot().log.map((l) => l.text)).toContain("Found 1 new account file(s)");
  // Nothing new: no restart, no second upload.
  await vi.advanceTimersByTimeAsync(30_000);
  expect(deps.upload).toHaveBeenCalledTimes(1);
});

test("a failed upload is tried again a few times, then waits for the next write", async () => {
  const { deps, settings, engine, flush } = harness(["A/Everloot.lua"]);
  deps.upload.mockRejectedValue(new Error("fetch failed"));
  engine.start({ ...settings, prices: false });
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(deps.upload).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(4);
  // Back online: a success clears the count, so a later failure gets its retries again.
  deps.upload.mockResolvedValueOnce("sent 3").mockRejectedValueOnce(new Error("fetch failed"));
  await engine.runNow("upload");
  await engine.runNow("upload");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(deps.upload).toHaveBeenCalledTimes(7);
});

/** The uploader's 429: its message, and the Retry-After it read (null when the header said nothing usable). */
const limited = (retryAfterMs: number | null) => Object.assign(new Error("Upload rate limited. Keep your file and retry later."), { retryAfterMs });

/** One account whose uploads fail until the 1, 5 and 15 min retries are spent: four tries in all. */
async function exhausted() {
  const h = harness(["A/Everloot.lua"]);
  h.deps.upload.mockRejectedValue(new Error("fetch failed"));
  h.engine.start({ ...h.settings, prices: false });
  await h.flush();
  await vi.advanceTimersByTimeAsync(21 * 60_000);
  expect(h.deps.upload).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(h.deps.upload).toHaveBeenCalledTimes(4);
  return h;
}

test("Upload now after the retries ran out starts a fresh round of them", async () => {
  const { deps, engine } = await exhausted();
  await engine.runNow("upload");
  expect(deps.upload).toHaveBeenCalledTimes(5);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(deps.upload).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(7);
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(8);
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(8);
});

for (const wait of [null, 120_000]) test(`Upload now queued during an upload gets its own full retry round (${wait ?? "network failure"})`, async () => {
  const { deps, engine } = await exhausted();
  let reject!: (error: Error) => void;
  deps.upload.mockImplementationOnce(() => new Promise<string>((_resolve, fail) => { reject = fail; }));
  const active = engine.runNow("upload");
  await engine.runNow("upload");
  await engine.runNow("upload");
  expect(deps.upload).toHaveBeenCalledTimes(5);
  reject(wait === null ? new Error("fetch failed") : limited(wait));
  await active;
  await vi.advanceTimersByTimeAsync(0);
  if (wait !== null) {
    expect(deps.upload).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(wait - 1);
    expect(deps.upload).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(deps.upload).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(deps.upload).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(1);
  expect(deps.upload).toHaveBeenCalledTimes(7);
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(8);
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(9);
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(9);
});

test("Upload now after the retries ran out still waits out the site's 429, then retries", async () => {
  const { deps, engine } = await exhausted();
  deps.upload.mockRejectedValueOnce(limited(120_000));
  await engine.runNow("upload");
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.upload).toHaveBeenCalledTimes(5);
  expect(engine.snapshot().log.at(-1)?.text).toBe("upload: the site asked to wait; trying again in 2 min");
  await vi.advanceTimersByTimeAsync(119_999);
  expect(deps.upload).toHaveBeenCalledTimes(5);
  deps.upload.mockResolvedValueOnce("sent 3");
  await vi.advanceTimersByTimeAsync(1);
  expect(deps.upload).toHaveBeenCalledTimes(6);
  expect(engine.snapshot().jobs.upload.state).toBe("ok");
});

test("a wake from sleep gives a job that ran out of retries one more round, however often it fires", async () => {
  const { deps, engine } = await exhausted();
  engine.recover(); engine.recover(); engine.recover();
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.upload).toHaveBeenCalledTimes(5);
  // Mid-round, another wake leaves the pending retry alone.
  engine.recover();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(deps.upload).toHaveBeenCalledTimes(5);
  await vi.advanceTimersByTimeAsync(1);
  expect(deps.upload).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(20 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(8);
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(8);
  // A success clears the count: the next failure gets its retries from the start.
  deps.upload.mockResolvedValueOnce("sent 3").mockRejectedValueOnce(new Error("fetch failed"));
  engine.recover();
  await vi.advanceTimersByTimeAsync(0);
  expect(engine.snapshot().jobs.upload.state).toBe("ok");
  await engine.runNow("upload");
  expect(deps.upload).toHaveBeenCalledTimes(10);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(deps.upload).toHaveBeenCalledTimes(11);
});

test("a wake from sleep waits out a 429 that is still running", async () => {
  const { deps, engine } = await exhausted();
  deps.upload.mockRejectedValueOnce(limited(120_000));
  engine.recover();
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.upload).toHaveBeenCalledTimes(5);
  engine.recover();
  await vi.advanceTimersByTimeAsync(119_999);
  expect(deps.upload).toHaveBeenCalledTimes(5);
  await vi.advanceTimersByTimeAsync(1);
  expect(deps.upload).toHaveBeenCalledTimes(6);
});

test("a wake from sleep runs nothing for a job that is fine, paused, switched off or stopped", async () => {
  const fine = harness(["A/Everloot.lua"]);
  fine.engine.start({ ...fine.settings, prices: false });
  await fine.flush();
  fine.engine.recover();
  await fine.flush();
  expect(fine.deps.upload).toHaveBeenCalledTimes(1);

  const { deps, settings, engine } = await exhausted();
  engine.setPaused(true);
  engine.recover();
  await engine.runNow("upload");
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.upload).toHaveBeenCalledTimes(4);
  engine.setPaused(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.upload).toHaveBeenCalledTimes(5); // the usual catch-up on resume, not a recovery
  engine.start({ ...settings, prices: false, upload: false });
  engine.recover();
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(5);
  engine.stop();
  engine.recover();
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(5);
});

test("a wake from sleep during an old session's upload runs nothing more", async () => {
  const { deps, settings, engine } = await exhausted();
  let reject!: (error: Error) => void;
  deps.upload.mockImplementationOnce(() => new Promise<string>((_resolve, fail) => { reject = fail; }));
  void engine.runNow("upload");
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.upload).toHaveBeenCalledTimes(5);
  engine.start({ ...settings, prices: false, upload: false });
  engine.recover();
  reject(new Error("old failure"));
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(5);
  expect(engine.snapshot().jobs.upload.state).toBe("off");
});

test("a 429 waits the site's own time: no other account, write, queued run or Upload now goes before it", async () => {
  const { deps, settings, engine, changes, flush } = harness();
  let refuse!: () => void;
  deps.upload.mockImplementationOnce(() => new Promise<string>((_resolve, fail) => { refuse = () => fail(limited(120_000)); }));
  engine.start({ ...settings, prices: false });
  await flush();
  void engine.runNow("upload"); // queued behind the run the site refuses
  refuse();
  await flush();
  expect(deps.upload.mock.calls.map((c) => c[0])).toEqual(["A/Everloot.lua"]);
  expect(engine.snapshot().jobs.upload).toMatchObject({ state: "error", message: expect.stringMatching(/rate limited/) });
  expect(engine.snapshot().log.map((l) => l.text)).toContain("upload: the site asked to wait; trying again in 2 min");
  changes.get("B/Everloot.lua")!();
  await vi.advanceTimersByTimeAsync(5000);
  await engine.runNow("upload");
  expect(engine.snapshot().log.at(-1)?.text).toMatch(/^upload: the site asked to wait; trying again in 2 min$/);
  await vi.advanceTimersByTimeAsync(114_999);
  expect(deps.upload).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(deps.upload.mock.calls.map((c) => c[0])).toEqual(["A/Everloot.lua", "A/Everloot.lua", "B/Everloot.lua"]);
  expect(engine.snapshot().jobs.upload.state).toBe("ok");
});

test("a Retry-After past setTimeout's limit is still waited out, not run at once", async () => {
  const { deps, settings, engine, changes, flush } = harness(["A/Everloot.lua"]);
  deps.upload.mockRejectedValueOnce(limited(10 * 365 * 24 * 60 * 60_000));
  engine.start({ ...settings, prices: false });
  await flush();
  changes.get("A/Everloot.lua")!();
  await vi.advanceTimersByTimeAsync(2 ** 31 + 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(1);
});

test("a 429 with no usable wait falls back to the first retry and holds writes until then", async () => {
  const { deps, settings, engine, changes, flush } = harness();
  deps.upload.mockRejectedValueOnce(limited(null));
  engine.start({ ...settings, prices: false });
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(1);
  changes.get("A/Everloot.lua")!();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(deps.upload).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(deps.upload).toHaveBeenCalledTimes(3);
});

test("any other failure keeps the usual retries, tries every account and does not hold the next write", async () => {
  const { deps, settings, engine, changes, flush } = harness();
  deps.upload.mockRejectedValueOnce(new Error("Could not reach everloot.app. Keep your file and retry."));
  engine.start({ ...settings, prices: false });
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(2);
  expect(engine.snapshot().log.map((l) => l.text)).toContain("upload: trying again in 1 min");
  changes.get("A/Everloot.lua")!();
  await vi.advanceTimersByTimeAsync(5000);
  expect(deps.upload).toHaveBeenCalledTimes(4);
});

test("the wait outlives a restart for the same site, not a switch to another site, and stop leaves no timer", async () => {
  const { deps, settings, engine, flush } = harness(["A/Everloot.lua"]);
  const s = { ...settings, prices: false };
  deps.upload.mockRejectedValueOnce(limited(120_000));
  engine.start(s);
  await flush();
  engine.start({ ...s, census: !s.census }); // a settings change, or a new account file found by the rescan
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(1);
  engine.stop();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(deps.upload).toHaveBeenCalledTimes(1);
  deps.upload.mockRejectedValueOnce(limited(120_000));
  engine.start(s);
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(2);
  engine.start({ ...s, endpoint: "https://other.example" });
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(3);
});

test("a late rate limit leaves the restarted disabled job off without logging or rerunning it", async () => {
  const { deps, settings, engine, flush } = harness(["A/Everloot.lua"]);
  let refuse!: () => void;
  deps.upload.mockImplementationOnce(() => new Promise<string>((_resolve, fail) => { refuse = () => fail(limited(120_000)); }));
  engine.start({ ...settings, prices: false });
  await flush();
  engine.start({ ...settings, prices: false, upload: false });
  refuse();
  await flush();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(deps.upload).toHaveBeenCalledTimes(1);
  expect(engine.snapshot().jobs.upload.state).toBe("off");
  expect(engine.snapshot().log.some((l) => l.text.includes("asked to wait"))).toBe(false);
});

test("switching between two rate-limited sites preserves each site's wait, including URL aliases", async () => {
  const { deps, settings, engine, flush } = harness(["A/Everloot.lua"]);
  const s = { ...settings, prices: false };
  deps.upload.mockRejectedValueOnce(limited(120_000)).mockRejectedValueOnce(limited(60_000));
  engine.start(s);
  await flush();
  engine.start({ ...s, endpoint: "https://other.example" });
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(2);
  engine.start({ ...s, endpoint: `${s.endpoint}/other-path` });
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(119_999);
  expect(deps.upload).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(deps.upload).toHaveBeenCalledTimes(3);
  engine.stop();
});

test("a rate limit arriving during a restart holds the queued upload until the old site's deadline", async () => {
  const { deps, settings, engine, flush } = harness(["A/Everloot.lua"]);
  let refuse!: () => void;
  deps.upload.mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { refuse = () => reject(limited(120_000)); }));
  const s = { ...settings, prices: false };
  engine.start(s);
  await flush();
  engine.start({ ...s, census: !s.census });
  refuse();
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(119_999);
  expect(deps.upload).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(deps.upload).toHaveBeenCalledTimes(2);
  engine.stop();
});

test("an invalid site address reaches the normal job error path instead of rejecting the scheduler", async () => {
  const { deps, settings, engine, flush } = harness(["A/Everloot.lua"]);
  deps.upload.mockRejectedValue(new TypeError("Invalid URL"));
  engine.start({ ...settings, prices: false, endpoint: "http://[" });
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(1);
  expect(engine.snapshot().jobs.upload).toMatchObject({ state: "error", message: "Invalid URL" });
  engine.stop();
});

test("stopping during an upload leaves jobs off and does not upload the next account", async () => {
  const { deps, settings, engine, flush } = harness();
  let release!: () => void;
  deps.upload.mockImplementationOnce(() => new Promise<string>((resolve) => { release = () => resolve("old upload"); }));
  engine.start(settings);
  await flush();
  engine.stop();
  release();
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(1);
  expect(deps.prices).not.toHaveBeenCalled();
  expect(engine.snapshot().jobs.upload.state).toBe("off");
  expect(engine.snapshot().log.some((line) => line.text.includes("old upload"))).toBe(false);
});

test("restarting with the same settings waits for the old upload then runs the new session", async () => {
  const { deps, settings, engine, flush } = harness(["A/Everloot.lua"]);
  let release!: () => void;
  deps.upload.mockImplementationOnce(() => new Promise<string>((resolve) => { release = () => resolve("old upload"); }));
  engine.start(settings);
  await flush();
  engine.start(settings);
  release();
  await flush();
  expect(deps.upload).toHaveBeenCalledTimes(2);
  expect(deps.prices).toHaveBeenCalledTimes(1);
  expect(engine.snapshot().jobs.upload).toMatchObject({ state: "ok", message: "sent 3 from A/Everloot.lua" });
  expect(engine.snapshot().log.some((line) => line.text.includes("old upload"))).toBe(false);
});

test("an old failed upload cannot replace the new session's disabled status or schedule retries", async () => {
  const { deps, settings, engine, flush } = harness(["A/Everloot.lua"]);
  let reject!: (error: Error) => void;
  deps.upload.mockImplementationOnce(() => new Promise<string>((_resolve, fail) => { reject = fail; }));
  engine.start(settings);
  await flush();
  engine.start({ ...settings, upload: false, prices: false });
  reject(new Error("old failure"));
  await flush();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(deps.upload).toHaveBeenCalledTimes(1);
  expect(engine.snapshot().jobs.upload.state).toBe("off");
  expect(engine.snapshot().log.some((line) => line.text.includes("old failure"))).toBe(false);
});
