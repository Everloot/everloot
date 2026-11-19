import { describe, expect, test } from "vitest";
import {
  allCategories, candidateCounts, categoryCounts, CATEGORY_GROUPS, CATEGORY_IDS, continentFromSlug, continentPath, DEFAULT_CATEGORIES, DEFAULT_SPOILERS,
  DEFAULT_URL_STATE, initialView, labelFontPx, mapHref, mapUrlSearch, openPageLink, parseDeepLink, parseMapUrl, parseViewState, parseZoneLink, pinHref,
  placeLabels, readPinSet, searchMap, servesSide, showParam, SPOT_SPAN, spotBox, viewSearch, visibleItems, wayCommand, zoneHref, zoneSearch, zoneSpot,
  type CategoryState, type MapItems, type MapUrlState,
} from "./map-view";

const items: MapItems = {
  zones: [
    { mapId: 1, name: "Open", x: 0, y: 0, width: 1000, height: 500, heldBack: false },
    { mapId: 2, name: "Held", x: 2000, y: 0, width: 100, height: 100, heldBack: true },
    { mapId: 3, name: "Open City", x: 100, y: 100, width: 100, height: 100, heldBack: false },
  ],
  entrances: [{ id: "e", names: ["Open Dungeon"], raid: false, x: 5, y: 5, worldX: 0, worldY: 0 }],
  pins: [
    { id: "n1", kind: "npc", npcId: 1, name: "A", mapId: 1, zoneName: "Open", x: 0, y: 0, zoneX: 1, zoneY: 1, reporters: 3, heldBack: false },
    { id: "n2", kind: "npc", npcId: 2, name: "B", mapId: 2, zoneName: "Held", x: 0, y: 0, zoneX: 1, zoneY: 1, reporters: 3, heldBack: true },
    { id: "v1", kind: "vendor", npcId: 3, name: "C", mapId: 1, zoneName: "Open", x: 0, y: 0, zoneX: 1, zoneY: 1, reporters: 3, heldBack: false },
  ],
  treasures: [],
  flightMasters: [
    { id: "f1", name: "Open Post", x: 1, y: 1, heldBack: false },
    { id: "f2", name: "Held Post", x: 2, y: 2, heldBack: true },
  ],
  flightLines: [
    { id: "l1", from: "f1", to: "f2", points: [[1, 1], [2, 2]], heldBack: true },
    { id: "l2", from: "f1", to: "f1", points: [[1, 1], [3, 3]], heldBack: false },
  ],
};

const raidToo: MapItems = { ...items, entrances: [...items.entrances, { id: "r", names: ["Open Raid"], raid: true, x: 6, y: 6, worldX: 1, worldY: 1 }] };

