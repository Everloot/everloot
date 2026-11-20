import { describe, expect, test } from "vitest";
import type { ZoneBounds } from "../src/map-bounds.js";
import {
  checkReportedBounds, lineSide, mapToWorld, placeEntrances, placeFlights, worldToMap, worldToZone, zoneAt, zoneTable, zoneToMap, zoneToWorld,
  type FlightSide,
} from "../src/world-coords.js";
import type { WorldMapData } from "../src/world-map-data.js";

// SYNTHETIC rectangles, not measured data: the numbers are rounded stand-ins for two neighbouring zones,
// chosen so that Stormwind's flight master (-8840.6, 489.7) falls inside the first one.
const data: Pick<WorldMapData, "zones" | "entrances"> = {
  zones: [
    { uiMapId: 1429, name: "Synthetic Forest", continentId: 0, bounds: { top: -7940, bottom: -10254, left: 1535, right: -1935 } },
    { uiMapId: 1434, name: "Synthetic Vale", continentId: 0, bounds: { top: -11000, bottom: -15000, left: 1000, right: -1000 } },
    { uiMapId: 1411, name: "Synthetic Dunes", continentId: 1, bounds: { top: 1800, bottom: -1700, left: -2000, right: -7250 } },
  ],
  entrances: [
    { mapId: 34, name: "Stormwind Stockade", raid: false, continentId: 0, worldX: -8762.4, worldY: 848 },
    { mapId: 229, name: "Blackrock Spire", raid: false, continentId: 0, worldX: -7522.5, worldY: -1233 },
    { mapId: 409, name: "Molten Core", raid: true, continentId: 0, worldX: -7522.9, worldY: -1233.4 },
    { mapId: 389, name: "Ragefire Chasm", raid: false, continentId: 1, worldX: 1816.8, worldY: -4423.4 },
  ],
};
const zones = zoneTable(data);
const stormwind = { continentId: 0, worldX: -8840.6, worldY: 489.7 };

describe("zone table", () => {
  test("lists each zone by map id with its continent and rectangle", () => {
    expect(zones.map((z) => [z.mapId, z.name, z.continentId])).toEqual([[1411, "Synthetic Dunes", 1], [1429, "Synthetic Forest", 0], [1434, "Synthetic Vale", 0]]);
  });
});

