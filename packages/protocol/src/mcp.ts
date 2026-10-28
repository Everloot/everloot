import { z } from "zod";
import { MCP_CREDIT } from "./attribution.js";
import { ITEM_FACTS } from "./records.js";

/**
 * The Everloot MCP server's tools: names, titles, descriptions, input schemas and annotations, in the
 * order the server lists them. kb/src/mcp-server.ts registers from this table and supplies the handlers;
 * the connect page and llms.txt list from it; schema/mcp/<tool>.json is generated from it. Every tool
 * is read-only. Today every tool answers with one text block (TOOL_OUTPUT); structured output is a later
 * minor release, tool by tool.
 */

/** Record kinds in the knowledge release (lore and reference data). */
export const KNOWLEDGE_KINDS = ["item", "npc", "object", "quest", "zone", "spell", "lore_page", "creator", "realm"] as const;
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

export const auctionHistory = z.object({
  realm: z.string(),
  itemId: z.number().int(),
  points: z.array(z.object({
    day: z.string(),
    copper: z.number().int().describe("The median of the last scan from each install that day."),
    reporters: z.number().int(),
  })).describe("Days 3 installs scanned the item on the realm, oldest first."),
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
  value: marketValue.nullable().describe("Null until 3 reporters scanned the item on the realm."),
  history: z.array(z.object({ day: z.string(), min: z.number().int(), market: z.number().int(), quantity: z.number().int(), reporters: z.number().int(), thin: z.boolean() })),
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

const searchArgs = {
  query: z.string().max(1000).describe("What to look up: names, questions, keywords. Question words are ignored."),
  kind: z.enum(KNOWLEDGE_KINDS).optional().describe("Narrow to one record kind."),
  version: z.enum(GAME_VERSIONS).optional().describe("Narrow to one game version."),
  limit: z.number().int().min(1).max(25).default(8),
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
  }),
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
  url: z.string().optional().describe("The record's page on everloot.app, absolute: an indexed lore page. Absent for a record the site has no page for."),
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
  annotations: { readOnlyHint: true; openWorldHint: false };
}

