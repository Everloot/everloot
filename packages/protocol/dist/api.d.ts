import { z } from "zod";
/** The licence and credit line on every answer built from player data. `source` is a page a person can open. */
export declare const attributionSchema: z.ZodObject<{
    licence: z.ZodString;
    licenceUrl: z.ZodString;
    credit: z.ZodString;
    source: z.ZodString;
    terms: z.ZodString;
}, z.core.$strip>;
export type Attribution = z.infer<typeof attributionSchema>;
/** The notice on game-file data instead of attribution. */
export declare const gameDataNoticeSchema: z.ZodObject<{
    label: z.ZodString;
    build: z.ZodString;
    extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    credit: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
/** Every refusal: `ok: false` and a sentence. `getAKey` appears only while free keys exist. */
export declare const apiErrorSchema: z.ZodObject<{
    ok: z.ZodLiteral<false>;
    error: z.ZodString;
    getAKey: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ApiError = z.infer<typeof apiErrorSchema>;
/** Paging over a list: `next` is the full URL of the following page, or null on the last one. */
export declare const pageSchema: z.ZodObject<{
    offset: z.ZodNumber;
    limit: z.ZodNumber;
    total: z.ZodNumber;
    next: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type Page = z.infer<typeof pageSchema>;
/** GET /api/corpus/public: public records with per-install pseudonyms in place of install ids, optionally only some kinds. */
export declare const corpusPublicResponse: z.ZodObject<{
    offset: z.ZodNumber;
    limit: z.ZodNumber;
    total: z.ZodNumber;
    next: z.ZodNullable<z.ZodString>;
    ok: z.ZodLiteral<true>;
    uploads: z.ZodNumber;
    records: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    dataAsOf: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    kinds: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        [x: string]: string;
    }>>>;
    legacyRecords: z.ZodOptional<z.ZodNumber>;
    attribution: z.ZodObject<{
        licence: z.ZodString;
        licenceUrl: z.ZodString;
        credit: z.ZodString;
        source: z.ZodString;
        terms: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export type CorpusPublicResponse = z.infer<typeof corpusPublicResponse>;
/** GET /api/market/prices without `realm`: the realms that have public market values. */
export declare const marketRealmsResponse: z.ZodObject<{
    ok: z.ZodLiteral<true>;
    dataAsOf: z.ZodNullable<z.ZodString>;
    realms: z.ZodArray<z.ZodString>;
    houses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
        Neutral: "Neutral";
    }>>>>;
    attribution: z.ZodObject<{
        licence: z.ZodString;
        licenceUrl: z.ZodString;
        credit: z.ZodString;
        source: z.ZodString;
        terms: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const MARKET_PRICE_FIELDS: readonly ["itemId", "market", "min", "historical", "quantity", "day", "reporters"];
/** GET /api/market/prices?realm=: the items with the most units listed, as tuples in `fields` order. */
export declare const marketPricesResponse: z.ZodObject<{
    ok: z.ZodLiteral<true>;
    dataAsOf: z.ZodNullable<z.ZodString>;
    rule: z.ZodString;
    fields: z.ZodTuple<[z.ZodLiteral<"itemId">, z.ZodLiteral<"market">, z.ZodLiteral<"min">, z.ZodLiteral<"historical">, z.ZodLiteral<"quantity">, z.ZodLiteral<"day">, z.ZodLiteral<"reporters">], null>;
    realm: z.ZodNullable<z.ZodString>;
    house: z.ZodOptional<z.ZodEnum<{
        Alliance: "Alliance";
        Horde: "Horde";
        Neutral: "Neutral";
    }>>;
    items: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodString, z.ZodNumber], null>>;
    attribution: z.ZodObject<{
        licence: z.ZodString;
        licenceUrl: z.ZodString;
        credit: z.ZodString;
        source: z.ZodString;
        terms: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export type MarketPricesResponse = z.infer<typeof marketPricesResponse>;
/** GET /api/rollups/drops: corroborated drop rates, then sources looted with nothing in their windows. */
export declare const dropsResponse: z.ZodObject<{
    offset: z.ZodNumber;
    limit: z.ZodNumber;
    total: z.ZodNumber;
    next: z.ZodNullable<z.ZodString>;
    generatedAt: z.ZodString;
    dataAsOf: z.ZodNullable<z.ZodString>;
    stats: z.ZodObject<{
        uploads: z.ZodNumber;
        lootWindows: z.ZodNumber;
        records: z.ZodNumber;
        unreachable: z.ZodBoolean;
        dataAsOf: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    unreachable: z.ZodBoolean;
    rates: z.ZodArray<z.ZodObject<{
        sourceNpcId: z.ZodOptional<z.ZodNumber>;
        sourceObjectId: z.ZodOptional<z.ZodNumber>;
        itemId: z.ZodNumber;
        kills: z.ZodNumber;
        drops: z.ZodNumber;
        rate: z.ZodNumber;
        reporters: z.ZodNumber;
        public: z.ZodLiteral<true>;
    }, z.core.$strip>>;
    measuredZeros: z.ZodArray<z.ZodObject<{
        sourceNpcId: z.ZodOptional<z.ZodNumber>;
        sourceObjectId: z.ZodOptional<z.ZodNumber>;
        kills: z.ZodNumber;
        reporters: z.ZodNumber;
        public: z.ZodLiteral<true>;
    }, z.core.$strip>>;
    queued: z.ZodNullable<z.ZodNumber>;
    totalRates: z.ZodNumber;
    totalMeasuredZeros: z.ZodNumber;
    attribution: z.ZodObject<{
        licence: z.ZodString;
        licenceUrl: z.ZodString;
        credit: z.ZodString;
        source: z.ZodString;
        terms: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export type DropsResponse = z.infer<typeof dropsResponse>;
declare const edge: z.ZodObject<{
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
export type EdgeRow = z.infer<typeof edge>;
/** GET /api/edges: typed relations, observed first, then game-file ones. */
export declare const edgesResponse: z.ZodObject<{
    offset: z.ZodNumber;
    limit: z.ZodNumber;
    total: z.ZodNumber;
    next: z.ZodNullable<z.ZodString>;
    generatedAt: z.ZodString;
    dataAsOf: z.ZodNullable<z.ZodString>;
    unreachable: z.ZodBoolean;
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
    attribution: z.ZodObject<{
        licence: z.ZodString;
        licenceUrl: z.ZodString;
        credit: z.ZodString;
        source: z.ZodString;
        terms: z.ZodString;
    }, z.core.$strip>;
    gameData: z.ZodNullable<z.ZodObject<{
        label: z.ZodString;
        build: z.ZodString;
        extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        credit: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$strip>;
export type EdgesResponse = z.infer<typeof edgesResponse>;
/** GET /api/items: items of the current build with class, subclass, slot and quality. Game-file data. */
export declare const itemsResponse: z.ZodObject<{
    offset: z.ZodNumber;
    limit: z.ZodNumber;
    total: z.ZodNumber;
    next: z.ZodNullable<z.ZodString>;
    generatedAt: z.ZodString;
    items: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    gameData: z.ZodObject<{
        label: z.ZodString;
        build: z.ZodString;
        extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        credit: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>;
}, z.core.$strip>;
export declare const itemCategoriesResponse: z.ZodObject<{
    classes: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        name: z.ZodString;
        label: z.ZodString;
        slug: z.ZodString;
        items: z.ZodNumber;
        subclasses: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            name: z.ZodNullable<z.ZodString>;
            slug: z.ZodString;
            items: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    slots: z.ZodArray<z.ZodObject<{
        slug: z.ZodString;
        name: z.ZodString;
    }, z.core.$strip>>;
    qualities: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        name: z.ZodString;
        slug: z.ZodString;
    }, z.core.$strip>>;
    gameData: z.ZodObject<{
        label: z.ZodString;
        build: z.ZodString;
        extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        credit: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>;
}, z.core.$strip>;
export type ItemCategoriesResponse = z.infer<typeof itemCategoriesResponse>;
/**
 * GET /api/tools/{tool}: one MCP tool's answer over plain HTTP. `answer` is the tool's structured content,
 * of the shape its schema file declares under outputSchema; `text` is the same answer as the MCP text block.
 */
export declare const toolAnswerResponse: z.ZodObject<{
    tool: z.ZodString;
    arguments: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    answer: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    text: z.ZodString;
    schema: z.ZodString;
}, z.core.$strip>;
export type ToolAnswerResponse = z.infer<typeof toolAnswerResponse>;
/** The page types GET /api/tooltip/{type}/{id} answers for. */
export declare const TOOLTIP_TYPES: readonly ["item", "npc", "quest", "object"];
export type TooltipType = (typeof TOOLTIP_TYPES)[number];
/**
 * GET /api/tooltip/{type}/{id}: what a hover card for one page needs, for the embeddable script. Plain text
 * only (no markup). `gameData` is present when the card shows the game's icon or tooltip text.
 */
export declare const tooltipResponse: z.ZodObject<{
    ok: z.ZodLiteral<true>;
    type: z.ZodEnum<{
        item: "item";
        npc: "npc";
        object: "object";
        quest: "quest";
    }>;
    id: z.ZodNumber;
    title: z.ZodString;
    color: z.ZodNullable<z.ZodString>;
    icon: z.ZodNullable<z.ZodString>;
    lines: z.ZodArray<z.ZodString>;
    partial: z.ZodBoolean;
    url: z.ZodString;
    attribution: z.ZodObject<{
        licence: z.ZodString;
        licenceUrl: z.ZodString;
        credit: z.ZodString;
        source: z.ZodString;
        terms: z.ZodString;
    }, z.core.$strip>;
    gameData: z.ZodNullable<z.ZodObject<{
        label: z.ZodString;
        build: z.ZodString;
        extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        credit: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$strip>;
export type TooltipResponse = z.infer<typeof tooltipResponse>;
/** POST /api/intake, 200: stored. */
export declare const intakeReceipt: z.ZodObject<{
    ok: z.ZodLiteral<true>;
    persisted: z.ZodLiteral<true>;
    uploadId: z.ZodString;
    accepted: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        kind: z.ZodOptional<z.ZodString>;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    rejected: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        kind: z.ZodOptional<z.ZodString>;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$loose>;
/** POST /api/intake, 4xx or 503: refused; `accepted` and `rejected` say why when the envelope parsed. */
export declare const intakeRefused: z.ZodObject<{
    ok: z.ZodLiteral<false>;
    error: z.ZodOptional<z.ZodString>;
    persisted: z.ZodOptional<z.ZodLiteral<false>>;
    uploadId: z.ZodOptional<z.ZodString>;
    accepted: z.ZodOptional<z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        kind: z.ZodOptional<z.ZodString>;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    rejected: z.ZodOptional<z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        kind: z.ZodOptional<z.ZodString>;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
/** POST /api/intake request body: the envelope, with the sharing choices and grants the upload page adds. */
export declare const intakeRequest: z.ZodObject<{
    addonVersion: z.ZodString;
    clientBuild: z.ZodOptional<z.ZodString>;
    protocol: z.ZodOptional<z.ZodString>;
    records: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strip>], "kind">>;
    sharing: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    grantTokens: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
/** GET /api/health: 200 when the public snapshot is fresh, 503 otherwise. */
export declare const healthResponse: z.ZodObject<{
    ok: z.ZodBoolean;
    snapshot: z.ZodObject<{
        status: z.ZodEnum<{
            fresh: "fresh";
            local: "local";
            missing: "missing";
            stale: "stale";
            unavailable: "unavailable";
        }>;
        updatedAt: z.ZodNullable<z.ZodString>;
        ageSeconds: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type HealthResponse = z.infer<typeof healthResponse>;
/** guild-kills.ndjson of the bulk export: the agreed guild kills, oldest first. */
export declare const guildKillsResponse: z.ZodObject<{
    generatedAt: z.ZodString;
    dataAsOf: z.ZodNullable<z.ZodString>;
    kills: z.ZodArray<z.ZodObject<{
        guildName: z.ZodString;
        realm: z.ZodString;
        faction: z.ZodNullable<z.ZodEnum<{
            alliance: "alliance";
            horde: "horde";
        }>>;
        encounterId: z.ZodNumber;
        name: z.ZodString;
        instanceMapId: z.ZodNumber;
        difficulty: z.ZodNullable<z.ZodNumber>;
        killedAt: z.ZodString;
        installs: z.ZodNumber;
        source: z.ZodEnum<{
            members: "members";
            officers: "officers";
        }>;
    }, z.core.$strip>>;
    attribution: z.ZodObject<{
        licence: z.ZodString;
        licenceUrl: z.ZodString;
        credit: z.ZodString;
        source: z.ZodString;
        terms: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export type GuildKillsResponse = z.infer<typeof guildKillsResponse>;
/** guilds.ndjson of the bulk export: the guild directory, newest kill first. */
export declare const guildsResponse: z.ZodObject<{
    generatedAt: z.ZodString;
    dataAsOf: z.ZodNullable<z.ZodString>;
    guilds: z.ZodArray<z.ZodObject<{
        guildName: z.ZodString;
        realm: z.ZodString;
        faction: z.ZodNullable<z.ZodEnum<{
            alliance: "alliance";
            horde: "horde";
        }>>;
        membersSeen: z.ZodNullable<z.ZodNumber>;
        membersPublished: z.ZodNullable<z.ZodNumber>;
        kills: z.ZodNumber;
        latestKillAt: z.ZodNullable<z.ZodString>;
        lastSeen: z.ZodNullable<z.ZodString>;
        sources: z.ZodArray<z.ZodEnum<{
            kills: "kills";
            officers: "officers";
            seen: "seen";
        }>>;
    }, z.core.$strip>>;
    attribution: z.ZodObject<{
        licence: z.ZodString;
        licenceUrl: z.ZodString;
        credit: z.ZodString;
        source: z.ZodString;
        terms: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export type GuildsResponse = z.infer<typeof guildsResponse>;
/** The response schemas by name, the names schema/api/<name>.json uses. */
/** The datasets the bulk export writes, one NDJSON file each; the rows are the same the JSON API serves. */
export declare const BULK_DATASETS: readonly ["corpus", "edges", "drops", "items", "guilds"];
export type BulkDataset = (typeof BULK_DATASETS)[number];
/** One file of a bulk export: a newline-delimited JSON file whose rows are the `rowsOf` response's `field` elements. */
export declare const bulkFile: z.ZodObject<{
    name: z.ZodString;
    dataset: z.ZodEnum<{
        corpus: "corpus";
        drops: "drops";
        edges: "edges";
        guilds: "guilds";
        items: "items";
    }>;
    format: z.ZodLiteral<"ndjson">;
    rowsOf: z.ZodString;
    field: z.ZodString;
    rows: z.ZodNumber;
    bytes: z.ZodNumber;
    sha256: z.ZodString;
    data: z.ZodEnum<{
        "game-files": "game-files";
        mixed: "mixed";
        observed: "observed";
    }>;
    attribution: z.ZodNullable<z.ZodObject<{
        licence: z.ZodString;
        licenceUrl: z.ZodString;
        credit: z.ZodString;
        source: z.ZodString;
        terms: z.ZodString;
    }, z.core.$strip>>;
    gameData: z.ZodNullable<z.ZodObject<{
        label: z.ZodString;
        build: z.ZodString;
        extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        credit: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$strip>;
export type BulkFile = z.infer<typeof bulkFile>;
/** index.json of a bulk export folder: what the folder holds, when the data was current, how to credit it. */
export declare const bulkIndex: z.ZodObject<{
    protocol: z.ZodString;
    generatedAt: z.ZodString;
    dataAsOf: z.ZodNullable<z.ZodString>;
    build: z.ZodNullable<z.ZodString>;
    site: z.ZodString;
    licence: z.ZodString;
    licenceUrl: z.ZodString;
    credit: z.ZodString;
    files: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        dataset: z.ZodEnum<{
            corpus: "corpus";
            drops: "drops";
            edges: "edges";
            guilds: "guilds";
            items: "items";
        }>;
        format: z.ZodLiteral<"ndjson">;
        rowsOf: z.ZodString;
        field: z.ZodString;
        rows: z.ZodNumber;
        bytes: z.ZodNumber;
        sha256: z.ZodString;
        data: z.ZodEnum<{
            "game-files": "game-files";
            mixed: "mixed";
            observed: "observed";
        }>;
        attribution: z.ZodNullable<z.ZodObject<{
            licence: z.ZodString;
            licenceUrl: z.ZodString;
            credit: z.ZodString;
            source: z.ZodString;
            terms: z.ZodString;
        }, z.core.$strip>>;
        gameData: z.ZodNullable<z.ZodObject<{
            label: z.ZodString;
            build: z.ZodString;
            extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            credit: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type BulkIndex = z.infer<typeof bulkIndex>;
/**
 * GET /api/coverage/settled: the facts that are settled for one client build (five installs agree, no other report
 * for 14 days), at the grain of an upload row, so an uploader can leave out the rows that would only repeat them.
 * Ids only, never values; everything in it is a fact the site already shows.
 */
export declare const settledListResponse: z.ZodObject<{
    schema: z.ZodLiteral<"everloot.settled/1">;
    build: z.ZodString;
    dataAsOf: z.ZodNullable<z.ZodString>;
    npc_sighting: z.ZodObject<{
        ids: z.ZodArray<z.ZodNumber>;
        maps: z.ZodArray<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strip>;
    quest: z.ZodArray<z.ZodNumber>;
    vendor: z.ZodArray<z.ZodNumber>;
    loot: z.ZodObject<{
        npc: z.ZodArray<z.ZodNumber>;
        obj: z.ZodArray<z.ZodNumber>;
    }, z.core.$strip>;
    instance_entrance: z.ZodObject<{
        ids: z.ZodArray<z.ZodNumber>;
        maps: z.ZodArray<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strip>;
    encounter: z.ZodObject<{
        ids: z.ZodArray<z.ZodNumber>;
        maps: z.ZodArray<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strip>;
    object_sighting: z.ZodObject<{
        ids: z.ZodArray<z.ZodNumber>;
        maps: z.ZodArray<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type SettledListResponse = z.infer<typeof settledListResponse>;
export declare const API_SCHEMAS: {
    readonly attribution: z.ZodObject<{
        licence: z.ZodString;
        licenceUrl: z.ZodString;
        credit: z.ZodString;
        source: z.ZodString;
        terms: z.ZodString;
    }, z.core.$strip>;
    readonly gameDataNotice: z.ZodObject<{
        label: z.ZodString;
        build: z.ZodString;
        extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        credit: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>;
    readonly apiError: z.ZodObject<{
        ok: z.ZodLiteral<false>;
        error: z.ZodString;
        getAKey: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly page: z.ZodObject<{
        offset: z.ZodNumber;
        limit: z.ZodNumber;
        total: z.ZodNumber;
        next: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    readonly corpusPublicResponse: z.ZodObject<{
        offset: z.ZodNumber;
        limit: z.ZodNumber;
        total: z.ZodNumber;
        next: z.ZodNullable<z.ZodString>;
        ok: z.ZodLiteral<true>;
        uploads: z.ZodNumber;
        records: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        dataAsOf: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        kinds: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            [x: string]: string;
        }>>>;
        legacyRecords: z.ZodOptional<z.ZodNumber>;
        attribution: z.ZodObject<{
            licence: z.ZodString;
            licenceUrl: z.ZodString;
            credit: z.ZodString;
            source: z.ZodString;
            terms: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly marketRealmsResponse: z.ZodObject<{
        ok: z.ZodLiteral<true>;
        dataAsOf: z.ZodNullable<z.ZodString>;
        realms: z.ZodArray<z.ZodString>;
        houses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodEnum<{
            Alliance: "Alliance";
            Horde: "Horde";
            Neutral: "Neutral";
        }>>>>;
        attribution: z.ZodObject<{
            licence: z.ZodString;
            licenceUrl: z.ZodString;
            credit: z.ZodString;
            source: z.ZodString;
            terms: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly marketPricesResponse: z.ZodObject<{
        ok: z.ZodLiteral<true>;
        dataAsOf: z.ZodNullable<z.ZodString>;
        rule: z.ZodString;
        fields: z.ZodTuple<[z.ZodLiteral<"itemId">, z.ZodLiteral<"market">, z.ZodLiteral<"min">, z.ZodLiteral<"historical">, z.ZodLiteral<"quantity">, z.ZodLiteral<"day">, z.ZodLiteral<"reporters">], null>;
        realm: z.ZodNullable<z.ZodString>;
        house: z.ZodOptional<z.ZodEnum<{
            Alliance: "Alliance";
            Horde: "Horde";
            Neutral: "Neutral";
        }>>;
        items: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodString, z.ZodNumber], null>>;
        attribution: z.ZodObject<{
            licence: z.ZodString;
            licenceUrl: z.ZodString;
            credit: z.ZodString;
            source: z.ZodString;
            terms: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly dropsResponse: z.ZodObject<{
        offset: z.ZodNumber;
        limit: z.ZodNumber;
        total: z.ZodNumber;
        next: z.ZodNullable<z.ZodString>;
        generatedAt: z.ZodString;
        dataAsOf: z.ZodNullable<z.ZodString>;
        stats: z.ZodObject<{
            uploads: z.ZodNumber;
            lootWindows: z.ZodNumber;
            records: z.ZodNumber;
            unreachable: z.ZodBoolean;
            dataAsOf: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        unreachable: z.ZodBoolean;
        rates: z.ZodArray<z.ZodObject<{
            sourceNpcId: z.ZodOptional<z.ZodNumber>;
            sourceObjectId: z.ZodOptional<z.ZodNumber>;
            itemId: z.ZodNumber;
            kills: z.ZodNumber;
            drops: z.ZodNumber;
            rate: z.ZodNumber;
            reporters: z.ZodNumber;
            public: z.ZodLiteral<true>;
        }, z.core.$strip>>;
        measuredZeros: z.ZodArray<z.ZodObject<{
            sourceNpcId: z.ZodOptional<z.ZodNumber>;
            sourceObjectId: z.ZodOptional<z.ZodNumber>;
            kills: z.ZodNumber;
            reporters: z.ZodNumber;
            public: z.ZodLiteral<true>;
        }, z.core.$strip>>;
        queued: z.ZodNullable<z.ZodNumber>;
        totalRates: z.ZodNumber;
        totalMeasuredZeros: z.ZodNumber;
        attribution: z.ZodObject<{
            licence: z.ZodString;
            licenceUrl: z.ZodString;
            credit: z.ZodString;
            source: z.ZodString;
            terms: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly edgesResponse: z.ZodObject<{
        offset: z.ZodNumber;
        limit: z.ZodNumber;
        total: z.ZodNumber;
        next: z.ZodNullable<z.ZodString>;
        generatedAt: z.ZodString;
        dataAsOf: z.ZodNullable<z.ZodString>;
        unreachable: z.ZodBoolean;
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
        attribution: z.ZodObject<{
            licence: z.ZodString;
            licenceUrl: z.ZodString;
            credit: z.ZodString;
            source: z.ZodString;
            terms: z.ZodString;
        }, z.core.$strip>;
        gameData: z.ZodNullable<z.ZodObject<{
            label: z.ZodString;
            build: z.ZodString;
            extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            credit: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$strip>;
    readonly itemsResponse: z.ZodObject<{
        offset: z.ZodNumber;
        limit: z.ZodNumber;
        total: z.ZodNumber;
        next: z.ZodNullable<z.ZodString>;
        generatedAt: z.ZodString;
        items: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        gameData: z.ZodObject<{
            label: z.ZodString;
            build: z.ZodString;
            extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            credit: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>;
    }, z.core.$strip>;
    readonly itemCategoriesResponse: z.ZodObject<{
        classes: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            name: z.ZodString;
            label: z.ZodString;
            slug: z.ZodString;
            items: z.ZodNumber;
            subclasses: z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodNullable<z.ZodString>;
                slug: z.ZodString;
                items: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        slots: z.ZodArray<z.ZodObject<{
            slug: z.ZodString;
            name: z.ZodString;
        }, z.core.$strip>>;
        qualities: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            name: z.ZodString;
            slug: z.ZodString;
        }, z.core.$strip>>;
        gameData: z.ZodObject<{
            label: z.ZodString;
            build: z.ZodString;
            extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            credit: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>;
    }, z.core.$strip>;
    readonly toolAnswerResponse: z.ZodObject<{
        tool: z.ZodString;
        arguments: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        answer: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        text: z.ZodString;
        schema: z.ZodString;
    }, z.core.$strip>;
    readonly tooltipResponse: z.ZodObject<{
        ok: z.ZodLiteral<true>;
        type: z.ZodEnum<{
            item: "item";
            npc: "npc";
            object: "object";
            quest: "quest";
        }>;
        id: z.ZodNumber;
        title: z.ZodString;
        color: z.ZodNullable<z.ZodString>;
        icon: z.ZodNullable<z.ZodString>;
        lines: z.ZodArray<z.ZodString>;
        partial: z.ZodBoolean;
        url: z.ZodString;
        attribution: z.ZodObject<{
            licence: z.ZodString;
            licenceUrl: z.ZodString;
            credit: z.ZodString;
            source: z.ZodString;
            terms: z.ZodString;
        }, z.core.$strip>;
        gameData: z.ZodNullable<z.ZodObject<{
            label: z.ZodString;
            build: z.ZodString;
            extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            credit: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$strip>;
    readonly bulkIndex: z.ZodObject<{
        protocol: z.ZodString;
        generatedAt: z.ZodString;
        dataAsOf: z.ZodNullable<z.ZodString>;
        build: z.ZodNullable<z.ZodString>;
        site: z.ZodString;
        licence: z.ZodString;
        licenceUrl: z.ZodString;
        credit: z.ZodString;
        files: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            dataset: z.ZodEnum<{
                corpus: "corpus";
                drops: "drops";
                edges: "edges";
                guilds: "guilds";
                items: "items";
            }>;
            format: z.ZodLiteral<"ndjson">;
            rowsOf: z.ZodString;
            field: z.ZodString;
            rows: z.ZodNumber;
            bytes: z.ZodNumber;
            sha256: z.ZodString;
            data: z.ZodEnum<{
                "game-files": "game-files";
                mixed: "mixed";
                observed: "observed";
            }>;
            attribution: z.ZodNullable<z.ZodObject<{
                licence: z.ZodString;
                licenceUrl: z.ZodString;
                credit: z.ZodString;
                source: z.ZodString;
                terms: z.ZodString;
            }, z.core.$strip>>;
            gameData: z.ZodNullable<z.ZodObject<{
                label: z.ZodString;
                build: z.ZodString;
                extractedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                credit: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly settledListResponse: z.ZodObject<{
        schema: z.ZodLiteral<"everloot.settled/1">;
        build: z.ZodString;
        dataAsOf: z.ZodNullable<z.ZodString>;
        npc_sighting: z.ZodObject<{
            ids: z.ZodArray<z.ZodNumber>;
            maps: z.ZodArray<z.ZodArray<z.ZodNumber>>;
        }, z.core.$strip>;
        quest: z.ZodArray<z.ZodNumber>;
        vendor: z.ZodArray<z.ZodNumber>;
        loot: z.ZodObject<{
            npc: z.ZodArray<z.ZodNumber>;
            obj: z.ZodArray<z.ZodNumber>;
        }, z.core.$strip>;
        instance_entrance: z.ZodObject<{
            ids: z.ZodArray<z.ZodNumber>;
            maps: z.ZodArray<z.ZodArray<z.ZodNumber>>;
        }, z.core.$strip>;
        encounter: z.ZodObject<{
            ids: z.ZodArray<z.ZodNumber>;
            maps: z.ZodArray<z.ZodArray<z.ZodNumber>>;
        }, z.core.$strip>;
        object_sighting: z.ZodObject<{
            ids: z.ZodArray<z.ZodNumber>;
            maps: z.ZodArray<z.ZodArray<z.ZodNumber>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly guildKillsResponse: z.ZodObject<{
        generatedAt: z.ZodString;
        dataAsOf: z.ZodNullable<z.ZodString>;
        kills: z.ZodArray<z.ZodObject<{
            guildName: z.ZodString;
            realm: z.ZodString;
            faction: z.ZodNullable<z.ZodEnum<{
                alliance: "alliance";
                horde: "horde";
            }>>;
            encounterId: z.ZodNumber;
            name: z.ZodString;
            instanceMapId: z.ZodNumber;
            difficulty: z.ZodNullable<z.ZodNumber>;
            killedAt: z.ZodString;
            installs: z.ZodNumber;
            source: z.ZodEnum<{
                members: "members";
                officers: "officers";
            }>;
        }, z.core.$strip>>;
        attribution: z.ZodObject<{
            licence: z.ZodString;
            licenceUrl: z.ZodString;
            credit: z.ZodString;
            source: z.ZodString;
            terms: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly guildsResponse: z.ZodObject<{
        generatedAt: z.ZodString;
        dataAsOf: z.ZodNullable<z.ZodString>;
        guilds: z.ZodArray<z.ZodObject<{
            guildName: z.ZodString;
            realm: z.ZodString;
            faction: z.ZodNullable<z.ZodEnum<{
                alliance: "alliance";
                horde: "horde";
            }>>;
            membersSeen: z.ZodNullable<z.ZodNumber>;
            membersPublished: z.ZodNullable<z.ZodNumber>;
            kills: z.ZodNumber;
            latestKillAt: z.ZodNullable<z.ZodString>;
            lastSeen: z.ZodNullable<z.ZodString>;
            sources: z.ZodArray<z.ZodEnum<{
                kills: "kills";
                officers: "officers";
                seen: "seen";
            }>>;
        }, z.core.$strip>>;
        attribution: z.ZodObject<{
            licence: z.ZodString;
            licenceUrl: z.ZodString;
            credit: z.ZodString;
            source: z.ZodString;
            terms: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly intakeRequest: z.ZodObject<{
        addonVersion: z.ZodString;
        clientBuild: z.ZodOptional<z.ZodString>;
        protocol: z.ZodOptional<z.ZodString>;
        records: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
        }, z.core.$strip>], "kind">>;
        sharing: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        grantTokens: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    readonly intakeReceipt: z.ZodObject<{
        ok: z.ZodLiteral<true>;
        persisted: z.ZodLiteral<true>;
        uploadId: z.ZodString;
        accepted: z.ZodArray<z.ZodObject<{
            index: z.ZodNumber;
            kind: z.ZodOptional<z.ZodString>;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        rejected: z.ZodArray<z.ZodObject<{
            index: z.ZodNumber;
            kind: z.ZodOptional<z.ZodString>;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$loose>;
    readonly intakeRefused: z.ZodObject<{
        ok: z.ZodLiteral<false>;
        error: z.ZodOptional<z.ZodString>;
        persisted: z.ZodOptional<z.ZodLiteral<false>>;
        uploadId: z.ZodOptional<z.ZodString>;
        accepted: z.ZodOptional<z.ZodArray<z.ZodObject<{
            index: z.ZodNumber;
            kind: z.ZodOptional<z.ZodString>;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        rejected: z.ZodOptional<z.ZodArray<z.ZodObject<{
            index: z.ZodNumber;
            kind: z.ZodOptional<z.ZodString>;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>;
    readonly healthResponse: z.ZodObject<{
        ok: z.ZodBoolean;
        snapshot: z.ZodObject<{
            status: z.ZodEnum<{
                fresh: "fresh";
                local: "local";
                missing: "missing";
                stale: "stale";
                unavailable: "unavailable";
            }>;
            updatedAt: z.ZodNullable<z.ZodString>;
            ageSeconds: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export type ApiSchemaName = keyof typeof API_SCHEMAS;
export interface ApiQueryParam {
    name: string;
    description: string;
    /** JSON Schema fragment for the parameter. */
    schema: Record<string, unknown>;
    required?: boolean;
}
export interface ApiRoute {
    method: "GET" | "POST";
    path: string;
    summary: string;
    description: string;
    /** Who may call it and how much. */
    access: "open" | "rate-limited" | "key-or-rate-limited" | "cron";
    /** Which data layer the answer carries. */
    data: "observed" | "game-files" | "mixed" | "none";
    /** Parameters in the path, written as `{name}` in `path`. */
    pathParams?: ApiQueryParam[];
    query?: ApiQueryParam[];
    requestBody?: ApiSchemaName;
    responses: Record<string, {
        description: string;
        schema?: ApiSchemaName;
    }>;
    /** Whether `?offset=` and `?limit=` page the answer. */
    paged?: boolean;
}
/** The public JSON endpoints, in the order the documentation lists them. Auth and cron routes are not public API. */
export declare const API_ROUTES: readonly ApiRoute[];
export {};