describe("conversions", () => {
  test("a world point becomes zone coordinates and comes back", () => {
    const spot = worldToZone(zones, 1429, stormwind)!;
    expect(spot.x).toBeCloseTo((489.7 - 1535) / (-1935 - 1535), 6);
    expect(spot.y).toBeCloseTo((-8840.6 + 7940) / (-10254 + 7940), 6);
    const back = zoneToWorld(zones, 1429, spot.x, spot.y)!;
    expect(back.worldX).toBeCloseTo(stormwind.worldX, 6);
    expect(back.worldY).toBeCloseTo(stormwind.worldY, 6);
  });

  test("zone corners are the bounds: (0,0) top-left, (1,1) bottom-right", () => {
    expect(zoneToWorld(zones, 1429, 0, 0)).toEqual({ continentId: 0, worldX: -7940, worldY: 1535 });
    expect(zoneToWorld(zones, 1429, 1, 1)).toEqual({ continentId: 0, worldX: -10254, worldY: -1935 });
  });

  test("an unknown zone converts nothing", () => {
    expect(zoneToWorld(zones, 4242, 0.5, 0.5)).toBeNull();
    expect(zoneToMap(zones, 4242, 0.5, 0.5)).toBeNull();
  });

  test("zone coordinates outside 0..1, and points outside the zone or on another continent, are refused", () => {
    expect(zoneToWorld(zones, 1429, 1.2, 0.5)).toBeNull();
    expect(zoneToWorld(zones, 1429, Number.NaN, 0.5)).toBeNull();
    expect(worldToZone(zones, 1429, { continentId: 0, worldX: -12000, worldY: 0 })).toBeNull();
    expect(worldToZone(zones, 1429, { ...stormwind, continentId: 1 })).toBeNull();
  });

  test("the stitched map is north-up in yards: east is +x and south is +y", () => {
    const here = { continentId: 0, worldX: 100, worldY: 200 };
    const base = worldToMap(here);
    expect(worldToMap({ ...here, worldX: 150 }).y).toBeLessThan(base.y);
    expect(worldToMap({ ...here, worldY: 250 }).x).toBeLessThan(base.x);
    expect(mapToWorld(base)).toEqual(here);
    expect(worldToMap({ continentId: 1, worldX: 0, worldY: 0 })).toEqual({ continentId: 1, x: 0, y: 0 });
  });

  test("a zone spot goes straight to the stitched map", () => {
    expect(zoneToMap(zones, 1429, 0.25, 0.75)).toEqual(worldToMap(zoneToWorld(zones, 1429, 0.25, 0.75)!));
  });

  test("Westfall lies south of Stormwind on the stitched map, as in the game", () => {
    const sw = worldToMap(stormwind);
    const wf = worldToMap({ continentId: 0, worldX: -10628.9, worldY: 1036.7 });
    expect(wf.y).toBeGreaterThan(sw.y);
    expect(wf.x).toBeLessThan(sw.x);
  });

  test("zoneAt finds the zone around a point and prefers the smaller one where zones overlap", () => {
    expect(zoneAt(zones, stormwind)?.mapId).toBe(1429);
    expect(zoneAt(zones, { continentId: 0, worldX: -12000, worldY: 0 })?.mapId).toBe(1434);
    expect(zoneAt(zones, { continentId: 0, worldX: 0, worldY: 0 })).toBeNull();
    const city = [...zones, { mapId: 1453, name: "City", continentId: 0, bounds: { top: -8700, bottom: -8900, left: 600, right: 400 } }];
    expect(zoneAt(city, stormwind)?.mapId).toBe(1453);
  });

  test("where the game files name the zone, that zone wins over the smallest rectangle", () => {
    const city = [...zones, { mapId: 1453, name: "City", continentId: 0, bounds: { top: -8700, bottom: -8900, left: 600, right: 400 } }];
    expect(zoneAt(city, stormwind, 1429)?.mapId).toBe(1429);
    // A zone not in the list (a held-back one, when only released zones are passed) gives no zone, not a neighbour.
    expect(zoneAt(city, stormwind, 2548)).toBeNull();
  });
});

describe("entrance pins", () => {
  const pins = placeEntrances(data);

  test("every entrance is placed from the files, with both coordinate systems", () => {
    expect(pins).toHaveLength(3);
    expect(pins[0]).toMatchObject({ names: ["Stormwind Stockade"], raid: false, world: { continentId: 0, worldX: -8762.4, worldY: 848 } });
    expect(pins[0].map).toEqual({ continentId: 0, x: -848, y: 8762.4 });
  });

  test("entrances within a yard share one pin, and the pin is a raid if any of them is", () => {
    expect(pins[1]).toMatchObject({ names: ["Blackrock Spire", "Molten Core"], raid: true });
  });

  test("an entrance on another continent stays there", () => {
    expect(pins[2]).toMatchObject({ names: ["Ragefire Chasm"], world: { continentId: 1 } });
  });
});

