import { liveToolNames } from "@/lib/guild-switch";
import { CREDIT_LINE, LICENCE, LICENCE_URL, MCP_PROMPT_NAMES, MCP_RESOURCE_TEMPLATE_LIST, MCP_RESOURCE_URIS, MCP_TOOL_NAMES, SITE, TERMS_URL, type McpPromptName, type McpResourceUri, type McpToolName } from "@everloot/protocol";

export const MCP_URL = `${SITE}/mcp/public`;
export const CORPUS_URL = `${SITE}/api/corpus/public`;
/** Where the bulk export is served from (scripts/upload-bulk.mjs), or null until the owner sets it. */
export const BULK_URL = process.env.NEXT_PUBLIC_BULK_URL?.replace(/\/+$/, "") || null;

/** The public MCP's per-IP limit per hour. connect.test.ts checks it against intake-quota.ts. */
export const REQUESTS_PER_HOUR = 200;

/** One plain sentence per tool for the page and llms.txt, keyed by name so a new tool in the protocol fails the type check here. */
const TOOL_TEXT: Record<McpToolName, string> = {
  coverage: "Database coverage: settled and confirmed field facts over expected counts, by zone, type and field, plus reported fields needing more installs.",
  search_knowledge: "Search lore and reference data. Every hit has its source and licence.",
  get_entity: "One record, by the id a search hit gives you.",
  get_by_name: "Records with exactly this name, for telling similar names apart.",
  search: "The same search in the shape ChatGPT connectors and deep research call by name: results with an id, a title and a URL to cite.",
  fetch: "One record by a search result's id, whole, with its URL and the source, licence and date as metadata. ChatGPT's second tool.",
  answer_sources: "The evidence behind a question, each piece with its source, licence and date, so an assistant can answer and cite.",
  profession_path: "A leveling path for one profession, from what players reported.",
  recipe_thresholds: "The skill ranges where a recipe turns yellow, green and grey.",
  item_page: "One item: agreed name, drop rate with kill count, map pin.",
  npc_page: "One NPC: agreed name and map pins.",
  object_page: "One game object (a chest, herb, ore vein or fishing pool): the items players looted from it, with loot windows and install counts.",
  quest_page: "One quest: title, level, giver, turn-in and rewards.",
  vendor_page: "What one vendor sells, with copper prices.",
  world_map_near: "What is near a spot: entrances, observed NPCs and vendors, with distances in yards.",
  entity_relations: "How an item, NPC, spell or quest connects to others: dropped by, sold by, created by, reagent for, set, same icon. Each relation says if players saw it (3 installs) or the game files hold it (unconfirmed, with the build).",
  item_categories: "Item classes, subclasses, slots and qualities from the game files, with item counts; one item's category path, or the items in a category. Found in game files, unconfirmed, with the build.",
  talent_tree: "One class's talent trees from the game files: every node with its talents, ranks, position, prerequisites and row gate. Found in game files, unconfirmed, with the build.",
  talent_plan: "Reads a talent share code or calculator link: the talents and ranks it holds, points per tree, the lowest level for it, and every problem in plain words.",
  class_races: "Which races can be a class, on which faction, with each race's racial traits (name, active or passive). Found in game files, unconfirmed, with the build.",
  collection_gap: "What one install is missing from a collection, such as Mounts.",
  completion_progress: "What one install's characters finished in achievements, reputation, titles and quest chains, and what is closest to done.",
  guild_board: "A guild's roster, bosses, loot and attendance, from officer uploads.",
  guild_search: "Guilds by the start of their name, with realm, members seen and agreed kills. Listed only while the guild pages are on.",
  guild_rankings: "The guild ladder for one raid or dungeon: bosses killed, then who got there first. Listed only while the guild pages are on.",
  auction_history: "Daily median auction price for one item on one realm.",
  market_value: "Market value, minimum buyout, historical value and units listed for one item on one realm, from full scans players started.",
  gold_ledger: "Peak gold and money events for one character, from that player's own upload.",
  population: "How many characters play each race, class, faction and level band, from players who turned the census on. Every answer says its window, and a count is hidden when too few players report it.",
  recent_changes: "Recent Blizzard staff posts, hotfixes and new game builds, newest first, with links to the originals.",
  ecosystem_projects: "Forever addons and open-source projects, ranked on five boards, with GitHub facts and install counts from 3 installs.",
  everloot_plan: "What is built, what is next and what is waiting. Read it before assuming a tool exists.",
};

/** Every tool in the protocol's table, in its order, each with its sentence. */
export const MCP_TOOLS: readonly { name: McpToolName; text: string }[] = MCP_TOOL_NAMES.map((name) => ({ name, text: TOOL_TEXT[name] }));

/** The tools the MCP server lists today: the guild ladder's two only while EVERLOOT_GUILDS is on. */
export function liveMcpTools(): readonly { name: McpToolName; text: string }[] {
  const live = liveToolNames();
  return MCP_TOOLS.filter((tool) => live.includes(tool.name));
}

/** One plain sentence per resource, keyed by URI so a new resource in the protocol fails the type check here. */
const RESOURCE_TEXT: Record<McpResourceUri, string> = {
  "everloot://builds": "The build the game-file facts come from, and every build Blizzard's version service has listed, with when Everloot first saw it. JSON.",
  "everloot://methodology": "How uploads become facts: three installs must agree, unrecorded is never zero, game files and play are kept apart, and what is never published. Markdown.",
  "everloot://data-policy": "The data policy in short: what is published, what is refused, the licence and credit line, and the limits on bulk copying. Markdown.",
};

