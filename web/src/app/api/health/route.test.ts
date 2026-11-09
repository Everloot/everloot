import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SnapshotHealth } from "@/lib/upload-store";

/**
 * Uptime monitoring reads only the status: 200 while the cron heartbeat is fresh, 503 otherwise. The
 * route keeps one snapshot for a minute so a monitor's polls do not each read storage.
 */

const store = vi.hoisted(() => ({ snapshotHealth: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { snapshotHealth: store.snapshotHealth } }));

const snapshot = (status: SnapshotHealth["status"]): SnapshotHealth =>
  ({ status, updatedAt: "2026-11-06T12:00:00.000Z", ageSeconds: 120 });

/** A fresh route module per test, so one test's cached snapshot never reaches another. */
async function freshGet() {
  vi.resetModules();
  const { GET } = await import("./route.js");
  return GET;
}

let now = Date.parse("2026-11-06T12:02:00Z");

beforeEach(() => {
  store.snapshotHealth.mockReset();
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => { vi.restoreAllMocks(); });

test("a fresh heartbeat is a 200 that no cache may keep", async () => {
  store.snapshotHealth.mockResolvedValue(snapshot("fresh"));
  const res = await (await freshGet())();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ ok: true, snapshot: snapshot("fresh") });
});

test.each(["stale", "missing", "unavailable", "local"] as const)("a %s heartbeat is a 503 that no cache may keep", async (status) => {
  store.snapshotHealth.mockResolvedValue(snapshot(status));
  const res = await (await freshGet())();
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ ok: false, snapshot: snapshot(status) });
});

test("the snapshot is read once a minute: a call inside the minute reuses it, the first one past it reads again", async () => {
  store.snapshotHealth.mockResolvedValueOnce(snapshot("fresh")).mockResolvedValueOnce(snapshot("stale"));
  const GET = await freshGet();
  expect((await GET()).status).toBe(200);
  now += 60_000;
  expect((await GET()).status).toBe(200);
  expect(store.snapshotHealth).toHaveBeenCalledTimes(1);
  now += 1;
  expect((await GET()).status).toBe(503);
  expect(store.snapshotHealth).toHaveBeenCalledTimes(2);
});
