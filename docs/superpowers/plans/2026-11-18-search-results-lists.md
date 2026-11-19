# Search results as the database lists: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/search` becomes a short, factual overview whose tabs and footers open the database lists with the query applied, and the lists match names the way search does.

**Architecture:** The word-order and typo matchers leave `site-search.ts` for a small `name-match.ts` the lists can import without pulling in tools, docs and the wiki. Each list swaps its `includes(text)` line for `matchNames` and orders by rank when no sort is asked for. The search page reads the world facts for its NPC and quest rows, draws a tab row that links the lists, and redirects `in=<type>` to the list.

**Tech Stack:** Next.js app router (server components), Vitest with `renderToStaticMarkup`, the `DataTable`/`LinkTabs` design-system parts.

**Spec:** `docs/superpowers/specs/2026-11-18-search-results-lists-design.md`

## Global Constraints

- No gradients or opacity dimming in `web/src` (design guard); only existing tokens and parts.
- PR title at most 100 characters; CHANGELOG line starts `- Site:` under `## [Unreleased]` / `### Added` or `### Changed`.
- Commits signed off (`git commit -s`), no AI attribution lines.
- A row in the overview never shows a fact its page would not: facts come from `publicQuests` and `npcRows` only.
- `siteSearch`'s public signature, `only` and paged scopes stay as they are (API and MCP callers).

## Review Focus

1. A query that is an id (`176`) on a list: the list's id rule must still find the row and never respell. Test in Task 2 (quests).
2. A text query with a sort asked for (`?q=hogger&sort=level`): rank must not override the sort. Test in Task 2 (NPCs).
3. A query of only short words (`of`) on a list: the typo fallback must not fire and the list must stay a substring match. Test in Task 1.
4. The search page with the aggregate unreachable: NPC and quest rows still render with name and id, and the fact columns are left out. Test in Task 3.
5. `in=achievement` (a paged scope) and `in=lore`: the first redirects to `/database/achievements?q=`, the second still renders the lore list. Test in Task 3.

---

### Task 1: `name-match.ts` with `matchNames`

**Files:**
- Create: `web/src/lib/name-match.ts`
- Create: `web/src/lib/name-match.test.ts`
- Modify: `web/src/lib/site-search.ts` (lines 47–150: move `phraseRank`, `atWordStart`, `rank`, `Match`, `byWords`, `byPhrase`, `TYPO_MIN`, `typoEdits`, `editDistance`, `byTypo`, `wordChar`, `respelling` out; import them back)

**Interfaces:**
- Produces: `export type Match = (name: string) => number | null`; `export function byWords(q: string): Match`; `export function byPhrase(q: string): Match`; `export function byTypo(q: string): Match | null`; `export function editDistance(a: string, b: string, max: number): number`; `export function respelling(q: string, name: string): string`; `export function rank(name: string, q: string, words?: readonly string[]): number | null`;
  `export interface NameHit<T> { row: T; r: number }`; `export function matchNames<T>(rows: readonly T[], q: string, name: (row: T) => string | null | undefined): { hits: NameHit<T>[]; respelled?: string }` where `q` is already trimmed and lowercased, hits keep `rows`' order (stable, not sorted), `respelled` is set only when the typo fallback found the hits.
- `site-search.ts` keeps `export { byTypo, editDistance } from "./name-match"` so `site-search.test.ts` still imports them.

- [ ] **Step 1: Write the failing tests** in `web/src/lib/name-match.test.ts`

```ts
import { expect, test } from "vitest";
import { matchNames } from "./name-match";
const rows = [{ id: 1, n: "Linen Cloth" }, { id: 2, n: "Bolt of Linen Cloth" }, { id: 3, n: "Cloth Linen Scraps" }, { id: 4, n: "Wool Cloth" }];
const name = (r: { n: string }) => r.n;
test("words match in any order, ranked whole name, prefix, contains, word starts, anywhere", () => {
  const { hits, respelled } = matchNames(rows, "linen cloth", name);
  expect(hits.map((h) => [h.row.id, h.r])).toEqual([[1, 0], [2, 2], [3, 3]]);
  expect(respelled).toBeUndefined();
});
test("a typo finds the name only when nothing matches as typed, and says how it read the query", () => {
  const { hits, respelled } = matchNames(rows, "lnen clth", name);
  expect(hits.map((h) => h.row.id)).toEqual([1, 2, 3]);
  expect(respelled).toBe("linen cloth");
});
test("short words never read typos, and a name of null never matches", () => {
  expect(matchNames([...rows, { id: 5, n: null as unknown as string }], "of", name).hits.map((h) => h.row.id)).toEqual([2]);
  expect(matchNames(rows, "ot", name).hits).toEqual([]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx vitest run src/lib/name-match.test.ts`
