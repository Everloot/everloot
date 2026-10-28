import { z } from "zod";
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
export declare const RULES: {
    readonly loot: readonly ["loot needs a source: npc, object or item", "a loot position needs mapId, x and y together"];
    readonly achievement_catalog: readonly ["criteria cannot outnumber criteriaCount"];
    readonly achievement_owned: readonly ["quantity and required come together", "quantity cannot exceed required", "criteriaMet cannot exceed criteriaTotal", "only a completed achievement has a date", "earnedOn is a real calendar date"];
    readonly reputation_owned: readonly ["floor cannot exceed ceiling"];
    readonly auction_snapshot: readonly ["realm is a realm name: letters, digits, spaces, apostrophes and hyphens, 2 to 40 characters", "part cannot exceed parts"];
    readonly gold_snapshot: readonly ["peak gold cannot be below current gold"];
    readonly map_bounds: readonly ["map bounds need a width and a height"];
    readonly talent_snapshot: readonly ["talent points must equal the sum of node ranks", "talent node ids must be unique"];
    readonly item_fact: readonly ["an item fact other than damage_per_second is a whole number"];
};
export declare const INSTALL_ID: z.ZodString;
/** What the game calls a creature (`UnitCreatureType`), in English. The addon sends only these exact names. */
export declare const NPC_CREATURE_TYPES: readonly ["Beast", "Dragonkin", "Demon", "Elemental", "Giant", "Undead", "Humanoid", "Critter", "Mechanical", "Not specified", "Totem", "Non-combat Pet", "Gas Cloud"];
/** `UnitClassification` without the minor ranks: a boss is the game's `worldboss`. */
export declare const NPC_RANKS: readonly ["normal", "elite", "rare", "rare_elite", "boss"];
/** The group a quest asks for, from the quest tag the game reports. */
export declare const QUEST_TAGS: readonly ["group", "dungeon", "raid", "pvp"];
/** What the NPC does for players, from the window that opened (a merchant who repairs is `repair`). */
export declare const NPC_ROLES: readonly ["vendor", "trainer", "questgiver", "flightmaster", "banker", "auctioneer", "stablemaster", "innkeeper", "repair"];
/** How an object was opened, from the spell the player cast on it. */
export declare const GATHER_KINDS: readonly ["herb", "ore", "chest", "fishing", "other"];
/** What opened a loot window, from the spell cast just before it and the kind of source (loot tables spec, section 4). */
export declare const LOOT_TYPES: readonly ["kill", "pickpocket", "skinning", "gather", "disenchant", "container", "fishing"];
export declare const npcSighting: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"npc_sighting">;
    npcId: z.ZodNumber;
    name: z.ZodString;
    mapId: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
    level: z.ZodOptional<z.ZodNumber>;
    reaction: z.ZodOptional<z.ZodEnum<{
        friendly: "friendly";
        hostile: "hostile";
        neutral: "neutral";
    }>>;
    positionKind: z.ZodOptional<z.ZodEnum<{
        interaction: "interaction";
        npc: "npc";
        player: "player";
        vignette: "vignette";
    }>>;
    role: z.ZodOptional<z.ZodEnum<{
        auctioneer: "auctioneer";
        banker: "banker";
        flightmaster: "flightmaster";
        innkeeper: "innkeeper";
        questgiver: "questgiver";
        repair: "repair";
        stablemaster: "stablemaster";
        trainer: "trainer";
        vendor: "vendor";
    }>>;
    creatureType: z.ZodOptional<z.ZodEnum<{
        Beast: "Beast";
        Critter: "Critter";
        Demon: "Demon";
        Dragonkin: "Dragonkin";
        Elemental: "Elemental";
        "Gas Cloud": "Gas Cloud";
        Giant: "Giant";
        Humanoid: "Humanoid";
        Mechanical: "Mechanical";
        "Non-combat Pet": "Non-combat Pet";
        "Not specified": "Not specified";
        Totem: "Totem";
        Undead: "Undead";
    }>>;
    rank: z.ZodOptional<z.ZodEnum<{
        boss: "boss";
        elite: "elite";
        normal: "normal";
        rare: "rare";
        rare_elite: "rare_elite";
    }>>;
}, z.core.$strip>;
export declare const lootWindow: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"loot">;
    sourceNpcId: z.ZodOptional<z.ZodNumber>;
    sourceObjectId: z.ZodOptional<z.ZodNumber>;
    sourceItemId: z.ZodOptional<z.ZodNumber>;
    lootType: z.ZodOptional<z.ZodEnum<{
        container: "container";
        disenchant: "disenchant";
        fishing: "fishing";
        gather: "gather";
        kill: "kill";
        pickpocket: "pickpocket";
        skinning: "skinning";
    }>>;
    copper: z.ZodOptional<z.ZodNumber>;
    sourceEvidence: z.ZodOptional<z.ZodLiteral<"loot-api">>;
    items: z.ZodArray<z.ZodObject<{
        itemId: z.ZodNumber;
        count: z.ZodNumber;
    }, z.core.$strip>>;
    mapId: z.ZodOptional<z.ZodNumber>;
    x: z.ZodOptional<z.ZodNumber>;
    y: z.ZodOptional<z.ZodNumber>;
    gatherKind: z.ZodOptional<z.ZodEnum<{
        chest: "chest";
        fishing: "fishing";
        herb: "herb";
        ore: "ore";
        other: "other";
    }>>;
    sourceObjectName: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const questEvent: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"quest">;
    questId: z.ZodNumber;
    title: z.ZodString;
    level: z.ZodNumber;
    giverNpcId: z.ZodOptional<z.ZodNumber>;
    turnInNpcId: z.ZodOptional<z.ZodNumber>;
    rewardItemIds: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
    category: z.ZodOptional<z.ZodString>;
    faction: z.ZodOptional<z.ZodEnum<{
        alliance: "alliance";
        horde: "horde";
    }>>;
    suggestedGroup: z.ZodOptional<z.ZodNumber>;
    tag: z.ZodOptional<z.ZodEnum<{
        dungeon: "dungeon";
        group: "group";
        pvp: "pvp";
        raid: "raid";
    }>>;
}, z.core.$strip>;
/** The instance kinds `GetInstanceInfo` reports for a dungeon (`party`) and a raid. */
export declare const INSTANCE_TYPES: readonly ["party", "raid"];
/** Zoning into a dungeon or raid, with the last position outside it: the entrance. */
export declare const instanceEntrance: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"instance_entrance">;
    instanceMapId: z.ZodNumber;
    name: z.ZodString;
    instanceType: z.ZodEnum<{
        party: "party";
        raid: "raid";
    }>;
    difficulty: z.ZodOptional<z.ZodNumber>;
    mapId: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
}, z.core.$strip>;
/** A boss encounter's end, as `ENCOUNTER_END` reports it. */
export declare const encounterEnd: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"encounter">;
    encounterId: z.ZodNumber;
    name: z.ZodString;
    instanceMapId: z.ZodNumber;
    difficulty: z.ZodOptional<z.ZodNumber>;
    size: z.ZodOptional<z.ZodNumber>;
    success: z.ZodBoolean;
    npcIds: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
}, z.core.$strip>;
/** A game object the game's vignette API showed on the minimap, such as a treasure chest, at its own position. */
export declare const objectSighting: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"object_sighting">;
    objectId: z.ZodNumber;
    name: z.ZodString;
    mapId: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
    instanceMapId: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const vendorList: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"vendor">;
    vendorNpcId: z.ZodNumber;
    items: z.ZodArray<z.ZodObject<{
        itemId: z.ZodNumber;
        priceCopper: z.ZodNumber;
        limitedStock: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const itemSeen: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"item_seen">;
    itemId: z.ZodNumber;
    name: z.ZodString;
    quality: z.ZodEnum<{
        artifact: "artifact";
        common: "common";
        epic: "epic";
        heirloom: "heirloom";
        legendary: "legendary";
        poor: "poor";
        rare: "rare";
        uncommon: "uncommon";
    }>;
    itemLevel: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const guildSnapshot: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"guild_snapshot">;
    guildName: z.ZodString;
    realm: z.ZodString;
    faction: z.ZodEnum<{
        alliance: "alliance";
        horde: "horde";
    }>;
    claimToken: z.ZodOptional<z.ZodString>;
    members: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        rank: z.ZodString;
        level: z.ZodNumber;
        class: z.ZodString;
        lastOnlineDays: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const raidLockout: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"raid_lockout">;
    guildName: z.ZodString;
    realm: z.ZodString;
    instance: z.ZodString;
    difficulty: z.ZodString;
    bossesKilled: z.ZodArray<z.ZodString>;
    resetAt: z.ZodString;
}, z.core.$strip>;
export declare const attendance: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"attendance">;
    guildName: z.ZodString;
    realm: z.ZodString;
    instance: z.ZodString;
    present: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const lootAward: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"loot_award">;
    guildName: z.ZodString;
    realm: z.ZodString;
    itemId: z.ZodNumber;
    itemName: z.ZodString;
    recipient: z.ZodString;
    sourceBoss: z.ZodString;
}, z.core.$strip>;
export declare const gearSnapshot: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"gear_snapshot">;
    character: z.ZodString;
    realm: z.ZodString;
    equipped: z.ZodArray<z.ZodObject<{
        slot: z.ZodString;
        itemId: z.ZodNumber;
        itemLevel: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const collectionCatalog: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"collection_catalog">;
    collection: z.ZodString;
    source: z.ZodString;
    itemId: z.ZodNumber;
}, z.core.$strip>;
export declare const collectionOwned: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"collection_owned">;
    collection: z.ZodString;
    itemId: z.ZodNumber;
}, z.core.$strip>;
/**
 * Opaque per-install label for one character: 8 hex digits the addon derives from the install id and the
 * character's GUID. It is not a name and is not meant to be turned back into one.
 */
