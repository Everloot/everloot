import { afterEach, beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), api: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: store.loadCorpus } }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { api: store.api } }));

import { disenchantResponse } from "@everloot/protocol";
import { GET } from "./route";

const req = () => new Request("https://everloot.app/api/rollups/disenchant");
const AS_OF = "2026-11-17T10:00:00.000Z";
let n = 0;
// Item 763 is uncommon armor the game files place in band 4 (item level 5 to 15).
const de = (installId: string, materials: [number, number][]) => ({
  installId, eventId: `e${n++}`, capturedAt: "2026-11-16T10:00:00.000Z", kind: "loot", lootType: "disenchant",
  sourceEvidence: "loot-api", sourceItemId: 763, items: materials.map(([itemId, count]) => ({ itemId, count })),
});

beforeEach(() => {
  store.api.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  store.loadCorpus.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

test("a band disenchanted by 3 installs lists its materials; the answer matches the protocol", async () => {
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: AS_OF,
    records: [de("a", [[10940, 1]]), de("b", [[10940, 2]]), de("c", [[10938, 1]]), de("c", [[10940, 1]])],
  });
  const res = await GET(req());
  const body = disenchantResponse.parse(await res.json());
  expect(body).toMatchObject({ dataAsOf: AS_OF, unreachable: false, unplaced: 0 });
  const band = body.bands.find((b) => b.bandId === 4)!;
  expect(band).toMatchObject({ itemClass: "armor", quality: "uncommon", minLevel: 5, maxLevel: 15, state: "rated", windows: 4, installs: 3, label: "Uncommon armor, item level 5 to 15" });
  expect(band.materials).toEqual([
    { itemId: 10940, withMaterial: 3, chance: 0.75, perDisenchant: 1, min: 1, max: 2 },
    { itemId: 10938, withMaterial: 1, chance: 0.25, perDisenchant: 0.25, min: 1, max: 1 },
  ]);
  // Every band of the build is listed, the ones nobody disenchanted with nothing in them.
  expect(body.bands.filter((b) => b.state === "none").every((b) => b.materials.length === 0 && b.windows === 0)).toBe(true);
  expect(res.headers.get("x-everloot-credit")).toBe("Data from Everloot (https://everloot.app), CC BY-SA 4.0.");
});

test("fewer than 3 installs: counts only, no materials", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 1, dataAsOf: AS_OF, records: [de("a", [[10940, 1]]), de("b", [[10940, 1]])] });
  const body = disenchantResponse.parse(await (await GET(req())).json());
  expect(body.bands.find((b) => b.bandId === 4)).toMatchObject({ state: "short", windows: 2, installs: 2, missingInstalls: 1, materials: [] });
});

test("unreadable storage says so and lists no disenchants", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const body = disenchantResponse.parse(await (await GET(req())).json());
  expect(body.unreachable).toBe(true);
  expect(body.bands.every((b) => b.windows === 0)).toBe(true);
});
