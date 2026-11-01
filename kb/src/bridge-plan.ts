/**
 * One list of everything Everloot still has to ship.
 * docs/TRACKER.md is this function's output. A test fails if the file drifts.
 * The MCP tool `everloot_plan` returns the same text, so a connected client
 * sees the whole map and cannot quietly drop a row.
 */

export type PlanStatus = "live" | "next" | "waiting" | "shape";

/** The furthest a row is proven. Each step needs the one before it. */
export type Proof = "none" | "code" | "deployed" | "client" | "public" | "real-data";

export type PlanItem = {
  id: string;
  status: PlanStatus;
  name: string;
  /** What "done" means, or why this row is not a build. */
  done: string;
  /** Required on live and next rows. */
  proof?: Proof;
};

const PROOF_LABEL: Record<Proof, string> = {
  none: "not built",
  code: "code + tests",
  deployed: "on everloot.app",
  client: "beta client",
  public: "public client",
  "real-data": "real uploads",
};

export const BRIDGE_PLAN: readonly PlanItem[] = [
  { id: "mcp.search_knowledge", status: "live", name: "Search the knowledge base", done: "stdio tool on everloot-knowledge", proof: "code" },
  { id: "mcp.get_entity", status: "live", name: "Fetch one record by id", done: "stdio tool on everloot-knowledge", proof: "code" },
  { id: "mcp.get_by_name", status: "live", name: "Exact-name lookup", done: "stdio tool on everloot-knowledge", proof: "code" },
  { id: "mcp.everloot_plan", status: "live", name: "This tracker, as a tool", done: "a client can ask what is live, next, waiting, or shape-only", proof: "code" },
  { id: "mcp.http_local", status: "live", name: "Local HTTP MCP", done: "POST /mcp on 127.0.0.1. Same server as stdio. Not reachable by ChatGPT yet.", proof: "code" },
  { id: "site.home", status: "live", name: "Public home", done: "https://everloot.app", proof: "deployed" },
  { id: "site.upload", status: "live", name: "Upload + intake", done: "/upload and /api/intake. Persists when Supabase is connected.", proof: "deployed" },
  { id: "site.drops", status: "live", name: "Drop rollups", done: "public when 3 independent installs agree", proof: "deployed" },
  { id: "site.professions", status: "live", name: "Profession hubs", done: "hub pages exist. The leveling path is tool.profession_path.", proof: "deployed" },
  { id: "site.waitlist", status: "live", name: "Waitlist", done: "signup path exists. Persists when Supabase is connected.", proof: "deployed" },
  { id: "site.gap_marking", status: "live", name: "Unrecorded is not zero", done: "A missing fact reads unrecorded. A source 3 installs killed with no item dropped reads 0 drops in N kills. Guild item level names how many roster members were measured. A storage failure, an unset corpus source, and a guild-family row with no published count are not zeros. The profession form reads the server uploads.", proof: "deployed" },
  { id: "site.signin", status: "live", name: "Battle.net sign-in", done: "Sign in and Sign out on everloot.app. Hashed server sessions; logout revokes the session. Real login and logout verified 2026-10-08.", proof: "deployed" },
  { id: "ops.health", status: "live", name: "Snapshot health", done: "/api/health reports snapshot age from signed R2 metadata: fresh within 30 minutes, otherwise 503. Age is not proof of complete indexing.", proof: "deployed" },
  { id: "ops.quotas", status: "live", name: "Shared intake quotas", done: "Supabase counters: 20 uploads per install, 200 requests per IP and 10,000 globally per hour; the public MCP and market prices count against their own 5,000. Production fails closed. Install IDs still do not prove different people.", proof: "deployed" },
  { id: "site.sharing", status: "next", name: "Named sharing", done: "Guild, character and gold names publish only through an operator-verified, scoped grant; revoke and character opt-out are on /upload. Done when a real owner or officer issues, uses and revokes a grant.", proof: "deployed" },
  { id: "addon.skeleton", status: "next", name: "Collector addon", done: "TOC Interface 16001, SavedVariables, /upload import; the zip downloads from /upload. Done when it loads and collects in the Forever beta client per docs/2026-10-08-beta-client-checklist.md.", proof: "deployed" },

  { id: "mcp.public_https", status: "next", name: "Public HTTPS MCP", done: "The bearer-token handler answers at everloot.app/mcp in production since 2026-10-10. The build fetches the verified knowledge release from R2 (#26), and the official MCP SDK client listed 13 tools with sourced answers there. A public read-only mount at /mcp/public, rate-limited and without sign-in, is #31. Done when a public client such as ChatGPT connects on production.", proof: "deployed" },
  { id: "tool.profession_path", status: "next", name: "Profession leveling path", done: "Engine and MCP tool profession_path. A step needs 3 agreeing uploads: recipe_seen rows, or (addon 0.2.5) an orange-only step derived from recipe colours, starting at the trainer's required rank (trainer_seen) when 3 installs agree, at 1 point per craft. Gold needs 3 prices per reagent, from price reports or per-unit auction scans. Recipe ranges with reagents and cost per craft are the recipe_thresholds tool. Done when a derived step is confirmed orange in the Forever client. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected. Page: /tools/professions.", proof: "deployed" },
  { id: "tool.item_page", status: "next", name: "Item page for a drop row", done: "Page /database/items/[id] and MCP tool item_page. Name and map pin need 3 agreeing sightings. The rate is the public rollup. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected.", proof: "deployed" },
  { id: "tool.npc_page", status: "next", name: "NPC spawn page", done: "Page /database/npcs/[id] and MCP tool npc_page. A name or map pin needs 3 agreeing sightings. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected.", proof: "deployed" },
  { id: "site.database_icons", status: "next", name: "Icons on database pages", done: "Item pages show the icon of each spell that creates or uses the item (spellIcons now covers the client layer's relation spells) and the tooltip card for reported items; category pages show icons and game file names only for reported items; pet family icons (familyIcons) are in the manifest. Decided 2026-10-18 by the maintainer. Pages only; waits on the maintainer's upload and the asset URL setting (docs/ASSETS.md).", proof: "code" },
  { id: "tool.object_page", status: "next", name: "Object pages", done: "Kind object. Pages /database/objects and /database/objects/[id] and MCP tool object_page: chests, herbs, ore veins and fishing pools by the entry id in their GUID (sourceObjectId), with what players looted from them; a frequency is public after 3 install reports, a public object with empty windows reads as a measured zero. Item pages link each drop source. No names or positions yet: uploads carry neither, and the client's GameObjects table holds no lootable objects.", proof: "code" },
  { id: "tool.quest_page", status: "next", name: "Quest page", done: "Page /database/quests/[id] and MCP tool quest_page. Title, level, giver, turn-in, and a reward each need 3 agreeing uploads. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected.", proof: "deployed" },
  { id: "tool.vendor_page", status: "next", name: "Vendor page", done: "Page /database/vendors/[id] and MCP tool vendor_page. A price is public when 3 installs agree on the item and the copper. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected.", proof: "deployed" },
  { id: "tool.relations", status: "next", name: "Entity relations", done: "One edge table (kb/src/edges.ts): dropped by, sold by, reward from, located in from uploads (3 installs, with first and last seen), and created by, reagent for, part of set, same icon, profession (spell → skill line) from the committed client layer (found in game files, unconfirmed, with the build). Item pages list them grouped by relation; MCP tool entity_relations; /api/edges (paged) and /api/edges/client-layer. Reward from and located in stay empty until the addon sends quest records and NPC positions.", proof: "code" },
  { id: "tool.item_categories", status: "next", name: "Items by category", done: "Every item in the build by class and subclass (the client's English names, class labels and slugs in the plural as item databases list them, numeric ids as the key; the first singular URLs redirect), with slot and quality, from the committed client layer (found in game files, unconfirmed, with the build). Pages /database/items, /database/items/<class> and /database/items/<class>/<subclass> with slot, quality and page filters; a category path on each item page; MCP tool item_categories; /api/items and /api/items/categories.", proof: "code" },
  { id: "tool.collection", status: "next", name: "Missing-collection view", done: "Page /tools/collections and MCP tool collection_gap. A list item needs 3 installs agreeing on the collection, the source, and the item. Owned is that install's upload. Not a Blizzard profile read. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected.", proof: "deployed" },
  { id: "tool.completion", status: "next", name: "Completion tracker", done: "Addon 0.3.3 module (off until /everloot completion on) reads achievements, reputation, titles and completed quests with the game's own calls, in chunks, and never acts. Catalog rows (achievement_catalog, reputation_catalog, title_catalog, quest_chain_catalog) are anonymous game facts: an entry is listed when 3 installs report it identically. Owned rows are one character's progress under an opaque key and, like collection_owned, are served only with the collection sharing choice and a verified install grant. Page /tools/collections shows what is done and what is closest to done; MCP tool completion_progress. Not yet run in the Forever client: docs/2026-10-19-addon-0.3.3-beta-checklist.md settles it.", proof: "code" },
  { id: "tool.guild", status: "next", name: "Guild tracker", done: "Page /tools/guild-board and MCP tool guild_board. Roster, bosses, loot, and item level need 2 agreeing officer uploads. The average names how many roster members were measured. score_v1 has no published weights, so there is no single score. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected.", proof: "deployed" },
  { id: "tool.guild_census", status: "next", name: "Public guild-family page", done: "Citation page is /guilds/olympus. Each figure has its source and date. Battle.net guild profile answers for retail and Classic Era in the local adapter. Forever namespaces were refused on 2026-09-30. Done when that namespace fills the same table. Spec: guild system, census section.", proof: "deployed" },
  { id: "tool.auction", status: "next", name: "Auction history", done: "Page /tools/auctions and MCP tool auction_history. A day is public when 3 installs scanned that item on that realm. Intake accepts auction_scan. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected.", proof: "deployed" },
  { id: "tool.market", status: "next", name: "Forever market values", done: "Full auction scans a player starts with a click (addon 0.3.0, C_AuctionHouse.ReplicateItems) upload as auction_snapshot. The cron folds them into snapshots/market.json, outside the corpus. A realm/item day is public when 3 reporters (distinct upload addresses) scanned it; thin and outlier days stay out of the market value; market value weights 14 days, historical is the median of 60. Served by /api/market/prices, MCP tool market_value and /tools/auctions; the companion writes them into the EverlootPrices slot addon for tooltips. Spec: 2026-10-16-forever-market-design. Done when real Forever scans fill it.", proof: "code" },
  { id: "tool.gold_ledger", status: "next", name: "Gold ledger", done: "Page /tools/gold-ledger and MCP tool gold_ledger. The addon (0.2.4) stores gold_snapshot (current and peak) and money_event for loot copper, quest money rewards, sales at an open merchant, flight costs, auction sales taken from the mailbox (invoice type seller, matched to the money change, recorded as the sale minus the house cut; the buyer is not stored), postage for letters the server confirmed sent, and auction buyouts. The report names those and says bids, deposits, other mail, other spending, and gameplay are unrecorded. Installs are not merged. The difference is unrecorded, never bought and never a ban. With no corpus source set, the answer says uploads are not connected. Left: deposits (no category yet), other mail, and trade events, plus a trade note that only uses an uploaded ledger. The IRS addon is not copied. Gold-per-hour stays the calculator.", proof: "deployed" },
  { id: "tool.simc", status: "next", name: "SimulationCraft sidecar", done: "run the GPL-3.0 forever branch as its own process once it can sim. Report comes back through MCP. Do not paste the C++ into this repo.", proof: "none" },
  { id: "ops.stored_rollups", status: "live", name: "Corpus snapshot", done: "The Worker's Cron Trigger every 10 minutes extends snapshots/corpus.json in R2 with uploads it has not seen. Pages read that one object. ?rebuild=1 (with CRON_SECRET) rebuilds from empty after a deletion.", proof: "deployed" },
  { id: "app.uploader", status: "next", name: "Desktop uploader", done: "companion/ upload and watch send only unconfirmed events after logout, named data held on the machine; tested against a local server. Done when it runs against a real Forever WTF folder and ships as a signed build (ops.signing).", proof: "code" },
  { id: "app.companion", status: "next", name: "In-game companion", done: "File bridge: /ask stores the question; companion bridge answers from the MCP server into the EverlootAnswers addon, shown after /reload when its Adler-32 verifies. Providers enabled in config.json (Anthropic, or any OpenAI-compatible endpoint including a local model) answer from the top search results, falling back down the chain; with none enabled the answer is the top search result. Done when it works in the Forever client.", proof: "code" },
  { id: "mcp.chatgpt_directory", status: "next", name: "ChatGPT apps directory", done: "submit the same MCP server the day submissions open", proof: "none" },
  { id: "mcp.subscription_signin", status: "next", name: "Subscription sign-in", done: "ChatGPT or Claude subscription unlocks the companion. API keys stay the fallback.", proof: "none" },

  { id: "ops.dns", status: "live", name: "everloot.app DNS", done: "The apex and www records in Cloudflare are proxied, and the Worker routes everloot.app/* and www.everloot.app/* serve them; www answers a 301 to the apex.", proof: "deployed" },
  { id: "ops.worker_deploy", status: "live", name: "Worker deploys", done: "A push to main that touches web/, kb/ or packages/protocol, once the Release checks pass on it, builds the site with OpenNext and deploys the everloot-web Worker (.github/workflows/deploy-worker.yml), then fetches every sitemap page and fails on any that does not answer 200.", proof: "deployed" },
  { id: "ops.supabase", status: "live", name: "Supabase + R2 storage", done: "Intake writes the raw upload to R2 bucket everloot-uploads and one index row to Supabase everloot; the waitlist is a Supabase table. Pages read the indexed objects. Proven end to end on everloot.app 2026-10-04.", proof: "deployed" },
  { id: "ops.adsense", status: "waiting", name: "AdSense", done: "Carlos's account. Consent banner already on the site." },
  { id: "ops.beta_guild", status: "waiting", name: "Beta character in a guild", done: "two raid nights before 2026-10-21. Hakoovak is not this character." },
  { id: "ops.hero_shot", status: "waiting", name: "Hero screenshot", done: "a real beta screenshot replaces the empty hero" },
  { id: "ops.curseforge", status: "waiting", name: "CurseForge pack", done: "staged around 2026-10-24" },
  { id: "ops.signing", status: "waiting", name: "Windows code signing", done: "publisher is likely R21 Media Group LLC" },
  { id: "ops.trademark", status: "waiting", name: "Everloot trademark check", done: "before treating the name as clear" },
  { id: "ops.apple", status: "waiting", name: "Apple Developer", done: "only if a Mac build ships at launch" },
  { id: "ops.wiki_permission", status: "waiting", name: "wiki.gg reply", done: "email to support@indie.io on 2026-09-27. Live wiki stays off the importer until they say yes." },

  { id: "ref.olympus_addon", status: "shape", name: "Olympus Guild addon (MIT)", done: "Their in-game census. It has no server and nothing leaves the client. We cite public pages. We do not join their channel, and we do not replace the addon." },
  { id: "ref.simc", status: "shape", name: "github.com/simulationcraft", done: "forever branch is the sidecar. Addon is Unlicense and may fold into ours. Engine stays GPL-3.0 outside this tree." },
  { id: "ref.wow_tools_local", status: "shape", name: "Marlamin/wow.tools.local", done: "MIT dev tool on Carlos's machine. Do not publish extracted tables. Do not use its wago.tools download path." },
  { id: "ref.pengu", status: "shape", name: "Pengu's Midnight profession sheet", done: "page shape: one profession bible. Do not copy the cells." },
  { id: "ref.gaming_tools", status: "shape", name: "gaming.tools/wow", done: "page shape: a path that recalculates. Price it from our uploads." },
  { id: "ref.wow_professions", status: "shape", name: "wow-professions.com", done: "page shape: a Forever door and a TomTom pin. Do not copy their routes." },
  { id: "ref.missing_mounts", status: "shape", name: "missingmounts.com", done: "page shape: missing list, vendor-ready pile separated. Data comes from uploads." },
  { id: "ref.simple_armory", status: "shape", name: "simplearmory.com", done: "page shape: character URL, owned versus missing. Hakoovak was only a real name to open the page." },
  { id: "ref.data_for_azeroth", status: "shape", name: "dataforazeroth.com", done: "page shape: character page. Not a rankings product." },
  { id: "ref.wowauctions", status: "shape", name: "wowauctions.net", done: "page shape: realm, then item, then price history." },
  { id: "ref.ask_mr_robot", status: "shape", name: "askmrrobot.com", done: "page shape: one gear optimizer. Their lists stay theirs." },
  { id: "ref.wowutils", status: "shape", name: "wowutils.com/tools", done: "page shape: many small tools, one hub, one bridge. Use their API if we ever call them. Do not scrape." },
  { id: "ref.liquid_armory", status: "shape", name: "liquidarmory.com", done: "page shape: trinkets per class, loot table, seasonal overview." },
  { id: "ref.warcraft_tools", status: "shape", name: "warcraft.tools", done: "page shape: is the name free, what is the item worth, all alts on one page. Their Forever door is not built." },
  { id: "ref.wow_gg", status: "shape", name: "wow.gg", done: "page shape: a markdown twin per page. Our bridge is our MCP server, not their chat." },
  { id: "ref.wowhead", status: "shape", name: "wowhead.com", done: "page shape for an item. Link only. A person may check one row by hand in a browser; no bulk reads or XML endpoint." },
  { id: "ref.wowforevertalent", status: "shape", name: "wowforevertalent.com", done: "the gap standard: unrecorded is not zero. Their rows stay theirs." },
  { id: "ref.foreverdiff", status: "shape", name: "foreverdiff.com", done: "blocked. Client-extracted tables. Never fetch or compare against it." },
  { id: "ref.icy_veins", status: "shape", name: "icy-veins.com", done: "page shape: class grid and a news rail. Link only." },
  { id: "ref.raider", status: "shape", name: "raider.io/search", done: "page shape: one search box. Not a score." },
  { id: "ref.wowprogress", status: "shape", name: "wowprogress.com", done: "page shape: guild progress. Link only until terms are read." },
  { id: "ref.warcraftlogs", status: "shape", name: "warcraftlogs.com", done: "explain-a-pull waits on their terms and on Forever log support." },
  { id: "ref.wago_io", status: "shape", name: "wago.io", done: "page shape: a snippet library. Not wago.tools. Those tables stay blocked." },
  { id: "ref.tbc_rtw", status: "shape", name: "tbc.rtw.dev", done: "unread past the title. Open it in a browser before borrowing a layout." },
  { id: "ref.wow_pets", status: "shape", name: "wow-pets.com", done: "unread. Cloudflare 522 on 2026-09-29. Do not substitute another pet site." },
];

