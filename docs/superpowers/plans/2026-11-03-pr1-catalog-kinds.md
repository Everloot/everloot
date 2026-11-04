# PR 1: Catalog kinds with a published base — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eight new knowledge kinds (achievement, faction, title, quest_chain, mount, legacy_perk, race, instance) become searchable and fetchable over MCP from a game-file base, with three new published layers (factions, titles, quest lines) and the upload rollup confirming them.

**Architecture:** Game-file catalogs already committed under `web/src/data/game-data/` (plus three new ones built the same way as `client-recipes.ts`) are imported into the knowledge release as entity rows of a new `game-files` source. Search, `get_by_name`, `get_entity` and `fetch` then work unchanged over FTS. The site's faction, title and quest-chain lists read the base layer first and overlay the rollup; MCP answers for those kinds append a confirmation line when the rollup agrees.

**Tech Stack:** TypeScript, zod 4, better-sqlite3 (kb), vitest, Next.js (web). `@everloot/protocol` is the contract package.

**Spec:** `docs/superpowers/specs/2026-11-03-mcp-parity-batch-design.md` (sections "The baseline rule", "PR 1").

**Branch:** `feat/mcp-catalog-kinds` from `main`. Held unmerged until Carlos says go.

## Global Constraints

- No new tools. Only `KNOWLEDGE_KINDS` and existing tools' enums widen.
- `recipe` is not a kind in this batch: recipe spell names live only in the private assets bucket (`spell-names.json`, `kb/src/game-names.ts`), never in a committed file, so a recipe row would have no honest name. Recipes stay reachable through `profession_path`, `recipe_thresholds` and the spell pages. Say so in the PR body.
- PR title: `feat(mcp): search reaches achievements, factions, titles, quest lines, mounts, legacy perks, races and instances`.
- Every game-file row is labelled `CLIENT_LABEL` ("Found in game files, unconfirmed") with its build and carries `GAME_DATA_CREDIT` (`packages/protocol/src/attribution.ts`).
- The `search`/`fetch` ChatGPT contract keeps its shape: `search` returns `{ results: [{ id, title, url }] }`, `fetch` returns `fetchedDocument`. Adding optional fields is allowed.
- Every URL a hit cites must be a page that exists on everloot.app.
- Names that `isDevelopmentItemName` (`kb/src/dev-item-names.ts`) flags are never imported.
- Tests: `cd kb && npm test && npm run typecheck`; `cd packages/protocol && npm test && npm run typecheck && npm run build` (regenerates `packages/protocol/schema/mcp/*.json`, which are committed); `cd web && npm test && npm run typecheck && npm run lint`.
- Commits: `git commit -s` (DCO).
- Nothing under wowhead.com is read. No decryption of game files.
- `pfquest.ts` stores objects as `npc` rows on purpose; do not touch it.

## Review Focus

1. A faction whose `Name_lang` is empty or a development placeholder: must be skipped, never an empty-named row (Task 3 test).
2. A quest line with no `QuestLineXQuest` rows: imported with `questIds: []` and the snippet "0 quests", never dropped silently (Task 3 test).
3. `search_knowledge` with `kind: "title"` and a query that matches an item of the same name: only the title comes back (Task 5 test).
4. `fetch` of a faction id when the completion rollup is unreachable: the body still returns with no confirmation line and no error (Task 6 test).
5. The site list page when the base file is present but the rollup is null: shows base entries marked unconfirmed, not the old "unrecorded" empty state (Task 7 test).

---

### Task 1: Widen the kind list in protocol, entities and the DB schema

**Files:**
- Modify: `packages/protocol/src/mcp.ts:14` (`KNOWLEDGE_KINDS`)
- Modify: `kb/src/entities.ts:5-8` (`Kind`, `ALL_KINDS`)
- Modify: `kb/src/db.ts:19` (the `kind` CHECK)
- Test: `packages/protocol/src/mcp.test.ts` (exists; add a test), `kb/src/db.test.ts` (create if absent)

