import { z } from "zod";
import { ITEM_FACTS } from "./records.js";

/**
 * The Everloot MCP server's tools: names, titles, descriptions, input schemas and annotations, in the
 * order the server lists them. kb/src/mcp-server.ts registers from this table and supplies the handlers;
 * the connect page and llms.txt list from it; schema/mcp/<tool>.json is generated from it. Every tool
 * is read-only, and its annotations say so with all four hints (readOnlyHint, destructiveHint, idempotentHint,
 * openWorldHint), so a directory never has to assume the worst for one it cannot read. Today every tool answers
 * with one text block (TOOL_OUTPUT); structured output is a later minor release, tool by tool.
 */

/** Record kinds in the knowledge release (lore and reference data). */
export const KNOWLEDGE_KINDS = [
  "item", "npc", "object", "quest", "zone", "spell", "lore_page", "creator", "realm",
  "achievement", "faction", "title", "quest_chain", "mount", "legacy_perk", "race", "instance", "build",
] as const;
/** Game versions a knowledge record can belong to. */
export const GAME_VERSIONS = ["forever", "classic", "retail", "lore"] as const;
/** Entities relation edges connect. A zone is a UiMap id. */
export const ENTITY_KINDS = ["item", "spell", "npc", "object", "quest", "zone", "item_set", "icon", "skill"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
/** Typed relations between entities, in the order pages list them: what players saw first, then what the files say. */
export const RELS = [
  "dropped_by", "sold_by", "reward_from", "located_in",
  "created_by", "reagent_for", "part_of_set", "same_icon", "in_skill_line",
] as const;
export type Rel = (typeof RELS)[number];
/** recent_changes filters. */
export const CHANGE_FILTERS = ["all", "posts", "hotfixes", "builds"] as const;
export type ChangeFilter = (typeof CHANGE_FILTERS)[number];
/** ecosystem_projects boards, and the filter that adds "all" (A to Z). */
export const BOARD_IDS = ["installed", "rising", "active", "release", "maintained"] as const;
export type BoardId = (typeof BOARD_IDS)[number];
export const ECOSYSTEM_BOARD_FILTERS = ["all", ...BOARD_IDS] as const;
/** world_map_near: radius in yards and results per list. */
export const NEAR_DEFAULT_RADIUS = 500;
export const NEAR_MAX_RADIUS = 5000;
export const NEAR_DEFAULT_LIMIT = 5;
export const NEAR_MAX_LIMIT = 20;
/** Item quality slugs in Enum.ItemQuality order. */
export const ITEM_QUALITY_SLUGS = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"] as const;
/** The classes with a talent catalog, in the site's order (web/src/lib/talents/catalogs.ts). */
export const TALENT_CLASSES = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"] as const;
export type TalentClass = (typeof TALENT_CLASSES)[number];

/** One talent node as talent_tree returns it: the calculator's own shape, positions 1-based. */
export const talentNode = z.object({
  id: z.number().int().describe("The client's trait node id, the id a share code names."),
  treeId: z.number().int(),
  row: z.number().int().describe("1-based, top row first."),
  col: z.number().int().describe("1-based, left first."),
  kind: z.enum(["single", "tiered", "choice"]).describe("A tiered node buys its entries in order; a choice node picks one."),
  maxRanks: z.number().int(),
  talents: z.array(z.object({
    name: z.string(),
    spellId: z.number().int().nullable(),
    maxRanks: z.number().int().optional().describe("Ranks this entry takes, for a tiered node."),
  })),
  prereqs: z.array(z.number().int()).describe("Node ids that must all be at full rank first."),
  anyOf: z.array(z.number().int()).optional().describe("If listed, at least one of these must be at full rank too."),
  gate: z.object({
    pointsInTree: z.number().int().optional().describe("Points needed in this tree on rows above."),
    pointsTotal: z.number().int().optional().describe("Points needed in the build, any tree."),
    scope: z.enum(["tree", "class", "unconfirmed"]).optional().describe("Where the files say the gate counts; unconfirmed is read as the tree."),
    ranksInNodes: z.array(z.object({ nodeId: z.number().int(), ranks: z.number().int() })).optional(),
  }).optional(),
});
export type TalentNodeOut = z.infer<typeof talentNode>;

/** One tree of a plan, with the points spent in it. */
export const talentTreePoints = z.object({ id: z.number().int(), name: z.string(), points: z.number().int() });

/** One item's category path as item_categories returns it. Null parts are not in the build's tables. */
export const itemCategory = z.object({
  itemId: z.number().int(),
  class: z.object({ id: z.number().int(), name: z.string(), label: z.string(), slug: z.string() }).nullable(),
  subclass: z.object({ id: z.number().int(), name: z.string().nullable(), slug: z.string() }).nullable(),
  slot: z.object({ inventoryType: z.number().int(), name: z.string(), slug: z.string() }).nullable(),
  quality: z.object({ id: z.number().int(), name: z.string(), slug: z.string() }).nullable(),
});
export type ItemCategoryOut = z.infer<typeof itemCategory>;

/** One project as ecosystem_projects returns it. GitHub facts carry the time they were refreshed in the answer. */
export const ecosystemProject = z.object({
  rank: z.number().int().optional().describe("Position on the board; absent for the A to Z list."),
  display: z.string().optional().describe("The board's own figure for this project, such as 6 installs."),
  id: z.string(),
  name: z.string(),
  kind: z.enum(["addon", "tool"]),
  summary: z.string().describe("Everloot's own words."),
  repo: z.string(),
  url: z.string(),
  installs: z.number().int().nullable().describe("From Everloot uploads, counted from 3 installs; null means not counted, not zero."),
  stars: z.number().int().nullable(),
  release: z.object({ tag: z.string(), date: z.string(), url: z.string() }).nullable(),
  lastCommit: z.string().nullable(),
  commits4w: z.number().int().nullable(),
  foreverReady: z.enum(["yes", "no", "unknown"]),
  badges: z.array(z.string()),
  maintenanceScore: z.number().int().nullable(),
});
export type EcosystemProjectOut = z.infer<typeof ecosystemProject>;

/**
 * What an answer's `url` means. Absent when the answer has no page, or its page would be empty or not
 * indexed; a page link never stands in for a fact the answer does not hold.
 */
export const PAGE_URL = "The everloot.app page that shows this answer, absolute. Absent when there is no such page or it would be empty.";

/**
 * What every structured answer built on player uploads starts with. connected false means no corpus
 * was read (not connected, or unavailable): the page is then absent, and that is not a measured zero.
 */
export const uploadsAnswer = {
  connected: z.boolean().describe("False when no corpus was read; the page is then absent, which is not a measured zero."),
  dataAsOf: z.string().nullable().describe("The corpus snapshot time, or null when unrecorded."),
  reason: z.string().optional().describe("Why nothing was read, when connected is false."),
  url: z.string().optional().describe(PAGE_URL),
};

/** One source of an item with its observed loot-window frequency; public after 3 distinct install reports. */
export const itemDrop = z.object({
  sourceNpcId: z.number().int().optional(),
  sourceObjectId: z.number().int().optional(),
  source: z.string().describe("The source in words, with its agreed name when it has one."),
  kills: z.number().int().describe("Observed loot windows, not a census of kills."),
  drops: z.number().int().describe("Windows with this item; 0 is a measured zero."),
  rate: z.number(),
  reporters: z.number().int(),
});
export const mapPin = z.object({ npcId: z.number().int(), name: z.string().nullable(), mapId: z.number().int(), x: z.number(), y: z.number(), reporters: z.number().int() });
/** Loot windows players reported that the public rates do not count yet. A count, never a rate. */
export const pendingLoot = z.object({
  windows: z.number().int().describe("Reported loot windows not yet in the rates."),
  reporters: z.number().int().describe("Distinct reporters behind those windows."),
}).describe("Loot windows reported but not yet in the rates. Absent when there are none.");
export const itemPage = z.object({
  itemId: z.number().int(),
  name: z.string().nullable().describe("Null until 3 installs report the same name."),
  drops: z.array(itemDrop),
  pins: z.array(mapPin).describe("Agreed positions of the NPCs it drops from; a pin needs 3 installs on the same map."),
  pendingLoot: pendingLoot.optional(),
  reported: z.object({
    shown: z.array(z.object({
      fact: z.enum(ITEM_FACTS), value: z.number(), reporters: z.number().int().min(3),
      build: z.string(), lastSeen: z.string().nullable().describe("Latest agreeing report not after the corpus date; null means [?]."),
    })),
    contested: z.array(z.enum(ITEM_FACTS)).describe("No unique value has 3 agreeing installs; no value is disclosed."),
  }).optional().describe("Player-reported item numbers, decided per line in the newest build with 3 reporting installs. Missing lines are unknown, never zero."),
});
export const npcPage = z.object({
  npcId: z.number().int(),
  name: z.string().nullable(),
  pins: z.array(z.object({ mapId: z.number().int(), x: z.number(), y: z.number(), reporters: z.number().int() })),
  pendingLoot: pendingLoot.optional(),
});
export const questPage = z.object({
  questId: z.number().int(),
  title: z.string().nullable(),
  level: z.number().int().nullable(),
  giverNpcId: z.number().int().nullable(),
  turnInNpcId: z.number().int().nullable(),
  rewards: z.array(z.number().int()).describe("Reward item ids 3 installs agree on."),
});
export const vendorOffer = z.object({
  itemId: z.number().int(),
  priceCopper: z.number().int(),
  limitedStock: z.number().int().nullable().describe("Null with unlimited false means the stock is unrecorded, not unlimited."),
  unlimited: z.boolean(),
  reporters: z.number().int(),
});
export const vendorPage = z.object({ vendorNpcId: z.number().int(), offers: z.array(vendorOffer) });
export const objectPage = z.object({
  objectId: z.number().int(),
  name: z.string().nullable(),
  drops: z.array(z.object({ itemId: z.number().int(), itemName: z.string().nullable(), kills: z.number().int(), drops: z.number().int(), rate: z.number(), reporters: z.number().int() })),
  zero: z.object({ kills: z.number().int(), reporters: z.number().int() }).nullable().describe("Public windows with no item at all: a measured zero."),
  queued: z.boolean().describe("Observations exist but fewer than 3 installs reported them."),
  pendingLoot: pendingLoot.optional(),
  pins: z.array(z.object({ mapId: z.number().int(), x: z.number(), y: z.number(), reporters: z.number().int() })).optional()
    .describe("Where players saw the object on the minimap, at its own position; a pin needs 3 installs at one spot. Absent when there is none."),
});

/** The realm parameter of market_value and auction_history. */
const REALM_INPUT =
  "The realm's full name as the game's realm list shows it, such as CAMWOW US1 Realm 4 PvP. The end of exactly one realm's full name (US1 Realm 4 PvP) is read as that realm; an unknown or ambiguous name answers with the realms to ask with.";

/** How market_value and auction_history read the realm asked for. Absent when the market rollup is not connected. */
const realmLookup = {
  realmStatus: z.enum(["exact", "alias", "ambiguous", "unknown"]).optional()
    .describe("exact: a realm Everloot holds scans for. alias: the end of exactly one public realm's full name, read as that realm (realm is its full name). ambiguous: the end of several realms' names, so nothing is read. unknown: no scan names that realm, so nothing is read; that is not an empty market."),
  askedRealm: z.string().optional().describe("The realm as asked, when it was read as an alias."),
  candidates: z.array(z.string()).optional().describe("For ambiguous or unknown: the realms with public prices to ask with instead, closest first."),
};
const marketDay = z.object({ day: z.string(), min: z.number().int(), market: z.number().int(), quantity: z.number().int(), reporters: z.number().int(), thin: z.boolean() });

export const auctionHistory = z.object({
  realm: z.string(),
  itemId: z.number().int(),
  points: z.array(z.object({
    day: z.string(),
    copper: z.number().int().describe("The median of the last scan from each install that day."),
    reporters: z.number().int(),
  })).describe("Single listings players saw while browsing: days 3 installs scanned the item on the realm, or one of Everloot's own installs did (reporters under 3), oldest first."),
  scanDays: z.array(marketDay).optional()
    .describe("The public full-scan days market_value values the item by, the same days as its history, oldest first. Absent when the market is not connected."),
  ...realmLookup,
});
export const collectionGap = z.object({
  collection: z.string(),
  ownerInstallId: z.string(),
  groups: z.array(z.object({
    source: z.string(),
    owned: z.array(z.number().int()),
    missing: z.array(z.number().int()),
  })).describe("Catalog entries 3 installs agree on, grouped by source, split by the install's own upload."),
  queued: z.array(z.number().int()).describe("Catalog entries fewer than 3 installs reported yet."),
  ownedRecorded: z.boolean().describe("False when this install never uploaded this collection: owned is unknown, not empty."),
});
/** Who reported a guild's kill: its members' uploads (2 installs agreeing) or its officers' published board. */
export const KILL_SOURCES = ["members", "officers"] as const;
export const GUILD_FACTIONS = ["alliance", "horde"] as const;

/** One boss in a guild's progression through an instance. */
export const guildBossProgress = z.object({
  encounterId: z.number().int(),
  name: z.string(),
  killed: z.boolean(),
  killedAt: z.string().nullable().describe("The earliest agreeing report, ISO; null for an unkilled boss or one only the officers published."),
  source: z.enum(KILL_SOURCES).nullable().describe("Who reported the kill; null for an unkilled boss."),
});
/** A guild's standing in one instance: bosses killed out of the bosses 3 installs reported there. */
export const guildInstanceProgress = z.object({
  instanceMapId: z.number().int(),
  name: z.string(),
  killed: z.number().int(),
  bosses: z.number().int(),
  list: z.array(guildBossProgress).describe("Every boss of the instance in encounter order, killed or not."),
});
/** One agreed kill, for a guild's activity feed. */
export const guildKillEntry = z.object({
  encounterId: z.number().int(),
  name: z.string(),
  instanceMapId: z.number().int(),
  killedAt: z.string().describe("The earliest agreeing report, ISO."),
  source: z.enum(KILL_SOURCES),
});
/** A guild's rank in the newest instance it has a kill in. */
export const guildRanks = z.object({
  instanceMapId: z.number().int(),
  instanceName: z.string(),
  realm: z.number().int().describe("Rank among the realm's guilds in that instance."),
  overall: z.number().int().describe("Rank among every guild in that instance."),
});

export const guildBoard = z.object({
  guildName: z.string(),
  realm: z.string(),
  memberCount: z.number().int().nullable().describe("Null until officer uploads agree."),
  roster: z.array(z.object({ name: z.string(), rank: z.string(), level: z.number().int(), className: z.string() })),
  progression: z.array(z.object({ instance: z.string(), bosses: z.array(z.string()) })),
  loot: z.array(z.object({ itemId: z.number().int(), recipient: z.string(), sourceBoss: z.string() })),
  averageItemLevel: z.number().nullable(),
  gearCoverage: z.object({ measured: z.number().int(), roster: z.number().int() }).describe("Roster members with one agreed item level, over the agreed roster."),
  present: z.array(z.string()),
  attendanceWaiting: z.boolean(),
  // The ladder side of the guild (guilds design, 2026-10-24): members' agreed kills joined with the officers' board.
  ladderProgression: z.array(guildInstanceProgress).optional().describe("Per instance, newest first: bosses killed out of the instance's bosses, each kill with its date and who reported it. Members' kills and the officers' board together; a boss both report is one line."),
  activity: z.array(guildKillEntry).optional().describe("The agreed kills, newest first."),
  seenRoster: z.object({
    count: z.number().int(),
    members: z.array(z.object({ name: z.string(), level: z.number().int(), class: z.string(), lastSeen: z.string() })),
  }).nullable().optional().describe("Characters the addon saw in this guild, newest first: sightings, not the game's roster. Null when the player pages are not connected, which is not an empty guild."),
  ranks: guildRanks.nullable().optional().describe("Rank on the realm and overall in the newest instance with a kill; null without one."),
});

/** One guild as guild_search lists it. */
export const guildSummary = z.object({
  guildName: z.string(),
  realm: z.string(),
  faction: z.enum(GUILD_FACTIONS).nullable().describe("Null until a kill or a board names it."),
  membersSeen: z.number().int().nullable().describe("Characters the addon saw in the guild; null when the player pages are not connected, which is not zero."),
  kills: z.number().int().describe("Agreed boss kills, members' and officers' together."),
  latestKillAt: z.string().nullable().describe("The newest agreed kill, ISO; null without a timed kill."),
});
export const guildSearch = z.object({ guilds: z.array(guildSummary) });

/** One row of the guild ladder for one instance. */
export const ladderRow = z.object({
  rank: z.number().int().describe("Equal kills and latest-kill time share a rank."),
  guildName: z.string(),
  realm: z.string(),
  faction: z.enum(GUILD_FACTIONS).nullable(),
  killed: z.number().int(),
  bosses: z.number().int(),
  latestKillAt: z.string().nullable().describe("When the guild's latest kill in this instance was first reported, ISO; null when only the officers published it."),
  membersSeen: z.number().int().nullable(),
});
export const guildRankings = z.object({
  instance: z.object({ instanceMapId: z.number().int(), name: z.string() }).nullable().describe("The instance ranked; null when no instance has an agreed kill."),
  rows: z.array(ladderRow),
});

const reagent = z.object({ item: z.string(), count: z.number().int() });
export const professionPath = z.object({
  profession: z.string(),
  fromSkill: z.number().int(),
  toSkill: z.number().int(),
  steps: z.array(z.object({
    recipe: z.string(),
    fromSkill: z.number().int(),
    toSkill: z.number().int(),
    crafts: z.number().int(),
    points: z.number().int(),
    reagents: z.array(reagent),
    copper: z.number().int().nullable().describe("Reagent cost of the step; null when a price is unrecorded."),
    reporters: z.number().int(),
    trainingCopper: z.number().int().nullable().optional().describe("Derived steps only: agreed training cost, or null when unrecorded."),
  })),
  gaps: z.array(z.object({ fromSkill: z.number().int(), toSkill: z.number().int() })).describe("Skill ranges no agreed recipe covers; a gap is left, never invented."),
  reagents: z.array(reagent).describe("Every reagent the path needs, summed."),
  copper: z.number().int().nullable().describe("The whole path's reagent cost; null when any price is unrecorded."),
});
const skillRange = z.object({ min: z.number().int().nullable(), max: z.number().int().nullable() });
export const recipeThresholds = z.object({
  profession: z.string(),
  ranges: z.array(z.object({
    profession: z.string(),
    recipe: z.string(),
    installs: z.number().int(),
    observations: z.number().int(),
    yellow: skillRange, green: skillRange, grey: skillRange,
    reagents: z.array(reagent).nullable().describe("The reagent list three installs agree on, or null."),
    costCopper: z.number().int().nullable().describe("Estimated cost per craft from agreed prices; null when a price is unrecorded or the reagents are."),
    missingPrices: z.array(z.string()).describe("Reagents with no agreed price."),
  })).describe("A range, never a guessed exact number; empty is unrecorded, not zero."),
});
const closestAchievement = z.object({ achievementId: z.number().int(), name: z.string(), category: z.string(), have: z.number(), of: z.number(), unit: z.enum(["criteria", "progress"]) });
const closestFaction = z.object({ factionId: z.number().int(), name: z.string(), standing: z.string(), toNext: z.number().int(), header: z.string().optional() });
export const characterProgress = z.object({
  characterKey: z.string().describe("An opaque key derived from the install and the character, never the name."),
  class: z.string(),
  level: z.number().int(),
  achievements: z.object({ done: z.number().int(), total: z.number().int(), points: z.number().int(), pointsTotal: z.number().int(), closest: z.array(closestAchievement), unlisted: z.number().int() }),
  reputation: z.object({
    exalted: z.number().int(), total: z.number().int(), closest: z.array(closestFaction),
    unscaled: z.array(z.object({ factionId: z.number().int(), name: z.string(), standing: z.number().int() })), unlisted: z.number().int(),
  }),
  titles: z.object({ known: z.number().int(), total: z.number().int(), unlisted: z.number().int() }),
  quests: z.object({
    completed: z.number().int(), chainsDone: z.number().int(), chainsTotal: z.number().int(),
    closest: z.array(z.object({ questLineId: z.number().int(), name: z.string(), done: z.number().int(), total: z.number().int(), truncated: z.boolean() })),
  }),
});
export const completionProgress = z.object({
  ownerInstallId: z.string(),
  listed: z.object({ achievements: z.number().int(), factions: z.number().int(), titles: z.number().int(), chains: z.number().int() }).describe("What the agreed lists hold. All zero means no list is public yet."),
  ownedRecorded: z.boolean().describe("False when this install has no shared completion data: owned is unknown, not empty."),
  characters: z.array(characterProgress),
  unknownCharacter: z.string().optional().describe("The character key that was asked for and not found."),
  droppedCharacters: z.number().int().describe("Characters of this install the site no longer holds."),
});
export const marketValue = z.object({
  itemId: z.number().int(),
  market: z.number().int().nullable().describe("Null when no solid public day falls in the last 14: unrecorded, not zero."),
  min: z.number().int(),
  historical: z.number().int(),
  quantity: z.number().int(),
  day: z.string(),
  ageDays: z.number().int(),
  reporters: z.number().int(),
  thin: z.boolean(),
});
export const marketPage = z.object({
  realm: z.string(),
  itemId: z.number().int(),
  value: marketValue.nullable().describe("Null until 3 reporters scanned the item on the realm, or one of Everloot's own installs did, and for an ambiguous or unknown realm."),
  history: z.array(marketDay),
  ...realmLookup,
});
export const relationEdge = z.object({
  fromKind: z.enum(ENTITY_KINDS), fromId: z.number().int(), rel: z.enum(RELS), toKind: z.enum(ENTITY_KINDS), toId: z.number().int(),
  evidence: z.enum(["observed", "client"]).describe("observed: players saw it, 3 installs. client: the game files, unconfirmed."),
  build: z.string().nullable(),
  installs: z.number().int().nullable(),
  firstSeen: z.string().nullable(),
  lastSeen: z.string().nullable(),
});
export const entityRelations = z.object({
  kind: z.enum(ENTITY_KINDS),
  id: z.number().int(),
  edges: z.array(relationEdge).describe("Outgoing then incoming, grouped by relation, each group cut to the limit."),
  notShown: z.number().int().describe("Edges beyond the limit, over every group."),
});

const copperByCategory = (categories: readonly string[]) => z.object(Object.fromEntries(categories.map((c) => [c, z.number().int().optional()])) as Record<string, z.ZodOptional<z.ZodNumber>>);
export const INCOME_CATEGORIES = ["loot", "quest", "vendor", "auction"] as const;
export const SPENDING_CATEGORIES = ["flight", "postage", "barber", "respec", "auction_spend"] as const;
export const goldLedger = z.object({
  character: z.string(),
  realm: z.string(),
  recorded: z.boolean().describe("False when no snapshot and no money event names this character: gold unrecorded."),
  ledgers: z.array(z.object({
    installId: z.string(),
    peakCopper: z.number().int().nullable().describe("Null is unrecorded, never zero."),
    currentCopper: z.number().int().nullable(),
    income: copperByCategory(INCOME_CATEGORIES).describe("A category absent here was never seen: unrecorded."),
    spending: copperByCategory(SPENDING_CATEGORIES),
    incomeTotal: z.number().int().nullable().describe("The income lines seen, summed; the difference from the peak is unrecorded, never called bought."),
  })).describe("One per install. Ledgers are not merged."),
});
const nearPin = z.object({
  npcId: z.number().int(), name: z.string().nullable(), mapId: z.number().int(), zoneName: z.string(),
  x: z.number(), y: z.number(), yards: z.number(), reporters: z.number().int(),
});
export const mapNear = z.object({
  ok: z.boolean().describe("False when the query was refused; message says why."),
  message: z.string().optional(),
  origin: z.string().optional().describe("The spot in words."),
  radius: z.number().optional(),
  limit: z.number().int().optional(),
  entrances: z.array(z.object({
    names: z.array(z.string()), raid: z.boolean(), zone: z.string().nullable(), yards: z.number(),
    confirmed: z.number().int().optional().describe("Installs that zoned in from this entrance, once 3 agree on it; absent until then."),
  })).optional()
    .describe("From the game files, found in game files, unconfirmed unless confirmed is set. Nearest first."),
  npcs: z.array(nearPin).optional().describe("Players saw them; a pin needs 3 installs on the same map."),
  vendors: z.array(nearPin).optional(),
  treasures: z.array(z.object({
    objectId: z.number().int(), name: z.string().nullable(), mapId: z.number().int(), zoneName: z.string(),
    x: z.number(), y: z.number(), yards: z.number(), reporters: z.number().int(),
  })).optional().describe("Game objects players saw on the minimap at their own position, such as treasure chests; a pin needs 3 installs at one spot."),
});

/** The census's factions and windows (population). */
export const CENSUS_FACTIONS = ["Alliance", "Horde"] as const;
export const CENSUS_WINDOWS = ["week", "launch"] as const;

/** One census count as population returns it. A hidden count is null, never a number. */
export const populationCell = z.object({
  slice: z.enum(["faction", "race", "class", "raceClass", "level"]),
  faction: z.enum(CENSUS_FACTIONS).optional(),
  race: z.string().optional().describe("UnitRace's token, such as Scourge for Undead."),
  class: z.string().optional().describe("UnitClass's token, such as PRIEST."),
  band: z.string().optional().describe("Level band: 1-9, 10-19 ... 50-59, or 60."),
  label: z.string(),
  count: z.number().int().nullable().describe("Characters, rounded to the nearest 5. Null is hidden: fewer than 10 characters, fewer than 3 installs or fewer than 3 addresses, or hidden so a small count can't be worked out from the others."),
  share: z.number().nullable().describe("count out of the window's characters, both as shown."),
});
export const populationPage = z.object({
  scope: z.object({ id: z.string(), label: z.string() }),
  launched: z.boolean().describe("False before launch: nothing is counted yet."),
  launch: z.string().describe("When counting starts."),
  window: z.object({ id: z.enum(CENSUS_WINDOWS), from: z.string(), to: z.string() }),
  collecting: z.boolean().describe("True until the window has 10 characters from 3 installs and 3 addresses; no count shows until then."),
  characters: z.number().int().nullable(),
  installs: z.number().int().describe("Installs that reported in the window: a count of installs, not of people."),
  rule: z.object({ minCharacters: z.number().int(), minInstalls: z.number().int(), minReporters: z.number().int(), roundTo: z.number().int() }),
  cells: z.array(populationCell),
  note: z.string().optional().describe("Why there are no cells: a name the game does not have, or a combination it does not allow."),
  source: z.object({ title: z.string(), url: z.string() }),
  method: z.object({ title: z.string(), url: z.string() }),
  licence: z.string(),
});
export type PopulationCellOut = z.infer<typeof populationCell>;
export type PopulationPageOut = z.infer<typeof populationPage>;

/** One row of the implementation tracker as everloot_plan returns it. */
export const planRow = z.object({
  id: z.string(),
  status: z.enum(["live", "next", "waiting", "shape"]),
  name: z.string(),
  done: z.string().describe("What done means, or why this row is not a build."),
  proof: z.enum(["none", "code", "deployed", "client", "public", "real-data"]).optional().describe("The furthest the row is proven."),
});
export type PlanRowOut = z.infer<typeof planRow>;

/** The kind filter of search_knowledge and get_by_name. */
const KIND_FILTER =
  "Narrow to one record kind. achievement, faction, title, quest_chain, mount, legacy_perk, race and instance come from the game files (found in game files, unconfirmed); item, npc, object, quest, zone, spell, lore_page, creator and realm from the knowledge release; build is an Everloot team starter talent build, not observed. Without it, every kind.";

const searchArgs = {
  query: z.string().max(1000).describe("What to look up: names, questions, keywords. Question words are ignored."),
  kind: z.enum(KNOWLEDGE_KINDS).optional().describe(KIND_FILTER),
  version: z.enum(GAME_VERSIONS).optional().describe("Narrow to one game version: forever, classic, retail or lore. Without it, every version."),
  limit: z.number().int().min(1).max(25).default(8).describe("Most hits, 1 to 25, default 8."),
};

/**
 * search and fetch answer in the shape OpenAI's connector contract asks for (ChatGPT connectors, deep
 * research and company knowledge call exactly these two tools by name): a result list, then one document
 * by id. Ids are knowledge record ids as strings. The text block carries the same JSON as a string.
 */
export const searchResult = z.object({
  id: z.string().describe("The record id as a string. Pass it to fetch."),
  title: z.string().describe("The record's name."),
  url: z.string().describe("Where the record is read: its page on everloot.app for a lore page, else the source's own page. ChatGPT cites it."),
});
export type SearchResultOut = z.infer<typeof searchResult>;
/** The parameters get_entity and fetch share to read one field of a record and page a long array. */
export const FIELD_READ_ROWS = 48;
export const fieldReadInput = {
  field: z.string().max(200).optional().describe("A JSON pointer into the record's data, such as /criteria or /reagents/0. Without it, the whole record."),
  offset: z.number().int().min(0).optional().describe("Row to start at when the field is an array; default 0. Use nextOffset from the last answer."),
  limit: z.number().int().min(1).max(FIELD_READ_ROWS).optional().describe(`Rows per answer, default and at most ${FIELD_READ_ROWS}.`),
};
/** What a field read answers with: the pointed value (an array is one page of it) and where the next page starts. */
export const fieldReadOutput = {
  field: z.object({
    pointer: z.string(),
    value: z.unknown().describe("The value at the pointer. An array is one page of up to 48 rows."),
    nextOffset: z.number().int().optional().describe("Present when more rows remain: pass it as offset."),
  }).optional().describe("Present when field was given and found."),
  keys: z.array(z.string()).optional().describe("Present when field was given and not found: the keys of the deepest object the pointer reached. Empty when the record has no structured data."),
};
export const fetchedDocument = z.object({
  id: z.string().describe("The record id as a string."),
  title: z.string().describe("The record's name."),
  text: z.string().describe("The whole record, in the source's words."),
  url: z.string().describe("Where the record is read, as in search."),
  metadata: z.object({
    kind: z.enum(KNOWLEDGE_KINDS),
    gameVersion: z.enum(GAME_VERSIONS),
    sourceUrl: z.string().describe("Where the record came from. Keep it with the text."),
    sourceId: z.string(),
    licence: z.string().describe("The source's licence, such as CC-BY-SA-4.0."),
    retrievedAt: z.string().describe("When the source was read."),
    credit: z.string().describe("The credit line to show with the text."),
    confirmed: z.object({ asOf: z.string().nullable() }).optional().describe("Present when player uploads confirm this game-file entry (3 or more installs agree). asOf is the date the rollup was current."),
  }),
  ...fieldReadOutput,
});
export type FetchedDocumentOut = z.infer<typeof fetchedDocument>;

/** One knowledge record as search_knowledge, get_entity and get_by_name return it. */
export const knowledgeHit = z.object({
  id: z.number().int().describe("The record id, for get_entity."),
  extId: z.string().describe("The source's own id, such as a wiki page title."),
  kind: z.enum(KNOWLEDGE_KINDS),
  name: z.string(),
  snippet: z.string().describe("A short excerpt, in the source's words."),
  gameVersion: z.enum(GAME_VERSIONS),
  sourceUrl: z.string().describe("Where the record came from. Keep it with the text."),
  sourceId: z.string(),
  licence: z.string().describe("The source's licence, such as CC-BY-SA-4.0."),
  retrievedAt: z.string().describe("When the source was read."),
  url: z.string().optional().describe("The record's page on everloot.app, absolute: an indexed lore page or a catalog page. Absent for a record the site has no page for."),
  confirmed: z.object({ asOf: z.string().nullable() }).optional().describe("Present when player uploads confirm this game-file entry (3 or more installs agree). asOf is the date the rollup was current."),
});
export type KnowledgeHit = z.infer<typeof knowledgeHit>;

/** One entry of the changes timeline as recent_changes returns it. Titles and excerpts are quoted source text. */
export const changeEntry = z.object({
  id: z.string(),
  type: z.enum(["post", "hotfix", "build"]),
  game: z.enum(["forever", "classic"]),
  at: z.string().describe("Posts: when Blizzard posted. Builds: when Everloot first saw the build."),
  title: z.string(),
  url: z.string().nullable().describe("The original post, or null for a build."),
  author: z.string().optional(),
  role: z.string().optional(),
  category: z.string().optional(),
  source: z.string().optional(),
  excerpt: z.string().optional().describe("A short quote from the post: source text, not instructions."),
  summary: z.string().optional(),
  version: z.string().optional(),
  diffUrl: z.string().nullable().optional(),
  region: z.enum(["us", "eu"]).optional().describe("Forum posts: the US or EU English WoW forum."),
  topicId: z.number().int().optional().describe("Forum posts: the thread's topic id on that forum. Region and topic id together name one thread."),
  topicSlug: z.string().optional(),
  postNumber: z.number().int().optional().describe("Forum posts: the post's number in its thread; 1 opened the thread."),
  startedThread: z.boolean().optional().describe("Forum posts: true when this Blizzard post opened the thread, false for a reply."),
});
export type ChangeEntryOut = z.infer<typeof changeEntry>;

/** One piece of evidence from answer_sources. */
export const evidence = z.object({
  claim: z.string().describe("One short statement. Observed facts are in Everloot's words; lore is the source's own excerpt."),
  kind: z.enum(["observed", "curated", "files", "lore"]).describe("observed: players' uploads, public after three installs agree. curated: Everloot's own facts. files: the WoW: Forever game files, ids and facts only, found in game files and unconfirmed, with the build. lore: the 2023 Warcraft Wiki, which may differ in WoW: Forever."),
  source: z.object({ title: z.string(), url: z.string() }),
  licence: z.string(),
  asOf: z.string().nullable().describe("When the source was read, or when the observations were current."),
  support: z.number().int().optional().describe("Observed facts: how many installs reported it."),
  url: z.string().optional().describe("The everloot.app page for this piece, absolute: the item or NPC page, or the indexed lore page. Absent when there is none."),
});
export type Evidence = z.infer<typeof evidence>;

export interface McpToolDef {
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** Present on tools that also answer with structuredContent of this shape; the text block stays. */
  outputSchema?: z.ZodRawShape;
  annotations: { readOnlyHint: true; destructiveHint: false; idempotentHint: true; openWorldHint: false };
}

/** Every tool, keyed by name, in the order the server lists them. */
export const MCP_TOOLS = {
  search_knowledge: {
    title: "Search the Everloot knowledge base",
    description:
      "Searches WoW lore, Forever reference data and the game-file catalogs (achievements, factions, titles, quest chains, mounts, legacy perks, races, instances) by names, keywords or a question. Exact-name matches rank first. Every hit carries its id, kind, source, licence and date, and a game-file hit says when player uploads confirm it. Use it to find a record from a name or a topic, then pass the hit's id to get_entity for its summary, or to fetch as a string for the whole text. Use get_by_name when you already know the exact full name, and answer_sources when you need cited evidence for a question rather than records. search is the same search in the ChatGPT connector shape.",
    inputSchema: searchArgs,
    outputSchema: { hits: z.array(knowledgeHit) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  get_entity: {
    title: "Get one knowledge record by id",
    description: "Returns one knowledge record's summary, by the numeric id a search_knowledge or get_by_name hit gave: title, a short excerpt in the source's words, the URL to cite, source, licence and date. A game-file record carries its build and says when player uploads confirm it. Use it to read one hit again by its id; for the whole text, call fetch with the same id as a string. An id no record has returns a null hit, not an error. Give field, a JSON pointer such as /questIds, to read one value of the record's data instead of the excerpt; an array comes in pages of up to 48 rows, and nextOffset says where the next page starts. A pointer that leads nowhere answers with the keys it could have used, not an error.",
    inputSchema: { id: z.number().int().describe("The numeric id of a search_knowledge or get_by_name hit."), ...fieldReadInput },
    outputSchema: { hit: knowledgeHit.nullable(), ...fieldReadOutput },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  get_by_name: {
    title: "Get records by exact name",
    description: "Returns the records whose full name matches exactly, case-insensitively, optionally narrowed to one record kind. Use it to disambiguate when you know the exact name and want the id without a ranked search; use search_knowledge for partial names, keywords or questions. Several records can share a name across kinds, so check each hit's kind. Empty hits mean no record has that exact name.",
    inputSchema: {
      name: z.string().max(200).describe("The full record name, any case, up to 200 characters."),
      kind: z.enum(KNOWLEDGE_KINDS).optional().describe(KIND_FILTER),
    },
    outputSchema: { hits: z.array(knowledgeHit) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  search: {
    title: "Search (ChatGPT connector contract)",
    description:
      "Searches the knowledge base in the shape ChatGPT connectors and deep research call by name: up to 10 results, each with an id for fetch, a title and a URL to cite. It is the same search as search_knowledge. Use it only when the client expects the search and fetch pair; other clients should call search_knowledge. The text block is the same JSON as a string.",
    inputSchema: { query: z.string().max(1000).describe("What to look up: names, questions, keywords. Question words are ignored.") },
    outputSchema: { results: z.array(searchResult) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  fetch: {
    title: "Fetch one document (ChatGPT connector contract)",
    description:
      "Returns one knowledge record in full, by the string id a search result gave: title, the full text in the source's words, the URL to cite, and metadata with the source, licence and date. It is the ChatGPT connector counterpart of get_entity, which gives only an excerpt. Use it after search, or with a search_knowledge id as a string. Give field, a JSON pointer such as /questIds, to read one value of the record's data: text then holds that value as JSON, and an array comes in pages of up to 48 rows with nextOffset for the next page. A long array in a whole record is cut at 48 rows. The text block is the same JSON as a string.",
    inputSchema: { id: z.string().max(20).describe("An id from a search result."), ...fieldReadInput },
    outputSchema: fetchedDocument.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  answer_sources: {
    title: "Evidence for a question, each piece with its source",
    description:
      "Returns the evidence behind a question about WoW: Forever, so an answer can cite it: player observations, curated facts, game files and the 2023 Warcraft Wiki. An observed fact is public after three installs agree and carries the install count; a game-file fact is found in game files, unconfirmed, with the build; lore is marked: may differ in Forever. Every piece carries a claim, its source URL, licence and date; the answer is evidence, not prose. Use it for questions that need citations, such as why, where or how many; use search_knowledge to find a record by name, and the page tools (item_page, npc_page, quest_page) for one entity's agreed facts. Further-reading links are search URLs on other sites; nothing is fetched from them. When Everloot's public player data is not connected, the observed layer is unrecorded, not empty.",
    inputSchema: {
      question: z.string().min(1).max(500).describe("The question, 1 to 500 characters, with names spelled as in the game."),
      limit: z.number().int().min(1).max(25).default(8).describe("Most lore and curated pieces, 1 to 25, default 8."),
    },
    outputSchema: {
      evidence: z.array(evidence).describe("Observed first, then curated, then lore."),
      furtherReading: z.array(z.object({ site: z.string(), url: z.string() })).describe("Search links on other sites. Nothing was fetched."),
      dataAsOf: z.string().nullable().describe("When the observed layer was current; null when it is not connected."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  profession_path: {
    title: "Profession leveling path",
    description:
      "Returns a leveling path for one Forever profession between two skill levels, built from Everloot uploads: the steps, the reagents summed and their cost. A step exists only after 3 installs agree: on a reported recipe, or on the recipe colours that make it orange (a guaranteed skill-up), starting at the trainer's required rank when 3 installs agree on one, else at the lowest rank seen orange. A price exists only after 3 price uploads agree. A skill range no agreed recipe covers is left as a gap, never invented. Use it for how to level a profession from one skill to another; use recipe_thresholds for where single recipes change colour, and market_value for what a reagent costs today. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      profession: z.string().describe("Profession name, such as Alchemy."),
      fromSkill: z.number().int().min(1).max(500).default(1).describe("Skill the character has now, 1 to 500, default 1."),
      toSkill: z.number().int().min(1).max(500).describe("Skill to stop at, 1 to 500, above fromSkill."),
    },
    outputSchema: { ...uploadsAnswer, page: professionPath.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  recipe_thresholds: {
    title: "Recipe skill ranges",
    description:
      "Returns where one Forever profession's recipes turn yellow, green and grey, as skill ranges inferred from the colours players' trade-skill windows showed, never guessed exact numbers. A recipe appears only after 3 installs agree. Agreed reagents come with an estimated cost per craft when every reagent has an agreed price. Use it for how long a recipe keeps giving skill points; use profession_path for a step-by-step route between two skill levels. Narrow the list with part of a recipe name. Reads Everloot's current public corpus.",
    inputSchema: {
      profession: z.string().describe("Profession name, such as Alchemy."),
      recipe: z.string().optional().describe("Part of a recipe name to narrow the list. Without it, every recipe of the profession."),
    },
    outputSchema: { ...uploadsAnswer, page: recipeThresholds.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  item_page: {
    title: "Item page for a drop",
    description:
      "Returns one Forever item's page by item id: the agreed name, drop frequency from observed loot windows, agreed map pins, and player-reported armor, block, damage per second, stats and resistances. A number is public when one value has 3 agreeing installs in the newest build that 3 installs reported, and no competing value has 3; contested numbers are withheld. Each number states its agreeing installs, build and last seen, with the corpus date and method. Missing numbers are [?] with a reason. No baseline rows or player names. Use it when you have an item id; use market_value for its price, entity_relations for what drops or sells it, and item_categories for its class and slot. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: { itemId: z.number().int().positive().describe("The game's item id, from a drop row, entity_relations or the extId of a search_knowledge hit of kind item.") },
    outputSchema: { ...uploadsAnswer, page: itemPage.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  npc_page: {
    title: "NPC page",
    description:
      "Returns one Forever NPC's page by NPC id: the agreed name, the agreed map pins, and the loot windows reported for it that are not yet in the drop rates. A name or pin needs 3 installs agreeing; a pin does not require a drop. No copied spawn list. Use it to name or place an NPC when you have its id, from a search_knowledge hit, a drop row or entity_relations; use vendor_page for what an NPC sells, item_page for one drop's rate, entity_relations for every typed link, and world_map_near for what stands around it. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: { npcId: z.number().int().positive().describe("The game's NPC id, from world_map_near, entity_relations or the extId of a search_knowledge hit of kind npc.") },
    outputSchema: { ...uploadsAnswer, page: npcPage.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  object_page: {
    title: "Game object page",
    description:
      "Returns one game object's page (a chest, herb, ore vein or fishing pool) by its entry id: the items players looted from it, each with observed loot windows, windows with the item and distinct install reports, and where players saw it on the minimap. A frequency is public after 3 install reports; a public object with nothing in its windows reads as a measured zero. The name shows once 3 installs agree on it. Use it for gathering nodes and containers; use npc_page for creatures, and item_page for every source of one item. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: { objectId: z.number().int().positive().describe("The object's entry id, from a world_map_near treasure, as in /database/objects/1731.") },
    outputSchema: { ...uploadsAnswer, page: objectPage.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  quest_page: {
    title: "Quest page",
    description:
      "Returns one Forever quest's page by quest id: agreed title, level, giver, turn-in and rewards. Each fact needs 3 installs agreeing. No copied quest text. Use it when you have a quest id, from a search_knowledge hit or entity_relations; use answer_sources for a question about the quest's story or chain, and entity_relations for what the quest rewards. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: { questId: z.number().int().positive().describe("The game's quest id, from entity_relations or the extId of a search_knowledge hit of kind quest.") },
    outputSchema: { ...uploadsAnswer, page: questPage.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  vendor_page: {
    title: "Vendor page",
    description:
      "Returns the goods one Forever vendor sells, by the vendor's NPC id, each with the copper price players saw. An item is listed when 3 installs agree on that item and its copper price; two agreed prices both stay listed. No copied catalog. Use it for what a vendor sells and at what price; use npc_page for where the vendor stands, entity_relations with the sold_by relation for who sells an item, and market_value for auction prices. The id is the same NPC id npc_page takes. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: { vendorNpcId: z.number().int().positive().describe("The vendor's NPC id, the id npc_page takes, from world_map_near or entity_relations.") },
    outputSchema: { ...uploadsAnswer, page: vendorPage.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  world_map_near: {
    title: "What is near a place on the map",
    description:
      `Lists the entrances, NPCs, vendors and treasures near a spot, nearest first, with straight-line distances in yards. Give a zone (name or map id) with x and y from 0 to 100, or an NPC id to start from where that NPC stands. Entrances come from the game files; one is confirmed once 3 installs zoned in from it. NPCs, vendors and treasures are player-observed and listed only where 3 installs agree on the position. Zones the files hold back as possibly unreleased are not offered. Use it for what is near a spot; use npc_page, vendor_page or entity_relations for one entity's own facts. Reads Everloot's public player data when connected.`,
    inputSchema: {
      zone: z.string().max(80).optional().describe("Zone name or map id, such as Elwynn Forest or 1429. Needs x and y."),
      x: z.number().min(0).max(100).optional().describe("Across the zone map, 0 (west) to 100 (east)."),
      y: z.number().min(0).max(100).optional().describe("Down the zone map, 0 (north) to 100 (south)."),
      npcId: z.number().int().positive().optional().describe("Start from this NPC's agreed position instead of a zone and x, y."),
      radius: z.number().positive().max(NEAR_MAX_RADIUS).default(NEAR_DEFAULT_RADIUS).describe(`Search radius in yards, up to ${NEAR_MAX_RADIUS}, default ${NEAR_DEFAULT_RADIUS}.`),
      limit: z.number().int().min(1).max(NEAR_MAX_LIMIT).default(NEAR_DEFAULT_LIMIT).describe(`Most results per list, 1 to ${NEAR_MAX_LIMIT}, default ${NEAR_DEFAULT_LIMIT}.`),
    },
    outputSchema: { ...uploadsAnswer, page: mapNear.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  entity_relations: {
    title: "How an item, NPC, spell or quest connects to others",
    description:
      "Lists every typed relation of one entity, in both directions, grouped by relation. Player-observed relations (dropped by, sold by, reward from, located in) are listed where 3 installs agree, with the install count and last seen. Game-file relations (created by, reagent for, part of set, same icon) are found in game files, unconfirmed, with the build they came from. Ids are the game's own, as a page tool, a drop row or world_map_near gives them. Use it for where something comes from or what something drops, sells or rewards; use the page tools (item_page, npc_page, quest_page) for one entity's own facts, and world_map_near for what is near a place. Reads Everloot's public player data and the game-file relations of the current build.",
    inputSchema: {
      kind: z.enum(ENTITY_KINDS).describe("What the id names. A zone is a UiMap id, as on /map."),
      id: z.number().int().positive().describe("The game's id for it, such as item 19019."),
      rel: z.enum(RELS).optional().describe("Only this relation. Without it, every relation."),
      direction: z.enum(["from", "to", "both"]).default("both").describe("from: what this entity points to (an item's sources). to: what points at it (what an NPC drops). Default both."),
      limit: z.number().int().min(1).max(100).default(25).describe("Most lines per relation, 1 to 100, default 25."),
    },
    outputSchema: { ...uploadsAnswer, page: entityRelations.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  item_categories: {
    title: "Item categories: class, subclass, slot and quality",
    description:
      "Lists item categories from the game files (found in game files, unconfirmed, with the build): class and subclass with the client's English names and slugs, slot and quality. With no arguments, the whole tree with item counts. With item, that item's category path. With class (a slug such as weapon or armor), and optionally subclass, slot and quality slugs, the item ids in it. Use it to place an item in its category or to list a category; use item_page for an item's name and stats, and entity_relations for where it comes from. Ids only: item names come from player uploads, through item_page.",
    inputSchema: {
      item: z.number().int().positive().optional().describe("An item id: answers its class, subclass, slot and quality."),
      class: z.string().max(40).optional().describe("Class slug, such as weapon, armor, consumable or trade-goods."),
      subclass: z.string().max(40).optional().describe("Subclass slug or number within the class, such as one-handed-swords or cloth."),
      slot: z.string().max(40).optional().describe("Slot slug, such as head, chest, one-hand or trinket."),
      quality: z.enum(ITEM_QUALITY_SLUGS).optional().describe("poor, common, uncommon, rare, epic, legendary, artifact or heirloom."),
      limit: z.number().int().min(1).max(100).default(25).describe("Most items listed, 1 to 100, default 25."),
    },
    outputSchema: {
      label: z.string(),
      build: z.string(),
      item: itemCategory.nullable().optional().describe("With item: its path, or null when the item is not in the build."),
      classes: z.array(z.object({
        id: z.number().int(), name: z.string(), slug: z.string(), items: z.number().int(),
        subclasses: z.array(z.object({ id: z.number().int(), name: z.string().nullable(), slug: z.string(), items: z.number().int() })),
      })).optional().describe("With no arguments: the whole tree, classes with items only."),
      items: z.array(itemCategory).optional().describe("With class: the items in the category, up to limit."),
      total: z.number().int().optional().describe("With class: how many items match, listed or not."),
      error: z.string().optional().describe("A class or subclass that is not in the build."),
      credit: z.string(),
      url: z.string().optional().describe(PAGE_URL),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  talent_tree: {
    title: "Talent trees for one class",
    description:
      "Returns the WoW: Forever talent trees of one class from the game files (found in game files, unconfirmed, with the build): every node with its talents, ranks, grid position, prerequisites and row gate, plus the levels talent points arrive at. Node ids are the ids a share code names. Use it to read or explain a class's trees; use talent_plan to decode a share code against them, and class_races for which races can be the class. Narrow to one tree by name; without it the answer holds every node of every tree. With builds, the answer also lists the Everloot team's published starter builds for the class, each labelled as the team's and not observed, with its share code and page. The answer links the calculator.",
    inputSchema: {
      class: z.enum(TALENT_CLASSES).describe("Class slug, such as mage."),
      tree: z.string().max(40).optional().describe("One tree by name, such as Arcane. Without it, every tree."),
      builds: z.boolean().default(false).describe("Also list the Everloot team's starter builds for the class, with share codes. They are the team's, not observed."),
    },
    outputSchema: {
      label: z.string(),
      build: z.string().describe("The game build the trees were read from."),
      class: z.enum(TALENT_CLASSES),
      className: z.string(),
      specId: z.number().int().describe("The client's spec id, or 0 when unknown."),
      points: z.object({
        firstPointLevel: z.number().int(),
        maxLevel: z.number().int(),
        total: z.number().int().describe("Talent points at the max level."),
        pointLevels: z.array(z.number().int()).describe("The level each point arrives at."),
      }),
      trees: z.array(z.object({ id: z.number().int(), name: z.string(), nodes: z.number().int() })),
      nodes: z.array(talentNode),
      starterBuilds: z.array(z.object({
        name: z.string(),
        purpose: z.enum(["leveling", "dungeon", "raid", "pvp"]),
        tree: z.string().describe("The tree the build leans on."),
        shareCode: z.string().describe("Reads with talent_plan."),
        points: z.number().int(),
        build: z.string().describe("The game build the code was made on."),
        url: z.string().describe("The shared build page."),
        label: z.literal("Everloot team starter build, not observed"),
      })).optional().describe("With builds: the team's published starter builds for the class (and tree), by name. Empty when none is published."),
      credit: z.string(),
      url: z.string().optional().describe(PAGE_URL),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  talent_plan: {
    title: "Read a talent share code",
    description:
      "Decodes an Everloot talent share code (EL1-<class>-<spec>-<build>-<payload>, or a calculator link carrying one after #plan=) against the class's trees: the talents and ranks it holds, points per tree, the lowest level that can hold it, and every problem in plain words: a code made on another build, nodes the tree does not have, ranks cut back, points the rules would not place. Nothing is dropped silently. Use it when given a share code or a calculator link; use talent_tree to read the trees themselves. Game-file data, found in game files, unconfirmed.",
    inputSchema: {
      code: z.string().max(2000).describe("The share code, or a link that carries one."),
    },
    outputSchema: {
      ok: z.boolean().describe("False when the code could not be read at all; message says why."),
      message: z.string().optional(),
      class: z.enum(TALENT_CLASSES).optional(),
      className: z.string().optional(),
      codeBuild: z.string().optional().describe("The game build the code was made on."),
      treeBuild: z.string().optional().describe("The build of the trees it was read against."),
      pointsSpent: z.number().int().optional(),
      minLevel: z.number().int().optional().describe("The lowest level that can hold this many points."),
      byTree: z.array(talentTreePoints).optional(),
      talents: z.array(z.object({
        id: z.number().int(), treeId: z.number().int(), name: z.string(), rank: z.number().int(), maxRanks: z.number().int(),
        choice: z.number().int().optional().describe("The chosen entry of a choice node, zero-based."),
      })).optional(),
      problems: z.array(z.string()).optional().describe("One sentence each. Empty means the code loaded exactly as made."),
      link: z.string().optional().describe("The calculator with this plan loaded."),
      label: z.string(),
      credit: z.string(),
      url: z.string().optional().describe("The build's own link on everloot.app, absolute: the calculator opened on this plan, with a preview card for sharing."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  class_races: {
    title: "Races that can be a class, with their racial traits",
    description:
      "Lists which races can be one class in WoW: Forever, on which faction, and each race's racial traits (name, active or passive) from the game files (found in game files, unconfirmed, with the build). Narrow to one faction. Use it for whether a race can be a class, or which races a class is open to; use talent_tree for the class's talents, and population for how many play it. What each trait does is on the class page, linked from the answer.",
    inputSchema: {
      class: z.string().min(1).max(40).describe("Class name or slug, such as Warlock or warlock."),
      faction: z.enum(GUILD_FACTIONS).optional().describe("alliance or horde. Without it, both."),
    },
    outputSchema: {
      label: z.string(),
      build: z.string().describe("The game build the races were read from."),
      class: z.enum(TALENT_CLASSES).optional().describe("Absent when the class is not one the files list."),
      className: z.string().optional(),
      faction: z.enum(GUILD_FACTIONS).optional(),
      factions: z.array(z.object({
        faction: z.enum(["Alliance", "Horde", "Neutral"]),
        races: z.array(z.object({
          id: z.number().int().describe("The client's race id (ChrRaces)."),
          name: z.string().describe("The race's name in the game files."),
          traits: z.array(z.object({
            name: z.string(),
            kind: z.enum(["active", "passive"]),
            order: z.number().int().describe("The order on the character screen."),
          })),
        })),
      })).describe("Alliance first. Empty when the class is unknown."),
      error: z.string().optional().describe("A class the files do not list."),
      credit: z.string(),
      url: z.string().optional().describe(PAGE_URL),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  collection_gap: {
    title: "Owned versus missing in a collection",
    description:
      "Returns what one install still misses in one collection, against what that install uploaded as owned, grouped by source. A list row is public after 3 installs agree on the collection, the source and the item; owned is what that install uploaded. Not a Blizzard profile read and not a copied catalog. Use it for which items of a collection a player is missing; use completion_progress for achievements, reputations and titles. When that install never uploaded the collection, the answer says owned is unknown, not empty. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      collection: z.string().describe("Collection name, any case, such as Mounts."),
      ownerInstallId: z.string().describe("The player's own install id, whose owned upload to compare."),
    },
    outputSchema: { ...uploadsAnswer, page: collectionGap.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  completion_progress: {
    title: "Achievement, reputation, title and quest progress",
    description:
      "Shows what one install's characters have finished and what is closest to done: achievements with the largest share of criteria or progress met, reputations nearest the next standing, titles known, and quests finished in a chain. A list entry is public after 3 players (installs uploading from different addresses) report it identically. Progress shows only when that install uploaded it with the collection sharing choice and a verified grant; without it the answer says so. Not a Blizzard profile read and not a copied catalog. Use it for what a player is closest to finishing; use collection_gap for missing collection items, and guild_board for a guild's kills. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      ownerInstallId: z.string().describe("The player's own install id, whose completion upload to read."),
      characterKey: z.string().max(8).optional().describe("One character's 8-digit key from the upload, when the install has several. Without it, every character."),
    },
    outputSchema: { ...uploadsAnswer, page: completionProgress.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  guild_board: {
    title: "Guild board its officers published",
    description:
      "Returns one guild's roster, bosses killed, loot awarded, raid attendance and average item level, as that guild's own officers chose to publish them, with its kills per instance and its rank. The officer board (roster, bosses, loot, attendance, item level) counts only uploads from officers holding a verified grant for the guild, and a figure is public after 2 of them agree. When Everloot's guild pages are connected, the public part follows: kills per instance (a kill counts once 2 members' installs report the same boss, or when the officers publish it), the guild's rank, and the characters players running the addon saw in the guild, with level, class and last seen. Names are in-game character names, never accounts or real-world identities. A character's owner can opt out, which leaves that character out of the roster, loot and attendance. A guild whose officers have not published gets an empty officer board and still shows the public part; a guild that asked to be hidden gets no answer. The average item level says how many roster members were measured; there is no combined score. Use it for one guild's own board; use guild_search to find a guild's exact name and realm, and guild_rankings to compare guilds in one instance. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      guildName: z.string().describe("The guild's in-game name, as guild_search gives it."),
      realm: z.string().describe("The guild's realm, as guild_search gives it."),
    },
    outputSchema: { ...uploadsAnswer, page: guildBoard.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  guild_search: {
    title: "Find a guild by the start of its name",
    description:
      "Finds the guilds whose name starts with what you typed, each with its realm, faction, how many characters the addon saw in it, and the count and date of its agreed boss kills. A guild is listed once 2 of its members' installs report the same boss, once its officers published a board, or once a character was seen in it. Guild names only, never a member's name, and a guild that asked to be hidden is left out. Characters seen are counted only when the player pages are connected; otherwise the count is unrecorded, not zero. Use it to find a guild's exact name and realm before guild_board; use guild_rankings for a ladder. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      query: z.string().min(2).max(24).describe("The start of the guild's name, 2 to 24 characters."),
      limit: z.number().int().min(1).max(25).default(10).describe("Most guilds listed, 1 to 25, default 10."),
    },
    outputSchema: { ...uploadsAnswer, page: guildSearch.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  guild_rankings: {
    title: "Guild ladder for one raid or dungeon",
    description:
      "Ranks every guild with an agreed kill in one instance: by bosses killed, then by who reached its latest kill first, then by name; equal rows share a rank. A kill is a guild's once 2 of its members' installs report the same boss there, timed at the earliest report, or once its officers published it on the guild board, which carries no time. The boss list is the encounters 3 installs reported in that instance, in that order; a boss not on it counts for nothing. There is no score, no rating and no total across instances. Use it to compare guilds' progress in one raid or dungeon; use guild_board for one guild's own board, and guild_search to find a guild. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      instanceMapId: z.number().int().positive().optional().describe("The instance's map id: the extId of a search_knowledge hit of kind instance. Omit for the newest raid with a kill."),
      realm: z.string().max(60).optional().describe("Only guilds on this realm. Without it, every realm."),
      faction: z.enum(GUILD_FACTIONS).optional().describe("Only alliance or horde guilds. Without it, both."),
      limit: z.number().int().min(1).max(100).default(20).describe("Most guilds listed, 1 to 100, default 20."),
    },
    outputSchema: { ...uploadsAnswer, page: guildRankings.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  auction_history: {
    title: "Auction history for one item",
    description:
      "Returns the day-by-day price history of one item on one WoW: Forever realm, from auction scans players uploaded on purpose: the public full-scan days market_value values the item by, and the single listings players saw while browsing. Both follow the market's rule: a day is public after 3 reporters scanned the item, or, while few players upload, when Everloot's own installs did, and its reporters say so. Use it for how a price moved over time; use market_value for today's market value, minimum buyout and units listed, item_page for the item itself, and vendor_page for vendor prices. The realm is read as market_value reads it: an unknown or ambiguous name answers with the realms to ask with, never an empty history. The item id is the game's. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      realm: z.string().describe(REALM_INPUT),
      itemId: z.number().int().positive().describe("The game's item id, as item_page takes it."),
    },
    outputSchema: { ...uploadsAnswer, page: auctionHistory.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  market_value: {
    title: "Forever market value for one item",
    description:
      "Returns the market value, minimum buyout, historical value and units listed for one item on one WoW: Forever realm, from full auction scans players started and uploaded. A day is public after 3 reporters (distinct upload addresses) scanned the item, or, while few players upload, when Everloot's own installs did, and its reporters say so; its value is the median of theirs. Market value is a weighted mean of the public days up to 14 calendar days old, newer days weighing more, leaving out thin days (5 units listed or fewer) and outlier days. Historical is the median of the public days in the last 60 calendar days, of the days that are not thin when there are any. Use it for what an item is worth now; use auction_history for the price over time, and vendor_page for vendor prices. The realm is its full name as the game's realm list shows it. A name that is the end of exactly one realm's full name is read as that realm, and the answer says so; a name that ends several, or none, answers ambiguous or unknown with the realms to ask with, never an empty market. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      realm: z.string().describe(REALM_INPUT),
      itemId: z.number().int().positive().describe("The game's item id, as item_page takes it."),
    },
    outputSchema: { ...uploadsAnswer, page: marketPage.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  gold_ledger: {
    title: "Gold ledger for one character",
    description:
      "Returns the peak and current gold of one character and the money events its own upload recorded: income (loot, quests, vendor and auction sales) and spending (flight paths, postage, barber, respecs, auction purchases), each install's ledger kept apart. A category with nothing recorded reads as unrecorded, not zero, and gold from other gameplay is unrecorded. The gap between recorded income and peak gold is shown as unrecorded, never called bought gold or a ban. Use it for one uploaded character's own gold history; it cannot look up a character that never uploaded. Use guild_board for a guild's loot, and market_value for prices. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      character: z.string().describe("The character's in-game name."),
      realm: z.string().describe("The character's realm, as the game shows it."),
    },
    outputSchema: { ...uploadsAnswer, page: goldLedger.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  coverage: {
    title: "Database coverage by zone, type and field",
    description:
      "Counts how much of WoW: Forever's database is settled or confirmed, per zone, per type and per field, as https://everloot.app/database/coverage shows it, in text only. Coverage is settled over expected, with confirmed over expected beside it; the denominator is the larger of expected and observed, and confirmed includes settled. A player-reported fact is public after three installs agree; fields one or two installs short are counted without their values. Scoped totals and the current build's settled-list size come separately dated and measured. Only public report identifiers and game-file facts are listed, never unconfirmed values, baseline rows, names or ids, or player names. When coverage data is available, every answer states its scope, method, data date and install counts; when it is not, the answer states the scope and marks the counts, data date and installs [?], not zero. Unknown values are [?]. Use it for how complete the database is for a zone or type; use the page tools for the facts themselves.",
    inputSchema: {
      zone: z.number().int().positive().optional().describe("Released UiMap zone id, such as 1429 for Elwynn Forest. Omit for all released zones."),
      type: z.enum(["quests", "npcs", "pins", "vendors", "drops", "rares", "entrances", "bosses", "treasures"]).optional().describe("Coverage type. Omit for all types."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  population: {
    title: "Who plays what: population by race, class, faction and level",
    description:
      "Counts how many characters play each race, class, race and class, faction and level band on WoW: Forever, from the census players turned on in the Everloot addon. Each character counts once. A count shows only when it covers at least 10 characters reported by at least 3 installs from at least 3 addresses, rounded to the nearest 5; a count that could be worked out from the others is hidden too. When census data is available, every answer states its window: active in the last 7 days (default) or since launch; when it is not, the answer says so instead of giving a zero. With no arguments, the overview, most played class first. Use it for how many play a race or class; use class_races for which races can be a class. No names, ever. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      race: z.string().max(40).optional().describe("A race, such as Gnome, Night Elf or Undead. Without it, every race."),
      class: z.string().max(40).optional().describe("A class, such as Priest. Without it, every class."),
      faction: z.enum(CENSUS_FACTIONS).optional().describe("Alliance or Horde. Without it, both."),
      window: z.enum(CENSUS_WINDOWS).default("week").describe("week (default): active in the last 7 days. launch: seen since launch."),
    },
    outputSchema: { ...uploadsAnswer, page: populationPage.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  recent_changes: {
    title: "Recent official changes for WoW: Forever",
    description:
      "Returns the newest official changes for WoW: Forever, newest first: Blizzard blue posts (title, author, time, a short excerpt and the link to the original), hotfix posts, and new game builds. Excerpts only: Blizzard's post text is Blizzard's; full posts are available at their source URLs. A build's time is when Everloot first saw it, not Blizzard's release time. Use it for what Blizzard changed or posted lately; use answer_sources for lore and game facts, and ecosystem_projects for community addons. filter picks one kind; limit caps the entries.",
    inputSchema: {
      filter: z.enum(CHANGE_FILTERS).default("all").describe("posts (blue posts), hotfixes, builds, or all (default)."),
      game: z.enum(["forever", "classic"]).optional().describe("forever or classic. Without it, both."),
      limit: z.number().int().min(1).max(25).default(10).describe("Most entries, 1 to 25, default 10, newest first."),
    },
    outputSchema: {
      connected: z.boolean().describe("False when the timeline is not connected: the list is then not a measured zero."),
      entries: z.array(changeEntry),
      url: z.string().optional().describe("The changes page on everloot.app with the same filter, absolute."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  ecosystem_projects: {
    title: "WoW: Forever addons and open-source projects",
    description:
      "Lists the Forever addons and tools in the community registry, with a board ranking: most installed, rising, most active, freshest release or best maintained. Each project shows its GitHub repository, stars, latest release, last commit, whether its .toc declares a Forever interface number, and installs from Everloot uploads (counted from 3 installs; a missing count means not counted, not zero). Projects are ranked, never people. GitHub facts carry the time they were refreshed. Use it for which Forever addons exist and how maintained they are; use everloot_plan for Everloot's own features, and recent_changes for Blizzard's posts. limit caps the projects listed.",
    inputSchema: {
      board: z.enum(ECOSYSTEM_BOARD_FILTERS).default("all").describe("installed, rising, active, release, maintained, or all (default, A to Z)."),
      forever_ready_only: z.boolean().optional().describe("Only projects whose .toc lists a Forever interface number. Default false."),
      limit: z.number().int().min(1).max(25).default(10).describe("Most projects listed, 1 to 25, default 10."),
    },
    outputSchema: {
      connected: z.boolean().describe("False when the tracker is not connected: the list is then not a measured zero."),
      refreshedAt: z.string().nullable().describe("When the GitHub facts were last refreshed."),
      installsAvailable: z.boolean().describe("False when install counts could not be read: a null count then means unknown."),
      forever: z.object({ interface: z.number().int(), version: z.string(), build: z.number().int() }).nullable()
        .describe("What Forever-ready compares each .toc with, derived from the build's version and not yet confirmed in the client."),
      board: z.enum(ECOSYSTEM_BOARD_FILTERS),
      projects: z.array(ecosystemProject),
      url: z.string().optional().describe(PAGE_URL),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  everloot_plan: {
    title: "Everloot implementation tracker",
    description:
      "Returns the Everloot feature catalogue: what is live, what is next, what is waiting, and which reference sites are page shapes only, as the tracker that ships with the site holds it. Use it only for questions about Everloot itself, such as whether a feature exists; it holds no game data. For game facts use search_knowledge or answer_sources; for community addons use ecosystem_projects. Takes no arguments and needs no account.",
    inputSchema: {},
    outputSchema: {
      rows: z.array(planRow).describe("Every row, in the tracker's order."),
      counts: z.object({ live: z.number().int(), next: z.number().int(), waiting: z.number().int(), shape: z.number().int() }),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
} as const satisfies Record<string, McpToolDef>;

export type McpToolName = keyof typeof MCP_TOOLS;
/** The parsed arguments one tool receives, defaults applied. */
export type McpToolArgs<K extends McpToolName> = z.infer<z.ZodObject<(typeof MCP_TOOLS)[K]["inputSchema"]>>;
/** The names in the order the server lists them. */
export const MCP_TOOL_NAMES = Object.keys(MCP_TOOLS) as McpToolName[];
/** The list form, for clients that iterate. */
export const MCP_TOOL_LIST = MCP_TOOL_NAMES.map((name) => ({ name, ...MCP_TOOLS[name] }));

/**
 * The last line of an answer built on player data: how old the data is, "Data as of 2026-10-22 06:30 UTC.",
 * or `unrecorded` when the snapshot carries no time.
 */
export const DATA_AGE = { prefix: "Data as of ", unrecorded: "Data age unrecorded." } as const;
/**
 * What every tool returns: one text content block. Answers built on player data end with how old the
 * data is (DATA_AGE). Tools that read nothing from players carry their sources inside the text instead.
 * Tools with an outputSchema also return structuredContent of that shape (STRUCTURED_TOOLS lists them;
 * coverage is text only). When one everloot.app page shows the answer, its structured `url` holds it and
 * the text carries a `More: <url>` line, last before the data age: that link is how the answer is
 * credited. The licence and credit line travel in the response headers, not in each answer.
 */
export const TOOL_OUTPUT = { type: "text", lastLine: DATA_AGE } as const;
/** The tools that answer with structuredContent beside the text. */
export const STRUCTURED_TOOLS: readonly McpToolName[] = MCP_TOOL_NAMES.filter((name) => "outputSchema" in MCP_TOOLS[name]);
/** The two tools of OpenAI's connector contract: their text block is the structured answer as a JSON string, not prose. */
export const CHATGPT_TOOLS: readonly McpToolName[] = ["search", "fetch"];
/** The tools whose answers are built on player uploads and therefore end with TOOL_OUTPUT.lastLine. */
export const PLAYER_DATA_TOOLS: readonly McpToolName[] = [
  "answer_sources", "profession_path", "recipe_thresholds", "item_page", "npc_page", "object_page", "quest_page", "vendor_page",
  "world_map_near", "entity_relations", "collection_gap", "completion_progress", "guild_board", "guild_search", "guild_rankings", "auction_history",
  "market_value", "gold_ledger", "population", "coverage",
];

/**
 * The server's resources: documents a client reads whole with resources/read, as opposed to tools it
 * calls with arguments. Static URIs, no templates. kb/src/mcp-server.ts registers from this table and
 * supplies the contents; the connect page and llms.txt list from it.
 */
export interface McpResourceDef {
  /** The short name clients show in a picker. */
  name: string;
  title: string;
  description: string;
  mimeType: "application/json" | "text/markdown";
}

/** One game build as the version service listed it. Everloot records identifiers only, never game files. */
export const buildEntry = z.object({
  key: z.string().describe("product:buildConfig, the build's identity."),
  product: z.string().describe("Blizzard's product id, such as wow_classic_beta."),
  buildConfig: z.string(),
  buildId: z.number().int(),
  version: z.string().describe("The version label, such as 1.60.1.70450."),
  regions: z.array(z.string()),
  firstSeen: z.string().describe("When Everloot first saw the build, not Blizzard's release time."),
  lastSeen: z.string(),
  status: z.enum(["queued", "processed"]),
});
export type BuildEntryOut = z.infer<typeof buildEntry>;

/** What everloot://builds holds. */
export const buildsResource = z.object({
  gameFiles: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable().describe("The WoWDBDefs commit the column names came from."),
    extractedAt: z.string(),
  }).describe("The build the game-file facts (entity_relations, item_categories) were read from."),
  registry: z.array(buildEntry).describe("Every build the version service has listed, newest first."),
  credit: z.string().describe("Game-file facts are Blizzard's, not under Everloot's licence."),
});
export type BuildsResource = z.infer<typeof buildsResource>;

/** Every resource, keyed by URI, in the order the server lists them. */
export const MCP_RESOURCES = {
  "everloot://builds": {
    name: "builds",
    title: "Game builds Everloot knows",
    description:
      "The build the game-file facts come from, and every build Blizzard's version service has listed, with when Everloot first saw it. JSON of the shape in schema/mcp/resources.json.",
    mimeType: "application/json",
  },
  "everloot://methodology": {
    name: "methodology",
    title: "How Everloot counts",
    description:
      "How player uploads become facts: three installs must agree, unrecorded is never zero, game files and play are kept apart, and what is never published. Read it before stating a number as certain.",
    mimeType: "text/markdown",
  },
  "everloot://data-policy": {
    name: "data-policy",
    title: "Everloot data policy",
    description:
      "Where the data comes from, what is refused, the licence and credit line, and the limits on bulk copying, in short, with the link to the full policy.",
    mimeType: "text/markdown",
  },
} as const satisfies Record<string, McpResourceDef>;

/**
 * The server's prompts: a client offers them as commands, fills the arguments, and gets a user message
 * that tells an assistant how to use the tools for that job. Argument values are strings, as MCP has them.
 */
export interface McpPromptDef {
  title: string;
  description: string;
  /** `values`, when present, are the only values the argument takes; the server offers them through completion/complete. */
  arguments: Record<string, { description: string; required: boolean; values?: readonly string[] }>;
}

/** Every prompt, keyed by name, in the order the server lists them. kb/src/prompts.ts holds the messages. */
export const MCP_PROMPTS = {
  answer_with_sources: {
    title: "Answer with Everloot's sources",
    description: "Answer a question about WoW: Forever from answer_sources, citing each piece of evidence with its source, licence and date, and saying unrecorded where the evidence is.",
    arguments: { question: { description: "The question, in the player's words.", required: true } },
  },
  review_talent_plan: {
    title: "Review a talent share code",
    description: "Read a share code with talent_plan and the class's trees with talent_tree, then describe the build, its level and every problem in plain words.",
    arguments: { code: { description: "An EL1 share code, or a calculator link that carries one.", required: true } },
  },
  what_changed: {
    title: "What changed in WoW: Forever",
    description: "Summarize recent_changes, newest first: Blizzard posts, hotfixes and builds, each with its link, quoting only the excerpt the tool gives.",
    arguments: { game: { description: "forever or classic. Without it, both.", required: false, values: ["forever", "classic"] } },
  },
} as const satisfies Record<string, McpPromptDef>;

export type McpPromptName = keyof typeof MCP_PROMPTS;
/** The names in the order the server lists them. */
export const MCP_PROMPT_NAMES = Object.keys(MCP_PROMPTS) as McpPromptName[];
/** The list form, for clients that iterate. */
export const MCP_PROMPT_LIST = MCP_PROMPT_NAMES.map((name) => ({ name, ...MCP_PROMPTS[name] }));

/**
 * Resource templates: one URI per entity, read with resources/read, answering with the JSON a tool's
 * structuredContent holds for that entity. The variable is passed to the tool as the named argument.
 */
export interface McpResourceTemplateDef {
  name: string;
  title: string;
  description: string;
  mimeType: "application/json";
  /** The tool whose structured answer the resource holds. */
  tool: McpToolName;
  /** The template variable, and the tool argument it fills. */
  variable: string;
  argument: string;
  /** When the variable has a known finite set of values, the server lists one resource per value and completes the variable from them. */
  values?: readonly string[];
}

export const MCP_RESOURCE_TEMPLATES = {
  "everloot://item/{id}": { name: "item", title: "One item's page", description: "The item_page answer for an item id: agreed name, drop rates with loot-window counts, map pins.", mimeType: "application/json", tool: "item_page", variable: "id", argument: "itemId" },
  "everloot://npc/{id}": { name: "npc", title: "One NPC's page", description: "The npc_page answer for an NPC id: agreed name and map pins.", mimeType: "application/json", tool: "npc_page", variable: "id", argument: "npcId" },
  "everloot://quest/{id}": { name: "quest", title: "One quest's page", description: "The quest_page answer for a quest id: title, level, giver, turn-in and rewards.", mimeType: "application/json", tool: "quest_page", variable: "id", argument: "questId" },
  "everloot://vendor/{id}": { name: "vendor", title: "One vendor's goods", description: "The vendor_page answer for a vendor NPC id: what it sells, with copper prices.", mimeType: "application/json", tool: "vendor_page", variable: "id", argument: "vendorNpcId" },
  "everloot://object/{id}": { name: "object", title: "One game object's page", description: "The object_page answer for an object's entry id: what players looted from it.", mimeType: "application/json", tool: "object_page", variable: "id", argument: "objectId" },
  "everloot://talents/{class}": { name: "talents", title: "One class's talent trees", description: "The talent_tree answer for a class slug: every node with its talents, ranks, position, prerequisites and gate.", mimeType: "application/json", tool: "talent_tree", variable: "class", argument: "class", values: TALENT_CLASSES },
} as const satisfies Record<string, McpResourceTemplateDef>;

export type McpResourceTemplateUri = keyof typeof MCP_RESOURCE_TEMPLATES;
export const MCP_RESOURCE_TEMPLATE_URIS = Object.keys(MCP_RESOURCE_TEMPLATES) as McpResourceTemplateUri[];
export const MCP_RESOURCE_TEMPLATE_LIST = MCP_RESOURCE_TEMPLATE_URIS.map((uriTemplate) => ({ uriTemplate, ...MCP_RESOURCE_TEMPLATES[uriTemplate] }));

export type McpResourceUri = keyof typeof MCP_RESOURCES;
/** The URIs in the order the server lists them. */
export const MCP_RESOURCE_URIS = Object.keys(MCP_RESOURCES) as McpResourceUri[];
/** The list form, for clients that iterate. */
export const MCP_RESOURCE_LIST = MCP_RESOURCE_URIS.map((uri) => ({ uri, ...MCP_RESOURCES[uri] }));
