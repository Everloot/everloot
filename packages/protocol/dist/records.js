import { z } from "zod";
import { UPLOAD_LIMITS } from "./limits.js";
import { validRealm } from "./realm.js";
/**
 * Everloot upload record contract.
 * The addon writes these records to SavedVariables; the uploaders POST them to the site, which
 * validates every record against its kind's schema. Nothing here stores or publishes anything.
 */
/**
 * The cross-field rules zod enforces that JSON Schema cannot express. Each schema below uses its
 * sentence as the refinement message, and `scripts/emit-schema.ts` writes the same sentences into
 * the generated JSON Schema's description, so a reader of the schema files knows the server checks them.
 */
export const RULES = {
    loot: ["loot needs a source: npc, object or item", "a loot position needs mapId, x and y together"],
    achievement_catalog: ["criteria cannot outnumber criteriaCount"],
    achievement_owned: [
        "quantity and required come together",
        "quantity cannot exceed required",
        "criteriaMet cannot exceed criteriaTotal",
        "only a completed achievement has a date",
        "earnedOn is a real calendar date",
    ],
    reputation_owned: ["floor cannot exceed ceiling"],
    auction_snapshot: ["realm is a realm name: letters, digits, spaces, apostrophes and hyphens, 2 to 40 characters", "part cannot exceed parts"],
    gold_snapshot: ["peak gold cannot be below current gold"],
    map_bounds: ["map bounds need a width and a height"],
    talent_snapshot: ["talent points must equal the sum of node ranks", "talent node ids must be unique"],
    item_fact: ["an item fact other than damage_per_second is a whole number"],
};
export const INSTALL_ID = z.string().min(8).max(64).describe("Random install id, no account needed.");
const base = z.object({
    installId: INSTALL_ID,
    // Optional only to retain legacy files; public readers withhold rows without stable identity.
    eventId: z.string().min(3).max(96).regex(/^[A-Za-z0-9:_-]+$/).optional(),
    capturedAt: z.string().datetime({ offset: true }).describe("ISO time the event happened in-game."),
});
// --- Open-world records (anonymous: no character or guild names, no chat) ---
/** What the game calls a creature (`UnitCreatureType`), in English. The addon sends only these exact names. */
export const NPC_CREATURE_TYPES = [
    "Beast", "Dragonkin", "Demon", "Elemental", "Giant", "Undead", "Humanoid", "Critter", "Mechanical", "Not specified", "Totem", "Non-combat Pet", "Gas Cloud",
];
/** `UnitClassification` without the minor ranks: a boss is the game's `worldboss`. */
export const NPC_RANKS = ["normal", "elite", "rare", "rare_elite", "boss"];
/** The group a quest asks for, from the quest tag the game reports. */
export const QUEST_TAGS = ["group", "dungeon", "raid", "pvp"];
/** What the NPC does for players, from the window that opened (a merchant who repairs is `repair`). */
export const NPC_ROLES = ["vendor", "trainer", "questgiver", "flightmaster", "banker", "auctioneer", "stablemaster", "innkeeper", "repair"];
/** How an object was opened, from the spell the player cast on it. */
export const GATHER_KINDS = ["herb", "ore", "chest", "fishing", "other"];
/** What opened a loot window, from the spell cast just before it and the kind of source (loot tables spec, section 4). */
export const LOOT_TYPES = ["kill", "pickpocket", "skinning", "gather", "disenchant", "container", "fishing"];
export const npcSighting = base.extend({
    kind: z.literal("npc_sighting"),
    npcId: z.number().int().positive(),
    name: z.string().min(1).max(120),
    mapId: z.number().int().nonnegative(),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    level: z.number().int().min(1).max(100).optional().describe("The NPC's level. Absent when the source did not record it, as in a converted Polestar Recorder file."),
    reaction: z.enum(["friendly", "neutral", "hostile"]).optional().describe("How the NPC stood toward the player. Absent when the source did not record it, as in a converted Polestar Recorder file."),
    positionKind: z.enum(["player", "npc", "interaction", "vignette"]).optional().describe("Whose coordinates were measured; legacy unknown positions never become spawn pins. `interaction` is the player's position while the NPC's window was open, a few yards from the NPC. `vignette` is the NPC's own position, as the game's vignette API gave it for a rare on the minimap."),
    role: z.enum(NPC_ROLES).optional().describe("With `interaction`: the window that opened (`NPC_ROLES`). Absent for a gossip window that names no service and from older addons."),
    creatureType: z.enum(NPC_CREATURE_TYPES).optional().describe("The creature type the game shows, as `UnitCreatureType` reports it in English. Older addons send none."),
    rank: z.enum(NPC_RANKS).optional().describe("`UnitClassification`: normal, elite, rare, rare_elite or boss (`worldboss`). Older addons send none."),
});
export const lootWindow = base.extend({
    kind: z.literal("loot"),
    sourceNpcId: z.number().int().positive().optional(),
    sourceObjectId: z.number().int().positive().optional(),
    sourceItemId: z.number().int().positive().optional().describe("The item that was disenchanted or opened (a lockbox, a clam, a bag). Older addons send none."),
    lootType: z.enum(LOOT_TYPES).optional().describe("What opened the window, from the spell cast just before it (`LOOT_TYPES`). Absent on windows from older addons and converted Recorder files; those are never sorted into a type by guessing."),
    copper: z.number().int().min(1).max(10_000_000_000).optional().describe("The coin in the window, in copper. Absent when the window held none or the addon could not read it."),
    sourceEvidence: z.literal("loot-api").optional().describe("Legacy target guesses are withheld from public loot observations."),
    items: z.array(z.object({ itemId: z.number().int().positive(), count: z.number().int().min(1).max(1000) })).max(50),
    mapId: z.number().int().nonnegative().optional().describe("With an object source: the map the player stood on when the object was opened. Older addons send none."),
    x: z.number().min(0).max(100).optional().describe("The player's x on that map, 0 to 100."),
    y: z.number().min(0).max(100).optional().describe("The player's y on that map, 0 to 100."),
    gatherKind: z.enum(GATHER_KINDS).optional().describe("How the object was opened, from the spell cast on it (`GATHER_KINDS`); `other` when the spell is not one the addon knows."),
    sourceObjectName: z.string().min(1).max(120).optional().describe("The object's name as the game showed it. Public only when 3 installs agree on it."),
}).refine((r) => r.sourceNpcId !== undefined || r.sourceObjectId !== undefined || r.sourceItemId !== undefined, {
    message: RULES.loot[0],
}).refine((r) => (r.mapId === undefined) === (r.x === undefined) && (r.x === undefined) === (r.y === undefined), {
    message: RULES.loot[1],
});
export const questEvent = base.extend({
    kind: z.literal("quest"),
    questId: z.number().int().positive(),
    title: z.string().min(1).max(200),
    level: z.number().int().min(1).max(100),
    giverNpcId: z.number().int().positive().optional(),
    turnInNpcId: z.number().int().positive().optional(),
    rewardItemIds: z.array(z.number().int().positive()).max(20).default([]),
    category: z.string().min(1).max(60).optional().describe("The quest log header the quest sits under, a zone or a category. Older addons send none."),
    faction: z.enum(["alliance", "horde"]).optional().describe("The faction of the character that accepted it. Never the character's name."),
    suggestedGroup: z.number().int().min(2).max(40).optional().describe("The suggested group size the quest log shows; absent for a solo quest."),
    tag: z.enum(QUEST_TAGS).optional().describe("The quest tag the game reports, when it reports one."),
});
/** The instance kinds `GetInstanceInfo` reports for a dungeon (`party`) and a raid. */
export const INSTANCE_TYPES = ["party", "raid"];
const INSTANCE_MAP_ID = z.number().int().positive().describe("The instance's map id, the 8th return of `GetInstanceInfo`: a map, not a UiMap.");
const DIFFICULTY = z.number().int().nonnegative().max(255).optional().describe("The difficulty id `GetInstanceInfo` reports. Absent when the source did not record it.");
/** Zoning into a dungeon or raid, with the last position outside it: the entrance. */
export const instanceEntrance = base.extend({
    kind: z.literal("instance_entrance"),
    instanceMapId: INSTANCE_MAP_ID,
    name: z.string().min(1).max(120).describe("The instance's name as the game showed it, in the client's language. Public only when 3 installs agree on it."),
    instanceType: z.enum(INSTANCE_TYPES),
    difficulty: DIFFICULTY,
    mapId: z.number().int().nonnegative().describe("The UiMap the player stood on last before zoning in."),
    x: z.number().min(0).max(100).describe("The player's x there, 0 to 100."),
    y: z.number().min(0).max(100).describe("The player's y there, 0 to 100."),
});
/** A boss encounter's end, as `ENCOUNTER_END` reports it. */
export const encounterEnd = base.extend({
    kind: z.literal("encounter"),
    encounterId: z.number().int().positive(),
    name: z.string().min(1).max(120).describe("The encounter's name in the client's language. Public only when 3 installs agree on it."),
    instanceMapId: INSTANCE_MAP_ID,
    difficulty: DIFFICULTY,
    size: z.number().int().min(1).max(40).optional().describe("The group size the encounter reports."),
    success: z.boolean().describe("True for a kill, false for a wipe."),
    npcIds: z.array(z.number().int().positive()).max(40).optional().describe("The bosses' creature ids the client listed for the encounter, or the creatures that died in it. Absent when there were none."),
});
/** A game object the game's vignette API showed on the minimap, such as a treasure chest, at its own position. */
export const objectSighting = base.extend({
    kind: z.literal("object_sighting"),
    objectId: z.number().int().positive(),
    name: z.string().min(1).max(120).describe("The object's name in the client's language. Public only when 3 installs agree on it."),
    mapId: z.number().int().nonnegative(),
    x: z.number().min(0).max(100).describe("The object's own x on that map, 0 to 100, from the vignette: not the player's."),
    y: z.number().min(0).max(100).describe("The object's own y on that map, 0 to 100."),
    instanceMapId: INSTANCE_MAP_ID.optional(),
});
export const vendorList = base.extend({
    kind: z.literal("vendor"),
    vendorNpcId: z.number().int().positive(),
    items: z.array(z.object({
        itemId: z.number().int().positive(),
        priceCopper: z.number().int().nonnegative(),
        limitedStock: z.number().int().positive().optional(),
    })).min(1).max(200),
});
export const itemSeen = base.extend({
    kind: z.literal("item_seen"),
    itemId: z.number().int().positive(),
    name: z.string().min(1).max(200),
    quality: z.enum(["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"]),
    itemLevel: z.number().int().min(1).max(1000).optional(),
});
// --- Guild-consented records (named: published only by an officer upload) ---
export const guildSnapshot = base.extend({
    kind: z.literal("guild_snapshot"),
    guildName: z.string().min(2).max(60),
    realm: z.string().min(2).max(60),
    faction: z.enum(["alliance", "horde"]),
    claimToken: z.string().min(16).optional().describe("Legacy field; never proof of officer authority."),
    members: z.array(z.object({
        name: z.string().min(2).max(30),
        rank: z.string().min(1).max(60),
        level: z.number().int().min(1).max(100),
        class: z.string().min(1).max(30),
        lastOnlineDays: z.number().min(0).max(3650),
    })).min(1).max(2000),
});
export const raidLockout = base.extend({
    kind: z.literal("raid_lockout"),
    guildName: z.string().min(2).max(60),
    realm: z.string().min(2).max(60),
    instance: z.string().min(1).max(120),
    difficulty: z.string().min(1).max(60),
    bossesKilled: z.array(z.string().min(1).max(120)).max(60),
    resetAt: z.string().datetime({ offset: true }),
});
export const attendance = base.extend({
    kind: z.literal("attendance"),
    guildName: z.string().min(2).max(60),
    realm: z.string().min(2).max(60),
    instance: z.string().min(1).max(120),
    present: z.array(z.string().min(2).max(30)).min(1).max(100),
});
export const lootAward = base.extend({
    kind: z.literal("loot_award"),
    guildName: z.string().min(2).max(60),
    realm: z.string().min(2).max(60),
    itemId: z.number().int().positive(),
    itemName: z.string().min(1).max(200),
    recipient: z.string().min(2).max(30),
    sourceBoss: z.string().min(1).max(120),
});
export const gearSnapshot = base.extend({
    kind: z.literal("gear_snapshot"),
    character: z.string().min(2).max(30),
    realm: z.string().min(2).max(60),
    equipped: z.array(z.object({
        slot: z.string().min(1).max(40),
        itemId: z.number().int().positive(),
        itemLevel: z.number().int().min(1).max(1000),
    })).min(1).max(30),
});
export const collectionCatalog = base.extend({
    kind: z.literal("collection_catalog"),
    collection: z.string().min(1).max(40),
    source: z.string().min(1).max(80),
    itemId: z.number().int().positive(),
});
export const collectionOwned = base.extend({
    kind: z.literal("collection_owned"),
    collection: z.string().min(1).max(40),
    itemId: z.number().int().positive(),
});
// --- Addon 0.3.3: completion tracker (achievements, reputation, titles, quest chains) ---
// Catalog rows are game facts with no player data: readers list an entry once 3 installs agree on it.
// Owned rows are one character's own progress. They follow collection_owned: named data, shared only with
// the "collection" choice and a verified install grant.
/**
 * Opaque per-install label for one character: 8 hex digits the addon derives from the install id and the
 * character's GUID. It is not a name and is not meant to be turned back into one.
 */