**Interfaces:**
- Produces: `KNOWLEDGE_KINDS` = `["item","npc","object","quest","zone","spell","lore_page","creator","realm","achievement","faction","title","quest_chain","mount","legacy_perk","race","instance"]` (this exact order; append only). `Kind` and `ALL_KINDS` in `kb/src/entities.ts` list the same values. The CHECK in `db.ts` lists the same values including `object`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/protocol/src/mcp.test.ts
test("KNOWLEDGE_KINDS carries the catalog kinds after the original nine", () => {
  expect(KNOWLEDGE_KINDS.slice(9)).toEqual(["achievement","faction","title","quest_chain","mount","legacy_perk","race","instance"]);
});
// kb/src/db.test.ts
test("the entities table accepts every ALL_KINDS value", () => {
  const db = openDb(":memory:"); // use the existing in-memory open helper from db.ts
  for (const kind of ALL_KINDS) expect(() => insertRow(db, kind)).not.toThrow(); // insertRow: a 10-line local helper in the test
});
```

- [ ] **Step 2: Run them**: `cd packages/protocol && npx vitest run src/mcp.test.ts`; `cd kb && npx vitest run src/db.test.ts`. Expected: FAIL (slice is empty; CHECK rejects `achievement`).

- [ ] **Step 3: Append the eight kinds** to `KNOWLEDGE_KINDS`, `Kind`, `ALL_KINDS`, and the CHECK (add `object` there too).

- [ ] **Step 4: Run** the two tests plus `cd kb && npm test` (the snapshot schema test derives from `SCHEMA`, so it must stay green). Expected: PASS.

- [ ] **Step 5: Regenerate protocol schema**: `cd packages/protocol && npm run build`; commit the changed `schema/mcp/*.json`.

- [ ] **Step 6: Commit**: `git commit -s -m "feat(protocol): nine catalog kinds join the knowledge kinds"`.

---

### Task 2: Three new game-file layers: factions, titles, quest lines

**Files:**
- Create: `kb/src/client-factions.ts`, `kb/src/client-titles.ts`, `kb/src/client-quest-lines.ts`
- Create: `kb/src/client-factions.test.ts`, `kb/src/client-titles.test.ts`, `kb/src/client-quest-lines.test.ts`
- Modify: `kb/src/cli.ts` (three commands next to `client-recipes` at :204 and :713), `kb/src/build-watch/cdn-extract.ts:83` (write the three files after recipes), `kb/src/build-watch/site-data.ts:205` (`generatedFiles` list)
- Create: `web/src/data/game-data/client-factions.ts`, `client-titles.ts`, `client-quest-lines.ts` (typed re-exports of the JSON, same pattern as `client-recipes.ts` there)

**Interfaces:**
- Consumes: `readClientMeta`, `readClientRows`, `readClientTables` from `kb/src/client-snapshot.ts`; `CLIENT_LABEL` from `kb/src/edges.ts`; `GAME_DATA_CREDIT` from protocol; `isDevelopmentItemName`.
- Produces, each with `schema`, `label`, `credit`, `build` exactly as `ClientRecipes` has them:
  - `ClientFactions` = `{ ..., factions: { id: number; name: string; parentId?: number; shown: boolean }[] }` where `shown` is `ReputationIndex > -1` (the faction appears in the reputation pane). Schema id `"everloot.client-factions/1"`. Builders: `buildClientFactions(snapshotPath): ClientFactions`, `serializeClientFactions`, `writeClientFactions(snapshotPath, path)`.
  - `ClientTitles` = `{ ..., titles: { id: number; name: string }[] }`, `name` is `Name_lang` as the file holds it (`%s` placeholders kept). Schema `"everloot.client-titles/1"`. Same three functions with `Titles`.
  - `ClientQuestLines` = `{ ..., questLines: { id: number; name: string; questIds: number[] }[] }`, `questIds` in `OrderIndex` order from `QuestLineXQuest`. Schema `"everloot.client-quest-lines/1"`. Same three functions with `QuestLines`.
- Columns: `Faction.Name_lang`, `Faction.ParentFactionID`, `Faction.ReputationIndex`; `CharTitles.Name_lang`; `QuestLine.Name_lang`; `QuestLineXQuest.QuestLineID`, `QuestID`, `OrderIndex`. Confirm against the pinned definitions in the snapshot (`readClientMeta(path).definitions`) and adjust names only if the definition differs.

- [ ] **Step 1: Write the failing tests**, one file each, using the fixture pattern of `kb/src/client-recipes.test.ts` (`writeClientSnapshot` into a temp file with hand-made rows):

```ts
test("factions: name, parent and shown flag; empty and dev names skipped", () => {
  // rows: 1 {Name_lang:"Stormwind", ParentFactionID:0, ReputationIndex:3}, 2 {Name_lang:"", ...}, 3 {Name_lang:"<TEST> Faction", ...}
  expect(buildClientFactions(path).factions).toEqual([{ id: 1, name: "Stormwind", shown: true }]);
});
test("titles: id and name with the placeholder kept", () => {
  expect(buildClientTitles(path).titles).toEqual([{ id: 1, name: "%s, Champion of the Frozen Wastes" }]);
});
test("quest lines: quest ids in order index order; a line with no quests keeps an empty list", () => {
  expect(buildClientQuestLines(path).questLines).toEqual([{ id: 1, name: "The Missing Diplomat", questIds: [11, 10] }, { id: 2, name: "Lonely", questIds: [] }]);
});
```

- [ ] **Step 2: Run**: `cd kb && npx vitest run src/client-factions.test.ts src/client-titles.test.ts src/client-quest-lines.test.ts`. Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the three modules** following `client-recipes.ts` line for line in structure (zod schema, `build*`, `serialize*` one row per line, `write*`). Skip rows whose name trims to empty or `isDevelopmentItemName`. Sort by id.

- [ ] **Step 4: Run the tests**. Expected: PASS.

- [ ] **Step 5: Wire the CLI and build watch**: add `client-factions`, `client-titles`, `client-quest-lines` commands (`<snapshot.sqlite> [--out ../web/src/data/game-data/<file>.json]`) mirroring `client-recipes` at `cli.ts:713`; call the three writers in `cdn-extract.ts` after `writeClientRecipes`; add the three file names to `generatedFiles` in `site-data.ts`; add the three usage lines to the header comment of `site-data.ts`.

- [ ] **Step 6: Generate the files from the current build**: `cd kb && npm run kb -- client-extract --product wowf` (uses the registry and CDN; if a snapshot for the current build already exists under `data/client`, pass its path to the three new commands instead). Then run the three commands with the default `--out`. Commit the three JSON files and the three `web/src/data/game-data/*.ts` wrappers. If the CDN is unreachable from this machine, stop and report: the files are produced by the next `build-watch.yml` run, and Task 3's importer must tolerate a missing file (it does, by design).

- [ ] **Step 7: Ledger and policy lines**: in `docs/sources/LEDGER.md` row 40, after the recipe table clause, add: `and, decided 2026-11-03 by Carlos, the faction, title and quest line tables (`client-factions.json`, `client-titles.json`, `client-quest-lines.json`: ids and names, a faction's parent and whether it shows in the reputation pane, a quest line's quest ids in order, from `Faction`, `CharTitles`, `QuestLine` and `QuestLineXQuest`; for `/database/factions`, `/database/titles`, `/database/quest-chains` and the knowledge search)`. In `docs/DATA_POLICY.md` line 224, extend the status sentence's exception list with `the faction, title and quest line tables`.

- [ ] **Step 8: Run** `cd kb && npm test && npm run typecheck`; `cd web && npm run typecheck`. Expected: PASS.

- [ ] **Step 9: Commit**: `git commit -s -m "feat(kb): faction, title and quest line tables become published game-file layers"`.

---

### Task 3: The catalog index (game-file rows served beside the release, never inside it)

**Ruling that reshaped this task (2026-11-03):** the knowledge release's publish guard
(`checkPublishedDb`, `kb/src/snapshot.ts`) requires every row to be CC BY-SA 4.0, and the release is the open
dataset. Game-file rows are Blizzard data under their own credit, so they never enter the release. They are
served from the committed JSON under `web/src/data/game-data/` through an in-memory catalog index that the
knowledge tools union with the release at query time, the way the client layer and race table already reach
the MCP (`ToolOptions.gameData`). No `SOURCES` entry; no `import-game-files` command; no release cut.

**Files:**
- Create: `kb/src/catalog-index.ts`, `kb/test/catalog-index.test.ts`
- Create test fixtures: `kb/test/fixtures/game-files/` with one tiny valid file per catalog (`client-achievements.json`, `client-mounts.json`, `legacy-perks.json`, `races.json`, `client-encounters.json`, `map.json` (only `entrances`), `client-factions.json`, `client-titles.json`, `client-quest-lines.json`), each with one or two entries, same schemas as the real files (parse them with the zod schemas the `kb/src/client-*.ts` and `web/src/data/game-data/*.ts` modules export; `map.json` with a minimal local schema picking `mapId, name, raid, minLevel?, maxLevel?`).

**Interfaces:**
- Produces: `CATALOG_ID_BASE = 1_000_000_000` and `catalogId(kind, extId): number` = `CATALOG_ID_BASE + kindIndex * 10_000_000 + Number(extId)` where `kindIndex` is the kind's position in `CATALOG_KINDS` (`["achievement","faction","title","quest_chain","mount","legacy_perk","race","instance"]`); `isCatalogId(id): boolean`. Ids are deterministic across builds and never collide with release rowids.
- Produces: `CatalogFiles` = `{ achievements?, mounts?, encounters?, map?, legacyPerks?, races?, factions?, titles?, questLines? }` (each the parsed JSON object or undefined); `readCatalogFiles(root: string): { files: CatalogFiles; missing: string[] }` (Node only; a missing file is listed, never thrown); `buildCatalogIndex(files: CatalogFiles): CatalogIndex` (pure; the web host calls it with its JSON imports, the kb CLI with `readCatalogFiles`).
- Produces: `CatalogRecord` = `SearchHit & { body: string; data: Record<string, unknown> }` with `id` from `catalogId`, `extId` the numeric id as a string, `kind`, `name`, `snippet` (first 160 chars of `body`), `gameVersion: "forever"`, `sourceId: "game-files"`, `sourceUrl` = `SITE + catalogPath(kind, extId, name)`, `licence: "Game data © Blizzard Entertainment, Inc.; not under Everloot's licence"`, `retrievedAt` = the file's `build.extractedAt` (for instances: `map.json`'s `source.extractedAt`), `body` = a plain-text rendering, first line `<name>` then one line per field below, `data` = `{ build: <build.version>, ...fields }`.
- Produces: `searchCatalog(index, query: string, opts?: { kinds?: string[]; limit?: number }): CatalogRecord[]` (normalise with `allTerms` from `kb/src/search.ts`; exact normalised name first, then names containing every query term, then names containing any term; `limit` default 10), `getCatalogEntity(index, id): CatalogRecord | undefined`, `getCatalogByName(index, name, kind?): CatalogRecord[]` (exact, case-insensitive), `catalogCounts(index): Record<string, number>`.
- Sources and fields per kind (file shapes as committed today, build 1.60.1.70707):
  - achievement: `client-achievements.json` `achievements[id] = { title, points, description?, criteria[], statistic? }`; name = `title`; fields `points`, `criteriaCount` = `criteria.length`, `description?`; rows with `statistic: true` are skipped.
  - mount: `client-mounts.json` `mounts[id] = { name, spellId, ridingSkill? }`; fields `spellId`, `ridingSkill?`.
  - legacy_perk: `legacy-perks.json` `trees[].nodes[].entries[] = { id, spellId, name, maxRanks }`; one row per entry, `extId` = entry `id`; fields `treeId`, `nodeId`, `spellId`, `maxRanks`.
  - race: `races.json` `races[] = { id, name, faction, classes: [{ id, name }], traits: [{ name, kind, order }] }`; fields `faction`, `classes: string[]` (names), `traits: string[]` (names).
  - instance: `map.json` `entrances[] = { mapId, name, raid, minLevel, maxLevel, difficultyIds }` joined with `client-encounters.json` `instances[mapId] = [{ id, name, difficultyId? }]`; one row per entrance with a `name`, `extId` = `mapId`; fields `raid`, `minLevel`, `maxLevel`, `encounters: { id, name }[]` (empty when the encounters file has no entry). An entrance without a name is skipped.
  - faction: `client-factions.json`; fields `parentId?`, `shown`.
  - title: `client-titles.json`; no extra fields.
  - quest_chain: `client-quest-lines.json`; fields `questIds`, `questCount`.

- [ ] **Step 1: Write the failing tests**

```ts
test("builds one record per catalog entry, with page url, credit and reserved id", () => {
  const { files, missing } = readCatalogFiles(fixtureRoot);
  expect(missing).toEqual([]);
  const index = buildCatalogIndex(files);
  expect(catalogCounts(index)).toEqual({ achievement: 1, faction: 1, title: 1, quest_chain: 2, mount: 1, legacy_perk: 1, race: 1, instance: 1 });
  const [row] = getCatalogByName(index, "Stormwind", "faction");
  expect(row.id).toBe(catalogId("faction", "1"));
  expect(row.sourceUrl).toBe("https://everloot.app/database/factions/1-stormwind");
  expect(row.licence).toMatch(/Blizzard/);
  expect(row.data).toMatchObject({ shown: true, build: expect.any(String) });
  expect(row.body.startsWith("Stormwind\n")).toBe(true);
});
test("a missing file is reported, not thrown; statistics are not achievements", () => {
  const { files, missing } = readCatalogFiles(rootWithoutTitles);
  expect(missing).toEqual(["client-titles.json"]);
  const counts = catalogCounts(buildCatalogIndex(files));
  expect(counts.title).toBeUndefined();
  expect(counts.achievement).toBe(1); // fixture holds one achievement and one statistic
});
test("search ranks an exact name first, then all-term matches, and honours kinds and limit", () => {
  expect(searchCatalog(index, "Deadmines")[0]).toMatchObject({ kind: "instance", extId: "36" });
  expect(searchCatalog(index, "champion", { kinds: ["title"] }).map((r) => r.kind)).toEqual(["title"]);
  expect(searchCatalog(index, "the", { limit: 1 })).toHaveLength(1);
});
test("ids are deterministic, reserved and reversible", () => {
  expect(isCatalogId(catalogId("instance", "36"))).toBe(true);
  expect(isCatalogId(123)).toBe(false);
  expect(getCatalogEntity(index, catalogId("mount", "5"))?.name).toBe("Gray Wolf");
});
```

- [ ] **Step 2: Run**: `cd kb && npx vitest run test/catalog-index.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `kb/src/catalog-index.ts`: `readCatalogFiles` (Node `fs`, one `readJson<T>(root, file, schema)` returning `undefined` when absent), one `recordsOf*` function per kind returning `CatalogRecord[]`, `buildCatalogIndex` (arrays by kind, a `Map<number, CatalogRecord>` by id, a `Map<string, CatalogRecord[]>` by normalised name), and the three readers. No DB, no `replaceSourceRows`, no `SOURCES` change.

- [ ] **Step 4: Run the tests**. Expected: PASS.

- [ ] **Step 5: Run** `cd kb && npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**: `git commit -s -m "feat(kb): a catalog index serves game-file records beside the knowledge release"`.

---

### Task 4: Page URLs for the new kinds

**Files:**
- Modify: `kb/src/lore-slug.ts:38-46` (`recordUrl`)
- Modify: `kb/src/page-urls.ts:151` (`loreUrls`)
- Create: `kb/src/catalog-paths.ts`, `kb/src/catalog-paths.test.ts`
- Modify: `packages/protocol/src/mcp.ts` `knowledgeHit.url` describe text

**Interfaces:**
- Produces: `catalogPath(kind: string, extId: string, name: string): string | null` in `kb/src/catalog-paths.ts`: `achievement` → `/database/achievements/<id>-<slug>`, `faction` → `/database/factions/<id>-<slug>`, `title` → `/database/titles/<id>-<slug>`, `quest_chain` → `/database/quest-chains/<id>-<slug>`, `instance` → `/database/instances/<mapId>-<slug>` (the rule at `web/src/lib/instances.ts:121-125`), `mount` → `/tools/collections`, `legacy_perk` → `/tools/legacy`, `race` → `/classes/choose`, any other kind → `null`. `<id>-<slug>` uses the same `segment` rule as `web/src/lib/completion-lists.ts:parseSegment` (`slugify` from `lore-slug.ts`; a name with no letters or digits leaves the bare id).
- `recordUrl` returns `SITE + catalogPath(...)` when `catalogPath` is non-null, else the existing behaviour.
- `loreUrls` also returns `abs(catalogPath(...))` for every row whose `catalogPath` is non-null, with no DB lookup for those rows.

- [ ] **Step 1: Write the failing tests**

```ts
test.each([
  ["faction", "1", "Stormwind", "/database/factions/1-stormwind"],
  ["title", "7", "%s, Champion", "/database/titles/7-s-champion"],
  ["quest_chain", "3", "***", "/database/quest-chains/3"],
  ["instance", "36", "Deadmines", "/database/instances/36-deadmines"],
  ["mount", "5", "Gray Wolf", "/tools/collections"],
  ["lore_page", "Thrall", "Thrall", null],
])("catalogPath(%s)", (kind, extId, name, want) => expect(catalogPath(kind, extId, name)).toBe(want));
test("recordUrl of a faction row is its everloot.app page", () =>
  expect(recordUrl({ kind: "faction", extId: "1", name: "Stormwind", sourceUrl: "x" }, "https://everloot.app")).toBe("https://everloot.app/database/factions/1-stormwind"));
```

- [ ] **Step 2: Run**: `cd kb && npx vitest run src/catalog-paths.test.ts src/lore-slug.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `catalog-paths.ts`; change `recordUrl` and `loreUrls` as the interface says.

- [ ] **Step 4: Run** `cd kb && npm test`. Expected: PASS (existing `page-urls` tests stay green).

- [ ] **Step 5: Update** `knowledgeHit.url`'s describe to: `"The record's page on everloot.app, absolute: an indexed lore page or a catalog page. Absent for a record the site has no page for."`; `cd packages/protocol && npm run build`.

- [ ] **Step 6: Commit**: `git commit -s -m "feat(kb): catalog records cite their everloot.app page"`.

---

### Task 5: Search over the new kinds, end to end

**Files:**
- Modify: `kb/src/mcp-server.ts` (`ToolOptions.catalog`, the five knowledge handlers)
- Modify: `web/src/lib/mcp-mount.ts` (pass `catalog`), create `web/src/lib/catalog-index.ts` (builds the index once from the JSON imports, like `files-index.ts`)
- Modify: `kb/src/cli.ts` (the `mcp` serve command gains `--game-data <root>`, default `../web/src/data/game-data`, and passes `catalog`)
- Create: `kb/test/search-catalog.test.ts` (a fixture release with a few lore rows plus the Task 3 fixture catalog)

**Interfaces:**
- Consumes: Task 3's `buildCatalogIndex`, `readCatalogFiles`, `searchCatalog`, `getCatalogEntity`, `getCatalogByName`, `isCatalogId`; `search`, `getByName`, `getDocument` from `kb/src/search.ts`; `createToolHandlers(db, options)`.
- Produces: `ToolOptions.catalog?: CatalogLoader` where `CatalogLoader = () => CatalogIndex | null | Promise<CatalogIndex | null>` (null = not connected). In `search_knowledge` and `search`: run the release search and `searchCatalog` with the same query, kinds and limit, merge exact-name hits first (release before catalog on ties), then the rest in order, cut to `limit`. `get_by_name`: both, release first. `get_entity` and `fetch`: `isCatalogId(id)` routes to the index; the catalog record's `body` is `fetch`'s `text`, its `licence` and `sourceId` fill the metadata; `url` is its `sourceUrl`. Every catalog hit's text line ends with `GAME_DATA_CREDIT`. With no loader the behaviour is exactly today's.

- [ ] **Step 1: Write the failing tests**

```ts
test("search finds a faction by name and reports its kind and page", async () => {
  const hits = await search(source, "Stormwind", 5);
  expect(hits.map((h) => h.kind)).toContain("faction");
});
test("kind narrows: a title and an item that share a name", async () => {
  const hits = await search(source, "Champion", 5, { kinds: ["title"] });
  expect(hits.every((h) => h.kind === "title")).toBe(true);
});
test("get_by_name works for every new kind", async () => {
  for (const [kind, name] of [["faction","Stormwind"],["title","%s, Champion"],["quest_chain","The Missing Diplomat"],["mount","Gray Wolf"],["instance","Deadmines"],["achievement","Loremaster"],["race","Orc"],["legacy_perk","Sturdy"]])
    expect((await getByName(source, name, kind)).length).toBe(1);
});
test("fetch returns a body and the game-file licence for a quest chain", async () => {
  const out = JSON.parse((await handlers.fetch({ id: String(chainId) })).text);
  expect(out.text).toMatch(/^The Missing Diplomat\n/);
  expect(out.metadata.kind).toBe("quest_chain");
  expect(out.metadata.licence).toMatch(/Blizzard/);
  expect(out.url).toBe("https://everloot.app/database/quest-chains/1-the-missing-diplomat");
});
test("search (ChatGPT contract) lists a catalog hit with its page url", async () => {
  const out = JSON.parse((await handlers.search({ query: "Deadmines" })).text);
  expect(out.results[0].url).toBe("https://everloot.app/database/instances/36-deadmines");
});
```

(In the tests above, `source` is the fixture release and `handlers = createToolHandlers(source, { catalog: () => index })`; `search(...)` and `getByName(...)` calls become `handlers.search_knowledge({ query, limit, kind })` and `handlers.get_by_name({ name, kind })`, asserting on `structured.hits`.)

- [ ] **Step 2: Run**: `cd kb && npx vitest run test/search-catalog.test.ts`. Expected: FAIL (no `catalog` option).

- [ ] **Step 3: Implement** the loader option and the merge in the five handlers; wire `web/src/lib/catalog-index.ts` and `mcp-mount.ts`; add `--game-data` to the kb serve command. Add one test that with no `catalog` loader the answers are byte-identical to before.

- [ ] **Step 4: Run** `cd kb && npm test && npm run typecheck`; `cd web && npm test && npm run typecheck && npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -s -m "feat(mcp): search, get_by_name, get_entity and fetch reach the game-file catalogs"`.

---

### Task 6: Confirmation line from the rollup

**Files:**
- Modify: `kb/src/mcp-server.ts` (`withPages`, `formatHits`, the `fetch` handler)
- Modify: `packages/protocol/src/mcp.ts` (`knowledgeHit`, `fetchedDocument.metadata`)
- Create: `kb/src/catalog-confirmed.ts`, `kb/src/catalog-confirmed.test.ts`

**Interfaces:**
- Consumes: `ToolOptions.completion` (`CompletionLoader`, already in `mcp-server.ts`) and `agreedCatalog(state)` from `completion-rollup.ts`.
- Produces: `confirmedCatalog(loader: CompletionLoader | undefined): Promise<ConfirmedIds | null>` where `ConfirmedIds = { achievement: Set<number>; faction: Set<number>; title: Set<number>; quest_chain: Set<number>; asOf: string | null }`; null when the loader is absent or returns no state. `confirmedLine(kind, extId, ids): string | null` = `"Confirmed by player uploads (3 or more installs agree) as of <YYYY-MM-DD>."` or null.
- Schema: `knowledgeHit` gains `confirmed: z.object({ asOf: z.string().nullable() }).optional()`; `fetchedDocument.metadata` gains the same optional field. Text answers of `search_knowledge`, `get_entity`, `get_by_name` append the line to a confirmed hit; `fetch` appends it as the last line of `text`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a faction the rollup agrees on carries a confirmed line; one it does not stays unconfirmed", async () => {
  const handlers = createToolHandlers(source, { completion: async () => fixtureCompletion /* agreed faction 1 only */ });
  const yes = await handlers.get_entity({ id: factionId(1) }), no = await handlers.get_entity({ id: factionId(2) });
  expect(yes.text).toMatch(/Confirmed by player uploads/); expect(yes.structured.hit.confirmed.asOf).toBe("2026-11-03");
  expect(no.text).not.toMatch(/Confirmed/); expect(no.structured.hit.confirmed).toBeUndefined();
});
test("with no completion loader the answer is unchanged and never throws", async () => {
  const handlers = createToolHandlers(source);
  const out = JSON.parse((await handlers.fetch({ id: String(factionId(1)) })).text);
  expect(out.metadata.confirmed).toBeUndefined();
});
```

- [ ] **Step 2: Run**: `cd kb && npx vitest run src/catalog-confirmed.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `catalog-confirmed.ts`; thread `options.completion` into `withPages`/`formatHits` through a small `annotate(hits)` step in the four handlers. Keep `search` (ChatGPT) untouched.

