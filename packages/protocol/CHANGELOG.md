# Changelog

All notable changes to `@everloot/protocol`, in the style of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
A new record kind, field or tool is a minor release. Removing or renaming anything, making a field
required, or tightening a limit is a major release.

## [Unreleased]

### Changed
- 1.13.0 (record protocol unchanged, 1.7.0), description text only, no shape change: `corpusPublicResponse.records`
  now says each record's `installId` is a per-install pseudonym (`pub-` and 32 hex), never the addon's install id,
  and absent when the server has no key to make one. The records pass `parseRecords` again, so installs can be counted.
- The `object_page` answer carries `name`, null until 3 installs agree on one, as the NPC page does.
- Description text only, no shape change: in `API_ROUTES`, the `limit` paging parameter states its caps (500 rows
  without a key, 5,000 with one), and the corpus and client-layer routes and the market rule read in plain words.

### Added
- 1.19.0 (record protocol 1.10.0), for the guild ladder (`docs/design/specs/2026-10-24-guild-board-design.md`):
  the `guild_kill` record, a boss kill credited to the uploading member's own guild (guild, realm, faction,
  encounter, name, instance, difficulty, size; no character), counted once 2 installs report it. It is not a public
  corpus kind: kills are published only through the guild rollup, behind the guild switch, with hidden guilds left out.
  Two tools, `guild_search` and `guild_rankings`, with output schemas `guildSearch` and `guildRankings`;
  `guild_board`'s output gains optional `ladderProgression`, `activity`, `seenRoster` and `ranks`, its inputs
  untouched. The public catalogue is 31 tools.
- 1.18.0 (record protocol 1.9.0), for loot tables by source type: the `loot` record gains three optional fields.
  `lootType` (`LOOT_TYPES`: kill, pickpocket, skinning, gather, disenchant, container, fishing) says what opened
  the window; `sourceItemId` names the item that was disenchanted or opened, and counts as a source beside
  `sourceNpcId` and `sourceObjectId`; `copper` is the coin in the window. Windows without them stay valid and are
  never sorted into a type by guessing. MCP tools are unchanged.
- 1.17.0 (record protocol unchanged, 1.8.0): optional `itemPage.reported` holds agreed item numbers with
  installs, build and last seen, plus contested line keys without values. Tool inputs are unchanged.
  `item_page` and `coverage` descriptions now document item-number evidence, scoped coverage totals and
  the separately dated whole-fact settled-list size. The public catalogue remains 29 tools.
- 1.16.0 (record protocol unchanged, 1.8.0): the route `GET /api/coverage/settled` is in `API_ROUTES`, with its
  response schema `settledListResponse` (`everloot.settled/1`): per upload row kind, the delta-encoded ids whose
  facts are settled for one client build. The route already existed; it is now in the OpenAPI document, the API
  docs and `schema/api/`.
- 1.15.0 (record protocol 1.8.0), for the numbers an item's tooltip shows that the game files do not hold: the
  record kind `item_fact`, public in the corpus, with `itemId`, `fact` (which line, from `ITEM_FACTS`: armor, block,
  damage_per_second, each stat and each resistance), `value` (a whole number, but damage_per_second has one decimal)
  and `clientBuild`, which is required here because a patch can change an item's numbers. The addon writes it from
  the player's own tooltips. MCP tools are unchanged.
- 1.14.0 (record protocol unchanged, 1.7.0): read-only, text-only MCP tool `coverage`, with optional
  UiMap `zone` and coverage `type`. Returns the public coverage page's dated counts, method, install
  counts and reported-field lists without unconfirmed values or baseline rows, names or ids.