/** Every resource the MCP server registers, in the protocol's order. A client reads one whole with resources/read. */
export const MCP_RESOURCES: readonly { uri: McpResourceUri; text: string }[] = MCP_RESOURCE_URIS.map((uri) => ({ uri, text: RESOURCE_TEXT[uri] }));

/** Every resource template, in the protocol's order: an entity URI that reads as the named tool's structured answer. */
export const MCP_RESOURCE_TEMPLATES: readonly { uriTemplate: string; text: string }[] = MCP_RESOURCE_TEMPLATE_LIST.map((t) => ({
  uriTemplate: t.uriTemplate,
  text: `${t.description} The same JSON as ${t.tool}'s structured answer.`,
}));

/** One plain sentence per prompt, keyed by name so a new prompt in the protocol fails the type check here. */
const PROMPT_TEXT: Record<McpPromptName, string> = {
  answer_with_sources: "Answer a question from answer_sources, citing every piece with its source, licence and date. Takes the question.",
  review_talent_plan: "Read a share code with talent_plan and the trees with talent_tree, then describe the build and every problem. Takes the code or a calculator link.",
  what_changed: "Summarize recent_changes newest first, with links and only the excerpts the tool gives. Takes forever or classic, or nothing for both.",
};

/** Every prompt the MCP server registers, in the protocol's order. A client offers them as commands and fills the arguments. */
export const MCP_PROMPTS: readonly { name: McpPromptName; text: string }[] = MCP_PROMPT_NAMES.map((name) => ({ name, text: PROMPT_TEXT[name] }));

const curlBody = JSON.stringify({
  jsonrpc: "2.0", id: 1, method: "tools/call",
  params: { name: "get_by_name", arguments: { name: "Thrall" } },
});

export const CONNECT_EXAMPLES = {
  claudeCode: `claude mcp add --transport http everloot ${MCP_URL}`,
  remoteConfig: JSON.stringify({ mcpServers: { everloot: { type: "http", url: MCP_URL } } }, null, 2),
  mcpCurl: `curl -s ${MCP_URL} \\
  -H "content-type: application/json" \\
  -H "accept: application/json, text/event-stream" \\
  -d '${curlBody}'`,
  localSite: `git clone https://github.com/Everloot/everloot.git
cd everloot
(cd kb && npm install)
cd web && npm install
npm run sample-release    # prints a KB_SNAPSHOT_PATH line
# put that line and EVERLOOT_MCP_PUBLIC=1 in web/.env.local
npm run dev               # MCP at http://localhost:3000/mcp/public`,
  stdioConfig: JSON.stringify({
    mcpServers: {
      everloot: {
        command: "node",
        args: [
          "/path/to/everloot/kb/node_modules/tsx/dist/cli.mjs",
          "/path/to/everloot/kb/src/cli.ts",
          "serve-mcp",
          "--db",
          "/path/to/everloot/web/.data/release/release.sqlite",
        ],
        env: { EVERLOOT_PUBLIC_CORPUS_URL: CORPUS_URL },
      },
    },
  }, null, 2),
  toolsCurl: `curl -s "${SITE}/api/tools/get_by_name?name=Thrall" | jq .answer`,
  tooltipScript: `<script src="${SITE}/tooltips.js" async></script>`,
  tooltipLink: `<a href="${SITE}/database/items/19019">Thunderfury</a>`,
  tooltipCurl: `curl -s ${SITE}/api/tooltip/item/19019 | jq '{title, lines}'`,
  corpusCurl: `curl -s "${CORPUS_URL}?kinds=loot,vendor"`,
  bulkCurl: `BASE=${BULK_URL ?? "https://data.everloot.app"}\n# latest.json names the newest export's index.json by a path relative to BASE\ncurl -s "$BASE/$(curl -s "$BASE/latest.json" | jq -r .index)"`,
  openapiCurl: `curl -s ${SITE}/api/openapi.json | jq '.paths | keys'`,
  pagingJs: `// Every loot record, page by page. Stop when next is null.
let url = "${CORPUS_URL}?kinds=loot&limit=500";
const records = [];
while (url) {
  const body = await (await fetch(url)).json();
  if (!body.ok) throw new Error(body.error);
  records.push(...body.records);
  url = body.next;
}
console.log(records.length, "loot windows as of", body.dataAsOf);
// Show the credit line wherever these appear: body.attribution.credit`,
  pagingPy: `import requests

url = "${CORPUS_URL}?kinds=vendor&limit=500"
records = []
while url:
    body = requests.get(url, timeout=30).json()
    if not body["ok"]:
        raise SystemExit(body["error"])
    records.extend(body["records"])
    url = body["next"]
print(len(records), "vendor lists; credit:", body["attribution"]["credit"])`,
  corpusShape: `{
  "ok": true,
  "uploads": 1,
  "records": [
    {
      "kind": "loot",
      "eventId": "example:1",
      "capturedAt": "2026-10-17T08:00:00.000Z",
      "sourceNpcId": 1234,
      "items": [{ "itemId": 5678, "count": 1 }]
    }
  ],
  "dataAsOf": "2026-10-17T08:50:28.003Z",
  "kinds": ["loot"],
  "offset": 0,
  "limit": 1,
  "total": 1,
  "next": null,
  "attribution": {
    "licence": "${LICENCE}",
    "licenceUrl": "${LICENCE_URL}",
    "credit": "${CREDIT_LINE}",
    "source": "${SITE}/database",
    "terms": "${TERMS_URL}"
  }
}`,
  credit: CREDIT_LINE,
} as const;
