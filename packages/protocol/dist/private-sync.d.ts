import { z } from "zod";
/**
 * Transport validation for private character sync, shared by the sender and server.
 * Private-only kinds must never be added to recordSchemas: public intake rejects them.
 * Authorization, environment gates, visibility switches and storage belong to the server.
 */
/** What a link can sync, in page order. `stats` and `pvp` are the player's own self-reported numbers. `achievements` is published under the Collections section's switch. */
export declare const SYNC_CATEGORIES: readonly ["gear", "stats", "talents", "pvp", "professions", "reputations", "raids", "achievements"];
export type SyncCategory = (typeof SYNC_CATEGORIES)[number];
export declare const isSyncCategory: (v: unknown) => v is SyncCategory;
/** Characters one request may carry, and rows across them. A full completion file is a few thousand rows. */
export declare const SYNC_CHARACTERS_PER_REQUEST = 10;
export declare const SYNC_ROWS_PER_REQUEST = 10000;
export declare const professionOwned: z.ZodObject<{
    installId: z.ZodString;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"profession_owned">;
    profession: z.ZodString;
    skillLine: z.ZodOptional<z.ZodNumber>;
    rank: z.ZodNumber;
    maxRank: z.ZodNumber;
}, z.core.$strip>;
export declare const lockoutOwned: z.ZodObject<{
    installId: z.ZodString;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"lockout_owned">;
    instance: z.ZodString;
    instanceId: z.ZodOptional<z.ZodNumber>;
    difficultyId: z.ZodOptional<z.ZodNumber>;
    difficulty: z.ZodOptional<z.ZodString>;
    bossesKilledCount: z.ZodNumber;
    bossesTotal: z.ZodNumber;
    resetAt: z.ZodString;
}, z.core.$strip>;
/**
 * The active talent build of one linked character, keyed like the other owned rows. The public talent_snapshot carries
 * no character key and is not read here, so an anonymous row can never become a character's fact. Same refinements as
 * the protocol's talentSnapshot; `choice` is a zero-based entry index, so 0 is valid.
 */