export const CHARACTER_KEY = z.string().regex(/^[0-9a-f]{8}$/);
const COUNT = z.number().int().min(0).max(5000);
const GAME_ID = z.number().int().positive().max(2_000_000_000);
export const achievementCatalog = base.extend({
    kind: z.literal("achievement_catalog"),
    achievementId: GAME_ID,
    name: z.string().min(1).max(120),
    categoryId: z.number().int().nonnegative().max(2_000_000_000),
    category: z.string().min(1).max(80),
    parentCategory: z.string().min(1).max(80).optional(),
    points: z.number().int().min(0).max(1000),
    criteriaCount: COUNT.describe("The achievement's real criteria count; `criteria` keeps the first 100."),
    criteria: z.array(z.object({
        text: z.string().max(120),
        required: z.number().int().min(0).max(2_000_000_000),
    })).max(100),
}).refine((row) => row.criteria.length <= row.criteriaCount, { message: RULES.achievement_catalog[0], path: ["criteria"] });
export const reputationCatalog = base.extend({
    kind: z.literal("reputation_catalog"),
    factionId: GAME_ID,
    name: z.string().min(1).max(80),
    header: z.string().min(1).max(80).optional(),
    major: z.boolean().optional().describe("A renown faction: its ranks are not the eight standings."),
});
export const titleCatalog = base.extend({
    kind: z.literal("title_catalog"),
    titleId: z.number().int().positive().max(5000),
    name: z.string().min(1).max(80),
});
export const questChainCatalog = base.extend({
    kind: z.literal("quest_chain_catalog"),
    questLineId: GAME_ID,
    name: z.string().min(1).max(120),
    questIds: z.array(GAME_ID).min(1).max(80),
    truncated: z.boolean().optional().describe("The chain has more quests than the 80 kept: it is never called finished."),
});
/** A real calendar date: 2026-02-30 is refused. */
const CALENDAR_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(t) && new Date(t).toISOString().startsWith(s);
}, { message: "not a calendar date" });
const ownedBase = base.extend({
    characterKey: CHARACTER_KEY,
    class: z.string().min(2).max(20).regex(/^[A-Za-z]+$/).describe("Class token from UnitClass, e.g. MAGE."),
    level: z.number().int().min(1).max(100),
});
export const achievementOwned = ownedBase.extend({
    kind: z.literal("achievement_owned"),
    achievementId: GAME_ID,
    completed: z.boolean(),
    earnedByMe: z.boolean().optional().describe("False when the achievement is complete on the account but not by this character."),
    earnedOn: CALENDAR_DATE.optional(),
    criteriaMet: COUNT,
    criteriaTotal: COUNT,
    quantity: z.number().int().min(0).max(2_000_000_000).optional().describe("A progress-bar achievement's current amount."),
    required: z.number().int().min(1).max(2_000_000_000).optional().describe("A progress-bar achievement's target amount."),
}).superRefine((row, ctx) => {
    if ((row.quantity === undefined) !== (row.required === undefined))
        ctx.addIssue({ code: "custom", message: RULES.achievement_owned[0], path: ["quantity"] });
    if (row.quantity !== undefined && row.required !== undefined && row.quantity > row.required)
        ctx.addIssue({ code: "custom", message: RULES.achievement_owned[1], path: ["quantity"] });
    if (row.criteriaMet > row.criteriaTotal)
        ctx.addIssue({ code: "custom", message: RULES.achievement_owned[2], path: ["criteriaMet"] });
    if (row.earnedOn && !row.completed)
        ctx.addIssue({ code: "custom", message: RULES.achievement_owned[3], path: ["earnedOn"] });
});
export const reputationOwned = ownedBase.extend({
    kind: z.literal("reputation_owned"),
    factionId: GAME_ID,
    reaction: z.number().int().min(1).max(20).describe("The client's standing index: 1 Hated up to 8 Exalted."),
    standing: z.number().int().min(-1_000_000).max(10_000_000),
    floor: z.number().int().min(-1_000_000).max(10_000_000),
    ceiling: z.number().int().min(-1_000_000).max(10_000_000),
}).refine((row) => row.floor <= row.ceiling, { message: RULES.reputation_owned[0], path: ["floor"] });
/** Titles and completed quests are sent as additions: the union of a character's rows is what it has. */
export const titleOwned = ownedBase.extend({
    kind: z.literal("title_owned"),
    titleIds: z.array(z.number().int().positive().max(5000)).min(1).max(200),
});
export const questOwned = ownedBase.extend({
    kind: z.literal("quest_owned"),
    questIds: z.array(GAME_ID).min(1).max(200),
});
/** The kinds that hold one character's own progress. Named data, like collection_owned. */
export const COMPLETION_OWNED_KINDS = ["achievement_owned", "reputation_owned", "title_owned", "quest_owned"];
/** Catalog rows reflect one character's visible factions and quest lines and carry a per-install event id. */
export const COMPLETION_CATALOG_KINDS = ["achievement_catalog", "reputation_catalog", "title_catalog", "quest_chain_catalog"];
/** None of these is a public record or part of the corpus: the completion rollup folds them. */
export const COMPLETION_KINDS = [...COMPLETION_CATALOG_KINDS, ...COMPLETION_OWNED_KINDS];
export const auctionScan = base.extend({
    kind: z.literal("auction_scan"),
    realm: z.string().min(2).max(60),
    itemId: z.number().int().positive(),
    copper: z.number().int().nonnegative(),
    // Addon 0.2.2+: copper is per unit of a `count`-sized stack. 0.2.1 rows omit both and stored the stack total.
    count: z.number().int().min(1).max(1000).optional(),
    priceBasis: z.literal("unit").optional(),
});
// Whole-record validation: one out-of-range tuple would drop a part's 1,000 items, so any safe integer
// passes. Troll listings far above 200k gold are real auction-house prices.
const SCAN_COUNT = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const SCAN_COPPER = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/**
 * The auction houses a scan can come from. The game files list Alliance, Horde and neutral
 * (Blackwater) houses with different cuts, so a scan says which one it read.
 */
