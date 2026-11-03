# PR 3: Starter builds inside talent_tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A curated `build` knowledge kind holds the Everloot team's starter builds with share codes; `talent_tree` lists them for a class when asked, labelled as the team's and never as observed.

**Architecture:** Starter builds are curated YAML entries read by the existing `importCurated`, extended to carry a validated `data` block. The `talent_tree` handler gains access to the release and lists `build` rows for the class. Draft entries never enter the database. The observed popular-build rollup is a later PR.

**Tech Stack:** TypeScript, zod 4, yaml, vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-mcp-parity-batch-design.md` (section "PR 3").

**Branch:** `feat/mcp-starter-builds` from `main` (rebase onto PR 1's branch on merge day; it needs the widened kind list from PR 1 Task 1, so cherry-pick that commit onto this branch at the start and drop it on rebase). Held unmerged.

## Global Constraints

- No new tools. `talent_tree` gains one boolean parameter.
- Label on every starter build in text and structure: `"Everloot team starter build, not observed"`.
- A starter build's share code must decode (`decodeBuild`) and resolve (`resolveBuild`) for its class against the site catalog (`kb/src/talents/site-catalogs.ts:siteCatalog`), or the import fails loudly.
- Entries with `status: draft` are never imported.
- Tests as in PR 1. Commits `-s`. PR title: `feat(mcp): talent_tree lists the team's starter builds with share codes`.

## Review Focus

1. A YAML entry whose share code is for another class: import throws with the file, entry index and both class names (Task 2 test).
2. `talent_tree` with `builds: true` for a class with no published build: the text says `"No starter build published yet for <Class>."` and `starterBuilds` is `[]`, never an invented build (Task 3 test).
3. `builds: true` with a `tree` that none of the builds lean on: the tree listing still returns and `starterBuilds` is `[]` with a line saying which trees have builds (Task 3 test).
4. A published entry missing `purpose`: import throws naming the field (Task 2 test).
5. The site's talent calculator link for each build opens the shared build: `url` is `talentBuildUrl(class, code)` from `kb/src/page-urls.ts`, the same helper `talent_plan` uses (Task 3 test).

---

### Task 1: The `build` kind

**Files:**
- Modify: `packages/protocol/src/mcp.ts:14` (`KNOWLEDGE_KINDS` append `"build"`), `kb/src/entities.ts` (`Kind`, `ALL_KINDS`), `kb/src/db.ts` CHECK
- Test: `packages/protocol/src/mcp.test.ts`, `kb/src/db.test.ts` (extend PR 1's tests; if PR 1 Task 1 is not on this branch, cherry-pick it first)

- [ ] **Step 1: Test**: extend the PR 1 assertions so the last kind is `"build"`.
- [ ] **Step 2: Run**; expected FAIL. **Step 3: Append** `"build"` in the three places. **Step 4: Run** `cd kb && npm test`; `cd packages/protocol && npm test && npm run build`. PASS; commit schema JSON.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(protocol): a build kind for curated starter builds"`.

---

### Task 2: Curated builds file and validated `data`

**Files:**
- Modify: `kb/src/importers/curated.ts` (optional `data` block; per-kind validation for `build`; skip `status: draft`)
- Create: `kb/curated/builds.yaml` (one entry per class in `TALENT_CLASSES`, each `status: draft`, with a real share code made in `/tools/talents` for the current build, purpose `leveling`)
- Create: `kb/src/importers/curated-builds.test.ts`
- Modify: `kb/src/importers/curated.test.ts` if it exists (drafts skipped)

**Interfaces:**
- YAML entry for kind `build`: the seven required fields as today (`id` kebab-case such as `warrior-leveling-arms`, `name` such as `"Warrior leveling: Arms"`, `body` the team's reasons in a few sentences, `source_url` the shared build page), plus `data: { class: <TALENT_CLASSES>, tree: string, purpose: "leveling" | "dungeon" | "raid" | "pvp", share_code: string, points: number, build: string, status: "draft" | "published" }`.
- Produces: `BuildData` zod schema exported from `kb/src/importers/curated.ts`: `{ class, tree, purpose, shareCode, points, build, status }` (camelCase in the DB `data` column). `importCurated` stores `data` for any kind when present; for `build` it validates with `BuildData`, decodes `shareCode` with `decodeBuild` and `resolveBuild(siteCatalog(class), shared)`, throws `"<file>: entry <i> share code is for <other> not <class>"` on `other-class`, and skips the row when `status === "draft"`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a published build row lands with its data; a draft is skipped", async () => {
  await importCurated(db, fixtureDirWithOnePublishedOneDraft);
  const rows = db.prepare("SELECT name, data FROM entities WHERE kind = 'build'").all();
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0].data)).toMatchObject({ class: "warrior", purpose: "leveling", status: "published" });
});
test("a share code of another class fails the import", async () => {
  await expect(importCurated(db, fixtureWrongClass)).rejects.toThrow(/share code is for mage not warrior/);
});
test("a published entry without purpose fails the import", async () => {
  await expect(importCurated(db, fixtureNoPurpose)).rejects.toThrow(/purpose/);
});
test("every entry in kb/curated/builds.yaml decodes and resolves for its class", async () => {
  for (const e of parse(readFileSync("curated/builds.yaml", "utf8"))) {
    const d = decodeBuild(e.data.share_code); expect(d.ok).toBe(true);
    expect(resolveBuild(siteCatalog(e.data.class), d.build).ok).toBe(true);
  }
});
```

- [ ] **Step 2: Run**: `cd kb && npx vitest run src/importers/curated-builds.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `curated.ts`; write `builds.yaml` with nine draft entries. Make each share code by encoding a minimal valid build with `encodeBuild` against the class's catalog in a one-off script (not committed), or paste codes from `/tools/talents`; the last test proves them.
- [ ] **Step 4: Run** `cd kb && npm test && npm run typecheck`. PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(kb): curated starter builds, drafts until the team publishes them"`.

