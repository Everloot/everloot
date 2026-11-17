import { expect, test } from "vitest";
import type { ClientDisenchant } from "../src/client-disenchant.js";
import { allBandYields, auctionCut, bandLabel, bandYield, disenchantTablesFromRecords, expectedValue, placer, playerBands, reportedLevels, unitsRange } from "../src/disenchant.js";

const files: ClientDisenchant = {
  schema: "everloot.client-disenchant/1",
  label: "Found in game files, unconfirmed",
  credit: "test",
  build: { product: "test", buildId: 1, version: "1.0.0.1", buildConfig: "x", definitions: null, extractedAt: "2026-11-17T00:00:00Z" },
  bands: [[4, 4, 2, 5, 15, 0], [5, 4, 2, 16, 20, 0], [3, 2, 2, 5, 15, 0], [54, 4, 4, 61, 99, 0]],
  items: { 4: [100, 101], 5: [110] },
  noDisenchant: [120],
  unleveled: { 4: [130, 131], 2: [140] },
  note: "ids, bands, qualities and item levels are the game files'; what a band yields comes from players",
};

const DUST = 10940, ESSENCE = 10938;
let n = 0;
const de = (installId: string, sourceItemId: number, items: [number, number][], extra: Record<string, unknown> = {}) => ({
  kind: "loot", lootType: "disenchant", sourceEvidence: "loot-api", installId, sourceItemId, eventId: `e${n++}`,
  capturedAt: "2026-11-15T10:00:00Z", items: items.map(([itemId, count]) => ({ itemId, count })), ...extra,
});
const seen = (installId: string, itemId: number, quality: string, itemLevel: number) => ({ kind: "item_seen", installId, itemId, name: "x", quality, itemLevel });

test("windows pool by band; a band is rated once 3 installs disenchanted in it", () => {
  const records = [
    de("a", 100, [[DUST, 1]]), de("a", 101, [[DUST, 2]]), de("b", 100, [[ESSENCE, 1]]), de("c", 101, [[DUST, 1]]),
    de("a", 110, [[DUST, 3]]),
  ];
  const t = disenchantTablesFromRecords(records, files);
  const band4 = bandYield(t, placer(files).bands.find((b) => b.id === 4)!);
  expect(band4).toMatchObject({ state: "rated", windows: 4, installs: 3, missingInstalls: 0 });
  expect(band4.rows.map((r) => [r.materialId, r.withMaterial, r.chance, r.perDisenchant, r.min, r.max])).toEqual([
    [DUST, 3, 0.75, 1, 1, 2],
    [ESSENCE, 1, 0.25, 0.25, 1, 1],
  ]);
  const band5 = bandYield(t, placer(files).bands.find((b) => b.id === 5)!);
  expect(band5).toMatchObject({ state: "short", windows: 1, installs: 1, missingInstalls: 2, rows: [] });
  expect(t.items.get(100)?.windows).toBe(2);
});

test("only attributed disenchant windows with an install and an item count", () => {
  const records = [
    de("a", 100, [[DUST, 1]]),
    de("a", 100, [[DUST, 1]], { lootType: "kill" }),
    de("a", 100, [[DUST, 1]], { sourceEvidence: undefined }),
    de("", 100, [[DUST, 1]]),
    { ...de("a", 100, [[DUST, 1]]), sourceItemId: undefined },
    de("a", 100, [[DUST, 1], [DUST, 2]]),
  ];
  const t = disenchantTablesFromRecords(records, files);
  const tally = t.bands.get(4)!;
  expect(tally.windows).toBe(2);
  // A material listed twice in one window is one window with its units added.
  expect(tally.materials.get(DUST)).toMatchObject({ windows: 2, units: 4 });
});