export const AUCTION_HOUSES = ["Alliance", "Horde", "Neutral"];
/**
 * One part of a full auction-house scan the player started (addon 0.3.0+). Each item is
 * [itemId, auctions, quantity, minUnit, marketUnit], copper per unit. A scan is split into parts of
 * at most 1,000 items. These rows feed the market rollup, not the general corpus.
 */
export const auctionSnapshot = base.extend({
    kind: z.literal("auction_snapshot"),
    // Plain realm names only: the name is published once 3 reporters scanned there.
    realm: z.string().min(2).max(60).refine(validRealm, { message: "not a realm name" }),
    faction: z.enum(["Alliance", "Horde"]).optional().describe("The scanning character's faction. Scans from addons up to 0.3.3 have none."),
    house: z.enum(AUCTION_HOUSES).optional().describe("The auction house the scan read, from the auctioneer's faction: Neutral for a goblin house. Absent in older scans and when the addon could not tell."),
    scanId: z.string().min(3).max(96).regex(/^[A-Za-z0-9:_-]+$/),
    part: z.number().int().min(1).max(100),
    parts: z.number().int().min(1).max(100),
    items: z.array(z.tuple([z.number().int().positive(), SCAN_COUNT, SCAN_COUNT, SCAN_COPPER, SCAN_COPPER])).min(1).max(1000),
}).refine((row) => row.part <= row.parts, { message: RULES.auction_snapshot[1] });
export const recipeSeen = base.extend({
    kind: z.literal("recipe_seen"),
    profession: z.string().min(1).max(40),
    recipe: z.string().min(1).max(120),
    skillMin: z.number().int().min(1).max(500),
    skillMax: z.number().int().min(1).max(500),
    points: z.number().int().min(1).max(10),
    reagents: z.array(z.object({
        item: z.string().min(1).max(80),
        count: z.number().int().min(1).max(1000),
    })).min(1).max(20),
});
/** What a trade-skill or craft window showed: a recipe's colour at the player's rank. Thresholds are inferred server-side. */
export const recipeObserved = base.extend({
    kind: z.literal("recipe_observed"),
    profession: z.string().min(1).max(40),
    rank: z.number().int().min(1).max(500),
    maxRank: z.number().int().min(1).max(500).optional(),
    recipe: z.string().min(1).max(120),
    difficulty: z.enum(["optimal", "medium", "easy", "trivial"]),
    productItemId: z.number().int().positive().optional(),
    reagents: z.array(z.object({
        item: z.string().min(1).max(80),
        count: z.number().int().min(1).max(1000),
    })).max(20),
});
/** What a trainer window listed: a profession recipe's required rank and training cost. */
export const trainerSeen = base.extend({
    kind: z.literal("trainer_seen"),
    profession: z.string().min(1).max(40),
    recipe: z.string().min(1).max(120),
    requiredRank: z.number().int().min(1).max(500),
    costCopper: z.number().int().nonnegative().max(2_000_000_000).optional(),
    trainerNpcId: z.number().int().positive().optional().describe("The trainer whose window listed it. Older addons send none."),
});
export const priceSeen = base.extend({
    kind: z.literal("price_seen"),
    item: z.string().min(1).max(80),
    copper: z.number().int().nonnegative(),
});
const COPPER = z.number().int().nonnegative().max(2_000_000_000);
const MONEY_CATEGORY = z.enum(["loot", "quest", "vendor", "auction", "flight", "postage", "barber", "respec", "auction_spend"]);
export const goldSnapshot = base.extend({
    kind: z.literal("gold_snapshot"),
    character: z.string().min(2).max(30),
    realm: z.string().min(2).max(60),
    currentCopper: COPPER,
    peakCopper: COPPER,
}).refine((row) => row.peakCopper >= row.currentCopper, {
    message: RULES.gold_snapshot[0],
});
export const moneyEvent = base.extend({
    kind: z.literal("money_event"),
    character: z.string().min(2).max(30),
    realm: z.string().min(2).max(60),
    category: MONEY_CATEGORY,
    copper: COPPER.min(1),
});
// --- Addon 0.2.6: installed addons (only when the player turned it on) and zone bounds ---
/** One installed addon as the AddOns list shows it. No settings, no other addon's SavedVariables. */
export const addonSeen = base.extend({
    kind: z.literal("addon_seen"),
    name: z.string().min(1).max(100).describe("The addon's folder name."),
    title: z.string().min(1).max(120),
    version: z.string().min(1).max(40).optional().describe("The .toc Version field."),
    loaded: z.boolean(),
});
const WORLD_UNITS = z.number().min(-100_000).max(100_000);
/** A zone's corners in world coordinates, from C_Map.GetWorldPosFromMapPos at (0,0) and (1,1). */
export const mapBounds = base.extend({
    kind: z.literal("map_bounds"),
    mapId: z.number().int().positive(),
    continentId: z.number().int().nonnegative(),
    left: WORLD_UNITS,
    top: WORLD_UNITS,
    right: WORLD_UNITS,
    bottom: WORLD_UNITS,
}).refine((row) => row.left !== row.right && row.top !== row.bottom, {
    message: RULES.map_bounds[0],
});
/** The game client's version and build from GetBuildInfo(), e.g. 1.60.1.70450. Addon 0.2.6+. */
export const CLIENT_BUILD = z.string().max(32).regex(/^\d+(\.\d+)+$/);
// --- Addon 0.3.10: the numbers an item's tooltip shows that the game files do not hold ---
/**
 * The tooltip numbers a player can see and the game files do not give: armour, block, the weapon's damage per
 * second, each stat and each resistance. The addon reads them with `GetItemStats` on the plain item (no enchant,
 * no random suffix), whose keys do not depend on the client's language.
 */
