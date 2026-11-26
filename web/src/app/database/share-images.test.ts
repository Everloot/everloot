import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { CLIENT_LABEL } from "@kb/edges";

// The social card of every database type that had none: the type, the name the page shows, one to three facts the page
// states, text only (docs/ASSETS.md keeps game art to the item card), and the page's own 404. The words on a PNG cannot
// be read back, so the test reads them off the renderer's arguments, as social-cards.test.ts does for items, NPCs and quests.
const state = vi.hoisted(() => ({
  spells: null as unknown,
  sets: null as unknown,
  world: { npcs: [] as unknown[], quests: [] as unknown[], vendors: [] as unknown[], unreachable: true },
  objects: { rates: [] as unknown[], measuredZeros: [] as unknown[], names: [] as unknown[], unreachable: true, dataAsOf: null },
  rendered: vi.fn(),
}));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: async () => ({ unreachable: false, records: [], dataAsOf: null }), loadCompletion: async () => ({ state: null, dataAsOf: null }) },
}));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => null,
  loadSpellNames: async () => state.spells,
  loadItemSetNames: async () => state.sets,
  loadQuestNames: async () => null,
}));
vi.mock("@/lib/edges", () => ({ loadEdges: async () => ({ observed: [], client: [], unreachable: false }) }));
vi.mock("@/lib/talents/spell-talents", () => ({ loadSpellTalents: async () => new Map() }));
vi.mock("@/lib/wiki-entity-names", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/wiki-entity-names")>()), loadWikiEntityNames: async () => null }));
vi.mock("@/lib/objects", () => ({ loadObjectFacts: async () => state.objects }));
vi.mock("@/lib/rollup-compute", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/rollup-compute")>()), loadWorldFacts: async () => state.world }));
vi.mock("@/lib/instances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/instances")>()),
  loadSightings: async () => ({ unreachable: true, sightings: [], asOf: undefined }),
}));
vi.mock("@/lib/og-card", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/og-card")>();
  return { ...real, renderEntityCard: state.rendered.mockImplementation(real.renderEntityCard) };
});
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));

import { CLIENT_ACHIEVEMENTS } from "@/data/game-data/client-achievements";
import { CLIENT_FACTIONS } from "@/data/game-data/client-factions";
import { CLIENT_QUEST_LINES } from "@/data/game-data/client-quest-lines";
import { CLIENT_TITLES } from "@/data/game-data/client-titles";
import { currencyEntries, currencyHref, mountEntries, mountHref, petEntries, petHref } from "@/lib/collectibles";
import { achievementHref, chainHref, factionHref, titleDisplayName, titleHref } from "@/lib/completion-lists";
import { instanceHref, instanceRows } from "@/lib/instances";
import { itemSet, itemSetHref } from "@/lib/item-sets";
import { holidayEntries, holidayHref, petFamilyEntries, petFamilyHref } from "@/lib/world-events";
import { zoneByMapId, zoneHref } from "@/lib/zones";

import AchievementImage, * as achievementRoute from "./achievements/[id]/opengraph-image";
import CurrencyImage, * as currencyRoute from "./currencies/[id]/opengraph-image";
import FactionImage, * as factionRoute from "./factions/[id]/opengraph-image";
import HolidayImage, * as holidayRoute from "./holidays/[id]/opengraph-image";
import InstanceImage, * as instanceRoute from "./instances/[instance]/opengraph-image";
import ItemSetImage, * as itemSetRoute from "./item-sets/[id]/opengraph-image";
import MountImage, * as mountRoute from "./mounts/[id]/opengraph-image";
import ObjectImage, * as objectRoute from "./objects/[id]/opengraph-image";
import PetFamilyImage, * as petFamilyRoute from "./pet-families/[id]/opengraph-image";
import PetImage, * as petRoute from "./pets/[id]/opengraph-image";
import ChainImage, * as chainRoute from "./quest-chains/[id]/opengraph-image";
import SpellImage, * as spellRoute from "./spells/[id]/opengraph-image";
import TitleImage, * as titleRoute from "./titles/[id]/opengraph-image";
import VendorImage, * as vendorRoute from "./vendors/[id]/opengraph-image";
import ZoneImage, * as zoneRoute from "./zones/[zone]/opengraph-image";

import { generateMetadata as achievementMeta } from "./achievements/[id]/page";
import { generateMetadata as currencyMeta } from "./currencies/[id]/page";
import { generateMetadata as factionMeta } from "./factions/[id]/page";
import { generateMetadata as holidayMeta } from "./holidays/[id]/page";
import { generateMetadata as instanceMeta } from "./instances/[instance]/page";
import { generateMetadata as itemSetMeta } from "./item-sets/[id]/page";
import { generateMetadata as mountMeta } from "./mounts/[id]/page";
import { generateMetadata as objectMeta } from "./objects/[id]/page";
import { generateMetadata as petFamilyMeta } from "./pet-families/[id]/page";
import { generateMetadata as petMeta } from "./pets/[id]/page";
import { generateMetadata as chainMeta } from "./quest-chains/[id]/page";
import { generateMetadata as spellMeta } from "./spells/[id]/page";
import { generateMetadata as titleMeta } from "./titles/[id]/page";
import { generateMetadata as vendorMeta } from "./vendors/[id]/page";
import { generateMetadata as zoneMeta } from "./zones/[zone]/page";

