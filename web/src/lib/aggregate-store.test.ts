import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { recordSchemas, type IntakeRecord } from "@everloot/protocol";
import { namedRecord } from "../../../kb/src/corpus";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("./upload-store", () => ({ uploadStore: { loadCorpus: store.loadCorpus } }));

import { buildAggregates, type AggregateSet } from "./aggregate-set";
import {
  AGGREGATES_KEY, anonymousAggregates, encodeAggregates, forgetStoredAggregates, loadStoredAggregates, parseAggregates, writeAggregates,
} from "./aggregate-store";
import { computeRollups, loadAddonLeaderboard, loadItemFacts } from "./rollup-compute";

const AS_OF = "2026-11-06T12:00:00.000Z";
const CLOUD = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "s", r2Bucket: "uploads" };
const INSTALLS = ["install-aaaa-0001", "install-bbbb-0002", "install-cccc-0003", "install-dddd-0004"];

/** Days before AS_OF, as a capture time. */
const daysAgo = (d: number, h = 0) => new Date(Date.parse(AS_OF) - d * 86_400_000 - h * 3_600_000).toISOString();

/**
 * Anonymous rows from four installs that agree, so every table in the set has something in it: drop rates (public,
 * queued and a measured zero), item names and pins, NPCs, quests and vendors, an entrance and an encounter, object
 * sightings, a tooltip number, a crafted item, the addon leaderboard and its weekly history, edges and loot tables.
 */
function anonymousRows(): IntakeRecord[] {
  const rows: Record<string, unknown>[] = [];
  INSTALLS.forEach((installId, i) => {
    let n = 0;
    const row = (r: Record<string, unknown>, at = daysAgo(1, i)) => rows.push({ installId, eventId: `ev-${i}-${n++}`, capturedAt: at, ...r });
    row({ kind: "npc_sighting", npcId: 100, name: "Kobold Vermin", mapId: 1429, x: 40.1, y: 50.2, level: 2, reaction: "hostile", positionKind: "npc", creatureType: "Humanoid", rank: "normal" });
    row({ kind: "npc_sighting", npcId: 200, name: "Corina Steele", mapId: 1429, x: 41.5, y: 65.8, level: 10, reaction: "friendly", positionKind: "interaction", role: "vendor" });
    row({ kind: "npc_sighting", npcId: 300, name: "Marshal McBride", mapId: 1429, x: 48.2, y: 41.9, level: 20, reaction: "friendly", positionKind: "interaction", role: "questgiver" });
    for (let w = 0; w < 12; w++) {
      row({ kind: "loot", sourceNpcId: 100, sourceEvidence: "loot-api", lootType: "kill", copper: 7, items: w % 3 === 0 ? [{ itemId: 1001, count: 1 }] : [{ itemId: 1003, count: 2 }] }, daysAgo(2, w));
    }
    // A kill that dropped nothing (a measured zero) and a window with no NPC or object behind it (rejected).
    row({ kind: "loot", sourceNpcId: 101, sourceEvidence: "loot-api", lootType: "kill", items: [] });
    row({ kind: "loot", sourceItemId: 5523, sourceEvidence: "loot-api", lootType: "kill", items: [{ itemId: 1003, count: 1 }] });
    row({ kind: "loot", sourceObjectId: 500, sourceEvidence: "loot-api", lootType: "gather", gatherKind: "herb", mapId: 1429, x: 30, y: 30, sourceObjectName: "Peacebloom", items: [{ itemId: 2447, count: 1 }] });
    row({ kind: "quest", questId: 7, title: "Kobold Camp Cleanup", level: 2, giverNpcId: 300, turnInNpcId: 300, rewardItemIds: [1002], category: "Elwynn Forest", faction: "alliance" });
    row({ kind: "vendor", vendorNpcId: 200, items: [{ itemId: 159, priceCopper: 25 }, { itemId: 4540, priceCopper: 25, limitedStock: 5 }] });
    for (const [itemId, name] of [[1001, "Kobold Candle"], [1002, "Militia Dagger"], [1003, "Linen Cloth"], [159, "Refreshing Spring Water"], [2447, "Peacebloom"], [2996, "Bolt of Linen Cloth"]] as const) {
      row({ kind: "item_seen", itemId, name, quality: "common" });
    }
    row({ kind: "instance_entrance", instanceMapId: 36, name: "The Deadmines", instanceType: "party", difficulty: 1, mapId: 1436, x: 42.5, y: 71.7 });
    row({ kind: "encounter", encounterId: 1, name: "Rhahk'Zor", instanceMapId: 36, difficulty: 1, size: 5, success: true, npcIds: [644] });
    row({ kind: "object_sighting", objectId: 600, name: "Copper Vein", mapId: 1429, x: 55.5, y: 60.25 });
    row({ kind: "item_fact", itemId: 1002, fact: "damage_per_second", value: 2.5, clientBuild: "1.60.1.70790" });
    row({ kind: "item_fact", itemId: 1002, fact: "stamina", value: i === 3 ? 2 : 1, clientBuild: "1.60.1.70790" });
    row({ kind: "recipe_observed", profession: "Tailoring", rank: 10, recipe: "Bolt of Linen Cloth", recipeId: 2963, learned: true, difficulty: "optimal", productItemId: 2996, reagents: [{ item: "Linen Cloth", count: 2 }] });
    for (const week of [0, 1, 3, 5]) {
      row({ kind: "addon_seen", name: "Details", title: "|cffffd200Details!|r Damage Meter", version: "1.0", loaded: true }, daysAgo(week * 7 + 1, i));
      row({ kind: "addon_seen", name: "Questie", title: "Questie", loaded: i !== 1 }, daysAgo(week * 7 + 2, i));
    }
  });
  return rows as unknown as IntakeRecord[];
}

