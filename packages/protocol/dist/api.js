import { z } from "zod";
import { ENTITY_KINDS, MCP_TOOL_NAMES, RELS } from "./mcp.js";
import { anyRecord, AUCTION_HOUSES, PUBLIC_RECORD_KINDS } from "./records.js";
/**
 * The shapes everloot.app's JSON endpoints answer with. The routes build their bodies as they always
 * have; each route's test parses a real response with the matching schema here, so a route that drifts
 * from the protocol fails its own test. schema/api/<name>.json is generated from these, and the OpenAPI
 * document on the site is assembled from API_ROUTES.
 *
 * Everloot's own data (player observations) carries `attribution`: CC BY-SA 4.0 and the credit line.
 * Game-file data carries `gameData` instead: Blizzard's, found in game files, unconfirmed, with the build.
 */
const ISO_TIME = z.string().datetime({ offset: true });
/** The licence and credit line on every answer built from player data. `source` is a page a person can open. */
export const attributionSchema = z.object({
    licence: z.string(),
    licenceUrl: z.string().url(),
    credit: z.string(),
    source: z.string().url(),
    terms: z.string().url(),
});
/** The notice on game-file data instead of attribution. */
export const gameDataNoticeSchema = z.object({
    label: z.string().describe("The evidence label pages show, such as \"found in game files, unconfirmed\"."),
    build: z.string().describe("The game build the rows were read from."),
    extractedAt: z.string().nullable().optional(),
    credit: z.string().optional(),
}).passthrough();
/** Every refusal: `ok: false` and a sentence. `getAKey` appears only while free keys exist. */
export const apiErrorSchema = z.object({
    ok: z.literal(false),
    error: z.string(),
    getAKey: z.string().url().optional(),
});
/** Paging over a list: `next` is the full URL of the following page, or null on the last one. */
export const pageSchema = z.object({
    offset: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    next: z.string().url().nullable(),
});
/** GET /api/corpus/public: public records with per-install pseudonyms in place of install ids, optionally only some kinds. */
export const corpusPublicResponse = z.object({
    ok: z.literal(true),
    uploads: z.number().int().nonnegative(),
    records: z.array(z.record(z.string(), z.unknown())).describe("Records of the public kinds. installId holds a per-install pseudonym (pub- and 32 hex), never the addon's install id, so installs can be counted; it is absent when the server has no key to make one. Shapes: schema/records/<kind>.json."),
    dataAsOf: ISO_TIME.nullish().describe("When these records were current. Null or absent when unrecorded, never \"now\"."),
    kinds: z.array(z.enum(PUBLIC_RECORD_KINDS)).optional().describe("Present when the request asked for some kinds."),
    legacyRecords: z.number().int().nonnegative().optional(),
    attribution: attributionSchema,
}).extend(pageSchema.shape);
/** GET /api/market/prices without `realm`: the realms that have public market values. */
export const marketRealmsResponse = z.object({
    ok: z.literal(true),
    dataAsOf: ISO_TIME.nullable(),
    realms: z.array(z.string()),
    houses: z.record(z.string(), z.array(z.enum(AUCTION_HOUSES))).optional()
        .describe("Per realm, the auction houses that have public values of their own (scans that named their house)."),
    attribution: attributionSchema,
});
export const MARKET_PRICE_FIELDS = ["itemId", "market", "min", "historical", "quantity", "day", "reporters"];
/** GET /api/market/prices?realm=: the items with the most units listed, as tuples in `fields` order. */
export const marketPricesResponse = z.object({
    ok: z.literal(true),
    dataAsOf: ISO_TIME.nullable(),
    rule: z.string().describe("How a day becomes public and how the values are computed."),
    fields: z.tuple([z.literal("itemId"), z.literal("market"), z.literal("min"), z.literal("historical"), z.literal("quantity"), z.literal("day"), z.literal("reporters")]),
    realm: z.string().nullable(),
    house: z.enum(AUCTION_HOUSES).optional().describe("Present when the request named a house: the values come only from scans of that house."),
    items: z.array(z.tuple([
        z.number().int().positive(), z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative(),
        z.number().int().nonnegative(), z.string(), z.number().int().nonnegative(),
    ])).describe("[itemId, market, min, historical, quantity, day, reporters]; copper per unit."),
    attribution: attributionSchema,
});
const dropRate = z.object({
    sourceNpcId: z.number().int().positive().optional(),
    sourceObjectId: z.number().int().positive().optional(),
    itemId: z.number().int().positive(),
    kills: z.number().int().nonnegative().describe("Loot windows players opened on this source, not kills counted by the game."),
    drops: z.number().int().nonnegative(),
    rate: z.number().min(0).max(1),
    reporters: z.number().int().nonnegative().describe("Distinct installs that looted the source."),
    public: z.literal(true),
});
const measuredZero = z.object({
    sourceNpcId: z.number().int().positive().optional(),
    sourceObjectId: z.number().int().positive().optional(),
    kills: z.number().int().nonnegative(),
    reporters: z.number().int().nonnegative(),
    public: z.literal(true),
});
/** GET /api/rollups/drops: corroborated drop rates, then sources looted with nothing in their windows. */
export const dropsResponse = z.object({
    generatedAt: ISO_TIME,
    dataAsOf: ISO_TIME.nullable(),
    stats: z.object({
        uploads: z.number().int().nonnegative(),
        lootWindows: z.number().int().nonnegative(),
        records: z.number().int().nonnegative(),
        unreachable: z.boolean(),
        dataAsOf: ISO_TIME.nullable(),
    }),
    unreachable: z.boolean().describe("True when storage could not be read: the lists are then empty, not zero."),
    rates: z.array(dropRate),
    measuredZeros: z.array(measuredZero),
    queued: z.number().int().nonnegative().nullable().describe("Rates and zeros waiting for their third install; null when unreachable."),
    totalRates: z.number().int().nonnegative(),
    totalMeasuredZeros: z.number().int().nonnegative(),
    attribution: attributionSchema,
}).extend(pageSchema.shape);
const edge = z.object({
    fromKind: z.enum(ENTITY_KINDS),
    fromId: z.number().int().positive(),
    rel: z.enum(RELS),
    toKind: z.enum(ENTITY_KINDS),
    toId: z.number().int().positive(),
    evidence: z.enum(["observed", "client"]),
    build: z.string().nullable().describe("Game build of a client edge; null for observed edges."),
    installs: z.number().int().nonnegative().nullable().describe("Distinct installs behind an observed edge; null for client edges."),
    firstSeen: z.string().nullable(),
    lastSeen: z.string().nullable(),
});
/** GET /api/edges: typed relations, observed first, then game-file ones. */
export const edgesResponse = z.object({
    generatedAt: ISO_TIME,
    dataAsOf: ISO_TIME.nullable(),
    unreachable: z.boolean(),
    edges: z.array(edge),
    attribution: attributionSchema,
    gameData: gameDataNoticeSchema.nullable().describe("Present when the page holds at least one game-file edge."),
}).extend(pageSchema.shape);
/** GET /api/items: items of the current build with class, subclass, slot and quality. Game-file data. */
export const itemsResponse = z.object({
    generatedAt: ISO_TIME,
    items: z.array(z.record(z.string(), z.unknown())),
    gameData: gameDataNoticeSchema,
}).extend(pageSchema.shape);
/** GET /api/items/categories: the class and subclass tree of the current build, with the slot and quality slugs /api/items takes. */
const itemSubclassSchema = z.object({
    id: z.number().int(),
    name: z.string().nullable().describe("The client's name; null when the client has none, then the slug is the id."),
    slug: z.string().describe("The value /api/items takes as subclass."),
    items: z.number().int().describe("Items of the build in this subclass."),
});
const itemClassSchema = z.object({
    id: z.number().int(),
    name: z.string().describe("The client's name."),
    label: z.string().describe("The plural label pages use."),
    slug: z.string().describe("The value /api/items takes as class."),
    items: z.number().int().describe("Items of the build in this class."),
    subclasses: z.array(itemSubclassSchema),
});
export const itemCategoriesResponse = z.object({
    classes: z.array(itemClassSchema),
    slots: z.array(z.object({ slug: z.string().describe("The value /api/items takes as slot."), name: z.string() })),
    qualities: z.array(z.object({ id: z.number().int(), name: z.string(), slug: z.string().describe("The value /api/items takes as quality.") })),
    gameData: gameDataNoticeSchema,
});
/**
 * GET /api/tools/{tool}: one MCP tool's answer over plain HTTP. `answer` is the tool's structured content,
 * of the shape its schema file declares under outputSchema; `text` is the same answer as the MCP text block.
 */
