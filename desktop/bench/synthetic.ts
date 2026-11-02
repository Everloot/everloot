/**
 * Synthetic Everloot.lua save files for the benchmark. Row shapes follow the addon's `E:Store` calls (addon/modules) and
 * the test fixtures; the text follows the way the game writes SavedVariables: one field per line, tab indents, and a
 * `-- [n]` comment after each array item. Every name, id and number is made up by a seeded generator.
 */

/** Rows per record kind, plus the sizes of the addon's local "seen" tables and auction scans. */
export interface Scenario {
  name: string;
  about: string;
  rows: Partial<Record<string, number>>;
  /** Full auction scans kept in the file: realms x scans per realm (the addon keeps 3) x items per scan. */
  auctions: { realms: number; scans: number; items: number };
  seen: number;
  asks: number;
}

const heavyRows: Record<string, number> = {
  npc_sighting: 2000, loot: 4000, item_seen: 2000, quest: 600, object_sighting: 1500, vendor: 300, item_fact: 2000,
  money_event: 2000, gold_snapshot: 600, gear_snapshot: 200, talent_snapshot: 30, census_self: 60, census_seen: 2000,
  auction_scan: 800, encounter: 200, attendance: 300, raid_lockout: 60, recipe_observed: 200, trainer_seen: 40,
  instance_entrance: 30, map_bounds: 100, achievement_owned: 600, reputation_owned: 60, quest_owned: 5, title_owned: 5,
};

export const SCENARIOS: Scenario[] = [
  {
    name: "small", about: "a casual week: one character, about 10 hours played, one auction scan",
    rows: {
      npc_sighting: 600, loot: 400, item_seen: 200, quest: 40, object_sighting: 80, vendor: 15, item_fact: 150,
      money_event: 150, gold_snapshot: 20, gear_snapshot: 8, talent_snapshot: 4, census_self: 7, census_seen: 500,
      auction_scan: 50, instance_entrance: 5, map_bounds: 20, recipe_observed: 20, trainer_seen: 5,
    },
    auctions: { realms: 1, scans: 1, items: 3000 }, seen: 1200, asks: 0,
  },
  {
    name: "heavy", about: "a month of an active raider: most kinds at the addon's 2,000-row cap, 3 full scans on each of 2 realms",
    rows: heavyRows, auctions: { realms: 2, scans: 3, items: 5000 }, seen: 8000, asks: 3,
  },
  {
    name: "extreme", about: "5x heavy: past the per-kind caps, 3 full scans on each of 10 realms; a stress bound, not a real file",
    rows: Object.fromEntries(Object.entries(heavyRows).map(([k, n]) => [k, n * 5])),
    auctions: { realms: 10, scans: 3, items: 5000 }, seen: 40000, asks: 20,
  },
];

/** mulberry32: the same file every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Lua = string | number | boolean | Lua[] | { [k: string]: Lua };

/** The game's SavedVariables layout. */
function write(v: Lua, depth: number, out: string[]): void {
  if (typeof v === "string") { out.push(JSON.stringify(v)); return; }
  if (typeof v !== "object") { out.push(String(v)); return; }
  const pad = "\t".repeat(depth + 1);
  out.push("{\n");
  if (Array.isArray(v)) {
    v.forEach((item, i) => { out.push(pad); write(item, depth + 1, out); out.push(`, -- [${i + 1}]\n`); });
  } else {
    for (const [k, item] of Object.entries(v)) { out.push(`${pad}[${JSON.stringify(k)}] = `); write(item, depth + 1, out); out.push(",\n"); }
  }
  out.push("\t".repeat(depth), "}");
}

const REALMS = ["Realm Alpha", "Realm Beta", "Realm Gamma", "Realm Delta", "Realm Epsilon", "Realm Zeta", "Realm Eta", "Realm Theta", "Realm Iota", "Realm Kappa"];
const CHARS = ["Charone", "Chartwo", "Charthree", "Charfour"];
const CLASSES = ["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID"];

