import { z } from "zod";
/**
 * The Everloot MCP server's tools: names, titles, descriptions, input schemas and annotations, in the
 * order the server lists them. kb/src/mcp-server.ts registers from this table and supplies the handlers;
 * the connect page and llms.txt list from it; schema/mcp/<tool>.json is generated from it. Every tool
 * is read-only. Today every tool answers with one text block (TOOL_OUTPUT); structured output is a later
 * minor release, tool by tool.
 */
/** Record kinds in the knowledge release (lore and reference data). */
export declare const KNOWLEDGE_KINDS: readonly ["item", "npc", "object", "quest", "zone", "spell", "lore_page", "creator", "realm"];
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
    realm: z.ZodString;
    itemId: z.ZodNumber;
    points: z.ZodArray<z.ZodObject<{
        day: z.ZodString;
        copper: z.ZodNumber;
        reporters: z.ZodNumber;
    }, z.core.$strip>>;
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
export declare const fetchedDocument: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    text: z.ZodString;
    url: z.ZodString;
    metadata: z.ZodObject<{
        kind: z.ZodEnum<{
            creator: "creator";
            item: "item";
            lore_page: "lore_page";
            npc: "npc";
            object: "object";
            quest: "quest";
            realm: "realm";
            spell: "spell";
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
    }, z.core.$strip>;
}, z.core.$strip>;
export type FetchedDocumentOut = z.infer<typeof fetchedDocument>;
/** One knowledge record as search_knowledge, get_entity and get_by_name return it. */
export declare const knowledgeHit: z.ZodObject<{
    id: z.ZodNumber;
    extId: z.ZodString;
    kind: z.ZodEnum<{
        creator: "creator";
        item: "item";
        lore_page: "lore_page";
        npc: "npc";
        object: "object";
        quest: "quest";
        realm: "realm";
        spell: "spell";
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
        openWorldHint: false;
    };
}
/** Every tool, keyed by name, in the order the server lists them. */
export declare const MCP_TOOLS: {
    readonly search_knowledge: {
        readonly title: "Search the Everloot knowledge base";
        readonly description: "Search WoW lore and Forever reference data. Exact-name matches rank first. Every hit carries its source and licence.";
        readonly inputSchema: {
            query: z.ZodString;
            kind: z.ZodOptional<z.ZodEnum<{
                creator: "creator";
                item: "item";
                lore_page: "lore_page";
                npc: "npc";
                object: "object";
                quest: "quest";
                realm: "realm";
                spell: "spell";
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
                extId: z.ZodString;
                kind: z.ZodEnum<{
                    creator: "creator";
                    item: "item";
                    lore_page: "lore_page";
                    npc: "npc";
                    object: "object";
                    quest: "quest";
                    realm: "realm";
                    spell: "spell";
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
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly get_entity: {
        readonly title: "Get one knowledge record by id";
        readonly description: "Fetch the full record behind a search hit id, for page rendering.";
        readonly inputSchema: {
            readonly id: z.ZodNumber;
        };
        readonly outputSchema: {
            readonly hit: z.ZodNullable<z.ZodObject<{
                id: z.ZodNumber;
                extId: z.ZodString;
                kind: z.ZodEnum<{
                    creator: "creator";
                    item: "item";
                    lore_page: "lore_page";
                    npc: "npc";
                    object: "object";
                    quest: "quest";
                    realm: "realm";
                    spell: "spell";
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
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly get_by_name: {
        readonly title: "Get records by exact name";
        readonly description: "Exact full-name match (case-insensitive) for disambiguation.";
        readonly inputSchema: {
            readonly name: z.ZodString;
            readonly kind: z.ZodOptional<z.ZodEnum<{
                creator: "creator";
                item: "item";
                lore_page: "lore_page";
                npc: "npc";
                object: "object";
                quest: "quest";
                realm: "realm";
                spell: "spell";
                zone: "zone";
            }>>;
        };
        readonly outputSchema: {
            readonly hits: z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                extId: z.ZodString;
                kind: z.ZodEnum<{
                    creator: "creator";
                    item: "item";
                    lore_page: "lore_page";
                    npc: "npc";
                    object: "object";
                    quest: "quest";
                    realm: "realm";
                    spell: "spell";
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
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly search: {
        readonly title: "Search (ChatGPT connector contract)";
        readonly description: "The same search as search_knowledge, in the shape ChatGPT connectors and deep research call by name: up to 10 results, each with an id for fetch, a title and a URL to cite. The text block is the same JSON as a string.";
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
            readonly openWorldHint: false;
        };
    };
    readonly fetch: {
        readonly title: "Fetch one document (ChatGPT connector contract)";
        readonly description: "One knowledge record by the id a search result gave, whole: title, the full text in the source's words, the URL to cite, and metadata with the source, licence and date. The text block is the same JSON as a string.";
        readonly inputSchema: {
            readonly id: z.ZodString;
        };
        readonly outputSchema: {
            id: z.ZodString;
            title: z.ZodString;
            text: z.ZodString;
            url: z.ZodString;
            metadata: z.ZodObject<{
                kind: z.ZodEnum<{
                    creator: "creator";
                    item: "item";
                    lore_page: "lore_page";
                    npc: "npc";
                    object: "object";
                    quest: "quest";
                    realm: "realm";
                    spell: "spell";
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
            }, z.core.$strip>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly answer_sources: {
        readonly title: "Evidence for a question, each piece with its source";
        readonly description: "The evidence behind a question about WoW: Forever, for an answer that cites its sources: facts players observed (public after three installs agree, with the install count), curated facts, and the 2023 Warcraft Wiki (marked: may differ in Forever). Every piece carries a claim, its source URL, licence and date. Returns evidence rather than prose. Further-reading links are search URLs on other sites; nothing is fetched from them. Reads Everloot's current authorized public corpus when connected; when it is not, the observed layer is unrecorded, not empty.";
        readonly inputSchema: {
            readonly question: z.ZodString;
            readonly limit: z.ZodDefault<z.ZodNumber>;
        };
        readonly outputSchema: {
            readonly evidence: z.ZodArray<z.ZodObject<{
                claim: z.ZodString;
                kind: z.ZodEnum<{
                    curated: "curated";
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
            readonly openWorldHint: false;
        };
    };
    readonly profession_path: {
        readonly title: "Profession leveling path";
        readonly description: "Leveling path for one Forever profession from Everloot uploads. A step exists only after 3 installs agree: on a reported recipe, or on the recipe colours that make it orange (a guaranteed skill-up), starting at the trainer's required rank. Gold exists only after 3 price uploads agree. No copied guide. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly recipe_thresholds: {
        readonly title: "Recipe skill ranges";
        readonly description: "Where a Forever profession's recipes turn yellow, green and grey, inferred from the colours players' trade-skill windows showed. A recipe appears only after 3 installs agree, as ranges, never guessed exact numbers. Agreed reagents come with an estimated cost per craft when every reagent has an agreed price. Reads Everloot's current public corpus.";
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
            readonly openWorldHint: false;
        };
    };
    readonly item_page: {
        readonly title: "Item page for a drop";
        readonly description: "One Forever item: agreed name, observed loot-window drop frequency, agreed map pins, and player-reported armor, block, damage per second, stats and resistances. Each item number needs one value with 3 agreeing installs in the newest build with 3 reporting installs, and no competing value with 3; contested values are withheld. Each number states its agreeing installs, build and last seen, with the corpus date and method. Missing numbers are [?] with a reason. No baseline rows or player names. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly npc_page: {
        readonly title: "NPC page";
        readonly description: "One Forever NPC: agreed name and map pins, and loot windows reported but not yet in the rates. A name or pin needs 3 installs agreeing. The pin does not require a drop. No copied spawn list. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly object_page: {
        readonly title: "Game object page";
        readonly description: "One game object (a chest, herb, ore vein or fishing pool) by the id in its GUID: the items players looted from it, each with observed loot windows, windows with the item and distinct install reports. A frequency is public after 3 install reports; a public object with nothing in its windows reads as a measured zero. The name is shown when 3 installs agree on it. Reads Everloot's current authorized public corpus when connected.";
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
            readonly openWorldHint: false;
        };
    };
    readonly quest_page: {
        readonly title: "Quest page";
        readonly description: "One Forever quest: agreed title, level, giver, turn-in, and rewards. Each fact needs 3 installs agreeing. No copied quest text. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly vendor_page: {
        readonly title: "Vendor page";
        readonly description: "Goods one Forever vendor sells. An item is listed when 3 installs agree on that item and its copper price. Two agreed prices both stay listed. No copied catalog. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly world_map_near: {
        readonly title: "What is near a place on the map";
        readonly description: `Entrances, NPCs, vendors and treasures near a spot, nearest first, with straight-line distances in yards. Give a zone (name or map id) with x and y from 0 to 100, or an NPC id to start from where that NPC stands. Entrances come from the game files; one is confirmed once 3 installs zoned in from it. NPCs, vendors and treasures are player-observed and listed only where 3 installs agree on the position. Zones the files hold back as possibly unreleased are not offered. Reads Everloot's current authorized public corpus when connected.`;
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
            readonly openWorldHint: false;
        };
    };
    readonly entity_relations: {
        readonly title: "How an item, NPC, spell or quest connects to others";
        readonly description: `Every typed relation of one entity, both directions: dropped by, sold by, reward from, located in (player-observed, listed where 3 installs agree, with the install count and last seen), and created by, reagent for, part of set, same icon (found in game files, unconfirmed, with the build they came from). Ids are the game's own. Reads Everloot's current authorized public corpus and the committed client layer.`;
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
            readonly openWorldHint: false;
        };
    };
    readonly item_categories: {
        readonly title: "Item categories: class, subclass, slot and quality";
        readonly description: `Item categories from the game files (found in game files, unconfirmed, with the build): class and subclass with the client's English names and slugs, slot and quality. With no arguments, the whole tree with item counts. With item, that item's category path. With class (a slug such as weapon or armor), and optionally subclass, slot and quality slugs, the items in it. Ids only: item names come from player uploads (item_page).`;
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
            readonly openWorldHint: false;
        };
    };
    readonly talent_tree: {
        readonly title: "Talent trees for one class";
        readonly description: "The WoW: Forever talent trees of one class from the game files (found in game files, unconfirmed, with the build): every node with its talents, ranks, grid position, prerequisites and row gate, plus the levels talent points arrive at. Node ids are the ids a share code names. Narrow to one tree by name. The calculator is at /tools/talents/<class>.";
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
            readonly credit: z.ZodString;
            readonly url: z.ZodOptional<z.ZodString>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly talent_plan: {
        readonly title: "Read a talent share code";
        readonly description: "Decodes an Everloot talent share code (EL1-<class>-<spec>-<build>-<payload>, or a calculator link carrying one after #plan=) against the class's trees: the talents and ranks it holds, points per tree, the lowest level that can hold it, and every problem in plain words: a code made on another build, nodes the tree does not have, ranks cut back, points the rules would not place. Nothing is dropped silently. Game-file data, found in game files, unconfirmed.";
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
            readonly openWorldHint: false;
        };
    };
    readonly collection_gap: {
        readonly title: "Owned versus missing in a collection";
        readonly description: "Missing items in one collection for one install. A list row is public after 3 installs agree on the collection, the source, and the item. Owned is what that install uploaded. Not a Blizzard profile read and not a copied catalog. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly completion_progress: {
        readonly title: "Achievement, reputation, title and quest progress";
        readonly description: "What one install's characters have finished, and what is closest to done: achievements with the largest share of criteria or progress met, reputations nearest the next standing, titles known, and quests finished in a chain. A list entry is public after 3 players (installs uploading from different addresses) report it identically. Progress is shown only when that install uploaded it with the collection sharing choice and a verified grant; without it the answer says so. Not a Blizzard profile read and not a copied catalog. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly guild_board: {
        readonly title: "Guild board its officers published";
        readonly description: "One guild's roster, bosses killed, loot awarded, raid attendance and average item level, as that guild's own officers chose to publish them. Only uploads from officers holding a verified grant for the guild count, and a figure is public after 2 of them agree. Names are in-game character names, never accounts or real-world identities. A character's owner can opt out, and an opted-out character is left out of the roster, loot and attendance. A guild whose officers have not published gets an empty board; the tool does not look up other players or guilds. The average names how many roster members were measured; there is no combined score. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly guild_search: {
        readonly title: "Find a guild by the start of its name";
        readonly description: "Guilds whose name starts with what you typed, each with its realm, faction, how many characters the addon saw in it, and the count and date of its agreed boss kills. A guild is listed once its members' uploads agree on a kill (2 installs reporting the same guild and boss), once its officers published a board, or once a character was seen in it. Guild names only, never a member's name, and a guild that asked to be hidden is left out. Members seen are counted only when the player pages are connected; otherwise the count is unrecorded, not zero. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly guild_rankings: {
        readonly title: "Guild ladder for one raid or dungeon";
        readonly description: "Every guild with an agreed kill in one instance, ordered by bosses killed, then by who reached its latest kill first, then by name; equal rows share a rank. A kill is a guild's once 2 of its members' installs report the same boss there, timed at the earliest report, or once its officers published it through the guild board, which carries no time. The boss list and its order are the encounters 3 installs reported in that instance; a kill of a boss not on it counts for nothing. There is no score, no rating and no total across instances. Without an instance, the newest raid with a kill is ranked; realm and faction narrow the ladder. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly auction_history: {
        readonly title: "Auction history for one item";
        readonly description: "Price history from auction scans players uploaded on purpose. A day is public after 3 installs scanned that item on that realm. Copper is the median. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
                realm: z.ZodString;
                itemId: z.ZodNumber;
                points: z.ZodArray<z.ZodObject<{
                    day: z.ZodString;
                    copper: z.ZodNumber;
                    reporters: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
        readonly annotations: {
            readonly readOnlyHint: true;
            readonly openWorldHint: false;
        };
    };
    readonly market_value: {
        readonly title: "Forever market value for one item";
        readonly description: "Market value, minimum buyout, historical value and units listed for one item on one WoW: Forever realm, from full auction scans players started and uploaded. A day is public after 3 reporters (distinct upload addresses) scanned the item; values are medians, thin days and outlier days are left out of the market value. Market value weights the last 14 public days, historical is the median of 60. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly gold_ledger: {
        readonly title: "Gold ledger for one character";
        readonly description: "Peak gold and the money events that character's own upload recorded. Loot, quests, vendors, and auction sales stay on the money line. Gameplay stays on its own line. A missing line is unrecorded. The difference is not called bought and is not a ban. Installs are not merged. No scan of a player who did not upload. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly coverage: {
        readonly title: "Database coverage by zone, type and field";
        readonly description: "How much of WoW: Forever's database is settled or confirmed, and which reported fields need more agreeing installs. The same counts and reported lists as https://everloot.app/database/coverage, as text, per zone, per type and per field, plus scoped totals and the current build's whole-fact settled-list size, separately dated and measured. Coverage = settled / expected, with confirmed / expected beside it; the denominator is max(expected, observed). Confirmed includes settled. Reported fields needing one or two more installs are counted without their values. A player-reported fact needs three agreeing installs to be public. Only public report identifiers and game-file facts are listed, never unconfirmed values, baseline rows, names or ids, or player names. Every answer states its scope, measurement method, data date and install counts; unknown values are [?]. Zone and type are optional; omitted filters cover all released zones and all types.";
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
            readonly openWorldHint: false;
        };
    };
    readonly population: {
        readonly title: "Who plays what: population by race, class, faction and level";
        readonly description: "How many characters play each race, class, race and class, faction and level band on WoW: Forever, from the census of players who turned it on in the Everloot addon. Each character counts once. A count shows only when it covers at least 10 characters reported by at least 3 installs from at least 3 addresses, rounded to the nearest 5, and a count that could be worked out from the others is hidden too. Every answer states its window: active in the last 7 days (default) or since launch. With no arguments, the overview: most played class first. No names, ever. Missing or unavailable data is reported explicitly.";
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
            readonly openWorldHint: false;
        };
    };
    readonly recent_changes: {
        readonly title: "Recent official changes for WoW: Forever";
        readonly description: "Newest first: Blizzard blue posts (title, author, time, a short excerpt and the link to the original), hotfix posts, and new game builds. Excerpts only: Blizzard's post text is Blizzard's; full posts are available at their source URLs. A build's time is when Everloot first saw it, not Blizzard's release time.";
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
            readonly openWorldHint: false;
        };
    };
    readonly ecosystem_projects: {
        readonly title: "WoW: Forever addons and open-source projects";
        readonly description: "Forever addons and tools from the community registry, with a board ranking: most installed, rising, most active, freshest release or best maintained. Each project shows its GitHub repository, stars, latest release, last commit, whether its .toc declares a Forever interface number, and installs from Everloot uploads (counted from 3 installs; a missing count means not counted, not zero). Projects are ranked, never people. GitHub facts carry the time they were refreshed.";
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
            readonly openWorldHint: false;
        };
    };
    readonly everloot_plan: {
        readonly title: "Everloot implementation tracker";
        readonly description: "The Everloot feature catalogue: what is live, what is next, what is waiting, and which reference sites are page shapes only.";
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
    description: "Search WoW lore and Forever reference data. Exact-name matches rank first. Every hit carries its source and licence.";
    inputSchema: {
        query: z.ZodString;
        kind: z.ZodOptional<z.ZodEnum<{
            creator: "creator";
            item: "item";
            lore_page: "lore_page";
            npc: "npc";
            object: "object";
            quest: "quest";
            realm: "realm";
            spell: "spell";
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
            extId: z.ZodString;
            kind: z.ZodEnum<{
                creator: "creator";
                item: "item";
                lore_page: "lore_page";
                npc: "npc";
                object: "object";
                quest: "quest";
                realm: "realm";
                spell: "spell";
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
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Get one knowledge record by id";
    description: "Fetch the full record behind a search hit id, for page rendering.";
    inputSchema: {
        readonly id: z.ZodNumber;
    };
    outputSchema: {
        readonly hit: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            extId: z.ZodString;
            kind: z.ZodEnum<{
                creator: "creator";
                item: "item";
                lore_page: "lore_page";
                npc: "npc";
                object: "object";
                quest: "quest";
                realm: "realm";
                spell: "spell";
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
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Get records by exact name";
    description: "Exact full-name match (case-insensitive) for disambiguation.";
    inputSchema: {
        readonly name: z.ZodString;
        readonly kind: z.ZodOptional<z.ZodEnum<{
            creator: "creator";
            item: "item";
            lore_page: "lore_page";
            npc: "npc";
            object: "object";
            quest: "quest";
            realm: "realm";
            spell: "spell";
            zone: "zone";
        }>>;
    };
    outputSchema: {
        readonly hits: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            extId: z.ZodString;
            kind: z.ZodEnum<{
                creator: "creator";
                item: "item";
                lore_page: "lore_page";
                npc: "npc";
                object: "object";
                quest: "quest";
                realm: "realm";
                spell: "spell";
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
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Search (ChatGPT connector contract)";
    description: "The same search as search_knowledge, in the shape ChatGPT connectors and deep research call by name: up to 10 results, each with an id for fetch, a title and a URL to cite. The text block is the same JSON as a string.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Fetch one document (ChatGPT connector contract)";
    description: "One knowledge record by the id a search result gave, whole: title, the full text in the source's words, the URL to cite, and metadata with the source, licence and date. The text block is the same JSON as a string.";
    inputSchema: {
        readonly id: z.ZodString;
    };
    outputSchema: {
        id: z.ZodString;
        title: z.ZodString;
        text: z.ZodString;
        url: z.ZodString;
        metadata: z.ZodObject<{
            kind: z.ZodEnum<{
                creator: "creator";
                item: "item";
                lore_page: "lore_page";
                npc: "npc";
                object: "object";
                quest: "quest";
                realm: "realm";
                spell: "spell";
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
        }, z.core.$strip>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Evidence for a question, each piece with its source";
    description: "The evidence behind a question about WoW: Forever, for an answer that cites its sources: facts players observed (public after three installs agree, with the install count), curated facts, and the 2023 Warcraft Wiki (marked: may differ in Forever). Every piece carries a claim, its source URL, licence and date. Returns evidence rather than prose. Further-reading links are search URLs on other sites; nothing is fetched from them. Reads Everloot's current authorized public corpus when connected; when it is not, the observed layer is unrecorded, not empty.";
    inputSchema: {
        readonly question: z.ZodString;
        readonly limit: z.ZodDefault<z.ZodNumber>;
    };
    outputSchema: {
        readonly evidence: z.ZodArray<z.ZodObject<{
            claim: z.ZodString;
            kind: z.ZodEnum<{
                curated: "curated";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Profession leveling path";
    description: "Leveling path for one Forever profession from Everloot uploads. A step exists only after 3 installs agree: on a reported recipe, or on the recipe colours that make it orange (a guaranteed skill-up), starting at the trainer's required rank. Gold exists only after 3 price uploads agree. No copied guide. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Recipe skill ranges";
    description: "Where a Forever profession's recipes turn yellow, green and grey, inferred from the colours players' trade-skill windows showed. A recipe appears only after 3 installs agree, as ranges, never guessed exact numbers. Agreed reagents come with an estimated cost per craft when every reagent has an agreed price. Reads Everloot's current public corpus.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Item page for a drop";
    description: "One Forever item: agreed name, observed loot-window drop frequency, agreed map pins, and player-reported armor, block, damage per second, stats and resistances. Each item number needs one value with 3 agreeing installs in the newest build with 3 reporting installs, and no competing value with 3; contested values are withheld. Each number states its agreeing installs, build and last seen, with the corpus date and method. Missing numbers are [?] with a reason. No baseline rows or player names. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "NPC page";
    description: "One Forever NPC: agreed name and map pins, and loot windows reported but not yet in the rates. A name or pin needs 3 installs agreeing. The pin does not require a drop. No copied spawn list. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Game object page";
    description: "One game object (a chest, herb, ore vein or fishing pool) by the id in its GUID: the items players looted from it, each with observed loot windows, windows with the item and distinct install reports. A frequency is public after 3 install reports; a public object with nothing in its windows reads as a measured zero. The name is shown when 3 installs agree on it. Reads Everloot's current authorized public corpus when connected.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Quest page";
    description: "One Forever quest: agreed title, level, giver, turn-in, and rewards. Each fact needs 3 installs agreeing. No copied quest text. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Vendor page";
    description: "Goods one Forever vendor sells. An item is listed when 3 installs agree on that item and its copper price. Two agreed prices both stay listed. No copied catalog. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "What is near a place on the map";
    description: `Entrances, NPCs, vendors and treasures near a spot, nearest first, with straight-line distances in yards. Give a zone (name or map id) with x and y from 0 to 100, or an NPC id to start from where that NPC stands. Entrances come from the game files; one is confirmed once 3 installs zoned in from it. NPCs, vendors and treasures are player-observed and listed only where 3 installs agree on the position. Zones the files hold back as possibly unreleased are not offered. Reads Everloot's current authorized public corpus when connected.`;
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "How an item, NPC, spell or quest connects to others";
    description: `Every typed relation of one entity, both directions: dropped by, sold by, reward from, located in (player-observed, listed where 3 installs agree, with the install count and last seen), and created by, reagent for, part of set, same icon (found in game files, unconfirmed, with the build they came from). Ids are the game's own. Reads Everloot's current authorized public corpus and the committed client layer.`;
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Item categories: class, subclass, slot and quality";
    description: `Item categories from the game files (found in game files, unconfirmed, with the build): class and subclass with the client's English names and slugs, slot and quality. With no arguments, the whole tree with item counts. With item, that item's category path. With class (a slug such as weapon or armor), and optionally subclass, slot and quality slugs, the items in it. Ids only: item names come from player uploads (item_page).`;
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Talent trees for one class";
    description: "The WoW: Forever talent trees of one class from the game files (found in game files, unconfirmed, with the build): every node with its talents, ranks, grid position, prerequisites and row gate, plus the levels talent points arrive at. Node ids are the ids a share code names. Narrow to one tree by name. The calculator is at /tools/talents/<class>.";
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
        readonly credit: z.ZodString;
        readonly url: z.ZodOptional<z.ZodString>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Read a talent share code";
    description: "Decodes an Everloot talent share code (EL1-<class>-<spec>-<build>-<payload>, or a calculator link carrying one after #plan=) against the class's trees: the talents and ranks it holds, points per tree, the lowest level that can hold it, and every problem in plain words: a code made on another build, nodes the tree does not have, ranks cut back, points the rules would not place. Nothing is dropped silently. Game-file data, found in game files, unconfirmed.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Owned versus missing in a collection";
    description: "Missing items in one collection for one install. A list row is public after 3 installs agree on the collection, the source, and the item. Owned is what that install uploaded. Not a Blizzard profile read and not a copied catalog. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Achievement, reputation, title and quest progress";
    description: "What one install's characters have finished, and what is closest to done: achievements with the largest share of criteria or progress met, reputations nearest the next standing, titles known, and quests finished in a chain. A list entry is public after 3 players (installs uploading from different addresses) report it identically. Progress is shown only when that install uploaded it with the collection sharing choice and a verified grant; without it the answer says so. Not a Blizzard profile read and not a copied catalog. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Guild board its officers published";
    description: "One guild's roster, bosses killed, loot awarded, raid attendance and average item level, as that guild's own officers chose to publish them. Only uploads from officers holding a verified grant for the guild count, and a figure is public after 2 of them agree. Names are in-game character names, never accounts or real-world identities. A character's owner can opt out, and an opted-out character is left out of the roster, loot and attendance. A guild whose officers have not published gets an empty board; the tool does not look up other players or guilds. The average names how many roster members were measured; there is no combined score. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Find a guild by the start of its name";
    description: "Guilds whose name starts with what you typed, each with its realm, faction, how many characters the addon saw in it, and the count and date of its agreed boss kills. A guild is listed once its members' uploads agree on a kill (2 installs reporting the same guild and boss), once its officers published a board, or once a character was seen in it. Guild names only, never a member's name, and a guild that asked to be hidden is left out. Members seen are counted only when the player pages are connected; otherwise the count is unrecorded, not zero. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Guild ladder for one raid or dungeon";
    description: "Every guild with an agreed kill in one instance, ordered by bosses killed, then by who reached its latest kill first, then by name; equal rows share a rank. A kill is a guild's once 2 of its members' installs report the same boss there, timed at the earliest report, or once its officers published it through the guild board, which carries no time. The boss list and its order are the encounters 3 installs reported in that instance; a kill of a boss not on it counts for nothing. There is no score, no rating and no total across instances. Without an instance, the newest raid with a kill is ranked; realm and faction narrow the ladder. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Auction history for one item";
    description: "Price history from auction scans players uploaded on purpose. A day is public after 3 installs scanned that item on that realm. Copper is the median. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
            realm: z.ZodString;
            itemId: z.ZodNumber;
            points: z.ZodArray<z.ZodObject<{
                day: z.ZodString;
                copper: z.ZodNumber;
                reporters: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    };
    annotations: {
        readonly readOnlyHint: true;
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Forever market value for one item";
    description: "Market value, minimum buyout, historical value and units listed for one item on one WoW: Forever realm, from full auction scans players started and uploaded. A day is public after 3 reporters (distinct upload addresses) scanned the item; values are medians, thin days and outlier days are left out of the market value. Market value weights the last 14 public days, historical is the median of 60. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Gold ledger for one character";
    description: "Peak gold and the money events that character's own upload recorded. Loot, quests, vendors, and auction sales stay on the money line. Gameplay stays on its own line. A missing line is unrecorded. The difference is not called bought and is not a ban. Installs are not merged. No scan of a player who did not upload. Reads Everloot's current authorized public corpus when connected. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Database coverage by zone, type and field";
    description: "How much of WoW: Forever's database is settled or confirmed, and which reported fields need more agreeing installs. The same counts and reported lists as https://everloot.app/database/coverage, as text, per zone, per type and per field, plus scoped totals and the current build's whole-fact settled-list size, separately dated and measured. Coverage = settled / expected, with confirmed / expected beside it; the denominator is max(expected, observed). Confirmed includes settled. Reported fields needing one or two more installs are counted without their values. A player-reported fact needs three agreeing installs to be public. Only public report identifiers and game-file facts are listed, never unconfirmed values, baseline rows, names or ids, or player names. Every answer states its scope, measurement method, data date and install counts; unknown values are [?]. Zone and type are optional; omitted filters cover all released zones and all types.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Who plays what: population by race, class, faction and level";
    description: "How many characters play each race, class, race and class, faction and level band on WoW: Forever, from the census of players who turned it on in the Everloot addon. Each character counts once. A count shows only when it covers at least 10 characters reported by at least 3 installs from at least 3 addresses, rounded to the nearest 5, and a count that could be worked out from the others is hidden too. Every answer states its window: active in the last 7 days (default) or since launch. With no arguments, the overview: most played class first. No names, ever. Missing or unavailable data is reported explicitly.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Recent official changes for WoW: Forever";
    description: "Newest first: Blizzard blue posts (title, author, time, a short excerpt and the link to the original), hotfix posts, and new game builds. Excerpts only: Blizzard's post text is Blizzard's; full posts are available at their source URLs. A build's time is when Everloot first saw it, not Blizzard's release time.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "WoW: Forever addons and open-source projects";
    description: "Forever addons and tools from the community registry, with a board ranking: most installed, rising, most active, freshest release or best maintained. Each project shows its GitHub repository, stars, latest release, last commit, whether its .toc declares a Forever interface number, and installs from Everloot uploads (counted from 3 installs; a missing count means not counted, not zero). Projects are ranked, never people. GitHub facts carry the time they were refreshed.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
} | {
    title: "Everloot implementation tracker";
    description: "The Everloot feature catalogue: what is live, what is next, what is waiting, and which reference sites are page shapes only.";
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
        readonly openWorldHint: false;
    };
    name: "answer_sources" | "auction_history" | "collection_gap" | "completion_progress" | "coverage" | "ecosystem_projects" | "entity_relations" | "everloot_plan" | "fetch" | "get_by_name" | "get_entity" | "gold_ledger" | "guild_board" | "guild_rankings" | "guild_search" | "item_categories" | "item_page" | "market_value" | "npc_page" | "object_page" | "population" | "profession_path" | "quest_page" | "recent_changes" | "recipe_thresholds" | "search" | "search_knowledge" | "talent_plan" | "talent_tree" | "vendor_page" | "world_map_near";
})[];
/**
 * What every tool returns: one text content block. Answers built on player data end with the
 * credit line, after a line stating how old the data is. Tools that read nothing from players carry
 * their sources inside the text instead. Tools with an outputSchema also return structuredContent
 * of that shape (STRUCTURED_TOOLS lists them; coverage is text only).
 * When one everloot.app page shows the answer, its structured `url` holds it and the text carries a
 * `More: <url>` line, last before the data age and credit lines.
 */
export declare const TOOL_OUTPUT: {
    readonly type: "text";
    readonly endsWith: "Licence: CC BY-SA 4.0. Credit: Everloot contributors, https://everloot.app";
};
/** The tools that answer with structuredContent beside the text. */
export declare const STRUCTURED_TOOLS: readonly McpToolName[];
/** The two tools of OpenAI's connector contract: their text block is the structured answer as a JSON string, not prose. */
export declare const CHATGPT_TOOLS: readonly McpToolName[];
/** The tools whose answers are built on player uploads and therefore end with TOOL_OUTPUT.endsWith. */
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
