import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { buildLoreRelease } from "@/test/lore-release";

// The database pages and the lore pages link each other under one rule (lib/lore-links.ts). The archive is the
// fixture release with its link pages; the corpus, the names file and the game files' lists are set per test.
const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), loadCompletion: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadCompletion: store.loadCompletion },
}));
const wikiItems = vi.hoisted(() => ({ names: null as unknown }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadItemNames: async () => wikiItems.names,
}));
vi.mock("@/data/game-data/client-factions", () => ({ CLIENT_FACTIONS: { factions: [{ id: 529, name: "Argent Dawn", shown: true }] } }));
vi.mock("@/data/game-data/client-titles", () => ({ CLIENT_TITLES: { titles: [{ id: 200, name: "Jenkins" }] } }));
// Storage is down for the instance sightings: the page is built from the game files alone.
vi.mock("@/lib/instances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/instances")>()),
  loadSightings: async () => ({ unreachable: true }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));

const installs = ["install-a", "install-b", "install-c"];
const at = "2026-10-09T00:00:00.000Z";
let n = 0;
/** Three installs looting an object that each name the same way. */
const object = (id: number, name: string) => installs.map((installId) => ({
  kind: "loot", sourceEvidence: "loot-api", installId, eventId: `e:${n++}`, capturedAt: at, sourceObjectId: id, sourceObjectName: name, items: [{ itemId: 2770, count: 1 }],
}));
const npc = (id: number, name: string) => installs.map((installId) => ({ kind: "npc_sighting", installId, npcId: id, name, mapId: 1, x: 50, y: 50, positionKind: "npc" }));
const vendor = (id: number) => installs.map((installId) => ({ kind: "vendor", installId, vendorNpcId: id, items: [{ itemId: 117, priceCopper: 25 }] }));
const corpus = (...records: unknown[][]) => ({ uploads: 3, records: records.flat(), dataAsOf: at });