- [ ] **Step 4: Run** `cd kb && npm test && npm run typecheck`; `cd packages/protocol && npm test && npm run build`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -s -m "feat(mcp): catalog answers say when player uploads confirm a game-file entry"`.

---

### Task 7: Site lists read the base first

**Files:**
- Modify: `web/src/lib/completion-lists.ts` (`loadCatalog`, `CompletionCatalog`)
- Modify: `web/src/app/database/factions/page.tsx`, `titles/page.tsx`, `quest-chains/page.tsx`, `achievements/page.tsx` (one "Confirmed" column each; the empty state only when both base and rollup are empty)
- Modify: `web/src/app/database/lists.test.tsx` (add cases)

**Interfaces:**
- Produces: `type Listed<T> = T & { confirmed: boolean }`; `CompletionCatalog` = `{ achievements: Listed<AchievementEntry>[]; factions: Listed<FactionEntry>[]; titles: Listed<TitleEntry>[]; chains: Listed<ChainEntry>[]; dataAsOf: string | null; base: boolean }` where `base` says whether any base file was read. `loadCatalog()` returns the union: base entries (from the four JSON files via the `web/src/data/game-data/*.ts` wrappers; achievements from `client-achievements.json` with `category: ""` and `criteriaCount` = criteria length) with `confirmed: false`, replaced by the rollup entry with `confirmed: true` where the rollup agrees on the same id. Returns `null` only when there is no base and the rollup is unreadable.

- [ ] **Step 1: Write the failing tests** in `lists.test.tsx`

```tsx
test("factions list shows base entries unconfirmed when the rollup is null", async () => { /* mock uploadStore.loadCompletion → { state: null } */ ... expect(html).toContain("Stormwind"); expect(html).toContain("Unconfirmed"); });
test("an agreed faction shows as confirmed and keeps the rollup's header", async () => { ... expect(row).toContain("Confirmed"); });
```

- [ ] **Step 2: Run**: `cd web && npx vitest run src/app/database/lists.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement** the merge in `loadCatalog` and the column in the four pages. Match the existing `DataTable` column style.

- [ ] **Step 4: Run** `cd web && npm test && npm run typecheck && npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -s -m "feat(web): faction, title, quest chain and achievement lists start from the game files"`.

---

### Task 8: Merge-day runbook and PR

**Files:**
- Create: `docs/2026-11-03-catalog-kinds-release.md`

- [ ] **Step 1: Write the runbook** (under 30 lines): no knowledge release is cut for this PR (the catalogs are served from the committed JSON, never from the release). After merge: the deploy on `main` carries the files; check `https://everloot.app/mcp/public` `get_by_name` for `Stormwind` with kind `faction` and `search` for `Deadmines`; confirm the hit's licence line carries Blizzard's credit and the url opens. Note that the `KNOWLEDGE_KINDS` enum now lists kinds the release itself never holds, by design.

- [ ] **Step 2: Open the PR** with `gh pr create --draft` using the title in Global Constraints and a body that lists the eight kinds, why `recipe` waits, the three new layers with their ledger decision date, and links the runbook. End the body with the attribution line from the session reminder. Do not mark ready; do not merge.

- [ ] **Step 3: Commit and push**: `git push -u origin feat/mcp-catalog-kinds`.