export const toolAnswerResponse = z.object({
    tool: z.string().describe("The tool's name, as in the MCP tool list."),
    arguments: z.record(z.string(), z.unknown()).describe("The arguments as the tool read them, defaults applied."),
    answer: z.record(z.string(), z.unknown()).describe("The tool's structured answer. Its schema: /schema/mcp/{tool}.json#/outputSchema."),
    text: z.string().describe("The same answer as the MCP text block, for a reader."),
    schema: z.string().describe("The URL of the tool's schema file."),
});
/** The page types GET /api/tooltip/{type}/{id} answers for. */
export const TOOLTIP_TYPES = ["item", "npc", "quest", "object"];
/**
 * GET /api/tooltip/{type}/{id}: what a hover card for one page needs, for the embeddable script. Plain text
 * only (no markup). `gameData` is present when the card shows the game's icon or tooltip text.
 */
export const tooltipResponse = z.object({
    ok: z.literal(true),
    type: z.enum(TOOLTIP_TYPES),
    id: z.number().int().positive(),
    title: z.string().describe("The agreed name, or \"Item 123\" style when no name has 3 installs behind it."),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().describe("Title colour (item quality), or null."),
    icon: z.string().url().nullable().describe("An icon from the game files asset folder, or null."),
    lines: z.array(z.string()).describe("The card's lines, in order. A value the game files do not give is shown as [?]."),
    partial: z.boolean().describe("A line holds a [?] for a value the game files do not give yet."),
    url: z.string().url().describe("The page this card is for."),
    attribution: attributionSchema,
    gameData: gameDataNoticeSchema.nullable(),
});
/** One accepted or rejected row in an intake receipt, by its index in the request. */
const receiptEntry = z.object({ index: z.number().int(), kind: z.string().optional(), reason: z.string().optional() });
/** POST /api/intake, 200: stored. */
export const intakeReceipt = z.object({
    ok: z.literal(true),
    persisted: z.literal(true),
    uploadId: z.string().uuid(),
    accepted: z.array(receiptEntry),
    rejected: z.array(receiptEntry),
}).passthrough();
/** POST /api/intake, 4xx or 503: refused; `accepted` and `rejected` say why when the envelope parsed. */
export const intakeRefused = z.object({
    ok: z.literal(false),
    error: z.string().optional(),
    persisted: z.literal(false).optional(),
    uploadId: z.string().uuid().optional(),
    accepted: z.array(receiptEntry).optional(),
    rejected: z.array(receiptEntry).optional(),
});
/** POST /api/intake request body: the envelope, with the sharing choices and grants the upload page adds. */
export const intakeRequest = z.object({
    addonVersion: z.string().min(1).max(20),
    clientBuild: z.string().optional(),
    protocol: z.string().optional(),
    records: z.array(anyRecord).min(1).max(2000),
    sharing: z.record(z.string(), z.boolean()).optional().describe("Named categories the player chose to share: guild, gear, gold, collection."),
    grantTokens: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(4).optional(),
});
/** GET /api/health: 200 when the public snapshot is fresh, 503 otherwise. */
export const healthResponse = z.object({
    ok: z.boolean(),
    snapshot: z.object({
        status: z.enum(["fresh", "stale", "missing", "unavailable", "local"]),
        updatedAt: ISO_TIME.nullable(),
        ageSeconds: z.number().nonnegative().nullable(),
    }),
});
/** One boss kill a guild owns: reported by 2 of its members' installs, or published by its officers. Guild and boss, never a person. */
const guildKillRow = z.object({
    guildName: z.string(),
    realm: z.string(),
    faction: z.enum(["alliance", "horde"]).nullable().describe("Null when only the officers' board, which carries no faction, reports the kill."),
    encounterId: z.number().int().positive(),
    name: z.string().describe("The encounter's name as most reports gave it."),
    instanceMapId: z.number().int().positive(),
    difficulty: z.number().int().nonnegative().nullable().describe("The difficulty id most reports gave; null when none did or only the officers published the kill."),
    killedAt: z.string().describe("The earliest agreeing report, ISO; empty when only the officers published the kill."),
    installs: z.number().int().nonnegative().describe("Distinct member installs that reported it; 0 for an officers' publication."),
    source: z.enum(["members", "officers"]),
});
/** guild-kills.ndjson of the bulk export: the agreed guild kills, oldest first. */
export const guildKillsResponse = z.object({
    generatedAt: ISO_TIME,
    dataAsOf: ISO_TIME.nullable(),
    kills: z.array(guildKillRow),
    attribution: attributionSchema,
});
/** One guild the site knows, with the sources that know it named. No member names. */
const guildDirectoryRow = z.object({
    guildName: z.string(),
    realm: z.string(),
    faction: z.enum(["alliance", "horde"]).nullable(),
    membersSeen: z.number().int().nonnegative().nullable().describe("Characters the addon saw in the guild; null when the export did not read the player pages, which is not zero."),
    membersPublished: z.number().int().nonnegative().nullable().describe("The officer roster's size when published."),
    kills: z.number().int().nonnegative(),
    latestKillAt: z.string().nullable(),
    lastSeen: z.string().nullable().describe("The newest day a member was seen, YYYY-MM-DD; null without player rows."),
    sources: z.array(z.enum(["kills", "seen", "officers"])),
});
/** guilds.ndjson of the bulk export: the guild directory, newest kill first. */
export const guildsResponse = z.object({
    generatedAt: ISO_TIME,
    dataAsOf: ISO_TIME.nullable(),
    guilds: z.array(guildDirectoryRow),
    attribution: attributionSchema,
});
/** The response schemas by name, the names schema/api/<name>.json uses. */
/** The datasets the bulk export writes, one NDJSON file each; the rows are the same the JSON API serves. */
export const BULK_DATASETS = ["corpus", "edges", "drops", "items", "guilds"];
/** One file of a bulk export: a newline-delimited JSON file whose rows are the `rowsOf` response's `field` elements. */
export const bulkFile = z.object({
    name: z.string().describe("File name inside the export folder, for example edges.ndjson."),
    dataset: z.enum(BULK_DATASETS),
    format: z.literal("ndjson").describe("One JSON object per line."),
    rowsOf: z.string().describe("The API response schema whose array these rows are, for example edgesResponse; its JSON Schema is at /schema/api/<rowsOf>.json."),
    field: z.string().describe("The array field of that response the rows come from, for example edges."),
    rows: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    data: z.enum(["observed", "game-files", "mixed"]).describe("observed: Everloot's data under its licence; game-files: Blizzard's, with the gameData notice; mixed: both, each row labelled by evidence."),
    attribution: attributionSchema.nullable().describe("Present when the file holds observed rows."),
    gameData: gameDataNoticeSchema.nullable().describe("Present when the file holds game-file rows."),
});
/** index.json of a bulk export folder: what the folder holds, when the data was current, how to credit it. */
export const bulkIndex = z.object({
    protocol: z.string().describe("The protocol version the rows follow."),
    generatedAt: ISO_TIME,
    dataAsOf: ISO_TIME.nullable().describe("When the uploads behind the observed rows were current; null when storage was unreachable, then those files are absent, not empty."),
    build: z.string().nullable().describe("Game build of the game-file rows."),
    site: z.string(),
    licence: z.string(),
    licenceUrl: z.string(),
    credit: z.string(),
    files: z.array(bulkFile),
});
const DELTA_IDS = z.array(z.number().int()).describe("Ids sorted ascending and delta-encoded: the first entry is the id, each later one the gap to the id before it, so [3, 4, 1] is 3, 7, 8.");
/** Ids each with the maps (or instances) they are settled on, both delta-encoded; `maps[i]` belongs to `ids[i]`. */
const ID_MAPS = z.object({ ids: DELTA_IDS, maps: z.array(DELTA_IDS).describe("One delta-encoded list per id, in the same order as ids.") });
/**
 * GET /api/coverage/settled: the facts that are settled for one client build (five installs agree, no other report
 * for 14 days), at the grain of an upload row, so an uploader can leave out the rows that would only repeat them.
 * Ids only, never values; everything in it is a fact the site already shows.
 */
