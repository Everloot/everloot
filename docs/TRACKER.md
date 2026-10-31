# Everloot implementation tracker

Generated from `kb/src/bridge-plan.ts`. Edit that file, then regenerate this page.
The MCP tool `everloot_plan` returns the same text.

Hakoovak (US / Moon Guard) is Carlos's own character, sent so two reference pages
could be opened on a real name. It is not a fixture and not the Forever beta character.

Order: one server. Each product tool is one MCP tool on that server. A ChatGPT
subscription connects to the public HTTPS mount and uses its own model. Closed
sites contribute a page shape. Their text and tables stay put. SimulationCraft's
engine stays a separate GPL program.

Proven, furthest first: real uploads, public client, beta client, on everloot.app,
code + tests, not built. Live means usable today, not proven with real data.

Rows: 75.

## Live

| Id | Name | Proven | Done when |
|---|---|---|---|
| `mcp.search_knowledge` | Search the knowledge base | code + tests | stdio tool on everloot-knowledge |
| `mcp.get_entity` | Fetch one record by id | code + tests | stdio tool on everloot-knowledge |
| `mcp.get_by_name` | Exact-name lookup | code + tests | stdio tool on everloot-knowledge |
| `mcp.everloot_plan` | This tracker, as a tool | code + tests | a client can ask what is live, next, waiting, or shape-only |
| `mcp.http_local` | Local HTTP MCP | code + tests | POST /mcp on 127.0.0.1. Same server as stdio. Not reachable by ChatGPT yet. |
| `site.home` | Public home | on everloot.app | https://everloot.app |
| `site.upload` | Upload + intake | on everloot.app | /upload and /api/intake. Persists when Supabase is connected. |
| `site.drops` | Drop rollups | on everloot.app | public when 3 independent installs agree |
| `site.professions` | Profession hubs | on everloot.app | hub pages exist. The leveling path is tool.profession_path. |
| `site.waitlist` | Waitlist | on everloot.app | signup path exists. Persists when Supabase is connected. |
| `site.gap_marking` | Unrecorded is not zero | on everloot.app | A missing fact reads unrecorded. A source 3 installs killed with no item dropped reads 0 drops in N kills. Guild item level names how many roster members were measured. A storage failure, an unset corpus source, and a guild-family row with no published count are not zeros. The profession form reads the server uploads. |
| `site.signin` | Battle.net sign-in | on everloot.app | Sign in and Sign out on everloot.app. Hashed server sessions; logout revokes the session. Real login and logout verified 2026-10-08. |
| `ops.health` | Snapshot health | on everloot.app | /api/health reports snapshot age from signed R2 metadata: fresh within 30 minutes, otherwise 503. Age is not proof of complete indexing. |
| `ops.quotas` | Shared intake quotas | on everloot.app | Supabase counters: 20 uploads per install, 200 requests per IP and 10,000 globally per hour. Production fails closed. Install IDs still do not prove different people. |
| `ops.stored_rollups` | Corpus snapshot | on everloot.app | The Worker's Cron Trigger every 10 minutes extends snapshots/corpus.json in R2 with uploads it has not seen. Pages read that one object. ?rebuild=1 (with CRON_SECRET) rebuilds from empty after a deletion. |
| `ops.dns` | everloot.app DNS | on everloot.app | The apex and www records in Cloudflare are proxied, and the Worker routes everloot.app/* and www.everloot.app/* serve them; www answers a 301 to the apex. |
| `ops.worker_deploy` | Worker deploys | on everloot.app | A push to main that touches web/, kb/ or packages/protocol, once the Release checks pass on it, builds the site with OpenNext and deploys the everloot-web Worker (.github/workflows/deploy-worker.yml), then fetches every sitemap page and fails on any that does not answer 200. |
| `ops.supabase` | Supabase + R2 storage | on everloot.app | Intake writes the raw upload to R2 bucket everloot-uploads and one index row to Supabase everloot (ref uinmowrmyckklpbwzqhn); the waitlist is a Supabase table. Pages read the indexed objects. Proven end to end on everloot.app 2026-10-04. |

## Next

| Id | Name | Proven | Done when |
|---|---|---|---|
| `site.sharing` | Named sharing | on everloot.app | Guild, character and gold names publish only through an operator-verified, scoped grant; revoke and character opt-out are on /upload. Done when a real owner or officer issues, uses and revokes a grant. |
| `addon.skeleton` | Collector addon | on everloot.app | TOC Interface 16001, SavedVariables, /upload import; the zip downloads from /upload. Done when it loads and collects in the Forever beta client per docs/2026-10-08-beta-client-checklist.md. |
| `mcp.public_https` | Public HTTPS MCP | on everloot.app | The bearer-token handler answers at everloot.app/mcp in production since 2026-10-10. The build fetches the verified knowledge release from R2 (#26), and the official MCP SDK client listed 13 tools with sourced answers there. A public read-only mount at /mcp/public, rate-limited and without sign-in, is #31. Done when a public client such as ChatGPT connects on production. |
| `tool.profession_path` | Profession leveling path | on everloot.app | Engine and MCP tool profession_path. A step needs 3 agreeing uploads: recipe_seen rows, or (addon 0.2.5) an orange-only step derived from recipe colours, starting at the trainer's required rank (trainer_seen) when 3 installs agree, at 1 point per craft. Gold needs 3 prices per reagent, from price reports or per-unit auction scans. Recipe ranges with reagents and cost per craft are the recipe_thresholds tool. Done when a derived step is confirmed orange in the Forever client. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected. Page: /tools/professions. |
| `tool.item_page` | Item page for a drop row | on everloot.app | Page /database/items/[id] and MCP tool item_page. Name and map pin need 3 agreeing sightings. The rate is the public rollup. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected. |
| `tool.npc_page` | NPC spawn page | on everloot.app | Page /database/npcs/[id] and MCP tool npc_page. A name or map pin needs 3 agreeing sightings. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected. |
| `site.database_icons` | Icons on database pages | code + tests | Item pages show the icon of each spell that creates or uses the item (spellIcons now covers the client layer's relation spells) and the tooltip card for reported items; category pages show icons and game file names only for reported items; pet family icons (familyIcons) are in the manifest. Decided 2026-10-18 by the maintainer. Pages only; waits on the maintainer's upload and the asset URL setting (docs/ASSETS.md). |
| `tool.object_page` | Object pages | code + tests | Kind object. Pages /database/objects and /database/objects/[id] and MCP tool object_page: chests, herbs, ore veins and fishing pools by the entry id in their GUID (sourceObjectId), with what players looted from them; a frequency is public after 3 install reports, a public object with empty windows reads as a measured zero. Item pages link each drop source. No names or positions yet: uploads carry neither, and the client's GameObjects table holds no lootable objects. |
| `tool.quest_page` | Quest page | on everloot.app | Page /database/quests/[id] and MCP tool quest_page. Title, level, giver, turn-in, and a reward each need 3 agreeing uploads. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected. |
| `tool.vendor_page` | Vendor page | on everloot.app | Page /database/vendors/[id] and MCP tool vendor_page. A price is public when 3 installs agree on the item and the copper. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected. |
| `tool.relations` | Entity relations | code + tests | One edge table (kb/src/edges.ts): dropped by, sold by, reward from, located in from uploads (3 installs, with first and last seen), and created by, reagent for, part of set, same icon, profession (spell → skill line) from the committed client layer (found in game files, unconfirmed, with the build). Item pages list them grouped by relation; MCP tool entity_relations; /api/edges (paged) and /api/edges/client-layer. Reward from and located in stay empty until the addon sends quest records and NPC positions. |
| `tool.item_categories` | Items by category | code + tests | Every item in the build by class and subclass (the client's English names, class labels and slugs in the plural as item databases list them, numeric ids as the key; the first singular URLs redirect), with slot and quality, from the committed client layer (found in game files, unconfirmed, with the build). Pages /database/items, /database/items/<class> and /database/items/<class>/<subclass> with slot, quality and page filters; a category path on each item page; MCP tool item_categories; /api/items and /api/items/categories. |
| `tool.collection` | Missing-collection view | on everloot.app | Page /tools/collections and MCP tool collection_gap. A list item needs 3 installs agreeing on the collection, the source, and the item. Owned is that install's upload. Not a Blizzard profile read. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected. |
| `tool.completion` | Completion tracker | code + tests | Addon 0.3.3 module (off until /everloot completion on) reads achievements, reputation, titles and completed quests with the game's own calls, in chunks, and never acts. Catalog rows (achievement_catalog, reputation_catalog, title_catalog, quest_chain_catalog) are anonymous game facts: an entry is listed when 3 installs report it identically. Owned rows are one character's progress under an opaque key and, like collection_owned, are served only with the collection sharing choice and a verified install grant. Page /tools/collections shows what is done and what is closest to done; MCP tool completion_progress. Not yet run in the Forever client: docs/2026-10-19-addon-0.3.3-beta-checklist.md settles it. |
| `tool.guild` | Guild tracker | on everloot.app | Page /tools/guild-board and MCP tool guild_board. Roster, bosses, loot, and item level need 2 agreeing officer uploads. The average names how many roster members were measured. score_v1 has no published weights, so there is no single score. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected. |
| `tool.guild_census` | Public guild-family page | on everloot.app | Citation page is /guilds/olympus. Each figure has its source and date. Battle.net guild profile answers for retail and Classic Era in the local adapter. Forever namespaces were refused on 2026-09-30. Done when that namespace fills the same table. Spec: guild system, census section. |
| `tool.auction` | Auction history | on everloot.app | Page /tools/auctions and MCP tool auction_history. A day is public when 3 installs scanned that item on that realm. Intake accepts auction_scan. The tool reads the public corpus at EVERLOOT_PUBLIC_CORPUS_URL. With no corpus source set, the answer says uploads are not connected. |
| `tool.market` | Forever market values | code + tests | Full auction scans a player starts with a click (addon 0.3.0, C_AuctionHouse.ReplicateItems) upload as auction_snapshot. The cron folds them into snapshots/market.json, outside the corpus. A realm/item day is public when 3 reporters (distinct upload addresses) scanned it; thin and outlier days stay out of the market value; market value weights 14 days, historical is the median of 60. Served by /api/market/prices, MCP tool market_value and /tools/auctions; the companion writes them into the EverlootPrices slot addon for tooltips. Spec: 2026-10-16-forever-market-design. Done when real Forever scans fill it. |
| `tool.gold_ledger` | Gold ledger | on everloot.app | Page /tools/gold-ledger and MCP tool gold_ledger. The addon (0.2.4) stores gold_snapshot (current and peak) and money_event for loot copper, quest money rewards, sales at an open merchant, flight costs, auction sales taken from the mailbox (invoice type seller, matched to the money change, recorded as the sale minus the house cut; the buyer is not stored), postage for letters the server confirmed sent, and auction buyouts. The report names those and says bids, deposits, other mail, other spending, and gameplay are unrecorded. Installs are not merged. The difference is unrecorded, never bought and never a ban. With no corpus source set, the answer says uploads are not connected. Left: deposits (no category yet), other mail, and trade events, plus a trade note that only uses an uploaded ledger. The IRS addon is not copied. Gold-per-hour stays the calculator. |
| `tool.simc` | SimulationCraft sidecar | not built | run the GPL-3.0 forever branch as its own process once it can sim. Report comes back through MCP. Do not paste the C++ into this repo. |
| `app.uploader` | Desktop uploader | code + tests | companion/ upload and watch send only unconfirmed events after logout, named data held on the machine; tested against a local server. Done when it runs against a real Forever WTF folder and ships as a signed build (ops.signing). |
| `app.companion` | In-game companion | code + tests | File bridge: /ask stores the question; companion bridge answers from the MCP server into the EverlootAnswers addon, shown after /reload when its Adler-32 verifies. Providers enabled in config.json (Anthropic, or any OpenAI-compatible endpoint including a local model) answer from the top search results, falling back down the chain; with none enabled the answer is the top search result. Done when it works in the Forever client. |
| `mcp.chatgpt_directory` | ChatGPT apps directory | not built | submit the same MCP server the day submissions open |
| `mcp.subscription_signin` | Subscription sign-in | not built | ChatGPT or Claude subscription unlocks the companion. API keys stay the fallback. |

## Waiting on Carlos

| Id | Name | Done when |
|---|---|---|
| `ops.adsense` | AdSense | Carlos's account. Consent banner already on the site. |
| `ops.beta_guild` | Beta character in a guild | two raid nights before 2026-10-21. Hakoovak is not this character. |
| `ops.hero_shot` | Hero screenshot | a real beta screenshot replaces the empty hero |
| `ops.curseforge` | CurseForge pack | staged around 2026-10-24 |
| `ops.signing` | Windows code signing | publisher is likely R21 Media Group LLC |
| `ops.trademark` | Everloot trademark check | before treating the name as clear |
| `ops.apple` | Apple Developer | only if a Mac build ships at launch |
| `ops.wiki_permission` | wiki.gg reply | email to support@indie.io on 2026-09-27. Live wiki stays off the importer until they say yes. |

## Shape only

| Id | Name | Done when |
|---|---|---|
| `ref.olympus_addon` | Olympus Guild addon (MIT) | Their in-game census. It has no server and nothing leaves the client. We cite public pages. We do not join their channel, and we do not replace the addon. |
| `ref.simc` | github.com/simulationcraft | forever branch is the sidecar. Addon is Unlicense and may fold into ours. Engine stays GPL-3.0 outside this tree. |
| `ref.wow_tools_local` | Marlamin/wow.tools.local | MIT dev tool on Carlos's machine. Do not publish extracted tables. Do not use its wago.tools download path. |
| `ref.pengu` | Pengu's Midnight profession sheet | page shape: one profession bible. Do not copy the cells. |
| `ref.gaming_tools` | gaming.tools/wow | page shape: a path that recalculates. Price it from our uploads. |
| `ref.wow_professions` | wow-professions.com | page shape: a Forever door and a TomTom pin. Do not copy their routes. |
| `ref.missing_mounts` | missingmounts.com | page shape: missing list, vendor-ready pile separated. Data comes from uploads. |
| `ref.simple_armory` | simplearmory.com | page shape: character URL, owned versus missing. Hakoovak was only a real name to open the page. |
| `ref.data_for_azeroth` | dataforazeroth.com | page shape: character page. Not a rankings product. |
| `ref.wowauctions` | wowauctions.net | page shape: realm, then item, then price history. |
| `ref.ask_mr_robot` | askmrrobot.com | page shape: one gear optimizer. Their lists stay theirs. |
| `ref.wowutils` | wowutils.com/tools | page shape: many small tools, one hub, one bridge. Use their API if we ever call them. Do not scrape. |
| `ref.liquid_armory` | liquidarmory.com | page shape: trinkets per class, loot table, seasonal overview. |
| `ref.warcraft_tools` | warcraft.tools | page shape: is the name free, what is the item worth, all alts on one page. Their Forever door is not built. |
| `ref.wow_gg` | wow.gg | page shape: a markdown twin per page. Our bridge is our MCP server, not their chat. |
| `ref.wowhead` | wowhead.com | page shape for an item. Link only. A person may check one row by hand in a browser; no bulk reads or XML endpoint. |
| `ref.wowforevertalent` | wowforevertalent.com | the gap standard: unrecorded is not zero. Their rows stay theirs. |
| `ref.foreverdiff` | foreverdiff.com | blocked. Client-extracted tables. Never fetch or compare against it. |
| `ref.icy_veins` | icy-veins.com | page shape: class grid and a news rail. Link only. |
| `ref.raider` | raider.io/search | page shape: one search box. Not a score. |
| `ref.wowprogress` | wowprogress.com | page shape: guild progress. Link only until terms are read. |
| `ref.warcraftlogs` | warcraftlogs.com | explain-a-pull waits on their terms and on Forever log support. |
| `ref.wago_io` | wago.io | page shape: a snippet library. Not wago.tools. Those tables stay blocked. |
| `ref.tbc_rtw` | tbc.rtw.dev | unread past the title. Open it in a browser before borrowing a layout. |
| `ref.wow_pets` | wow-pets.com | unread. Cloudflare 522 on 2026-09-29. Do not substitute another pet site. |