test("items the files give no level are placed by the level most installs reported; flagged and unknown items are not", () => {
  const records = [
    seen("a", 130, "uncommon", 18), seen("b", 130, "uncommon", 18), seen("c", 130, "uncommon", 12),
    seen("a", 131, "uncommon", 18), seen("b", 131, "uncommon", 12),
    de("a", 130, [[DUST, 2]]), de("a", 131, [[DUST, 2]]), de("a", 120, [[DUST, 2]]), de("a", 999, [[DUST, 2]]),
  ];
  const levels = reportedLevels(records);
  expect(levels.get(130)).toEqual({ quality: 2, itemLevel: 18 });
  expect(levels.has(131)).toBe(false); // a tie places nothing
  const sort = placer(files, playerBands(files, levels));
  expect(sort.place(130)).toMatchObject({ kind: "band", from: "players", band: { id: 5 } });
  expect(sort.place(100)).toMatchObject({ kind: "band", from: "files", band: { id: 4 } });
  expect(sort.place(120)).toEqual({ kind: "no-disenchant" });
  expect(sort.place(140)).toEqual({ kind: "none" });
  const t = disenchantTablesFromRecords(records, files);
  expect(t.bands.get(5)?.windows).toBe(1);
  expect(t.unplaced).toBe(3);
  expect(t.playerBands).toEqual(new Map([[130, 5]]));
});

test("each install votes once, with its latest report of the item's level", () => {
  const at = (installId: string, itemLevel: number, capturedAt: string) => ({ ...seen(installId, 130, "uncommon", itemLevel), capturedAt });
  // A, B and C saw level 12; A and B saw level 18 later (a patch): 18 now has 2 installs, 12 has 1.
  const records = [
    at("a", 12, "2026-11-01T00:00:00Z"), at("b", 12, "2026-11-01T00:00:00Z"), at("c", 12, "2026-11-01T00:00:00Z"),
    at("a", 18, "2026-11-10T00:00:00Z"), at("b", 18, "2026-11-10T00:00:00Z"),
  ];
  expect(reportedLevels(records).get(130)).toEqual({ quality: 2, itemLevel: 18 });
  // An older report arriving later in the corpus does not move a newer vote back.
  expect(reportedLevels([...records, at("a", 12, "2026-10-01T00:00:00Z")]).get(130)).toEqual({ quality: 2, itemLevel: 18 });
});

test("expected value counts zeros, keeps a missing price out and says so", () => {
  const t = disenchantTablesFromRecords([de("a", 100, [[DUST, 1]]), de("b", 100, [[DUST, 3]]), de("c", 100, [[ESSENCE, 1]]), de("c", 101, [[ESSENCE, 1]])], files);
  const rows = bandYield(t, placer(files).bands.find((b) => b.id === 4)!).rows;
  // Dust: 4 units over 4 disenchants = 1 each; essence: 2 over 4 = 0.5 each.
  expect(expectedValue(rows, (id) => (id === DUST ? 100 : 1000))).toEqual({ value: 600, missing: [], complete: true });
  expect(expectedValue(rows, (id) => (id === DUST ? 100 : null))).toEqual({ value: 100, missing: [ESSENCE], complete: false });
});

test("capture days outside the corpus time are not dated", () => {
  const t = disenchantTablesFromRecords([de("a", 100, [[DUST, 1]], { capturedAt: "2026-12-30T00:00:00Z" }), de("b", 100, [[DUST, 1]])], files, "2026-11-20T00:00:00Z");
  expect(t.bands.get(4)).toMatchObject({ first: "2026-11-15", last: "2026-11-15", windows: 2 });
});

test("labels and order", () => {
  const bands = placer(files).bands;
  expect(bandLabel(bands.find((b) => b.id === 4)!)).toBe("Uncommon armor, item level 5 to 15");
  expect(bandLabel(bands.find((b) => b.id === 54)!)).toBe("Epic armor, item level 61 and up");
  expect(bandLabel(bands.find((b) => b.id === 3)!)).toBe("Uncommon weapons, item level 5 to 15");
  expect(allBandYields(disenchantTablesFromRecords([], files), bands).map((y) => y.band.id)).toEqual([4, 5, 54, 3]);
  expect(unitsRange({ min: 1, max: 1 })).toBe("1");
  expect(unitsRange({ min: 1, max: 3 })).toBe("1 to 3");
  expect(auctionCut("Horde")).toBe(0.05);
  expect(auctionCut("Neutral")).toBe(0.15);
});