export const ITEM_FACTS = [
    "armor", "block", "damage_per_second",
    "health", "mana", "agility", "strength", "intellect", "spirit", "stamina",
    "defense_rating", "dodge_rating", "parry_rating", "block_rating", "hit_rating", "crit_rating", "haste_rating",
    "expertise_rating", "resilience_rating", "attack_power", "mana_regeneration", "spell_power",
    "holy_resistance", "fire_resistance", "nature_resistance", "frost_resistance", "shadow_resistance", "arcane_resistance",
];
/** One number on an item's tooltip, as the player's own client showed it: anonymous, like `item_seen`. */
export const itemFact = base.extend({
    kind: z.literal("item_fact"),
    itemId: z.number().int().positive(),
    fact: z.enum(ITEM_FACTS).describe("Which tooltip line the value is (`ITEM_FACTS`)."),
    value: z.number().min(-10_000).max(10_000).describe("The number on that line. A whole number, except damage_per_second, which has one decimal."),
    clientBuild: CLIENT_BUILD.describe("The build of the client that showed it, from GetBuildInfo(): a patch can change an item's numbers."),
}).refine((row) => row.fact === "damage_per_second" || Number.isInteger(row.value), {
    message: RULES.item_fact[0],
});
// --- Addon 0.2.7: the player's own talent build, read through the game's trait API ---
/** One spent talent node. `nodeId` is the client's trait node id; `choice` is the zero-based entry of a choice node. */
const talentNode = z.object({
    nodeId: z.number().int().positive(),
    ranks: z.number().int().min(1).max(50),
    choice: z.number().int().min(0).max(3).optional(),
});
/**
 * One talent build: one spec group of one character, no name. `loadoutString` is Blizzard's own export from
 * C_Traits.GenerateImportString when the client allowed it; `exportStatus` says how that went.
 */
