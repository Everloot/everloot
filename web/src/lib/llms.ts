import { BULK_URL, CORPUS_URL, liveMcpTools, MCP_PROMPTS, MCP_RESOURCE_TEMPLATES, MCP_RESOURCES, MCP_URL, REQUESTS_PER_HOUR } from "@/lib/docs/connect-data";
import { DOCS_TABS } from "@/lib/docs/nav";
import { LAUNCH, longDate } from "@/data/wow-forever";
import { tools, toolHref } from "@/data/tools";
import { PUBLIC_RECORD_KINDS } from "@everloot/protocol";
import { latestBuildLine } from "@/lib/changes-facts";
import { loadTimeline, type ChangeEntry } from "@/lib/changes";
import { NON_AFFILIATION, OPERATOR_LINE } from "@/lib/jsonld";
import { ANON_PAGE, ANON_PER_HOUR, guardOn } from "@/lib/data-guard";
import { CREDIT_LINE } from "@everloot/protocol";
import { SITE_URL } from "@/lib/seo";
import { TALENT_CLASSES } from "@/lib/talents/catalogs";
import { RANKINGS, rankingPath } from "@/lib/rankings";

/**
 * /llms.txt and /llms-full.txt are generated here from the same lists the site reads (the tool catalog, the MCP
 * tool list, the changes timeline), so a new tool or a new MCP tool shows up without anyone editing a text file.
 */

const url = (path: string) => `${SITE_URL}${path}`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Pages that are not catalog tools but belong in the map of the site. */
const PAGES: { title: string; path: string; text: string }[] = [
  { title: "What is WoW: Forever", path: "/wow-forever", text: "The launch date quoted from Blizzard's announcement with its source and the date it was checked, and the latest game build Everloot has seen." },
  { title: "Census", path: "/census", text: "Who plays what: factions, races, classes, race and class, and level bands, from players who turned the census on. Each character counts once; a count shows from 10 characters reported by 3 installs, rounded to the nearest 5." },
  { title: "Rankings", path: "/rankings", text: "WoW: Forever week by week from the census: the top classes, races and the faction balance, each with its change against last week." },
  ...RANKINGS.map((r) => ({ title: `Rankings: ${r.title}`, path: rankingPath(r.slug), text: `${r.lede} Ranked by census counts under the same rule, with a weekly chart.` })),
  { title: "Everloot news", path: "/news", text: "What is new on Everloot and what it means for players, in Everloot's own words, newest first. Blizzard's own posts are on /changes." },
  { title: "Patch notes and Blizzard posts", path: "/changes", text: "New game builds, hotfixes and Blizzard blue posts, newest first, with links to Blizzard's originals. A build's date is when Everloot first saw it." },
  { title: "World map", path: "/map", text: "Zones, dungeon and raid entrances, flight masters and flight paths read from the game files (found in game files, unconfirmed), and NPCs players saw." },
  { title: "Addons", path: "/addons", text: "Addons and tools made for WoW: Forever, ranked by GitHub stars, as a leaderboard or cards." },
  { title: "Upload addon data", path: "/upload", text: "Download the Everloot addon (AGPL-3.0) and upload what it collected, with a preview and explicit sharing choices." },
  { title: "Addon and Desktop App downloads", path: "/addon", text: "The Everloot addon and the optional Desktop App for Windows, macOS and Linux, with versions, file sizes and SHA-256 checksums." },
  { title: "Lore archive", path: "/lore", text: "Warcraft Wiki pages as of 13 November 2023, CC BY-SA 4.0. Lore and history, not WoW: Forever data." },
  { title: "Docs", path: "/docs", text: "Guides for players, and the API reference, MCP server, tooltips and cookbook for developers." },
  { title: "How we count", path: "/methodology", text: "How addon uploads become facts: three installs must agree, unrecorded is not zero, and what is never published." },
  { title: "About", path: "/about", text: "What Everloot is and is not." },
  { title: "Privacy", path: "/privacy", text: "How uploads, cookies and usage statistics are handled." },
  { title: "Terms of use", path: "/terms", text: "Uploads, API keys, licences, trademarks, takedown requests and warranty." },
  { title: "Security", path: "/security", text: "How to report a security problem privately, and what is in scope." },
  { title: "Accessibility", path: "/accessibility", text: "What the site aims for, what is in place, what has been checked and what has not, and how to report a problem." },
];