const props = (id: string) => ({ params: Promise.resolve({ id }) });
const lastCard = () => state.rendered.mock.lastCall?.[0];
const image = (m: Metadata) => (m.openGraph as { images: { url: string }[] } | undefined)?.images[0].url;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// One record of each type from the committed game files.
const mount = mountEntries()!.find((m) => m.id === 6)!;
const pet = petEntries()![0]!;
const currency = currencyEntries()!.find((c) => c.max) ?? currencyEntries()![0]!;
const holiday = holidayEntries()!.find((h) => h.id === 141)!;
const family = petFamilyEntries()!.find((f) => f.id === 1)!;
const set = itemSet(1)!;
const [achievementId, achievement] = Object.entries(CLIENT_ACHIEVEMENTS.achievements).find(([, a]) => a.points)!;
const faction = CLIENT_FACTIONS.factions.find((f) => f.parentId !== undefined)!;
const factionParent = CLIENT_FACTIONS.factions.find((f) => f.id === faction.parentId)!;
const title = CLIENT_TITLES.titles[0]!;
const chain = CLIENT_QUEST_LINES.questLines[0]!;
const zone = zoneByMapId(1429)!;
const instance = [...instanceRows({}).values()].find((r) => r.name && r.level && r.encounters.length)!;

beforeEach(() => {
  state.spells = { version: "1.60.1.71091", names: new Map([[17253, "Bite"]]) };
  state.sets = { version: "1.60.1.71091", names: new Map([[1, "Dal'Rend's Arms"]]) };
  Object.assign(state.world, { npcs: [], quests: [], vendors: [], unreachable: true });
  state.objects.unreachable = true;
  state.rendered.mockClear();
});

