import { beforeEach, describe, expect, test, vi } from "vitest";
import { createIntakeQuota } from "@/lib/intake-quota";
import { RECORDER_INSTALL } from "@kb/recorder-installs";

/** Polestar Recorder uploads: the server gives the install id, keeps the reporter, and takes only three kinds. */

const store = vi.hoisted(() => ({ putUpload: vi.fn(), recorderInstall: vi.fn(), reporter: vi.fn() }));
vi.mock("@/lib/intake-quota", async (original) => ({
  ...(await original<typeof import("@/lib/intake-quota")>()),
  intakeQuota: {
    request: async () => ({ allowed: true, retryAfter: 0 }),
    install: async () => ({ allowed: true, retryAfter: 0 }),
    reporter: store.reporter,
    recorderInstall: store.recorderInstall,
  },
}));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { putUpload: store.putUpload, installCensus: vi.fn() }, sharingStore: { lookup: vi.fn() } }));

const character = `polestar-${"a".repeat(40)}`;
const server = "ps-1111111111111111-2222222222222222";
const sighting = (over: Record<string, unknown> = {}) => ({
  kind: "npc_sighting", installId: character, eventId: "ps:1760000000:2:npc_sighting", capturedAt: "2025-10-09T08:53:30.000Z",
  npcId: 197, name: "Marshal McBride", mapId: 1429, x: 48.17, y: 42.95, positionKind: "interaction", role: "questgiver", ...over,
});
const request = (payload: unknown) => new Request("https://everloot.app/api/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
const recorderUpload = (records: unknown[]) => ({ addonVersion: "polestar-recorder", source: "polestar_recorder", records });

async function post(payload: unknown) {
  vi.resetModules();
  const { POST } = await import("./route.js");
  return POST(request(payload));
}

beforeEach(() => {
  store.putUpload.mockReset().mockResolvedValue(true);
  store.recorderInstall.mockReset().mockReturnValue(server);
  store.reporter.mockReset().mockReturnValue("0123456789abcdef");
});

describe("POST /api/intake with a Polestar Recorder upload", () => {
  test("stores the rows under the server's install id, with the source and the reporter", async () => {
    const response = await post(recorderUpload([sighting(), sighting({ eventId: "ps:1760000000:3:npc_sighting", role: undefined, level: undefined })]));
    expect(response.status).toBe(200);
    expect(store.recorderInstall.mock.calls[0]![1]).toBe(character);
    const [, installId, stored] = store.putUpload.mock.calls[0]!;
    expect(installId).toBe(server);
    expect(stored.source).toBe("polestar_recorder");
    expect(stored.reporter).toBe("0123456789abcdef");
    expect(stored.records.map((r: { installId: string }) => r.installId)).toEqual([server, server]);
    expect(JSON.stringify(stored)).not.toContain(character);
  });

  test("takes NPC positions, quests, loot, instance entrances, encounters and object sightings only", async () => {
    const at = { installId: character, capturedAt: "2025-10-09T08:53:30.000Z" };
    const vendor = { ...at, kind: "vendor", eventId: "ps:1:1:vendor", vendorNpcId: 78, items: [{ itemId: 1, priceCopper: 5 }] };
    const entrance = { ...at, kind: "instance_entrance", eventId: "ps:1760000000:5:instance_entrance", instanceMapId: 36, name: "Deadmines", instanceType: "party", mapId: 1436, x: 42.5, y: 71.6 };
    const encounter = { ...at, kind: "encounter", eventId: "ps:1760000000:6:encounter", encounterId: 1144, name: "Edwin VanCleef", instanceMapId: 36, success: true, npcIds: [639] };
    const chest = { ...at, kind: "object_sighting", eventId: "ps:1760000000:7:object_sighting", objectId: 2843, name: "Battered Chest", mapId: 1436, x: 30.1, y: 50.2 };
    const rare = sighting({ eventId: "ps:1760000000:8:npc_sighting", npcId: 61, name: "Thuros Lightfingers", positionKind: "vignette", role: undefined, rank: "rare", level: 11 });
    const body = await (await post(recorderUpload([sighting(), entrance, encounter, chest, rare, vendor]))).json();
    expect(body.accepted).toHaveLength(5);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].reason).toMatch(/instance entrances, encounters and object sightings only/);
    const [, , stored] = store.putUpload.mock.calls[0]!;
    expect(stored.records.map((r: { kind: string }) => r.kind)).toEqual(["npc_sighting", "instance_entrance", "encounter", "object_sighting", "npc_sighting"]);
    expect(stored.records.every((r: { installId: string }) => r.installId === server)).toBe(true);
  });

  test("refuses a batch without one polestar- character id", async () => {
    for (const records of [[sighting({ installId: "abcd-1234-abcd-1234" })], [sighting(), sighting({ installId: `polestar-${"b".repeat(40)}` })]]) {
      const response = await post(recorderUpload(records));
      expect(response.status).toBe(422);
    }
    expect(store.putUpload).not.toHaveBeenCalled();
  });

  test("an addon upload cannot use an id the server keeps for Recorder rows", async () => {
    const response = await post({ addonVersion: "0.3.10", records: [sighting({ installId: server, level: 5, reaction: "friendly" })] });
    expect(response.status).toBe(422);
    expect((await response.json()).rejected[0].reason).toMatch(/ps-/);
  });
});

describe("recorderInstall", () => {
  const quota = createIntakeQuota({ env: { NODE_ENV: "test" } });
  const req = request({});
  test("is stable for one character, different for another, and never holds what it was given", () => {
    const a = quota.recorderInstall(req, character)!;
    expect(a).toMatch(RECORDER_INSTALL);
    expect(quota.recorderInstall(req, character)).toBe(a);
    const b = quota.recorderInstall(req, `polestar-${"b".repeat(40)}`)!;
    expect(b).not.toBe(a);
    // The same address: the second half is shared, which is what folds the two characters into one voter.
    expect(b.split("-")[2]).toBe(a.split("-")[2]);
    expect(a).not.toContain("aaaaaaaa");
  });
});