export const settledListResponse = z.object({
    schema: z.literal("everloot.settled/1"),
    build: z.string().describe("The client build the list is for, such as 1.60.1.70450."),
    dataAsOf: ISO_TIME.nullable().describe("The corpus time the list was made from; null for a build the server has not looked at yet, whose list is empty so nothing is skipped."),
    npc_sighting: ID_MAPS.describe("NPC ids whose name and traits are settled, each with the maps whose pin is settled."),
    quest: DELTA_IDS.describe("Quest ids with every reported field settled."),
    vendor: DELTA_IDS.describe("Vendor NPC ids whose every offer is settled."),
    loot: z.object({ npc: DELTA_IDS, obj: DELTA_IDS }).describe("Sources whose loot is settled: enough loot windows and a settled rate for every common item."),
    instance_entrance: ID_MAPS.describe("Instance map ids with the outdoor maps whose entrance is settled."),
    encounter: ID_MAPS.describe("Encounter ids with the instance map ids they are settled in."),
    object_sighting: ID_MAPS.describe("Object ids with the maps where every treasure cluster and its name are settled."),
});
export const API_SCHEMAS = {
    attribution: attributionSchema,
    gameDataNotice: gameDataNoticeSchema,
    apiError: apiErrorSchema,
    page: pageSchema,
    corpusPublicResponse,
    marketRealmsResponse,
    marketPricesResponse,
    dropsResponse,
    edgesResponse,
    itemsResponse,
    itemCategoriesResponse,
    toolAnswerResponse,
    tooltipResponse,
    bulkIndex,
    settledListResponse,
    guildKillsResponse,
    guildsResponse,
    intakeRequest,
    intakeReceipt,
    intakeRefused,
    healthResponse,
};
const PAGING = [
    { name: "offset", description: "First row to return, 0 or more.", schema: { type: "integer", minimum: 0 } },
    { name: "limit", description: "Rows per page: at most 500 without an API key, 5,000 with one.", schema: { type: "integer", minimum: 1 } },
];
const ERROR_RESPONSES = {
    "400": { description: "A parameter is wrong; `error` says which.", schema: "apiError" },
    "429": { description: "Rate limited. `Retry-After` says when to try again.", schema: "apiError" },
    "503": { description: "A dependency is unavailable. The answer is unrecorded, not zero.", schema: "apiError" },
};
/** The public JSON endpoints, in the order the documentation lists them. Auth and cron routes are not public API. */
export const API_ROUTES = [
    {
        method: "GET", path: "/api/corpus/public",
        summary: "The public corpus: every public record players reported, without install ids",
        description: "Anonymous observations as records, so anyone can check the counts behind a published fact. `kinds` narrows the body to the record kinds a reader needs. Named records appear only when their owner shares them with a verified sharing grant.",
        access: "key-or-rate-limited", data: "observed", paged: true,
        query: [
            { name: "kinds", description: "Comma-separated record kinds to include. Unknown kinds are a 400.", schema: { type: "string", examples: ["loot,vendor"] } },
            ...PAGING,
        ],
        responses: { "200": { description: "The page of records.", schema: "corpusPublicResponse" }, ...ERROR_RESPONSES },
    },
    {
        method: "GET", path: "/api/rollups/drops",
        summary: "Corroborated drop rates with loot-window counts",
        description: "A rate is public once three installs looted its source. Rates come first, then sources looted with nothing in their windows (measured zeros). `kills` counts loot windows players opened, not kills.",
        access: "key-or-rate-limited", data: "observed", paged: true,
        query: PAGING,
        responses: { "200": { description: "The page of rates and zeros.", schema: "dropsResponse" }, ...ERROR_RESPONSES },
    },
    {
        method: "GET", path: "/api/edges",
        summary: "Typed relations between items, NPCs, spells, quests, zones and sets",
        description: "Observed edges (dropped by, sold by, reward from, located in) come first and carry install counts; game-file edges (created by, reagent for, part of set, same icon) follow and carry the build. With no filter the whole table pages like the corpus.",
        access: "key-or-rate-limited", data: "mixed", paged: true,
        query: [
            { name: "from_kind", description: "Kind of the entity the edge starts from.", schema: { type: "string", enum: [...ENTITY_KINDS] } },
            { name: "from_id", description: "The game's id of that entity.", schema: { type: "integer", minimum: 1 } },
            { name: "to_kind", description: "Kind of the entity the edge points to.", schema: { type: "string", enum: [...ENTITY_KINDS] } },
            { name: "to_id", description: "The game's id of that entity.", schema: { type: "integer", minimum: 1 } },
            { name: "rel", description: "Only this relation.", schema: { type: "string", enum: [...RELS] } },
            { name: "evidence", description: "observed (players) or client (game files).", schema: { type: "string", enum: ["observed", "client"] } },
            ...PAGING,
        ],
        responses: { "200": { description: "The page of edges.", schema: "edgesResponse" }, ...ERROR_RESPONSES },
    },
    {
        method: "GET", path: "/api/edges/client-layer",
        summary: "The whole game-file relation layer of the current build",
        description: "The game-file relations of the current build as one object: Blizzard's data, found in game files, unconfirmed. Public in the repository too, so it is neither paged nor limited. Cached for an hour.",
        access: "open", data: "game-files",
        responses: { "200": { description: "The client layer file." } },
    },
    {
        method: "GET", path: "/api/items",
        summary: "Every item of the current build with its class, subclass, slot and quality",
        description: "From the game files. Filters by one item id, or by class and subclass slugs, slot and quality. Ids only: item names come from player uploads.",
        access: "key-or-rate-limited", data: "game-files", paged: true,
        query: [
            { name: "item", description: "One item id.", schema: { type: "integer", minimum: 1 } },
            { name: "class", description: "Class slug, such as weapon or armor.", schema: { type: "string" } },
            { name: "subclass", description: "Subclass slug or number within the class. Needs class.", schema: { type: "string" } },
            { name: "slot", description: "Slot slug, such as head or trinket.", schema: { type: "string" } },
            { name: "quality", description: "Quality slug.", schema: { type: "string", enum: ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"] } },
            ...PAGING,
        ],
        responses: { "200": { description: "The page of items.", schema: "itemsResponse" }, ...ERROR_RESPONSES },
    },
    {
        method: "GET", path: "/api/items/categories",
        summary: "The item class and subclass tree of the current build, with the slot and quality slugs",
        description: "Every class with its subclasses, each with the slug `/api/items` takes and the number of items in the build, plus the slot and quality slugs. From the game files. Public in the repository too, so it is neither paged nor limited. Cached for an hour.",
        access: "open", data: "game-files",
        responses: { "200": { description: "The tree.", schema: "itemCategoriesResponse" } },
    },
    {
        method: "GET", path: "/api/coverage/settled",
        summary: "The facts that are settled for one client build, so an uploader can skip repeating them",
        description: "Per upload row kind, the ids whose facts are settled (five installs agree and no other value was reported for 14 days), sorted and delta-encoded. Only facts the site already shows are in it, and never their values. The Desktop App and the upload page leave those rows out of an upload. A build the server has not looked at yet gets an empty list, so nothing is skipped on a new patch. `ETag` and `If-None-Match` let a client revalidate its copy for nothing; a 304 has no body. Cached for ten minutes.",
        access: "open", data: "observed",
        query: [{ name: "build", description: "The client build, such as 1.60.1.70450.", schema: { type: "string", pattern: "^\\d+(\\.\\d+)+$", maxLength: 32, examples: ["1.60.1.70450"] }, required: true }],
        responses: {
            "200": { description: "The settled list.", schema: "settledListResponse" },
            "304": { description: "The copy you sent in `If-None-Match` is current." },
            "400": { description: "`build` is missing or is not a client build.", schema: "apiError" },
            "503": { description: "Storage is unreachable. Keep the list you have and retry later; an unrecorded list is not an empty one.", schema: "apiError" },
        },
    },
    {
        method: "GET", path: "/api/market/prices",
        summary: "Forever market values from full auction scans players started",
        description: "Without `realm`, the realms that have public values (and, in `houses`, which auction houses have values of their own). With it, the items with the most units listed on that realm as tuples in `fields` order, copper per unit. Without `house` the values blend every house of the realm; with it, only scans that named that house count. A day is public when three reporters scanned the item on that realm.",
        access: "rate-limited", data: "observed",
        query: [
            { name: "realm", description: "Realm name. Omit it to list realms.", schema: { type: "string", minLength: 2, maxLength: 40 } },
            { name: "house", description: "Alliance, Horde or Neutral (any case). Needs realm.", schema: { type: "string", enum: ["alliance", "horde", "neutral"] } },
        ],
        responses: {
            "200": { description: "Realms when `realm` is absent (marketRealmsResponse), prices when present.", schema: "marketPricesResponse" },
            ...ERROR_RESPONSES,
        },
    },
    {
        method: "POST", path: "/api/intake",
        summary: "Upload records from an Everloot SavedVariables file",
        description: "One envelope of at most 2,000 records and 1 MB. Every record is checked against its kind's schema; the receipt lists what was accepted and what was rejected and why. Named categories need the matching sharing choice and a verified grant. Anonymous, keyed by a random install id; quotas per request and per install.",
        access: "rate-limited", data: "none",
        requestBody: "intakeRequest",
        responses: {
            "200": { description: "Stored.", schema: "intakeReceipt" },
            "400": { description: "The body is not JSON, or the grants are malformed.", schema: "intakeRefused" },
            "413": { description: "The body is over 1 MB.", schema: "intakeRefused" },
            "422": { description: "The envelope or every record was refused; the receipt says why.", schema: "intakeRefused" },
            "429": { description: "Rate limited; keep the file and retry after `Retry-After`.", schema: "intakeRefused" },
            "503": { description: "Storage could not confirm the write; keep the file and retry.", schema: "intakeRefused" },
        },
    },
    {
        method: "GET", path: "/api/tools/{tool}",
        summary: "One MCP tool's answer over plain HTTP",
        description: "Every tool of the MCP server, callable with a GET: the tool's arguments go in the query string (numbers and booleans as plain text), named and typed as in /schema/mcp/{tool}.json. The answer is the tool's structured content, with the same text an MCP client gets. A wrong argument is a 400 that says which; an unknown tool is a 404 that lists the tools. Answers built on player uploads say how old the data is and carry the credit line; game-file answers are labelled unconfirmed with their build.",
        access: "key-or-rate-limited", data: "mixed",
        pathParams: [{ name: "tool", description: "A tool name from the MCP tool list.", schema: { type: "string", enum: [...MCP_TOOL_NAMES] }, required: true }],
        responses: {
            "200": { description: "The tool's answer.", schema: "toolAnswerResponse" },
            "404": { description: "No such tool; `error` lists them.", schema: "apiError" },
            ...ERROR_RESPONSES,
        },
    },
    {
        method: "GET", path: "/api/tooltip/{type}/{id}",
        summary: "The hover card for one item, NPC, quest or object page, for the embeddable tooltip script",
        description: "What `https://everloot.app/tooltips.js` shows when a visitor hovers a link to an Everloot page: title, icon and lines as plain text, the page URL, and the licence. One entity per request, not a bulk feed. Open to any website (CORS `*`, GET only) and cached by the CDN for an hour. Only things players reported (3 installs) are answered; the item card adds the game files' tooltip text and icon, labelled unconfirmed with their build. Anything else is a 404.",
        access: "open", data: "mixed",
        pathParams: [
            { name: "type", description: "item, npc, quest or object.", schema: { type: "string", enum: [...TOOLTIP_TYPES] }, required: true },
            { name: "id", description: "The game's id, a positive whole number.", schema: { type: "integer", minimum: 1 }, required: true },
        ],
        responses: {
            "200": { description: "The card.", schema: "tooltipResponse" },
            "404": { description: "Unknown type, bad id, or nothing players have reported about it.", schema: "apiError" },
            "503": { description: "Storage is unavailable. The answer is unrecorded, not empty.", schema: "apiError" },
        },
    },
    {
        method: "GET", path: "/api/health",
        summary: "Whether the public snapshot is fresh",
        description: "200 when the corpus snapshot was written recently, 503 otherwise. Metadata only.",
        access: "open", data: "none",
        responses: { "200": { description: "Fresh.", schema: "healthResponse" }, "503": { description: "Stale, missing or unavailable.", schema: "healthResponse" } },
    },
];