---

### Task 3: `talent_tree` lists starter builds

**Files:**
- Modify: `packages/protocol/src/mcp.ts` (`talent_tree.inputSchema` gains `builds`; `outputSchema` gains `starterBuilds`)
- Modify: `kb/src/talent-tools.ts` (`handleTalentTree(args, db?)`), `kb/src/mcp-server.ts:723` (pass `db`)
- Modify: `kb/src/search.ts` (`listByKind`)
- Test: `kb/src/talent-tools.test.ts` (exists or create)

**Interfaces:**
- Input: `builds: z.boolean().default(false)` describe `"Also list the Everloot team's starter builds for the class, with share codes. They are the team's, not observed."`.
- Output: `starterBuilds: z.array(z.object({ name: z.string(), purpose: z.enum(["leveling","dungeon","raid","pvp"]), tree: z.string(), shareCode: z.string(), points: z.number().int(), build: z.string(), url: z.string(), label: z.literal("Everloot team starter build, not observed") })).optional()`.
- Produces: `listByKind(source: ReleaseSource, kind: Kind, where?: { dataKey: string; equals: string }): Promise<(SearchHit & { data: Record<string, unknown> })[]>` in `search.ts`, SQL `json_extract(data, '$.' || key) = ?`, name order.
- `handleTalentTree(args, db?: ReleaseSource)`: when `args.builds` and `db`, append after the tree lines: `"Starter builds (Everloot team, not observed):"` then one line per build `"- <name> (<purpose>, <tree>, <points> points, build <build>): <shareCode> <url>"`; filtered to `tree` when given; empty → `"No starter build published yet for <Class>."` (plus `"Builds exist for: <trees>"` when a tree filter emptied it). `url` = `talentBuildUrl(args.class, shareCode)`.

- [ ] **Step 1: Write the failing tests** with a fixture release holding two published warrior builds (Arms leveling, Protection dungeon):

```ts
test("builds: true lists starter builds with label and url", async () => {
  const out = await handleTalentTree({ class: "warrior", builds: true }, source);
  expect(out.structured.starterBuilds).toHaveLength(2);
  expect(out.structured.starterBuilds[0]).toMatchObject({ label: "Everloot team starter build, not observed", url: expect.stringContaining("/tools/talents/warrior") });
  expect(out.text).toMatch(/Starter builds \(Everloot team, not observed\)/);
});
test("tree filter narrows and says which trees have builds when none match", async () => {
  const out = await handleTalentTree({ class: "warrior", tree: "Fury", builds: true }, source);
  expect(out.structured.starterBuilds).toEqual([]);
  expect(out.text).toMatch(/Builds exist for: Arms, Protection/);
});
test("a class with no builds says so", async () => {
  const out = await handleTalentTree({ class: "mage", builds: true }, source);
  expect(out.text).toMatch(/No starter build published yet for Mage\./);
});
test("builds: false leaves the answer exactly as before", async () => {
  expect(await handleTalentTree({ class: "warrior" }, source)).toEqual(await handleTalentTree({ class: "warrior" }));
});
```

- [ ] **Step 2: Run**: `cd kb && npx vitest run src/talent-tools.test.ts`. FAIL.
- [ ] **Step 3: Implement** `listByKind`, the schema, the handler change, and pass `db` at `mcp-server.ts:723`.
- [ ] **Step 4: Run** `cd kb && npm test && npm run typecheck`; `cd packages/protocol && npm test && npm run build`. PASS; commit schema JSON.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(mcp): talent_tree lists the team's starter builds with share codes"`.

---

### Task 4: PR

- [ ] **Step 1**: `git push -u origin feat/mcp-starter-builds`; `gh pr create --draft` with the title above; body: the `build` kind, the YAML format with the `data` block, that all nine entries are drafts until Carlos publishes them (flip `status`), that the observed popular build is a later PR, and the attribution line. Do not mark ready; do not merge.