export declare const CHARACTER_KEY: z.ZodString;
export declare const achievementCatalog: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"achievement_catalog">;
    achievementId: z.ZodNumber;
    name: z.ZodString;
    categoryId: z.ZodNumber;
    category: z.ZodString;
    parentCategory: z.ZodOptional<z.ZodString>;
    points: z.ZodNumber;
    criteriaCount: z.ZodNumber;
    criteria: z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        required: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const reputationCatalog: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"reputation_catalog">;
    factionId: z.ZodNumber;
    name: z.ZodString;
    header: z.ZodOptional<z.ZodString>;
    major: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const titleCatalog: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"title_catalog">;
    titleId: z.ZodNumber;
    name: z.ZodString;
}, z.core.$strip>;
export declare const questChainCatalog: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"quest_chain_catalog">;
    questLineId: z.ZodNumber;
    name: z.ZodString;
    questIds: z.ZodArray<z.ZodNumber>;
    truncated: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const achievementOwned: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"achievement_owned">;
    achievementId: z.ZodNumber;
    completed: z.ZodBoolean;
    earnedByMe: z.ZodOptional<z.ZodBoolean>;
    earnedOn: z.ZodOptional<z.ZodString>;
    criteriaMet: z.ZodNumber;
    criteriaTotal: z.ZodNumber;
    quantity: z.ZodOptional<z.ZodNumber>;
    required: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const reputationOwned: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"reputation_owned">;
    factionId: z.ZodNumber;
    reaction: z.ZodNumber;
    standing: z.ZodNumber;
    floor: z.ZodNumber;
    ceiling: z.ZodNumber;
}, z.core.$strip>;
/** Titles and completed quests are sent as additions: the union of a character's rows is what it has. */
export declare const titleOwned: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"title_owned">;
    titleIds: z.ZodArray<z.ZodNumber>;
}, z.core.$strip>;
export declare const questOwned: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"quest_owned">;
    questIds: z.ZodArray<z.ZodNumber>;
}, z.core.$strip>;
/** The kinds that hold one character's own progress. Named data, like collection_owned. */
export declare const COMPLETION_OWNED_KINDS: readonly string[];
/** Catalog rows reflect one character's visible factions and quest lines and carry a per-install event id. */
export declare const COMPLETION_CATALOG_KINDS: readonly string[];
/** None of these is a public record or part of the corpus: the completion rollup folds them. */
export declare const COMPLETION_KINDS: readonly string[];
export declare const auctionScan: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"auction_scan">;
    realm: z.ZodString;
    itemId: z.ZodNumber;
    copper: z.ZodNumber;
    count: z.ZodOptional<z.ZodNumber>;
    priceBasis: z.ZodOptional<z.ZodLiteral<"unit">>;
}, z.core.$strip>;
/**
 * The auction houses a scan can come from. The game files list Alliance, Horde and neutral
 * (Blackwater) houses with different cuts, so a scan says which one it read.
 */
export declare const AUCTION_HOUSES: readonly ["Alliance", "Horde", "Neutral"];
export type AuctionHouse = (typeof AUCTION_HOUSES)[number];
/**
 * One part of a full auction-house scan the player started (addon 0.3.0+). Each item is
 * [itemId, auctions, quantity, minUnit, marketUnit], copper per unit. A scan is split into parts of
 * at most 1,000 items. These rows feed the market rollup, not the general corpus.
 */