export const talentSnapshot = base.extend({
    kind: z.literal("talent_snapshot"),
    class: z.string().min(2).max(20).regex(/^[A-Za-z]+$/).describe("Class token from UnitClass, e.g. MAGE."),
    level: z.number().int().min(1).max(100),
    group: z.number().int().min(1).max(2).describe("Spec group: 1 primary, 2 secondary (dual spec from level 40)."),
    active: z.boolean(),
    configId: z.number().int().nonnegative(),
    treeId: z.number().int().positive(),
    specId: z.number().int().positive().optional(),
    clientBuild: CLIENT_BUILD.optional(),
    serializationVersion: z.number().int().nonnegative().max(255).optional(),
    loadoutString: z.string().min(1).max(2000).regex(/^[A-Za-z0-9+/]+$/).optional(),
    exportStatus: z.enum(["ok", "unavailable", "failed", "empty", "unexpected"]),
    points: z.number().int().nonnegative().max(500),
    nodes: z.array(talentNode).max(600),
}).superRefine((row, ctx) => {
    if (row.points !== row.nodes.reduce((sum, node) => sum + node.ranks, 0)) {
        ctx.addIssue({ code: "custom", message: RULES.talent_snapshot[0], path: ["points"] });
    }
    if (new Set(row.nodes.map((node) => node.nodeId)).size !== row.nodes.length) {
        ctx.addIssue({ code: "custom", message: RULES.talent_snapshot[1], path: ["nodes"] });
    }
});
// --- Census: who plays what (docs/design/specs/2026-10-18-census-design.md) ---
// Race, class, level and faction of your own characters and of players you see. Never a name, guild, gear
// or position. The GUID is in transit only: intake swaps it for a keyed hash before anything is stored.
/** A player GUID as UnitGUID returns it: Player-<server id>-<player id>. */
export const PLAYER_GUID = z.string().regex(/^Player-[1-9]\d*-[0-9A-F]+$/)
    .describe("The player GUID, in transit only: the server replaces it with a keyed hash before anything is stored.");