describe("categories and the spoiler switch", () => {
  test("spoilers are off by default, and held-back zones and their points stay hidden", () => {
    expect(DEFAULT_SPOILERS).toBe(false);
    const shown = visibleItems(items, DEFAULT_CATEGORIES, DEFAULT_SPOILERS);
    expect(shown.zones.map((z) => z.name)).toEqual(["Open", "Open City"]);
    expect(shown.pins.map((p) => p.id)).toEqual(["n1", "v1"]);
    expect(shown.flightMasters.map((f) => f.id)).toEqual(["f1"]);
    expect(shown.flightLines.map((l) => l.id)).toEqual(["l2"]);
  });

  test("the spoiler switch reveals them", () => {
    const shown = visibleItems(items, DEFAULT_CATEGORIES, true);
    expect(shown.zones.map((z) => z.name)).toEqual(["Open", "Held", "Open City"]);
    expect(shown.pins.map((p) => p.id)).toEqual(["n1", "n2", "v1"]);
    expect(shown.flightMasters).toHaveLength(2);
    expect(shown.flightLines).toHaveLength(2);
  });

  test("one side's flights: its own, the neutral ones and those the files give no side; counts follow", () => {
    const sided: MapItems = {
      ...items,
      flightMasters: [
        { id: "a", name: "A", x: 1, y: 1, heldBack: false, faction: "alliance" }, { id: "h", name: "H", x: 2, y: 2, heldBack: false, faction: "horde" },
        { id: "n", name: "N", x: 3, y: 3, heldBack: false, faction: "both" }, { id: "u", name: "U", x: 4, y: 4, heldBack: false },
      ],
      flightLines: [{ id: "ah", from: "a", to: "h", points: [[1, 1], [2, 2]], heldBack: false, faction: "horde" }],
    };
    expect(visibleItems(sided, DEFAULT_CATEGORIES, false, "alliance").flightMasters.map((f) => f.id)).toEqual(["a", "n", "u"]);
    expect(visibleItems(sided, DEFAULT_CATEGORIES, false, "alliance").flightLines).toEqual([]);
    expect(visibleItems(sided, DEFAULT_CATEGORIES, false, "horde").flightLines.map((l) => l.id)).toEqual(["ah"]);
    expect(visibleItems(sided, DEFAULT_CATEGORIES, false).flightMasters).toHaveLength(4);
    expect(categoryCounts(sided, false, null, "horde").flight).toBe(3);
    expect([servesSide("horde", "alliance"), servesSide(undefined, "horde"), servesSide("both", "alliance")]).toEqual([false, true, true]);
  });

  test("each category toggles on its own; dungeon and raid entrances apart", () => {
    const off = (id: keyof CategoryState) => ({ ...DEFAULT_CATEGORIES, [id]: false });
    expect(visibleItems(items, off("zone"), true).zones).toEqual([]);
    expect(visibleItems(raidToo, off("dungeon"), true).entrances.map((e) => e.id)).toEqual(["r"]);
    expect(visibleItems(raidToo, off("raid"), true).entrances.map((e) => e.id)).toEqual(["e"]);
    expect(visibleItems(items, off("npc"), true).pins.map((p) => p.kind)).toEqual(["vendor"]);
    expect(visibleItems(items, off("vendor"), true).pins.map((p) => p.kind)).toEqual(["npc", "npc"]);
    expect(visibleItems(items, off("flight"), true).flightMasters).toEqual([]);
    expect(visibleItems(items, off("path"), true).flightLines).toEqual([]);
    expect(visibleItems(raidToo, allCategories(false), true)).toEqual({ zones: [], entrances: [], pins: [], treasures: [], flightMasters: [], flightLines: [] });
  });

  test("filtering does not change the input", () => {
    const copy = JSON.stringify(items);
    visibleItems(items, DEFAULT_CATEGORIES, false);
    expect(JSON.stringify(items)).toBe(copy);
  });

  test("Show all and Hide all switch every category", () => {
    expect(allCategories(true)).toEqual(DEFAULT_CATEGORIES);
    expect(Object.values(allCategories(false))).toEqual(CATEGORY_IDS.map(() => false));
  });

  test("the groups hold every category once; live ones carry today's data, the rest wait for uploads", () => {
    const listed = CATEGORY_GROUPS.flatMap((g) => g.categories.map((c) => c.id));
    expect([...listed].sort()).toEqual([...CATEGORY_IDS].sort());
    expect(CATEGORY_GROUPS.map((g) => g.label)).toEqual(["Travel", "Instances", "Places", "Services", "Gathering"]);
    const status = Object.fromEntries(CATEGORY_GROUPS.flatMap((g) => g.categories.map((c) => [c.id, c.status])));
    for (const id of ["flight", "path", "dungeon", "raid", "zone"]) expect(status[id], id).toBe("live");
    for (const id of ["vendor", "trainer", "quest", "service", "npc", "herb", "ore", "chest"]) expect(status[id], id).toBe("waiting");
  });
});

