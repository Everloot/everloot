import { afterEach, beforeEach, expect, test, vi } from "vitest";

const pipeline = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("@/lib/profile-pipeline", () => ({ writeGearBoard: pipeline.write }));
import { GET } from "./route";

const call = (secret = "s3cret", query = "") => GET(new Request(`https://everloot.app/api/cron/profiles${query}`, { headers: { authorization: `Bearer ${secret}` } }));
const ON = ["EVERLOOT_LEADERBOARDS", "EVERLOOT_CHARACTER_LINKS", "EVERLOOT_SHOWCASE", "EVERLOOT_PRIVATE_SYNC"];

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  for (const k of ON) vi.stubEnv(k, "1");
  pipeline.write.mockReset().mockResolvedValue({ full: false, read: 1, scored: 1, entries: 3, points: 3 });
});
afterEach(() => { vi.unstubAllEnvs(); });

test("runs only with the cron secret", async () => {
  expect((await call("wrong")).status).toBe(401);
  vi.stubEnv("CRON_SECRET", "");
  expect((await call()).status).toBe(503);
  expect(pipeline.write).not.toHaveBeenCalled();
});

test("with the boards off it does nothing", async () => {
  vi.stubEnv("EVERLOOT_LEADERBOARDS", "");
  const res = await call();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, skipped: "off" });
  expect(pipeline.write).not.toHaveBeenCalled();
});

test("scores the boards and reports the run; ?rebuild=1 makes it a full pass; a failure is a 500", async () => {
  const res = await call();
  expect(await res.json()).toEqual({ ok: true, gear: { full: false, read: 1, scored: 1, entries: 3, points: 3 } });
  expect(pipeline.write).toHaveBeenCalledWith({ rebuild: false });
  await call("s3cret", "?rebuild=1");
  expect(pipeline.write).toHaveBeenLastCalledWith({ rebuild: true });
  pipeline.write.mockRejectedValueOnce(new Error("down"));
  const failed = await call();
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ ok: false, error: "gear boards failed" });
});