describe("flight masters and lines", () => {
  const held = { uiMapId: 2548, name: "Synthetic Held", continentId: 0, bounds: { top: -9700, bottom: -6467, left: -1892, right: -6742 } };
  const flights = placeFlights({
    zones: data.zones,
    heldBackZones: [held],
    flightNodes: [
      { id: 2, name: "Stormwind", continentId: 0, worldX: -8840.6, worldY: 489.7 },
      { id: 4, name: "Held Post", continentId: 0, worldX: -8000, worldY: -4000 },
    ],
    flightPaths: [
      { from: 2, to: 4, continentId: 0, points: [[-8840, 489], [-8000, -4000]] },
      { from: 2, to: 2, continentId: 0, points: [[-8840, 489], [-8850, 500]] },
    ],
  });

  test("masters and line points are on the stitched map", () => {
    expect(flights.masters[0]).toMatchObject({ id: 2, map: { continentId: 0, x: -489.7, y: 8840.6 }, heldBack: false });
    expect(flights.lines[0]!.points[1]).toEqual({ continentId: 0, x: 4000, y: 8000 });
  });

  test("a master that lies in a held-back zone only, and a line that ends at one, are flagged", () => {
    expect(flights.masters.map((m) => m.heldBack)).toEqual([false, true]);
    expect(flights.lines.map((l) => l.heldBack)).toEqual([true, false]);
  });

  test("the zone the game files give decides the flag, not which rectangles reach over the master", () => {
    const { masters } = placeFlights({
      zones: data.zones,
      heldBackZones: [held],
      flightNodes: [
        // Inside the held-back rectangle only, but on ground a released zone shows (Talonbranch Glade, under Mount Hyjal's rectangle).
        { id: 4, name: "Released Post", continentId: 0, worldX: -8000, worldY: -4000, uiMapId: 1429 },
        // Inside a released rectangle, but on ground the held-back zone shows.
        { id: 2, name: "Stormwind", continentId: 0, worldX: -8840.6, worldY: 489.7, uiMapId: 2548 },
      ],
      flightPaths: [],
    });
    expect(masters.map((m) => [m.id, m.heldBack])).toEqual([[4, false], [2, true]]);
  });

  test("a master keeps its side, and a line serves the side both ends serve", () => {
    const node = (id: number, faction?: FlightSide) => ({ id, name: `Post ${id}`, continentId: 0, worldX: -8840.6, worldY: 489.7, ...(faction ? { faction } : {}) });
    const line = (from: number, to: number) => ({ from, to, continentId: 0, points: [[-8840, 489], [-8850, 500]] as [number, number][] });
    const { masters, lines } = placeFlights({
      zones: data.zones, heldBackZones: [],
      flightNodes: [node(1, "alliance"), node(2, "horde"), node(3, "both"), node(4)],
      flightPaths: [line(1, 3), line(3, 2), line(3, 3), line(1, 2), line(1, 4)],
    });
    expect(masters.map((m) => m.faction)).toEqual(["alliance", "horde", "both", undefined]);
    expect(lines.map((l) => l.faction)).toEqual(["alliance", "horde", "both", undefined, undefined]);
    expect(lineSide("both", "both")).toBe("both");
  });
});

describe("entrance pins and the game files' zone", () => {
  test("a pin keeps the zone the files give its entrance", () => {
    const pins = placeEntrances({ entrances: [{ ...data.entrances[0]!, uiMapId: 1453 }, data.entrances[3]!] });
    expect(pins.map((p) => p.uiMapId)).toEqual([1453, undefined]);
  });
});

describe("in-game reports as a cross-check", () => {
  const reported = (change: Partial<ZoneBounds> = {}): ZoneBounds =>
    ({ mapId: 1429, continentId: 0, left: 1535, top: -7940, right: -1935, bottom: -10254, installs: 3, agreed: true, ...change });

  test("agreed reports within a yard of the files agree", () => {
    expect(checkReportedBounds(zones, [reported({ left: 1535.8, bottom: -10253.4 })])).toEqual([
      { mapId: 1429, name: "Synthetic Forest", result: "agrees", worstEdge: expect.closeTo(0.8, 6) },
    ]);
  });

  test("agreed reports that differ are reported with the worst edge", () => {
    const [check] = checkReportedBounds(zones, [reported({ right: -1599.6 })]);
    expect(check.result).toBe("differs");
    expect(check.worstEdge).toBeCloseTo(335.4, 6);
  });

  test("another continent is a difference", () => {
    expect(checkReportedBounds(zones, [reported({ continentId: 1 })])[0].result).toBe("differs");
  });

  test("unagreed reports and zones the files do not know are not compared", () => {
    expect(checkReportedBounds(zones, [reported({ installs: 2, agreed: false }), reported({ mapId: 4242 })])).toEqual([]);
  });
});