export declare const talentOwned: z.ZodObject<{
    installId: z.ZodString;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"talent_owned">;
    treeId: z.ZodNumber;
    specId: z.ZodOptional<z.ZodNumber>;
    points: z.ZodNumber;
    nodes: z.ZodArray<z.ZodObject<{
        nodeId: z.ZodNumber;
        ranks: z.ZodNumber;
        choice: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * The character window's numbers, as the addon records them: exactly these keys, grouped as the page groups them.
 * Percent keys are rounded to 2 decimals by the addon. An absent key was not readable; it is never a zero.
 */
export declare const STAT_KEYS: readonly ["strength", "agility", "stamina", "intellect", "spirit", "meleeAttackPower", "meleeHit", "meleeCrit", "meleeHaste", "expertise", "rangedAttackPower", "rangedHit", "rangedCrit", "rangedHaste", "spellPower", "healing", "spellHit", "spellCrit", "spellHaste", "armor", "defense", "dodge", "parry", "block"];
export type StatKey = (typeof STAT_KEYS)[number];
/**
 * One linked character's sheet. Unknown keys are dropped, not refused, so an older site tolerates a newer addon; a row
 * left with no known key is refused. Each value must be a finite number.
 */
export declare const statsOwned: z.ZodObject<{
    installId: z.ZodString;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"stats_owned">;
    stats: z.ZodPipe<z.ZodRecord<z.ZodString, z.ZodUnknown>, z.ZodTransform<Partial<Record<"agility" | "armor" | "block" | "defense" | "dodge" | "expertise" | "healing" | "intellect" | "meleeAttackPower" | "meleeCrit" | "meleeHaste" | "meleeHit" | "parry" | "rangedAttackPower" | "rangedCrit" | "rangedHaste" | "rangedHit" | "spellCrit" | "spellHaste" | "spellHit" | "spellPower" | "spirit" | "stamina" | "strength", number>>, Record<string, unknown>>>;
}, z.core.$strip>;
/**
 * One linked character's PvP standing, as the addon records it: each number is optional (an unreadable one is absent,
 * never a zero), but a row holds the rank or the honorable kills, or it says nothing.
 */
export declare const pvpOwned: z.ZodObject<{
    installId: z.ZodString;
    capturedAt: z.ZodString;
    characterKey: z.ZodString;
    class: z.ZodString;
    level: z.ZodNumber;
    kind: z.ZodLiteral<"pvp_owned">;
    rank: z.ZodOptional<z.ZodNumber>;
    rankPoints: z.ZodOptional<z.ZodNumber>;
    rankThreshold: z.ZodOptional<z.ZodNumber>;
    rankMax: z.ZodOptional<z.ZodNumber>;
    season: z.ZodOptional<z.ZodNumber>;
    honorableKills: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** The kinds this endpoint reads, each with the category it feeds. Any other kind is skipped. */
declare const SCHEMAS: {
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
    readonly talent_owned: z.ZodObject<{
        installId: z.ZodString;
        capturedAt: z.ZodString;
        characterKey: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        kind: z.ZodLiteral<"talent_owned">;
        treeId: z.ZodNumber;
        specId: z.ZodOptional<z.ZodNumber>;
        points: z.ZodNumber;
        nodes: z.ZodArray<z.ZodObject<{
            nodeId: z.ZodNumber;
            ranks: z.ZodNumber;
            choice: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly stats_owned: z.ZodObject<{
        installId: z.ZodString;
        capturedAt: z.ZodString;
        characterKey: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        kind: z.ZodLiteral<"stats_owned">;
        stats: z.ZodPipe<z.ZodRecord<z.ZodString, z.ZodUnknown>, z.ZodTransform<Partial<Record<"agility" | "armor" | "block" | "defense" | "dodge" | "expertise" | "healing" | "intellect" | "meleeAttackPower" | "meleeCrit" | "meleeHaste" | "meleeHit" | "parry" | "rangedAttackPower" | "rangedCrit" | "rangedHaste" | "rangedHit" | "spellCrit" | "spellHaste" | "spellHit" | "spellPower" | "spirit" | "stamina" | "strength", number>>, Record<string, unknown>>>;
    }, z.core.$strip>;
    readonly pvp_owned: z.ZodObject<{
        installId: z.ZodString;
        capturedAt: z.ZodString;
        characterKey: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        kind: z.ZodLiteral<"pvp_owned">;
        rank: z.ZodOptional<z.ZodNumber>;
        rankPoints: z.ZodOptional<z.ZodNumber>;
        rankThreshold: z.ZodOptional<z.ZodNumber>;
        rankMax: z.ZodOptional<z.ZodNumber>;
        season: z.ZodOptional<z.ZodNumber>;
        honorableKills: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    readonly profession_owned: z.ZodObject<{
        installId: z.ZodString;
        capturedAt: z.ZodString;
        characterKey: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        kind: z.ZodLiteral<"profession_owned">;
        profession: z.ZodString;
        skillLine: z.ZodOptional<z.ZodNumber>;
        rank: z.ZodNumber;
        maxRank: z.ZodNumber;
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
    readonly lockout_owned: z.ZodObject<{
        installId: z.ZodString;
        capturedAt: z.ZodString;
        characterKey: z.ZodString;
        class: z.ZodString;
        level: z.ZodNumber;
        kind: z.ZodLiteral<"lockout_owned">;
        instance: z.ZodString;
        instanceId: z.ZodOptional<z.ZodNumber>;
        difficultyId: z.ZodOptional<z.ZodNumber>;
        difficulty: z.ZodOptional<z.ZodString>;
        bossesKilledCount: z.ZodNumber;
        bossesTotal: z.ZodNumber;
        resetAt: z.ZodString;
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
};
type Kind = keyof typeof SCHEMAS;
export type SyncRow = z.infer<(typeof SCHEMAS)[Kind]>;
/** One row of a request, checked against its kind's schema; null when it is not one this endpoint reads. */
export declare function parseSyncRow(value: unknown): SyncRow | null;
export {};