/** `extra` appends that many new npc_sighting rows with ids of their own, so a later write adds rows without renumbering. */
export function syntheticSave(s: Scenario, extra = 0, seed = 1): string {
  const r = rng(seed);
  const int = (n: number) => Math.floor(r() * n);
  const coord = () => Math.round(r() * 1e4) / 1e4;
  const installId = "a1b2-c3d4-e5f6-0718";
  const epoch = `${installId}-1761955200`;
  let next = 0;
  const day = (i: number) => `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`;
  const base = (i: number) => ({ installId, capturedAt: day(i), eventId: `${epoch}:${++next}`, kindLoggedAt: day(i) });
  const who = () => ({ character: CHARS[int(CHARS.length)], realm: REALMS[0] });
  const key = () => `${(0x10000000 + int(4)).toString(16)}`;
  const rowsOf: Record<string, (i: number) => Record<string, Lua>> = {
    npc_sighting: (i) => ({ ...base(i), npcId: 1000 + int(20000), name: `Creature ${int(5000)}`, mapId: 1400 + int(60), x: coord(), y: coord(), positionKind: "player", level: 1 + int(63), reaction: ["friendly", "neutral", "hostile"][int(3)], creatureType: "Humanoid", rank: "normal" }),
    loot: (i) => ({ ...base(i), sourceNpcId: 1000 + int(20000), lootType: "kill", sourceEvidence: "loot-api", copper: int(5000),
      items: Array.from({ length: 1 + int(3) }, () => ({ itemId: 1000 + int(30000), count: 1 + int(5), quality: int(5) })) }),
    item_seen: (i) => ({ ...base(i), itemId: 1000 + int(30000), name: `Item ${int(30000)}`, quality: "uncommon" }),
    quest: (i) => ({ ...base(i), questId: int(10000), title: `Quest ${int(10000)}`, giverNpcId: int(20000), level: 1 + int(60), mapId: 1400 + int(60), x: coord(), y: coord() }),
    object_sighting: (i) => ({ ...base(i), objectId: int(200000), name: `Object ${int(900)}`, mapId: 1400 + int(60), x: coord(), y: coord(), positionKind: "player" }),
    vendor: (i) => ({ ...base(i), npcId: int(20000), items: Array.from({ length: 10 + int(20) }, () => ({ itemId: int(30000), price: int(100000), stock: -1 })) }),
    item_fact: (i) => ({ ...base(i), itemId: int(30000), itemLevel: int(80), quality: int(5), classId: int(16), subclassId: int(10), equipLoc: "INVTYPE_CHEST", sellPrice: int(50000), stackCount: 1 }),
    money_event: (i) => ({ ...base(i), ...who(), category: ["loot", "vendor", "repair", "auction", "mail"][int(5)], copper: 1 + int(200000) }),
    gold_snapshot: (i) => ({ ...base(i), ...who(), currentCopper: int(1e8), peakCopper: int(1e8) }),
    gear_snapshot: (i) => ({ ...base(i), ...who(), equipped: Array.from({ length: 17 }, (_, k) => ({ slot: `Slot${k}`, itemId: int(30000), itemLevel: 40 + int(40) })) }),
    talent_snapshot: (i) => ({ ...base(i), class: CLASSES[int(9)], level: 60, group: 1, active: true, configId: 0, treeId: 1, exportStatus: "ok", points: 51,
      nodes: Array.from({ length: 30 }, () => ({ nodeId: int(1000), rank: 1 + int(5) })) }),
    census_self: (i) => ({ ...base(i), guid: `Player-1234-${(0x1000000 + int(0xffffff)).toString(16).toUpperCase()}`, race: "Human", class: CLASSES[int(9)], level: 1 + int(60), faction: "Alliance", realm: REALMS[0] }),
    census_seen: (i) => ({ ...base(i), guid: `Player-1234-${(0x1000000 + int(0xffffff)).toString(16).toUpperCase()}`, race: "Orc", class: CLASSES[int(9)], level: 1 + int(60), faction: "Horde", via: "mouseover" }),
    auction_scan: (i) => ({ ...base(i), realm: REALMS[0], itemId: int(30000), count: 1 + int(20), copper: 1 + int(100000), priceBasis: "unit" }),
    encounter: (i) => ({ ...base(i), encounterId: int(1000), difficulty: 9, groupSize: 40, success: true, mapId: int(1000) }),
    attendance: (i) => ({ ...base(i), raidId: int(1000), members: Array.from({ length: 40 }, () => `Member${int(500)}`) }),
    raid_lockout: (i) => ({ ...base(i), ...who(), instanceId: int(1000), resetAt: day(i), progress: int(10) }),
    recipe_observed: (i) => ({ ...base(i), recipeId: int(30000), skillLine: int(400), skill: int(300), reagents: Array.from({ length: 3 }, () => ({ itemId: int(30000), count: 1 + int(5) })) }),
    trainer_seen: (i) => ({ ...base(i), npcId: int(20000), spells: Array.from({ length: 20 }, () => ({ spellId: int(30000), cost: int(10000), level: int(60) })) }),
    instance_entrance: (i) => ({ ...base(i), instanceMapId: int(1000), mapId: 1400 + int(60), x: coord(), y: coord() }),
    map_bounds: (i) => ({ ...base(i), mapId: 1400 + int(60), left: coord(), right: coord(), top: coord(), bottom: coord() }),
    achievement_owned: (i) => ({ ...base(i), characterKey: key(), class: "PALADIN", level: 60, achievementId: int(5000), completed: r() < 0.5, criteriaMet: int(5), criteriaTotal: 5 }),
    reputation_owned: (i) => ({ ...base(i), characterKey: key(), class: "PALADIN", level: 60, factionId: int(2000), reaction: 1 + int(8), standing: int(21000), floor: 0, ceiling: 21000 }),
    quest_owned: (i) => ({ ...base(i), characterKey: key(), class: "PALADIN", level: 60, questIds: Array.from({ length: 400 }, () => int(10000)) }),
    title_owned: (i) => ({ ...base(i), characterKey: key(), class: "PALADIN", level: 60, titleIds: Array.from({ length: 10 }, () => int(200)) }),
  };
  const records: Record<string, Lua> = {};
  for (const [kind, n] of Object.entries(s.rows)) records[kind] = Array.from({ length: n ?? 0 }, (_, i) => rowsOf[kind](i));
  // Full scans: parts of up to 1,000 items, each item { itemId, auctions, quantity, minUnit, marketUnit }.
  const snapshots: Lua[] = [];
  const lastScans: Record<string, Lua> = {};
  for (let realm = 0; realm < s.auctions.realms; realm++) {
    for (let scan = 0; scan < s.auctions.scans; scan++) {
      const at = 1761955200 + realm * 1000 + scan * 86400;
      const scanId = `${installId}-${at}`;
      const parts = Math.ceil(s.auctions.items / 1000);
      for (let p = 1; p <= parts; p++) {
        const items = Array.from({ length: Math.min(1000, s.auctions.items - (p - 1) * 1000) }, (_, k) => [(p - 1) * 1000 + k + 1, 1 + int(30), 1 + int(500), 1 + int(1e6), 1 + int(1e6)] as Lua);
        snapshots.push({ ...base(scan), realm: REALMS[realm], faction: "Alliance", house: "Alliance", scanId, part: p, parts, items });
      }
      lastScans[REALMS[realm]] = { scanId, at };
    }
  }
  if (snapshots.length) records.auction_snapshot = snapshots;
  const npcs = (records.npc_sighting ??= []) as Lua[];
  for (let k = 1; k <= extra; k++) npcs.push({ ...rowsOf.npc_sighting(k), eventId: `${epoch}:${1e9 + k}` });
  const seenMap = (prefix: string) => Object.fromEntries(Array.from({ length: s.seen }, (_, i) => [`${prefix}${i}:${int(1e6)}`, true] as [string, Lua]));
  const db: Record<string, Lua> = {
    version: "0.3.14", installId, clientBuild: "1.60.1.70450",
    toggles: { openworld: true, guild: true, gear: true, auctions: true, gold: true, addons: false, talents: true, completion: true, census: true, players: false },
    eventEpoch: epoch, nextEvent: next, censusNotice: true,
    lastScans,
    asks: Array.from({ length: s.asks }, (_, i) => ({ id: `ask:${i + 1}`, question: `price ${1000 + i}`, askedAt: day(i), realm: REALMS[0] })),
    targetSeen: seenMap("Creature-0-"), lootSources: seenMap("Creature-0-loot-"), questSeen: seenMap("q"), itemFactSeen: seenMap("i"),
    records,
  };
  const out: string[] = ["\nEverlootDB = "];
  write(db, 0, out);
  out.push("\n");
  return out.join("");
}

/** A receipt file as companion/src/sent-state.ts writes it: one install, `count` event ids in the addon's format. */
export function syntheticSent(count: number, installId = "a1b2-c3d4-e5f6-0718"): string {
  const ids: string[] = new Array(count);
  for (let i = 0; i < count; i++) ids[i] = `a1b2-c3d4-e5f6-0718-1761955200:${i + 1}`;
  return JSON.stringify({ [installId]: ids });
}
