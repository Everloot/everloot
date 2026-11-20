import { beforeEach, expect, test, vi } from "vitest";
import { computeSettled } from "@kb/settled-list";

/**
 * Past settling (docs/design/specs/2026-10-21-coverage-plateau-design.md, section 4): with EVERLOOT_SETTLED_TALLY=1 a
 * row that repeats a settled fact in every field is counted, not stored; a row that differs is stored in full.
 */

const store = vi.hoisted(() => ({ putUpload: vi.fn(), requestQuota: vi.fn(), installQuota: vi.fn(), read: vi.fn(), add: vi.fn() }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { request: store.requestQuota, install: store.installQuota, reporter: () => "0123456789abcdef" } }));
vi.mock("@/lib/upload-store", () => ({ sharingStore: { lookup: vi.fn() }, uploadStore: { putUpload: store.putUpload, installCensus: vi.fn() } }));
vi.mock("@/lib/coverage-compute", () => ({ COVERAGE_BUILD: "1.60.1.70450" }));
vi.mock("@/lib/settled-store", async (original) => ({
  ...(await original<typeof import("@/lib/settled-store")>()),
  settledForIntake: store.read,
  settledTally: { add: store.add },
}));

const BUILD = "1.60.1.70450";
const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
const sighting = (installId: string, extra: Record<string, unknown> = {}) => ({
  kind: "npc_sighting", installId, capturedAt: day(0), npcId: 1, name: "Marshal Dughan", mapId: 1429, x: 42, y: 65,
  positionKind: "interaction", role: "questgiver", ...extra,
});
const FILE = computeSettled({ records: Array.from({ length: 5 }, (_, i) => sighting(`voter-000${i}`)), asOf: day(30), build: BUILD });

const request = (payload: unknown) => new Request("https://everloot.app/api/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
async function post(payload: unknown) {
  vi.resetModules();
  const { POST } = await import("./route.js");
  return POST(request(payload));
}
const upload = (records: unknown[], clientBuild: string | undefined = BUILD) => ({ addonVersion: "0.9.0", ...(clientBuild ? { clientBuild } : {}), records });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("EVERLOOT_SETTLED_TALLY", "1");
  store.requestQuota.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  store.installQuota.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  store.putUpload.mockReset().mockResolvedValue(true);
  store.read.mockReset().mockResolvedValue(FILE);
  store.add.mockReset().mockResolvedValue(undefined);
});

test("a row matching its settled fact is counted, not stored; a row that differs is stored in full", async () => {
  expect(Object.keys(FILE.values)).toEqual(["npc:1@1429"]);
  const res = await post(upload([sighting("install-1234"), sighting("install-1234", { name: "Marshal Dugan" }), sighting("install-1234", { npcId: 2 })]));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body).toMatchObject({ ok: true, persisted: true, settled: 1 });
  expect(body.accepted).toHaveLength(3);
  expect(store.read).toHaveBeenCalledWith(BUILD);
  expect(store.add).toHaveBeenCalledWith(BUILD, "install-1234", ["npc:1@1429"]);
  const stored = store.putUpload.mock.calls[0]![2].records;
  expect(stored.map((r: { name: string; npcId: number }) => [r.npcId, r.name])).toEqual([[1, "Marshal Dugan"], [2, "Marshal Dughan"]]);
});

test("an upload of nothing but repeats is confirmed without an upload object", async () => {
  const res = await post(upload([sighting("install-1234"), sighting("install-1234", { capturedAt: day(1) })]));
  expect(await res.json()).toMatchObject({ ok: true, persisted: true, settled: 2 });
  expect(store.add).toHaveBeenCalledWith(BUILD, "install-1234", ["npc:1@1429", "npc:1@1429"]);
  expect(store.putUpload).not.toHaveBeenCalled();
});

test("a tally that fails stores the rows instead: not counted is not lost", async () => {
  store.add.mockRejectedValue(new Error("down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const body = await (await post(upload([sighting("install-1234")]))).json();
  expect(body).toMatchObject({ ok: true, persisted: true });
  expect(body.settled).toBeUndefined();
  expect(store.putUpload.mock.calls[0]![2].records).toHaveLength(1);
});

test("with the switch off, or no list for the build, every row is stored as before", async () => {
  vi.stubEnv("EVERLOOT_SETTLED_TALLY", "");
  await post(upload([sighting("install-1234")]));
  expect(store.read).not.toHaveBeenCalled();
  expect(store.putUpload.mock.calls[0]![2].records).toHaveLength(1);
  vi.stubEnv("EVERLOOT_SETTLED_TALLY", "1");
  store.read.mockResolvedValue(null);
  store.putUpload.mockClear();
  await post(upload([sighting("install-1234")], "1.61.0.71000"));
  expect(store.read).toHaveBeenCalledWith("1.61.0.71000");
  expect(store.add).not.toHaveBeenCalled();
  expect(store.putUpload.mock.calls[0]![2].records).toHaveLength(1);
});

test("a file without a build is read against the site's build", async () => {
  expect(await (await post(upload([sighting("install-1234")], undefined))).json()).toMatchObject({ ok: true, settled: 1 });
  expect(store.read).toHaveBeenCalledWith(BUILD);
});