describe("category counts", () => {
  test("each category counts what it would show on the continent, held-back items only with spoilers on", () => {
    const zero = { trainer: 0, quest: 0, service: 0, herb: 0, ore: 0, chest: 0 };
    expect(categoryCounts(raidToo, false)).toEqual({ zone: 2, dungeon: 1, raid: 1, flight: 1, path: 1, npc: 1, vendor: 1, ...zero });
    expect(categoryCounts(raidToo, true)).toEqual({ zone: 3, dungeon: 1, raid: 1, flight: 2, path: 2, npc: 2, vendor: 1, ...zero });
  });

  test("a category's count does not depend on whether it is switched on", () => {
    expect(categoryCounts(items, false)).toEqual(categoryCounts(visibleItems(items, DEFAULT_CATEGORIES, true), false));
  });

  test("flight masters count by name, as the list shows them: two nodes on one spot are one row", () => {
    const twin = { ...items, flightMasters: [...items.flightMasters, { id: "f3", name: "Open Post", x: 1, y: 1, heldBack: false }] };
    expect(categoryCounts(twin, false).flight).toBe(1);
  });

  test("in a zone, only what lies in it counts: the zone, a city inside it, its points; a flight path by either end", () => {
    const city = items.zones[2]!;
    const inCity: MapItems = {
      ...items,
      entrances: [{ id: "c", names: ["City Vault"], raid: false, x: 150, y: 150, worldX: 0, worldY: 0 }],
      flightMasters: [{ id: "f9", name: "City Post", x: 120, y: 120, heldBack: false }, ...items.flightMasters],
      flightLines: [{ id: "l9", from: "f9", to: "f1", points: [[120, 120], [1, 1]], heldBack: false }],
      pins: [{ ...items.pins[0]!, id: "n9", x: 199, y: 101 }],
    };
    expect(categoryCounts(inCity, false, city)).toMatchObject({ zone: 1, dungeon: 1, flight: 1, path: 1, npc: 1, vendor: 0 });
    // The zone around the city counts the city too, and everything in either.
    expect(categoryCounts(inCity, false, items.zones[0]!)).toMatchObject({ zone: 2, dungeon: 1, flight: 2, path: 1, npc: 1 });
    expect(categoryCounts(inCity, false, { x: 5000, y: 5000, width: 1, height: 1 })).toMatchObject({ zone: 0, flight: 0, path: 0, npc: 0 });
  });

  test("places seen by 1 or 2 installs are counted per category in scope, never placed", () => {
    const candidates = [{ category: "npc" as const, mapId: 1, count: 4 }, { category: "npc" as const, mapId: 3, count: 2 }, { category: "vendor" as const, mapId: 3, count: 1 }];
    expect(candidateCounts(candidates, items.zones)).toEqual({ npc: 6, vendor: 1 });
    expect(candidateCounts(candidates, items.zones, items.zones[2]!)).toEqual({ npc: 2, vendor: 1 });
    expect(candidateCounts(candidates, items.zones, items.zones[0]!)).toEqual({ npc: 6, vendor: 1 });
    expect(candidateCounts([], items.zones)).toEqual({});
  });
});

describe("where a link opens the map", () => {
  const base = { x: -5000, y: -5000, width: 10000, height: 10000 };
  const none: { at: [number, number] | null; zoom: number | null; pin: string | null } = { at: null, zoom: null, pin: null };
  const open = (view: Partial<typeof none>, marker: { x: number; y: number } | null = null, zoneId: number | null = null) =>
    initialView({ base, items, view: { ...none, ...view }, marker, zoneId });

  test("a plain /map fits the continent", () => {
    expect(open({})).toEqual({ fit: base });
  });

  test("?zone= alone fits the zone; an unknown zone fits the continent", () => {
    expect(open({}, null, 3)).toEqual({ fit: items.zones[2] });
    expect(open({}, null, 99)).toEqual({ fit: base });
  });

  test("?zone=&x=&y= opens on the spot, before the zone", () => {
    expect(open({}, { x: 500, y: 250 }, 1)).toEqual({ fit: spotBox(500, 250) });
    expect(spotBox(500, 250)).toEqual({ x: 500 - SPOT_SPAN / 2, y: 250 - SPOT_SPAN / 2, width: SPOT_SPAN, height: SPOT_SPAN });
  });

  test("?pin= opens on the pin: an entrance, a flight master or a player-seen NPC; an unknown pin falls through", () => {
    expect(open({ pin: "ee" })).toEqual({ fit: spotBox(5, 5) });
    expect(open({ pin: "f1" })).toEqual({ fit: spotBox(1, 1) });
    expect(open({ pin: "v1" })).toEqual({ fit: spotBox(0, 0) });
    expect(open({ pin: "zz" }, null, 1)).toEqual({ fit: items.zones[0] });
  });

  test("?at=&z= wins over everything else; at without z does not", () => {
    expect(open({ at: [10, 20], zoom: 1.5, pin: "f1" }, { x: 1, y: 1 }, 1)).toEqual({ x: 10, y: 20, zoom: 1.5 });
    expect(open({ at: [10, 20] })).toEqual({ fit: base });
  });

  test("an old address read by parseViewState opens the same view", () => {
    const view = parseViewState({ at: "-512,1830", z: "1.5", pin: "fm12" });
    expect(initialView({ base, items, view, marker: null, zoneId: null })).toEqual({ x: -512, y: 1830, zoom: 1.5 });
  });
});