// Not a list: Forever adds Skyborne, whose token is not confirmed yet.
const CENSUS_RACE = z.string().regex(/^[A-Za-z]{2,24}$/).describe("Race file token, UnitRace's second return, e.g. Scourge.");
const CENSUS_CLASS = z.string().regex(/^[A-Z]{3,16}$/).describe("Class token, UnitClass's second return, e.g. HUNTER.");
const censusBase = base.extend({
    guid: PLAYER_GUID,
    race: CENSUS_RACE,
    class: CENSUS_CLASS,
    level: z.number().int().min(1).max(60),
    faction: z.enum(["Alliance", "Horde"]),
});
const CENSUS_REALM = z.string().min(2).max(60).refine(validRealm, { message: "not a realm name" }).describe("GetRealmName() for your own character.");
const CENSUS_VIA = z.enum(["target", "mouseover", "group"]).describe("How the addon saw the player.");
const NO_REALM = z.never({ error: "realm is sent only for your own characters" }).optional()
    .describe("Absent: the server id in the GUID says where a player you see is from.");
const NO_VIA = z.never({ error: "via is sent only for players you see" }).optional().describe("Absent on your own characters.");
/** One of your own characters, as you log in. */
export const censusSelf = censusBase.extend({
    kind: z.literal("census_self"),
    realm: CENSUS_REALM,
    via: NO_VIA,
});
/** A player you targeted, moused over or grouped with. */
export const censusSeen = censusBase.extend({
    kind: z.literal("census_seen"),
    via: CENSUS_VIA,
    realm: NO_REALM,
});
/** The census kinds. Never public row by row: a private rollup publishes counts only. */
export const CENSUS_KINDS = ["census_self", "census_seen"];
/** A keyed hash of the sender's address (16 hex), the same value auction scans carry. Never the address. */
const CENSUS_REPORTER = z.string().regex(/^[a-f0-9]{16}$/).optional()
    .describe("Keyed hash of the uploading address, set by the server. Lets a rollup count distinct addresses, never reveals one.");