export declare const auctionSnapshot: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"auction_snapshot">;
    realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    faction: z.ZodOptional<z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
    }>>;
    house: z.ZodOptional<z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
        Neutral: "Neutral";
    }>>;
    scanId: z.ZodString;
    part: z.ZodNumber;
    parts: z.ZodNumber;
    items: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>>;
}, z.core.$strip>;
export declare const recipeSeen: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"recipe_seen">;
    profession: z.ZodString;
    recipe: z.ZodString;
    skillMin: z.ZodNumber;
    skillMax: z.ZodNumber;
    points: z.ZodNumber;
    reagents: z.ZodArray<z.ZodObject<{
        item: z.ZodString;
        count: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** What a trade-skill or craft window showed: a recipe's colour at the player's rank. Thresholds are inferred server-side. */
export declare const recipeObserved: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"recipe_observed">;
    profession: z.ZodString;
    rank: z.ZodNumber;
    maxRank: z.ZodOptional<z.ZodNumber>;
    recipe: z.ZodString;
    difficulty: z.ZodEnum<{
        easy: "easy";
        medium: "medium";
        optimal: "optimal";
        trivial: "trivial";
    }>;
    productItemId: z.ZodOptional<z.ZodNumber>;
    reagents: z.ZodArray<z.ZodObject<{
        item: z.ZodString;
        count: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** What a trainer window listed: a profession recipe's required rank and training cost. */
export declare const trainerSeen: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"trainer_seen">;
    profession: z.ZodString;
    recipe: z.ZodString;
    requiredRank: z.ZodNumber;
    costCopper: z.ZodOptional<z.ZodNumber>;
    trainerNpcId: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const priceSeen: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"price_seen">;
    item: z.ZodString;
    copper: z.ZodNumber;
}, z.core.$strip>;
export declare const goldSnapshot: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"gold_snapshot">;
    character: z.ZodString;
    realm: z.ZodString;
    currentCopper: z.ZodNumber;
    peakCopper: z.ZodNumber;
}, z.core.$strip>;
export declare const moneyEvent: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"money_event">;
    character: z.ZodString;
    realm: z.ZodString;
    category: z.ZodEnum<{
        auction: "auction";
        auction_spend: "auction_spend";
        barber: "barber";
        flight: "flight";
        loot: "loot";
        postage: "postage";
        quest: "quest";
        respec: "respec";
        vendor: "vendor";
    }>;
    copper: z.ZodNumber;
}, z.core.$strip>;
/** One installed addon as the AddOns list shows it. No settings, no other addon's SavedVariables. */
export declare const addonSeen: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"addon_seen">;
    name: z.ZodString;
    title: z.ZodString;
    version: z.ZodOptional<z.ZodString>;
    loaded: z.ZodBoolean;
}, z.core.$strip>;
/** A zone's corners in world coordinates, from C_Map.GetWorldPosFromMapPos at (0,0) and (1,1). */
export declare const mapBounds: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"map_bounds">;
    mapId: z.ZodNumber;
    continentId: z.ZodNumber;
    left: z.ZodNumber;
    top: z.ZodNumber;
    right: z.ZodNumber;
    bottom: z.ZodNumber;
}, z.core.$strip>;
/** The game client's version and build from GetBuildInfo(), e.g. 1.60.1.70450. Addon 0.2.6+. */
export declare const CLIENT_BUILD: z.ZodString;
/**
 * The tooltip numbers a player can see and the game files do not give: armour, block, the weapon's damage per
 * second, each stat and each resistance. The addon reads them with `GetItemStats` on the plain item (no enchant,
 * no random suffix), whose keys do not depend on the client's language.
 */
export declare const ITEM_FACTS: readonly ["armor", "block", "damage_per_second", "health", "mana", "agility", "strength", "intellect", "spirit", "stamina", "defense_rating", "dodge_rating", "parry_rating", "block_rating", "hit_rating", "crit_rating", "haste_rating", "expertise_rating", "resilience_rating", "attack_power", "mana_regeneration", "spell_power", "holy_resistance", "fire_resistance", "nature_resistance", "frost_resistance", "shadow_resistance", "arcane_resistance"];
/** One number on an item's tooltip, as the player's own client showed it: anonymous, like `item_seen`. */
export declare const itemFact: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"item_fact">;
    itemId: z.ZodNumber;
    fact: z.ZodEnum<{
        agility: "agility";
        arcane_resistance: "arcane_resistance";
        armor: "armor";
        attack_power: "attack_power";
        block: "block";
        block_rating: "block_rating";
        crit_rating: "crit_rating";
        damage_per_second: "damage_per_second";
        defense_rating: "defense_rating";
        dodge_rating: "dodge_rating";
        expertise_rating: "expertise_rating";
        fire_resistance: "fire_resistance";
        frost_resistance: "frost_resistance";
        haste_rating: "haste_rating";
        health: "health";
        hit_rating: "hit_rating";
        holy_resistance: "holy_resistance";
        intellect: "intellect";
        mana: "mana";
        mana_regeneration: "mana_regeneration";
        nature_resistance: "nature_resistance";
        parry_rating: "parry_rating";
        resilience_rating: "resilience_rating";
        shadow_resistance: "shadow_resistance";
        spell_power: "spell_power";
        spirit: "spirit";
        stamina: "stamina";
        strength: "strength";
    }>;
    value: z.ZodNumber;
    clientBuild: z.ZodString;
}, z.core.$strip>;
/**
 * One talent build: one spec group of one character, no name. `loadoutString` is Blizzard's own export from
 * C_Traits.GenerateImportString when the client allowed it; `exportStatus` says how that went.
 */