/** Every tool, keyed by name, in the order the server lists them. */
export const MCP_TOOLS = {
  search_knowledge: {
    title: "Search the Everloot knowledge base",
    description:
      "Search WoW lore and Forever reference data. Exact-name matches rank first. Every hit carries its source and licence.",
    inputSchema: searchArgs,
    outputSchema: { hits: z.array(knowledgeHit) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  get_entity: {
    title: "Get one knowledge record by id",
    description: "Fetch the full record behind a search hit id, for page rendering.",
    inputSchema: { id: z.number().int().describe("Record id from a search_knowledge hit.") },
    outputSchema: { hit: knowledgeHit.nullable() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  get_by_name: {
    title: "Get records by exact name",
    description: "Exact full-name match (case-insensitive) for disambiguation.",
    inputSchema: {
      name: z.string().max(200).describe("Full record name."),
      kind: z.enum(KNOWLEDGE_KINDS).optional().describe("Narrow to one record kind."),
    },
    outputSchema: { hits: z.array(knowledgeHit) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  search: {
    title: "Search (ChatGPT connector contract)",
    description:
      "The same search as search_knowledge, in the shape ChatGPT connectors and deep research call by name: up to 10 results, each with an id for fetch, a title and a URL to cite. The text block is the same JSON as a string.",
    inputSchema: { query: z.string().max(1000).describe("What to look up: names, questions, keywords. Question words are ignored.") },
    outputSchema: { results: z.array(searchResult) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  fetch: {
    title: "Fetch one document (ChatGPT connector contract)",
    description:
      "One knowledge record by the id a search result gave, whole: title, the full text in the source's words, the URL to cite, and metadata with the source, licence and date. The text block is the same JSON as a string.",
    inputSchema: { id: z.string().max(20).describe("An id from a search result.") },
    outputSchema: fetchedDocument.shape,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  answer_sources: {
    title: "Evidence for a question, each piece with its source",
    description:
      "The evidence behind a question about WoW: Forever, for an answer that cites its sources: facts players observed (public after three installs agree, with the install count), curated facts, and the 2023 Warcraft Wiki (marked: may differ in Forever). Every piece carries a claim, its source URL, licence and date. Returns evidence rather than prose. Further-reading links are search URLs on other sites; nothing is fetched from them. Reads Everloot's current authorized public corpus when connected; when it is not, the observed layer is unrecorded, not empty.",
    inputSchema: {
      question: z.string().min(1).max(500).describe("The question, with names spelled as in the game."),
      limit: z.number().int().min(1).max(25).default(8).describe("Most lore and curated pieces."),
    },
    outputSchema: {
      evidence: z.array(evidence).describe("Observed first, then curated, then lore."),
      furtherReading: z.array(z.object({ site: z.string(), url: z.string() })).describe("Search links on other sites. Nothing was fetched."),
      dataAsOf: z.string().nullable().describe("When the observed layer was current; null when it is not connected."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  profession_path: {
    title: "Profession leveling path",
    description:
      "Leveling path for one Forever profession from Everloot uploads. A step exists only after 3 installs agree: on a reported recipe, or on the recipe colours that make it orange (a guaranteed skill-up), starting at the trainer's required rank. Gold exists only after 3 price uploads agree. No copied guide. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      profession: z.string().describe("Profession name, such as Alchemy."),
      fromSkill: z.number().int().min(1).max(500).default(1).describe("Skill the character has now."),
      toSkill: z.number().int().min(1).max(500).describe("Skill to stop at. Must be above fromSkill."),
    },
    outputSchema: { ...uploadsAnswer, page: professionPath.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  recipe_thresholds: {
    title: "Recipe skill ranges",
    description:
      "Where a Forever profession's recipes turn yellow, green and grey, inferred from the colours players' trade-skill windows showed. A recipe appears only after 3 installs agree, as ranges, never guessed exact numbers. Agreed reagents come with an estimated cost per craft when every reagent has an agreed price. Reads Everloot's current public corpus.",
    inputSchema: {
      profession: z.string().describe("Profession name, such as Alchemy."),
      recipe: z.string().optional().describe("Optional part of a recipe name to narrow the list."),
    },
    outputSchema: { ...uploadsAnswer, page: recipeThresholds.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  item_page: {
    title: "Item page for a drop",
    description:
      "One Forever item: agreed name, observed loot-window drop frequency, agreed map pins, and player-reported armor, block, damage per second, stats and resistances. Each item number needs one value with 3 agreeing installs in the newest build with 3 reporting installs, and no competing value with 3; contested values are withheld. Each number states its agreeing installs, build and last seen, with the corpus date and method. Missing numbers are [?] with a reason. No baseline rows or player names. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: { itemId: z.number().int().positive().describe("Item id from a drop row.") },
    outputSchema: { ...uploadsAnswer, page: itemPage.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  npc_page: {
    title: "NPC page",
    description:
      "One Forever NPC: agreed name and map pins, and loot windows reported but not yet in the rates. A name or pin needs 3 installs agreeing. The pin does not require a drop. No copied spawn list. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: { npcId: z.number().int().positive().describe("NPC id.") },
    outputSchema: { ...uploadsAnswer, page: npcPage.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  object_page: {
    title: "Game object page",
    description:
      "One game object (a chest, herb, ore vein or fishing pool) by the id in its GUID: the items players looted from it, each with observed loot windows, windows with the item and distinct install reports. A frequency is public after 3 install reports; a public object with nothing in its windows reads as a measured zero. The name is shown when 3 installs agree on it. Reads Everloot's current authorized public corpus when connected.",
    inputSchema: { objectId: z.number().int().positive().describe("The object's entry id, as in /database/objects/1731.") },
    outputSchema: { ...uploadsAnswer, page: objectPage.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  quest_page: {
    title: "Quest page",
    description:
      "One Forever quest: agreed title, level, giver, turn-in, and rewards. Each fact needs 3 installs agreeing. No copied quest text. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: { questId: z.number().int().positive().describe("Quest id.") },
    outputSchema: { ...uploadsAnswer, page: questPage.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  vendor_page: {
    title: "Vendor page",
    description:
      "Goods one Forever vendor sells. An item is listed when 3 installs agree on that item and its copper price. Two agreed prices both stay listed. No copied catalog. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: { vendorNpcId: z.number().int().positive().describe("Vendor NPC id.") },
    outputSchema: { ...uploadsAnswer, page: vendorPage.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  world_map_near: {
    title: "What is near a place on the map",
    description:
      `Entrances, NPCs, vendors and treasures near a spot, nearest first, with straight-line distances in yards. Give a zone (name or map id) with x and y from 0 to 100, or an NPC id to start from where that NPC stands. Entrances come from the game files; one is confirmed once 3 installs zoned in from it. NPCs, vendors and treasures are player-observed and listed only where 3 installs agree on the position. Zones the files hold back as possibly unreleased are not offered. Reads Everloot's current authorized public corpus when connected.`,
    inputSchema: {
      zone: z.string().max(80).optional().describe("Zone name or map id, such as Elwynn Forest or 1429. Needs x and y."),
      x: z.number().min(0).max(100).optional().describe("Across the zone map, 0 (west) to 100 (east)."),
      y: z.number().min(0).max(100).optional().describe("Down the zone map, 0 (north) to 100 (south)."),
      npcId: z.number().int().positive().optional().describe("Start from this NPC's agreed position instead of a zone and x, y."),
      radius: z.number().positive().max(NEAR_MAX_RADIUS).default(NEAR_DEFAULT_RADIUS).describe("Search radius in yards."),
      limit: z.number().int().min(1).max(NEAR_MAX_LIMIT).default(NEAR_DEFAULT_LIMIT).describe("Most results per list."),
    },
    outputSchema: { ...uploadsAnswer, page: mapNear.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  entity_relations: {
    title: "How an item, NPC, spell or quest connects to others",
    description:
      `Every typed relation of one entity, both directions: dropped by, sold by, reward from, located in (player-observed, listed where 3 installs agree, with the install count and last seen), and created by, reagent for, part of set, same icon (found in game files, unconfirmed, with the build they came from). Ids are the game's own. Reads Everloot's current authorized public corpus and the committed client layer.`,
    inputSchema: {
      kind: z.enum(ENTITY_KINDS).describe("What the id names. A zone is a UiMap id, as on /map."),
      id: z.number().int().positive().describe("The game's id for it, such as item 19019."),
      rel: z.enum(RELS).optional().describe("Only this relation."),
      direction: z.enum(["from", "to", "both"]).default("both").describe("from: what this entity points to (an item's sources). to: what points at it (what an NPC drops). Default both."),
      limit: z.number().int().min(1).max(100).default(25).describe("Most lines per relation."),
    },
    outputSchema: { ...uploadsAnswer, page: entityRelations.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  item_categories: {
    title: "Item categories: class, subclass, slot and quality",
    description:
      `Item categories from the game files (found in game files, unconfirmed, with the build): class and subclass with the client's English names and slugs, slot and quality. With no arguments, the whole tree with item counts. With item, that item's category path. With class (a slug such as weapon or armor), and optionally subclass, slot and quality slugs, the items in it. Ids only: item names come from player uploads (item_page).`,
    inputSchema: {
      item: z.number().int().positive().optional().describe("An item id: answers its class, subclass, slot and quality."),
      class: z.string().max(40).optional().describe("Class slug, such as weapon, armor, consumable or trade-goods."),
      subclass: z.string().max(40).optional().describe("Subclass slug or number within the class, such as one-handed-swords or cloth."),
      slot: z.string().max(40).optional().describe("Slot slug, such as head, chest, one-hand or trinket."),
      quality: z.enum(ITEM_QUALITY_SLUGS).optional().describe("poor, common, uncommon, rare, epic, legendary, artifact or heirloom."),
      limit: z.number().int().min(1).max(100).default(25).describe("Most items listed."),
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
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  talent_tree: {
    title: "Talent trees for one class",
    description:
      "The WoW: Forever talent trees of one class from the game files (found in game files, unconfirmed, with the build): every node with its talents, ranks, grid position, prerequisites and row gate, plus the levels talent points arrive at. Node ids are the ids a share code names. Narrow to one tree by name. The calculator is at /tools/talents/<class>.",
    inputSchema: {
      class: z.enum(TALENT_CLASSES).describe("Class slug."),
      tree: z.string().max(40).optional().describe("One tree by name, such as Arcane. Without it, every tree."),
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
      credit: z.string(),
      url: z.string().optional().describe(PAGE_URL),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  talent_plan: {
    title: "Read a talent share code",
    description:
      "Decodes an Everloot talent share code (EL1-<class>-<spec>-<build>-<payload>, or a calculator link carrying one after #plan=) against the class's trees: the talents and ranks it holds, points per tree, the lowest level that can hold it, and every problem in plain words: a code made on another build, nodes the tree does not have, ranks cut back, points the rules would not place. Nothing is dropped silently. Game-file data, found in game files, unconfirmed.",
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
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  class_races: {
    title: "Races that can be a class, with their racial traits",
    description:
      "Which races can be one class in WoW: Forever, on which faction, and each race's racial traits (name, active or passive) from the game files (found in game files, unconfirmed, with the build). Narrow to one faction. What each trait does is on the class page, linked from the answer.",
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
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  collection_gap: {
    title: "Owned versus missing in a collection",
    description:
      "Missing items in one collection for one install. A list row is public after 3 installs agree on the collection, the source, and the item. Owned is what that install uploaded. Not a Blizzard profile read and not a copied catalog. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      collection: z.string().describe("Collection name, such as Mounts."),
      ownerInstallId: z.string().describe("Install id whose owned upload to compare."),
    },
    outputSchema: { ...uploadsAnswer, page: collectionGap.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  completion_progress: {
    title: "Achievement, reputation, title and quest progress",
    description:
      "What one install's characters have finished, and what is closest to done: achievements with the largest share of criteria or progress met, reputations nearest the next standing, titles known, and quests finished in a chain. A list entry is public after 3 players (installs uploading from different addresses) report it identically. Progress is shown only when that install uploaded it with the collection sharing choice and a verified grant; without it the answer says so. Not a Blizzard profile read and not a copied catalog. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      ownerInstallId: z.string().describe("Install id whose completion upload to read."),
      characterKey: z.string().max(8).optional().describe("One character's 8-digit key from the upload, when the install has several."),
    },
    outputSchema: { ...uploadsAnswer, page: completionProgress.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  guild_board: {
    title: "Guild board its officers published",
    description:
      "One guild's roster, bosses killed, loot awarded, raid attendance and average item level, as that guild's own officers chose to publish them. Only uploads from officers holding a verified grant for the guild count, and a figure is public after 2 of them agree. Names are in-game character names, never accounts or real-world identities. A character's owner can opt out, and an opted-out character is left out of the roster, loot and attendance. A guild whose officers have not published gets an empty board; the tool does not look up other players or guilds. The average names how many roster members were measured; there is no combined score. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      guildName: z.string().describe("Guild name."),
      realm: z.string().describe("Realm name."),
    },
    outputSchema: { ...uploadsAnswer, page: guildBoard.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  guild_search: {
    title: "Find a guild by the start of its name",
    description:
      "Guilds whose name starts with what you typed, each with its realm, faction, how many characters the addon saw in it, and the count and date of its agreed boss kills. A guild is listed once its members' uploads agree on a kill (2 installs reporting the same guild and boss), once its officers published a board, or once a character was seen in it. Guild names only, never a member's name, and a guild that asked to be hidden is left out. Members seen are counted only when the player pages are connected; otherwise the count is unrecorded, not zero. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      query: z.string().min(2).max(24).describe("The start of the guild's name, 2 to 24 characters."),
      limit: z.number().int().min(1).max(25).default(10),
    },
    outputSchema: { ...uploadsAnswer, page: guildSearch.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  guild_rankings: {
    title: "Guild ladder for one raid or dungeon",
    description:
      "Every guild with an agreed kill in one instance, ordered by bosses killed, then by who reached its latest kill first, then by name; equal rows share a rank. A kill is a guild's once 2 of its members' installs report the same boss there, timed at the earliest report, or once its officers published it through the guild board, which carries no time. The boss list and its order are the encounters 3 installs reported in that instance; a kill of a boss not on it counts for nothing. There is no score, no rating and no total across instances. Without an instance, the newest raid with a kill is ranked; realm and faction narrow the ladder. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      instanceMapId: z.number().int().positive().optional().describe("The instance's map id, as instance_entrance carries it. Omit for the newest raid with a kill."),
      realm: z.string().max(60).optional().describe("Only guilds on this realm."),
      faction: z.enum(GUILD_FACTIONS).optional().describe("Only alliance or horde guilds."),
      limit: z.number().int().min(1).max(100).default(20),
    },
    outputSchema: { ...uploadsAnswer, page: guildRankings.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  auction_history: {
    title: "Auction history for one item",
    description:
      "Price history from auction scans players uploaded on purpose. A day is public after 3 installs scanned that item on that realm. Copper is the median. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      realm: z.string().describe("Realm name."),
      itemId: z.number().int().positive().describe("Item id."),
    },
    outputSchema: { ...uploadsAnswer, page: auctionHistory.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  market_value: {
    title: "Forever market value for one item",
    description:
      "Market value, minimum buyout, historical value and units listed for one item on one WoW: Forever realm, from full auction scans players started and uploaded. A day is public after 3 reporters (distinct upload addresses) scanned the item; values are medians, thin days and outlier days are left out of the market value. Market value weights the last 14 public days, historical is the median of 60. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      realm: z.string().describe("Realm name."),
      itemId: z.number().int().positive().describe("Item id."),
    },
    outputSchema: { ...uploadsAnswer, page: marketPage.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  gold_ledger: {
    title: "Gold ledger for one character",
    description:
      "Peak gold and the money events that character's own upload recorded. Loot, quests, vendors, and auction sales stay on the money line. Gameplay stays on its own line. A missing line is unrecorded. The difference is not called bought and is not a ban. Installs are not merged. No scan of a player who did not upload. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      character: z.string().describe("Character name."),
      realm: z.string().describe("Realm name."),
    },
    outputSchema: { ...uploadsAnswer, page: goldLedger.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  coverage: {
    title: "Database coverage by zone, type and field",
    description:
      "How much of WoW: Forever's database is settled or confirmed, and which reported fields need more agreeing installs. The same counts and reported lists as https://everloot.app/database/coverage, as text, per zone, per type and per field, plus scoped totals and the current build's whole-fact settled-list size, separately dated and measured. Coverage = settled / expected, with confirmed / expected beside it; the denominator is max(expected, observed). Confirmed includes settled. Reported fields needing one or two more installs are counted without their values. A player-reported fact needs three agreeing installs to be public. Only public report identifiers and game-file facts are listed, never unconfirmed values, baseline rows, names or ids, or player names. Every answer states its scope, measurement method, data date and install counts; unknown values are [?]. Zone and type are optional; omitted filters cover all released zones and all types.",
    inputSchema: {
      zone: z.number().int().positive().optional().describe("Released UiMap zone id, such as 1429 for Elwynn Forest. Omit for all released zones."),
      type: z.enum(["quests", "npcs", "pins", "vendors", "drops", "rares", "entrances", "bosses", "treasures"]).optional().describe("Coverage type. Omit for all types."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  population: {
    title: "Who plays what: population by race, class, faction and level",
    description:
      "How many characters play each race, class, race and class, faction and level band on WoW: Forever, from the census of players who turned it on in the Everloot addon. Each character counts once. A count shows only when it covers at least 10 characters reported by at least 3 installs from at least 3 addresses, rounded to the nearest 5, and a count that could be worked out from the others is hidden too. Every answer states its window: active in the last 7 days (default) or since launch. With no arguments, the overview: most played class first. No names, ever. Missing or unavailable data is reported explicitly.",
    inputSchema: {
      race: z.string().max(40).optional().describe("A race, such as Gnome, Night Elf or Undead."),
      class: z.string().max(40).optional().describe("A class, such as Priest."),
      faction: z.enum(CENSUS_FACTIONS).optional().describe("Alliance or Horde."),
      window: z.enum(CENSUS_WINDOWS).default("week").describe("week: active in the last 7 days. launch: seen since launch."),
    },
    outputSchema: { ...uploadsAnswer, page: populationPage.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  recent_changes: {
    title: "Recent official changes for WoW: Forever",
    description:
      "Newest first: Blizzard blue posts (title, author, time, a short excerpt and the link to the original), hotfix posts, and new game builds. Excerpts only: Blizzard's post text is Blizzard's; full posts are available at their source URLs. A build's time is when Everloot first saw it, not Blizzard's release time.",
    inputSchema: {
      filter: z.enum(CHANGE_FILTERS).default("all").describe("posts (blue posts), hotfixes, builds, or all."),
      game: z.enum(["forever", "classic"]).optional().describe("Narrow to one game."),
      limit: z.number().int().min(1).max(25).default(10),
    },
    outputSchema: {
      connected: z.boolean().describe("False when the timeline is not connected: the list is then not a measured zero."),
      entries: z.array(changeEntry),
      url: z.string().optional().describe("The changes page on everloot.app with the same filter, absolute."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ecosystem_projects: {
    title: "WoW: Forever addons and open-source projects",
    description:
      "Forever addons and tools from the community registry, with a board ranking: most installed, rising, most active, freshest release or best maintained. Each project shows its GitHub repository, stars, latest release, last commit, whether its .toc declares a Forever interface number, and installs from Everloot uploads (counted from 3 installs; a missing count means not counted, not zero). Projects are ranked, never people. GitHub facts carry the time they were refreshed.",
    inputSchema: {
      board: z.enum(ECOSYSTEM_BOARD_FILTERS).default("all").describe("installed, rising, active, release, maintained, or all (A to Z)."),
      forever_ready_only: z.boolean().optional().describe("Only projects whose .toc lists a Forever interface number."),
      limit: z.number().int().min(1).max(25).default(10),
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
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  everloot_plan: {
    title: "Everloot implementation tracker",
    description:
      "The Everloot feature catalogue: what is live, what is next, what is waiting, and which reference sites are page shapes only.",
    inputSchema: {},
    outputSchema: {
      rows: z.array(planRow).describe("Every row, in the tracker's order."),
      counts: z.object({ live: z.number().int(), next: z.number().int(), waiting: z.number().int(), shape: z.number().int() }),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
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
 * What every tool returns: one text content block. Answers built on player data end with the
 * credit line, after a line stating how old the data is. Tools that read nothing from players carry
 * their sources inside the text instead. Tools with an outputSchema also return structuredContent
 * of that shape (STRUCTURED_TOOLS lists them; coverage is text only).
 * When one everloot.app page shows the answer, its structured `url` holds it and the text carries a
 * `More: <url>` line, last before the data age and credit lines.
 */
export const TOOL_OUTPUT = { type: "text", endsWith: MCP_CREDIT } as const;
/** The tools that answer with structuredContent beside the text. */
export const STRUCTURED_TOOLS: readonly McpToolName[] = MCP_TOOL_NAMES.filter((name) => "outputSchema" in MCP_TOOLS[name]);
/** The two tools of OpenAI's connector contract: their text block is the structured answer as a JSON string, not prose. */
export const CHATGPT_TOOLS: readonly McpToolName[] = ["search", "fetch"];
/** The tools whose answers are built on player uploads and therefore end with TOOL_OUTPUT.endsWith. */
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