describe("zone coordinates and /way", () => {
  test("a point is placed on the zone's 0 to 100 scale from its top-left corner", () => {
    const at = zoneSpot(items.zones, 250, 125);
    expect(at?.zone.name).toBe("Open");
    expect(at).toMatchObject({ x: 25, y: 25 });
  });

  test("where zones overlap the smallest wins, and a point outside every zone has no spot", () => {
    expect(zoneSpot(items.zones, 150, 150)?.zone.name).toBe("Open City");
    expect(zoneSpot(items.zones, 150, 150)).toMatchObject({ x: 50, y: 50 });
    expect(zoneSpot(items.zones, 5000, 5000)).toBeNull();
  });

  test("the waypoint line is /way, the two numbers, then the name", () => {
    expect(wayCommand(42.5, 60, "Stormwind Guard")).toBe("/way 42.5 60 Stormwind Guard");
    expect(wayCommand(1, 2, "")).toBe("/way 1 2");
  });
});

describe("map search", () => {
  test("finds zones, entrances, flight masters and NPCs by name, names that start with the query first", () => {
    expect(searchMap(items, "open").map((h) => h.label)).toEqual(["Open", "Open City", "Open Post", "Open Dungeon"]);
    expect(searchMap(items, "open post")[0]).toMatchObject({ kind: "flight", label: "Open Post", id: "f1" });
    expect(searchMap(items, "a")).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "npc", label: "A" })]));
  });

  test("every word must match, and an empty query finds nothing", () => {
    expect(searchMap(items, "open city").map((h) => h.label)).toEqual(["Open City"]);
    expect(searchMap(items, "city open").map((h) => h.label)).toEqual(["Open City"]);
    expect(searchMap(items, "  ")).toEqual([]);
    expect(searchMap(items, "nothing like this")).toEqual([]);
  });

  test("searches only what is shown, so a held-back zone never turns up", () => {
    const shown = visibleItems(items, DEFAULT_CATEGORIES, false);
    expect(searchMap(shown, "held")).toEqual([]);
    expect(searchMap(visibleItems(items, DEFAULT_CATEGORIES, true), "held").map((h) => h.label)).toContain("Held");
  });

  test("a zone hit points at the middle of the zone, and the list is capped", () => {
    expect(searchMap(items, "open city")[0]).toMatchObject({ x: 150, y: 150 });
    const many: MapItems = { ...items, zones: Array.from({ length: 30 }, (_, i) => ({ mapId: i, name: `Zone ${i}`, x: 0, y: 0, width: 1, height: 1, heldBack: false })) };
    expect(searchMap(many, "zone")).toHaveLength(8);
  });
});