- 1.12.0 (record protocol 1.7.0), for rares, dungeons and treasures in a Polestar Recorder file:
  `npc_sighting.positionKind` gains `vignette` (the NPC's own position from the game's vignette API). Three record
  kinds, each public in the corpus: `instance_entrance` (`instanceMapId`, `name`, `instanceType` from
  `INSTANCE_TYPES`, optional `difficulty`, and the last outdoor `mapId`, `x`, `y`), `encounter` (`encounterId`,
  `name`, `instanceMapId`, optional `difficulty` and `size`, `success`, optional `npcIds`) and `object_sighting`
  (`objectId`, `name`, the object's own `mapId`, `x`, `y`, optional `instanceMapId`). MCP: `item_page`, `npc_page`
  and `object_page` gain an optional `pendingLoot` (loot windows reported but not in the rates: `windows`,
  `reporters`), `object_page` an optional `pins`, and `world_map_near` an optional `treasures` list and an
  optional `confirmed` count on each entrance.
- 1.11.0 (record protocol 1.6.0), for uploads of a Polestar Recorder file: `npc_sighting.level` and
  `npc_sighting.reaction` are no longer required, because a Recorder file does not record them, and the upload
  envelope gains an optional `source` (`UPLOAD_SOURCES`: `polestar_recorder`), passed through as
  `CanonicalUpload.source`. Rows from the Everloot addon still carry both fields. MCP tools are unchanged.
- 1.10.0 (record protocol 1.5.0), for the world map's player pins: `npc_sighting.positionKind` gains `interaction`
  (the player's position while the NPC's window was open) and an optional `role` (`NPC_ROLES`: vendor, trainer,
  questgiver, flightmaster, banker, auctioneer, stablemaster, innkeeper, repair). `loot` gains five optional
  fields for an object source: `mapId`, `x` and `y` (the player's position, all three or none), `gatherKind`
  (`GATHER_KINDS`: herb, ore, chest, fishing, other) and `sourceObjectName`. `trainer_seen` gains an optional
  `trainerNpcId`. Older addons send none of them. MCP tools are unchanged.
- 1.9.0 (record protocol 1.4.0): the record kind `character_link`, written when a player types a link code on one
  of their characters: the code (`LINK_CODE`), name, realm, race, class, level, faction, the GUID (in transit only)
  and the completion key, with `LINK_KINDS`. Not a public corpus kind and never kept in a stored upload: the site
  reads it at the account's link endpoint, keeps a keyed hash in place of the GUID, and drops it at intake.
- 1.8.0: an optional `url` in tool answers, the everloot.app page that shows the answer, absolute, and absent when
  there is none or it would be empty (`PAGE_URL`). It is on `uploadsAnswer` (every tool built on player uploads),
  `knowledgeHit` (an indexed lore page), `evidence`, and the answers of `item_categories`, `talent_tree`,
  `talent_plan` (the build's own link), `recent_changes` and `ecosystem_projects`. Input schemas are unchanged.
- 1.7.0 (record protocol 1.3.0): `npc_sighting` gains two optional fields, `creatureType` (`NPC_CREATURE_TYPES`, the game's English creature type) and `rank` (`NPC_RANKS`: normal, elite, rare, rare_elite, boss). `quest` gains four optional fields: `category` (the quest log header), `faction` (Alliance or Horde, the accepting character's), `suggestedGroup` and `tag` (`QUEST_TAGS`). Older addons send none of them.
- 1.6.0, protocol 1.2.0: the record kind `player_seen` (name, realm, race, class, level and optional guild of a player the addon saw or of your own character), with `validPlayerName`, `validGuildName`, `PLAYER_KINDS` and `UPLOAD_LIMITS.playersPerUpload` (1,000). Not a public corpus kind, and not kept in the stored upload: the site writes the newest row per character to its players table, and only when the owner has turned the player pages on.
- 1.5.0: `changeEntry`, the shape of a `recent_changes` entry, gains five optional fields for forum posts:
  `region` (`us` or `eu`, now that the EU English forum is read too), `topicId`, `topicSlug`, `postNumber` and
  `startedThread`, so a client can group every Blizzard reply in one thread. Nothing existing changes.
- 1.4.0 (record protocol 1.2.0): `auction_snapshot` gains two optional fields, `faction` (the scanning character's, Alliance or Horde) and `house` (`AUCTION_HOUSES`: the auction house the scan read, Alliance, Horde or Neutral). Older scans have neither. `GET /api/market/prices` takes an optional `house`; `marketPricesResponse` gains `house` and `marketRealmsResponse` gains `houses`, the houses with public values of their own per realm.
- `GET /api/tooltip/{type}/{id}` in `API_ROUTES` with its response shape `tooltipResponse` (and `TOOLTIP_TYPES`):
  the hover card of an item, NPC, quest or object page, for the embeddable script. Minor release; the version is
  bumped when the package is next published.
- 1.3.0: a census count also needs 3 distinct addresses (`reporter`, the keyed address hash intake stamps), so `population`'s `rule` gains `minReporters` and a hidden count is null for fewer than 10 characters, 3 installs or 3 addresses, or when held back so it can't be worked out.
- 1.2.0: the MCP tool `population` (who plays what, from the census) with its output shape `populationPage`
  (`populationCell`, `CENSUS_FACTIONS`, `CENSUS_WINDOWS`), emitted as `schema/mcp/population.json`, and in
  `PLAYER_DATA_TOOLS`. A hidden count is null; the page says whether the game has launched and whether the
  window is still collecting.
- Two census kinds, `census_self` (your own character: race, class, level, faction, realm) and `census_seen`
  (a player you target, mouse over or group with: the same without realm, plus `via`). Each carries the
  player GUID in transit only. `censusSelfStored` and `censusSeenStored` are what the site stores instead:
  `characterKey` (an HMAC of the GUID) and `serverId` in place of the GUID, and the server's own `eventId`.
  `CENSUS_KINDS`, `StoredRecord` and `StoredUpload` name them. Neither kind is a public corpus kind.
  `UPLOAD_LIMITS` gains `censusSeenPerDay` (500) and `censusSelfPerDay` (50), census rows one install may
  report per UTC day. A stored row may carry `reporter`, the keyed hash of the sender's address (16 hex, never the
  address), so a rollup can count distinct addresses. A GUID's server number has no leading zero, and a
  `census_self` realm is a realm name (`validRealm`). Version 1.1.0, protocol 1.1.0.
- `bulkIndex` and `bulkFile`, the shape of a bulk export's `index.json`, with `BULK_DATASETS`
  (corpus, edges, drops, items): each file's rows are the array of an existing API response, named by
  `rowsOf` and `field`, so the bulk files and the API share one definition.
- `skill` as an entity kind and the `in_skill_line` relation (spell -> skill line), as the site's
  profession edges from the game files carry since 2026-10-18.
- The upload record contract, moved here from the site: 31 record kinds, the upload envelope, the
  parser the site runs, the sharing categories, `validRealm` and the upload limits in one `UPLOAD_LIMITS`.
- `protocol` on the upload envelope. The uploaders stamp `PROTOCOL_VERSION`; the server accepts the
  current major and the previous one, and a missing value means major 1.
- `schema/`: JSON Schema (draft 2020-12) for every kind, the envelope, the limits and an index, with the
  server's cross-field rules written into each description. The addon's contract tests read them.
- The licence and credit line (`SITE`, `LICENCE`, `CREDIT_LINE`, `MCP_CREDIT`, `GAME_DATA_CREDIT`),
  moved here from the knowledge base.
- The JSON API's response shapes (`corpusPublicResponse`, `dropsResponse`, `edgesResponse`, `itemsResponse`,
  `marketPricesResponse`, `marketRealmsResponse`, `intakeRequest`, `intakeReceipt`, `intakeRefused`,
  `healthResponse`, `apiError`, `page`, `attribution`, `gameDataNotice`) and the route catalogue
  `API_ROUTES`, emitted as `schema/api/*.json` and `schema/api/routes.json`. Each route's test on the site
  parses a real response with its schema.
- The MCP server's tool table `MCP_TOOLS` (22 tools: name, title, description, input schema, annotations),
  with the input constants they use (`KNOWLEDGE_KINDS`, `GAME_VERSIONS`, `ENTITY_KINDS`, `RELS`,
  `CHANGE_FILTERS`, `BOARD_IDS`, `ECOSYSTEM_BOARD_FILTERS`, the `NEAR_*` limits, `ITEM_QUALITY_SLUGS`),
  emitted as `schema/mcp/<tool>.json`. `TOOL_OUTPUT` states that every tool answers with one text block;
  `search_knowledge`, `get_entity`, `get_by_name` and `recent_changes` also declare an `outputSchema`
  (`knowledgeHit`, `changeEntry`) and answer with `structuredContent` of that shape (`STRUCTURED_TOOLS`).
  The other tools gain it tool by tool in later minor releases.
- `answer_sources` (the 23rd tool) and its `evidence` shape: claim, kind (observed, curated, lore), source,
  licence, asOf, support.
- `talent_tree` and `talent_plan` (tools 24 and 25), both with structured output: `TALENT_CLASSES`,
  `talentNode` and `talentTreePoints`. The trees of one class from the game files, and a share code read
  against them.
- `outputSchema` for `item_categories` (`itemCategory`), `ecosystem_projects` (`ecosystemProject`) and
  `everloot_plan` (`planRow`): the three tools that read no uploads now answer with `structuredContent`.
- `uploadsAnswer`, the envelope every structured answer built on player uploads starts with (`connected`,
  `dataAsOf`, `reason`), and `outputSchema` for the five page tools: `item_page` (`itemPage`, `itemDrop`,
  `mapPin`), `npc_page` (`npcPage`), `quest_page` (`questPage`), `vendor_page` (`vendorPage`, `vendorOffer`)
  and `object_page` (`objectPage`). With no corpus read the page is absent, which is not a measured zero.
- `outputSchema` for `auction_history` (`auctionHistory`), `collection_gap` (`collectionGap`) and `guild_board`
  (`guildBoard`), under the same `uploadsAnswer` envelope.
- `outputSchema` for `profession_path` (`professionPath`), `recipe_thresholds` (`recipeThresholds`),
  `entity_relations` (`entityRelations`, `relationEdge`), `completion_progress` (`completionProgress`,
  `characterProgress`) and `market_value` (`marketPage`, `marketValue`), under the same envelope.
- `outputSchema` for `gold_ledger` (`goldLedger`, with `INCOME_CATEGORIES` and `SPENDING_CATEGORIES`) and
  `world_map_near` (`mapNear`), the last two: every tool is structured now (`STRUCTURED_TOOLS` is the
  whole list).
- `GET /api/tools/{tool}` in `API_ROUTES` with its response shape `toolAnswerResponse` (tool, arguments,
  answer, text, schema); `pathParams` on `ApiRoute` for parameters written as `{name}` in the path.
- `GET /api/items/categories` in `API_ROUTES` with its response shape `itemCategoriesResponse` (classes with
  subclasses, slots, qualities, the game-data notice), so the OpenAPI document and the connect reference
  describe the endpoint the site already served.
- `values` on a prompt argument (`what_changed.game`: forever, classic) and on a resource template
  (`everloot://talents/{class}`: `TALENT_CLASSES`): the finite set the server completes from and, for a
  template, lists one resource per value. Written into `schema/mcp/prompts.json` and `resources.json`.
- Two tools after OpenAI's connector contract, `search` (`searchResult`: id, title, url) and `fetch`
  (`fetchedDocument`: id, title, text, url, metadata with source, licence and date), listed in
  `CHATGPT_TOOLS`; their schema files say the text block is the structured answer as JSON.
- The MCP server's resource templates `MCP_RESOURCE_TEMPLATES` (`everloot://item/{id}`, `npc`, `quest`,
  `vendor`, `object`, `talents/{class}`), each naming the tool whose structured answer it holds; in
  `schema/mcp/resources.json` as `templates` and in `index.json` as `mcpResourceTemplates`.
- The MCP server's prompt table `MCP_PROMPTS` (`answer_with_sources`, `review_talent_plan`, `what_changed`:
  title, description, string arguments), emitted as `schema/mcp/prompts.json` and listed in `index.json`
  as `mcpPrompts`.
- The MCP server's resource table `MCP_RESOURCES` (`everloot://builds`, `everloot://methodology`,
  `everloot://data-policy`: name, title, description, MIME type), `buildEntry` and `buildsResource` for the
  JSON one, emitted as `schema/mcp/resources.json` and listed in `index.json` as `mcpResources`.

### Changed
- `scripts/check-semver.ts` compares the branches of an `anyOf` or `oneOf` field by field, so a nullable object
  that gains an optional field (`get_entity`'s `hit`) counts as an addition, not as a removed branch.
- `TERMS_URL` points at the terms of use, `https://everloot.app/terms#licences`, now that the site has a
  terms page; it was the licence section of `/connect`.

### Notes
- The addon's Lua comments still name `web/src/lib/intake.ts`, the file this package replaced. They sit
  inside the zipped addon, so they change with the next addon release, not here.