/** Named rows of every kind the corpus keeps, as a verified grant would publish them. */
function namedRows(): IntakeRecord[] {
  return INSTALLS.flatMap((installId, i) => {
    const base = { installId, capturedAt: daysAgo(1, i) };
    const realm = "Realm Four";
    return [
      { ...base, eventId: `nm-${i}-1`, kind: "guild_snapshot", guildName: "Hidden Guild", realm, faction: "alliance", members: [{ name: "Shadowed", rank: "Officer", level: 20, class: "Rogue", lastOnlineDays: 0 }] },
      { ...base, eventId: `nm-${i}-2`, kind: "raid_lockout", guildName: "Hidden Guild", realm, instance: "The Deadmines", difficulty: "Normal", bossesKilled: ["Rhahk'Zor"], resetAt: AS_OF },
      { ...base, eventId: `nm-${i}-3`, kind: "attendance", guildName: "Hidden Guild", realm, instance: "The Deadmines", present: ["Shadowed"] },
      { ...base, eventId: `nm-${i}-4`, kind: "loot_award", guildName: "Hidden Guild", realm, itemId: 1001, itemName: "Kobold Candle", recipient: "Shadowed", sourceBoss: "Kobold Vermin" },
      { ...base, eventId: `nm-${i}-5`, kind: "guild_kill", guildName: "Hidden Guild", realm, faction: "alliance", encounterId: 1, name: "Rhahk'Zor", instanceMapId: 36, difficulty: 1, size: 5 },
      { ...base, eventId: `nm-${i}-6`, kind: "gear_snapshot", character: "Shadowed", realm, equipped: [{ slot: "MainHand", itemId: 1002, itemLevel: 5 }] },
      { ...base, eventId: `nm-${i}-7`, kind: "gold_snapshot", character: "Shadowed", realm, currentCopper: 100, peakCopper: 200 },
      { ...base, eventId: `nm-${i}-8`, kind: "money_event", character: "Shadowed", realm, category: "loot", copper: 7 },
      { ...base, eventId: `nm-${i}-9`, kind: "collection_owned", collection: "mounts", itemId: 1002 },
    ];
  }) as unknown as IntakeRecord[];
}