/** HMAC-SHA256 of the GUID under the server's character key, in hex. */
export const CENSUS_CHARACTER_KEY = z.string().regex(/^[0-9a-f]{64}$/);
/**
 * A census row as intake stores it: the GUID is gone, replaced by `characterKey` and the server id read from
 * it, and `eventId` is the server's own `<kind>:<UTC day>:<first 24 hex of characterKey>`. Parsing through
 * these schemas is what drops the GUID and anything else the client sent. Not a record kind: nobody sends these.
 */
const storedCensusBase = censusBase.omit({ guid: true }).extend({
    characterKey: CENSUS_CHARACTER_KEY,
    serverId: z.number().int().nonnegative(),
    reporter: CENSUS_REPORTER,
});
export const censusSelfStored = storedCensusBase.extend({
    kind: z.literal("census_self"),
    eventId: z.string().regex(/^census_self:\d{4}-\d{2}-\d{2}:[0-9a-f]{24}$/),
    realm: CENSUS_REALM,
});
export const censusSeenStored = storedCensusBase.extend({
    kind: z.literal("census_seen"),
    eventId: z.string().regex(/^census_seen:\d{4}-\d{2}-\d{2}:[0-9a-f]{24}$/),
    via: CENSUS_VIA,
});
export const storedCensusSchemas = { census_self: censusSelfStored, census_seen: censusSeenStored };
// --- Player pages: one named row per character (docs/design/specs/2026-10-20-player-pages-design.md) ---
// Name, realm, race, class, level and guild of a player the addon saw, or of your own character. Off until
// `/everloot players on`, and the site stores nothing from it until the owner turns the player pages on.
// No GUID, position, gear or history: the site keeps the newest row per character, not the rows.
/** A character name: letters only, 2 to 12 of them, in any script the game allows. */
export function validPlayerName(name) {
    return typeof name === "string" && /^\p{L}{2,12}$/u.test(name);
}
/** A guild name: letters, digits, spaces, apostrophes and hyphens, 2 to 24 characters. */
export function validGuildName(name) {
    return typeof name === "string" && name.length >= 2 && name.length <= 24 && /^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u.test(name);
}
/** One character, as the addon last saw it. The site keeps the newest row per character and realm. */
export const playerSeen = base.extend({
    kind: z.literal("player_seen"),
    name: z.string().min(2).max(48).refine(validPlayerName, { message: "not a character name" })
        .describe("UnitName: letters only, 2 to 12 of them."),
    realm: CENSUS_REALM.describe("GetRealmName(): the realm the addon runs on. Players from another realm are not recorded."),
    race: CENSUS_RACE,
    class: CENSUS_CLASS,
    level: z.number().int().min(1).max(60),
    guild: z.string().min(2).max(96).refine(validGuildName, { message: "not a guild name" }).optional()
        .describe("GetGuildInfo: the guild name, when the game showed one."),
});
/** The player-page kind. Never part of the public corpus; intake writes it to the players table, not to the upload. */
export const PLAYER_KINDS = ["player_seen"];
// --- Guild kills: a boss kill credited to the player's own guild (docs/design/specs/2026-10-24-guild-board-design.md) ---
// Written by the players module on ENCOUNTER_END with success, when the game shows the player a guild. The row
// names the guild and the boss, never a character. A kill is the guild's once 2 installs report it.
/** One boss kill as a member's client saw it, credited to that member's own guild. */
export const guildKill = base.extend({
    kind: z.literal("guild_kill"),
    guildName: z.string().min(2).max(60).refine(validGuildName, { message: "not a guild name" })
        .describe("GetGuildInfo for your own character: the guild the kill is credited to."),
    realm: CENSUS_REALM.describe("GetRealmName(): the realm the addon runs on, the guild's realm."),
    faction: z.enum(["alliance", "horde"]).describe("UnitFactionGroup for your own character: the guild's faction."),
    encounterId: z.number().int().positive().describe("The encounter id `ENCOUNTER_END` reports."),
    name: z.string().min(1).max(120).describe("The encounter's name in the client's language."),
    instanceMapId: INSTANCE_MAP_ID,
    difficulty: DIFFICULTY,
    size: z.number().int().min(1).max(40).optional().describe("The group size the encounter reports."),
});
// --- Character links: a code typed in game ties one character to an Everloot account ---
// The site shows a signed-in player a short code; typed in game, it becomes one character_link row, which the
// player sends to the account's link endpoint. The GUID is in transit only: the server turns it into a keyed hash
// and keeps nothing else of it. Never stored in an upload and never public.
/** A link code as the site shows it: EL-, four characters, a hyphen and two more, from Crockford's base 32 alphabet. */
export const LINK_CODE = z.string().regex(/^EL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/i)
    .describe("The code the site showed, as typed in game, e.g. EL-7K3Q-9P. Upper or lower case.");
