import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CURRENT_BUILD, TABLES } from "@/data/game-data/raid";
import {
  assetUrl, BANNER_MAP, buildFolder, classAndProfessionIcons, continentArt, creditWhat, emblems, FETCH_TIMEOUT_MS, forgetPrivateReads, iconUrl,
  instanceThumbs, itemIconUrl, itemShard, itemTip, gameNameFor, launchArt, loadingArt, loadItemNames, loadItemSetNames, loadItemTips, loadQuestNames, loadSpellNames, loadSiteAssets, parseSiteManifest, poiIcons, privateStoreFromEnv, raidArt,
} from "./game-assets";
import { itemTipText, qualityColor, tipLines, WHY } from "./item-names";
import { cameraBox, zoneArtShown, ZONE_ART_ZOOM, type Box, type Camera } from "./map-view";
import { itemIndex, memoryStore, shard0, siteManifest } from "./game-assets.fixture";

const BASE = "https://assets.example.test/wow_classic_beta-70450-84bea423";
const FOLDER = "wow_classic_beta-70450-84bea423";
const privateFiles = { [`${FOLDER}/items.json`]: itemIndex, [`${FOLDER}/items/0.json`]: shard0 };

beforeEach(() => forgetPrivateReads());
afterEach(() => vi.unstubAllEnvs());

test("URL builders put every file under the build's folder", () => {
  expect(assetUrl(BASE, "maps/13.webp")).toBe(`${BASE}/maps/13.webp`);
  expect(iconUrl(BASE, "6001.webp")).toBe(`${BASE}/icons/6001.webp`);
  expect(itemIconUrl(BASE, 132889)).toBe(`${BASE}/icons/132889.webp`);
  expect(itemShard(511, 512)).toBe(0);
  expect(itemShard(512, 512)).toBe(1);
  expect(buildFolder(BASE)).toBe(FOLDER);
  expect(buildFolder("https://assets.example.test")).toBeNull();
});

test("a full manifest becomes ready URLs: classes, professions with icons, buff spells and maps with their small copies", () => {
  const a = parseSiteManifest(siteManifest, BASE)!;
  expect(a.version).toBe("1.60.1.70450");
  expect(a.classes.get("warrior")).toEqual({ name: "Warrior", icon: `${BASE}/icons/6001.webp`, trees: [
    { name: "Fury", icon: `${BASE}/icons/6003.webp` }, { name: "Arms", icon: `${BASE}/icons/6002.webp` }, { name: "Protection", icon: null },
  ] });
  // A profession without an icon is left out rather than drawn empty.
  expect([...a.professions.keys()]).toEqual(["alchemy", "riding"]);
  expect(a.spellIcons.get(6673)).toBe(`${BASE}/icons/8001.webp`);
  expect(a.maps.find((m) => m.uiMapId === 1429)).toMatchObject({ url: `${BASE}/maps/1429.webp`, smallUrl: `${BASE}/maps/1429-small.webp`, kind: "zone", heldBack: false });
});

test("a manifest from before the site-wide art (talent art only, with its icon list) still reads, with nothing to show", () => {
  const later = ["classes", "professions", "spellIcons", "maps", "spellTips", "loadingScreens", "races", "factions", "poi", "logo"];
  const talentsOnly = { ...Object.fromEntries(Object.entries(siteManifest).filter(([k]) => !later.includes(k))), icons: {} };
  const a = parseSiteManifest(talentsOnly, BASE)!;
  expect(a.classes.size + a.professions.size + a.spellIcons.size + a.maps.length).toBe(0);
  expect(a.spellTips.size + a.loadingScreens.size + a.races.size + a.factions.size).toBe(0);
  expect(a.logo).toBeNull();
  expect(poiIcons(a)).toEqual({});
  expect(launchArt(a)).toBeNull();
  expect(classAndProfessionIcons(a)).toEqual({ classes: [], professions: [] });
});

test.each([
  ["another schema", { ...siteManifest, schema: "everloot.game-assets/2" }],
  ["a map path that climbs out of the folder", { ...siteManifest, maps: { "13": { ...siteManifest.maps["13"], file: "../x.webp" } } }],
  ["an icon that is a URL", { ...siteManifest, spellIcons: { "1": "https://evil.test/x.webp" } }],
  ["a logo path that climbs out of the folder", { ...siteManifest, logo: { ...siteManifest.logo, file: "../logo.webp" } }],
  ["a loading screen that is a URL", { ...siteManifest, loadingScreens: { "0": { ...siteManifest.loadingScreens["0"], file: "https://evil.test/x.webp" } } }],
  ["not an object", "<html>"],
])("%s is refused", (_name, bad) => {
  expect(parseSiteManifest(bad, BASE)).toBeNull();
});

