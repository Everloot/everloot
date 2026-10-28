import { beforeEach, expect, test, vi } from "vitest";
import type { EncounterRow, InstanceEntranceRow } from "../../../kb/src/instances";
import type { PageType } from "../../../kb/src/wiki/page";
import type { WorldMapData } from "../../../kb/src/world-map-data";

// The loaders read storage; the facts tests hand the readers their facts directly.
const storage = vi.hoisted(() => ({ instances: vi.fn(), items: vi.fn() }));
vi.mock("./rollup-compute", () => ({ loadInstanceFacts: storage.instances, loadItemFacts: storage.items }));

import { boundInstance, dungeonFacts, loadDungeonFacts } from "./wiki-dungeon";
import type { ZoneSightings } from "./zones";

// SYNTHETIC data in the shape of the generated file; the numbers and names are made up.
const data: WorldMapData = {
  schema: "everloot.world-map/1",
  source: { name: "test", status: "found in game files, unconfirmed", licence: "l", licenceUrl: "u", product: "p", buildId: 1, version: "1.0.0.1", buildConfig: "c", definitions: null, extractedAt: "2026-10-17T00:00:00Z", tables: [] },
  continents: [
    { id: 0, name: "Eastern Kingdoms", bounds: { top: 7000, bottom: -16000, left: 16000, right: -19000 } },
    { id: 1, name: "Kalimdor", bounds: { top: 12000, bottom: -11000, left: 17000, right: -19000 } },
  ],
  zones: [
    { uiMapId: 1429, name: "Synthetic Forest", continentId: 0, bounds: { top: -7940, bottom: -10254, left: 1535, right: -1935 } },
    { uiMapId: 1411, name: "Synthetic Dunes", continentId: 1, bounds: { top: 1800, bottom: -1700, left: -2000, right: -7250 } },
  ],
  heldBackZones: [
    { uiMapId: 2482, name: "Synthetic Peak", continentId: 1, bounds: { top: 6000, bottom: 4000, left: -900, right: -4400 } },
  ],
  entrances: [
    { mapId: 34, name: "Synthetic Stockade", raid: false, continentId: 0, worldX: -8762.4, worldY: 848, minLevel: 17, maxLevel: 24 },
    { mapId: 36, name: "Synthetic Mine", raid: false, continentId: 0, worldX: -9500, worldY: -500, minLevel: 16, maxLevel: 16 },
    { mapId: 389, name: "Synthetic Chasm", raid: false, continentId: 1, worldX: 1500, worldY: -4423.4 },
    { mapId: 409, name: "Synthetic Core", raid: true, continentId: 1, worldX: 0, worldY: -3000, minLevel: 60, maxLevel: 60 },
    // In the held-back zone only: the site lists no instance for it, as the map shows no pin.
    { mapId: 99, name: "Synthetic Spire", raid: true, continentId: 1, worldX: 5000, worldY: -2000, minLevel: 60, maxLevel: 60 },
  ],
  flightNodes: [],
  flightPaths: [],
  warnings: [],
};

const asOf = new Date("2026-10-21T12:00:00Z");
const ids = ["install-a", "install-b", "install-c"];
const entrance = (installId: string, capturedAt: string): InstanceEntranceRow =>
  ({ installId, instanceMapId: 36, name: "Synthetic Mine", instanceType: "party", mapId: 1429, x: 40, y: 50, capturedAt });
const kill = (installId: string, encounterId: number, name: string, capturedAt: string): EncounterRow =>
  ({ installId, encounterId, name, instanceMapId: 36, success: true, npcIds: [encounterId * 10], capturedAt });

/** The Mine: 3 installs zoned in from one place, 3 report the Warden, and only 2 the Foreman. */
const seen: ZoneSightings = {
  asOf,
  instances: {
    entrances: ids.map((i, n) => entrance(i, `2026-10-1${7 + n}T10:00:00Z`)),
    encounters: [...ids.map((i) => kill(i, 1, "Synthetic Warden", "2026-10-18T11:00:00Z")), ...ids.slice(0, 2).map((i) => kill(i, 2, "Synthetic Foreman", "2026-10-19T11:00:00Z"))],
  },
};

const page = (entrance?: string, type: PageType = "dungeon") => ({ type, binds: entrance === undefined ? {} : { entrance } });

