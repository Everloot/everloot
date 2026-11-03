# PR 4: Routing descriptions, full game name, version bump — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every tool description opens with a verb, routes to its siblings and documents every parameter; the listing text says "World of Warcraft: Forever"; the server, registry manifest and protocol package take their version bump.

**Architecture:** The existing unmerged branch `origin/feat/mcp-tool-descriptions` (two commits, rebases onto `main` with no conflicts) already rewrites all descriptions in that pattern. This PR starts from it, adds a parameter-coverage test, the descriptions of the parameters PRs 1 to 3 add, the game-name text and the version bumps, then a reviewer pass scored on Glama's six dimensions.

**Tech Stack:** TypeScript, zod 4, vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-mcp-parity-batch-design.md` (section "PR 4").

**Branch:** `feat/mcp-tool-descriptions` (existing; `git checkout -b feat/mcp-tool-descriptions origin/feat/mcp-tool-descriptions`). Rebased onto PR 3's branch on merge day. Held unmerged; merges last.

## Global Constraints

- `search` and `fetch` keep their contract words ("ChatGPT connector", "An id from a search result").
- Versions: `server.json.version` and `SERVER_VERSION` (`kb/src/mcp-server.ts:52`) to `0.9.0`; `web/public/.well-known/mcp/server-card.json` version to `0.9.0`; `packages/protocol/package.json` to `1.24.0` (`packages/protocol/scripts/check-semver.ts` must pass).
- Every `inputSchema` field of every tool has a non-empty `.description` (Glama's "schema description coverage").
- Commits `-s`. PR title: `docs(mcp): every tool says what it returns, when to use it and where its id comes from; 0.9.0`.

## Review Focus

1. A field added by PRs 1 to 3 (`field`, `offset`, `limit`, `builds`, the new `kind` enum values) that reaches `main` without a describe: the coverage test fails (Task 2).
2. The ChatGPT `search` description changed in a way that drops "ChatGPT": a pinned test fails (Task 2).
3. `check-semver` rejecting 1.24.0 because the diff is breaking: the task says to stop and report, not to force (Task 4).
4. `docs/mcp` pages (`web/src/lib/docs/nav.ts` groups) listing a tool whose first sentence is now longer than the summary cut: the existing docs page test must stay green (Task 3).
5. The Glama README field and `server.json` description both say the full name once and "WoW: Forever" after; a reviewer confirms by reading both (Task 3).

---

### Task 1: Start from the existing branch

- [ ] **Step 1**: `git fetch origin && git checkout -b feat/mcp-tool-descriptions origin/feat/mcp-tool-descriptions && git rebase main`. Expected: clean.
- [ ] **Step 2**: `cd packages/protocol && npm test && npm run build`; `cd kb && npm test`. Expected: PASS. If a test fails on the inherited commits, fix it in a commit of its own and say so in the PR body.

---

### Task 2: Parameter coverage and contract pins

**Files:**
- Create: `packages/protocol/src/mcp-descriptions.test.ts`

- [ ] **Step 1: Write the tests**

```ts
test("every input field of every tool is described", () => {
  for (const [name, tool] of Object.entries(MCP_TOOLS)) for (const [field, schema] of Object.entries(tool.inputSchema))
    expect(schema.description, `${name}.${field}`).toMatch(/\S/);
});
test("every description opens with a verb in the third person", () => {
  const VERBS = /^(Returns|Searches|Finds|Lists|Reads|Decodes|Compares|Fetches|Looks up|Gives|Shows|Ranks|Counts|Answers)\b/;
  for (const [name, tool] of Object.entries(MCP_TOOLS)) expect(tool.description, name).toMatch(VERBS);
});
test("the ChatGPT contract words stay", () => {
  expect(MCP_TOOLS.search.description).toMatch(/ChatGPT/);
  expect(MCP_TOOLS.fetch.inputSchema.id.description).toBe("An id from a search result.");
});
```

- [ ] **Step 2: Run**: `cd packages/protocol && npx vitest run src/mcp-descriptions.test.ts`. Expected: some FAIL (fields without describe, descriptions not starting with a verb).
- [ ] **Step 3: Fix each failure in `mcp.ts`** by adding describes and reshaping openings; extend `VERBS` only with a verb that reads naturally, never with a noun.
- [ ] **Step 4: Run** the test, then `npm run build`. PASS; commit schema JSON.
- [ ] **Step 5: Commit**: `git commit -s -m "docs(mcp): every parameter is described and every description opens with a verb"`.

---

### Task 3: New parameters, full game name, listing docs

**Files:**
- Modify: `packages/protocol/src/mcp.ts` (describes for `kind` enum values via the `search_knowledge.kind` and `get_by_name.kind` describe text listing the catalog kinds; `get_entity`/`fetch` `field`/`offset`/`limit`; `talent_tree.builds`; `knowledgeHit.confirmed`), only where PRs 1 to 3 did not already describe them (on merge day the rebase brings them; until then, write the describe text here so the branch is ready and reconcile on rebase)
- Modify: `kb/src/mcp-server.ts:56` (`SERVER_DESCRIPTION`), `server.json` `description`, `web/public/.well-known/mcp/server-card.json` description
- Modify: `docs/2026-10-18-mcp-listings.md` (registry one-liner, Claude one-liner, long description first sentence; the Glama row: claimed by DNS 2026-11-03, verified, publisher details filled; remove "token file pending")

**Interfaces:**
- `SERVER_DESCRIPTION` = `"World of Warcraft: Forever knowledge from player reports and game files, with sources, under CC BY-SA 4.0."`
- `server.json.description` (≤100 chars) = `"World of Warcraft: Forever lore and player-observed drops, vendors, quests, professions and talents."` (99 chars; count it).
- Listings doc one-liners: replace the first "WoW: Forever" with "World of Warcraft: Forever" and keep every later mention as "WoW: Forever".

- [ ] **Step 1**: Make the edits. Run `cd web && npx vitest run src/lib/docs` (the docs nav/page tests) and `cd kb && npm test`. PASS.
- [ ] **Step 2: Commit**: `git commit -s -m "docs(mcp): the listing says World of Warcraft: Forever once, and the Glama row is current"`.

---

### Task 4: Version bumps

- [ ] **Step 1**: Set `server.json` and `SERVER_VERSION` to `0.9.0`; `server-card.json` to `0.9.0`; `packages/protocol/package.json` to `1.24.0`. Find the test that pins `server.json.version === SERVER_VERSION` (grep `SERVER_VERSION` in `kb/src/*.test.ts` and `web/src`) and keep it green.
- [ ] **Step 2**: `cd packages/protocol && npx tsx scripts/check-semver.ts` (read its usage line first; it may want the previous tag). Expected: accepts a minor bump. If it reports a breaking change, stop and report which export broke; do not force.
- [ ] **Step 3**: `cd kb && npm test && npm run typecheck`; `cd web && npm test && npm run typecheck`. PASS.
- [ ] **Step 4: Commit**: `git commit -s -m "chore(mcp): 0.9.0, protocol 1.24.0"`.

---

### Task 5: Reviewer pass on Glama's six dimensions

- [ ] **Step 1**: Dispatch a reviewer subagent with `packages/protocol/src/mcp.ts` and this brief: "For each of the 32 tools, score the description 1 to 5 on Behavior, Conciseness, Completeness, Parameters, Purpose and Usage Guidelines as Glama's TDQS does (purpose stated with a verb; what the answer holds; when to use it and which sibling instead; how to get ids; every parameter with default and bounds; no run-on sentences). Report every tool with any dimension at 3 or below, quoting the sentence to change." Effort: medium.
- [ ] **Step 2**: Rewrite each reported tool; keep `search`/`fetch` contract words. Re-run Task 2's test and `npm run build`.
- [ ] **Step 3: Commit**: `git commit -s -m "docs(mcp): descriptions reviewed against the six scored dimensions"`.

---

### Task 6: PR

- [ ] **Step 1**: `git push -u origin feat/mcp-tool-descriptions --force-with-lease` (the branch was rebased); `gh pr create --draft` with the title above; body: inherits the two earlier commits, the coverage test, the game-name change, the versions, that this PR merges last and carries the registry refresh, and the attribution line. Do not mark ready; do not merge.