Expected: FAIL, cannot resolve `./name-match`.

- [ ] **Step 3: Create `name-match.ts`** by moving the matcher block out of `site-search.ts` unchanged, then add `matchNames`: run `byWords(q)` over every row whose name is a string; when no hit and `byTypo(q)` is non-null, run that instead and set `respelled` from `respelling(q, bestHit.name)` where best is the lowest `r` (ties: first). Update `site-search.ts` to import what it used and re-export `byTypo` and `editDistance`.

- [ ] **Step 4: Run the matcher and search tests**

Run: `cd web && npx vitest run src/lib/name-match.test.ts src/lib/site-search.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/name-match.ts web/src/lib/name-match.test.ts web/src/lib/site-search.ts
git commit -s -m "refactor(web): the name matchers move to name-match.ts with a matchNames helper for the lists"
```

### Task 2: The lists match like search

**Files:**
- Modify: `web/src/app/database/list-parts.tsx` (add `Respelled`)
- Modify: `web/src/app/database/quests/page.tsx:67-78`, `npcs/page.tsx:72-83`, `objects/page.tsx:50-56`, `zones/page.tsx:46-50`, `instances/page.tsx:49-55`, `achievements/page.tsx:46-53`, `factions/page.tsx` (same lines), `titles/page.tsx:34-38`, `quest-chains/page.tsx:34-38`
- Modify: `web/src/lib/items.ts:278-296` (`listItems`) and `web/src/app/database/items/category-page.tsx` (the line above the table)
- Test: `web/src/app/database/lists.test.tsx`, `web/src/app/database/completion-lists.test.tsx`, `web/src/lib/items.test.ts` (or the nearest existing items list test)