const LIMITATIONS = [
  "Everloot is a fan project. " + NON_AFFILIATION,
  "Data read from the game files is Blizzard's, not under Everloot's licence, and is labelled found in game files, unconfirmed until seen in play.",
  "A build's date on /changes is when Everloot first saw it, not when Blizzard shipped it.",
  "The level the second talent set unlocks (40) comes from the beta notes, not from the game files, and is unconfirmed.",
  "Public database facts appear only when enough install reports agree. Distinct addon install IDs are not proof of independent people.",
  "Loot-window observations are not verified kills and are not kill-based drop probabilities.",
  "No actual beta-client collection trial has been verified yet. Empty storage and unavailable storage are different states.",
  "No number, name or position is invented for an unknown entity. Farming routes and respawn optimization are planned, not built.",
  "The lore archive is a 2023 Warcraft Wiki snapshot and predates WoW: Forever.",
];

const bullet = (title: string, path: string, text: string) => `- [${title}](${url(path)}): ${text}`;

/** The paging and key sentence for the corpus API; it names limits only once the data guard is on. */
function corpusAccess(): string {
  return guardOn()
    ? `Pages with ?offset= and ?limit=. Without a key: ${ANON_PER_HOUR} requests per hour per IP, ${ANON_PAGE} records a page; a free key (${url("/docs/api/keys")}) lifts both.`
    : "Optional ?offset= and ?limit= page it.";
}

/** Catalog tools by status. A page already described in PAGES, or listed twice in the catalog, appears once. */
function toolLines(): { live: string[]; collecting: string[] } {
  const seen = new Set(PAGES.map((p) => p.path));
  const lines = (status: "live" | "collecting") =>
    tools
      .filter((t) => t.status === status)
      .filter((t) => !seen.has(toolHref(t)) && seen.add(toolHref(t)))
      .map((t) => bullet(t.title, toolHref(t), t.tagline));
  const live = lines("live");
  return { live, collecting: lines("collecting") };
}

function head(): string[] {
  return [
    "# Everloot",
    "",
    "> Free tools and a database for WoW: Forever (World of Warcraft: Forever). Talent calculator, raid buff planner, world map, patch notes and Blizzard posts, and a database built from player addon uploads. Public data is sparse and depends on corroborated reports.",
    "",
    `${OPERATOR_LINE} ${NON_AFFILIATION}`,
    "",
  ];
}

/** The page addresses to cite, and the credit line Everloot's own data asks for. */
function linking(): string[] {
  return [
    "## Linking to Everloot",
    "Cite the Everloot page an answer comes from. Every MCP tool answer that has one ends with a line \"More: <url>\" naming it.",
    `- Item: ${url("/database/items/{itemId}")}`,
    `- NPC: ${url("/database/npcs/{npcId}")}`,
    `- Quest: ${url("/database/quests/{questId}")}`,
    `- Object (chest, herb, ore vein, fishing pool): ${url("/database/objects/{objectId}")}`,
    `- Vendor: ${url("/database/vendors/{npcId}")}`,
    `- Zone: ${url("/database/zones/{mapId}-{zone-name}")}, for example ${url("/database/zones/1436-westfall")}`,
    `- Item category: ${url("/database/items/{class}/{subclass}")}, for example ${url("/database/items/trade-goods/cloth")}`,
    `- Talent calculator: ${url("/tools/talents/{class}")}, for example ${url("/tools/talents/mage")}`,
    `- MCP server card: ${url("/.well-known/mcp/server-card.json")} (the registry's server.json)`,
    `Credit line for Everloot's own data: ${CREDIT_LINE}`,
    "",
  ];
}

/** The map both files share: llms-full.txt holds all of it, so it is a superset of llms.txt. */
function sharedMap(): string[] {
  const { live, collecting } = toolLines();
  return [
    "## Tools",
    ...live,
    "",
    "## Collecting data (pages are live, public facts open as reports arrive)",
    ...collecting,
    "",
    "## Pages",
    ...PAGES.map((p) => bullet(p.title, p.path, p.text)),
    `- Talent calculator per class: ${TALENT_CLASSES.map((c) => `[${cap(c)}](${url(`/tools/talents/${c}`)})`).join(", ")}.`,
    "",
    ...linking(),
    ...connect(),
    ...docs(),
    ...limitations(),
  ];
}

const CLOSING = "Code AGPL-3.0, Everloot's own data CC BY-SA 4.0.";

