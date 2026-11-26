import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { entityMapZones, type MapMark, type ZoneArt } from "./entity-map";
import EntityMap from "./EntityMap";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const art = (uiMapId: number, heldBack = false): ZoneArt => ({ uiMapId, kind: "zone", heldBack, url: `https://a.test/maps/${uiMapId}.webp` });
const mark = (mapId: number, x: number, y: number, over: Partial<MapMark> = {}): MapMark => ({ kind: "npc", mapId, x, y, label: "Guard", agreed: true, ...over });

// Elwynn Forest (1429) and Westfall (1436) are released zones; Mount Hyjal (2482) is held back; 999999 is no zone.
test("positions are grouped by zone, the zone with the most first, each on its own map art", () => {
  const zones = entityMapZones([mark(1429, 40, 60), mark(1436, 10, 20), mark(1436, 30, 30)], [art(1429), art(1436)]);
  expect(zones.map((z) => [z.mapId, z.name, z.marks.length])).toEqual([[1436, "Westfall", 2], [1429, "Elwynn Forest", 1]]);
  expect(zones[0]!.art).toBe("https://a.test/maps/1436.webp");
});

test("no map art, a held-back zone or a map the world map does not draw: no map for that zone, never a broken image", () => {
  expect(entityMapZones([mark(1429, 40, 60)], null)).toEqual([]);
  expect(entityMapZones([mark(1429, 40, 60)], [art(1436)])).toEqual([]);
  expect(entityMapZones([mark(2482, 40, 60)], [art(2482, true)])).toEqual([]);
  expect(entityMapZones([mark(999999, 40, 60)], [art(999999)])).toEqual([]);
  // A position outside the zone's 0 to 100 is left off the picture.
  expect(entityMapZones([mark(1429, 140, 60)], [art(1429)])).toEqual([]);
});

test("the world map link opens the one position as a spot, or the zone when there are several", () => {
  expect(entityMapZones([mark(1429, 40, 60)], [art(1429)])[0]!.href).toBe("/map?zone=1429&x=40&y=60");
  expect(entityMapZones([mark(1429, 40, 60), mark(1429, 41, 61)], [art(1429)])[0]!.href).toBe("/map?zone=1429");
});

test("the map draws each position on the zone's art, lazily, with a legend of the kinds it shows", () => {
  const zones = entityMapZones([mark(1429, 40, 60), mark(1429, 20, 30, { kind: "place", label: "Goldshire", agreed: false })], [art(1429)]);
  const out = renderToStaticMarkup(<EntityMap name="Guard Thomas" zones={zones} />);
  expect(out).toContain('data-entity-map');
  expect(out).toMatch(/<img[^>]*src="https:\/\/a.test\/maps\/1429.webp"[^>]*loading="lazy"/);
  expect(out).toContain("left:40%;top:60%");
  expect(out).toContain('data-mark="npc"');
  expect(out).toContain('data-mark="place"');
  // Agreed positions are filled; the game files' are hollow, and the legend says which is which.
  expect(out).toMatch(/data-mark="npc" data-agreed="true"/);
  expect(out).toMatch(/data-mark="place" data-agreed="false"/);
  const legend = out.split("data-map-legend")[1] ?? "";
  expect(legend).toContain("NPC");
  expect(legend).toContain("Place");
  expect(legend).toContain("Hollow: from the game files, unconfirmed");
  expect(legend).not.toContain("Vendor");
  expect(out).toContain('href="/map?zone=1429"');
  expect(out).toContain("Open on the world map");
  // One zone: no switcher.
  expect(out).not.toContain("data-zone-switcher");
});

test("positions in several zones get a zone switcher, the first zone shown", () => {
  const zones = entityMapZones([mark(1429, 40, 60), mark(1436, 10, 20)], [art(1429), art(1436)]);
  const out = renderToStaticMarkup(<EntityMap name="Guard Thomas" zones={zones} />);
  const switcher = out.split("data-zone-switcher")[1]?.split("</div>")[0] ?? "";
  expect(switcher).toContain("Elwynn Forest");
  expect(switcher).toContain("Westfall");
  expect(switcher).toMatch(/aria-pressed="true"[^>]*>Elwynn Forest/);
  expect(out.match(/<img/g)).toHaveLength(1);
});

test("no zone to draw: nothing at all", () => {
  expect(renderToStaticMarkup(<EntityMap name="Guard Thomas" zones={[]} />)).toBe("");
});