let release = "";
beforeAll(async () => { release = await buildLoreRelease({ links: true }); });
beforeEach(() => {
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  store.loadCorpus.mockReset().mockResolvedValue(corpus([]));
  store.loadCompletion.mockReset().mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  wikiItems.names = null;
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

// The pages take different route params (id, instance, slug); one loose helper builds them all.
const props = (key: string, value: string) => ({ params: Promise.resolve({ [key]: value }) }) as never;
const PAGES = {
  "objects/[id]": () => import("./objects/[id]/page"),
  "vendors/[id]": () => import("./vendors/[id]/page"),
  "npcs/[id]": () => import("./npcs/[id]/page"),
  "instances/[instance]": () => import("./instances/[instance]/page"),
  "factions/[id]": () => import("./factions/[id]/page"),
  "titles/[id]": () => import("./titles/[id]/page"),
  "achievements/[id]": () => import("./achievements/[id]/page"),
  "items/[id]": () => import("./items/[id]/page"),
};
async function database(path: keyof typeof PAGES, key: string, value: string) {
  const { default: Page } = await PAGES[path]();
  return renderToStaticMarkup(await Page(props(key, value)));
}
async function lore(slug: string) {
  const { default: Page } = await import("../lore/[slug]/page");
  return renderToStaticMarkup(await Page(props("slug", slug)));
}
const READ = (name: string) => `Read ${name} in the lore archive`;

test("an object players named links its lore page, and the lore page links back", async () => {
  store.loadCorpus.mockResolvedValue(corpus(object(1731, "Copper Vein")));
  const page = await database("objects/[id]", "id", "1731");
  expect(page).toContain('id="lore"');
  expect(page).toContain('href="/lore/300-copper-vein"');
  expect(page).toContain(READ("Copper Vein"));
  const back = await lore("300-copper-vein");
  expect(back).toContain("In the Forever database");
  expect(back).toContain('href="/database/objects/1731"');
  expect(back).toContain("See the object page");
});

test("an object whose name the archive lacks, or that two archive pages share, links nothing, and neither lore page links it", async () => {
  store.loadCorpus.mockResolvedValue(corpus(object(1731, "Tin Vein"), object(1732, "Twin Vein")));
  for (const id of ["1731", "1732"]) expect(await database("objects/[id]", "id", id), id).not.toContain('id="lore"');
  // The archive has Twin Vein twice: neither copy says which it is, so no copy links the object.
  expect(await lore("305-twin-vein")).not.toContain("In the Forever database");
  expect(await lore("306-twin-vein")).not.toContain("In the Forever database");
});

test("a name two objects share links nothing from either object, and the lore page links neither", async () => {
  store.loadCorpus.mockResolvedValue(corpus(object(1731, "Copper Vein"), object(1742, "Copper Vein")));
  expect(await database("objects/[id]", "id", "1731")).not.toContain('id="lore"');
  expect(await database("objects/[id]", "id", "1742")).not.toContain('id="lore"');
  expect(await lore("300-copper-vein")).not.toContain("In the Forever database");
});

test("a name two kinds could claim under one archive type links nothing: an object and a faction both called Argent Dawn", async () => {
  store.loadCorpus.mockResolvedValue(corpus(object(1750, "Argent Dawn")));
  expect(await lore("301-argent-dawn")).not.toContain("In the Forever database");
  expect(await database("objects/[id]", "id", "1750")).not.toContain('id="lore"');
  expect(await database("factions/[id]", "id", "529-argent-dawn")).not.toContain('id="lore"');
});

test("a vendor's lore page is its NPC's, under the same rule", async () => {
  store.loadCorpus.mockResolvedValue(corpus(npc(77, "Thrall"), vendor(77), npc(90, "Hogger"), vendor(90), npc(91, "Hogger")));
  const page = await database("vendors/[id]", "id", "77");
  expect(page).toContain('href="/lore/1-thrall"');
  expect(page).toContain(READ("Thrall"));
  // Two NPCs called Hogger: no vendor page and no NPC page links the lore page, and it links neither.
  expect(await database("vendors/[id]", "id", "90")).not.toContain('id="lore"');
  expect(await database("npcs/[id]", "id", "90")).not.toContain('id="lore"');
  expect(await lore("310-hogger")).not.toContain("In the Forever database");
});

test("an instance links its lore page by the game files' name, and the lore page links back", async () => {
  const page = await database("instances/[instance]", "instance", "36-deadmines");
  expect(page).toContain('href="/lore/302-deadmines"');
  expect(page).toContain(READ("Deadmines"));
  const back = await lore("302-deadmines");
  expect(back).toContain('href="/database/instances/36-deadmines"');
  expect(back).toContain("See the instance page");
  // An instance the archive has no page for shows no lore.
  expect(await database("instances/[instance]", "instance", "43-wailing-caverns")).not.toContain('id="lore"');
});

test("a zone's lore page links back to the zone page", async () => {
  const back = await lore("303-westfall");
  expect(back).toContain("In the Forever database");
  expect(back).toContain('href="/database/zones/1436-westfall"');
  expect(back).toContain("See the zone page");
  // A zone-typed page named for no zone has no link.
  expect(await lore("100-zone-1")).not.toContain("In the Forever database");
});

test("a faction links its lore page, and the lore page links back", async () => {
  const page = await database("factions/[id]", "id", "529-argent-dawn");
  expect(page).toContain('href="/lore/301-argent-dawn"');
  expect(page).toContain(READ("Argent Dawn"));
  const back = await lore("301-argent-dawn");
  expect(back).toContain('href="/database/factions/529-argent-dawn"');
  expect(back).toContain("See the faction page");
});

test("a title links its lore page, and the lore page links back", async () => {
  const page = await database("titles/[id]", "id", "200-jenkins");
  expect(page).toContain('href="/lore/308-jenkins"');
  expect(page).toContain(READ("Jenkins"));
  const back = await lore("308-jenkins");
  expect(back).toContain('href="/database/titles/200-jenkins"');
  expect(back).toContain("See the title page");
});

test("an achievement links its lore page, and the lore page links back", async () => {
  const page = await database("achievements/[id]", "id", "802-explore-westfall");
  expect(page).toContain('href="/lore/307-explore-westfall"');
  expect(page).toContain(READ("Explore Westfall"));
  const back = await lore("307-explore-westfall");
  expect(back).toContain('href="/database/achievements/802-explore-westfall"');
  expect(back).toContain("See the achievement page");
  // The lore archive has no page for the next one.
  expect(await database("achievements/[id]", "id", "801-resurrected-by-soulstones")).not.toContain('id="lore"');
});

test("an item shown by its Warcraft Wiki name links its lore page; the lore page waits for players to agree on the name", async () => {
  const entry = (name: string) => ({ name, color: "#ffffff", wikiPage: `https://warcraft.wiki.gg/wiki/${name.replace(/ /g, "_")}`, source: "wiki" });
  wikiItems.names = {
    version: "1.60.1.70450", wiki: { name: "Warcraft Wiki", url: "https://warcraft.wiki.gg" },
    names: new Map([[25, entry("Worn Shortsword")], [2770, entry("Copper Ore")]]),
  };
  const page = await database("items/[id]", "id", "25");
  expect(page).toContain('id="lore"');
  expect(page).toContain('href="/lore/304-worn-shortsword"');
  expect(page).toContain(READ("Worn Shortsword"));
  // No archive page of that name under the item type (Copper Ore is only in the real archive).
  expect(await database("items/[id]", "id", "2770")).not.toContain('id="lore"');
  expect(await lore("304-worn-shortsword")).not.toContain("In the Forever database");
  // Once three installs name item 25 the same, both directions link.
  store.loadCorpus.mockResolvedValue(corpus(installs.map((installId) => ({ kind: "item_seen", installId, itemId: 25, name: "Worn Shortsword" }))));
  expect(await database("items/[id]", "id", "25")).toContain('href="/lore/304-worn-shortsword"');
  const back = await lore("304-worn-shortsword");
  expect(back).toContain('href="/database/items/25"');
  expect(back).toContain("Players have recorded Worn Shortsword in WoW: Forever.");
});