function connect(): string[] {
  return [
    "## For AI assistants and developers",
    `- [MCP server](${MCP_URL}): the way for an AI assistant to answer a question from Everloot's data. Read-only, no sign-in, ${REQUESTS_PER_HOUR} requests per hour per IP. ${liveMcpTools().length} tools: ${liveMcpTools().map((t) => t.name).join(", ")}. ${MCP_RESOURCES.length} resources, read whole: ${MCP_RESOURCES.map((r) => r.uri).join(", ")}. ${MCP_PROMPTS.length} prompts: ${MCP_PROMPTS.map((p) => p.name).join(", ")}.`,
    bullet("Public corpus API", "/api/corpus/public", `Raw anonymous addon observations in bulk, for developers building their own datasets; to answer a question, use the MCP server. Filter with ?kinds=${PUBLIC_RECORD_KINDS.slice(0, 2).join(",")}. ${corpusAccess()} Credit: ${CREDIT_LINE}`),
    bullet("Relations API", "/api/edges", "Typed relations between items, NPCs, spells, professions and quests (dropped by, sold by, created by, reagent for, set, same icon, profession), paged, filterable by entity, relation and evidence. Player-observed rows need 3 installs; game-file rows are labelled found in game files, unconfirmed, with their build, and are Blizzard's, not under our licence. The whole game-file layer: /api/edges/client-layer."),
    bullet("Objects", "/database/objects", "Chests, herbs, ore veins and fishing pools players looted, by the id in their GUID, with what came out of them; public after 3 install reports."),
    bullet("Items by category", "/database/items", "Every item in the current build by class and subclass, with slot and quality filters, from the game files (found in game files, unconfirmed). As JSON: /api/items and /api/items/categories."),
    ...(BULK_URL ? [`- [Bulk export](${BULK_URL}/latest.json): the published data as files, one NDJSON file per dataset (corpus, drops, edges, items) with an index.json naming each file's rows, size, SHA-256, licence and the API response shape its rows follow. For the whole dataset, take this instead of paging the APIs.`] : []),
    bullet("Embeddable tooltips", "/tooltips.js", "A script other sites load so links to Everloot item, NPC, quest and object pages show a hover card. Data from /api/tooltip/<type>/<id>."),
    bullet("OpenAPI document", "/api/openapi.json", "OpenAPI 3.1 for every JSON endpoint, assembled from the same protocol the routes are tested against."),
    bullet("JSON Schema", "/schema/index.json", "The protocol: one JSON Schema per upload record kind, the API response shapes (/schema/api/<name>.json) and the MCP tool inputs (/schema/mcp/<tool>.json)."),
    bullet("MCP docs", "/docs/mcp", "Setup for Claude Code and other MCP clients, and a page for every tool, with examples."),
    bullet("API reference", "/docs/api", "Every endpoint with its parameters, answers and examples."),
    bullet("Changes feed (RSS)", "/changes/feed.xml", "The newest 50 WoW: Forever builds and Blizzard posts."),
    bullet("News feed (RSS)", "/news/feed.xml", "Everloot's own news posts, newest first."),
    "",
  ];
}

function limitations(): string[] {
  return ["## Data limitations", ...LIMITATIONS.map((l) => `- ${l}`), ""];
}

/** Every docs page, by tab, in reading order. */
function docs(): string[] {
  return ["## Docs", ...DOCS_TABS.flatMap((tab) => tab.groups.flatMap((group) => group.pages.map((page) => bullet(`${tab.label}: ${page.title}`, page.href, page.lede)))), ""];
}

/** The heading and line of llms.txt that point at the full file; the full file leaves them out. */
export const FULL_VERSION = ["## Full version", bullet("llms-full.txt", "/llms-full.txt", "Everything in this file, plus what Everloot is, the launch date, the latest build, every MCP tool described and the licences.")];

export function llmsTxt(): string {
  return [
    ...head(),
    ...sharedMap(),
    ...FULL_VERSION,
    "",
    CLOSING,
    "",
  ].join("\n");
}