describe("links", () => {
  test("a link round-trips", () => {
    expect(parseDeepLink({ zone: "1429", x: "42.5", y: "60" })).toEqual({ mapId: 1429, x: 42.5, y: 60 });
    expect(mapHref({ mapId: 1429, x: 42.55, y: 60 })).toBe("/map?zone=1429&x=42.6&y=60");
  });

  test("anything malformed or out of range is not a pin link", () => {
    for (const q of [
      {}, { zone: "1429" }, { zone: "abc", x: "1", y: "1" }, { zone: "1429", x: "101", y: "1" }, { zone: "1429", x: "-1", y: "1" },
      { zone: "1429", x: "1", y: "NaN" }, { zone: "1.5", x: "1", y: "1" }, { zone: "0", x: "1", y: "1" }, { zone: "1429", x: "1e2", y: "1" },
    ]) expect(parseDeepLink(q), JSON.stringify(q)).toBeNull();
  });

  test("a repeated parameter uses the first", () => {
    expect(parseDeepLink({ zone: ["1429", "1"], x: ["5", "6"], y: "7" })).toEqual({ mapId: 1429, x: 5, y: 7 });
  });

  test("a zone with no spot is a zone link: the zone is fitted to the view", () => {
    expect(parseZoneLink({ zone: "1429" })).toBe(1429);
    expect(zoneHref(1429)).toBe("/map?zone=1429");
    expect(zoneHref(1429, true)).toBe("/map?zone=1429&spoilers=1");
    // Only the whole-number zone id is read; a spot makes it a pin link instead.
    expect(parseZoneLink({ zone: "1429", x: "10", y: "20" })).toBeNull();
    for (const q of [{}, { zone: "abc" }, { zone: "0" }, { zone: "1.5" }, { zone: "-3" }]) expect(parseZoneLink(q), JSON.stringify(q)).toBeNull();
    // A half spot is not a pin, so the zone still opens.
    expect(parseZoneLink({ zone: "1429", x: "10" })).toBe(1429);
  });

  test("the view in the address: centre, zoom and selected item, read back the same", () => {
    const search = viewSearch(new URLSearchParams("continent=0&zone=1429&pin=old"), { x: 1234.6, y: -88.2, zoom: -2.337, pin: "e5" });
    const q = new URLSearchParams(search);
    expect(q.get("continent")).toBe("0");
    expect(q.get("zone")).toBe("1429");
    expect(parseViewState({ at: q.get("at")!, z: q.get("z")!, pin: q.get("pin")! })).toEqual({ at: [1235, -88], zoom: -2.34, pin: "e5" });
    expect(new URLSearchParams(viewSearch(new URLSearchParams(), { x: 0, y: 0, zoom: 1, pin: null })).has("pin")).toBe(false);
  });

  test("an entrance's id, which carries its world position, is a valid pin", () => {
    expect(parseViewState({ pin: "e-4459.4--1660.2" }).pin).toBe("e-4459.4--1660.2");
  });

  test("a malformed view is left out, so a bad link opens the plain map", () => {
    expect(parseViewState({ at: "abc,1", z: "99", pin: "<script>" })).toEqual({ at: null, zoom: null, pin: null });
    expect(parseViewState({})).toEqual({ at: null, zoom: null, pin: null });
  });
});

