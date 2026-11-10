import { z } from "zod";
/**
 * The Everloot MCP server's tools: names, titles, descriptions, input schemas and annotations, in the
 * order the server lists them. kb/src/mcp-server.ts registers from this table and supplies the handlers;
 * the connect page and llms.txt list from it; schema/mcp/<tool>.json is generated from it. Every tool
 * is read-only, and its annotations say so with all four hints (readOnlyHint, destructiveHint, idempotentHint,
 * openWorldHint), so a directory never has to assume the worst for one it cannot read. Today every tool answers
 * with one text block (TOOL_OUTPUT); structured output is a later minor release, tool by tool.
 */
/** Record kinds in the knowledge release (lore and reference data). */
export declare const KNOWLEDGE_KINDS: readonly ["item", "npc", "object", "quest", "zone", "spell", "lore_page", "creator", "realm", "achievement", "faction", "title", "quest_chain", "mount", "legacy_perk", "race", "instance", "build"];
/** Game versions a knowledge record can belong to. */
export declare const GAME_VERSIONS: readonly ["forever", "classic", "retail", "lore"];
/** Entities relation edges connect. A zone is a UiMap id. */
export declare const ENTITY_KINDS: readonly ["item", "spell", "npc", "object", "quest", "zone", "item_set", "icon", "skill"];
export type EntityKind = (typeof ENTITY_KINDS)[number];
/** Typed relations between entities, in the order pages list them: what players saw first, then what the files say. */
export declare const RELS: readonly ["dropped_by", "sold_by", "reward_from", "located_in", "created_by", "reagent_for", "part_of_set", "same_icon", "in_skill_line"];
export type Rel = (typeof RELS)[number];
/** recent_changes filters. */
export declare const CHANGE_FILTERS: readonly ["all", "posts", "hotfixes", "builds"];
export type ChangeFilter = (typeof CHANGE_FILTERS)[number];
/** ecosystem_projects boards, and the filter that adds "all" (A to Z). */
export declare const BOARD_IDS: readonly ["installed", "rising", "active", "release", "maintained"];
export type BoardId = (typeof BOARD_IDS)[number];
export declare const ECOSYSTEM_BOARD_FILTERS: readonly ["all", "installed", "rising", "active", "release", "maintained"];
/** world_map_near: radius in yards and results per list. */
export declare const NEAR_DEFAULT_RADIUS = 500;
export declare const NEAR_MAX_RADIUS = 5000;
export declare const NEAR_DEFAULT_LIMIT = 5;
export declare const NEAR_MAX_LIMIT = 20;
/** Item quality slugs in Enum.ItemQuality order. */
export declare const ITEM_QUALITY_SLUGS: readonly ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
/** The classes with a talent catalog, in the site's order (web/src/lib/talents/catalogs.ts). */
export declare const TALENT_CLASSES: readonly ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
export type TalentClass = (typeof TALENT_CLASSES)[number];
/** One talent node as talent_tree returns it: the calculator's own shape, positions 1-based. */
export declare const talentNode: z.ZodObject<{
    id: z.ZodNumber;
    treeId: z.ZodNumber;
    row: z.ZodNumber;
    col: z.ZodNumber;
    kind: z.ZodEnum<{
        choice: "choice";
        single: "single";
        tiered: "tiered";
    }>;
    maxRanks: z.ZodNumber;
    talents: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        spellId: z.ZodNullable<z.ZodNumber>;
        maxRanks: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    prereqs: z.ZodArray<z.ZodNumber>;
    anyOf: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    gate: z.ZodOptional<z.ZodObject<{
        pointsInTree: z.ZodOptional<z.ZodNumber>;
        pointsTotal: z.ZodOptional<z.ZodNumber>;
        scope: z.ZodOptional<z.ZodEnum<{
            class: "class";
            tree: "tree";
            unconfirmed: "unconfirmed";
        }>>;
        ranksInNodes: z.ZodOptional<z.ZodArray<z.ZodObject<{
            nodeId: z.ZodNumber;
            ranks: z.ZodNumber;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type TalentNodeOut = z.infer<typeof talentNode>;
/** One tree of a plan, with the points spent in it. */
export declare const talentTreePoints: z.ZodObject<{
    id: z.ZodNumber;
    name: z.ZodString;
    points: z.ZodNumber;
}, z.core.$strip>;
/** One item's category path as item_categories returns it. Null parts are not in the build's tables. */
export declare const itemCategory: z.ZodObject<{
    itemId: z.ZodNumber;
    class: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        name: z.ZodString;
        label: z.ZodString;
        slug: z.ZodString;
    }, z.core.$strip>>;
    subclass: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        name: z.ZodNullable<z.ZodString>;
        slug: z.ZodString;
    }, z.core.$strip>>;
    slot: z.ZodNullable<z.ZodObject<{
        inventoryType: z.ZodNumber;
        name: z.ZodString;
        slug: z.ZodString;
    }, z.core.$strip>>;
    quality: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        name: z.ZodString;
        slug: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ItemCategoryOut = z.infer<typeof itemCategory>;
/** One project as ecosystem_projects returns it. GitHub facts carry the time they were refreshed in the answer. */
export declare const ecosystemProject: z.ZodObject<{
    rank: z.ZodOptional<z.ZodNumber>;
    display: z.ZodOptional<z.ZodString>;
    id: z.ZodString;
    name: z.ZodString;
    kind: z.ZodEnum<{
        addon: "addon";
        tool: "tool";
    }>;
    summary: z.ZodString;
    repo: z.ZodString;
    url: z.ZodString;
    installs: z.ZodNullable<z.ZodNumber>;
    stars: z.ZodNullable<z.ZodNumber>;
    release: z.ZodNullable<z.ZodObject<{
        tag: z.ZodString;
        date: z.ZodString;
        url: z.ZodString;
    }, z.core.$strip>>;
    lastCommit: z.ZodNullable<z.ZodString>;
    commits4w: z.ZodNullable<z.ZodNumber>;
    foreverReady: z.ZodEnum<{
        no: "no";
        unknown: "unknown";
        yes: "yes";
    }>;
    badges: z.ZodArray<z.ZodString>;
    maintenanceScore: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export type EcosystemProjectOut = z.infer<typeof ecosystemProject>;
/**
 * What an answer's `url` means. Absent when the answer has no page, or its page would be empty or not
 * indexed; a page link never stands in for a fact the answer does not hold.
 */
export declare const PAGE_URL = "The everloot.app page that shows this answer, absolute. Absent when there is no such page or it would be empty.";
/**
 * What every structured answer built on player uploads starts with. connected false means no corpus
 * was read (not connected, or unavailable): the page is then absent, and that is not a measured zero.
 */
export declare const uploadsAnswer: {
    connected: z.ZodBoolean;
    dataAsOf: z.ZodNullable<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
};
/** One source of an item with its observed loot-window frequency; public after 3 distinct install reports. */
export declare const itemDrop: z.ZodObject<{
    sourceNpcId: z.ZodOptional<z.ZodNumber>;
    sourceObjectId: z.ZodOptional<z.ZodNumber>;
    source: z.ZodString;
    kills: z.ZodNumber;
    drops: z.ZodNumber;
    rate: z.ZodNumber;
    reporters: z.ZodNumber;
}, z.core.$strip>;
export declare const mapPin: z.ZodObject<{
    npcId: z.ZodNumber;
    name: z.ZodNullable<z.ZodString>;
    mapId: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
    reporters: z.ZodNumber;
}, z.core.$strip>;
/** Loot windows players reported that the public rates do not count yet. A count, never a rate. */
export declare const pendingLoot: z.ZodObject<{
    windows: z.ZodNumber;
    reporters: z.ZodNumber;
}, z.core.$strip>;
export declare const itemPage: z.ZodObject<{
    itemId: z.ZodNumber;
    name: z.ZodNullable<z.ZodString>;
    drops: z.ZodArray<z.ZodObject<{
        sourceNpcId: z.ZodOptional<z.ZodNumber>;
        sourceObjectId: z.ZodOptional<z.ZodNumber>;
        source: z.ZodString;
        kills: z.ZodNumber;
        drops: z.ZodNumber;
        rate: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>;
    pins: z.ZodArray<z.ZodObject<{
        npcId: z.ZodNumber;
        name: z.ZodNullable<z.ZodString>;
        mapId: z.ZodNumber;
        x: z.ZodNumber;
        y: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>;
    pendingLoot: z.ZodOptional<z.ZodObject<{
        windows: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>;
    reported: z.ZodOptional<z.ZodObject<{
        shown: z.ZodArray<z.ZodObject<{
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
            reporters: z.ZodNumber;
            build: z.ZodString;
            lastSeen: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        contested: z.ZodArray<z.ZodEnum<{
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
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const npcPage: z.ZodObject<{
    npcId: z.ZodNumber;
    name: z.ZodNullable<z.ZodString>;
    pins: z.ZodArray<z.ZodObject<{
        mapId: z.ZodNumber;
        x: z.ZodNumber;
        y: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>;
    pendingLoot: z.ZodOptional<z.ZodObject<{
        windows: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const questPage: z.ZodObject<{
    questId: z.ZodNumber;
    title: z.ZodNullable<z.ZodString>;
    level: z.ZodNullable<z.ZodNumber>;
    giverNpcId: z.ZodNullable<z.ZodNumber>;
    turnInNpcId: z.ZodNullable<z.ZodNumber>;
    rewards: z.ZodArray<z.ZodNumber>;
}, z.core.$strip>;
export declare const vendorOffer: z.ZodObject<{
    itemId: z.ZodNumber;
    priceCopper: z.ZodNumber;
    limitedStock: z.ZodNullable<z.ZodNumber>;
    unlimited: z.ZodBoolean;
    reporters: z.ZodNumber;
}, z.core.$strip>;
export declare const vendorPage: z.ZodObject<{
    vendorNpcId: z.ZodNumber;
    offers: z.ZodArray<z.ZodObject<{
        itemId: z.ZodNumber;
        priceCopper: z.ZodNumber;
        limitedStock: z.ZodNullable<z.ZodNumber>;
        unlimited: z.ZodBoolean;
        reporters: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const objectPage: z.ZodObject<{
    objectId: z.ZodNumber;
    name: z.ZodNullable<z.ZodString>;
    drops: z.ZodArray<z.ZodObject<{
        itemId: z.ZodNumber;
        itemName: z.ZodNullable<z.ZodString>;
        kills: z.ZodNumber;
        drops: z.ZodNumber;
        rate: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>;
    zero: z.ZodNullable<z.ZodObject<{
        kills: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>;
    queued: z.ZodBoolean;
    pendingLoot: z.ZodOptional<z.ZodObject<{
        windows: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>;
    pins: z.ZodOptional<z.ZodArray<z.ZodObject<{
        mapId: z.ZodNumber;
        x: z.ZodNumber;
        y: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const auctionHistory: z.ZodObject<{
    realmStatus: z.ZodOptional<z.ZodEnum<{
        alias: "alias";
        ambiguous: "ambiguous";
        exact: "exact";
        unknown: "unknown";
    }>>;
    askedRealm: z.ZodOptional<z.ZodString>;
    candidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
    realm: z.ZodString;
    itemId: z.ZodNumber;
    points: z.ZodArray<z.ZodObject<{
        day: z.ZodString;
        copper: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>;
    scanDays: z.ZodOptional<z.ZodArray<z.ZodObject<{
        day: z.ZodString;
        min: z.ZodNumber;
        market: z.ZodNumber;
        quantity: z.ZodNumber;
        reporters: z.ZodNumber;
        thin: z.ZodBoolean;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const collectionGap: z.ZodObject<{
    collection: z.ZodString;
    ownerInstallId: z.ZodString;
    groups: z.ZodArray<z.ZodObject<{
        source: z.ZodString;
        owned: z.ZodArray<z.ZodNumber>;
        missing: z.ZodArray<z.ZodNumber>;
    }, z.core.$strip>>;
    queued: z.ZodArray<z.ZodNumber>;
    ownedRecorded: z.ZodBoolean;
}, z.core.$strip>;
/** Who reported a guild's kill: its members' uploads (2 installs agreeing) or its officers' published board. */
export declare const KILL_SOURCES: readonly ["members", "officers"];
export declare const GUILD_FACTIONS: readonly ["alliance", "horde"];
/** One boss in a guild's progression through an instance. */
export declare const guildBossProgress: z.ZodObject<{
    encounterId: z.ZodNumber;
    name: z.ZodString;
    killed: z.ZodBoolean;
    killedAt: z.ZodNullable<z.ZodString>;
    source: z.ZodNullable<z.ZodEnum<{
        members: "members";
        officers: "officers";
    }>>;
}, z.core.$strip>;
/** A guild's standing in one instance: bosses killed out of the bosses 3 installs reported there. */
export declare const guildInstanceProgress: z.ZodObject<{
    instanceMapId: z.ZodNumber;
    name: z.ZodString;
    killed: z.ZodNumber;
    bosses: z.ZodNumber;
    list: z.ZodArray<z.ZodObject<{
        encounterId: z.ZodNumber;
        name: z.ZodString;
        killed: z.ZodBoolean;
        killedAt: z.ZodNullable<z.ZodString>;
        source: z.ZodNullable<z.ZodEnum<{
            members: "members";
            officers: "officers";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** One agreed kill, for a guild's activity feed. */
export declare const guildKillEntry: z.ZodObject<{
    encounterId: z.ZodNumber;
    name: z.ZodString;
    instanceMapId: z.ZodNumber;
    killedAt: z.ZodString;
    source: z.ZodEnum<{
        members: "members";
        officers: "officers";
    }>;
}, z.core.$strip>;
/** A guild's rank in the newest instance it has a kill in. */
export declare const guildRanks: z.ZodObject<{
    instanceMapId: z.ZodNumber;
    instanceName: z.ZodString;
    realm: z.ZodNumber;
    overall: z.ZodNumber;
}, z.core.$strip>;
export declare const guildBoard: z.ZodObject<{
    guildName: z.ZodString;
    realm: z.ZodString;
    memberCount: z.ZodNullable<z.ZodNumber>;
    roster: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        rank: z.ZodString;
        level: z.ZodNumber;
        className: z.ZodString;
    }, z.core.$strip>>;
    progression: z.ZodArray<z.ZodObject<{
        instance: z.ZodString;
        bosses: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    loot: z.ZodArray<z.ZodObject<{
        itemId: z.ZodNumber;
        recipient: z.ZodString;
        sourceBoss: z.ZodString;
    }, z.core.$strip>>;
    averageItemLevel: z.ZodNullable<z.ZodNumber>;
    gearCoverage: z.ZodObject<{
        measured: z.ZodNumber;
        roster: z.ZodNumber;
    }, z.core.$strip>;
    present: z.ZodArray<z.ZodString>;
    attendanceWaiting: z.ZodBoolean;
    ladderProgression: z.ZodOptional<z.ZodArray<z.ZodObject<{
        instanceMapId: z.ZodNumber;
        name: z.ZodString;
        killed: z.ZodNumber;
        bosses: z.ZodNumber;
        list: z.ZodArray<z.ZodObject<{
            encounterId: z.ZodNumber;
            name: z.ZodString;
            killed: z.ZodBoolean;
            killedAt: z.ZodNullable<z.ZodString>;
            source: z.ZodNullable<z.ZodEnum<{
                members: "members";
                officers: "officers";
            }>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    activity: z.ZodOptional<z.ZodArray<z.ZodObject<{
        encounterId: z.ZodNumber;
        name: z.ZodString;
        instanceMapId: z.ZodNumber;
        killedAt: z.ZodString;
        source: z.ZodEnum<{
            members: "members";
            officers: "officers";
        }>;
    }, z.core.$strip>>>;
    seenRoster: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        count: z.ZodNumber;
        members: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            level: z.ZodNumber;
            class: z.ZodString;
            lastSeen: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    ranks: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        instanceMapId: z.ZodNumber;
        instanceName: z.ZodString;
        realm: z.ZodNumber;
        overall: z.ZodNumber;
    }, z.core.$strip>>>;
}, z.core.$strip>;
/** One guild as guild_search lists it. */
export declare const guildSummary: z.ZodObject<{
    guildName: z.ZodString;
    realm: z.ZodString;
    faction: z.ZodNullable<z.ZodEnum<{
        alliance: "alliance";
        horde: "horde";
    }>>;
    membersSeen: z.ZodNullable<z.ZodNumber>;
    kills: z.ZodNumber;
    latestKillAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const guildSearch: z.ZodObject<{
    guilds: z.ZodArray<z.ZodObject<{
        guildName: z.ZodString;
        realm: z.ZodString;
        faction: z.ZodNullable<z.ZodEnum<{
            alliance: "alliance";
            horde: "horde";
        }>>;
        membersSeen: z.ZodNullable<z.ZodNumber>;
        kills: z.ZodNumber;
        latestKillAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** One row of the guild ladder for one instance. */
export declare const ladderRow: z.ZodObject<{
    rank: z.ZodNumber;
    guildName: z.ZodString;
    realm: z.ZodString;
    faction: z.ZodNullable<z.ZodEnum<{
        alliance: "alliance";
        horde: "horde";
    }>>;
    killed: z.ZodNumber;
    bosses: z.ZodNumber;
    latestKillAt: z.ZodNullable<z.ZodString>;
    membersSeen: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const guildRankings: z.ZodObject<{
    instance: z.ZodNullable<z.ZodObject<{
        instanceMapId: z.ZodNumber;
        name: z.ZodString;
    }, z.core.$strip>>;
    rows: z.ZodArray<z.ZodObject<{
        rank: z.ZodNumber;
        guildName: z.ZodString;
        realm: z.ZodString;
        faction: z.ZodNullable<z.ZodEnum<{
            alliance: "alliance";
            horde: "horde";
        }>>;
        killed: z.ZodNumber;
        bosses: z.ZodNumber;
        latestKillAt: z.ZodNullable<z.ZodString>;
        membersSeen: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const professionPath: z.ZodObject<{
    profession: z.ZodString;
    fromSkill: z.ZodNumber;
    toSkill: z.ZodNumber;
    steps: z.ZodArray<z.ZodObject<{
        recipe: z.ZodString;
        fromSkill: z.ZodNumber;
        toSkill: z.ZodNumber;
        crafts: z.ZodNumber;
        points: z.ZodNumber;
        reagents: z.ZodArray<z.ZodObject<{
            item: z.ZodString;
            count: z.ZodNumber;
        }, z.core.$strip>>;
        copper: z.ZodNullable<z.ZodNumber>;
        reporters: z.ZodNumber;
        trainingCopper: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>>;
    gaps: z.ZodArray<z.ZodObject<{
        fromSkill: z.ZodNumber;
        toSkill: z.ZodNumber;
    }, z.core.$strip>>;
    reagents: z.ZodArray<z.ZodObject<{
        item: z.ZodString;
        count: z.ZodNumber;
    }, z.core.$strip>>;
    copper: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const recipeThresholds: z.ZodObject<{
    profession: z.ZodString;
    ranges: z.ZodArray<z.ZodObject<{
        profession: z.ZodString;
        recipe: z.ZodString;
        installs: z.ZodNumber;
        observations: z.ZodNumber;
        yellow: z.ZodObject<{
            min: z.ZodNullable<z.ZodNumber>;
            max: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        green: z.ZodObject<{
            min: z.ZodNullable<z.ZodNumber>;
            max: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        grey: z.ZodObject<{
            min: z.ZodNullable<z.ZodNumber>;
            max: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        reagents: z.ZodNullable<z.ZodArray<z.ZodObject<{
            item: z.ZodString;
            count: z.ZodNumber;
        }, z.core.$strip>>>;
        costCopper: z.ZodNullable<z.ZodNumber>;
        missingPrices: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const characterProgress: z.ZodObject<{
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    achievements: z.ZodObject<{
        done: z.ZodNumber;
        total: z.ZodNumber;
        points: z.ZodNumber;
        pointsTotal: z.ZodNumber;
        closest: z.ZodArray<z.ZodObject<{
            achievementId: z.ZodNumber;
            name: z.ZodString;
            category: z.ZodString;
            have: z.ZodNumber;
            of: z.ZodNumber;
            unit: z.ZodEnum<{
                criteria: "criteria";
                progress: "progress";
            }>;
        }, z.core.$strip>>;
        unlisted: z.ZodNumber;
    }, z.core.$strip>;
    reputation: z.ZodObject<{
        exalted: z.ZodNumber;
        total: z.ZodNumber;
        closest: z.ZodArray<z.ZodObject<{
            factionId: z.ZodNumber;
            name: z.ZodString;
            standing: z.ZodString;
            toNext: z.ZodNumber;
            header: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        unscaled: z.ZodArray<z.ZodObject<{
            factionId: z.ZodNumber;
            name: z.ZodString;
            standing: z.ZodNumber;
        }, z.core.$strip>>;
        unlisted: z.ZodNumber;
    }, z.core.$strip>;
    titles: z.ZodObject<{
        known: z.ZodNumber;
        total: z.ZodNumber;
        unlisted: z.ZodNumber;
    }, z.core.$strip>;
    quests: z.ZodObject<{
        completed: z.ZodNumber;
        chainsDone: z.ZodNumber;
        chainsTotal: z.ZodNumber;
        closest: z.ZodArray<z.ZodObject<{
            questLineId: z.ZodNumber;
            name: z.ZodString;
            done: z.ZodNumber;
            total: z.ZodNumber;
            truncated: z.ZodBoolean;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const completionProgress: z.ZodObject<{
    ownerInstallId: z.ZodString;
    listed: z.ZodObject<{
        achievements: z.ZodNumber;
        factions: z.ZodNumber;
        titles: z.ZodNumber;
        chains: z.ZodNumber;
    }, z.core.$strip>;
    ownedRecorded: z.ZodBoolean;
    characters: z.ZodArray<z.ZodObject<{
        characterKey: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        achievements: z.ZodObject<{
            done: z.ZodNumber;
            total: z.ZodNumber;
            points: z.ZodNumber;
            pointsTotal: z.ZodNumber;
            closest: z.ZodArray<z.ZodObject<{
                achievementId: z.ZodNumber;
                name: z.ZodString;
                category: z.ZodString;
                have: z.ZodNumber;
                of: z.ZodNumber;
                unit: z.ZodEnum<{
                    criteria: "criteria";
                    progress: "progress";
                }>;
            }, z.core.$strip>>;
            unlisted: z.ZodNumber;
        }, z.core.$strip>;
        reputation: z.ZodObject<{
            exalted: z.ZodNumber;
            total: z.ZodNumber;
            closest: z.ZodArray<z.ZodObject<{
                factionId: z.ZodNumber;
                name: z.ZodString;
                standing: z.ZodString;
                toNext: z.ZodNumber;
                header: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            unscaled: z.ZodArray<z.ZodObject<{
                factionId: z.ZodNumber;
                name: z.ZodString;
                standing: z.ZodNumber;
            }, z.core.$strip>>;
            unlisted: z.ZodNumber;
        }, z.core.$strip>;
        titles: z.ZodObject<{
            known: z.ZodNumber;
            total: z.ZodNumber;
            unlisted: z.ZodNumber;
        }, z.core.$strip>;
        quests: z.ZodObject<{
            completed: z.ZodNumber;
            chainsDone: z.ZodNumber;
            chainsTotal: z.ZodNumber;
            closest: z.ZodArray<z.ZodObject<{
                questLineId: z.ZodNumber;
                name: z.ZodString;
                done: z.ZodNumber;
                total: z.ZodNumber;
                truncated: z.ZodBoolean;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    unknownCharacter: z.ZodOptional<z.ZodString>;
    droppedCharacters: z.ZodNumber;
}, z.core.$strip>;
export declare const marketValue: z.ZodObject<{
    itemId: z.ZodNumber;
    market: z.ZodNullable<z.ZodNumber>;
    min: z.ZodNumber;
    historical: z.ZodNumber;
    quantity: z.ZodNumber;
    day: z.ZodString;
    ageDays: z.ZodNumber;
    reporters: z.ZodNumber;
    thin: z.ZodBoolean;
}, z.core.$strip>;
export declare const marketPage: z.ZodObject<{
    realmStatus: z.ZodOptional<z.ZodEnum<{
        alias: "alias";
        ambiguous: "ambiguous";
        exact: "exact";
        unknown: "unknown";
    }>>;
    askedRealm: z.ZodOptional<z.ZodString>;
    candidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
    realm: z.ZodString;
    itemId: z.ZodNumber;
    value: z.ZodNullable<z.ZodObject<{
        itemId: z.ZodNumber;
        market: z.ZodNullable<z.ZodNumber>;
        min: z.ZodNumber;
        historical: z.ZodNumber;
        quantity: z.ZodNumber;
        day: z.ZodString;
        ageDays: z.ZodNumber;
        reporters: z.ZodNumber;
        thin: z.ZodBoolean;
    }, z.core.$strip>>;
    history: z.ZodArray<z.ZodObject<{
        day: z.ZodString;
        min: z.ZodNumber;
        market: z.ZodNumber;
        quantity: z.ZodNumber;
        reporters: z.ZodNumber;
        thin: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const relationEdge: z.ZodObject<{
    fromKind: z.ZodEnum<{
        icon: "icon";
        item: "item";
        item_set: "item_set";
        npc: "npc";
        object: "object";
        quest: "quest";
        skill: "skill";
        spell: "spell";
        zone: "zone";
    }>;
    fromId: z.ZodNumber;
    rel: z.ZodEnum<{
        created_by: "created_by";
        dropped_by: "dropped_by";
        in_skill_line: "in_skill_line";
        located_in: "located_in";
        part_of_set: "part_of_set";
        reagent_for: "reagent_for";
        reward_from: "reward_from";
        same_icon: "same_icon";
        sold_by: "sold_by";
    }>;
    toKind: z.ZodEnum<{
        icon: "icon";
        item: "item";
        item_set: "item_set";
        npc: "npc";
        object: "object";
        quest: "quest";
        skill: "skill";
        spell: "spell";
        zone: "zone";
    }>;
    toId: z.ZodNumber;
    evidence: z.ZodEnum<{
        client: "client";
        observed: "observed";
    }>;
    build: z.ZodNullable<z.ZodString>;
    installs: z.ZodNullable<z.ZodNumber>;
    firstSeen: z.ZodNullable<z.ZodString>;
    lastSeen: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const entityRelations: z.ZodObject<{
    kind: z.ZodEnum<{
        icon: "icon";
        item: "item";
        item_set: "item_set";
        npc: "npc";
        object: "object";
        quest: "quest";
        skill: "skill";
        spell: "spell";
        zone: "zone";
    }>;
    id: z.ZodNumber;
    edges: z.ZodArray<z.ZodObject<{
        fromKind: z.ZodEnum<{
            icon: "icon";
            item: "item";
            item_set: "item_set";
            npc: "npc";
            object: "object";
            quest: "quest";
            skill: "skill";
            spell: "spell";
            zone: "zone";
        }>;
        fromId: z.ZodNumber;
        rel: z.ZodEnum<{
            created_by: "created_by";
            dropped_by: "dropped_by";
            in_skill_line: "in_skill_line";
            located_in: "located_in";
            part_of_set: "part_of_set";
            reagent_for: "reagent_for";
            reward_from: "reward_from";
            same_icon: "same_icon";
            sold_by: "sold_by";
        }>;
        toKind: z.ZodEnum<{
            icon: "icon";
            item: "item";
            item_set: "item_set";
            npc: "npc";
            object: "object";
            quest: "quest";
            skill: "skill";
            spell: "spell";
            zone: "zone";
        }>;
        toId: z.ZodNumber;
        evidence: z.ZodEnum<{
            client: "client";
            observed: "observed";
        }>;
        build: z.ZodNullable<z.ZodString>;
        installs: z.ZodNullable<z.ZodNumber>;
        firstSeen: z.ZodNullable<z.ZodString>;
        lastSeen: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    notShown: z.ZodNumber;
}, z.core.$strip>;
export declare const INCOME_CATEGORIES: readonly ["loot", "quest", "vendor", "auction"];
export declare const SPENDING_CATEGORIES: readonly ["flight", "postage", "barber", "respec", "auction_spend"];
export declare const goldLedger: z.ZodObject<{
    character: z.ZodString;
    realm: z.ZodString;
    recorded: z.ZodBoolean;
    ledgers: z.ZodArray<z.ZodObject<{
        installId: z.ZodString;
        peakCopper: z.ZodNullable<z.ZodNumber>;
        currentCopper: z.ZodNullable<z.ZodNumber>;
        income: z.ZodObject<{
            [x: string]: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
        spending: z.ZodObject<{
            [x: string]: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
        incomeTotal: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const mapNear: z.ZodObject<{
    ok: z.ZodBoolean;
    message: z.ZodOptional<z.ZodString>;
    origin: z.ZodOptional<z.ZodString>;
    radius: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
    entrances: z.ZodOptional<z.ZodArray<z.ZodObject<{
        names: z.ZodArray<z.ZodString>;
        raid: z.ZodBoolean;
        zone: z.ZodNullable<z.ZodString>;
        yards: z.ZodNumber;
        confirmed: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    npcs: z.ZodOptional<z.ZodArray<z.ZodObject<{
        npcId: z.ZodNumber;
        name: z.ZodNullable<z.ZodString>;
        mapId: z.ZodNumber;
        zoneName: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        yards: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>>;
    vendors: z.ZodOptional<z.ZodArray<z.ZodObject<{
        npcId: z.ZodNumber;
        name: z.ZodNullable<z.ZodString>;
        mapId: z.ZodNumber;
        zoneName: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        yards: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>>;
    treasures: z.ZodOptional<z.ZodArray<z.ZodObject<{
        objectId: z.ZodNumber;
        name: z.ZodNullable<z.ZodString>;
        mapId: z.ZodNumber;
        zoneName: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        yards: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>>;
}, z.core.$strip>;
/** The census's factions and windows (population). */
export declare const CENSUS_FACTIONS: readonly ["Alliance", "Horde"];
export declare const CENSUS_WINDOWS: readonly ["week", "launch"];
/** One census count as population returns it. A hidden count is null, never a number. */
export declare const populationCell: z.ZodObject<{
    slice: z.ZodEnum<{
        class: "class";
        faction: "faction";
        level: "level";
        race: "race";
        raceClass: "raceClass";
    }>;
    faction: z.ZodOptional<z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
    }>>;
    race: z.ZodOptional<z.ZodString>;
    class: z.ZodOptional<z.ZodString>;
    band: z.ZodOptional<z.ZodString>;
    label: z.ZodString;
    count: z.ZodNullable<z.ZodNumber>;
    share: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const populationPage: z.ZodObject<{
    scope: z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
    }, z.core.$strip>;
    launched: z.ZodBoolean;
    launch: z.ZodString;
    window: z.ZodObject<{
        id: z.ZodEnum<{
            launch: "launch";
            week: "week";
        }>;
        from: z.ZodString;
        to: z.ZodString;
    }, z.core.$strip>;
    collecting: z.ZodBoolean;
    characters: z.ZodNullable<z.ZodNumber>;
    installs: z.ZodNumber;
    rule: z.ZodObject<{
        minCharacters: z.ZodNumber;
        minInstalls: z.ZodNumber;
        minReporters: z.ZodNumber;
        roundTo: z.ZodNumber;
    }, z.core.$strip>;
    cells: z.ZodArray<z.ZodObject<{
        slice: z.ZodEnum<{
            class: "class";
            faction: "faction";
            level: "level";
            race: "race";
            raceClass: "raceClass";
        }>;
        faction: z.ZodOptional<z.ZodEnum<{
            Alliance: "Alliance";
            Horde: "Horde";
        }>>;
        race: z.ZodOptional<z.ZodString>;
        class: z.ZodOptional<z.ZodString>;
        band: z.ZodOptional<z.ZodString>;
        label: z.ZodString;
        count: z.ZodNullable<z.ZodNumber>;
        share: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    note: z.ZodOptional<z.ZodString>;
    source: z.ZodObject<{
        title: z.ZodString;
        url: z.ZodString;
    }, z.core.$strip>;
    method: z.ZodObject<{
        title: z.ZodString;
        url: z.ZodString;
    }, z.core.$strip>;
    licence: z.ZodString;
}, z.core.$strip>;
export type PopulationCellOut = z.infer<typeof populationCell>;
export type PopulationPageOut = z.infer<typeof populationPage>;
/** One row of the implementation tracker as everloot_plan returns it. */
export declare const planRow: z.ZodObject<{
    id: z.ZodString;
    status: z.ZodEnum<{
        live: "live";
        next: "next";
        shape: "shape";
        waiting: "waiting";
    }>;
    name: z.ZodString;
    done: z.ZodString;
    proof: z.ZodOptional<z.ZodEnum<{
        client: "client";
        code: "code";
        deployed: "deployed";
        none: "none";
        public: "public";
        "real-data": "real-data";
    }>>;
}, z.core.$strip>;
export type PlanRowOut = z.infer<typeof planRow>;
/**
 * search and fetch answer in the shape OpenAI's connector contract asks for (ChatGPT connectors, deep
 * research and company knowledge call exactly these two tools by name): a result list, then one document
 * by id. Ids are knowledge record ids as strings. The text block carries the same JSON as a string.
 */
export declare const searchResult: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    url: z.ZodString;
}, z.core.$strip>;
export type SearchResultOut = z.infer<typeof searchResult>;
/** The parameters get_entity and fetch share to read one field of a record and page a long array. */
export declare const FIELD_READ_ROWS = 48;
export declare const fieldReadInput: {
    field: z.ZodOptional<z.ZodString>;
    offset: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
};
/** What a field read answers with: the pointed value (an array is one page of it) and where the next page starts. */
export declare const fieldReadOutput: {
    field: z.ZodOptional<z.ZodObject<{
        pointer: z.ZodString;
        value: z.ZodUnknown;
        nextOffset: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    keys: z.ZodOptional<z.ZodArray<z.ZodString>>;
};
export declare const fetchedDocument: z.ZodObject<{
    field: z.ZodOptional<z.ZodObject<{
        pointer: z.ZodString;
        value: z.ZodUnknown;
        nextOffset: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    keys: z.ZodOptional<z.ZodArray<z.ZodString>>;
    id: z.ZodString;
    title: z.ZodString;
    text: z.ZodString;
    url: z.ZodString;
    metadata: z.ZodObject<{
        kind: z.ZodEnum<{
            achievement: "achievement";
            build: "build";
            creator: "creator";
            faction: "faction";
            instance: "instance";
            item: "item";
            legacy_perk: "legacy_perk";
            lore_page: "lore_page";
            mount: "mount";
            npc: "npc";
            object: "object";
            quest: "quest";
            quest_chain: "quest_chain";
            race: "race";
            realm: "realm";
            spell: "spell";
            title: "title";
            zone: "zone";
        }>;
        gameVersion: z.ZodEnum<{
            classic: "classic";
            forever: "forever";
            lore: "lore";
            retail: "retail";
        }>;
        sourceUrl: z.ZodString;
        sourceId: z.ZodString;
        licence: z.ZodString;
        retrievedAt: z.ZodString;
        credit: z.ZodString;
        confirmed: z.ZodOptional<z.ZodObject<{
            asOf: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type FetchedDocumentOut = z.infer<typeof fetchedDocument>;
/** One knowledge record as search_knowledge, get_entity and get_by_name return it. */
export declare const knowledgeHit: z.ZodObject<{
    id: z.ZodNumber;
    recordId: z.ZodOptional<z.ZodNumber>;
    gameId: z.ZodOptional<z.ZodNumber>;
    sourceKind: z.ZodOptional<z.ZodEnum<{
        "game-files": "game-files";
        lore: "lore";
        observed: "observed";
        reference: "reference";
    }>>;
    build: z.ZodOptional<z.ZodString>;
    observed: z.ZodOptional<z.ZodObject<{
        asOf: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    extId: z.ZodString;
    kind: z.ZodEnum<{
        achievement: "achievement";
        build: "build";
        creator: "creator";
        faction: "faction";
        instance: "instance";
        item: "item";
        legacy_perk: "legacy_perk";
        lore_page: "lore_page";
        mount: "mount";
        npc: "npc";
        object: "object";
        quest: "quest";
        quest_chain: "quest_chain";
        race: "race";
        realm: "realm";
        spell: "spell";
        title: "title";
        zone: "zone";
    }>;
    name: z.ZodString;
    snippet: z.ZodString;
    gameVersion: z.ZodEnum<{
        classic: "classic";
        forever: "forever";
        lore: "lore";
        retail: "retail";
    }>;
    sourceUrl: z.ZodString;
    sourceId: z.ZodString;
    licence: z.ZodString;
    retrievedAt: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    confirmed: z.ZodOptional<z.ZodObject<{
        asOf: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type KnowledgeHit = z.infer<typeof knowledgeHit>;
/** One entry of the changes timeline as recent_changes returns it. Titles and excerpts are quoted source text. */
export declare const changeEntry: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<{
        build: "build";
        hotfix: "hotfix";
        post: "post";
    }>;
    game: z.ZodEnum<{
        classic: "classic";
        forever: "forever";
    }>;
    at: z.ZodString;
    title: z.ZodString;
    url: z.ZodNullable<z.ZodString>;
    author: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodString>;
    category: z.ZodOptional<z.ZodString>;
    source: z.ZodOptional<z.ZodString>;
    excerpt: z.ZodOptional<z.ZodString>;
    summary: z.ZodOptional<z.ZodString>;
    version: z.ZodOptional<z.ZodString>;
    diffUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    region: z.ZodOptional<z.ZodEnum<{
        eu: "eu";
        us: "us";
    }>>;
    topicId: z.ZodOptional<z.ZodNumber>;
    topicSlug: z.ZodOptional<z.ZodString>;
    postNumber: z.ZodOptional<z.ZodNumber>;
    startedThread: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type ChangeEntryOut = z.infer<typeof changeEntry>;
/** One piece of evidence from answer_sources. */
export declare const evidence: z.ZodObject<{
    claim: z.ZodString;
    kind: z.ZodEnum<{
        curated: "curated";
        files: "files";
        lore: "lore";
        observed: "observed";
    }>;
    source: z.ZodObject<{
        title: z.ZodString;
        url: z.ZodString;
    }, z.core.$strip>;
    licence: z.ZodString;
    asOf: z.ZodNullable<z.ZodString>;
    support: z.ZodOptional<z.ZodNumber>;
    url: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type Evidence = z.infer<typeof evidence>;
export interface McpToolDef {
    title: string;
    description: string;
    inputSchema: z.ZodRawShape;
    /** Present on tools that also answer with structuredContent of this shape; the text block stays. */
    outputSchema?: z.ZodRawShape;
    annotations: {
        readOnlyHint: true;
        destructiveHint: false;
        idempotentHint: true;
        openWorldHint: false;
    };
}
/** Every tool, keyed by name, in the order the server lists them. */
export declare const MCP_TOOLS: {
    readonly search_knowledge: {
        readonly title: "Search the Everloot knowledge base";
        readonly description: "Searches partial names, keywords or a topic across agreed gameplay names, released zones, reference catalogs (achievements, factions, titles, quest chains, mounts, legacy perks, races, instances) and the lore archive; exact-name matches rank first. Use get_by_name only for a known exact full name. Check kind, gameVersion and sourceKind: lore is historical background, not current Forever gameplay. Pass recordId (also id) to get_entity, or fetch as a string; pass a verified gameId to item_page, npc_page, object_page or quest_page. For world_map_near.zone stringify the zone gameId. Lore has no gameId; never turn an archive id or URL number into a game id. Hits carry source, licence and date, plus build or observed snapshot support where available. For achievements, factions, titles and quest chains, read generic records with get_entity and field pagination. Use answer_sources for cited evidence; search is the ChatGPT connector counterpart.";
        readonly inputSchema: {
            query: z.ZodString;
            kind: z.ZodOptional<z.ZodEnum<{
                achievement: "achievement";
                build: "build";
                creator: "creator";
                faction: "faction";
                instance: "instance";
                item: "item";
                legacy_perk: "legacy_perk";
                lore_page: "lore_page";
                mount: "mount";
                npc: "npc";
                object: "object";
                quest: "quest";
                quest_chain: "quest_chain";
                race: "race";
                realm: "realm";
                spell: "spell";
                title: "title";
                zone: "zone";
            }>>;
            version: z.ZodOptional<z.ZodEnum<{
                classic: "classic";
                forever: "forever";
                lore: "lore";
                retail: "retail";
            }>>;
            limit: z.ZodDefault<z.ZodNumber>;
        };
        readonly outputSchema: {
            readonly hits: z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                recordId: z.ZodOptional<z.ZodNumber>;
                gameId: z.ZodOptional<z.ZodNumber>;
                sourceKind: z.ZodOptional<z.ZodEnum<{
                    "game-files": "game-files";
                    lore: "lore";
                    observed: "observed";
                    reference: "reference";
                }>>;
                build: z.ZodOptional<z.ZodString>;
                observed: z.ZodOptional<z.ZodObject<{
                    asOf: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                extId: z.ZodString;
                kind: z.ZodEnum<{
                    achievement: "achievement";
                    build: "build";
                    creator: "creator";
                    faction: "faction";
                    instance: "instance";
                    item: "item";
                    legacy_perk: "legacy_perk";
                    lore_page: "lore_page";
                    mount: "mount";
                    npc: "npc";
                    object: "object";
                    quest: "quest";
                    quest_chain: "quest_chain";
                    race: "race";
                    realm: "realm";
                    spell: "spell";
                    title: "title";
                    zone: "zone";
                }>;
                name: z.ZodString;
                snippet: z.ZodString;
                gameVersion: z.ZodEnum<{
                    classic: "classic";
                    forever: "forever";
                    lore: "lore";
                    retail: "retail";
                }>;
                sourceUrl: z.ZodString;
                sourceId: z.ZodString;
                licence: z.ZodString;
                retrievedAt: z.ZodString;
                url: z.ZodOptional<z.ZodString>;
                confirmed: z.ZodOptional<z.ZodObject<{
                    asOf: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly get_entity: {
        readonly title: "Get one knowledge record by id";
        readonly description: "Returns one knowledge record's summary, by the numeric id a search_knowledge or get_by_name hit gave: title, a short excerpt in the source's words, the URL to cite, source, licence and date. Gameplay metadata separates recordId from gameId and labels sourceKind, build or observed snapshot support. A game-file record carries its build and says when player uploads confirm it. Use it to read one hit again by its id; for the whole text, call fetch with the same id as a string. An id no record has returns a null hit, not an error. Give field, a JSON pointer such as /questIds, to read one value of the record's data instead of the excerpt; an array comes in pages of up to 48 rows, and nextOffset says where the next page starts. A pointer that leads nowhere answers with the keys it could have used, not an error. Pass only recordId here; a verified gameId from gameplay metadata goes to item_page, npc_page, object_page or quest_page. Lore archive ids are never game ids.";
        readonly inputSchema: {
            readonly field: z.ZodOptional<z.ZodString>;
            readonly offset: z.ZodOptional<z.ZodNumber>;
            readonly limit: z.ZodOptional<z.ZodNumber>;
            readonly id: z.ZodNumber;
        };
        readonly outputSchema: {
            readonly field: z.ZodOptional<z.ZodObject<{
                pointer: z.ZodString;
                value: z.ZodUnknown;
                nextOffset: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            readonly keys: z.ZodOptional<z.ZodArray<z.ZodString>>;
            readonly hit: z.ZodNullable<z.ZodObject<{
                id: z.ZodNumber;
                recordId: z.ZodOptional<z.ZodNumber>;
                gameId: z.ZodOptional<z.ZodNumber>;
                sourceKind: z.ZodOptional<z.ZodEnum<{
                    "game-files": "game-files";
                    lore: "lore";
                    observed: "observed";
                    reference: "reference";
                }>>;
                build: z.ZodOptional<z.ZodString>;
                observed: z.ZodOptional<z.ZodObject<{
                    asOf: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                extId: z.ZodString;
                kind: z.ZodEnum<{
                    achievement: "achievement";
                    build: "build";
                    creator: "creator";
                    faction: "faction";
                    instance: "instance";
                    item: "item";
                    legacy_perk: "legacy_perk";
                    lore_page: "lore_page";
                    mount: "mount";
                    npc: "npc";
                    object: "object";
                    quest: "quest";
                    quest_chain: "quest_chain";
                    race: "race";
                    realm: "realm";
                    spell: "spell";
                    title: "title";
                    zone: "zone";
                }>;
                name: z.ZodString;
                snippet: z.ZodString;
                gameVersion: z.ZodEnum<{
                    classic: "classic";
                    forever: "forever";
                    lore: "lore";
                    retail: "retail";
                }>;
                sourceUrl: z.ZodString;
                sourceId: z.ZodString;
                licence: z.ZodString;
                retrievedAt: z.ZodString;
                url: z.ZodOptional<z.ZodString>;
                confirmed: z.ZodOptional<z.ZodObject<{
                    asOf: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly get_by_name: {
        readonly title: "Get records by exact name";
        readonly description: "Returns records matching a known exact full name, case-insensitively, optionally narrowed by kind. Use search_knowledge for partial names or when this exact lookup misses; no exact match does not mean no gameplay facts exist. Check kind, gameVersion and sourceKind before choosing: lore is archive background and has no gameId. Pass recordId (also id) to get_entity or fetch as a string; pass the separate verified gameId to item_page, npc_page, object_page or quest_page. A zone gameId, as a string, goes to world_map_near.zone. Several kinds can share a name; never guess a game id from a lore record.";
        readonly inputSchema: {
            readonly name: z.ZodString;
            readonly kind: z.ZodOptional<z.ZodEnum<{
                achievement: "achievement";
                build: "build";
                creator: "creator";
                faction: "faction";
                instance: "instance";
                item: "item";
                legacy_perk: "legacy_perk";
                lore_page: "lore_page";
                mount: "mount";
                npc: "npc";
                object: "object";
                quest: "quest";
                quest_chain: "quest_chain";
                race: "race";
                realm: "realm";
                spell: "spell";
                title: "title";
                zone: "zone";
            }>>;
        };
        readonly outputSchema: {
            readonly hits: z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                recordId: z.ZodOptional<z.ZodNumber>;
                gameId: z.ZodOptional<z.ZodNumber>;
                sourceKind: z.ZodOptional<z.ZodEnum<{
                    "game-files": "game-files";
                    lore: "lore";
                    observed: "observed";
                    reference: "reference";
                }>>;
                build: z.ZodOptional<z.ZodString>;
                observed: z.ZodOptional<z.ZodObject<{
                    asOf: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                extId: z.ZodString;
                kind: z.ZodEnum<{
                    achievement: "achievement";
                    build: "build";
                    creator: "creator";
                    faction: "faction";
                    instance: "instance";
                    item: "item";
                    legacy_perk: "legacy_perk";
                    lore_page: "lore_page";
                    mount: "mount";
                    npc: "npc";
                    object: "object";
                    quest: "quest";
                    quest_chain: "quest_chain";
                    race: "race";
                    realm: "realm";
                    spell: "spell";
                    title: "title";
                    zone: "zone";
                }>;
                name: z.ZodString;
                snippet: z.ZodString;
                gameVersion: z.ZodEnum<{
                    classic: "classic";
                    forever: "forever";
                    lore: "lore";
                    retail: "retail";
                }>;
                sourceUrl: z.ZodString;
                sourceId: z.ZodString;
                licence: z.ZodString;
                retrievedAt: z.ZodString;
                url: z.ZodOptional<z.ZodString>;
                confirmed: z.ZodOptional<z.ZodObject<{
                    asOf: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly search: {
        readonly title: "Search (ChatGPT connector contract)";
        readonly description: "Searches the knowledge base in the shape ChatGPT connectors and deep research call by name: up to 10 results, each with an id for fetch, a title and a URL to cite. It is the same search as search_knowledge. Use it only when the client expects the search and fetch pair; other clients should call search_knowledge. The text block is the same JSON as a string.";
        readonly inputSchema: {
            readonly query: z.ZodString;
        };
        readonly outputSchema: {
            readonly results: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                title: z.ZodString;
                url: z.ZodString;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly fetch: {
        readonly title: "Fetch one document (ChatGPT connector contract)";
        readonly description: "Returns one knowledge record in full, by the string id a search result gave: title, the full text in the source's words, the URL to cite, and metadata with the source, licence and date. It is the ChatGPT connector counterpart of get_entity, which gives only an excerpt. Use it after search, or with a search_knowledge id as a string. Give field, a JSON pointer such as /questIds, to read one value of the record's data: text then holds that value as JSON, and an array comes in pages of up to 48 rows with nextOffset for the next page. A long array in a whole record is cut at 48 rows. The text block is the same JSON as a string.";
        readonly inputSchema: {
            readonly field: z.ZodOptional<z.ZodString>;
            readonly offset: z.ZodOptional<z.ZodNumber>;
            readonly limit: z.ZodOptional<z.ZodNumber>;
            readonly id: z.ZodString;
        };
        readonly outputSchema: {
            field: z.ZodOptional<z.ZodObject<{
                pointer: z.ZodString;
                value: z.ZodUnknown;
                nextOffset: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            keys: z.ZodOptional<z.ZodArray<z.ZodString>>;
            id: z.ZodString;
            title: z.ZodString;
            text: z.ZodString;
            url: z.ZodString;
            metadata: z.ZodObject<{
                kind: z.ZodEnum<{
                    achievement: "achievement";
                    build: "build";
                    creator: "creator";
                    faction: "faction";
                    instance: "instance";
                    item: "item";
                    legacy_perk: "legacy_perk";
                    lore_page: "lore_page";
                    mount: "mount";
                    npc: "npc";
                    object: "object";
                    quest: "quest";
                    quest_chain: "quest_chain";
                    race: "race";
                    realm: "realm";
                    spell: "spell";
                    title: "title";
                    zone: "zone";
                }>;
                gameVersion: z.ZodEnum<{
                    classic: "classic";
                    forever: "forever";
                    lore: "lore";
                    retail: "retail";
                }>;
                sourceUrl: z.ZodString;
                sourceId: z.ZodString;
                licence: z.ZodString;
                retrievedAt: z.ZodString;
                credit: z.ZodString;
                confirmed: z.ZodOptional<z.ZodObject<{
                    asOf: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly answer_sources: {
        readonly title: "Evidence for a question, each piece with its source";
        readonly description: "Returns cited evidence for a natural-language WoW: Forever question: observed, curated, game-file and 2023 Warcraft Wiki claims, each with source URL, licence and date. Start here for why, where or how many. Check that a claim contains the requested fact: a subject mention alone is not an answer. Observations need three agreeing installs; files stay unconfirmed with their build; archive lore may differ in Forever. If the requested fact is absent, say unrecorded rather than importing Classic or retail knowledge. For names use search_knowledge, then the hit's verified gameId with item_page, npc_page or quest_page. Further-reading URLs are search links, not fetched evidence. Disconnected observations are unrecorded, not zero.";
        readonly inputSchema: {
            readonly question: z.ZodString;
            readonly limit: z.ZodDefault<z.ZodNumber>;
        };
        readonly outputSchema: {
            readonly evidence: z.ZodArray<z.ZodObject<{
                claim: z.ZodString;
                kind: z.ZodEnum<{
                    curated: "curated";
                    files: "files";
                    lore: "lore";
                    observed: "observed";
                }>;
                source: z.ZodObject<{
                    title: z.ZodString;
                    url: z.ZodString;
                }, z.core.$strip>;
                licence: z.ZodString;
                asOf: z.ZodNullable<z.ZodString>;
                support: z.ZodOptional<z.ZodNumber>;
                url: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            readonly furtherReading: z.ZodArray<z.ZodObject<{
                site: z.ZodString;
                url: z.ZodString;
            }, z.core.$strip>>;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly profession_path: {
        readonly title: "Profession leveling path";
        readonly description: "Returns a Forever profession leveling route between skill levels: agreed steps, summed reagents and estimated cost, leaving uncovered ranges as gaps. A reported recipe or orange skill range needs 3 agreeing installs. Costs use median reagent prices from at least 3 distinct installs: unscoped observations without realm, build or observation time, not one listing's price or a current realm minimum. Agreed vendor prices may supply reagent costs; training is listed separately. Use recipe_thresholds for colour-change ranges. Use market_value with a verified item gameId and full realm name for a dated realm price. Missing prices stay unknown, never free.";
        readonly inputSchema: {
            readonly profession: z.ZodString;
            readonly fromSkill: z.ZodDefault<z.ZodNumber>;
            readonly toSkill: z.ZodNumber;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                profession: z.ZodString;
                fromSkill: z.ZodNumber;
                toSkill: z.ZodNumber;
                steps: z.ZodArray<z.ZodObject<{
                    recipe: z.ZodString;
                    fromSkill: z.ZodNumber;
                    toSkill: z.ZodNumber;
                    crafts: z.ZodNumber;
                    points: z.ZodNumber;
                    reagents: z.ZodArray<z.ZodObject<{
                        item: z.ZodString;
                        count: z.ZodNumber;
                    }, z.core.$strip>>;
                    copper: z.ZodNullable<z.ZodNumber>;
                    reporters: z.ZodNumber;
                    trainingCopper: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                }, z.core.$strip>>;
                gaps: z.ZodArray<z.ZodObject<{
                    fromSkill: z.ZodNumber;
                    toSkill: z.ZodNumber;
                }, z.core.$strip>>;
                reagents: z.ZodArray<z.ZodObject<{
                    item: z.ZodString;
                    count: z.ZodNumber;
                }, z.core.$strip>>;
                copper: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly recipe_thresholds: {
        readonly title: "Recipe skill ranges";
        readonly description: "Returns where one Forever profession's recipes turn yellow, green and grey, as skill ranges inferred from the colours players' trade-skill windows showed, never guessed exact numbers. A recipe appears only after 3 installs agree. Agreed reagents come with estimated cost per craft from unscoped median prices from at least 3 installs, or agreed vendor prices; missing prices stay unknown. Use it for how long a recipe keeps giving skill points; use profession_path for a step-by-step route between two skill levels. Narrow the list with part of a recipe name. Reads Everloot's current public corpus.";
        readonly inputSchema: {
            readonly profession: z.ZodString;
            readonly recipe: z.ZodOptional<z.ZodString>;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                profession: z.ZodString;
                ranges: z.ZodArray<z.ZodObject<{
                    profession: z.ZodString;
                    recipe: z.ZodString;
                    installs: z.ZodNumber;
                    observations: z.ZodNumber;
                    yellow: z.ZodObject<{
                        min: z.ZodNullable<z.ZodNumber>;
                        max: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                    green: z.ZodObject<{
                        min: z.ZodNullable<z.ZodNumber>;
                        max: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                    grey: z.ZodObject<{
                        min: z.ZodNullable<z.ZodNumber>;
                        max: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                    reagents: z.ZodNullable<z.ZodArray<z.ZodObject<{
                        item: z.ZodString;
                        count: z.ZodNumber;
                    }, z.core.$strip>>>;
                    costCopper: z.ZodNullable<z.ZodNumber>;
                    missingPrices: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly item_page: {
        readonly title: "Item page for a drop";
        readonly description: "Returns one Forever item's page by item id: the agreed name, drop frequency from observed loot windows, agreed map pins, and player-reported armor, block, damage per second, stats and resistances. A number is public when one value has 3 agreeing installs in the newest build that 3 installs reported, and no competing value has 3; contested numbers are withheld. Each number states its agreeing installs, build and last seen, with the corpus date and method. Missing numbers are [?] with a reason. No baseline rows or player names. Use it when you have an item id; use market_value for its price, entity_relations for what drops or sells it, and item_categories for its class and slot. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. If only a name is known, call search_knowledge first and use its item gameId, never recordId or a lore URL number.";
        readonly inputSchema: {
            readonly itemId: z.ZodNumber;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                itemId: z.ZodNumber;
                name: z.ZodNullable<z.ZodString>;
                drops: z.ZodArray<z.ZodObject<{
                    sourceNpcId: z.ZodOptional<z.ZodNumber>;
                    sourceObjectId: z.ZodOptional<z.ZodNumber>;
                    source: z.ZodString;
                    kills: z.ZodNumber;
                    drops: z.ZodNumber;
                    rate: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>;
                pins: z.ZodArray<z.ZodObject<{
                    npcId: z.ZodNumber;
                    name: z.ZodNullable<z.ZodString>;
                    mapId: z.ZodNumber;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>;
                pendingLoot: z.ZodOptional<z.ZodObject<{
                    windows: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>;
                reported: z.ZodOptional<z.ZodObject<{
                    shown: z.ZodArray<z.ZodObject<{
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
                        reporters: z.ZodNumber;
                        build: z.ZodString;
                        lastSeen: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    contested: z.ZodArray<z.ZodEnum<{
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
                    }>>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly npc_page: {
        readonly title: "NPC page";
        readonly description: "Returns one Forever NPC's page by NPC id: the agreed name, the agreed map pins, and the loot windows reported for it that are not yet in the drop rates. A name or pin needs 3 installs agreeing; a pin does not require a drop. No copied spawn list. Use it to name or place an NPC when you have its id, from a search_knowledge hit, a drop row or entity_relations; use vendor_page for what an NPC sells, item_page for one drop's rate, entity_relations for every typed link, and world_map_near for what stands around it. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. Resolve a name with search_knowledge first; use its NPC gameId, never its recordId.";
        readonly inputSchema: {
            readonly npcId: z.ZodNumber;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                npcId: z.ZodNumber;
                name: z.ZodNullable<z.ZodString>;
                pins: z.ZodArray<z.ZodObject<{
                    mapId: z.ZodNumber;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>;
                pendingLoot: z.ZodOptional<z.ZodObject<{
                    windows: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly object_page: {
        readonly title: "Game object page";
        readonly description: "Returns one game object's page (a chest, herb, ore vein or fishing pool) by its entry id: the items players looted from it, each with observed loot windows, windows with the item and distinct install reports, and where players saw it on the minimap. A frequency is public after 3 install reports; a public object with nothing in its windows reads as a measured zero. The name shows once 3 installs agree on it. Use it for gathering nodes and containers; use npc_page for creatures, and item_page for every source of one item. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. Resolve names with search_knowledge and pass the object gameId, never an archive recordId.";
        readonly inputSchema: {
            readonly objectId: z.ZodNumber;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                objectId: z.ZodNumber;
                name: z.ZodNullable<z.ZodString>;
                drops: z.ZodArray<z.ZodObject<{
                    itemId: z.ZodNumber;
                    itemName: z.ZodNullable<z.ZodString>;
                    kills: z.ZodNumber;
                    drops: z.ZodNumber;
                    rate: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>;
                zero: z.ZodNullable<z.ZodObject<{
                    kills: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>;
                queued: z.ZodBoolean;
                pendingLoot: z.ZodOptional<z.ZodObject<{
                    windows: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>;
                pins: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    mapId: z.ZodNumber;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly quest_page: {
        readonly title: "Quest page";
        readonly description: "Returns one Forever quest's page by quest id: agreed title, level, giver, turn-in and rewards. Each fact needs 3 installs agreeing. No copied quest text. Use it when you have a quest id, from a search_knowledge hit or entity_relations; use answer_sources for a question about the quest's story or chain, and entity_relations for what the quest rewards. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. Resolve names with search_knowledge and use the quest gameId, never recordId. For quest_chain records use get_entity with field and nextOffset to read the chain.";
        readonly inputSchema: {
            readonly questId: z.ZodNumber;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                questId: z.ZodNumber;
                title: z.ZodNullable<z.ZodString>;
                level: z.ZodNullable<z.ZodNumber>;
                giverNpcId: z.ZodNullable<z.ZodNumber>;
                turnInNpcId: z.ZodNullable<z.ZodNumber>;
                rewards: z.ZodArray<z.ZodNumber>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly vendor_page: {
        readonly title: "Vendor page";
        readonly description: "Returns the goods one Forever vendor sells, by the vendor's NPC id, each with the copper price players saw. An item is listed when 3 installs agree on that item and its copper price; two agreed prices both stay listed. No copied catalog. Use it for what a vendor sells and at what price; use npc_page for where the vendor stands, entity_relations with the sold_by relation for who sells an item, and market_value for auction prices. The id is the same NPC id npc_page takes. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. For a vendor name, resolve its NPC gameId with search_knowledge first.";
        readonly inputSchema: {
            readonly vendorNpcId: z.ZodNumber;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                vendorNpcId: z.ZodNumber;
                offers: z.ZodArray<z.ZodObject<{
                    itemId: z.ZodNumber;
                    priceCopper: z.ZodNumber;
                    limitedStock: z.ZodNullable<z.ZodNumber>;
                    unlimited: z.ZodBoolean;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly world_map_near: {
        readonly title: "What is near a place on the map";
        readonly description: `Lists the entrances, NPCs, vendors and treasures near a spot, nearest first, with straight-line distances in yards. Give a zone (name or map id) with x and y from 0 to 100, or an NPC id to start from where that NPC stands. Entrances come from the game files; one is confirmed once 3 installs zoned in from it. NPCs, vendors and treasures are player-observed and listed only where 3 installs agree on the position. Zones the files hold back as possibly unreleased are not offered. Use it for what is near a spot; use npc_page, vendor_page or entity_relations for one entity's own facts. Reads Everloot's public player data when connected.`;
        readonly inputSchema: {
            readonly zone: z.ZodOptional<z.ZodString>;
            readonly x: z.ZodOptional<z.ZodNumber>;
            readonly y: z.ZodOptional<z.ZodNumber>;
            readonly npcId: z.ZodOptional<z.ZodNumber>;
            readonly radius: z.ZodDefault<z.ZodNumber>;
            readonly limit: z.ZodDefault<z.ZodNumber>;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                ok: z.ZodBoolean;
                message: z.ZodOptional<z.ZodString>;
                origin: z.ZodOptional<z.ZodString>;
                radius: z.ZodOptional<z.ZodNumber>;
                limit: z.ZodOptional<z.ZodNumber>;
                entrances: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    names: z.ZodArray<z.ZodString>;
                    raid: z.ZodBoolean;
                    zone: z.ZodNullable<z.ZodString>;
                    yards: z.ZodNumber;
                    confirmed: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>>;
                npcs: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    npcId: z.ZodNumber;
                    name: z.ZodNullable<z.ZodString>;
                    mapId: z.ZodNumber;
                    zoneName: z.ZodString;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    yards: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>>;
                vendors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    npcId: z.ZodNumber;
                    name: z.ZodNullable<z.ZodString>;
                    mapId: z.ZodNumber;
                    zoneName: z.ZodString;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    yards: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>>;
                treasures: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    objectId: z.ZodNumber;
                    name: z.ZodNullable<z.ZodString>;
                    mapId: z.ZodNumber;
                    zoneName: z.ZodString;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    yards: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly entity_relations: {
        readonly title: "How an item, NPC, spell or quest connects to others";
        readonly description: "Lists every typed relation of one entity, in both directions, grouped by relation. Player-observed relations (dropped by, sold by, reward from, located in) are listed where 3 installs agree, with the install count and last seen. Game-file relations (created by, reagent for, part of set, same icon) are found in game files, unconfirmed, with the build they came from. Ids are verified game ids from search_knowledge, a page tool, a drop row or world_map_near. For an NPC's drops use kind=npc, rel=dropped_by, direction=to; for an item's sources use kind=item, direction=from. Use it for where something comes from or what something drops, sells or rewards; use the page tools (item_page, npc_page, quest_page) for one entity's own facts, and world_map_near for what is near a place. Reads Everloot's public player data and the game-file relations of the current build.";
        readonly inputSchema: {
            readonly kind: z.ZodEnum<{
                icon: "icon";
                item: "item";
                item_set: "item_set";
                npc: "npc";
                object: "object";
                quest: "quest";
                skill: "skill";
                spell: "spell";
                zone: "zone";
            }>;
            readonly id: z.ZodNumber;
            readonly rel: z.ZodOptional<z.ZodEnum<{
                created_by: "created_by";
                dropped_by: "dropped_by";
                in_skill_line: "in_skill_line";
                located_in: "located_in";
                part_of_set: "part_of_set";
                reagent_for: "reagent_for";
                reward_from: "reward_from";
                same_icon: "same_icon";
                sold_by: "sold_by";
            }>>;
            readonly direction: z.ZodDefault<z.ZodEnum<{
                both: "both";
                from: "from";
                to: "to";
            }>>;
            readonly limit: z.ZodDefault<z.ZodNumber>;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<{
                    icon: "icon";
                    item: "item";
                    item_set: "item_set";
                    npc: "npc";
                    object: "object";
                    quest: "quest";
                    skill: "skill";
                    spell: "spell";
                    zone: "zone";
                }>;
                id: z.ZodNumber;
                edges: z.ZodArray<z.ZodObject<{
                    fromKind: z.ZodEnum<{
                        icon: "icon";
                        item: "item";
                        item_set: "item_set";
                        npc: "npc";
                        object: "object";
                        quest: "quest";
                        skill: "skill";
                        spell: "spell";
                        zone: "zone";
                    }>;
                    fromId: z.ZodNumber;
                    rel: z.ZodEnum<{
                        created_by: "created_by";
                        dropped_by: "dropped_by";
                        in_skill_line: "in_skill_line";
                        located_in: "located_in";
                        part_of_set: "part_of_set";
                        reagent_for: "reagent_for";
                        reward_from: "reward_from";
                        same_icon: "same_icon";
                        sold_by: "sold_by";
                    }>;
                    toKind: z.ZodEnum<{
                        icon: "icon";
                        item: "item";
                        item_set: "item_set";
                        npc: "npc";
                        object: "object";
                        quest: "quest";
                        skill: "skill";
                        spell: "spell";
                        zone: "zone";
                    }>;
                    toId: z.ZodNumber;
                    evidence: z.ZodEnum<{
                        client: "client";
                        observed: "observed";
                    }>;
                    build: z.ZodNullable<z.ZodString>;
                    installs: z.ZodNullable<z.ZodNumber>;
                    firstSeen: z.ZodNullable<z.ZodString>;
                    lastSeen: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                notShown: z.ZodNumber;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly item_categories: {
        readonly title: "Item categories: class, subclass, slot and quality";
        readonly description: "Lists item categories from the game files (found in game files, unconfirmed, with the build): class and subclass with the client's English names and slugs, slot and quality. With no arguments, the whole tree with item counts. With item, that item's category path. With class (a slug such as weapon or armor), and optionally subclass, slot and quality slugs, the item ids in it. Use it to place an item in its category or to list a category; use item_page for an item's name and stats, and entity_relations for where it comes from. Ids only: item names come from player uploads, through item_page.";
        readonly inputSchema: {
            readonly item: z.ZodOptional<z.ZodNumber>;
            readonly class: z.ZodOptional<z.ZodString>;
            readonly subclass: z.ZodOptional<z.ZodString>;
            readonly slot: z.ZodOptional<z.ZodString>;
            readonly quality: z.ZodOptional<z.ZodEnum<{
                artifact: "artifact";
                common: "common";
                epic: "epic";
                heirloom: "heirloom";
                legendary: "legendary";
                poor: "poor";
                rare: "rare";
                uncommon: "uncommon";
            }>>;
            readonly limit: z.ZodDefault<z.ZodNumber>;
        };
        readonly outputSchema: {
            readonly label: z.ZodString;
            readonly build: z.ZodString;
            readonly item: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                itemId: z.ZodNumber;
                class: z.ZodNullable<z.ZodObject<{
                    id: z.ZodNumber;
                    name: z.ZodString;
                    label: z.ZodString;
                    slug: z.ZodString;
                }, z.core.$strip>>;
                subclass: z.ZodNullable<z.ZodObject<{
                    id: z.ZodNumber;
                    name: z.ZodNullable<z.ZodString>;
                    slug: z.ZodString;
                }, z.core.$strip>>;
                slot: z.ZodNullable<z.ZodObject<{
                    inventoryType: z.ZodNumber;
                    name: z.ZodString;
                    slug: z.ZodString;
                }, z.core.$strip>>;
                quality: z.ZodNullable<z.ZodObject<{
                    id: z.ZodNumber;
                    name: z.ZodString;
                    slug: z.ZodString;
                }, z.core.$strip>>;
            }, z.core.$strip>>>;
            readonly classes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodString;
                slug: z.ZodString;
                items: z.ZodNumber;
                subclasses: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    name: z.ZodNullable<z.ZodString>;
                    slug: z.ZodString;
                    items: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>>;
            readonly items: z.ZodOptional<z.ZodArray<z.ZodObject<{
                itemId: z.ZodNumber;
                class: z.ZodNullable<z.ZodObject<{
                    id: z.ZodNumber;
                    name: z.ZodString;
                    label: z.ZodString;
                    slug: z.ZodString;
                }, z.core.$strip>>;
                subclass: z.ZodNullable<z.ZodObject<{
                    id: z.ZodNumber;
                    name: z.ZodNullable<z.ZodString>;
                    slug: z.ZodString;
                }, z.core.$strip>>;
                slot: z.ZodNullable<z.ZodObject<{
                    inventoryType: z.ZodNumber;
                    name: z.ZodString;
                    slug: z.ZodString;
                }, z.core.$strip>>;
                quality: z.ZodNullable<z.ZodObject<{
                    id: z.ZodNumber;
                    name: z.ZodString;
                    slug: z.ZodString;
                }, z.core.$strip>>;
            }, z.core.$strip>>>;
            readonly total: z.ZodOptional<z.ZodNumber>;
            readonly error: z.ZodOptional<z.ZodString>;
            readonly credit: z.ZodString;
            readonly url: z.ZodOptional<z.ZodString>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly talent_tree: {
        readonly title: "Talent trees for one class";
        readonly description: "Returns the WoW: Forever talent trees of one class from the game files (found in game files, unconfirmed, with the build): every node with its talents, ranks, grid position, prerequisites and row gate, plus the levels talent points arrive at. Node ids are the ids a share code names. Use it to read or explain a class's trees; use talent_plan to decode a share code against them, and class_races for which races can be the class. Narrow to one tree by name; without it the answer holds every node of every tree. With builds, the answer also lists the Everloot team's published starter builds for the class, each labelled as the team's and not observed, with its share code and page. The answer links the calculator.";
        readonly inputSchema: {
            readonly class: z.ZodEnum<{
                druid: "druid";
                hunter: "hunter";
                mage: "mage";
                paladin: "paladin";
                priest: "priest";
                rogue: "rogue";
                shaman: "shaman";
                warlock: "warlock";
                warrior: "warrior";
            }>;
            readonly tree: z.ZodOptional<z.ZodString>;
            readonly builds: z.ZodDefault<z.ZodBoolean>;
        };
        readonly outputSchema: {
            readonly label: z.ZodString;
            readonly build: z.ZodString;
            readonly class: z.ZodEnum<{
                druid: "druid";
                hunter: "hunter";
                mage: "mage";
                paladin: "paladin";
                priest: "priest";
                rogue: "rogue";
                shaman: "shaman";
                warlock: "warlock";
                warrior: "warrior";
            }>;
            readonly className: z.ZodString;
            readonly specId: z.ZodNumber;
            readonly points: z.ZodObject<{
                firstPointLevel: z.ZodNumber;
                maxLevel: z.ZodNumber;
                total: z.ZodNumber;
                pointLevels: z.ZodArray<z.ZodNumber>;
            }, z.core.$strip>;
            readonly trees: z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodString;
                nodes: z.ZodNumber;
            }, z.core.$strip>>;
            readonly nodes: z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                treeId: z.ZodNumber;
                row: z.ZodNumber;
                col: z.ZodNumber;
                kind: z.ZodEnum<{
                    choice: "choice";
                    single: "single";
                    tiered: "tiered";
                }>;
                maxRanks: z.ZodNumber;
                talents: z.ZodArray<z.ZodObject<{
                    name: z.ZodString;
                    spellId: z.ZodNullable<z.ZodNumber>;
                    maxRanks: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
                prereqs: z.ZodArray<z.ZodNumber>;
                anyOf: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
                gate: z.ZodOptional<z.ZodObject<{
                    pointsInTree: z.ZodOptional<z.ZodNumber>;
                    pointsTotal: z.ZodOptional<z.ZodNumber>;
                    scope: z.ZodOptional<z.ZodEnum<{
                        class: "class";
                        tree: "tree";
                        unconfirmed: "unconfirmed";
                    }>>;
                    ranksInNodes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        nodeId: z.ZodNumber;
                        ranks: z.ZodNumber;
                    }, z.core.$strip>>>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            readonly starterBuilds: z.ZodOptional<z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                purpose: z.ZodEnum<{
                    dungeon: "dungeon";
                    leveling: "leveling";
                    pvp: "pvp";
                    raid: "raid";
                }>;
                tree: z.ZodString;
                shareCode: z.ZodString;
                points: z.ZodNumber;
                build: z.ZodString;
                url: z.ZodString;
                label: z.ZodLiteral<"Everloot team starter build, not observed">;
            }, z.core.$strip>>>;
            readonly credit: z.ZodString;
            readonly url: z.ZodOptional<z.ZodString>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly talent_plan: {
        readonly title: "Read a talent share code";
        readonly description: "Decodes an Everloot talent share code (EL1-<class>-<spec>-<build>-<payload>, or a calculator link carrying one after #plan=) against the class's trees: the talents and ranks it holds, points per tree, the lowest level that can hold it, and every problem in plain words: a code made on another build, nodes the tree does not have, ranks cut back, points the rules would not place. Nothing is dropped silently. Use it when given a share code or a calculator link; use talent_tree to read the trees themselves. Game-file data, found in game files, unconfirmed.";
        readonly inputSchema: {
            readonly code: z.ZodString;
        };
        readonly outputSchema: {
            readonly ok: z.ZodBoolean;
            readonly message: z.ZodOptional<z.ZodString>;
            readonly class: z.ZodOptional<z.ZodEnum<{
                druid: "druid";
                hunter: "hunter";
                mage: "mage";
                paladin: "paladin";
                priest: "priest";
                rogue: "rogue";
                shaman: "shaman";
                warlock: "warlock";
                warrior: "warrior";
            }>>;
            readonly className: z.ZodOptional<z.ZodString>;
            readonly codeBuild: z.ZodOptional<z.ZodString>;
            readonly treeBuild: z.ZodOptional<z.ZodString>;
            readonly pointsSpent: z.ZodOptional<z.ZodNumber>;
            readonly minLevel: z.ZodOptional<z.ZodNumber>;
            readonly byTree: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodString;
                points: z.ZodNumber;
            }, z.core.$strip>>>;
            readonly talents: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                treeId: z.ZodNumber;
                name: z.ZodString;
                rank: z.ZodNumber;
                maxRanks: z.ZodNumber;
                choice: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>>;
            readonly problems: z.ZodOptional<z.ZodArray<z.ZodString>>;
            readonly link: z.ZodOptional<z.ZodString>;
            readonly label: z.ZodString;
            readonly credit: z.ZodString;
            readonly url: z.ZodOptional<z.ZodString>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly class_races: {
        readonly title: "Races that can be a class, with their racial traits";
        readonly description: "Lists which races can be one class in WoW: Forever, on which faction, and each race's racial traits (name, active or passive) from the game files (found in game files, unconfirmed, with the build). Narrow to one faction. Use it for whether a race can be a class, or which races a class is open to; use talent_tree for the class's talents, and population for how many play it. What each trait does is on the class page, linked from the answer.";
        readonly inputSchema: {
            readonly class: z.ZodString;
            readonly faction: z.ZodOptional<z.ZodEnum<{
                alliance: "alliance";
                horde: "horde";
            }>>;
        };
        readonly outputSchema: {
            readonly label: z.ZodString;
            readonly build: z.ZodString;
            readonly class: z.ZodOptional<z.ZodEnum<{
                druid: "druid";
                hunter: "hunter";
                mage: "mage";
                paladin: "paladin";
                priest: "priest";
                rogue: "rogue";
                shaman: "shaman";
                warlock: "warlock";
                warrior: "warrior";
            }>>;
            readonly className: z.ZodOptional<z.ZodString>;
            readonly faction: z.ZodOptional<z.ZodEnum<{
                alliance: "alliance";
                horde: "horde";
            }>>;
            readonly factions: z.ZodArray<z.ZodObject<{
                faction: z.ZodEnum<{
                    Alliance: "Alliance";
                    Horde: "Horde";
                    Neutral: "Neutral";
                }>;
                races: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    name: z.ZodString;
                    traits: z.ZodArray<z.ZodObject<{
                        name: z.ZodString;
                        kind: z.ZodEnum<{
                            active: "active";
                            passive: "passive";
                        }>;
                        order: z.ZodNumber;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            readonly error: z.ZodOptional<z.ZodString>;
            readonly credit: z.ZodString;
            readonly url: z.ZodOptional<z.ZodString>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly collection_gap: {
        readonly title: "Owned versus missing in a collection";
        readonly description: "Returns what one install still misses in one collection, against what that install uploaded as owned, grouped by source. A list row is public after 3 installs agree on the collection, the source and the item; owned is what that install uploaded. Not a Blizzard profile read and not a copied catalog. Use it for which items of a collection a player is missing; use completion_progress for achievements, reputations and titles. When that install never uploaded the collection, the answer says owned is unknown, not empty. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. Ask for the player's deliberately shared ownerInstallId from their own EverlootDB.installId in SavedVariables/Everloot.lua and required sharing setup; never infer or probe another owner's id.";
        readonly inputSchema: {
            readonly collection: z.ZodString;
            readonly ownerInstallId: z.ZodString;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                collection: z.ZodString;
                ownerInstallId: z.ZodString;
                groups: z.ZodArray<z.ZodObject<{
                    source: z.ZodString;
                    owned: z.ZodArray<z.ZodNumber>;
                    missing: z.ZodArray<z.ZodNumber>;
                }, z.core.$strip>>;
                queued: z.ZodArray<z.ZodNumber>;
                ownedRecorded: z.ZodBoolean;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly completion_progress: {
        readonly title: "Achievement, reputation, title and quest progress";
        readonly description: "Shows what one install's characters have finished and what is closest to done: achievements with the largest share of criteria or progress met, reputations nearest the next standing, titles known, and quests finished in a chain. A list entry is public after 3 players (installs uploading from different addresses) report it identically. Progress shows only when that install uploaded it with the collection sharing choice and a verified grant; without it the answer says so. Not a Blizzard profile read and not a copied catalog. Use it for what a player is closest to finishing; use collection_gap for missing collection items, and guild_board for a guild's kills. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. Ask for the player's deliberately shared ownerInstallId from their own EverlootDB.installId in SavedVariables/Everloot.lua and optional characterKey from their completion upload; never guess them or probe other players.";
        readonly inputSchema: {
            readonly ownerInstallId: z.ZodString;
            readonly characterKey: z.ZodOptional<z.ZodString>;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                ownerInstallId: z.ZodString;
                listed: z.ZodObject<{
                    achievements: z.ZodNumber;
                    factions: z.ZodNumber;
                    titles: z.ZodNumber;
                    chains: z.ZodNumber;
                }, z.core.$strip>;
                ownedRecorded: z.ZodBoolean;
                characters: z.ZodArray<z.ZodObject<{
                    characterKey: z.ZodString;
                    class: z.ZodString;
                    level: z.ZodNumber;
                    achievements: z.ZodObject<{
                        done: z.ZodNumber;
                        total: z.ZodNumber;
                        points: z.ZodNumber;
                        pointsTotal: z.ZodNumber;
                        closest: z.ZodArray<z.ZodObject<{
                            achievementId: z.ZodNumber;
                            name: z.ZodString;
                            category: z.ZodString;
                            have: z.ZodNumber;
                            of: z.ZodNumber;
                            unit: z.ZodEnum<{
                                criteria: "criteria";
                                progress: "progress";
                            }>;
                        }, z.core.$strip>>;
                        unlisted: z.ZodNumber;
                    }, z.core.$strip>;
                    reputation: z.ZodObject<{
                        exalted: z.ZodNumber;
                        total: z.ZodNumber;
                        closest: z.ZodArray<z.ZodObject<{
                            factionId: z.ZodNumber;
                            name: z.ZodString;
                            standing: z.ZodString;
                            toNext: z.ZodNumber;
                            header: z.ZodOptional<z.ZodString>;
                        }, z.core.$strip>>;
                        unscaled: z.ZodArray<z.ZodObject<{
                            factionId: z.ZodNumber;
                            name: z.ZodString;
                            standing: z.ZodNumber;
                        }, z.core.$strip>>;
                        unlisted: z.ZodNumber;
                    }, z.core.$strip>;
                    titles: z.ZodObject<{
                        known: z.ZodNumber;
                        total: z.ZodNumber;
                        unlisted: z.ZodNumber;
                    }, z.core.$strip>;
                    quests: z.ZodObject<{
                        completed: z.ZodNumber;
                        chainsDone: z.ZodNumber;
                        chainsTotal: z.ZodNumber;
                        closest: z.ZodArray<z.ZodObject<{
                            questLineId: z.ZodNumber;
                            name: z.ZodString;
                            done: z.ZodNumber;
                            total: z.ZodNumber;
                            truncated: z.ZodBoolean;
                        }, z.core.$strip>>;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                unknownCharacter: z.ZodOptional<z.ZodString>;
                droppedCharacters: z.ZodNumber;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly guild_board: {
        readonly title: "Guild board its officers published";
        readonly description: "Returns one guild's published officer board and public progression. Use guild_search first for its exact name and realm; use guild_rankings to compare guilds in an instance. Roster, kills, loot, attendance and item level need 2 agreeing officers with verified grants. Public kills need 2 members' installs or an officer-published kill; sightings show characters the addon saw, not the game's roster. Characters can opt out and hidden guilds return no answer. Without an officer board, only the public part is available. Item level names how many roster members were measured, never a combined score. Names are in-game names only. Missing or disconnected data is unrecorded, not zero.";
        readonly inputSchema: {
            readonly guildName: z.ZodString;
            readonly realm: z.ZodString;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                guildName: z.ZodString;
                realm: z.ZodString;
                memberCount: z.ZodNullable<z.ZodNumber>;
                roster: z.ZodArray<z.ZodObject<{
                    name: z.ZodString;
                    rank: z.ZodString;
                    level: z.ZodNumber;
                    className: z.ZodString;
                }, z.core.$strip>>;
                progression: z.ZodArray<z.ZodObject<{
                    instance: z.ZodString;
                    bosses: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
                loot: z.ZodArray<z.ZodObject<{
                    itemId: z.ZodNumber;
                    recipient: z.ZodString;
                    sourceBoss: z.ZodString;
                }, z.core.$strip>>;
                averageItemLevel: z.ZodNullable<z.ZodNumber>;
                gearCoverage: z.ZodObject<{
                    measured: z.ZodNumber;
                    roster: z.ZodNumber;
                }, z.core.$strip>;
                present: z.ZodArray<z.ZodString>;
                attendanceWaiting: z.ZodBoolean;
                ladderProgression: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    instanceMapId: z.ZodNumber;
                    name: z.ZodString;
                    killed: z.ZodNumber;
                    bosses: z.ZodNumber;
                    list: z.ZodArray<z.ZodObject<{
                        encounterId: z.ZodNumber;
                        name: z.ZodString;
                        killed: z.ZodBoolean;
                        killedAt: z.ZodNullable<z.ZodString>;
                        source: z.ZodNullable<z.ZodEnum<{
                            members: "members";
                            officers: "officers";
                        }>>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>>;
                activity: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    encounterId: z.ZodNumber;
                    name: z.ZodString;
                    instanceMapId: z.ZodNumber;
                    killedAt: z.ZodString;
                    source: z.ZodEnum<{
                        members: "members";
                        officers: "officers";
                    }>;
                }, z.core.$strip>>>;
                seenRoster: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    count: z.ZodNumber;
                    members: z.ZodArray<z.ZodObject<{
                        name: z.ZodString;
                        level: z.ZodNumber;
                        class: z.ZodString;
                        lastSeen: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>>;
                ranks: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    instanceMapId: z.ZodNumber;
                    instanceName: z.ZodString;
                    realm: z.ZodNumber;
                    overall: z.ZodNumber;
                }, z.core.$strip>>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly guild_search: {
        readonly title: "Find a guild by the start of its name";
        readonly description: "Finds the guilds whose name starts with what you typed, each with its realm, faction, how many characters the addon saw in it, and the count and date of its agreed boss kills. A guild is listed once 2 of its members' installs report the same boss, once its officers published a board, or once a character was seen in it. Guild names only, never a member's name, and a guild that asked to be hidden is left out. Characters seen are counted only when the player pages are connected; otherwise the count is unrecorded, not zero. Use it to find a guild's exact name and realm before guild_board; use guild_rankings for a ladder. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.";
        readonly inputSchema: {
            readonly query: z.ZodString;
            readonly limit: z.ZodDefault<z.ZodNumber>;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                guilds: z.ZodArray<z.ZodObject<{
                    guildName: z.ZodString;
                    realm: z.ZodString;
                    faction: z.ZodNullable<z.ZodEnum<{
                        alliance: "alliance";
                        horde: "horde";
                    }>>;
                    membersSeen: z.ZodNullable<z.ZodNumber>;
                    kills: z.ZodNumber;
                    latestKillAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly guild_rankings: {
        readonly title: "Guild ladder for one raid or dungeon";
        readonly description: "Ranks every guild with an agreed kill in one instance: by bosses killed, then by who reached its latest kill first, then by name; equal rows share a rank. A kill is a guild's once 2 of its members' installs report the same boss there, timed at the earliest report, or once its officers published it on the guild board, which carries no time. The boss list is the encounters 3 installs reported in that instance, in that order; a boss not on it counts for nothing. There is no score, no rating and no total across instances. Use it to compare guilds' progress in one raid or dungeon; use guild_board for one guild's own board, and guild_search to find a guild. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.";
        readonly inputSchema: {
            readonly instanceMapId: z.ZodOptional<z.ZodNumber>;
            readonly realm: z.ZodOptional<z.ZodString>;
            readonly faction: z.ZodOptional<z.ZodEnum<{
                alliance: "alliance";
                horde: "horde";
            }>>;
            readonly limit: z.ZodDefault<z.ZodNumber>;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                instance: z.ZodNullable<z.ZodObject<{
                    instanceMapId: z.ZodNumber;
                    name: z.ZodString;
                }, z.core.$strip>>;
                rows: z.ZodArray<z.ZodObject<{
                    rank: z.ZodNumber;
                    guildName: z.ZodString;
                    realm: z.ZodString;
                    faction: z.ZodNullable<z.ZodEnum<{
                        alliance: "alliance";
                        horde: "horde";
                    }>>;
                    killed: z.ZodNumber;
                    bosses: z.ZodNumber;
                    latestKillAt: z.ZodNullable<z.ZodString>;
                    membersSeen: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly auction_history: {
        readonly title: "Auction history for one item";
        readonly description: "Returns one item's dated auction history on one Forever realm: public full-scan days used by market_value, plus separate browsing sightings. Browsing prices are the median of each install's last scan that day. A day needs 3 reporters, or, while few players upload, Everloot's own installs; preserve the own-scan label and counts. Use the full realm name (CAMWOW US1 Realm 4 PvP); a unique whole-word suffix of at least two words also resolves. Ambiguous or unknown names return candidates; choose a full name before retrying. Full-scan days use the house with most units listed (ties: Alliance, Horde, Neutral), the same house as market_value structured content; browsing sightings remain a separate source, not split by house. No house selector exists; preserve the house named in the text. Use market_value for value and latest scan details, item_page for facts and vendor_page for vendor prices. Keep scan dates and corpus age; an old minimum is not a live auction offer. Missing data is unrecorded, not zero.";
        readonly inputSchema: {
            readonly realm: z.ZodString;
            readonly itemId: z.ZodNumber;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                realmStatus: z.ZodOptional<z.ZodEnum<{
                    alias: "alias";
                    ambiguous: "ambiguous";
                    exact: "exact";
                    unknown: "unknown";
                }>>;
                askedRealm: z.ZodOptional<z.ZodString>;
                candidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
                realm: z.ZodString;
                itemId: z.ZodNumber;
                points: z.ZodArray<z.ZodObject<{
                    day: z.ZodString;
                    copper: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>;
                scanDays: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    day: z.ZodString;
                    min: z.ZodNumber;
                    market: z.ZodNumber;
                    quantity: z.ZodNumber;
                    reporters: z.ZodNumber;
                    thin: z.ZodBoolean;
                }, z.core.$strip>>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly market_value: {
        readonly title: "Forever market value for one item";
        readonly description: "Returns one item's market value, historical value, minimum buyout and units listed from uploaded full auction scans on one Forever realm. Daily values are medians of reporters' values; a day needs 3 reporters from distinct addresses, or Everloot's own installs while few players upload, labelled with counts. Market value weights public days up to 14 calendar days old toward recent days, excluding thin days (5 units or fewer) and outliers. Historical is the median over 60 calendar days, using non-thin days when present. Use the full realm name (CAMWOW US1 Realm 4 PvP), or a unique whole-word suffix of at least two words. Ambiguous or unknown names return candidates; select a full name and retry. Text lists each auction house separately; structured content uses the house with most units listed (ties: Alliance, Horde, Neutral), named in the text. No input selects a house; never blend their prices. Preserve scan dates and corpus age: the minimum is a recorded scan, not a live offer. Use auction_history for dated history and vendor_page for vendor prices. Get a verified item gameId via search_knowledge first if needed.";
        readonly inputSchema: {
            readonly realm: z.ZodString;
            readonly itemId: z.ZodNumber;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                realmStatus: z.ZodOptional<z.ZodEnum<{
                    alias: "alias";
                    ambiguous: "ambiguous";
                    exact: "exact";
                    unknown: "unknown";
                }>>;
                askedRealm: z.ZodOptional<z.ZodString>;
                candidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
                realm: z.ZodString;
                itemId: z.ZodNumber;
                value: z.ZodNullable<z.ZodObject<{
                    itemId: z.ZodNumber;
                    market: z.ZodNullable<z.ZodNumber>;
                    min: z.ZodNumber;
                    historical: z.ZodNumber;
                    quantity: z.ZodNumber;
                    day: z.ZodString;
                    ageDays: z.ZodNumber;
                    reporters: z.ZodNumber;
                    thin: z.ZodBoolean;
                }, z.core.$strip>>;
                history: z.ZodArray<z.ZodObject<{
                    day: z.ZodString;
                    min: z.ZodNumber;
                    market: z.ZodNumber;
                    quantity: z.ZodNumber;
                    reporters: z.ZodNumber;
                    thin: z.ZodBoolean;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly gold_ledger: {
        readonly title: "Gold ledger for one character";
        readonly description: "Returns the peak and current gold of one character and the money events its own upload recorded: income (loot, quests, vendor and auction sales) and spending (flight paths, postage, barber, respecs, auction purchases), each install's ledger kept apart. A category with nothing recorded reads as unrecorded, not zero, and gold from other gameplay is unrecorded. The gap between recorded income and peak gold is shown as unrecorded, never called bought gold or a ban. Use it for one uploaded character's own gold history; it cannot look up a character that never uploaded. Use guild_board for a guild's loot, and market_value for prices. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. Ask for the player's deliberately shared character and realm; it needs that owner's shared upload, not an inferred identity.";
        readonly inputSchema: {
            readonly character: z.ZodString;
            readonly realm: z.ZodString;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                character: z.ZodString;
                realm: z.ZodString;
                recorded: z.ZodBoolean;
                ledgers: z.ZodArray<z.ZodObject<{
                    installId: z.ZodString;
                    peakCopper: z.ZodNullable<z.ZodNumber>;
                    currentCopper: z.ZodNullable<z.ZodNumber>;
                    income: z.ZodObject<{
                        [x: string]: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strip>;
                    spending: z.ZodObject<{
                        [x: string]: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strip>;
                    incomeTotal: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly coverage: {
        readonly title: "Database coverage by zone, type and field";
        readonly description: "Counts how much of WoW: Forever's database is settled or confirmed, per zone, per type and per field, as https://everloot.app/database/coverage shows it, in text only. Coverage is settled over expected, with confirmed over expected beside it; the denominator is the larger of expected and observed, and confirmed includes settled. A player-reported fact is public after three installs agree; fields one or two installs short are counted without their values. Scoped totals and the current build's settled-list size come separately dated and measured. Only public report identifiers and game-file facts are listed, never unconfirmed values, baseline rows, names or ids, or player names. When coverage data is available, every answer states its scope, method, data date and install counts; when it is not, the answer states the scope and marks the counts, data date and installs [?], not zero. Unknown values are [?]. Use it for how complete the database is for a zone or type; use the page tools for the facts themselves.";
        readonly inputSchema: {
            readonly zone: z.ZodOptional<z.ZodNumber>;
            readonly type: z.ZodOptional<z.ZodEnum<{
                bosses: "bosses";
                drops: "drops";
                entrances: "entrances";
                npcs: "npcs";
                pins: "pins";
                quests: "quests";
                rares: "rares";
                treasures: "treasures";
                vendors: "vendors";
            }>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly population: {
        readonly title: "Who plays what: population by race, class, faction and level";
        readonly description: "Counts observed Forever characters by race, class, faction and level band from opt-in addon census uploads, not the whole realm population. Each character counts once. Normally counts need 10 characters, 3 installs and 3 addresses, rounded to 5, with inferable small counts hidden. While few players upload, Everloot's own installs also count on their own, though the 10-character minimum still applies; preserve that label because counts can come from one player's game. The window is active in 7 days by default, or since launch. No names. Missing census data is unrecorded, not zero. Use class_races for which races can be a class; use this tool for observed counts.";
        readonly inputSchema: {
            readonly race: z.ZodOptional<z.ZodString>;
            readonly class: z.ZodOptional<z.ZodString>;
            readonly faction: z.ZodOptional<z.ZodEnum<{
                Alliance: "Alliance";
                Horde: "Horde";
            }>>;
            readonly window: z.ZodDefault<z.ZodEnum<{
                launch: "launch";
                week: "week";
            }>>;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly dataAsOf: z.ZodNullable<z.ZodString>;
            readonly reason: z.ZodOptional<z.ZodString>;
            readonly url: z.ZodOptional<z.ZodString>;
            readonly page: z.ZodOptional<z.ZodObject<{
                scope: z.ZodObject<{
                    id: z.ZodString;
                    label: z.ZodString;
                }, z.core.$strip>;
                launched: z.ZodBoolean;
                launch: z.ZodString;
                window: z.ZodObject<{
                    id: z.ZodEnum<{
                        launch: "launch";
                        week: "week";
                    }>;
                    from: z.ZodString;
                    to: z.ZodString;
                }, z.core.$strip>;
                collecting: z.ZodBoolean;
                characters: z.ZodNullable<z.ZodNumber>;
                installs: z.ZodNumber;
                rule: z.ZodObject<{
                    minCharacters: z.ZodNumber;
                    minInstalls: z.ZodNumber;
                    minReporters: z.ZodNumber;
                    roundTo: z.ZodNumber;
                }, z.core.$strip>;
                cells: z.ZodArray<z.ZodObject<{
                    slice: z.ZodEnum<{
                        class: "class";
                        faction: "faction";
                        level: "level";
                        race: "race";
                        raceClass: "raceClass";
                    }>;
                    faction: z.ZodOptional<z.ZodEnum<{
                        Alliance: "Alliance";
                        Horde: "Horde";
                    }>>;
                    race: z.ZodOptional<z.ZodString>;
                    class: z.ZodOptional<z.ZodString>;
                    band: z.ZodOptional<z.ZodString>;
                    label: z.ZodString;
                    count: z.ZodNullable<z.ZodNumber>;
                    share: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
                note: z.ZodOptional<z.ZodString>;
                source: z.ZodObject<{
                    title: z.ZodString;
                    url: z.ZodString;
                }, z.core.$strip>;
                method: z.ZodObject<{
                    title: z.ZodString;
                    url: z.ZodString;
                }, z.core.$strip>;
                licence: z.ZodString;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly recent_changes: {
        readonly title: "Recent official changes for WoW: Forever";
        readonly description: "Returns the newest official changes for WoW: Forever, newest first: Blizzard blue posts (title, author, time, a short excerpt and the link to the original), hotfix posts, and new game builds. Excerpts only: Blizzard's post text is Blizzard's; full posts are available at their source URLs. A build's time is when Everloot first saw it, not Blizzard's release time. Use it for what Blizzard changed or posted lately; use answer_sources for lore and game facts, and ecosystem_projects for community addons. filter picks one kind; limit caps the entries.";
        readonly inputSchema: {
            readonly filter: z.ZodDefault<z.ZodEnum<{
                all: "all";
                builds: "builds";
                hotfixes: "hotfixes";
                posts: "posts";
            }>>;
            readonly game: z.ZodOptional<z.ZodEnum<{
                classic: "classic";
                forever: "forever";
            }>>;
            readonly limit: z.ZodDefault<z.ZodNumber>;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly entries: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                type: z.ZodEnum<{
                    build: "build";
                    hotfix: "hotfix";
                    post: "post";
                }>;
                game: z.ZodEnum<{
                    classic: "classic";
                    forever: "forever";
                }>;
                at: z.ZodString;
                title: z.ZodString;
                url: z.ZodNullable<z.ZodString>;
                author: z.ZodOptional<z.ZodString>;
                role: z.ZodOptional<z.ZodString>;
                category: z.ZodOptional<z.ZodString>;
                source: z.ZodOptional<z.ZodString>;
                excerpt: z.ZodOptional<z.ZodString>;
                summary: z.ZodOptional<z.ZodString>;
                version: z.ZodOptional<z.ZodString>;
                diffUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                region: z.ZodOptional<z.ZodEnum<{
                    eu: "eu";
                    us: "us";
                }>>;
                topicId: z.ZodOptional<z.ZodNumber>;
                topicSlug: z.ZodOptional<z.ZodString>;
                postNumber: z.ZodOptional<z.ZodNumber>;
                startedThread: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>;
            readonly url: z.ZodOptional<z.ZodString>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly ecosystem_projects: {
        readonly title: "WoW: Forever addons and open-source projects";
        readonly description: "Lists the Forever addons and tools in the community registry, with a board ranking: most installed, rising, most active, freshest release or best maintained. Each project shows its GitHub repository, stars, latest release, last commit, whether its .toc declares a Forever interface number, and installs from Everloot uploads (counted from 3 installs; a missing count means not counted, not zero). Projects are ranked, never people. GitHub facts carry the time they were refreshed. Use it for which Forever addons exist and how maintained they are; use everloot_plan for Everloot's own features, and recent_changes for Blizzard's posts. limit caps the projects listed.";
        readonly inputSchema: {
            readonly board: z.ZodDefault<z.ZodEnum<{
                active: "active";
                all: "all";
                installed: "installed";
                maintained: "maintained";
                release: "release";
                rising: "rising";
            }>>;
            readonly forever_ready_only: z.ZodOptional<z.ZodBoolean>;
            readonly limit: z.ZodDefault<z.ZodNumber>;
        };
        readonly outputSchema: {
            readonly connected: z.ZodBoolean;
            readonly refreshedAt: z.ZodNullable<z.ZodString>;
            readonly installsAvailable: z.ZodBoolean;
            readonly forever: z.ZodNullable<z.ZodObject<{
                interface: z.ZodNumber;
                version: z.ZodString;
                build: z.ZodNumber;
            }, z.core.$strip>>;
            readonly board: z.ZodEnum<{
                active: "active";
                all: "all";
                installed: "installed";
                maintained: "maintained";
                release: "release";
                rising: "rising";
            }>;
            readonly projects: z.ZodArray<z.ZodObject<{
                rank: z.ZodOptional<z.ZodNumber>;
                display: z.ZodOptional<z.ZodString>;
                id: z.ZodString;
                name: z.ZodString;
                kind: z.ZodEnum<{
                    addon: "addon";
                    tool: "tool";
                }>;
                summary: z.ZodString;
                repo: z.ZodString;
                url: z.ZodString;
                installs: z.ZodNullable<z.ZodNumber>;
                stars: z.ZodNullable<z.ZodNumber>;
                release: z.ZodNullable<z.ZodObject<{
                    tag: z.ZodString;
                    date: z.ZodString;
                    url: z.ZodString;
                }, z.core.$strip>>;
                lastCommit: z.ZodNullable<z.ZodString>;
                commits4w: z.ZodNullable<z.ZodNumber>;
                foreverReady: z.ZodEnum<{
                    no: "no";
                    unknown: "unknown";
                    yes: "yes";
                }>;
                badges: z.ZodArray<z.ZodString>;
                maintenanceScore: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            readonly url: z.ZodOptional<z.ZodString>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly everloot_plan: {
        readonly title: "Everloot implementation tracker";
        readonly description: "Returns the Everloot feature catalogue: what is live, what is next, what is waiting, and which reference sites are page shapes only, as the tracker that ships with the site holds it. Use it only for questions about Everloot itself, such as whether a feature exists; it holds no game data. For game facts use search_knowledge or answer_sources; for community addons use ecosystem_projects. Takes no arguments and needs no account.";
        readonly inputSchema: {};
        readonly outputSchema: {
            readonly rows: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                status: z.ZodEnum<{
                    live: "live";
                    next: "next";
                    shape: "shape";
                    waiting: "waiting";
                }>;
                name: z.ZodString;
                done: z.ZodString;
                proof: z.ZodOptional<z.ZodEnum<{
                    client: "client";
                    code: "code";
                    deployed: "deployed";
                    none: "none";
                    public: "public";
                    "real-data": "real-data";
                }>>;
            }, z.core.$strip>>;
            readonly counts: z.ZodObject<{
                live: z.ZodNumber;
                next: z.ZodNumber;
                waiting: z.ZodNumber;
                shape: z.ZodNumber;
            }, z.core.$strip>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly destructiveHint: false;
            readonly idempotentHint: true;
            readonly openWorldHint: false;
        };
    };
};
export type McpToolName = keyof typeof MCP_TOOLS;
/** The parsed arguments one tool receives, defaults applied. */
export type McpToolArgs<K extends McpToolName> = z.infer<z.ZodObject<(typeof MCP_TOOLS)[K]["inputSchema"]>>;
/** The names in the order the server lists them. */
export declare const MCP_TOOL_NAMES: McpToolName[];
/** The list form, for clients that iterate. */
export declare const MCP_TOOL_LIST: ({
    title: "Search the Everloot knowledge base";
    description: "Searches partial names, keywords or a topic across agreed gameplay names, released zones, reference catalogs (achievements, factions, titles, quest chains, mounts, legacy perks, races, instances) and the lore archive; exact-name matches rank first. Use get_by_name only for a known exact full name. Check kind, gameVersion and sourceKind: lore is historical background, not current Forever gameplay. Pass recordId (also id) to get_entity, or fetch as a string; pass a verified gameId to item_page, npc_page, object_page or quest_page. For world_map_near.zone stringify the zone gameId. Lore has no gameId; never turn an archive id or URL number into a game id. Hits carry source, licence and date, plus build or observed snapshot support where available. For achievements, factions, titles and quest chains, read generic records with get_entity and field pagination. Use answer_sources for cited evidence; search is the ChatGPT connector counterpart.";
    inputSchema: {
        query: z.ZodString;
        kind: z.ZodOptional<z.ZodEnum<{
            achievement: "achievement";
            build: "build";
            creator: "creator";
            faction: "faction";
            instance: "instance";
            item: "item";
            legacy_perk: "legacy_perk";
            lore_page: "lore_page";
            mount: "mount";
            npc: "npc";
            object: "object";
            quest: "quest";
            quest_chain: "quest_chain";
            race: "race";
            realm: "realm";
            spell: "spell";
            title: "title";
            zone: "zone";
        }>>;
        version: z.ZodOptional<z.ZodEnum<{
            classic: "classic";
            forever: "forever";
            lore: "lore";
            retail: "retail";
        }>>;
        limit: z.ZodDefault<z.ZodNumber>;
    };
    outputSchema: {
        readonly hits: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            recordId: z.ZodOptional<z.ZodNumber>;
            gameId: z.ZodOptional<z.ZodNumber>;
            sourceKind: z.ZodOptional<z.ZodEnum<{
                "game-files": "game-files";
                lore: "lore";
                observed: "observed";
                reference: "reference";
            }>>;
            build: z.ZodOptional<z.ZodString>;
            observed: z.ZodOptional<z.ZodObject<{
                asOf: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            extId: z.ZodString;
            kind: z.ZodEnum<{
                achievement: "achievement";
                build: "build";
                creator: "creator";
                faction: "faction";
                instance: "instance";
                item: "item";
                legacy_perk: "legacy_perk";
                lore_page: "lore_page";
                mount: "mount";
                npc: "npc";
                object: "object";
                quest: "quest";
                quest_chain: "quest_chain";
                race: "race";
                realm: "realm";
                spell: "spell";
                title: "title";
                zone: "zone";
            }>;
            name: z.ZodString;
            snippet: z.ZodString;
            gameVersion: z.ZodEnum<{
                classic: "classic";
                forever: "forever";
                lore: "lore";
                retail: "retail";
            }>;
            sourceUrl: z.ZodString;
            sourceId: z.ZodString;
            licence: z.ZodString;
            retrievedAt: z.ZodString;
            url: z.ZodOptional<z.ZodString>;
            confirmed: z.ZodOptional<z.ZodObject<{
                asOf: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Get one knowledge record by id";
    description: "Returns one knowledge record's summary, by the numeric id a search_knowledge or get_by_name hit gave: title, a short excerpt in the source's words, the URL to cite, source, licence and date. Gameplay metadata separates recordId from gameId and labels sourceKind, build or observed snapshot support. A game-file record carries its build and says when player uploads confirm it. Use it to read one hit again by its id; for the whole text, call fetch with the same id as a string. An id no record has returns a null hit, not an error. Give field, a JSON pointer such as /questIds, to read one value of the record's data instead of the excerpt; an array comes in pages of up to 48 rows, and nextOffset says where the next page starts. A pointer that leads nowhere answers with the keys it could have used, not an error. Pass only recordId here; a verified gameId from gameplay metadata goes to item_page, npc_page, object_page or quest_page. Lore archive ids are never game ids.";
    inputSchema: {
        readonly field: z.ZodOptional<z.ZodString>;
        readonly offset: z.ZodOptional<z.ZodNumber>;
        readonly limit: z.ZodOptional<z.ZodNumber>;
        readonly id: z.ZodNumber;
    };
    outputSchema: {
        readonly field: z.ZodOptional<z.ZodObject<{
            pointer: z.ZodString;
            value: z.ZodUnknown;
            nextOffset: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        readonly keys: z.ZodOptional<z.ZodArray<z.ZodString>>;
        readonly hit: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            recordId: z.ZodOptional<z.ZodNumber>;
            gameId: z.ZodOptional<z.ZodNumber>;
            sourceKind: z.ZodOptional<z.ZodEnum<{
                "game-files": "game-files";
                lore: "lore";
                observed: "observed";
                reference: "reference";
            }>>;
            build: z.ZodOptional<z.ZodString>;
            observed: z.ZodOptional<z.ZodObject<{
                asOf: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            extId: z.ZodString;
            kind: z.ZodEnum<{
                achievement: "achievement";
                build: "build";
                creator: "creator";
                faction: "faction";
                instance: "instance";
                item: "item";
                legacy_perk: "legacy_perk";
                lore_page: "lore_page";
                mount: "mount";
                npc: "npc";
                object: "object";
                quest: "quest";
                quest_chain: "quest_chain";
                race: "race";
                realm: "realm";
                spell: "spell";
                title: "title";
                zone: "zone";
            }>;
            name: z.ZodString;
            snippet: z.ZodString;
            gameVersion: z.ZodEnum<{
                classic: "classic";
                forever: "forever";
                lore: "lore";
                retail: "retail";
            }>;
            sourceUrl: z.ZodString;
            sourceId: z.ZodString;
            licence: z.ZodString;
            retrievedAt: z.ZodString;
            url: z.ZodOptional<z.ZodString>;
            confirmed: z.ZodOptional<z.ZodObject<{
                asOf: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Get records by exact name";
    description: "Returns records matching a known exact full name, case-insensitively, optionally narrowed by kind. Use search_knowledge for partial names or when this exact lookup misses; no exact match does not mean no gameplay facts exist. Check kind, gameVersion and sourceKind before choosing: lore is archive background and has no gameId. Pass recordId (also id) to get_entity or fetch as a string; pass the separate verified gameId to item_page, npc_page, object_page or quest_page. A zone gameId, as a string, goes to world_map_near.zone. Several kinds can share a name; never guess a game id from a lore record.";
    inputSchema: {
        readonly name: z.ZodString;
        readonly kind: z.ZodOptional<z.ZodEnum<{
            achievement: "achievement";
            build: "build";
            creator: "creator";
            faction: "faction";
            instance: "instance";
            item: "item";
            legacy_perk: "legacy_perk";
            lore_page: "lore_page";
            mount: "mount";
            npc: "npc";
            object: "object";
            quest: "quest";
            quest_chain: "quest_chain";
            race: "race";
            realm: "realm";
            spell: "spell";
            title: "title";
            zone: "zone";
        }>>;
    };
    outputSchema: {
        readonly hits: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            recordId: z.ZodOptional<z.ZodNumber>;
            gameId: z.ZodOptional<z.ZodNumber>;
            sourceKind: z.ZodOptional<z.ZodEnum<{
                "game-files": "game-files";
                lore: "lore";
                observed: "observed";
                reference: "reference";
            }>>;
            build: z.ZodOptional<z.ZodString>;
            observed: z.ZodOptional<z.ZodObject<{
                asOf: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            extId: z.ZodString;
            kind: z.ZodEnum<{
                achievement: "achievement";
                build: "build";
                creator: "creator";
                faction: "faction";
                instance: "instance";
                item: "item";
                legacy_perk: "legacy_perk";
                lore_page: "lore_page";
                mount: "mount";
                npc: "npc";
                object: "object";
                quest: "quest";
                quest_chain: "quest_chain";
                race: "race";
                realm: "realm";
                spell: "spell";
                title: "title";
                zone: "zone";
            }>;
            name: z.ZodString;
            snippet: z.ZodString;
            gameVersion: z.ZodEnum<{
                classic: "classic";
                forever: "forever";
                lore: "lore";
                retail: "retail";
            }>;
            sourceUrl: z.ZodString;
            sourceId: z.ZodString;
            licence: z.ZodString;
            retrievedAt: z.ZodString;
            url: z.ZodOptional<z.ZodString>;
            confirmed: z.ZodOptional<z.ZodObject<{
                asOf: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Search (ChatGPT connector contract)";
    description: "Searches the knowledge base in the shape ChatGPT connectors and deep research call by name: up to 10 results, each with an id for fetch, a title and a URL to cite. It is the same search as search_knowledge. Use it only when the client expects the search and fetch pair; other clients should call search_knowledge. The text block is the same JSON as a string.";
    inputSchema: {
        readonly query: z.ZodString;
    };
    outputSchema: {
        readonly results: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
            url: z.ZodString;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Fetch one document (ChatGPT connector contract)";
    description: "Returns one knowledge record in full, by the string id a search result gave: title, the full text in the source's words, the URL to cite, and metadata with the source, licence and date. It is the ChatGPT connector counterpart of get_entity, which gives only an excerpt. Use it after search, or with a search_knowledge id as a string. Give field, a JSON pointer such as /questIds, to read one value of the record's data: text then holds that value as JSON, and an array comes in pages of up to 48 rows with nextOffset for the next page. A long array in a whole record is cut at 48 rows. The text block is the same JSON as a string.";
    inputSchema: {
        readonly field: z.ZodOptional<z.ZodString>;
        readonly offset: z.ZodOptional<z.ZodNumber>;
        readonly limit: z.ZodOptional<z.ZodNumber>;
        readonly id: z.ZodString;
    };
    outputSchema: {
        field: z.ZodOptional<z.ZodObject<{
            pointer: z.ZodString;
            value: z.ZodUnknown;
            nextOffset: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        keys: z.ZodOptional<z.ZodArray<z.ZodString>>;
        id: z.ZodString;
        title: z.ZodString;
        text: z.ZodString;
        url: z.ZodString;
        metadata: z.ZodObject<{
            kind: z.ZodEnum<{
                achievement: "achievement";
                build: "build";
                creator: "creator";
                faction: "faction";
                instance: "instance";
                item: "item";
                legacy_perk: "legacy_perk";
                lore_page: "lore_page";
                mount: "mount";
                npc: "npc";
                object: "object";
                quest: "quest";
                quest_chain: "quest_chain";
                race: "race";
                realm: "realm";
                spell: "spell";
                title: "title";
                zone: "zone";
            }>;
            gameVersion: z.ZodEnum<{
                classic: "classic";
                forever: "forever";
                lore: "lore";
                retail: "retail";
            }>;
            sourceUrl: z.ZodString;
            sourceId: z.ZodString;
            licence: z.ZodString;
            retrievedAt: z.ZodString;
            credit: z.ZodString;
            confirmed: z.ZodOptional<z.ZodObject<{
                asOf: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Evidence for a question, each piece with its source";
    description: "Returns cited evidence for a natural-language WoW: Forever question: observed, curated, game-file and 2023 Warcraft Wiki claims, each with source URL, licence and date. Start here for why, where or how many. Check that a claim contains the requested fact: a subject mention alone is not an answer. Observations need three agreeing installs; files stay unconfirmed with their build; archive lore may differ in Forever. If the requested fact is absent, say unrecorded rather than importing Classic or retail knowledge. For names use search_knowledge, then the hit's verified gameId with item_page, npc_page or quest_page. Further-reading URLs are search links, not fetched evidence. Disconnected observations are unrecorded, not zero.";
    inputSchema: {
        readonly question: z.ZodString;
        readonly limit: z.ZodDefault<z.ZodNumber>;
    };
    outputSchema: {
        readonly evidence: z.ZodArray<z.ZodObject<{
            claim: z.ZodString;
            kind: z.ZodEnum<{
                curated: "curated";
                files: "files";
                lore: "lore";
                observed: "observed";
            }>;
            source: z.ZodObject<{
                title: z.ZodString;
                url: z.ZodString;
            }, z.core.$strip>;
            licence: z.ZodString;
            asOf: z.ZodNullable<z.ZodString>;
            support: z.ZodOptional<z.ZodNumber>;
            url: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        readonly furtherReading: z.ZodArray<z.ZodObject<{
            site: z.ZodString;
            url: z.ZodString;
        }, z.core.$strip>>;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Profession leveling path";
    description: "Returns a Forever profession leveling route between skill levels: agreed steps, summed reagents and estimated cost, leaving uncovered ranges as gaps. A reported recipe or orange skill range needs 3 agreeing installs. Costs use median reagent prices from at least 3 distinct installs: unscoped observations without realm, build or observation time, not one listing's price or a current realm minimum. Agreed vendor prices may supply reagent costs; training is listed separately. Use recipe_thresholds for colour-change ranges. Use market_value with a verified item gameId and full realm name for a dated realm price. Missing prices stay unknown, never free.";
    inputSchema: {
        readonly profession: z.ZodString;
        readonly fromSkill: z.ZodDefault<z.ZodNumber>;
        readonly toSkill: z.ZodNumber;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            profession: z.ZodString;
            fromSkill: z.ZodNumber;
            toSkill: z.ZodNumber;
            steps: z.ZodArray<z.ZodObject<{
                recipe: z.ZodString;
                fromSkill: z.ZodNumber;
                toSkill: z.ZodNumber;
                crafts: z.ZodNumber;
                points: z.ZodNumber;
                reagents: z.ZodArray<z.ZodObject<{
                    item: z.ZodString;
                    count: z.ZodNumber;
                }, z.core.$strip>>;
                copper: z.ZodNullable<z.ZodNumber>;
                reporters: z.ZodNumber;
                trainingCopper: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            }, z.core.$strip>>;
            gaps: z.ZodArray<z.ZodObject<{
                fromSkill: z.ZodNumber;
                toSkill: z.ZodNumber;
            }, z.core.$strip>>;
            reagents: z.ZodArray<z.ZodObject<{
                item: z.ZodString;
                count: z.ZodNumber;
            }, z.core.$strip>>;
            copper: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Recipe skill ranges";
    description: "Returns where one Forever profession's recipes turn yellow, green and grey, as skill ranges inferred from the colours players' trade-skill windows showed, never guessed exact numbers. A recipe appears only after 3 installs agree. Agreed reagents come with estimated cost per craft from unscoped median prices from at least 3 installs, or agreed vendor prices; missing prices stay unknown. Use it for how long a recipe keeps giving skill points; use profession_path for a step-by-step route between two skill levels. Narrow the list with part of a recipe name. Reads Everloot's current public corpus.";
    inputSchema: {
        readonly profession: z.ZodString;
        readonly recipe: z.ZodOptional<z.ZodString>;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            profession: z.ZodString;
            ranges: z.ZodArray<z.ZodObject<{
                profession: z.ZodString;
                recipe: z.ZodString;
                installs: z.ZodNumber;
                observations: z.ZodNumber;
                yellow: z.ZodObject<{
                    min: z.ZodNullable<z.ZodNumber>;
                    max: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>;
                green: z.ZodObject<{
                    min: z.ZodNullable<z.ZodNumber>;
                    max: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>;
                grey: z.ZodObject<{
                    min: z.ZodNullable<z.ZodNumber>;
                    max: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>;
                reagents: z.ZodNullable<z.ZodArray<z.ZodObject<{
                    item: z.ZodString;
                    count: z.ZodNumber;
                }, z.core.$strip>>>;
                costCopper: z.ZodNullable<z.ZodNumber>;
                missingPrices: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Item page for a drop";
    description: "Returns one Forever item's page by item id: the agreed name, drop frequency from observed loot windows, agreed map pins, and player-reported armor, block, damage per second, stats and resistances. A number is public when one value has 3 agreeing installs in the newest build that 3 installs reported, and no competing value has 3; contested numbers are withheld. Each number states its agreeing installs, build and last seen, with the corpus date and method. Missing numbers are [?] with a reason. No baseline rows or player names. Use it when you have an item id; use market_value for its price, entity_relations for what drops or sells it, and item_categories for its class and slot. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. If only a name is known, call search_knowledge first and use its item gameId, never recordId or a lore URL number.";
    inputSchema: {
        readonly itemId: z.ZodNumber;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            itemId: z.ZodNumber;
            name: z.ZodNullable<z.ZodString>;
            drops: z.ZodArray<z.ZodObject<{
                sourceNpcId: z.ZodOptional<z.ZodNumber>;
                sourceObjectId: z.ZodOptional<z.ZodNumber>;
                source: z.ZodString;
                kills: z.ZodNumber;
                drops: z.ZodNumber;
                rate: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>;
            pins: z.ZodArray<z.ZodObject<{
                npcId: z.ZodNumber;
                name: z.ZodNullable<z.ZodString>;
                mapId: z.ZodNumber;
                x: z.ZodNumber;
                y: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>;
            pendingLoot: z.ZodOptional<z.ZodObject<{
                windows: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>;
            reported: z.ZodOptional<z.ZodObject<{
                shown: z.ZodArray<z.ZodObject<{
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
                    reporters: z.ZodNumber;
                    build: z.ZodString;
                    lastSeen: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                contested: z.ZodArray<z.ZodEnum<{
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
                }>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "NPC page";
    description: "Returns one Forever NPC's page by NPC id: the agreed name, the agreed map pins, and the loot windows reported for it that are not yet in the drop rates. A name or pin needs 3 installs agreeing; a pin does not require a drop. No copied spawn list. Use it to name or place an NPC when you have its id, from a search_knowledge hit, a drop row or entity_relations; use vendor_page for what an NPC sells, item_page for one drop's rate, entity_relations for every typed link, and world_map_near for what stands around it. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. Resolve a name with search_knowledge first; use its NPC gameId, never its recordId.";
    inputSchema: {
        readonly npcId: z.ZodNumber;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            npcId: z.ZodNumber;
            name: z.ZodNullable<z.ZodString>;
            pins: z.ZodArray<z.ZodObject<{
                mapId: z.ZodNumber;
                x: z.ZodNumber;
                y: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>;
            pendingLoot: z.ZodOptional<z.ZodObject<{
                windows: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Game object page";
    description: "Returns one game object's page (a chest, herb, ore vein or fishing pool) by its entry id: the items players looted from it, each with observed loot windows, windows with the item and distinct install reports, and where players saw it on the minimap. A frequency is public after 3 install reports; a public object with nothing in its windows reads as a measured zero. The name shows once 3 installs agree on it. Use it for gathering nodes and containers; use npc_page for creatures, and item_page for every source of one item. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. Resolve names with search_knowledge and pass the object gameId, never an archive recordId.";
    inputSchema: {
        readonly objectId: z.ZodNumber;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            objectId: z.ZodNumber;
            name: z.ZodNullable<z.ZodString>;
            drops: z.ZodArray<z.ZodObject<{
                itemId: z.ZodNumber;
                itemName: z.ZodNullable<z.ZodString>;
                kills: z.ZodNumber;
                drops: z.ZodNumber;
                rate: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>;
            zero: z.ZodNullable<z.ZodObject<{
                kills: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>;
            queued: z.ZodBoolean;
            pendingLoot: z.ZodOptional<z.ZodObject<{
                windows: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>;
            pins: z.ZodOptional<z.ZodArray<z.ZodObject<{
                mapId: z.ZodNumber;
                x: z.ZodNumber;
                y: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Quest page";
    description: "Returns one Forever quest's page by quest id: agreed title, level, giver, turn-in and rewards. Each fact needs 3 installs agreeing. No copied quest text. Use it when you have a quest id, from a search_knowledge hit or entity_relations; use answer_sources for a question about the quest's story or chain, and entity_relations for what the quest rewards. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. Resolve names with search_knowledge and use the quest gameId, never recordId. For quest_chain records use get_entity with field and nextOffset to read the chain.";
    inputSchema: {
        readonly questId: z.ZodNumber;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            questId: z.ZodNumber;
            title: z.ZodNullable<z.ZodString>;
            level: z.ZodNullable<z.ZodNumber>;
            giverNpcId: z.ZodNullable<z.ZodNumber>;
            turnInNpcId: z.ZodNullable<z.ZodNumber>;
            rewards: z.ZodArray<z.ZodNumber>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Vendor page";
    description: "Returns the goods one Forever vendor sells, by the vendor's NPC id, each with the copper price players saw. An item is listed when 3 installs agree on that item and its copper price; two agreed prices both stay listed. No copied catalog. Use it for what a vendor sells and at what price; use npc_page for where the vendor stands, entity_relations with the sold_by relation for who sells an item, and market_value for auction prices. The id is the same NPC id npc_page takes. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. For a vendor name, resolve its NPC gameId with search_knowledge first.";
    inputSchema: {
        readonly vendorNpcId: z.ZodNumber;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            vendorNpcId: z.ZodNumber;
            offers: z.ZodArray<z.ZodObject<{
                itemId: z.ZodNumber;
                priceCopper: z.ZodNumber;
                limitedStock: z.ZodNullable<z.ZodNumber>;
                unlimited: z.ZodBoolean;
                reporters: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "What is near a place on the map";
    description: `Lists the entrances, NPCs, vendors and treasures near a spot, nearest first, with straight-line distances in yards. Give a zone (name or map id) with x and y from 0 to 100, or an NPC id to start from where that NPC stands. Entrances come from the game files; one is confirmed once 3 installs zoned in from it. NPCs, vendors and treasures are player-observed and listed only where 3 installs agree on the position. Zones the files hold back as possibly unreleased are not offered. Use it for what is near a spot; use npc_page, vendor_page or entity_relations for one entity's own facts. Reads Everloot's public player data when connected.`;
    inputSchema: {
        readonly zone: z.ZodOptional<z.ZodString>;
        readonly x: z.ZodOptional<z.ZodNumber>;
        readonly y: z.ZodOptional<z.ZodNumber>;
        readonly npcId: z.ZodOptional<z.ZodNumber>;
        readonly radius: z.ZodDefault<z.ZodNumber>;
        readonly limit: z.ZodDefault<z.ZodNumber>;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            ok: z.ZodBoolean;
            message: z.ZodOptional<z.ZodString>;
            origin: z.ZodOptional<z.ZodString>;
            radius: z.ZodOptional<z.ZodNumber>;
            limit: z.ZodOptional<z.ZodNumber>;
            entrances: z.ZodOptional<z.ZodArray<z.ZodObject<{
                names: z.ZodArray<z.ZodString>;
                raid: z.ZodBoolean;
                zone: z.ZodNullable<z.ZodString>;
                yards: z.ZodNumber;
                confirmed: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>>;
            npcs: z.ZodOptional<z.ZodArray<z.ZodObject<{
                npcId: z.ZodNumber;
                name: z.ZodNullable<z.ZodString>;
                mapId: z.ZodNumber;
                zoneName: z.ZodString;
                x: z.ZodNumber;
                y: z.ZodNumber;
                yards: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>>;
            vendors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                npcId: z.ZodNumber;
                name: z.ZodNullable<z.ZodString>;
                mapId: z.ZodNumber;
                zoneName: z.ZodString;
                x: z.ZodNumber;
                y: z.ZodNumber;
                yards: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>>;
            treasures: z.ZodOptional<z.ZodArray<z.ZodObject<{
                objectId: z.ZodNumber;
                name: z.ZodNullable<z.ZodString>;
                mapId: z.ZodNumber;
                zoneName: z.ZodString;
                x: z.ZodNumber;
                y: z.ZodNumber;
                yards: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "How an item, NPC, spell or quest connects to others";
    description: "Lists every typed relation of one entity, in both directions, grouped by relation. Player-observed relations (dropped by, sold by, reward from, located in) are listed where 3 installs agree, with the install count and last seen. Game-file relations (created by, reagent for, part of set, same icon) are found in game files, unconfirmed, with the build they came from. Ids are verified game ids from search_knowledge, a page tool, a drop row or world_map_near. For an NPC's drops use kind=npc, rel=dropped_by, direction=to; for an item's sources use kind=item, direction=from. Use it for where something comes from or what something drops, sells or rewards; use the page tools (item_page, npc_page, quest_page) for one entity's own facts, and world_map_near for what is near a place. Reads Everloot's public player data and the game-file relations of the current build.";
    inputSchema: {
        readonly kind: z.ZodEnum<{
            icon: "icon";
            item: "item";
            item_set: "item_set";
            npc: "npc";
            object: "object";
            quest: "quest";
            skill: "skill";
            spell: "spell";
            zone: "zone";
        }>;
        readonly id: z.ZodNumber;
        readonly rel: z.ZodOptional<z.ZodEnum<{
            created_by: "created_by";
            dropped_by: "dropped_by";
            in_skill_line: "in_skill_line";
            located_in: "located_in";
            part_of_set: "part_of_set";
            reagent_for: "reagent_for";
            reward_from: "reward_from";
            same_icon: "same_icon";
            sold_by: "sold_by";
        }>>;
        readonly direction: z.ZodDefault<z.ZodEnum<{
            both: "both";
            from: "from";
            to: "to";
        }>>;
        readonly limit: z.ZodDefault<z.ZodNumber>;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<{
                icon: "icon";
                item: "item";
                item_set: "item_set";
                npc: "npc";
                object: "object";
                quest: "quest";
                skill: "skill";
                spell: "spell";
                zone: "zone";
            }>;
            id: z.ZodNumber;
            edges: z.ZodArray<z.ZodObject<{
                fromKind: z.ZodEnum<{
                    icon: "icon";
                    item: "item";
                    item_set: "item_set";
                    npc: "npc";
                    object: "object";
                    quest: "quest";
                    skill: "skill";
                    spell: "spell";
                    zone: "zone";
                }>;
                fromId: z.ZodNumber;
                rel: z.ZodEnum<{
                    created_by: "created_by";
                    dropped_by: "dropped_by";
                    in_skill_line: "in_skill_line";
                    located_in: "located_in";
                    part_of_set: "part_of_set";
                    reagent_for: "reagent_for";
                    reward_from: "reward_from";
                    same_icon: "same_icon";
                    sold_by: "sold_by";
                }>;
                toKind: z.ZodEnum<{
                    icon: "icon";
                    item: "item";
                    item_set: "item_set";
                    npc: "npc";
                    object: "object";
                    quest: "quest";
                    skill: "skill";
                    spell: "spell";
                    zone: "zone";
                }>;
                toId: z.ZodNumber;
                evidence: z.ZodEnum<{
                    client: "client";
                    observed: "observed";
                }>;
                build: z.ZodNullable<z.ZodString>;
                installs: z.ZodNullable<z.ZodNumber>;
                firstSeen: z.ZodNullable<z.ZodString>;
                lastSeen: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            notShown: z.ZodNumber;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Item categories: class, subclass, slot and quality";
    description: "Lists item categories from the game files (found in game files, unconfirmed, with the build): class and subclass with the client's English names and slugs, slot and quality. With no arguments, the whole tree with item counts. With item, that item's category path. With class (a slug such as weapon or armor), and optionally subclass, slot and quality slugs, the item ids in it. Use it to place an item in its category or to list a category; use item_page for an item's name and stats, and entity_relations for where it comes from. Ids only: item names come from player uploads, through item_page.";
    inputSchema: {
        readonly item: z.ZodOptional<z.ZodNumber>;
        readonly class: z.ZodOptional<z.ZodString>;
        readonly subclass: z.ZodOptional<z.ZodString>;
        readonly slot: z.ZodOptional<z.ZodString>;
        readonly quality: z.ZodOptional<z.ZodEnum<{
            artifact: "artifact";
            common: "common";
            epic: "epic";
            heirloom: "heirloom";
            legendary: "legendary";
            poor: "poor";
            rare: "rare";
            uncommon: "uncommon";
        }>>;
        readonly limit: z.ZodDefault<z.ZodNumber>;
    };
    outputSchema: {
        readonly label: z.ZodString;
        readonly build: z.ZodString;
        readonly item: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            itemId: z.ZodNumber;
            class: z.ZodNullable<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodString;
                label: z.ZodString;
                slug: z.ZodString;
            }, z.core.$strip>>;
            subclass: z.ZodNullable<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodNullable<z.ZodString>;
                slug: z.ZodString;
            }, z.core.$strip>>;
            slot: z.ZodNullable<z.ZodObject<{
                inventoryType: z.ZodNumber;
                name: z.ZodString;
                slug: z.ZodString;
            }, z.core.$strip>>;
            quality: z.ZodNullable<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodString;
                slug: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>>;
        readonly classes: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            name: z.ZodString;
            slug: z.ZodString;
            items: z.ZodNumber;
            subclasses: z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodNullable<z.ZodString>;
                slug: z.ZodString;
                items: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>>;
        readonly items: z.ZodOptional<z.ZodArray<z.ZodObject<{
            itemId: z.ZodNumber;
            class: z.ZodNullable<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodString;
                label: z.ZodString;
                slug: z.ZodString;
            }, z.core.$strip>>;
            subclass: z.ZodNullable<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodNullable<z.ZodString>;
                slug: z.ZodString;
            }, z.core.$strip>>;
            slot: z.ZodNullable<z.ZodObject<{
                inventoryType: z.ZodNumber;
                name: z.ZodString;
                slug: z.ZodString;
            }, z.core.$strip>>;
            quality: z.ZodNullable<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodString;
                slug: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>>;
        readonly total: z.ZodOptional<z.ZodNumber>;
        readonly error: z.ZodOptional<z.ZodString>;
        readonly credit: z.ZodString;
        readonly url: z.ZodOptional<z.ZodString>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Talent trees for one class";
    description: "Returns the WoW: Forever talent trees of one class from the game files (found in game files, unconfirmed, with the build): every node with its talents, ranks, grid position, prerequisites and row gate, plus the levels talent points arrive at. Node ids are the ids a share code names. Use it to read or explain a class's trees; use talent_plan to decode a share code against them, and class_races for which races can be the class. Narrow to one tree by name; without it the answer holds every node of every tree. With builds, the answer also lists the Everloot team's published starter builds for the class, each labelled as the team's and not observed, with its share code and page. The answer links the calculator.";
    inputSchema: {
        readonly class: z.ZodEnum<{
            druid: "druid";
            hunter: "hunter";
            mage: "mage";
            paladin: "paladin";
            priest: "priest";
            rogue: "rogue";
            shaman: "shaman";
            warlock: "warlock";
            warrior: "warrior";
        }>;
        readonly tree: z.ZodOptional<z.ZodString>;
        readonly builds: z.ZodDefault<z.ZodBoolean>;
    };
    outputSchema: {
        readonly label: z.ZodString;
        readonly build: z.ZodString;
        readonly class: z.ZodEnum<{
            druid: "druid";
            hunter: "hunter";
            mage: "mage";
            paladin: "paladin";
            priest: "priest";
            rogue: "rogue";
            shaman: "shaman";
            warlock: "warlock";
            warrior: "warrior";
        }>;
        readonly className: z.ZodString;
        readonly specId: z.ZodNumber;
        readonly points: z.ZodObject<{
            firstPointLevel: z.ZodNumber;
            maxLevel: z.ZodNumber;
            total: z.ZodNumber;
            pointLevels: z.ZodArray<z.ZodNumber>;
        }, z.core.$strip>;
        readonly trees: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            name: z.ZodString;
            nodes: z.ZodNumber;
        }, z.core.$strip>>;
        readonly nodes: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            treeId: z.ZodNumber;
            row: z.ZodNumber;
            col: z.ZodNumber;
            kind: z.ZodEnum<{
                choice: "choice";
                single: "single";
                tiered: "tiered";
            }>;
            maxRanks: z.ZodNumber;
            talents: z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                spellId: z.ZodNullable<z.ZodNumber>;
                maxRanks: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            prereqs: z.ZodArray<z.ZodNumber>;
            anyOf: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
            gate: z.ZodOptional<z.ZodObject<{
                pointsInTree: z.ZodOptional<z.ZodNumber>;
                pointsTotal: z.ZodOptional<z.ZodNumber>;
                scope: z.ZodOptional<z.ZodEnum<{
                    class: "class";
                    tree: "tree";
                    unconfirmed: "unconfirmed";
                }>>;
                ranksInNodes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    nodeId: z.ZodNumber;
                    ranks: z.ZodNumber;
                }, z.core.$strip>>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        readonly starterBuilds: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            purpose: z.ZodEnum<{
                dungeon: "dungeon";
                leveling: "leveling";
                pvp: "pvp";
                raid: "raid";
            }>;
            tree: z.ZodString;
            shareCode: z.ZodString;
            points: z.ZodNumber;
            build: z.ZodString;
            url: z.ZodString;
            label: z.ZodLiteral<"Everloot team starter build, not observed">;
        }, z.core.$strip>>>;
        readonly credit: z.ZodString;
        readonly url: z.ZodOptional<z.ZodString>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Read a talent share code";
    description: "Decodes an Everloot talent share code (EL1-<class>-<spec>-<build>-<payload>, or a calculator link carrying one after #plan=) against the class's trees: the talents and ranks it holds, points per tree, the lowest level that can hold it, and every problem in plain words: a code made on another build, nodes the tree does not have, ranks cut back, points the rules would not place. Nothing is dropped silently. Use it when given a share code or a calculator link; use talent_tree to read the trees themselves. Game-file data, found in game files, unconfirmed.";
    inputSchema: {
        readonly code: z.ZodString;
    };
    outputSchema: {
        readonly ok: z.ZodBoolean;
        readonly message: z.ZodOptional<z.ZodString>;
        readonly class: z.ZodOptional<z.ZodEnum<{
            druid: "druid";
            hunter: "hunter";
            mage: "mage";
            paladin: "paladin";
            priest: "priest";
            rogue: "rogue";
            shaman: "shaman";
            warlock: "warlock";
            warrior: "warrior";
        }>>;
        readonly className: z.ZodOptional<z.ZodString>;
        readonly codeBuild: z.ZodOptional<z.ZodString>;
        readonly treeBuild: z.ZodOptional<z.ZodString>;
        readonly pointsSpent: z.ZodOptional<z.ZodNumber>;
        readonly minLevel: z.ZodOptional<z.ZodNumber>;
        readonly byTree: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            name: z.ZodString;
            points: z.ZodNumber;
        }, z.core.$strip>>>;
        readonly talents: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            treeId: z.ZodNumber;
            name: z.ZodString;
            rank: z.ZodNumber;
            maxRanks: z.ZodNumber;
            choice: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
        readonly problems: z.ZodOptional<z.ZodArray<z.ZodString>>;
        readonly link: z.ZodOptional<z.ZodString>;
        readonly label: z.ZodString;
        readonly credit: z.ZodString;
        readonly url: z.ZodOptional<z.ZodString>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Races that can be a class, with their racial traits";
    description: "Lists which races can be one class in WoW: Forever, on which faction, and each race's racial traits (name, active or passive) from the game files (found in game files, unconfirmed, with the build). Narrow to one faction. Use it for whether a race can be a class, or which races a class is open to; use talent_tree for the class's talents, and population for how many play it. What each trait does is on the class page, linked from the answer.";
    inputSchema: {
        readonly class: z.ZodString;
        readonly faction: z.ZodOptional<z.ZodEnum<{
            alliance: "alliance";
            horde: "horde";
        }>>;
    };
    outputSchema: {
        readonly label: z.ZodString;
        readonly build: z.ZodString;
        readonly class: z.ZodOptional<z.ZodEnum<{
            druid: "druid";
            hunter: "hunter";
            mage: "mage";
            paladin: "paladin";
            priest: "priest";
            rogue: "rogue";
            shaman: "shaman";
            warlock: "warlock";
            warrior: "warrior";
        }>>;
        readonly className: z.ZodOptional<z.ZodString>;
        readonly faction: z.ZodOptional<z.ZodEnum<{
            alliance: "alliance";
            horde: "horde";
        }>>;
        readonly factions: z.ZodArray<z.ZodObject<{
            faction: z.ZodEnum<{
                Alliance: "Alliance";
                Horde: "Horde";
                Neutral: "Neutral";
            }>;
            races: z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodString;
                traits: z.ZodArray<z.ZodObject<{
                    name: z.ZodString;
                    kind: z.ZodEnum<{
                        active: "active";
                        passive: "passive";
                    }>;
                    order: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        readonly error: z.ZodOptional<z.ZodString>;
        readonly credit: z.ZodString;
        readonly url: z.ZodOptional<z.ZodString>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Owned versus missing in a collection";
    description: "Returns what one install still misses in one collection, against what that install uploaded as owned, grouped by source. A list row is public after 3 installs agree on the collection, the source and the item; owned is what that install uploaded. Not a Blizzard profile read and not a copied catalog. Use it for which items of a collection a player is missing; use completion_progress for achievements, reputations and titles. When that install never uploaded the collection, the answer says owned is unknown, not empty. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. Ask for the player's deliberately shared ownerInstallId from their own EverlootDB.installId in SavedVariables/Everloot.lua and required sharing setup; never infer or probe another owner's id.";
    inputSchema: {
        readonly collection: z.ZodString;
        readonly ownerInstallId: z.ZodString;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            collection: z.ZodString;
            ownerInstallId: z.ZodString;
            groups: z.ZodArray<z.ZodObject<{
                source: z.ZodString;
                owned: z.ZodArray<z.ZodNumber>;
                missing: z.ZodArray<z.ZodNumber>;
            }, z.core.$strip>>;
            queued: z.ZodArray<z.ZodNumber>;
            ownedRecorded: z.ZodBoolean;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Achievement, reputation, title and quest progress";
    description: "Shows what one install's characters have finished and what is closest to done: achievements with the largest share of criteria or progress met, reputations nearest the next standing, titles known, and quests finished in a chain. A list entry is public after 3 players (installs uploading from different addresses) report it identically. Progress shows only when that install uploaded it with the collection sharing choice and a verified grant; without it the answer says so. Not a Blizzard profile read and not a copied catalog. Use it for what a player is closest to finishing; use collection_gap for missing collection items, and guild_board for a guild's kills. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. Ask for the player's deliberately shared ownerInstallId from their own EverlootDB.installId in SavedVariables/Everloot.lua and optional characterKey from their completion upload; never guess them or probe other players.";
    inputSchema: {
        readonly ownerInstallId: z.ZodString;
        readonly characterKey: z.ZodOptional<z.ZodString>;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            ownerInstallId: z.ZodString;
            listed: z.ZodObject<{
                achievements: z.ZodNumber;
                factions: z.ZodNumber;
                titles: z.ZodNumber;
                chains: z.ZodNumber;
            }, z.core.$strip>;
            ownedRecorded: z.ZodBoolean;
            characters: z.ZodArray<z.ZodObject<{
                characterKey: z.ZodString;
                class: z.ZodString;
                level: z.ZodNumber;
                achievements: z.ZodObject<{
                    done: z.ZodNumber;
                    total: z.ZodNumber;
                    points: z.ZodNumber;
                    pointsTotal: z.ZodNumber;
                    closest: z.ZodArray<z.ZodObject<{
                        achievementId: z.ZodNumber;
                        name: z.ZodString;
                        category: z.ZodString;
                        have: z.ZodNumber;
                        of: z.ZodNumber;
                        unit: z.ZodEnum<{
                            criteria: "criteria";
                            progress: "progress";
                        }>;
                    }, z.core.$strip>>;
                    unlisted: z.ZodNumber;
                }, z.core.$strip>;
                reputation: z.ZodObject<{
                    exalted: z.ZodNumber;
                    total: z.ZodNumber;
                    closest: z.ZodArray<z.ZodObject<{
                        factionId: z.ZodNumber;
                        name: z.ZodString;
                        standing: z.ZodString;
                        toNext: z.ZodNumber;
                        header: z.ZodOptional<z.ZodString>;
                    }, z.core.$strip>>;
                    unscaled: z.ZodArray<z.ZodObject<{
                        factionId: z.ZodNumber;
                        name: z.ZodString;
                        standing: z.ZodNumber;
                    }, z.core.$strip>>;
                    unlisted: z.ZodNumber;
                }, z.core.$strip>;
                titles: z.ZodObject<{
                    known: z.ZodNumber;
                    total: z.ZodNumber;
                    unlisted: z.ZodNumber;
                }, z.core.$strip>;
                quests: z.ZodObject<{
                    completed: z.ZodNumber;
                    chainsDone: z.ZodNumber;
                    chainsTotal: z.ZodNumber;
                    closest: z.ZodArray<z.ZodObject<{
                        questLineId: z.ZodNumber;
                        name: z.ZodString;
                        done: z.ZodNumber;
                        total: z.ZodNumber;
                        truncated: z.ZodBoolean;
                    }, z.core.$strip>>;
                }, z.core.$strip>;
            }, z.core.$strip>>;
            unknownCharacter: z.ZodOptional<z.ZodString>;
            droppedCharacters: z.ZodNumber;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Guild board its officers published";
    description: "Returns one guild's published officer board and public progression. Use guild_search first for its exact name and realm; use guild_rankings to compare guilds in an instance. Roster, kills, loot, attendance and item level need 2 agreeing officers with verified grants. Public kills need 2 members' installs or an officer-published kill; sightings show characters the addon saw, not the game's roster. Characters can opt out and hidden guilds return no answer. Without an officer board, only the public part is available. Item level names how many roster members were measured, never a combined score. Names are in-game names only. Missing or disconnected data is unrecorded, not zero.";
    inputSchema: {
        readonly guildName: z.ZodString;
        readonly realm: z.ZodString;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            guildName: z.ZodString;
            realm: z.ZodString;
            memberCount: z.ZodNullable<z.ZodNumber>;
            roster: z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                rank: z.ZodString;
                level: z.ZodNumber;
                className: z.ZodString;
            }, z.core.$strip>>;
            progression: z.ZodArray<z.ZodObject<{
                instance: z.ZodString;
                bosses: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            loot: z.ZodArray<z.ZodObject<{
                itemId: z.ZodNumber;
                recipient: z.ZodString;
                sourceBoss: z.ZodString;
            }, z.core.$strip>>;
            averageItemLevel: z.ZodNullable<z.ZodNumber>;
            gearCoverage: z.ZodObject<{
                measured: z.ZodNumber;
                roster: z.ZodNumber;
            }, z.core.$strip>;
            present: z.ZodArray<z.ZodString>;
            attendanceWaiting: z.ZodBoolean;
            ladderProgression: z.ZodOptional<z.ZodArray<z.ZodObject<{
                instanceMapId: z.ZodNumber;
                name: z.ZodString;
                killed: z.ZodNumber;
                bosses: z.ZodNumber;
                list: z.ZodArray<z.ZodObject<{
                    encounterId: z.ZodNumber;
                    name: z.ZodString;
                    killed: z.ZodBoolean;
                    killedAt: z.ZodNullable<z.ZodString>;
                    source: z.ZodNullable<z.ZodEnum<{
                        members: "members";
                        officers: "officers";
                    }>>;
                }, z.core.$strip>>;
            }, z.core.$strip>>>;
            activity: z.ZodOptional<z.ZodArray<z.ZodObject<{
                encounterId: z.ZodNumber;
                name: z.ZodString;
                instanceMapId: z.ZodNumber;
                killedAt: z.ZodString;
                source: z.ZodEnum<{
                    members: "members";
                    officers: "officers";
                }>;
            }, z.core.$strip>>>;
            seenRoster: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                count: z.ZodNumber;
                members: z.ZodArray<z.ZodObject<{
                    name: z.ZodString;
                    level: z.ZodNumber;
                    class: z.ZodString;
                    lastSeen: z.ZodString;
                }, z.core.$strip>>;
            }, z.core.$strip>>>;
            ranks: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                instanceMapId: z.ZodNumber;
                instanceName: z.ZodString;
                realm: z.ZodNumber;
                overall: z.ZodNumber;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Find a guild by the start of its name";
    description: "Finds the guilds whose name starts with what you typed, each with its realm, faction, how many characters the addon saw in it, and the count and date of its agreed boss kills. A guild is listed once 2 of its members' installs report the same boss, once its officers published a board, or once a character was seen in it. Guild names only, never a member's name, and a guild that asked to be hidden is left out. Characters seen are counted only when the player pages are connected; otherwise the count is unrecorded, not zero. Use it to find a guild's exact name and realm before guild_board; use guild_rankings for a ladder. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.";
    inputSchema: {
        readonly query: z.ZodString;
        readonly limit: z.ZodDefault<z.ZodNumber>;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            guilds: z.ZodArray<z.ZodObject<{
                guildName: z.ZodString;
                realm: z.ZodString;
                faction: z.ZodNullable<z.ZodEnum<{
                    alliance: "alliance";
                    horde: "horde";
                }>>;
                membersSeen: z.ZodNullable<z.ZodNumber>;
                kills: z.ZodNumber;
                latestKillAt: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Guild ladder for one raid or dungeon";
    description: "Ranks every guild with an agreed kill in one instance: by bosses killed, then by who reached its latest kill first, then by name; equal rows share a rank. A kill is a guild's once 2 of its members' installs report the same boss there, timed at the earliest report, or once its officers published it on the guild board, which carries no time. The boss list is the encounters 3 installs reported in that instance, in that order; a boss not on it counts for nothing. There is no score, no rating and no total across instances. Use it to compare guilds' progress in one raid or dungeon; use guild_board for one guild's own board, and guild_search to find a guild. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly.";
    inputSchema: {
        readonly instanceMapId: z.ZodOptional<z.ZodNumber>;
        readonly realm: z.ZodOptional<z.ZodString>;
        readonly faction: z.ZodOptional<z.ZodEnum<{
            alliance: "alliance";
            horde: "horde";
        }>>;
        readonly limit: z.ZodDefault<z.ZodNumber>;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            instance: z.ZodNullable<z.ZodObject<{
                instanceMapId: z.ZodNumber;
                name: z.ZodString;
            }, z.core.$strip>>;
            rows: z.ZodArray<z.ZodObject<{
                rank: z.ZodNumber;
                guildName: z.ZodString;
                realm: z.ZodString;
                faction: z.ZodNullable<z.ZodEnum<{
                    alliance: "alliance";
                    horde: "horde";
                }>>;
                killed: z.ZodNumber;
                bosses: z.ZodNumber;
                latestKillAt: z.ZodNullable<z.ZodString>;
                membersSeen: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Auction history for one item";
    description: "Returns one item's dated auction history on one Forever realm: public full-scan days used by market_value, plus separate browsing sightings. Browsing prices are the median of each install's last scan that day. A day needs 3 reporters, or, while few players upload, Everloot's own installs; preserve the own-scan label and counts. Use the full realm name (CAMWOW US1 Realm 4 PvP); a unique whole-word suffix of at least two words also resolves. Ambiguous or unknown names return candidates; choose a full name before retrying. Full-scan days use the house with most units listed (ties: Alliance, Horde, Neutral), the same house as market_value structured content; browsing sightings remain a separate source, not split by house. No house selector exists; preserve the house named in the text. Use market_value for value and latest scan details, item_page for facts and vendor_page for vendor prices. Keep scan dates and corpus age; an old minimum is not a live auction offer. Missing data is unrecorded, not zero.";
    inputSchema: {
        readonly realm: z.ZodString;
        readonly itemId: z.ZodNumber;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            realmStatus: z.ZodOptional<z.ZodEnum<{
                alias: "alias";
                ambiguous: "ambiguous";
                exact: "exact";
                unknown: "unknown";
            }>>;
            askedRealm: z.ZodOptional<z.ZodString>;
            candidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
            realm: z.ZodString;
            itemId: z.ZodNumber;
            points: z.ZodArray<z.ZodObject<{
                day: z.ZodString;
                copper: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>;
            scanDays: z.ZodOptional<z.ZodArray<z.ZodObject<{
                day: z.ZodString;
                min: z.ZodNumber;
                market: z.ZodNumber;
                quantity: z.ZodNumber;
                reporters: z.ZodNumber;
                thin: z.ZodBoolean;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Forever market value for one item";
    description: "Returns one item's market value, historical value, minimum buyout and units listed from uploaded full auction scans on one Forever realm. Daily values are medians of reporters' values; a day needs 3 reporters from distinct addresses, or Everloot's own installs while few players upload, labelled with counts. Market value weights public days up to 14 calendar days old toward recent days, excluding thin days (5 units or fewer) and outliers. Historical is the median over 60 calendar days, using non-thin days when present. Use the full realm name (CAMWOW US1 Realm 4 PvP), or a unique whole-word suffix of at least two words. Ambiguous or unknown names return candidates; select a full name and retry. Text lists each auction house separately; structured content uses the house with most units listed (ties: Alliance, Horde, Neutral), named in the text. No input selects a house; never blend their prices. Preserve scan dates and corpus age: the minimum is a recorded scan, not a live offer. Use auction_history for dated history and vendor_page for vendor prices. Get a verified item gameId via search_knowledge first if needed.";
    inputSchema: {
        readonly realm: z.ZodString;
        readonly itemId: z.ZodNumber;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            realmStatus: z.ZodOptional<z.ZodEnum<{
                alias: "alias";
                ambiguous: "ambiguous";
                exact: "exact";
                unknown: "unknown";
            }>>;
            askedRealm: z.ZodOptional<z.ZodString>;
            candidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
            realm: z.ZodString;
            itemId: z.ZodNumber;
            value: z.ZodNullable<z.ZodObject<{
                itemId: z.ZodNumber;
                market: z.ZodNullable<z.ZodNumber>;
                min: z.ZodNumber;
                historical: z.ZodNumber;
                quantity: z.ZodNumber;
                day: z.ZodString;
                ageDays: z.ZodNumber;
                reporters: z.ZodNumber;
                thin: z.ZodBoolean;
            }, z.core.$strip>>;
            history: z.ZodArray<z.ZodObject<{
                day: z.ZodString;
                min: z.ZodNumber;
                market: z.ZodNumber;
                quantity: z.ZodNumber;
                reporters: z.ZodNumber;
                thin: z.ZodBoolean;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Gold ledger for one character";
    description: "Returns the peak and current gold of one character and the money events its own upload recorded: income (loot, quests, vendor and auction sales) and spending (flight paths, postage, barber, respecs, auction purchases), each install's ledger kept apart. A category with nothing recorded reads as unrecorded, not zero, and gold from other gameplay is unrecorded. The gap between recorded income and peak gold is shown as unrecorded, never called bought gold or a ban. Use it for one uploaded character's own gold history; it cannot look up a character that never uploaded. Use guild_board for a guild's loot, and market_value for prices. Reads Everloot's public player data when connected. Missing or unavailable data is reported explicitly. Ask for the player's deliberately shared character and realm; it needs that owner's shared upload, not an inferred identity.";
    inputSchema: {
        readonly character: z.ZodString;
        readonly realm: z.ZodString;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            character: z.ZodString;
            realm: z.ZodString;
            recorded: z.ZodBoolean;
            ledgers: z.ZodArray<z.ZodObject<{
                installId: z.ZodString;
                peakCopper: z.ZodNullable<z.ZodNumber>;
                currentCopper: z.ZodNullable<z.ZodNumber>;
                income: z.ZodObject<{
                    [x: string]: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>;
                spending: z.ZodObject<{
                    [x: string]: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>;
                incomeTotal: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Database coverage by zone, type and field";
    description: "Counts how much of WoW: Forever's database is settled or confirmed, per zone, per type and per field, as https://everloot.app/database/coverage shows it, in text only. Coverage is settled over expected, with confirmed over expected beside it; the denominator is the larger of expected and observed, and confirmed includes settled. A player-reported fact is public after three installs agree; fields one or two installs short are counted without their values. Scoped totals and the current build's settled-list size come separately dated and measured. Only public report identifiers and game-file facts are listed, never unconfirmed values, baseline rows, names or ids, or player names. When coverage data is available, every answer states its scope, method, data date and install counts; when it is not, the answer states the scope and marks the counts, data date and installs [?], not zero. Unknown values are [?]. Use it for how complete the database is for a zone or type; use the page tools for the facts themselves.";
    inputSchema: {
        readonly zone: z.ZodOptional<z.ZodNumber>;
        readonly type: z.ZodOptional<z.ZodEnum<{
            bosses: "bosses";
            drops: "drops";
            entrances: "entrances";
            npcs: "npcs";
            pins: "pins";
            quests: "quests";
            rares: "rares";
            treasures: "treasures";
            vendors: "vendors";
        }>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Who plays what: population by race, class, faction and level";
    description: "Counts observed Forever characters by race, class, faction and level band from opt-in addon census uploads, not the whole realm population. Each character counts once. Normally counts need 10 characters, 3 installs and 3 addresses, rounded to 5, with inferable small counts hidden. While few players upload, Everloot's own installs also count on their own, though the 10-character minimum still applies; preserve that label because counts can come from one player's game. The window is active in 7 days by default, or since launch. No names. Missing census data is unrecorded, not zero. Use class_races for which races can be a class; use this tool for observed counts.";
    inputSchema: {
        readonly race: z.ZodOptional<z.ZodString>;
        readonly class: z.ZodOptional<z.ZodString>;
        readonly faction: z.ZodOptional<z.ZodEnum<{
            Alliance: "Alliance";
            Horde: "Horde";
        }>>;
        readonly window: z.ZodDefault<z.ZodEnum<{
            launch: "launch";
            week: "week";
        }>>;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly dataAsOf: z.ZodNullable<z.ZodString>;
        readonly reason: z.ZodOptional<z.ZodString>;
        readonly url: z.ZodOptional<z.ZodString>;
        readonly page: z.ZodOptional<z.ZodObject<{
            scope: z.ZodObject<{
                id: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>;
            launched: z.ZodBoolean;
            launch: z.ZodString;
            window: z.ZodObject<{
                id: z.ZodEnum<{
                    launch: "launch";
                    week: "week";
                }>;
                from: z.ZodString;
                to: z.ZodString;
            }, z.core.$strip>;
            collecting: z.ZodBoolean;
            characters: z.ZodNullable<z.ZodNumber>;
            installs: z.ZodNumber;
            rule: z.ZodObject<{
                minCharacters: z.ZodNumber;
                minInstalls: z.ZodNumber;
                minReporters: z.ZodNumber;
                roundTo: z.ZodNumber;
            }, z.core.$strip>;
            cells: z.ZodArray<z.ZodObject<{
                slice: z.ZodEnum<{
                    class: "class";
                    faction: "faction";
                    level: "level";
                    race: "race";
                    raceClass: "raceClass";
                }>;
                faction: z.ZodOptional<z.ZodEnum<{
                    Alliance: "Alliance";
                    Horde: "Horde";
                }>>;
                race: z.ZodOptional<z.ZodString>;
                class: z.ZodOptional<z.ZodString>;
                band: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
                count: z.ZodNullable<z.ZodNumber>;
                share: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            note: z.ZodOptional<z.ZodString>;
            source: z.ZodObject<{
                title: z.ZodString;
                url: z.ZodString;
            }, z.core.$strip>;
            method: z.ZodObject<{
                title: z.ZodString;
                url: z.ZodString;
            }, z.core.$strip>;
            licence: z.ZodString;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Recent official changes for WoW: Forever";
    description: "Returns the newest official changes for WoW: Forever, newest first: Blizzard blue posts (title, author, time, a short excerpt and the link to the original), hotfix posts, and new game builds. Excerpts only: Blizzard's post text is Blizzard's; full posts are available at their source URLs. A build's time is when Everloot first saw it, not Blizzard's release time. Use it for what Blizzard changed or posted lately; use answer_sources for lore and game facts, and ecosystem_projects for community addons. filter picks one kind; limit caps the entries.";
    inputSchema: {
        readonly filter: z.ZodDefault<z.ZodEnum<{
            all: "all";
            builds: "builds";
            hotfixes: "hotfixes";
            posts: "posts";
        }>>;
        readonly game: z.ZodOptional<z.ZodEnum<{
            classic: "classic";
            forever: "forever";
        }>>;
        readonly limit: z.ZodDefault<z.ZodNumber>;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly entries: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            type: z.ZodEnum<{
                build: "build";
                hotfix: "hotfix";
                post: "post";
            }>;
            game: z.ZodEnum<{
                classic: "classic";
                forever: "forever";
            }>;
            at: z.ZodString;
            title: z.ZodString;
            url: z.ZodNullable<z.ZodString>;
            author: z.ZodOptional<z.ZodString>;
            role: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            source: z.ZodOptional<z.ZodString>;
            excerpt: z.ZodOptional<z.ZodString>;
            summary: z.ZodOptional<z.ZodString>;
            version: z.ZodOptional<z.ZodString>;
            diffUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            region: z.ZodOptional<z.ZodEnum<{
                eu: "eu";
                us: "us";
            }>>;
            topicId: z.ZodOptional<z.ZodNumber>;
            topicSlug: z.ZodOptional<z.ZodString>;
            postNumber: z.ZodOptional<z.ZodNumber>;
            startedThread: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        readonly url: z.ZodOptional<z.ZodString>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "WoW: Forever addons and open-source projects";
    description: "Lists the Forever addons and tools in the community registry, with a board ranking: most installed, rising, most active, freshest release or best maintained. Each project shows its GitHub repository, stars, latest release, last commit, whether its .toc declares a Forever interface number, and installs from Everloot uploads (counted from 3 installs; a missing count means not counted, not zero). Projects are ranked, never people. GitHub facts carry the time they were refreshed. Use it for which Forever addons exist and how maintained they are; use everloot_plan for Everloot's own features, and recent_changes for Blizzard's posts. limit caps the projects listed.";
    inputSchema: {
        readonly board: z.ZodDefault<z.ZodEnum<{
            active: "active";
            all: "all";
            installed: "installed";
            maintained: "maintained";
            release: "release";
            rising: "rising";
        }>>;
        readonly forever_ready_only: z.ZodOptional<z.ZodBoolean>;
        readonly limit: z.ZodDefault<z.ZodNumber>;
    };
    outputSchema: {
        readonly connected: z.ZodBoolean;
        readonly refreshedAt: z.ZodNullable<z.ZodString>;
        readonly installsAvailable: z.ZodBoolean;
        readonly forever: z.ZodNullable<z.ZodObject<{
            interface: z.ZodNumber;
            version: z.ZodString;
            build: z.ZodNumber;
        }, z.core.$strip>>;
        readonly board: z.ZodEnum<{
            active: "active";
            all: "all";
            installed: "installed";
            maintained: "maintained";
            release: "release";
            rising: "rising";
        }>;
        readonly projects: z.ZodArray<z.ZodObject<{
            rank: z.ZodOptional<z.ZodNumber>;
            display: z.ZodOptional<z.ZodString>;
            id: z.ZodString;
            name: z.ZodString;
            kind: z.ZodEnum<{
                addon: "addon";
                tool: "tool";
            }>;
            summary: z.ZodString;
            repo: z.ZodString;
            url: z.ZodString;
            installs: z.ZodNullable<z.ZodNumber>;
            stars: z.ZodNullable<z.ZodNumber>;
            release: z.ZodNullable<z.ZodObject<{
                tag: z.ZodString;
                date: z.ZodString;
                url: z.ZodString;
            }, z.core.$strip>>;
            lastCommit: z.ZodNullable<z.ZodString>;
            commits4w: z.ZodNullable<z.ZodNumber>;
            foreverReady: z.ZodEnum<{
                no: "no";
                unknown: "unknown";
                yes: "yes";
            }>;
            badges: z.ZodArray<z.ZodString>;
            maintenanceScore: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        readonly url: z.ZodOptional<z.ZodString>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Everloot implementation tracker";
    description: "Returns the Everloot feature catalogue: what is live, what is next, what is waiting, and which reference sites are page shapes only, as the tracker that ships with the site holds it. Use it only for questions about Everloot itself, such as whether a feature exists; it holds no game data. For game facts use search_knowledge or answer_sources; for community addons use ecosystem_projects. Takes no arguments and needs no account.";
    inputSchema: {};
    outputSchema: {
        readonly rows: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            status: z.ZodEnum<{
                live: "live";
                next: "next";
                shape: "shape";
                waiting: "waiting";
            }>;
            name: z.ZodString;
            done: z.ZodString;
            proof: z.ZodOptional<z.ZodEnum<{
                client: "client";
                code: "code";
                deployed: "deployed";
                none: "none";
                public: "public";
                "real-data": "real-data";
            }>>;
        }, z.core.$strip>>;
        readonly counts: z.ZodObject<{
            live: z.ZodNumber;
            next: z.ZodNumber;
            waiting: z.ZodNumber;
            shape: z.ZodNumber;
        }, z.core.$strip>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly destructiveHint: false;
        readonly idempotentHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "class_races" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
})[];
/**
 * The last line of an answer built on player data: how old the data is, "Data as of 2026-10-22 06:30 UTC.",
 * or `unrecorded` when the snapshot carries no time.
 */
export declare const DATA_AGE: {
    readonly prefix: "Data as of ";
    readonly unrecorded: "Data age unrecorded.";
};
/**
 * What every tool returns: one text content block. Answers built on player data end with how old the
 * data is (DATA_AGE). Tools that read nothing from players carry their sources inside the text instead.
 * Tools with an outputSchema also return structuredContent of that shape (STRUCTURED_TOOLS lists them;
 * coverage is text only). When one everloot.app page shows the answer, its structured `url` holds it and
 * the text carries a `More: <url>` line, last before the data age: that link is how the answer is
 * credited. The licence and credit line travel in the response headers, not in each answer.
 */
export declare const TOOL_OUTPUT: {
    readonly type: "text";
    readonly lastLine: {
        readonly prefix: "Data as of ";
        readonly unrecorded: "Data age unrecorded.";
    };
};
/** The tools that answer with structuredContent beside the text. */
export declare const STRUCTURED_TOOLS: readonly McpToolName[];
/** The two tools of OpenAI's connector contract: their text block is the structured answer as a JSON string, not prose. */
export declare const CHATGPT_TOOLS: readonly McpToolName[];
/** The tools whose answers are built on player uploads and therefore end with TOOL_OUTPUT.lastLine. */
export declare const PLAYER_DATA_TOOLS: readonly McpToolName[];
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
export declare const buildEntry: z.ZodObject<{
    key: z.ZodString;
    product: z.ZodString;
    buildConfig: z.ZodString;
    buildId: z.ZodNumber;
    version: z.ZodString;
    regions: z.ZodArray<z.ZodString>;
    firstSeen: z.ZodString;
    lastSeen: z.ZodString;
    status: z.ZodEnum<{
        processed: "processed";
        queued: "queued";
    }>;
}, z.core.$strip>;
export type BuildEntryOut = z.infer<typeof buildEntry>;
/** What everloot://builds holds. */
export declare const buildsResource: z.ZodObject<{
    gameFiles: z.ZodObject<{
        product: z.ZodString;
        buildId: z.ZodNumber;
        version: z.ZodString;
        buildConfig: z.ZodString;
        definitions: z.ZodNullable<z.ZodString>;
        extractedAt: z.ZodString;
    }, z.core.$strip>;
    registry: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        product: z.ZodString;
        buildConfig: z.ZodString;
        buildId: z.ZodNumber;
        version: z.ZodString;
        regions: z.ZodArray<z.ZodString>;
        firstSeen: z.ZodString;
        lastSeen: z.ZodString;
        status: z.ZodEnum<{
            processed: "processed";
            queued: "queued";
        }>;
    }, z.core.$strip>>;
    credit: z.ZodString;
}, z.core.$strip>;
export type BuildsResource = z.infer<typeof buildsResource>;
/** Every resource, keyed by URI, in the order the server lists them. */
export declare const MCP_RESOURCES: {
    readonly "everloot://builds": {
        readonly name: "builds";
        readonly title: "Game builds Everloot knows";
        readonly description: "The build the game-file facts come from, and every build Blizzard's version service has listed, with when Everloot first saw it. JSON of the shape in schema/mcp/resources.json.";
        readonly mimeType: "application/json";
    };
    readonly "everloot://methodology": {
        readonly name: "methodology";
        readonly title: "How Everloot counts";
        readonly description: "How player uploads become facts: three installs must agree, unrecorded is never zero, game files and play are kept apart, and what is never published. Read it before stating a number as certain.";
        readonly mimeType: "text/markdown";
    };
    readonly "everloot://data-policy": {
        readonly name: "data-policy";
        readonly title: "Everloot data policy";
        readonly description: "Where the data comes from, what is refused, the licence and credit line, and the limits on bulk copying, in short, with the link to the full policy.";
        readonly mimeType: "text/markdown";
    };
};
/**
 * The server's prompts: a client offers them as commands, fills the arguments, and gets a user message
 * that tells an assistant how to use the tools for that job. Argument values are strings, as MCP has them.
 */
export interface McpPromptDef {
    title: string;
    description: string;
    /** `values`, when present, are the only values the argument takes; the server offers them through completion/complete. */
    arguments: Record<string, {
        description: string;
        required: boolean;
        values?: readonly string[];
    }>;
}
/** Every prompt, keyed by name, in the order the server lists them. kb/src/prompts.ts holds the messages. */
export declare const MCP_PROMPTS: {
    readonly answer_with_sources: {
        readonly title: "Answer with Everloot's sources";
        readonly description: "Answer a question about WoW: Forever from answer_sources, citing each piece of evidence with its source, licence and date, and saying unrecorded where the evidence is.";
        readonly arguments: {
            readonly question: {
                readonly description: "The question, in the player's words.";
                readonly required: true;
            };
        };
    };
    readonly review_talent_plan: {
        readonly title: "Review a talent share code";
        readonly description: "Read a share code with talent_plan and the class's trees with talent_tree, then describe the build, its level and every problem in plain words.";
        readonly arguments: {
            readonly code: {
                readonly description: "An EL1 share code, or a calculator link that carries one.";
                readonly required: true;
            };
        };
    };
    readonly what_changed: {
        readonly title: "What changed in WoW: Forever";
        readonly description: "Summarize recent_changes, newest first: Blizzard posts, hotfixes and builds, each with its link, quoting only the excerpt the tool gives.";
        readonly arguments: {
            readonly game: {
                readonly description: "forever or classic. Without it, both.";
                readonly required: false;
                readonly values: readonly ["forever", "classic"];
            };
        };
    };
};
export type McpPromptName = keyof typeof MCP_PROMPTS;
/** The names in the order the server lists them. */
export declare const MCP_PROMPT_NAMES: McpPromptName[];
/** The list form, for clients that iterate. */
export declare const MCP_PROMPT_LIST: ({
    title: "Answer with Everloot's sources";
    description: "Answer a question about WoW: Forever from answer_sources, citing each piece of evidence with its source, licence and date, and saying unrecorded where the evidence is.";
    arguments: {
        readonly question: {
            readonly description: "The question, in the player's words.";
            readonly required: true;
        };
    };
    name: "answer_with_sources" | "review_talent_plan" | "what_changed";
} | {
    title: "Review a talent share code";
    description: "Read a share code with talent_plan and the class's trees with talent_tree, then describe the build, its level and every problem in plain words.";
    arguments: {
        readonly code: {
            readonly description: "An EL1 share code, or a calculator link that carries one.";
            readonly required: true;
        };
    };
    name: "answer_with_sources" | "review_talent_plan" | "what_changed";
} | {
    title: "What changed in WoW: Forever";
    description: "Summarize recent_changes, newest first: Blizzard posts, hotfixes and builds, each with its link, quoting only the excerpt the tool gives.";
    arguments: {
        readonly game: {
            readonly description: "forever or classic. Without it, both.";
            readonly required: false;
            readonly values: readonly ["forever", "classic"];
        };
    };
    name: "answer_with_sources" | "review_talent_plan" | "what_changed";
})[];
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
export declare const MCP_RESOURCE_TEMPLATES: {
    readonly "everloot://item/{id}": {
        readonly name: "item";
        readonly title: "One item's page";
        readonly description: "The item_page answer for an item id: agreed name, drop rates with loot-window counts, map pins.";
        readonly mimeType: "application/json";
        readonly tool: "item_page";
        readonly variable: "id";
        readonly argument: "itemId";
    };
    readonly "everloot://npc/{id}": {
        readonly name: "npc";
        readonly title: "One NPC's page";
        readonly description: "The npc_page answer for an NPC id: agreed name and map pins.";
        readonly mimeType: "application/json";
        readonly tool: "npc_page";
        readonly variable: "id";
        readonly argument: "npcId";
    };
    readonly "everloot://quest/{id}": {
        readonly name: "quest";
        readonly title: "One quest's page";
        readonly description: "The quest_page answer for a quest id: title, level, giver, turn-in and rewards.";
        readonly mimeType: "application/json";
        readonly tool: "quest_page";
        readonly variable: "id";
        readonly argument: "questId";
    };
    readonly "everloot://vendor/{id}": {
        readonly name: "vendor";
        readonly title: "One vendor's goods";
        readonly description: "The vendor_page answer for a vendor NPC id: what it sells, with copper prices.";
        readonly mimeType: "application/json";
        readonly tool: "vendor_page";
        readonly variable: "id";
        readonly argument: "vendorNpcId";
    };
    readonly "everloot://object/{id}": {
        readonly name: "object";
        readonly title: "One game object's page";
        readonly description: "The object_page answer for an object's entry id: what players looted from it.";
        readonly mimeType: "application/json";
        readonly tool: "object_page";
        readonly variable: "id";
        readonly argument: "objectId";
    };
    readonly "everloot://talents/{class}": {
        readonly name: "talents";
        readonly title: "One class's talent trees";
        readonly description: "The talent_tree answer for a class slug: every node with its talents, ranks, position, prerequisites and gate.";
        readonly mimeType: "application/json";
        readonly tool: "talent_tree";
        readonly variable: "class";
        readonly argument: "class";
        readonly values: readonly ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
    };
};
export type McpResourceTemplateUri = keyof typeof MCP_RESOURCE_TEMPLATES;
export declare const MCP_RESOURCE_TEMPLATE_URIS: McpResourceTemplateUri[];
export declare const MCP_RESOURCE_TEMPLATE_LIST: ({
    name: "item";
    title: "One item's page";
    description: "The item_page answer for an item id: agreed name, drop rates with loot-window counts, map pins.";
    mimeType: "application/json";
    tool: "item_page";
    variable: "id";
    argument: "itemId";
    uriTemplate: "everloot://item/{id}" | "everloot://npc/{id}" | "everloot://object/{id}" | "everloot://quest/{id}" | "everloot://talents/{class}" | "everloot://vendor/{id}";
} | {
    name: "npc";
    title: "One NPC's page";
    description: "The npc_page answer for an NPC id: agreed name and map pins.";
    mimeType: "application/json";
    tool: "npc_page";
    variable: "id";
    argument: "npcId";
    uriTemplate: "everloot://item/{id}" | "everloot://npc/{id}" | "everloot://object/{id}" | "everloot://quest/{id}" | "everloot://talents/{class}" | "everloot://vendor/{id}";
} | {
    name: "quest";
    title: "One quest's page";
    description: "The quest_page answer for a quest id: title, level, giver, turn-in and rewards.";
    mimeType: "application/json";
    tool: "quest_page";
    variable: "id";
    argument: "questId";
    uriTemplate: "everloot://item/{id}" | "everloot://npc/{id}" | "everloot://object/{id}" | "everloot://quest/{id}" | "everloot://talents/{class}" | "everloot://vendor/{id}";
} | {
    name: "vendor";
    title: "One vendor's goods";
    description: "The vendor_page answer for a vendor NPC id: what it sells, with copper prices.";
    mimeType: "application/json";
    tool: "vendor_page";
    variable: "id";
    argument: "vendorNpcId";
    uriTemplate: "everloot://item/{id}" | "everloot://npc/{id}" | "everloot://object/{id}" | "everloot://quest/{id}" | "everloot://talents/{class}" | "everloot://vendor/{id}";
} | {
    name: "object";
    title: "One game object's page";
    description: "The object_page answer for an object's entry id: what players looted from it.";
    mimeType: "application/json";
    tool: "object_page";
    variable: "id";
    argument: "objectId";
    uriTemplate: "everloot://item/{id}" | "everloot://npc/{id}" | "everloot://object/{id}" | "everloot://quest/{id}" | "everloot://talents/{class}" | "everloot://vendor/{id}";
} | {
    name: "talents";
    title: "One class's talent trees";
    description: "The talent_tree answer for a class slug: every node with its talents, ranks, position, prerequisites and gate.";
    mimeType: "application/json";
    tool: "talent_tree";
    variable: "class";
    argument: "class";
    values: readonly ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
    uriTemplate: "everloot://item/{id}" | "everloot://npc/{id}" | "everloot://object/{id}" | "everloot://quest/{id}" | "everloot://talents/{class}" | "everloot://vendor/{id}";
})[];
export type McpResourceUri = keyof typeof MCP_RESOURCES;
/** The URIs in the order the server lists them. */
export declare const MCP_RESOURCE_URIS: McpResourceUri[];
/** The list form, for clients that iterate. */
export declare const MCP_RESOURCE_LIST: ({
    name: "builds";
    title: "Game builds Everloot knows";
    description: "The build the game-file facts come from, and every build Blizzard's version service has listed, with when Everloot first saw it. JSON of the shape in schema/mcp/resources.json.";
    mimeType: "application/json";
    uri: "everloot://builds" | "everloot://data-policy" | "everloot://methodology";
} | {
    name: "methodology";
    title: "How Everloot counts";
    description: "How player uploads become facts: three installs must agree, unrecorded is never zero, game files and play are kept apart, and what is never published. Read it before stating a number as certain.";
    mimeType: "text/markdown";
    uri: "everloot://builds" | "everloot://data-policy" | "everloot://methodology";
} | {
    name: "data-policy";
    title: "Everloot data policy";
    description: "Where the data comes from, what is refused, the licence and credit line, and the limits on bulk copying, in short, with the link to the full policy.";
    mimeType: "text/markdown";
    uri: "everloot://builds" | "everloot://data-policy" | "everloot://methodology";
})[];