export declare const talentSnapshot: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"talent_snapshot">;
    class: z.ZodString;
    level: z.ZodNumber;
    group: z.ZodNumber;
    active: z.ZodBoolean;
    configId: z.ZodNumber;
    treeId: z.ZodNumber;
    specId: z.ZodOptional<z.ZodNumber>;
    clientBuild: z.ZodOptional<z.ZodString>;
    serializationVersion: z.ZodOptional<z.ZodNumber>;
    loadoutString: z.ZodOptional<z.ZodString>;
    exportStatus: z.ZodEnum<{
        empty: "empty";
        failed: "failed";
        ok: "ok";
        unavailable: "unavailable";
        unexpected: "unexpected";
    }>;
    points: z.ZodNumber;
    nodes: z.ZodArray<z.ZodObject<{
        nodeId: z.ZodNumber;
        ranks: z.ZodNumber;
        choice: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** A player GUID as UnitGUID returns it: Player-<server id>-<player id>. */
export declare const PLAYER_GUID: z.ZodString;
/** One of your own characters, as you log in. */
export declare const censusSelf: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    guid: z.ZodString;
    race: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    faction: z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
    }>;
    kind: z.ZodLiteral<"census_self">;
    realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    via: z.ZodOptional<z.ZodNever>;
}, z.core.$strip>;
/** A player you targeted, moused over or grouped with. */
export declare const censusSeen: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    guid: z.ZodString;
    race: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    faction: z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
    }>;
    kind: z.ZodLiteral<"census_seen">;
    via: z.ZodEnum<{
        group: "group";
        mouseover: "mouseover";
        target: "target";
    }>;
    realm: z.ZodOptional<z.ZodNever>;
}, z.core.$strip>;
/** The census kinds. Never public row by row: a private rollup publishes counts only. */
export declare const CENSUS_KINDS: readonly string[];
/** HMAC-SHA256 of the GUID under the server's character key, in hex. */
export declare const CENSUS_CHARACTER_KEY: z.ZodString;
export declare const censusSelfStored: z.ZodObject<{
    installId: z.ZodString;
    capturedAt: z.ZodString;
    race: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    faction: z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
    }>;
    characterKey: z.ZodString;
    serverId: z.ZodNumber;
    reporter: z.ZodOptional<z.ZodString>;
    kind: z.ZodLiteral<"census_self">;
    eventId: z.ZodString;
    realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
}, z.core.$strip>;
export declare const censusSeenStored: z.ZodObject<{
    installId: z.ZodString;
    capturedAt: z.ZodString;
    race: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    faction: z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
    }>;
    characterKey: z.ZodString;
    serverId: z.ZodNumber;
    reporter: z.ZodOptional<z.ZodString>;
    kind: z.ZodLiteral<"census_seen">;
    eventId: z.ZodString;
    via: z.ZodEnum<{
        group: "group";
        mouseover: "mouseover";
        target: "target";
    }>;
}, z.core.$strip>;
export declare const storedCensusSchemas: {
    readonly census_self: z.ZodObject<{
        installId: z.ZodString;
        capturedAt: z.ZodString;
        race: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        faction: z.ZodEnum<{
            Alliance: "Alliance";
            Horde: "Horde";
        }>;
        characterKey: z.ZodString;
        serverId: z.ZodNumber;
        reporter: z.ZodOptional<z.ZodString>;
        kind: z.ZodLiteral<"census_self">;
        eventId: z.ZodString;
        realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    }, z.core.$strip>;
    readonly census_seen: z.ZodObject<{
        installId: z.ZodString;
        capturedAt: z.ZodString;
        race: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        faction: z.ZodEnum<{
            Alliance: "Alliance";
            Horde: "Horde";
        }>;
        characterKey: z.ZodString;
        serverId: z.ZodNumber;
        reporter: z.ZodOptional<z.ZodString>;
        kind: z.ZodLiteral<"census_seen">;
        eventId: z.ZodString;
        via: z.ZodEnum<{
            group: "group";
            mouseover: "mouseover";
            target: "target";
        }>;
    }, z.core.$strip>;
};
export type StoredCensusRecord = z.infer<typeof censusSelfStored> | z.infer<typeof censusSeenStored>;
/** A character name: letters only, 2 to 12 of them, in any script the game allows. */
export declare function validPlayerName(name: unknown): name is string;
/** A guild name: letters, digits, spaces, apostrophes and hyphens, 2 to 24 characters. */
export declare function validGuildName(name: unknown): name is string;
/** One character, as the addon last saw it. The site keeps the newest row per character and realm. */
export declare const playerSeen: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"player_seen">;
    name: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    race: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    guild: z.ZodOptional<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
}, z.core.$strip>;
/** The player-page kind. Never part of the public corpus; intake writes it to the players table, not to the upload. */
export declare const PLAYER_KINDS: readonly string[];
/**
 * The guild kill kind. Stored with the upload, never served raw: it is not on the public corpus allowlist, and
 * only the guild rollup (2 installs, hidden guilds out, behind the switch) publishes kills.
 */
export declare const GUILD_KILL_KINDS: readonly string[];
/** One boss kill as a member's client saw it, credited to that member's own guild. */
export declare const guildKill: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"guild_kill">;
    guildName: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    faction: z.ZodEnum<{
        alliance: "alliance";
        horde: "horde";
    }>;
    encounterId: z.ZodNumber;
    name: z.ZodString;
    instanceMapId: z.ZodNumber;
    difficulty: z.ZodOptional<z.ZodNumber>;
    size: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** A link code as the site shows it: EL-, four characters, a hyphen and two more, from Crockford's base 32 alphabet. */