**Interfaces:**
- Consumes: `matchNames` from Task 1.
- Produces: `export function Respelled({ q }: { q: string })` in `list-parts.tsx`, rendering `<p data-respelled className="mb-2 text-cell text-fg-2">Showing results for {q}</p>`.
- `listItems(base, q, ctx)` keeps its signature; with `q.q` text, no id and no `q.sort`, its rows come back in rank order (then `sortItems`'s default order within a rank). A new optional `ctx.respelled?: (q: string) => void` callback is not needed: instead add `export function matchItemNames(base, text, ctx): { ids: Set<number>; rank: Map<number, number>; respelled?: string }` used by `listItems` and by the category page for its line.

The pattern for each list (quests shown; the rest are the same four lines):

```ts
const found = text && id === null ? matchNames(all, text, titleOf) : null;
const ranked = found ? new Map(found.hits.map((h) => [h.row, h.r])) : null;
const matched = all.filter((x) => (!text || (id !== null ? x.questId === id : ranked!.has(x))) && /* the other facets unchanged */);
const rows = sortRows(matched, key, sort.desc, (x) => x.questId);
const ordered = ranked && !q.sort ? [...rows].sort((a, b) => ranked.get(a)! - ranked.get(b)!) : rows;
```

(`Array.prototype.sort` is stable, so the default order holds within a rank.) The page renders `{found?.respelled && <Respelled q={found.respelled} />}` above the table.

- [ ] **Step 1: Write the failing list tests** in `lists.test.tsx` (after the quest tests):

```ts
test("the lists match every word in any order, an exact name first, and read a typo when nothing matches as typed", async () => {
  expect(rows(await html(QuestList(search({ q: "hogger wanted" }))), "quests")).toEqual([176]);
  expect(rows(await html(QuestList(search({ q: "wanted hoggr" }))), "quests")).toEqual([176]);
  expect(await html(QuestList(search({ q: "wanted hoggr" })))).toContain("Showing results for wanted hogger");
  expect(await html(QuestList(search({ q: "hogger wanted" })))).not.toContain("Showing results for");
  // An id keeps its own rule and never respells; a sort asked for wins over the rank.
  expect(rows(await html(QuestList(search({ q: "176" }))), "quests")).toEqual([176]);
  expect(rows(await html(NpcList(search({ q: "guard hogger", sort: "-level" }))), "npcs")).toEqual([]);
  expect(rows(await html(NpcList(search({ q: "hogger" }))), "npcs")).toEqual([448]);
  expect(rows(await html(ZoneList(search({ q: "forest elwynn" }))), "zones").length).toBeGreaterThan(0);
});
```

Add one assertion to `completion-lists.test.tsx`'s "filters, sort and the name box work from the URL" test that a two-word reversed query finds the entry, and one in the items list test that `listItems` with `q: "cloth linen"` finds Linen Cloth and lists it before "Bolt of Linen Cloth".

- [ ] **Step 2: Run to see them fail**

Run: `cd web && npx vitest run src/app/database/lists.test.tsx src/app/database/completion-lists.test.tsx`
Expected: the new tests FAIL (reversed words find nothing).

- [ ] **Step 3: Add `Respelled` to `list-parts.tsx` and apply the pattern to the nine lists and `listItems`/the category page.**

- [ ] **Step 4: Run the list tests, then the item tests**

Run: `cd web && npx vitest run src/app/database src/lib/items.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/database web/src/lib/items.ts web/src/lib/items.test.ts
git commit -s -m "feat(web): the database lists match a name by its words in any order and past a typo, exact names first"
```

### Task 3: The search page: facts, tab row, list links, redirect

**Files:**
- Modify: `web/src/app/search/page.tsx` (whole `SearchPage` and `ResultTable`; keep `LoreResults`, `SearchStart`)
- Test: `web/src/app/search/page.test.tsx`

**Interfaces:**
- Consumes: `siteSearch(q, { limit: 5, names })`; `loadWorldFacts()` and `computeRollups()` from `@/lib/rollup-compute`; `publicQuests`, `npcRows` from `@/lib/world-lists`; `SIDE_LABEL` from `@kb/world-pages` or the quests page (export it from `web/src/lib/world-lists.ts` if it lives inline in `quests/page.tsx`); `redirect` from `next/navigation`.
- Produces: `const OVERVIEW_LIMIT = 5`; `const LIST_OF: Partial<Record<SearchType, string>> = { item: "/database/items", npc: "/database/npcs", quest: "/database/quests", object: "/database/objects", zone: "/database/zones", instance: "/database/instances", achievement: "/database/achievements", faction: "/database/factions", title: "/database/titles", chain: "/database/quest-chains" }`; `const listHrefFor = (type: SearchType, q: string) => LIST_OF[type] && `${LIST_OF[type]}?q=${encodeURIComponent(q)}``.
- Facts: `async function overviewFacts(groups): Promise<{ quests: Map<number, QuestRow>; npcs: Map<number, NpcRow> }>`: collects the quest and NPC ids of those two groups, returns empty maps when neither group exists or the facts are unreachable, else `publicQuests({ ...facts, quests: facts.quests.filter((r) => ids.has(r.questId)) })` and `npcRows({ ...facts, npcs: facts.npcs.filter(...) }, rates.filter((r) => r.sourceNpcId !== undefined && ids.has(r.sourceNpcId)))`, keyed by id. `Promise.all` with the search.
- Columns per group in `ResultTable` (all `SparseColumn` with `blank`, through `filledColumns`): quest: name, Level, Side, Category, ID; npc: name, Level, Type, Zone, Drops, ID; item: name, Type, ID (as today); others: name, note, ID (as today). `meta` for the phone line joins the same facts with " · ".
- Tabs: `[{ label: "All", href: base, current: true }, ...groups.map(g => ({ label: g.heading, count: g.total, href: listHrefFor(g.type, q) ?? (g.type === "lore" ? `${base}&in=lore` : `${base}#results-${g.type}`), current: false })), ...(people ? [{ label: "Characters", href: `/players?q=` }, { label: "Guilds", href: `/guilds?q=` }] : [])]`, rendered in its own `div` under the title/field row; no `aside`.
- Redirect: before searching, `if (scope && LIST_OF[scope]) redirect(listHrefFor(scope, q))` where `scope` is `isResultScope(first(params.in))`; with an empty `q` redirect to the bare list.
- The footer of a group with `more`: `<Link href={listHrefFor(type, q) ?? `${base}&in=lore`}>All {total} {heading.toLowerCase()}</Link>` (lore keeps "lore results"). `SCOPED_LIMIT`, `DATABASE_LIST`, the pager and the scoped branch go.

- [ ] **Step 1: Rewrite the four scoped tests** (`a scoped search that found more…`, `…lists every match…`, `truncated object results…`, `the overview keeps its All-N link…`) and add the new ones in `page.test.tsx`. Mock `@/lib/rollup-compute` with `loadWorldFacts`/`computeRollups` returning a `facts` fixture the test controls (default unreachable), and `next/navigation` with `redirect: (to) => { throw new Error(`REDIRECT ${to}`) }`.

```ts
test("a scoped search opens the database list with the query; a paged scope too; lore stays", async () => {
  await expect(render({ q: "potion", in: "item" })).rejects.toThrow("REDIRECT /database/items?q=potion");
  await expect(render({ q: "loremaster", in: "achievement" })).rejects.toThrow("REDIRECT /database/achievements?q=loremaster");
  await expect(render({ q: "", in: "npc" })).rejects.toThrow("REDIRECT /database/npcs");
  expect(await renderLore({ q: "thrall" })).toContain("Search the lore archive");
});
test("the tab row lists All, every group with its count linking its list, and Characters and Guilds when the text could start a name", async () => {
  siteSearch.groups = [
    { type: "quest", heading: "Quests", total: 6, results: [{ label: "Test of Lore", href: "/database/quests/1152", exact: true, id: 1152 }] },
    { type: "lore", heading: "Lore archive", total: 20, results: [{ label: "Test of Lore", href: "/lore/1-test-of-lore", exact: true }] },
  ];
  const html = await render({ q: "test of lore" });
  expect(html).toContain('href="/database/quests?q=test%20of%20lore"');
  expect(html).toMatch(/Quests<span[^>]*> \(6\)/);
  expect(html).toContain('href="/search?q=test%20of%20lore&amp;in=lore"');
  expect(html).toContain('href="/players?q=test%20of%20lore"');
  expect(html).toContain('href="/guilds?q=test%20of%20lore"');
  // The group footer opens the list too, and the "All 6 quests" copy stays.
  expect(html).toContain(">All 6 quests</a>");
});
test("quest rows show level, side and category and NPC rows level, type, zone and drops, from the same rows the lists draw; unreachable facts leave the columns out", async () => {
  siteSearch.groups = [
    { type: "quest", heading: "Quests", total: 1, results: [{ label: "Wanted: Hogger", href: "/database/quests/176", exact: true, id: 176 }] },
    { type: "npc", heading: "NPCs", total: 1, results: [{ label: "Hogger", href: "/database/npcs/448", exact: true, id: 448 }] },
  ];
  facts.current = HOGGER_FACTS; // level 10 Alliance quest in Elwynn Forest; level 11 Humanoid elite NPC in Elwynn Forest with 1 public drop
  const html = await render({ q: "hogger" });
  for (const cell of [">10<", ">Alliance<", ">Elwynn Forest<", ">11<", ">Humanoid<", ">1<"]) expect(html).toContain(cell);
  expect(html).toContain(">Level<");
  facts.current = UNREACHABLE;
  const bare = await render({ q: "hogger" });
  expect(bare).toContain('href="/database/npcs/448"');
  expect(bare).not.toContain(">Level<");
});
```

Keep the existing `the search is a plain GET form…`, `characters and guilds join…`, lore tests as they are; drop the `Pager` expectations.

- [ ] **Step 2: Run to see them fail**

Run: `cd web && npx vitest run src/app/search/page.test.tsx`
Expected: the new and rewritten tests FAIL.

- [ ] **Step 3: Rewrite `SearchPage` and `ResultTable` per the Interfaces block.** Read `web/src/app/database/quests/page.tsx:90-110` and `npcs/page.tsx:90-100` for the exact cell renderers (`SIDE_LABEL`, `RANK_LABEL`, the `dash`) so the overview prints the same words.

- [ ] **Step 4: Run the search tests and the header/search-bar tests**

Run: `cd web && npx vitest run src/app/search src/components/header-search-surface.test.tsx src/components/ui/search-bar.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/search
git commit -s -m "feat(web): search shows quest and NPC facts, a tab row that opens each database list with the query, and scoped searches land on the lists"
```

### Task 4: Changelog, full suite, PR

**Files:**
- Modify: `CHANGELOG.md` (`### Changed` under Unreleased)

- [ ] **Step 1: Add the line**

`- Site: a search shows up to five results per type with a quest's level, side and category and an NPC's level, type, zone and drop count; a tab row opens each type's database list with the query applied (characters and guilds included), and the lists find a name by its words in any order or past a small typo, exact names first.`

- [ ] **Step 2: Run lint, typecheck and the whole web suite**

Run: `cd web && npm run lint && npm run typecheck && npm test`
Expected: 0 lint errors, 0 type errors, 0 failing tests.

- [ ] **Step 3: Commit, push, open the PR** (title under 100 characters, body with what changed and what was tested, no AI lines), then verify `/search?q=test+of+lore` and its Quests tab on the preview or after merge.