export async function llmsFullTxt(entries?: ChangeEntry[]): Promise<string> {
  entries ??= await loadTimeline();
  return [
    ...head(),
    `Site: ${SITE_URL}`,
    "",
    "## What Everloot is",
    "Everloot follows WoW: Forever. It publishes tools built on the game files, tracks Blizzard's posts and builds, and runs a database of observations that players upload with the Everloot addon.",
    "",
    "## Launch date",
    `Blizzard's announcement says: "${LAUNCH.quote}". Source: ${LAUNCH.sourceName}, ${LAUNCH.sourceTitle}, ${LAUNCH.sourceUrl}. Checked on ${longDate(LAUNCH.checkedOn)}. See ${url("/wow-forever")}.`,
    "",
    "## Latest build",
    latestBuildLine(entries),
    "",
    ...sharedMap(),
    "## MCP server",
    `Endpoint: ${MCP_URL} (streamable HTTP, read-only, no sign-in, ${REQUESTS_PER_HOUR} requests per hour per IP). Tools:`,
    ...liveMcpTools().map((t) => `- ${t.name}: ${t.text}`),
    "Resources (read whole with resources/read):",
    ...MCP_RESOURCES.map((r) => `- ${r.uri}: ${r.text}`),
    "Resource templates (one URI per entity, the same JSON as the tool's structured answer):",
    ...MCP_RESOURCE_TEMPLATES.map((t) => `- ${t.uriTemplate}: ${t.text}`),
    "Prompts (prompts/get, arguments are strings):",
    ...MCP_PROMPTS.map((p) => `- ${p.name}: ${p.text}`),
    "",
    "## Public corpus API",
    `GET ${CORPUS_URL}. Raw records in bulk; for answering questions the MCP server above is the right tool. Optional ?kinds= takes a comma-separated list of: ${PUBLIC_RECORD_KINDS.join(", ")}. Records carry a per-install pseudonym (pub- and 32 hex) in place of the install id, so installs can be counted. ${corpusAccess()} Each response carries the licence and credit line in an attribution field and in X-Everloot-Licence, X-Everloot-Credit and Link headers. Credit: ${CREDIT_LINE}`,
    "",
    "## Relations API",
    `GET ${url("/api/edges")}. One row per relation: fromKind, fromId, rel, toKind, toId, evidence (observed or client), build, installs, firstSeen, lastSeen. Filters: from_kind, from_id, to_kind, to_id, rel, evidence; with none, the whole table pages like the corpus API. Observed rows follow the 3-install rule and carry ${CREDIT_LINE} Client rows are found in game files, unconfirmed, stamped with their build, and carry a gameData notice: Blizzard's data, not under Everloot's licence. ${url("/api/edges/client-layer")} returns the current build's whole game-file layer in one file.`,
    "",
    "## Items API",
    `GET ${url("/api/items")}: every item in the current build with its class, subclass, slot and quality, from the game files. Filters: item, class and subclass (slugs, as in ${url("/database/items")}), slot, quality; paged like the corpus API. ${url("/api/items/categories")} lists the class and subclass tree with slugs and counts. Found in game files, unconfirmed, stamped with the build; Blizzard's data, not under Everloot's licence, so these answers carry a gameData notice instead of the credit line.`,
    "",
    "## Tools over HTTP",
    `GET ${url("/api/tools/{tool}")}: every MCP tool above, callable without an MCP client. Arguments go in the query string, named and typed as in ${url("/schema/mcp/{tool}.json")} (for example ${url("/api/tools/item_page?itemId=19019")}). The answer field is the tool's structured content, text is the same answer in words. Same limits as the other JSON endpoints; a wrong argument is a 400 that says which.`,
    "",
    "## Embeddable tooltips",
    `<script src="${url("/tooltips.js")}" async></script> on any page turns links to everloot.app item, NPC, quest and object pages into hover cards, with no cookies and no tracking. GET ${url("/api/tooltip/{type}/{id}")} (type: item, npc, quest or object) is the card's data: one page per request, open to any website (CORS), cached for an hour. Facts follow the 3-install rule; game-file text is labelled unconfirmed with its build and is Blizzard's. The guide is ${url("/docs/tooltips")}.`,
    "",
    "## OpenAPI and schemas",
    `${url("/api/openapi.json")} describes every endpoint above (OpenAPI 3.1). ${url("/schema/index.json")} lists the protocol's JSON Schema files: records/<kind>.json for each upload record kind, api/<name>.json for each response shape, mcp/<tool>.json for each MCP tool's input. The same definitions are the npm package @everloot/protocol in the repository.`,
    "",
    "## Changes feed",
    `${url("/changes/feed.xml")} is RSS 2.0 with the newest 50 WoW: Forever entries.`,
    "",
    "## Licences",
    "- Code: AGPL-3.0. Source: https://github.com/Everloot/everloot",
    "- Everloot's own data and uploaded observations: CC BY-SA 4.0, credited to Everloot contributors.",
    "- Game-file data (talents, raid buffs, map, build changes): Blizzard's, not under Everloot's licence.",
    "- Lore archive: Warcraft Wiki contributors, CC BY-SA 4.0.",
    "",
    CLOSING,
    "",
  ].join("\n");
}