export declare const LINK_CODE: z.ZodString;
/** One of your own characters, written when you type `/everloot link <code>` on it. */
export declare const characterLink: z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"character_link">;
    code: z.ZodString;
    name: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    race: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    faction: z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
    }>;
    guid: z.ZodString;
    completionKey: z.ZodString;
}, z.core.$strip>;
/** The link kind. Not a public corpus kind and never kept in a stored upload. */
export declare const LINK_KINDS: readonly string[];
/** Every record kind and its schema, in the order the contract lists them. */
export declare const recordSchemas: {
    readonly npc_sighting: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"npc_sighting">;
        npcId: z.ZodNumber;
        name: z.ZodString;
        mapId: z.ZodNumber;
        x: z.ZodNumber;
        y: z.ZodNumber;
        level: z.ZodOptional<z.ZodNumber>;
        reaction: z.ZodOptional<z.ZodEnum<{
            friendly: "friendly";
            hostile: "hostile";
            neutral: "neutral";
        }>>;
        positionKind: z.ZodOptional<z.ZodEnum<{
            interaction: "interaction";
            npc: "npc";
            player: "player";
            vignette: "vignette";
        }>>;
        role: z.ZodOptional<z.ZodEnum<{
            auctioneer: "auctioneer";
            banker: "banker";
            flightmaster: "flightmaster";
            innkeeper: "innkeeper";
            questgiver: "questgiver";
            repair: "repair";
            stablemaster: "stablemaster";
            trainer: "trainer";
            vendor: "vendor";
        }>>;
        creatureType: z.ZodOptional<z.ZodEnum<{
            Beast: "Beast";
            Critter: "Critter";
            Demon: "Demon";
            Dragonkin: "Dragonkin";
            Elemental: "Elemental";
            "Gas Cloud": "Gas Cloud";
            Giant: "Giant";
            Humanoid: "Humanoid";
            Mechanical: "Mechanical";
            "Non-combat Pet": "Non-combat Pet";
            "Not specified": "Not specified";
            Totem: "Totem";
            Undead: "Undead";
        }>>;
        rank: z.ZodOptional<z.ZodEnum<{
            boss: "boss";
            elite: "elite";
            normal: "normal";
            rare: "rare";
            rare_elite: "rare_elite";
        }>>;
    }, z.core.$strip>;
    readonly loot: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"loot">;
        sourceNpcId: z.ZodOptional<z.ZodNumber>;
        sourceObjectId: z.ZodOptional<z.ZodNumber>;
        sourceItemId: z.ZodOptional<z.ZodNumber>;
        lootType: z.ZodOptional<z.ZodEnum<{
            container: "container";
            disenchant: "disenchant";
            fishing: "fishing";
            gather: "gather";
            kill: "kill";
            pickpocket: "pickpocket";
            skinning: "skinning";
        }>>;
        copper: z.ZodOptional<z.ZodNumber>;
        sourceEvidence: z.ZodOptional<z.ZodLiteral<"loot-api">>;
        items: z.ZodArray<z.ZodObject<{
            itemId: z.ZodNumber;
            count: z.ZodNumber;
        }, z.core.$strip>>;
        mapId: z.ZodOptional<z.ZodNumber>;
        x: z.ZodOptional<z.ZodNumber>;
        y: z.ZodOptional<z.ZodNumber>;
        gatherKind: z.ZodOptional<z.ZodEnum<{
            chest: "chest";
            fishing: "fishing";
            herb: "herb";
            ore: "ore";
            other: "other";
        }>>;
        sourceObjectName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly quest: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"quest">;
        questId: z.ZodNumber;
        title: z.ZodString;
        level: z.ZodNumber;
        giverNpcId: z.ZodOptional<z.ZodNumber>;
        turnInNpcId: z.ZodOptional<z.ZodNumber>;
        rewardItemIds: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
        category: z.ZodOptional<z.ZodString>;
        faction: z.ZodOptional<z.ZodEnum<{
            alliance: "alliance";
            horde: "horde";
        }>>;
        suggestedGroup: z.ZodOptional<z.ZodNumber>;
        tag: z.ZodOptional<z.ZodEnum<{
            dungeon: "dungeon";
            group: "group";
            pvp: "pvp";
            raid: "raid";
        }>>;
    }, z.core.$strip>;
    readonly vendor: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"vendor">;
        vendorNpcId: z.ZodNumber;
        items: z.ZodArray<z.ZodObject<{
            itemId: z.ZodNumber;
            priceCopper: z.ZodNumber;
            limitedStock: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly item_seen: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"item_seen">;
        itemId: z.ZodNumber;
        name: z.ZodString;
        quality: z.ZodEnum<{
            artifact: "artifact";
            common: "common";
            epic: "epic";
            heirloom: "heirloom";
            legendary: "legendary";
            poor: "poor";
            rare: "rare";
            uncommon: "uncommon";
        }>;
        itemLevel: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    readonly instance_entrance: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"instance_entrance">;
        instanceMapId: z.ZodNumber;
        name: z.ZodString;
        instanceType: z.ZodEnum<{
            party: "party";
            raid: "raid";
        }>;
        difficulty: z.ZodOptional<z.ZodNumber>;
        mapId: z.ZodNumber;
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>;
    readonly encounter: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"encounter">;
        encounterId: z.ZodNumber;
        name: z.ZodString;
        instanceMapId: z.ZodNumber;
        difficulty: z.ZodOptional<z.ZodNumber>;
        size: z.ZodOptional<z.ZodNumber>;
        success: z.ZodBoolean;
        npcIds: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strip>;
    readonly object_sighting: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"object_sighting">;
        objectId: z.ZodNumber;
        name: z.ZodString;
        mapId: z.ZodNumber;
        x: z.ZodNumber;
        y: z.ZodNumber;
        instanceMapId: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    readonly item_fact: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"item_fact">;
        itemId: z.ZodNumber;
        fact: z.ZodEnum<{
            agility: "agility";
            arcane_resistance: "arcane_resistance";
            armor: "armor";
            attack_power: "attack_power";
            block: "block";
            block_rating: "block_rating";
            crit_rating: "crit_rating";
            damage_per_second: "damage_per_second";
            defense_rating: "defense_rating";
            dodge_rating: "dodge_rating";
            expertise_rating: "expertise_rating";
            fire_resistance: "fire_resistance";
            frost_resistance: "frost_resistance";
            haste_rating: "haste_rating";
            health: "health";
            hit_rating: "hit_rating";
            holy_resistance: "holy_resistance";
            intellect: "intellect";
            mana: "mana";
            mana_regeneration: "mana_regeneration";
            nature_resistance: "nature_resistance";
            parry_rating: "parry_rating";
            resilience_rating: "resilience_rating";
            shadow_resistance: "shadow_resistance";
            spell_power: "spell_power";
            spirit: "spirit";
            stamina: "stamina";
            strength: "strength";
        }>;
        value: z.ZodNumber;
        clientBuild: z.ZodString;
    }, z.core.$strip>;
    readonly guild_snapshot: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"guild_snapshot">;
        guildName: z.ZodString;
        realm: z.ZodString;
        faction: z.ZodEnum<{
            alliance: "alliance";
            horde: "horde";
        }>;
        claimToken: z.ZodOptional<z.ZodString>;
        members: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            rank: z.ZodString;
            level: z.ZodNumber;
            class: z.ZodString;
            lastOnlineDays: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly raid_lockout: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"raid_lockout">;
        guildName: z.ZodString;
        realm: z.ZodString;
        instance: z.ZodString;
        difficulty: z.ZodString;
        bossesKilled: z.ZodArray<z.ZodString>;
        resetAt: z.ZodString;
    }, z.core.$strip>;
    readonly attendance: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"attendance">;
        guildName: z.ZodString;
        realm: z.ZodString;
        instance: z.ZodString;
        present: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    readonly loot_award: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"loot_award">;
        guildName: z.ZodString;
        realm: z.ZodString;
        itemId: z.ZodNumber;
        itemName: z.ZodString;
        recipient: z.ZodString;
        sourceBoss: z.ZodString;
    }, z.core.$strip>;
    readonly gear_snapshot: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"gear_snapshot">;
        character: z.ZodString;
        realm: z.ZodString;
        equipped: z.ZodArray<z.ZodObject<{
            slot: z.ZodString;
            itemId: z.ZodNumber;
            itemLevel: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly collection_catalog: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"collection_catalog">;
        collection: z.ZodString;
        source: z.ZodString;
        itemId: z.ZodNumber;
    }, z.core.$strip>;
    readonly collection_owned: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"collection_owned">;
        collection: z.ZodString;
        itemId: z.ZodNumber;
    }, z.core.$strip>;
    readonly achievement_catalog: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"achievement_catalog">;
        achievementId: z.ZodNumber;
        name: z.ZodString;
        categoryId: z.ZodNumber;
        category: z.ZodString;
        parentCategory: z.ZodOptional<z.ZodString>;
        points: z.ZodNumber;
        criteriaCount: z.ZodNumber;
        criteria: z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            required: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly reputation_catalog: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"reputation_catalog">;
        factionId: z.ZodNumber;
        name: z.ZodString;
        header: z.ZodOptional<z.ZodString>;
        major: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    readonly title_catalog: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"title_catalog">;
        titleId: z.ZodNumber;
        name: z.ZodString;
    }, z.core.$strip>;
    readonly quest_chain_catalog: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"quest_chain_catalog">;
        questLineId: z.ZodNumber;
        name: z.ZodString;
        questIds: z.ZodArray<z.ZodNumber>;
        truncated: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    readonly achievement_owned: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        characterKey: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        kind: z.ZodLiteral<"achievement_owned">;
        achievementId: z.ZodNumber;
        completed: z.ZodBoolean;
        earnedByMe: z.ZodOptional<z.ZodBoolean>;
        earnedOn: z.ZodOptional<z.ZodString>;
        criteriaMet: z.ZodNumber;
        criteriaTotal: z.ZodNumber;
        quantity: z.ZodOptional<z.ZodNumber>;
        required: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    readonly reputation_owned: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        characterKey: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        kind: z.ZodLiteral<"reputation_owned">;
        factionId: z.ZodNumber;
        reaction: z.ZodNumber;
        standing: z.ZodNumber;
        floor: z.ZodNumber;
        ceiling: z.ZodNumber;
    }, z.core.$strip>;
    readonly title_owned: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        characterKey: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        kind: z.ZodLiteral<"title_owned">;
        titleIds: z.ZodArray<z.ZodNumber>;
    }, z.core.$strip>;
    readonly quest_owned: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        characterKey: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        kind: z.ZodLiteral<"quest_owned">;
        questIds: z.ZodArray<z.ZodNumber>;
    }, z.core.$strip>;
    readonly auction_scan: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"auction_scan">;
        realm: z.ZodString;
        itemId: z.ZodNumber;
        copper: z.ZodNumber;
        count: z.ZodOptional<z.ZodNumber>;
        priceBasis: z.ZodOptional<z.ZodLiteral<"unit">>;
    }, z.core.$strip>;
    readonly auction_snapshot: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"auction_snapshot">;
        realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        faction: z.ZodOptional<z.ZodEnum<{
            Alliance: "Alliance";
            Horde: "Horde";
        }>>;
        house: z.ZodOptional<z.ZodEnum<{
            Alliance: "Alliance";
            Horde: "Horde";
            Neutral: "Neutral";
        }>>;
        scanId: z.ZodString;
        part: z.ZodNumber;
        parts: z.ZodNumber;
        items: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>>;
    }, z.core.$strip>;
    readonly recipe_seen: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"recipe_seen">;
        profession: z.ZodString;
        recipe: z.ZodString;
        skillMin: z.ZodNumber;
        skillMax: z.ZodNumber;
        points: z.ZodNumber;
        reagents: z.ZodArray<z.ZodObject<{
            item: z.ZodString;
            count: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly price_seen: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"price_seen">;
        item: z.ZodString;
        copper: z.ZodNumber;
    }, z.core.$strip>;
    readonly recipe_observed: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"recipe_observed">;
        profession: z.ZodString;
        rank: z.ZodNumber;
        maxRank: z.ZodOptional<z.ZodNumber>;
        recipe: z.ZodString;
        difficulty: z.ZodEnum<{
            easy: "easy";
            medium: "medium";
            optimal: "optimal";
            trivial: "trivial";
        }>;
        productItemId: z.ZodOptional<z.ZodNumber>;
        reagents: z.ZodArray<z.ZodObject<{
            item: z.ZodString;
            count: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly trainer_seen: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"trainer_seen">;
        profession: z.ZodString;
        recipe: z.ZodString;
        requiredRank: z.ZodNumber;
        costCopper: z.ZodOptional<z.ZodNumber>;
        trainerNpcId: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    readonly gold_snapshot: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"gold_snapshot">;
        character: z.ZodString;
        realm: z.ZodString;
        currentCopper: z.ZodNumber;
        peakCopper: z.ZodNumber;
    }, z.core.$strip>;
    readonly money_event: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"money_event">;
        character: z.ZodString;
        realm: z.ZodString;
        category: z.ZodEnum<{
            auction: "auction";
            auction_spend: "auction_spend";
            barber: "barber";
            flight: "flight";
            loot: "loot";
            postage: "postage";
            quest: "quest";
            respec: "respec";
            vendor: "vendor";
        }>;
        copper: z.ZodNumber;
    }, z.core.$strip>;
    readonly addon_seen: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"addon_seen">;
        name: z.ZodString;
        title: z.ZodString;
        version: z.ZodOptional<z.ZodString>;
        loaded: z.ZodBoolean;
    }, z.core.$strip>;
    readonly map_bounds: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"map_bounds">;
        mapId: z.ZodNumber;
        continentId: z.ZodNumber;
        left: z.ZodNumber;
        top: z.ZodNumber;
        right: z.ZodNumber;
        bottom: z.ZodNumber;
    }, z.core.$strip>;
    readonly talent_snapshot: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"talent_snapshot">;
        class: z.ZodString;
        level: z.ZodNumber;
        group: z.ZodNumber;
        active: z.ZodBoolean;
        configId: z.ZodNumber;
        treeId: z.ZodNumber;
        specId: z.ZodOptional<z.ZodNumber>;
        clientBuild: z.ZodOptional<z.ZodString>;
        serializationVersion: z.ZodOptional<z.ZodNumber>;
        loadoutString: z.ZodOptional<z.ZodString>;
        exportStatus: z.ZodEnum<{
            empty: "empty";
            failed: "failed";
            ok: "ok";
            unavailable: "unavailable";
            unexpected: "unexpected";
        }>;
        points: z.ZodNumber;
        nodes: z.ZodArray<z.ZodObject<{
            nodeId: z.ZodNumber;
            ranks: z.ZodNumber;
            choice: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly census_self: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        guid: z.ZodString;
        race: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        faction: z.ZodEnum<{
            Alliance: "Alliance";
            Horde: "Horde";
        }>;
        kind: z.ZodLiteral<"census_self">;
        realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        via: z.ZodOptional<z.ZodNever>;
    }, z.core.$strip>;
    readonly census_seen: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        guid: z.ZodString;
        race: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        faction: z.ZodEnum<{
            Alliance: "Alliance";
            Horde: "Horde";
        }>;
        kind: z.ZodLiteral<"census_seen">;
        via: z.ZodEnum<{
            group: "group";
            mouseover: "mouseover";
            target: "target";
        }>;
        realm: z.ZodOptional<z.ZodNever>;
    }, z.core.$strip>;
    readonly player_seen: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"player_seen">;
        name: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        race: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        guild: z.ZodOptional<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strip>;
    readonly character_link: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"character_link">;
        code: z.ZodString;
        name: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        race: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        faction: z.ZodEnum<{
            Alliance: "Alliance";
            Horde: "Horde";
        }>;
        guid: z.ZodString;
        completionKey: z.ZodString;
    }, z.core.$strip>;
    readonly guild_kill: z.ZodObject<{
        installId: z.ZodString;
        eventId: z.ZodOptional<z.ZodString>;
        capturedAt: z.ZodString;
        kind: z.ZodLiteral<"guild_kill">;
        guildName: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        faction: z.ZodEnum<{
            alliance: "alliance";
            horde: "horde";
        }>;
        encounterId: z.ZodNumber;
        name: z.ZodString;
        instanceMapId: z.ZodNumber;
        difficulty: z.ZodOptional<z.ZodNumber>;
        size: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
};
export type RecordKind = keyof typeof recordSchemas;
export declare const ALL_RECORD_KINDS: RecordKind[];
export declare const PUBLIC_RECORD_KINDS: readonly string[];
export declare const anyRecord: z.ZodDiscriminatedUnion<[z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"npc_sighting">;
    npcId: z.ZodNumber;
    name: z.ZodString;
    mapId: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
    level: z.ZodOptional<z.ZodNumber>;
    reaction: z.ZodOptional<z.ZodEnum<{
        friendly: "friendly";
        hostile: "hostile";
        neutral: "neutral";
    }>>;
    positionKind: z.ZodOptional<z.ZodEnum<{
        interaction: "interaction";
        npc: "npc";
        player: "player";
        vignette: "vignette";
    }>>;
    role: z.ZodOptional<z.ZodEnum<{
        auctioneer: "auctioneer";
        banker: "banker";
        flightmaster: "flightmaster";
        innkeeper: "innkeeper";
        questgiver: "questgiver";
        repair: "repair";
        stablemaster: "stablemaster";
        trainer: "trainer";
        vendor: "vendor";
    }>>;
    creatureType: z.ZodOptional<z.ZodEnum<{
        Beast: "Beast";
        Critter: "Critter";
        Demon: "Demon";
        Dragonkin: "Dragonkin";
        Elemental: "Elemental";
        "Gas Cloud": "Gas Cloud";
        Giant: "Giant";
        Humanoid: "Humanoid";
        Mechanical: "Mechanical";
        "Non-combat Pet": "Non-combat Pet";
        "Not specified": "Not specified";
        Totem: "Totem";
        Undead: "Undead";
    }>>;
    rank: z.ZodOptional<z.ZodEnum<{
        boss: "boss";
        elite: "elite";
        normal: "normal";
        rare: "rare";
        rare_elite: "rare_elite";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"loot">;
    sourceNpcId: z.ZodOptional<z.ZodNumber>;
    sourceObjectId: z.ZodOptional<z.ZodNumber>;
    sourceItemId: z.ZodOptional<z.ZodNumber>;
    lootType: z.ZodOptional<z.ZodEnum<{
        container: "container";
        disenchant: "disenchant";
        fishing: "fishing";
        gather: "gather";
        kill: "kill";
        pickpocket: "pickpocket";
        skinning: "skinning";
    }>>;
    copper: z.ZodOptional<z.ZodNumber>;
    sourceEvidence: z.ZodOptional<z.ZodLiteral<"loot-api">>;
    items: z.ZodArray<z.ZodObject<{
        itemId: z.ZodNumber;
        count: z.ZodNumber;
    }, z.core.$strip>>;
    mapId: z.ZodOptional<z.ZodNumber>;
    x: z.ZodOptional<z.ZodNumber>;
    y: z.ZodOptional<z.ZodNumber>;
    gatherKind: z.ZodOptional<z.ZodEnum<{
        chest: "chest";
        fishing: "fishing";
        herb: "herb";
        ore: "ore";
        other: "other";
    }>>;
    sourceObjectName: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"quest">;
    questId: z.ZodNumber;
    title: z.ZodString;
    level: z.ZodNumber;
    giverNpcId: z.ZodOptional<z.ZodNumber>;
    turnInNpcId: z.ZodOptional<z.ZodNumber>;
    rewardItemIds: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
    category: z.ZodOptional<z.ZodString>;
    faction: z.ZodOptional<z.ZodEnum<{
        alliance: "alliance";
        horde: "horde";
    }>>;
    suggestedGroup: z.ZodOptional<z.ZodNumber>;
    tag: z.ZodOptional<z.ZodEnum<{
        dungeon: "dungeon";
        group: "group";
        pvp: "pvp";
        raid: "raid";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"vendor">;
    vendorNpcId: z.ZodNumber;
    items: z.ZodArray<z.ZodObject<{
        itemId: z.ZodNumber;
        priceCopper: z.ZodNumber;
        limitedStock: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"item_seen">;
    itemId: z.ZodNumber;
    name: z.ZodString;
    quality: z.ZodEnum<{
        artifact: "artifact";
        common: "common";
        epic: "epic";
        heirloom: "heirloom";
        legendary: "legendary";
        poor: "poor";
        rare: "rare";
        uncommon: "uncommon";
    }>;
    itemLevel: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"instance_entrance">;
    instanceMapId: z.ZodNumber;
    name: z.ZodString;
    instanceType: z.ZodEnum<{
        party: "party";
        raid: "raid";
    }>;
    difficulty: z.ZodOptional<z.ZodNumber>;
    mapId: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"encounter">;
    encounterId: z.ZodNumber;
    name: z.ZodString;
    instanceMapId: z.ZodNumber;
    difficulty: z.ZodOptional<z.ZodNumber>;
    size: z.ZodOptional<z.ZodNumber>;
    success: z.ZodBoolean;
    npcIds: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"object_sighting">;
    objectId: z.ZodNumber;
    name: z.ZodString;
    mapId: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
    instanceMapId: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"item_fact">;
    itemId: z.ZodNumber;
    fact: z.ZodEnum<{
        agility: "agility";
        arcane_resistance: "arcane_resistance";
        armor: "armor";
        attack_power: "attack_power";
        block: "block";
        block_rating: "block_rating";
        crit_rating: "crit_rating";
        damage_per_second: "damage_per_second";
        defense_rating: "defense_rating";
        dodge_rating: "dodge_rating";
        expertise_rating: "expertise_rating";
        fire_resistance: "fire_resistance";
        frost_resistance: "frost_resistance";
        haste_rating: "haste_rating";
        health: "health";
        hit_rating: "hit_rating";
        holy_resistance: "holy_resistance";
        intellect: "intellect";
        mana: "mana";
        mana_regeneration: "mana_regeneration";
        nature_resistance: "nature_resistance";
        parry_rating: "parry_rating";
        resilience_rating: "resilience_rating";
        shadow_resistance: "shadow_resistance";
        spell_power: "spell_power";
        spirit: "spirit";
        stamina: "stamina";
        strength: "strength";
    }>;
    value: z.ZodNumber;
    clientBuild: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"guild_snapshot">;
    guildName: z.ZodString;
    realm: z.ZodString;
    faction: z.ZodEnum<{
        alliance: "alliance";
        horde: "horde";
    }>;
    claimToken: z.ZodOptional<z.ZodString>;
    members: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        rank: z.ZodString;
        level: z.ZodNumber;
        class: z.ZodString;
        lastOnlineDays: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"raid_lockout">;
    guildName: z.ZodString;
    realm: z.ZodString;
    instance: z.ZodString;
    difficulty: z.ZodString;
    bossesKilled: z.ZodArray<z.ZodString>;
    resetAt: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"attendance">;
    guildName: z.ZodString;
    realm: z.ZodString;
    instance: z.ZodString;
    present: z.ZodArray<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"loot_award">;
    guildName: z.ZodString;
    realm: z.ZodString;
    itemId: z.ZodNumber;
    itemName: z.ZodString;
    recipient: z.ZodString;
    sourceBoss: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"gear_snapshot">;
    character: z.ZodString;
    realm: z.ZodString;
    equipped: z.ZodArray<z.ZodObject<{
        slot: z.ZodString;
        itemId: z.ZodNumber;
        itemLevel: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"collection_catalog">;
    collection: z.ZodString;
    source: z.ZodString;
    itemId: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"collection_owned">;
    collection: z.ZodString;
    itemId: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"achievement_catalog">;
    achievementId: z.ZodNumber;
    name: z.ZodString;
    categoryId: z.ZodNumber;
    category: z.ZodString;
    parentCategory: z.ZodOptional<z.ZodString>;
    points: z.ZodNumber;
    criteriaCount: z.ZodNumber;
    criteria: z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        required: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"reputation_catalog">;
    factionId: z.ZodNumber;
    name: z.ZodString;
    header: z.ZodOptional<z.ZodString>;
    major: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"title_catalog">;
    titleId: z.ZodNumber;
    name: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"quest_chain_catalog">;
    questLineId: z.ZodNumber;
    name: z.ZodString;
    questIds: z.ZodArray<z.ZodNumber>;
    truncated: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"achievement_owned">;
    achievementId: z.ZodNumber;
    completed: z.ZodBoolean;
    earnedByMe: z.ZodOptional<z.ZodBoolean>;
    earnedOn: z.ZodOptional<z.ZodString>;
    criteriaMet: z.ZodNumber;
    criteriaTotal: z.ZodNumber;
    quantity: z.ZodOptional<z.ZodNumber>;
    required: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"reputation_owned">;
    factionId: z.ZodNumber;
    reaction: z.ZodNumber;
    standing: z.ZodNumber;
    floor: z.ZodNumber;
    ceiling: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"title_owned">;
    titleIds: z.ZodArray<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"quest_owned">;
    questIds: z.ZodArray<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"auction_scan">;
    realm: z.ZodString;
    itemId: z.ZodNumber;
    copper: z.ZodNumber;
    count: z.ZodOptional<z.ZodNumber>;
    priceBasis: z.ZodOptional<z.ZodLiteral<"unit">>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"auction_snapshot">;
    realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    faction: z.ZodOptional<z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
    }>>;
    house: z.ZodOptional<z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
        Neutral: "Neutral";
    }>>;
    scanId: z.ZodString;
    part: z.ZodNumber;
    parts: z.ZodNumber;
    items: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"recipe_seen">;
    profession: z.ZodString;
    recipe: z.ZodString;
    skillMin: z.ZodNumber;
    skillMax: z.ZodNumber;
    points: z.ZodNumber;
    reagents: z.ZodArray<z.ZodObject<{
        item: z.ZodString;
        count: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"price_seen">;
    item: z.ZodString;
    copper: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"recipe_observed">;
    profession: z.ZodString;
    rank: z.ZodNumber;
    maxRank: z.ZodOptional<z.ZodNumber>;
    recipe: z.ZodString;
    difficulty: z.ZodEnum<{
        easy: "easy";
        medium: "medium";
        optimal: "optimal";
        trivial: "trivial";
    }>;
    productItemId: z.ZodOptional<z.ZodNumber>;
    reagents: z.ZodArray<z.ZodObject<{
        item: z.ZodString;
        count: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"trainer_seen">;
    profession: z.ZodString;
    recipe: z.ZodString;
    requiredRank: z.ZodNumber;
    costCopper: z.ZodOptional<z.ZodNumber>;
    trainerNpcId: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"gold_snapshot">;
    character: z.ZodString;
    realm: z.ZodString;
    currentCopper: z.ZodNumber;
    peakCopper: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"money_event">;
    character: z.ZodString;
    realm: z.ZodString;
    category: z.ZodEnum<{
        auction: "auction";
        auction_spend: "auction_spend";
        barber: "barber";
        flight: "flight";
        loot: "loot";
        postage: "postage";
        quest: "quest";
        respec: "respec";
        vendor: "vendor";
    }>;
    copper: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"addon_seen">;
    name: z.ZodString;
    title: z.ZodString;
    version: z.ZodOptional<z.ZodString>;
    loaded: z.ZodBoolean;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"map_bounds">;
    mapId: z.ZodNumber;
    continentId: z.ZodNumber;
    left: z.ZodNumber;
    top: z.ZodNumber;
    right: z.ZodNumber;
    bottom: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"talent_snapshot">;
    class: z.ZodString;
    level: z.ZodNumber;
    group: z.ZodNumber;
    active: z.ZodBoolean;
    configId: z.ZodNumber;
    treeId: z.ZodNumber;
    specId: z.ZodOptional<z.ZodNumber>;
    clientBuild: z.ZodOptional<z.ZodString>;
    serializationVersion: z.ZodOptional<z.ZodNumber>;
    loadoutString: z.ZodOptional<z.ZodString>;
    exportStatus: z.ZodEnum<{
        empty: "empty";
        failed: "failed";
        ok: "ok";
        unavailable: "unavailable";
        unexpected: "unexpected";
    }>;
    points: z.ZodNumber;
    nodes: z.ZodArray<z.ZodObject<{
        nodeId: z.ZodNumber;
        ranks: z.ZodNumber;
        choice: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    guid: z.ZodString;
    race: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    faction: z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
    }>;
    kind: z.ZodLiteral<"census_self">;
    realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    via: z.ZodOptional<z.ZodNever>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    guid: z.ZodString;
    race: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    faction: z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
    }>;
    kind: z.ZodLiteral<"census_seen">;
    via: z.ZodEnum<{
        group: "group";
        mouseover: "mouseover";
        target: "target";
    }>;
    realm: z.ZodOptional<z.ZodNever>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"player_seen">;
    name: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    race: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    guild: z.ZodOptional<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"character_link">;
    code: z.ZodString;
    name: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    race: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    faction: z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
    }>;
    guid: z.ZodString;
    completionKey: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    installId: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
    kind: z.ZodLiteral<"guild_kill">;
    guildName: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    realm: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    faction: z.ZodEnum<{
        alliance: "alliance";
        horde: "horde";
    }>;
    encounterId: z.ZodNumber;
    name: z.ZodString;
    instanceMapId: z.ZodNumber;
    difficulty: z.ZodOptional<z.ZodNumber>;
    size: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>], "kind">;
export type IntakeRecord = z.infer<typeof anyRecord>;
/**
 * A record as intake stores it in an upload: census rows have their GUID swapped for a key, player rows are
 * not in the upload at all (they go to the players table), link rows are never stored, every other kind is as parsed.
 */
export type StoredRecord = Exclude<IntakeRecord, {
    kind: "census_self" | "census_seen" | "player_seen" | "character_link";
}> | StoredCensusRecord;
/** Where an upload's rows came from when the Everloot addon did not write them. */
export declare const UPLOAD_SOURCES: readonly ["polestar_recorder"];
export type UploadSource = (typeof UPLOAD_SOURCES)[number];
/** The request envelope. `protocol` is the uploader's protocol version; a missing one means major 1. */
export declare const uploadPayload: z.ZodObject<{
    addonVersion: z.ZodString;
    clientBuild: z.ZodOptional<z.ZodString>;
    protocol: z.ZodOptional<z.ZodString>;
    source: z.ZodOptional<z.ZodEnum<{
        polestar_recorder: "polestar_recorder";
    }>>;
    records: z.ZodArray<z.ZodUnknown>;
}, z.core.$strip>;
