import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SnapshotHealth } from "@/lib/upload-store";
import type { DispatchHealth, ViewsHealth } from "@/lib/stored-views-status";

/**
 * Uptime monitoring reads only the status: 200 while the cron heartbeat is fresh, 503 otherwise. The
 * route keeps one snapshot for a minute so a monitor's polls do not each read storage. The stored views and the
 * job's start token ride along in the body and never change the status.
 */

const store = vi.hoisted(() => ({ snapshotHealth: vi.fn(), viewsHealth: vi.fn(), dispatchHealth: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { snapshotHealth: store.snapshotHealth } }));
vi.mock("@/lib/stored-views-status", () => ({ viewsHealth: store.viewsHealth, dispatchHealth: store.dispatchHealth }));

const snapshot = (status: SnapshotHealth["status"]): SnapshotHealth =>
  ({ status, updatedAt: "2026-11-06T12:00:00.000Z", ageSeconds: 120 });
const views = (status: ViewsHealth["status"]): ViewsHealth =>
  ({ status, finishedAt: "2026-11-06T11:58:00.000Z", ageSeconds: 240, dataAsOf: "2026-11-06T11:50:10.000Z", failed: [] });
const viewsDispatch: DispatchHealth =
  { status: "sent", at: "2026-11-06T11:55:00.000Z", httpStatus: 204, tokenExpiresAt: "2026-12-22T06:42:29.000Z", tokenDaysLeft: 45 };

/** A fresh route module per test, so one test's cached snapshot never reaches another. */
async function freshGet() {
  vi.resetModules();
  const { GET } = await import("./route.js");
  return GET;
}

let now = Date.parse("2026-11-06T12:02:00Z");

beforeEach(() => {
  store.snapshotHealth.mockReset();
  store.viewsHealth.mockReset().mockResolvedValue(views("current"));
  store.dispatchHealth.mockReset().mockResolvedValue(viewsDispatch);
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => { vi.restoreAllMocks(); });

test("a fresh heartbeat is a 200 that no cache may keep, with the views and their start token beside it", async () => {
  store.snapshotHealth.mockResolvedValue(snapshot("fresh"));
  const res = await (await freshGet())();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ ok: true, snapshot: snapshot("fresh"), views: views("current"), viewsDispatch });
});

test.each(["stale", "missing", "unavailable", "local"] as const)("a %s heartbeat is a 503 that no cache may keep", async (status) => {
  store.snapshotHealth.mockResolvedValue(snapshot(status));
  const res = await (await freshGet())();
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toMatchObject({ ok: false, snapshot: snapshot(status) });
});

test("views that are behind or failing are reported, and the status still follows the snapshot cron alone", async () => {
  store.snapshotHealth.mockResolvedValue(snapshot("fresh"));
  store.viewsHealth.mockResolvedValue(views("behind"));
  const res = await (await freshGet())();
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, views: { status: "behind" } });
});

test("the snapshot is read once a minute: a call inside the minute reuses it, the first one past it reads again", async () => {
  store.snapshotHealth.mockResolvedValueOnce(snapshot("fresh")).mockResolvedValueOnce(snapshot("stale"));
  const GET = await freshGet();
  expect((await GET()).status).toBe(200);
  now += 60_000;
  expect((await GET()).status).toBe(200);
  expect(store.snapshotHealth).toHaveBeenCalledTimes(1);
  expect(store.viewsHealth).toHaveBeenCalledTimes(1);
  now += 1;
  expect((await GET()).status).toBe(503);
  expect(store.snapshotHealth).toHaveBeenCalledTimes(2);
});