describe("the sidebar in the address: show, q, view", () => {
  const read = (search: string) => {
    const q = new URLSearchParams(search);
    return parseMapUrl({ show: q.get("show") ?? undefined, q: q.get("q") ?? undefined, view: q.get("view") ?? undefined, side: q.get("side") ?? undefined });
  };
  const only = (...ids: (keyof CategoryState)[]) => Object.fromEntries(CATEGORY_IDS.map((id) => [id, ids.includes(id)])) as CategoryState;

  test("the default state leaves no trace, and an address without any reads as the default", () => {
    expect(mapUrlSearch(new URLSearchParams("zone=1411"), DEFAULT_URL_STATE).toString()).toBe("zone=1411");
    expect(parseMapUrl({})).toEqual(DEFAULT_URL_STATE);
  });

  test("every state round-trips through the address", () => {
    const states: MapUrlState[] = [
      { show: only("flight", "dungeon", "herb"), q: "", tab: "categories" },
      { show: allCategories(false), q: "", tab: "categories" },
      { show: DEFAULT_CATEGORIES, q: "gadget", tab: "categories" },
      { show: DEFAULT_CATEGORIES, q: "", tab: "list" },
      { show: only("zone"), q: "ragefire chasm", tab: "list" },
      { show: { ...DEFAULT_CATEGORIES, path: false }, q: "", tab: "categories" },
      { show: DEFAULT_CATEGORIES, q: "", tab: "categories", side: "alliance" },
      { show: only("flight"), q: "", tab: "list", side: "horde" },
    ];
    for (const s of states) expect(read(mapUrlSearch(new URLSearchParams("zone=1411&spoilers=1"), s).toString()), JSON.stringify(s)).toEqual(s);
  });

  test("side is written only for one side; both, or an unknown value, leaves no trace", () => {
    expect(mapUrlSearch(new URLSearchParams("side=horde"), { ...DEFAULT_URL_STATE, side: "both" }).toString()).toBe("");
    expect(read("side=goblin")).toEqual(DEFAULT_URL_STATE);
  });

  test("show is written in the sidebar's order, as none when nothing is on, and not at all when everything is", () => {
    expect(showParam(only("herb", "flight", "dungeon"))).toBe("flight,dungeon,herb");
    expect(showParam(allCategories(false))).toBe("none");
    expect(showParam(DEFAULT_CATEGORIES)).toBeNull();
    expect(mapUrlSearch(new URLSearchParams(), { show: only("flight", "dungeon"), q: "", tab: "list" }).toString()).toBe("show=flight%2Cdungeon&view=list");
  });

  test("the rest of the address stays: zone, spot, camera, pin, spoilers, and the old continent", () => {
    const base = new URLSearchParams("continent=1&zone=1411&x=52.1&y=43&at=-512,1830&z=1.5&pin=f12&spoilers=1&show=zone&q=old&view=list");
    const out = mapUrlSearch(base, DEFAULT_URL_STATE);
    for (const k of ["continent", "zone", "x", "y", "at", "z", "pin", "spoilers"]) expect(out.get(k), k).toBe(base.get(k));
    for (const k of ["show", "q", "view"]) expect(out.has(k), k).toBe(false);
    // With the camera added on top, both read back.
    const search = viewSearch(mapUrlSearch(base, { show: only("raid"), q: "hogger", tab: "categories" }), { x: 1, y: 2, zoom: 1, pin: "e5" });
    expect(read(search)).toEqual({ show: only("raid"), q: "hogger", tab: "categories" });
    expect(parseViewState({ at: new URLSearchParams(search).get("at")!, z: "1", pin: new URLSearchParams(search).get("pin")! })).toEqual({ at: [1, 2], zoom: 1, pin: "e5" });
  });

  test("anything unknown is dropped, so a bad link opens the plain sidebar", () => {
    expect(parseMapUrl({ show: "bogus,<x>" }).show).toEqual(DEFAULT_CATEGORIES);
    expect(parseMapUrl({ show: "herb,bogus" }).show).toEqual(only("herb"));
    expect(parseMapUrl({ view: "grid" }).tab).toBe("categories");
    expect(parseMapUrl({ q: "  hogger  " }).q).toBe("hogger");
    expect(parseMapUrl({ q: "x".repeat(200) }).q).toHaveLength(80);
    expect(parseMapUrl({ show: ["flight", "zone"] }).show).toEqual(only("flight"));
  });

  test("moving to a zone is a new address with that zone; the old spot, camera and pin go, the rest stays", () => {
    const base = new URLSearchParams("zone=1411&x=50&y=50&at=1,2&z=1&pin=f1&spoilers=1&show=zone");
    expect(zoneSearch(base, 1429)).toBe("spoilers=1&show=zone&zone=1429");
    expect(zoneSearch(base, null)).toBe("spoilers=1&show=zone");
    expect(parseZoneLink(Object.fromEntries(new URLSearchParams(zoneSearch(base, 1429))))).toBe(1429);
  });
});