const STATUS_LABEL: Record<PlanStatus, string> = {
  live: "Live",
  next: "Next",
  waiting: "Waiting on Carlos",
  shape: "Shape only",
};

export function planIds(): string[] {
  return BRIDGE_PLAN.map((item) => item.id);
}

export function renderTracker(): string {
  const lines = [
    "# Everloot implementation tracker",
    "",
    "Generated from `kb/src/bridge-plan.ts`. Edit that file, then regenerate this page.",
    "The MCP tool `everloot_plan` returns the same text.",
    "",
    "Hakoovak (US / Moon Guard) is Carlos's own character, sent so two reference pages",
    "could be opened on a real name. It is not a fixture and not the Forever beta character.",
    "",
    "Order: one server. Each product tool is one MCP tool on that server. A ChatGPT",
    "subscription connects to the public HTTPS mount and uses its own model. Closed",
    "sites contribute a page shape. Their text and tables stay put. SimulationCraft's",
    "engine stays a separate GPL program.",
    "",
    "Proven, furthest first: real uploads, public client, beta client, on everloot.app,",
    "code + tests, not built. Live means usable today, not proven with real data.",
    "",
    `Rows: ${BRIDGE_PLAN.length}.`,
    "",
  ];
  for (const status of ["live", "next", "waiting", "shape"] as const) {
    const proven = status === "live" || status === "next";
    lines.push(
      `## ${STATUS_LABEL[status]}`,
      "",
      proven ? "| Id | Name | Proven | Done when |" : "| Id | Name | Done when |",
      proven ? "|---|---|---|---|" : "|---|---|---|",
    );
    for (const item of BRIDGE_PLAN.filter((row) => row.status === status)) {
      const proof = proven ? ` ${item.proof ? PROOF_LABEL[item.proof] : "unstated"} |` : "";
      lines.push(`| \`${item.id}\` | ${item.name} |${proof} ${item.done} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function handlePlan(): string {
  return renderTracker();
}

/** The same rows as the text, for a client that reads structured content. */
export function planStructured(): { rows: PlanItem[]; counts: Record<PlanStatus, number> } {
  const counts: Record<PlanStatus, number> = { live: 0, next: 0, waiting: 0, shape: 0 };
  for (const row of BRIDGE_PLAN) counts[row.status] += 1;
  return { rows: [...BRIDGE_PLAN], counts };
}