describe("the share card of each database type", () => {
  it.each([
    ["mount", () => MountImage(props(mountHref(mount.id, mount.name).split("/").pop()!)),
      { title: mount.name, type: "Mount", facts: [mount.ridingSkill ? `Riding skill ${mount.ridingSkill}` : null, CLIENT_LABEL].filter(Boolean) }],
    ["companion pet", () => PetImage(props(String(pet.id))), { title: pet.name, type: "Companion pet", facts: [CLIENT_LABEL] }],
    ["currency", () => CurrencyImage(props(String(currency.id))),
      { title: currency.name, type: "Currency", facts: [currency.category, currency.max ? `Cap ${currency.max.toLocaleString("en-US")}` : null, CLIENT_LABEL].filter(Boolean) }],
    ["holiday", () => HolidayImage(props("141-feast-of-winter-veil")), { title: "Feast of Winter Veil", type: "Holiday", facts: ["Lasts 18 days", CLIENT_LABEL] }],
    ["hunter pet family", () => PetFamilyImage(props(String(family.id))), { title: family.name, type: "Hunter pet family", facts: [plural(family.spellIds.length, "spell"), CLIENT_LABEL] }],
    ["item set", () => ItemSetImage(props("1")),
      { title: "Dal'Rend's Arms", type: "Item set", facts: [plural(set.items.length, "piece"), plural(set.bonuses.length, "set bonus", "set bonuses"), CLIENT_LABEL] }],
    ["achievement", () => AchievementImage(props(achievementId)), { title: achievement.title, type: "Achievement", facts: [`${achievement.points} points`, CLIENT_LABEL] }],
    ["faction", () => FactionImage(props(String(faction.id))), { title: faction.name, type: "Faction", facts: [`Under ${factionParent.name}`, CLIENT_LABEL] }],
    ["title", () => TitleImage(props(String(title.id))), { title: titleDisplayName(title.name), type: "Title", facts: [CLIENT_LABEL] }],
    ["quest chain", () => ChainImage(props(String(chain.id))), { title: chain.name, type: "Quest chain", facts: [plural(chain.questIds.length, "quest"), CLIENT_LABEL] }],
    ["spell", () => SpellImage(props("17253")), { title: "Bite", type: "Spell", facts: [] }],
    ["zone", () => ZoneImage({ params: Promise.resolve({ zone: "1429-elwynn-forest" }) }), { title: "Elwynn Forest", type: "Zone", facts: [zone.continentName] }],
    ["instance", () => InstanceImage({ params: Promise.resolve({ instance: String(instance.instanceMapId) }) }),
      { title: instance.name, type: instance.raid ? "Raid" : instance.raid === false ? "Dungeon" : "Instance",
        facts: [instance.level!.min === instance.level!.max ? `Level ${instance.level!.min}` : `Level ${instance.level!.min}-${instance.level!.max}`, plural(instance.encounters.length, "boss", "bosses")] }],
    // Storage out of reach: no reported name, so the id, as the page shows it.
    ["object", () => ObjectImage(props("1617")), { title: "Object 1617", type: "Object", facts: [] }],
    ["vendor", () => VendorImage(props("1247")), { title: "Vendor NPC 1247", type: "Vendor", facts: [] }],
  ] as const)("a %s card names it, its type and the facts the page states, with no installs line and no art", async (_, draw, card) => {
    const res = await draw();
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(lastCard()).toEqual({ ...card, installs: null });
  });

  it("a set the names file does not name, and a spell the files do not name, keep the page's own id titles", async () => {
    state.sets = { version: "x", names: new Map() };
    await ItemSetImage(props("1"));
    expect(lastCard()).toMatchObject({ title: "Item set 1" });
  });

  it("an id the page answers with a 404 is a 404 from the card too", async () => {
    state.world.unreachable = false;
    state.objects.unreachable = false;
    const draws = [
      () => MountImage(props("999999")), () => PetImage(props("999999")), () => CurrencyImage(props("999999")), () => HolidayImage(props("999999")),
      () => PetFamilyImage(props("999999")), () => ItemSetImage(props("999999")), () => AchievementImage(props("99999999")), () => FactionImage(props("999999")),
      () => TitleImage(props("999999")), () => ChainImage(props("999999")), () => SpellImage(props("99999999")), () => SpellImage(props("abc")),
      () => ZoneImage({ params: Promise.resolve({ zone: "999999" }) }), () => InstanceImage({ params: Promise.resolve({ instance: "999999" }) }),
      () => ObjectImage(props("1617")), () => VendorImage(props("1247")),
    ];
    for (const draw of draws) await expect(draw()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.rendered).not.toHaveBeenCalled();
  });

  it("each route is the shared card size, a PNG, and names its type in the alt text", () => {
    const routes = [achievementRoute, currencyRoute, factionRoute, holidayRoute, instanceRoute, itemSetRoute, mountRoute, objectRoute, petFamilyRoute, petRoute, chainRoute, spellRoute, titleRoute, vendorRoute, zoneRoute];
    for (const route of routes) {
      expect(route.size).toEqual({ width: 1200, height: 630 });
      expect(route.contentType).toBe("image/png");
      expect(route.alt).toMatch(/^A WoW Forever [a-z ]+ on Everloot$/);
    }
  });

  it("each page's metadata points its share image at the card beside it", async () => {
    state.world.unreachable = true;
    const cases: [Promise<Metadata>, string][] = [
      [mountMeta(props(mountHref(mount.id, mount.name).split("/").pop()!)), mountHref(mount.id, mount.name)],
      [petMeta(props(String(pet.id))), petHref(pet.id, pet.name)],
      [currencyMeta(props(String(currency.id))), currencyHref(currency.id, currency.name)],
      [holidayMeta(props("141")), holidayHref(holiday.id, holiday.name)],
      [petFamilyMeta(props(String(family.id))), petFamilyHref(family.id, family.name)],
      [itemSetMeta(props("1")), itemSetHref(1)],
      [achievementMeta(props(achievementId)), achievementHref(Number(achievementId), achievement.title)],
      [factionMeta(props(String(faction.id))), factionHref(faction.id, faction.name)],
      [titleMeta(props(String(title.id))), titleHref(title.id, title.name)],
      [chainMeta(props(String(chain.id))), chainHref(chain.id, chain.name)],
      [spellMeta(props("17253")), "/database/spells/17253"],
      [zoneMeta({ params: Promise.resolve({ zone: "1429-elwynn-forest" }) }), zoneHref(zone.mapId, zone.name)],
      [instanceMeta({ params: Promise.resolve({ instance: String(instance.instanceMapId) }) }), instanceHref(instance.instanceMapId, instance.name)],
      [objectMeta(props("1617")), "/database/objects/1617"],
      [vendorMeta(props("1247")), "/database/vendors/1247"],
    ];
    for (const [meta, path] of cases) expect(image(await meta), path).toBe(`${path}/opengraph-image`);
  });
});

// Every entity page, the ones above and the item, NPC and quest pages, has its own card and the Report wrong data
// link. The class lists under /database/items and the coverage report are lists, not entities.
const ROOT = __dirname;
const NOT_ENTITIES = new Set(["coverage"]);
const entityRoutes = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !NOT_ENTITIES.has(d.name))
  .flatMap((d) => readdirSync(join(ROOT, d.name), { withFileTypes: true }).filter((s) => s.isDirectory() && /^\[\w+\]$/.test(s.name)).map((s) => join(ROOT, d.name, s.name)))
  // A dynamic route with no page (the hover card's /database/card/[type]) is not an entity page.
  .filter((dir) => existsSync(join(dir, "page.tsx")));

test("every database entity route has its own share image", () => {
  expect(entityRoutes.length).toBeGreaterThanOrEqual(18);
  for (const dir of entityRoutes) expect(existsSync(join(dir, "opengraph-image.tsx")), dir).toBe(true);
});

test("every database entity page gives its open-data row a Report wrong data link", () => {
  const sources = entityRoutes.map((dir) => join(dir, "page.tsx"));
  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    // The mount, pet and currency pages draw through the shared collectible page, which passes it on.
    const page = source.includes("<CollectiblePage") ? readFileSync(join(ROOT, "collectible-page.tsx"), "utf8") : source;
    expect(page, file).toMatch(/<OpenData[^>]*\breport=\{/s);
  }
});
