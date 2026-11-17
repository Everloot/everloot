import { afterEach, beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("@/lib/gear-board-store", () => ({ deleteGearBoard: store.remove }));
import { GET } from "./route";

const call = (secret = "s3cret") => GET(new Request("https://everloot.app/api/cron/profiles", { headers: { authorization: `Bearer ${secret}` } }));

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  store.remove.mockReset().mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); });

test("runs only with the cron secret", async () => {
  expect((await call("wrong")).status).toBe(401);
  vi.stubEnv("CRON_SECRET", "");
  expect((await call()).status).toBe(503);
  expect(store.remove).not.toHaveBeenCalled();
});

test("deletes the retired gear boards' stored file; a storage error is a 500", async () => {
  expect(await (await call()).json()).toEqual({ ok: true, deleted: true });
  expect(store.remove).toHaveBeenCalledTimes(1);
  store.remove.mockRejectedValueOnce(new Error("down"));
  const failed = await call();
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ ok: false, error: "gear board delete failed" });
});