beforeEach(() => {
  storage.instances.mockReset();
  storage.items.mockReset();
});

test("the entrance binding names the instance by the game files' entrance name; other types, unbound pages and unknown entrances name none", () => {
  expect(boundInstance(page("synthetic-mine"), data)).toBe(36);
  expect(boundInstance(page("synthetic-core", "raid"), data)).toBe(409);
  expect(boundInstance(page(undefined), data)).toBeNull();
  expect(boundInstance(page("lost-vault"), data)).toBeNull();
  expect(boundInstance({ type: "zone", binds: { zone: 1429 } }, data)).toBeNull();
});

test("the level is the game files' own: one level stays one number, a range stays that range, none stays none", () => {
  expect(dungeonFacts(page("synthetic-mine"), seen, data)?.level).toBe("16");
  expect(dungeonFacts(page("synthetic-core", "raid"), {}, data)?.level).toBe("60");
  expect(dungeonFacts(page("synthetic-stockade"), {}, data)?.level).toBe("17–24");
  expect(dungeonFacts(page("synthetic-chasm"), {}, data)?.level).toBeNull();
});

test("the game files' entrance carries no evidence; a confirmed entrance and each boss keep their installs and last seen", () => {
  const facts = dungeonFacts(page("synthetic-mine"), seen, data)!;
  expect(facts.row.files).toEqual([{ mapId: 1429, zoneName: "Synthetic Forest", x: expect.any(Number), y: expect.any(Number) }]);
  expect(facts.row.confirmed).toEqual([{ mapId: 1429, zoneName: "Synthetic Forest", x: 40, y: 50, installs: 3, lastSeen: "2026-10-19T10:00:00.000Z" }]);
  expect(facts.row.bosses).toEqual([{ encounterId: 1, name: "Synthetic Warden", kills: 3, npcIds: [10], reporters: 3, lastSeen: "2026-10-18T11:00:00.000Z" }]);
  expect(facts.href).toBe("/database/instances/36-synthetic-mine");
  expect(facts.unreachable).toBe(false);
});

test("each relation keeps its own gate: a boss or an entrance fewer than 3 installs report is not listed", () => {
  expect(dungeonFacts(page("synthetic-mine"), seen, data)!.row.bosses.map((b) => b.name)).toEqual(["Synthetic Warden"]);
  const two: ZoneSightings = { asOf, instances: { entrances: seen.instances!.entrances.slice(0, 2), encounters: seen.instances!.encounters.filter((e) => e.installId !== "install-c") } };
  expect(dungeonFacts(page("synthetic-mine"), two, data)!.row).toMatchObject({ confirmed: [], bosses: [], reported: 2 });
});

test("an instance the site does not list gives no facts: a held-back entrance's level stays off the page, and so does an entrance the files lack", () => {
  expect(dungeonFacts(page("synthetic-spire", "raid"), {}, data)).toBeNull();
  expect(dungeonFacts(page("lost-vault"), seen, data)).toBeNull();
  expect(dungeonFacts(page(undefined), seen, data)).toBeNull();
});

test("with storage down, the game files' facts stay and players' reports are unknown rather than none", () => {
  const facts = dungeonFacts(page("synthetic-mine"), { ...seen, unreachable: true }, data)!;
  expect(facts).toMatchObject({ unreachable: true, level: "16", row: { confirmed: [], bosses: [] } });
  expect(facts.row.files).toHaveLength(1);
});

test("storage is read only for a page that can show facts", async () => {
  storage.instances.mockResolvedValue({ entrances: [], encounters: [], sightings: [], unreachable: true, dataAsOf: null });
  storage.items.mockResolvedValue({ unreachable: false });
  expect(await loadDungeonFacts({ type: "zone", binds: { zone: 1436 } })).toBeNull();
  expect(await loadDungeonFacts(page(undefined))).toBeNull();
  expect(await loadDungeonFacts(page("lost-vault"))).toBeNull();
  expect(storage.instances).not.toHaveBeenCalled();
  // The Deadmines in the committed game files, read with storage down.
  expect(await loadDungeonFacts(page("deadmines"))).toMatchObject({ unreachable: true, href: "/database/instances/36-deadmines", row: { files: [{ mapId: 1436, zoneName: "Westfall" }] } });
  expect(storage.instances).toHaveBeenCalledTimes(1);
});