describe("continent pages and the card's links", () => {
  test("each continent has its own page, and the slug reads back", () => {
    expect(continentPath(0)).toBe("/map/eastern-kingdoms");
    expect(continentPath(1)).toBe("/map/kalimdor");
    expect(continentPath(7)).toBe("/map");
    expect(continentFromSlug("eastern-kingdoms")).toBe(0);
    expect(continentFromSlug("kalimdor")).toBe(1);
    expect(continentFromSlug("outland")).toBeNull();
  });

  test("Copy link gives the continent page with the pin, which opens on it", () => {
    expect(pinHref(1, "f12")).toBe("/map/kalimdor?pin=f12");
    expect(pinHref(0, "npc-7-1429", true)).toBe("/map/eastern-kingdoms?pin=npc-7-1429&spoilers=1");
    const pin = new URLSearchParams(pinHref(0, "e-4459.4--1660.2").split("?")[1]).get("pin")!;
    expect(parseViewState({ pin }).pin).toBe("e-4459.4--1660.2");
  });

  test("Open page goes where the kind has a page: NPC, vendor, the zone holding an entrance or a spot; a flight master has none", () => {
    const pages = { 1: "/database/zones/1-open", 3: "/database/zones/3-open-city" };
    expect(openPageLink({ kind: "npc", npcId: 7, x: 0, y: 0 }, items.zones, pages)).toEqual({ href: "/database/npcs/7", label: "Open NPC page" });
    expect(openPageLink({ kind: "vendor", npcId: 8, x: 0, y: 0 }, items.zones, pages)).toEqual({ href: "/database/vendors/8", label: "Open vendor page" });
    expect(openPageLink({ kind: "entrance", x: 150, y: 150 }, items.zones, pages)).toEqual({ href: "/database/zones/3-open-city", label: "Open zone page" });
    expect(openPageLink({ kind: "spot", x: 500, y: 300 }, items.zones, pages)).toEqual({ href: "/database/zones/1-open", label: "Open zone page" });
    expect(openPageLink({ kind: "flight", x: 1, y: 1 }, items.zones, pages)).toBeNull();
    // A held-back zone has no page, and outside every zone there is nothing to open.
    expect(openPageLink({ kind: "entrance", x: 2050, y: 50 }, items.zones, pages)).toBeNull();
    expect(openPageLink({ kind: "spot", x: 9000, y: 9000 }, items.zones, pages)).toBeNull();
  });

  test("a pins answer is read only when it has every list", () => {
    const body = { ok: true, entrances: [], flightMasters: [], flightLines: [], pins: [], extra: 1 };
    // An answer cached before treasures were drawn reads as having none.
    expect(readPinSet(body)).toEqual({ entrances: [], flightMasters: [], flightLines: [], pins: [], treasures: [] });
    expect(readPinSet({ ...body, pins: null })).toBeNull();
    expect(readPinSet(null)).toBeNull();
    expect(readPinSet("nope")).toBeNull();
  });
});

describe("labels", () => {
  test("label size is 11 to 14 pixels at every zoom", () => {
    expect(labelFontPx(1)).toBe(11);
    expect(labelFontPx(40)).toBeLessThanOrEqual(14);
    expect(labelFontPx(8)).toBeGreaterThan(labelFontPx(2));
    expect(labelFontPx(0)).toBe(11);
  });

  const view = { x: 0, y: 0, width: 1000, height: 500 };
  const at = (id: string, x: number, y: number, priority: number, text = "Tirisfal Glades") => ({ id, text, x, y, priority, align: "middle" as const });

  test("labels that collide give way to the higher priority; far apart ones all show", () => {
    const placed = placeLabels([at("low", 500, 250, 1), at("high", 510, 252, 9)], view, 1000, 11);
    expect(placed.map((l) => l.id)).toEqual(["high"]);
    expect(placeLabels([at("a", 200, 100, 1), at("b", 800, 400, 1)], view, 1000, 11)).toHaveLength(2);
  });

  test("a label that would be clipped by the edge is hidden, one that is only close is kept", () => {
    expect(placeLabels([at("edge", 5, 250, 1)], view, 1000, 11)).toEqual([]);
    expect(placeLabels([at("edge", 500, 2, 1)], view, 1000, 11)).toEqual([]);
    expect(placeLabels([at("ok", 500, 250, 1)], view, 1000, 11)).toHaveLength(1);
  });

  test("the same input always places the same labels, whatever the order it arrives in", () => {
    const a = [at("a", 500, 250, 5), at("b", 505, 250, 5, "Silverpine Forest"), at("c", 100, 100, 1)];
    expect(placeLabels(a, view, 1000, 11).map((l) => l.id)).toEqual(placeLabels([...a].reverse(), view, 1000, 11).map((l) => l.id));
  });
});