const corpus = (records: IntakeRecord[]) => ({ uploads: INSTALLS.length, records, dataAsOf: AS_OF });
/** A set with its addon history worked out, so two sets compare as values. */
const plain = (set: AggregateSet) => ({ ...set, addonTrends: set.addonTrends() });
/** The tables alone: the key and record count say how many rows went in, not what any table holds. */
const tables = (set: AggregateSet) => { const { key: _key, records: _records, ...rest } = plain(set); return rest; };

beforeEach(() => {
  forgetStoredAggregates();
  store.loadCorpus.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("the fixture fills every table, so the round trip below checks each one", () => {
  const set = plain(buildAggregates(corpus(anonymousRows())));
  const empty = Object.entries({
    rates: set.drops.rates, publicRates: set.drops.rates.filter((r) => r.public), measuredZeros: set.drops.measuredZeros, rejected: set.drops.rejected,
    names: set.items.names, pins: set.items.npcs, objects: set.items.objects ?? [],
    npcs: set.world.npcs, quests: set.world.quests, vendors: set.world.vendors,
    entrances: set.instances.entrances, encounters: set.instances.encounters, sightings: set.sightings,
    itemFacts: [...set.itemFacts], crafted: [...set.crafted], addons: set.addons.addons, trends: Object.keys(set.addonTrends),
    edges: set.edges, loot: [...set.loot.sources],
  }).filter(([, v]) => v.length === 0).map(([k]) => k);
  expect(empty).toEqual([]);
});

test("the stored file reads back as exactly the set the cron worked out", () => {
  const set = buildAggregates(corpus(anonymousRows()));
  const read = parseAggregates(encodeAggregates(set, "2026-11-06T12:05:00.000Z"));
  expect(read?.generatedAt).toBe("2026-11-06T12:05:00.000Z");
  expect(plain(read!.set)).toEqual(plain(set));
  expect(read!.set.itemFacts).toBeInstanceOf(Map);
  expect(read!.set.crafted).toBeInstanceOf(Set);
  expect(read!.set.loot.sources).toBeInstanceOf(Map);
});

test("text that is not the file, or a shape this code does not know, reads as no file", () => {
  const good = JSON.parse(encodeAggregates(buildAggregates(corpus(anonymousRows())), AS_OF));
  expect(parseAggregates("not json")).toBeNull();
  expect(parseAggregates(JSON.stringify({ ...good, version: 2 }))).toBeNull();
  expect(parseAggregates(JSON.stringify({ ...good, set: { ...good.set, crafted: [1, 2] } }))).toBeNull();
  expect(parseAggregates(JSON.stringify({ ...good, set: { ...good.set, loot: { leftOut: 0 } } }))).toBeNull();
  expect(parseAggregates(JSON.stringify({ ...good, set: { ...good.set, world: null } }))).toBeNull();
});

test("the fixture's named rows cover every kind that names a guild or a character, and each is a named row", () => {
  const named = new Set<string>(namedRows().map((r) => r.kind));
  // Kinds the corpus never keeps: completion, census and pull rows go to their own stores (kb/src/corpus.ts mergeCorpus).
  const elsewhere = new Set(["achievement_owned", "reputation_owned", "title_owned", "quest_owned", "census_self", "census_seen", "pull_summary"]);
  const naming = Object.entries(recordSchemas)
    .filter(([kind, schema]) => !elsewhere.has(kind) && ("character" in schema.shape || "guildName" in schema.shape || kind === "collection_owned"))
    .map(([kind]) => kind);
  expect(naming.filter((kind) => !named.has(kind))).toEqual([]);
  expect(namedRows().every(namedRecord)).toBe(true);
  expect(anonymousRows().some(namedRecord)).toBe(false);
});

test("named rows change no table: no grant, revoke or hide can change the stored set", () => {
  const without = buildAggregates(corpus(anonymousRows()));
  // Every named row published, as if every grant were valid: the tables still read only the anonymous rows.
  const withNamed = buildAggregates(corpus([...anonymousRows(), ...namedRows()]));
  expect(tables(withNamed)).toEqual(tables(without));
  // The stored copy leaves named rows out before it builds, so even its row count does not move with publication.
  expect(plain(anonymousAggregates(corpus([...anonymousRows(), ...namedRows()])))).toEqual(plain(without));
});

const head = (status: number) => vi.fn(async (req: Request) => new Response(null, { status: req.method === "HEAD" ? status : 200 }));

test("the cron writes the file when the run added uploads or rebuilt, or when there is none; an idle run with a file only asks", async () => {
  const set = buildAggregates(corpus(anonymousRows()));
  const build = vi.fn(async () => set);
  const exists = head(200);
  expect(await writeAggregates({ added: 0, dataAsOf: AS_OF }, { cloud: CLOUD, fetch: exists as unknown as typeof fetch, build })).toEqual({ written: false });
  expect(exists).toHaveBeenCalledOnce();
  expect(build).not.toHaveBeenCalled();
  const missing = head(404);
  const wrote = await writeAggregates({ added: 0, dataAsOf: AS_OF }, { cloud: CLOUD, fetch: missing as unknown as typeof fetch, build, now: () => new Date(AS_OF) });
  expect(wrote).toMatchObject({ written: true });
  const put = (missing.mock.calls[1] as unknown as [Request])[0];
  expect(put.method).toBe("PUT");
  expect(put.url).toContain(AGGREGATES_KEY);
  const body = await put.text();
  expect(wrote.bytes).toBe(new TextEncoder().encode(body).length);
  expect(plain(parseAggregates(body)!.set)).toEqual(plain(set));
  for (const opts of [{ added: 3, dataAsOf: AS_OF }, { added: 0, rebuild: true, dataAsOf: AS_OF }]) {
    const f = head(200);
    expect(await writeAggregates(opts, { cloud: CLOUD, fetch: f as unknown as typeof fetch, build })).toMatchObject({ written: true });
    expect((f.mock.calls[0] as unknown as [Request])[0].method).toBe("PUT");
  }
  await expect(writeAggregates({ added: 1, dataAsOf: AS_OF }, { cloud: null })).rejects.toThrow(/cloud/);
  const refused = vi.fn(async () => new Response(null, { status: 500 }));
  await expect(writeAggregates({ added: 1, dataAsOf: AS_OF }, { cloud: CLOUD, fetch: refused as unknown as typeof fetch, build })).rejects.toThrow(/500/);
});

test("by default the cron builds from the corpus's anonymous rows, and an unreachable corpus writes nothing", async () => {
  store.loadCorpus.mockResolvedValue(corpus([...anonymousRows(), ...namedRows()]));
  const f = head(404);
  await writeAggregates({ added: 1, dataAsOf: AS_OF }, { cloud: CLOUD, fetch: f as unknown as typeof fetch });
  const body = await ((f.mock.calls[0] as unknown as [Request])[0]).text();
  expect(plain(parseAggregates(body)!.set)).toEqual(plain(buildAggregates(corpus(anonymousRows()))));
  expect(body).not.toContain("Shadowed");
  expect(body).not.toContain("Hidden Guild");
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const g = head(404);
  await expect(writeAggregates({ added: 1, dataAsOf: AS_OF }, { cloud: CLOUD, fetch: g as unknown as typeof fetch })).rejects.toThrow(/unreachable/);
  expect(g).not.toHaveBeenCalled();
});

test("a page keeps the file five minutes, sends its ETag after, and keeps the same set while the file is the same", async () => {
  const text = encodeAggregates(buildAggregates(corpus(anonymousRows())), AS_OF);
  const fetch = vi.fn(async (req: Request) => req.headers.get("if-none-match") === "\"v1\""
    ? new Response(null, { status: 304 })
    : new Response(text, { status: 200, headers: { etag: "\"v1\"" } }));
  let now = 0;
  const deps = { cloud: CLOUD, fetch: fetch as unknown as typeof globalThis.fetch, now: () => now };
  const first = await loadStoredAggregates(deps);
  expect(first?.uploads).toBe(INSTALLS.length);
  now = 4 * 60_000;
  expect(await loadStoredAggregates(deps)).toBe(first);
  expect(fetch).toHaveBeenCalledTimes(1);
  now = 6 * 60_000;
  expect(await loadStoredAggregates(deps)).toBe(first);
  expect(fetch).toHaveBeenCalledTimes(2);
  // The same file again (no ETag match, same generatedAt): the set already read is kept.
  fetch.mockImplementation(async () => new Response(text, { status: 200, headers: { etag: "\"v2\"" } }));
  now = 12 * 60_000;
  expect(await loadStoredAggregates(deps)).toBe(first);
  // A failed re-read keeps it for another minute rather than replaying the corpus.
  fetch.mockImplementation(async () => new Response(null, { status: 503 }));
  now = 18 * 60_000;
  expect(await loadStoredAggregates(deps)).toBe(first);
  now = 18 * 60_000 + 30_000;
  await loadStoredAggregates(deps);
  expect(fetch).toHaveBeenCalledTimes(4);
  // Deleted: the page works it out from the corpus, and asks again after a minute.
  fetch.mockImplementation(async () => new Response(null, { status: 404 }));
  now = 20 * 60_000;
  expect(await loadStoredAggregates(deps)).toBeNull();
  now = 20 * 60_000 + 30_000;
  await loadStoredAggregates(deps);
  expect(fetch).toHaveBeenCalledTimes(5);
  now = 21 * 60_000 + 1;
  await loadStoredAggregates(deps);
  expect(fetch).toHaveBeenCalledTimes(6);
});

test("an unknown shape, a network error or no cloud settings read as no file, and never throw", async () => {
  expect(await loadStoredAggregates({ cloud: CLOUD, fetch: (async () => new Response("{\"version\":9}", { status: 200 })) as unknown as typeof fetch })).toBeNull();
  forgetStoredAggregates();
  expect(await loadStoredAggregates({ cloud: CLOUD, fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch })).toBeNull();
  forgetStoredAggregates();
  expect(await loadStoredAggregates({ cloud: null })).toBeNull();
});

test("the answers read the stored set instead of the corpus; with no file, or a corpus passed in, they work it out as before", async () => {
  vi.stubEnv("R2_ACCOUNT_ID", "acct");
  vi.stubEnv("R2_ACCESS_KEY_ID", "id");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "s");
  vi.stubEnv("R2_BUCKET", "uploads");
  const live = buildAggregates(corpus(anonymousRows()));
  const fetch = vi.fn(async () => new Response(encodeAggregates(live, AS_OF), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const facts = await loadItemFacts();
  expect(facts.unreachable).toBe(false);
  expect(facts.names).toEqual(live.items.names);
  expect((await loadAddonLeaderboard()).trends).toEqual(live.addonTrends());
  expect(store.loadCorpus).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
  // A caller's own corpus is always worked out live.
  const own = corpus(anonymousRows().slice(0, 40));
  expect((await computeRollups(own)).stats.records).toBe(40);
  // No file: the corpus is read and the set worked out from it, publication applied by the store as before.
  forgetStoredAggregates();
  fetch.mockImplementation(async () => new Response(null, { status: 404 }));
  store.loadCorpus.mockResolvedValue(corpus(anonymousRows()));
  expect((await loadItemFacts()).names).toEqual(live.items.names);
  expect(store.loadCorpus).toHaveBeenCalledOnce();
});