/** One of your own characters, written when you type `/everloot link <code>` on it. */
export const characterLink = base.extend({
    kind: z.literal("character_link"),
    code: LINK_CODE,
    name: z.string().min(2).max(48).refine(validPlayerName, { message: "not a character name" })
        .describe("UnitName: letters only, 2 to 12 of them."),
    realm: CENSUS_REALM,
    race: CENSUS_RACE,
    class: CENSUS_CLASS,
    level: z.number().int().min(1).max(60),
    faction: z.enum(["Alliance", "Horde"]),
    guid: PLAYER_GUID,
    completionKey: CHARACTER_KEY.describe("The completion module's 8-hex key for this character, so its completion rows can be joined."),
});
/** The link kind. Not a public corpus kind and never kept in a stored upload. */
export const LINK_KINDS = ["character_link"];
/** Every record kind and its schema, in the order the contract lists them. */
export const recordSchemas = {
    npc_sighting: npcSighting,
    loot: lootWindow,
    quest: questEvent,
    vendor: vendorList,
    item_seen: itemSeen,
    instance_entrance: instanceEntrance,
    encounter: encounterEnd,
    object_sighting: objectSighting,
    item_fact: itemFact,
    guild_snapshot: guildSnapshot,
    raid_lockout: raidLockout,
    attendance,
    loot_award: lootAward,
    gear_snapshot: gearSnapshot,
    collection_catalog: collectionCatalog,
    collection_owned: collectionOwned,
    achievement_catalog: achievementCatalog,
    reputation_catalog: reputationCatalog,
    title_catalog: titleCatalog,
    quest_chain_catalog: questChainCatalog,
    achievement_owned: achievementOwned,
    reputation_owned: reputationOwned,
    title_owned: titleOwned,
    quest_owned: questOwned,
    auction_scan: auctionScan,
    auction_snapshot: auctionSnapshot,
    recipe_seen: recipeSeen,
    price_seen: priceSeen,
    recipe_observed: recipeObserved,
    trainer_seen: trainerSeen,
    gold_snapshot: goldSnapshot,
    money_event: moneyEvent,
    addon_seen: addonSeen,
    map_bounds: mapBounds,
    talent_snapshot: talentSnapshot,
    census_self: censusSelf,
    census_seen: censusSeen,
    player_seen: playerSeen,
    character_link: characterLink,
    guild_kill: guildKill,
};
export const ALL_RECORD_KINDS = Object.keys(recordSchemas);
/**
 * The kinds the public corpus API may return. An allowlist: a new kind is private until someone adds it
 * here. Addon lists (`addon_seen`) are published only as the leaderboard's counts at three or more
 * installs, never row by row.
 */
const PUBLIC_KIND_LIST = [
    "npc_sighting", "loot", "quest", "vendor", "item_seen", "guild_snapshot", "raid_lockout", "attendance",
    "loot_award", "gear_snapshot", "collection_catalog", "collection_owned", "auction_scan", "recipe_seen",
    "price_seen", "recipe_observed", "trainer_seen", "gold_snapshot", "money_event", "map_bounds",
    // Open-world facts like npc_sighting: anonymous rows, each shown on a page only once 3 installs agree.
    "instance_entrance", "encounter", "object_sighting",
    // A tooltip number, anonymous like item_seen: shown on an item page only once 3 installs agree on it.
    "item_fact",
    // A guild's boss kill: it names a guild and a boss, never a person. Counted once 2 installs report it.
    "guild_kill",
    // The eight completion kinds are deliberately absent. Catalog rows reflect one character's visible factions
    // and quest lines under a per-install event id, so they are never served raw: pages and MCP show an entry
    // only when 3 installs reported it identically. Owned rows are shown only to a granted owner. Both come
    // from the completion rollup, not from this corpus.
    // The census kinds are absent too: like addon lists, they are published only as counts.
    // So is player_seen: named rows reach the player pages, never this corpus.
    // So is character_link: it goes to the account's link endpoint and is never stored as sent.
];
export const PUBLIC_RECORD_KINDS = PUBLIC_KIND_LIST;
export const anyRecord = z.discriminatedUnion("kind", [
    npcSighting, lootWindow, questEvent, vendorList, itemSeen, instanceEntrance, encounterEnd, objectSighting, itemFact,
    guildSnapshot, raidLockout, attendance, lootAward, gearSnapshot,
    collectionCatalog, collectionOwned, achievementCatalog, reputationCatalog, titleCatalog, questChainCatalog,
    achievementOwned, reputationOwned, titleOwned, questOwned, auctionScan, auctionSnapshot, recipeSeen, priceSeen, recipeObserved, trainerSeen,
    goldSnapshot, moneyEvent, addonSeen, mapBounds, talentSnapshot, censusSelf, censusSeen, playerSeen, characterLink, guildKill,
]);
/** Where an upload's rows came from when the Everloot addon did not write them. */
export const UPLOAD_SOURCES = ["polestar_recorder"];
/** The request envelope. `protocol` is the uploader's protocol version; a missing one means major 1. */
export const uploadPayload = z.object({
    addonVersion: z.string().min(1).max(UPLOAD_LIMITS.addonVersionMax),
    clientBuild: CLIENT_BUILD.optional(),
    protocol: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    source: z.enum(UPLOAD_SOURCES).optional().describe("Absent for the Everloot addon's own file. `polestar_recorder`: the rows were converted in the browser from a Polestar Recorder file, and the server assigns their install id."),
    records: z.array(z.unknown()).min(1).max(UPLOAD_LIMITS.recordsPerBatch),
});