test("unset: nothing is fetched and every reader gives nothing to draw", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "");
  const fetcher = vi.fn();
  const store = memoryStore(privateFiles);
  expect(await loadSiteAssets(undefined, fetcher)).toBeNull();
  expect((await loadItemTips(null, [9, 25], store)).size).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
  expect(store.reads).toEqual([]);
  expect(raidArt(null, TABLES[CURRENT_BUILD])).toBeNull();
  expect(continentArt(null, 0, true)).toBeNull();
  expect(classAndProfessionIcons(null)).toEqual({ classes: [], professions: [] });
  expect(loadingArt(null, 0)).toBeNull();
  expect(instanceThumbs(null, true)).toEqual({});
  expect(launchArt(null)).toBeNull();
  expect(emblems(null)).toEqual({ races: new Map(), factions: new Map() });
});

test("a failing, non-OK, garbled or slow manifest is null and never throws", async () => {
  expect(await loadSiteAssets(BASE, vi.fn().mockRejectedValue(new Error("network")))).toBeNull();
  expect(await loadSiteAssets(BASE, vi.fn().mockResolvedValue(new Response("nope", { status: 404 })))).toBeNull();
  expect(await loadSiteAssets(BASE, vi.fn().mockResolvedValue(new Response("<html>")))).toBeNull();
  const fetcher = vi.fn().mockResolvedValue(Response.json(siteManifest));
  expect((await loadSiteAssets(BASE, fetcher))?.version).toBe("1.60.1.70450");
  expect(fetcher.mock.calls[0][0]).toBe(`${BASE}/manifest.json`);
  // Every read carries a timeout, so a bucket that never answers cannot hold the page.
  const signal = (fetcher.mock.calls[0][1] as RequestInit).signal!;
  expect(signal).toBeInstanceOf(AbortSignal);
  vi.useFakeTimers();
  try {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    const pending = loadSiteAssets(BASE, hang as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1);
    expect(await pending).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("item tooltips come from the private bucket only, read only the shards the page needs, for the same build", async () => {
  const a = parseSiteManifest(siteManifest, BASE)!;
  const store = memoryStore(privateFiles);
  const tips = await loadItemTips(a, [9, 25, 9, 4000, -1], store);
  // 4000 is in shard 7, which the private folder does not have: no read for it.
  expect(store.reads).toEqual([`${FOLDER}/items.json`, `${FOLDER}/items/0.json`]);
  expect(tips.get(9)).toMatchObject({ name: "Linen Cloth", quality: "Common", icon: `${BASE}/icons/132889.webp`, label: "found in game files, unconfirmed · build 1.60.1.70450" });
  expect(tips.get(25)?.icon).toBeNull();
  expect(tips.has(4000)).toBe(false);
  // No private bucket, an index for another build, a broken shard or no ids: plain links, nothing read past that.
  expect((await loadItemTips(a, [9], null)).size).toBe(0);
  expect((await loadItemTips(a, [9], memoryStore({ ...privateFiles, [`${FOLDER}/items.json`]: { ...itemIndex, build: { version: "9.9.9.1" } } }))).size).toBe(0);
  expect((await loadItemTips(a, [9], memoryStore({ ...privateFiles, [`${FOLDER}/items/0.json`]: { "9": { n: 1 } } }))).size).toBe(0);
  const idle = memoryStore(privateFiles);
  expect((await loadItemTips(a, [], idle)).size).toBe(0);
  expect(idle.reads).toEqual([]);
});

test("the private bucket needs all four server-only variables, signs its reads, and keeps what it read", async () => {
  expect(privateStoreFromEnv({})).toBeNull();
  expect(privateStoreFromEnv({ GAME_DATA_S3_ENDPOINT: "https://r2.example.test", GAME_DATA_BUCKET: "private" })).toBeNull();
  const env = { GAME_DATA_S3_ENDPOINT: "https://r2.example.test/", GAME_DATA_BUCKET: "everloot-game-data", GAME_DATA_ACCESS_KEY_ID: "id", GAME_DATA_SECRET_ACCESS_KEY: "secret" };
  const fetcher = vi.fn(async (_input: Request) => Response.json(itemIndex));
  const store = privateStoreFromEnv(env, fetcher as unknown as typeof fetch)!;
  expect(await store.read(`${FOLDER}/items.json`)).toEqual(itemIndex);
  expect(await store.read(`${FOLDER}/items.json`)).toEqual(itemIndex);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const request = fetcher.mock.calls[0][0] as unknown as Request;
  expect(request.url).toBe(`https://r2.example.test/everloot-game-data/${FOLDER}/items.json`);
  expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=id\//);
  const failing = privateStoreFromEnv(env, vi.fn().mockRejectedValue(new Error("down")))!;
  expect(await failing.read(`${FOLDER}/other.json`)).toBeNull();
});

test("an item tooltip reads like the game's and marks the stat amounts the tables do not give", () => {
  const text = itemTipText(shard0["25"]);
  expect(text.lines).toEqual(["Binds when equipped", "Unique", "One-Hand · Sword", "[?] - [?] Damage · Speed 1.90", "([?] damage per second)", "+[?] Stamina", "+[?] Strength", "Requires Level 5", "Item Level 2", '"Old."', "Sell Price: 7c"]);
  expect(text.partial).toBe(true);
  expect(itemTipText(shard0["9"]).partial).toBe(false);
  // A stat kind without a word is left out, not printed as "unknown stat 51".
  const odd = itemTipText({ ...shard0["9"], st: [51] });
  expect(odd.lines.join(" ")).not.toContain("unknown");
  expect(odd.partial).toBe(false);
  expect(qualityColor(3)).toMatch(/^#/);
  expect(itemTip(shard0["9"], { base: BASE, version: "v", label: "l" }).color).toBe(qualityColor(1));
});

test("every placeholder kind comes with its reason in plain words, once", () => {
  expect(itemTipText(shard0["25"]).why).toEqual([WHY.stats, WHY.damage]);
  expect(itemTipText(shard0["9"]).why).toEqual([]);
  expect(itemTipText({ ...shard0["9"], c: 4, sc: 1, s: 20 }).why).toEqual([WHY.armor]);
  expect(tipLines(itemTipText(shard0["25"])).slice(-2)).toEqual([WHY.stats, WHY.damage]);
  for (const line of Object.values(WHY)) expect(line).toMatch(/^\[\?\] .+: .+\.$/);
});

test("the set, the Unique-Equipped category, the restrictions and the effects print where the game prints them", () => {
  const helm = {
    ...shard0["9"], c: 4, sc: 4, s: 1, r: 60, l: 66, u: 1, t: "Shiny.",
    is: { id: 1, n: "Synthetic Battlegear" }, lc: "Unique-Equipped: Synthetic Signet (1)",
    cr: ["Classes: Warrior"], rq: ["Requires Synthetic Guild - Honored"], fx: ["Equip: Synthetic effect.", "Use: Restores [?] health."],
  };
  const text = itemTipText(helm);
  expect(text.lines).toEqual([
    "Unique-Equipped: Synthetic Signet (1)", "Head · Plate", "[?] Armor", "Classes: Warrior", "Requires Level 60", "Requires Synthetic Guild - Honored",
    "Item Level 66", "Equip: Synthetic effect.", "Use: Restores [?] health.", "Set: Synthetic Battlegear", '"Shiny."', "Sell Price: 13c",
  ]);
  expect(text.why).toEqual([WHY.armor, WHY.effect]);
  // A requirement the files do not name is marked and explained; so is a set without a name.
  expect(itemTipText({ ...helm, rq: ["Requires PvP rank [?]"], is: { id: 2, n: null } }).why).toEqual([WHY.armor, WHY.restriction, WHY.effect, WHY.set]);
});

test("a record from an older shard says its restrictions, set and effects are not known, rather than that it has none", () => {
  const older = { ...shard0["9"], cr: undefined, rq: undefined, fx: undefined };
  const text = itemTipText(older);
  expect(text.lines).toEqual(expect.arrayContaining(["Restrictions: [?]", "Set: [?]", "Equip and Use: [?]"]));
  expect(text.why).toEqual([WHY.older]);
  expect(text.partial).toBe(true);
  // An empty list from a newer shard is "none": no placeholder.
  expect(itemTipText(shard0["9"]).lines.join(" ")).not.toContain("[?]");
});

test("a weapon with no stats still marks its damage, and worn armor its armor value, as not in the tables", () => {
  const plain = itemTipText({ ...shard0["25"], st: [], b: 0, u: 0, r: 1, t: undefined });
  expect(plain.lines).toEqual(["One-Hand · Sword", "[?] - [?] Damage · Speed 1.90", "([?] damage per second)", "Item Level 2", "Sell Price: 7c"]);
  expect(plain.partial).toBe(true);
  const chest = { ...shard0["9"], c: 4, sc: 1, s: 20 };
  expect(itemTipText(chest).lines.slice(0, 2)).toEqual(["Chest · Cloth", "[?] Armor"]);
  expect(itemTipText(chest).partial).toBe(true);
  // A shirt, a ring (armor subclass 0) and a libram carry no armor line, and nothing else gets a damage line.
  for (const r of [{ ...chest, s: 4 }, { ...chest, sc: 0, s: 11 }, { ...chest, sc: 7, s: 28 }, { ...shard0["9"], d: 1500 }]) {
    expect(itemTipText(r).lines.join(" ")).not.toMatch(/Armor|Damage|damage per second/);
  }
});

test("the raid builder's icons match the buff table: trees by name, not position, and families by their spells", () => {
  const art = raidArt(parseSiteManifest(siteManifest, BASE), TABLES[CURRENT_BUILD])!;
  expect(art.classes).toEqual({ warrior: `${BASE}/icons/6001.webp` });
  // The table lists Arms, Fury, Protection; the manifest had Fury first.
  expect(art.trees.warrior).toEqual([`${BASE}/icons/6002.webp`, `${BASE}/icons/6003.webp`, null]);
  expect(art.families["battle-shout"]).toBe(`${BASE}/icons/8001.webp`);
  expect(art.families["demoralizing-shout"]).toBeUndefined();
});

test("class and profession icons come in the game's order, only the professions the site names", () => {
  const icons = classAndProfessionIcons(parseSiteManifest(siteManifest, BASE));
  expect(icons.classes.map((c) => c.key)).toEqual(["warrior"]);
  expect(icons.professions.map((p) => p.key)).toEqual(["Alchemy"]);
});

test("map pictures land on the stitched map; held-back zones wait for spoilers, the continent picture does not", () => {
  const a = parseSiteManifest(siteManifest, BASE)!;
  const off = continentArt(a, 0, false)!;
  expect(off.continent?.uiMapId).toBe(13);
  expect(off.zones.map((z) => z.uiMapId).sort()).toEqual([1426, 1429]);
  // World y runs west and x north; the stitched map is x east, y south.
  expect(off.zones.find((z) => z.uiMapId === 1429)).toMatchObject({ x: -1000, y: -500, width: 1000, height: 1000, smallUrl: `${BASE}/maps/1429-small.webp` });
  const on = continentArt(a, 0, true)!;
  expect(on.continent?.uiMapId).toBe(13);
  expect(on.zones.map((z) => z.uiMapId).sort()).toEqual([1426, 1429, 2548]);
  expect(continentArt(a, 1, true)).toBeNull();
});

const frame: Box = { x: -4000, y: -4000, width: 8000, height: 8000 };
const at = (zoom: number, cx: number, cy: number): [Camera, Box] => [{ zoom, cx, cy }, cameraBox(frame, { zoom, cx, cy })];

test("the map legend's icons come by category, only the categories the upload has pieces for", () => {
  const a = parseSiteManifest(siteManifest, BASE)!;
  expect(poiIcons(a)).toEqual({ dungeon: `${BASE}/poi/Dungeon.webp`, flight: `${BASE}/poi/TaxiNode_Neutral.webp` });
  expect(poiIcons(null)).toEqual({});
  // A piece under a name that is not a legend category is ignored.
  expect(poiIcons(parseSiteManifest({ ...siteManifest, poi: { boats: { file: "poi/Boat.webp", width: 32, height: 32 } } }, BASE))).toEqual({});
});

test("with a continent picture, a zone's own picture shows only when zoomed in over it, one zone at a time", () => {
  const art = continentArt(parseSiteManifest(siteManifest, BASE)!, 0, false)!;
  expect(zoneArtShown(art, ...at(1, -500, 0))).toEqual([]);
  expect(zoneArtShown(art, ...at(ZONE_ART_ZOOM - 0.25, -500, 0))).toEqual([]);
  expect(zoneArtShown(art, ...at(ZONE_ART_ZOOM, -500, 0)).map((z) => [z.uiMapId, z.url])).toEqual([[1429, `${BASE}/maps/1429.webp`]]);
  // Between two zones, over neither: nothing, rather than a quilt of both.
  expect(zoneArtShown(art, ...at(ZONE_ART_ZOOM, 2000, -2000))).toEqual([]);
});

test("without one, only the zones in view are drawn, from their small copies until zoomed in", () => {
  const art = { ...continentArt(parseSiteManifest(siteManifest, BASE)!, 0, false)!, continent: null };
  // Zoomed out, both zones are in view: small copies.
  expect(zoneArtShown(art, ...at(1, 0, 0)).map((z) => z.url)).toEqual([`${BASE}/maps/1429-small.webp`, `${BASE}/maps/1426-small.webp`]);
  // Zoomed in over Elwynn: only Elwynn, at full size; Dun Morogh is out of view and not drawn.
  expect(zoneArtShown(art, ...at(ZONE_ART_ZOOM * 2, -500, 0)).map((z) => z.url)).toEqual([`${BASE}/maps/1429.webp`]);
  // An upload without small copies falls back to the full picture.
  const noSmall = { ...art, zones: art.zones.map((z) => ({ ...z, smallUrl: null })) };
  expect(zoneArtShown(noSmall, ...at(1, 0, 0)).map((z) => z.url)).toEqual([`${BASE}/maps/1429.webp`, `${BASE}/maps/1426.webp`]);
});

test("loading screens: banners for original maps, a later map's picture only with spoilers", () => {
  const a = parseSiteManifest(siteManifest, BASE)!;
  expect(loadingArt(a, BANNER_MAP.raid)).toEqual({
    mapId: 409, name: "Molten Core", kind: "raid", heldBack: false, url: `${BASE}/loading/9409.webp`, width: 1600,
    small: { url: `${BASE}/loading/9409-small.webp`, width: 640 },
  });
  expect(loadingArt(a, 2789)).toBeNull();
  expect(loadingArt(a, 2789, true)?.name).toBe("The Tainted Scar");
  expect(loadingArt(a, 9999, true)).toBeNull();
  // Thumbnails for dungeons and raids by name, small copies, never a continent; the held-back raid waits for spoilers.
  expect(instanceThumbs(a, false)).toEqual({
    Deadmines: `${BASE}/loading/9036-small.webp`, "Scarlet Monastery": `${BASE}/loading/9189-small.webp`, "Molten Core": `${BASE}/loading/9409-small.webp`,
    "Onyxia's Lair": `${BASE}/loading/9249-small.webp`,
  });
  expect(loadingArt(a, BANNER_MAP.lore)?.name).toBe("Scarlet Monastery");
  expect(instanceThumbs(a, true)["The Tainted Scar"]).toBe(`${BASE}/loading/9789-small.webp`);
});

test("the launch banner needs the game's own logo: without it there is no banner and nothing in its place", () => {
  const a = parseSiteManifest(siteManifest, BASE)!;
  expect(launchArt(a)).toEqual({
    logo: { url: `${BASE}/logo/logo-wow-forever-2x.webp`, width: 640, height: 640 },
    background: loadingArt(a, BANNER_MAP.home), version: "1.60.1.70450", label: "found in game files, unconfirmed",
  });
  expect(launchArt(parseSiteManifest({ ...siteManifest, logo: null }, BASE))).toBeNull();
  // A logo with no loading screen still makes a banner, on the plain panel.
  const rest = Object.fromEntries(Object.entries(siteManifest.loadingScreens).filter(([id]) => id !== "249"));
  expect(launchArt(parseSiteManifest({ ...siteManifest, loadingScreens: rest }, BASE))?.background).toBeNull();
});

test("race and faction emblems by the names the site writes, one icon per race", () => {
  const { races, factions } = emblems(parseSiteManifest(siteManifest, BASE));
  expect(races).toEqual(new Map([["Human", `${BASE}/emblems/raceicon128-human-female.webp`], ["Night Elf", `${BASE}/emblems/raceicon128-nightelf-male.webp`]]));
  expect(factions).toEqual(new Map([["Alliance", `${BASE}/emblems/AllianceEmblem.webp`], ["Horde", `${BASE}/emblems/HordeEmblem.webp`]]));
});

test("the raid builder's buffs carry their tooltip, with the build label", () => {
  const art = raidArt(parseSiteManifest(siteManifest, BASE), TABLES[CURRENT_BUILD])!;
  expect(art.familyTips["battle-shout"]).toEqual({
    name: "Battle Shout", icon: `${BASE}/icons/8001.webp`, text: "Raises attack power by 20 for 2 min.", partial: false,
    label: "found in game files, unconfirmed · build 1.60.1.70450",
  });
  expect(Object.keys(art.familyTips)).toEqual(["battle-shout"]);
});

test("a credit line names what the page shows", () => {
  expect(creditWhat("icons", false, "loading screen art")).toBe("Icons and loading screen art");
  expect(creditWhat("icons", "tooltip text", "loading screen art")).toBe("Icons, tooltip text and loading screen art");
  expect(creditWhat(null, "loading screen art")).toBe("Loading screen art");
});

const namesFile = {
  schema: "everloot.item-names/1", build: { version: "1.60.1.70450" },
  wiki: { name: "Warcraft Wiki (Internet Archive dump, 2023-11-13)", url: "https://warcraft.wiki.gg", licence: "CC-BY-SA-4.0" },
  count: 2, names: { 2589: { n: "Linen Cloth", q: 1, w: "Linen_Cloth" }, 19019: { n: "Thunderfury, Blessed Blade of the Windseeker", q: 5, w: "Thunderfury,_Blessed_Blade_of_the_Windseeker" } },
};

test("the shown item names come from one private file for the client layer's build, with colour and wiki link", async () => {
  const store = memoryStore({ [`${FOLDER}/item-names.json`]: namesFile });
  const names = await loadItemNames("1.60.1.70450", BASE, store);
  expect(store.reads).toEqual([`${FOLDER}/item-names.json`]);
  expect(names?.wiki).toEqual({ name: namesFile.wiki.name, url: "https://warcraft.wiki.gg" });
  expect(names?.names.get(19019)).toEqual({ name: "Thunderfury, Blessed Blade of the Windseeker", color: qualityColor(5), wikiPage: "https://warcraft.wiki.gg/wiki/Thunderfury,_Blessed_Blade_of_the_Windseeker", source: "wiki" });
  expect(names?.names.has(9)).toBe(false);
});

test("every id shows; a name without a wiki page is the game files' alone, and one without a quality is common", async () => {
  const file = { ...namesFile, count: 4, names: { ...namesFile.names, 191666: { n: "Skeletal Steed", q: 4 }, 883: { n: "Deprecated Fire Eyed Skull", w: "Deprecated_Fire_Eyed_Skull" } } };
  const names = await loadItemNames("1.60.1.70450", BASE, memoryStore({ [`${FOLDER}/item-names.json`]: file }));
  expect([...names!.names.keys()].sort((a, b) => a - b)).toEqual([883, 2589, 19019, 191666]);
  expect(names!.names.get(191666)).toEqual({ name: "Skeletal Steed", color: qualityColor(4), wikiPage: null, source: "files" });
  expect(names!.names.get(883)).toEqual({ name: "Deprecated Fire Eyed Skull", color: qualityColor(1), wikiPage: "https://warcraft.wiki.gg/wiki/Deprecated_Fire_Eyed_Skull", source: "wiki" });
});

test("without the file, the bucket or the asset URL, or with a file for another build or of another kind, no names show", async () => {
  const store = (file: unknown) => memoryStore({ [`${FOLDER}/item-names.json`]: file });
  expect(await loadItemNames("1.60.1.70450", BASE, memoryStore({}))).toBeNull();
  expect(await loadItemNames("1.60.1.70450", BASE, null)).toBeNull();
  expect(await loadItemNames("1.60.1.70450", null, store(namesFile))).toBeNull();
  expect(await loadItemNames("1.60.1.99999", BASE, store(namesFile))).toBeNull();
  expect(await loadItemNames("1.60.1.70450", BASE, store({ ...namesFile, schema: "everloot.item-names/2" }))).toBeNull();
  // A wiki source under another licence, or a link that is not a page title, makes the whole file unusable.
  expect(await loadItemNames("1.60.1.70450", BASE, store({ ...namesFile, wiki: { ...namesFile.wiki, licence: "CC-BY-NC" } }))).toBeNull();
  expect(await loadItemNames("1.60.1.70450", BASE, store({ ...namesFile, names: { 1: { n: "X", q: 1, w: "\"><script>" } } }))).toBeNull();
});

const questFile = {
  schema: "everloot.quest-names/1", build: { version: "1.60.1.70450" }, wiki: namesFile.wiki,
  count: 2, names: { 176: { n: "Wanted: Hogger", w: "Wanted:_Hogger" }, 65593: { n: "Hearts of the Lovers", w: "Hearts_of_the_Lovers" } },
};
const setFile = { schema: "everloot.item-set-names/1", build: { version: "1.60.1.70450" }, count: 2, names: { 1: "The Gladiator", 1570: "Twilight Invoker's Vestments" } };
const spellFile = { schema: "everloot.spell-names/1", build: { version: "1.60.1.70450" }, count: 3, names: { 3275: "Linen Bandage", 16633: "Create Item Visual (DND)", 1316597: "Stock Crate" } };

test("quest titles, set names and spell names each come from their own private file, every id the file names", async () => {
  const store = memoryStore({ [`${FOLDER}/quest-names.json`]: questFile, [`${FOLDER}/item-set-names.json`]: setFile, [`${FOLDER}/spell-names.json`]: spellFile });
  const quests = await loadQuestNames("1.60.1.70450", BASE, store);
  expect(quests?.wiki).toEqual({ name: namesFile.wiki.name, url: "https://warcraft.wiki.gg" });
  expect([...quests!.names]).toEqual([
    [176, { name: "Wanted: Hogger", wikiPage: "https://warcraft.wiki.gg/wiki/Wanted:_Hogger" }],
    [65593, { name: "Hearts of the Lovers", wikiPage: "https://warcraft.wiki.gg/wiki/Hearts_of_the_Lovers" }],
  ]);
  expect([...(await loadItemSetNames("1.60.1.70450", BASE, store))!.names]).toEqual([[1, "The Gladiator"], [1570, "Twilight Invoker's Vestments"]]);
  expect([...(await loadSpellNames("1.60.1.70450", BASE, store))!.names]).toEqual([[3275, "Linen Bandage"], [16633, "Create Item Visual (DND)"], [1316597, "Stock Crate"]]);
  expect(store.reads).toEqual([`${FOLDER}/quest-names.json`, `${FOLDER}/item-set-names.json`, `${FOLDER}/spell-names.json`]);
});

test("without a file, for another build, or with one file's content under another's name, no names show", async () => {
  expect(await loadQuestNames("1.60.1.70450", BASE, memoryStore({}))).toBeNull();
  expect(await loadQuestNames("1.60.1.99999", BASE, memoryStore({ [`${FOLDER}/quest-names.json`]: questFile }))).toBeNull();
  expect(await loadQuestNames("1.60.1.70450", BASE, memoryStore({ [`${FOLDER}/quest-names.json`]: { ...questFile, wiki: { ...questFile.wiki, licence: "CC-BY-NC" } } }))).toBeNull();
  expect(await loadSpellNames("1.60.1.70450", BASE, memoryStore({ [`${FOLDER}/spell-names.json`]: setFile }))).toBeNull();
  expect(await loadItemSetNames("1.60.1.70450", BASE, null)).toBeNull();
});

test("a relation target takes its name from the loaded files, and says whether the wiki or the game files gave it", () => {
  const of = gameNameFor({
    quests: { version: "v", wiki: { name: "w", url: "u" }, names: new Map([[176, { name: "Wanted: Hogger", wikiPage: "p" }]]) },
    spells: { version: "v", names: new Map([[3275, "Linen Bandage"]]) },
  });
  expect(of("quest", 176)).toEqual({ name: "Wanted: Hogger", source: "wiki" });
  expect(of("spell", 3275)).toEqual({ name: "Linen Bandage", source: "files" });
  expect(of("item_set", 1)).toBeUndefined();
  expect(of("item", 176)).toBeUndefined();
});
