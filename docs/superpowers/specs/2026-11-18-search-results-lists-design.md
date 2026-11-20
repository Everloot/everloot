# Search results: the database lists, filtered

Carlos searched "test of lore" on 2026-11-18 and got six identical quest rows (a name and an id each) under a tab strip crammed beside the field, with twenty Warcraft Wiki copies below them that looked richer than the game data. Wowhead answers the same query with one table per type and that type's own columns: level, required level, side, rewards, experience, zone. The point of Everloot is to be the reference players open instead: a result row has to say what the thing is and where it lives, and lead to the page with the loot table and its percentages.

## Intent

The `/search` page becomes a short overview, and every type's tab opens the database list for that type with the query applied. The lists already have the columns, the sorts, the level and side and zone filters and the paging; search stops drawing its own shorter copy of them. A result row in the overview carries the facts that tell twins apart (a quest's level, side and category; an NPC's level, type, zone and drop count), read from the same aggregate the lists read.

## Goals

- A quest search shows level, side and category per row; an NPC search shows level, type, zone and how many items have a public drop rate from it.
- A tab strip on its own row, every matched type with its count, Characters and Guilds among them, in the order the overview lists the groups.
- Each tab, and each group's "All N" footer, opens the list page for that type with `?q=` applied, so the reader gets the full table, sorts and filters.
- The lists match a name the way search does: every typed word in any order, and past a small typo when nothing matches as typed, with the same "Showing results for" line. Exact names lead when no sort is asked for.
- Old links keep working: `/search?q=x&in=item` and the search box's scope chips land on the list; `in=lore`, `page=` and `type=` still open the lore list.

## Non-goals

- The site nav (Lookup, Database, Tools, Guides) and the placement of Players, Guilds and Rankings in it: a second project.
- Database list speed (audit move 2): the lists read the stored aggregate as before.
- The typeahead, the public `/api/suggest`, the MCP search tools and the `siteSearch` library's `only` and paged scopes: unchanged, they have other callers.
- The empty-state "What you can search" list and the lore archive list.
- Wowhead's "Top results" cards and guides column.

## Anti-goals

- A second row renderer per type inside search. Columns live in the lists; the overview draws a few facts and points at the list.
- Any fact the entity page would not show: the overview reads the same row builders as the lists, so a row never says more than its page.
- A people group drawn into the cached HTML: characters and guilds stay a browser request, so a hide leaves search at once.

## Approaches considered

**A. Richer overview only.** Keep one page, give each group its real columns, lore below, tabs on their own row. Cheapest, but search keeps its own copy of every list's columns and a tab still shows eight rows.

**B. Search is the database list, filtered (chosen).** The overview is short and factual; tabs open the lists with the query. One code path per type, and the lists' filters do the work. The cost is moving search's matching into the lists.

**C. A new Wowhead-style shell inside /search with a full table and filter bar per tab.** Duplicates the list pages wholesale. Dropped.

## How it is built

**Name matching, shared.** The word-order and typo matchers in `web/src/lib/site-search.ts` move to `web/src/lib/name-match.ts`, which also exports `matchNames(rows, q, name)`: the rows whose name matches, each with its rank (exact 0, prefix 1, contains 2, words at word starts 3, words anywhere 4, typo 5+), and `respelled` when the typo fallback fired. Search imports it; `editDistance` and `byTypo` stay re-exported from site-search for the tests that read them.

**The lists.** Quests, NPCs, objects, zones, instances, achievements, factions, titles, quest chains and the item category page call `matchNames` for a text query (an id keeps each list's own id rule). With text and no explicit sort, rows order by rank, then the list's default key. When the typo fallback read the query the list says "Showing results for X" above the table, as search does; the removable chip keeps what was typed.

**The search page.** The overview asks `siteSearch` for five rows per group. For the NPC and quest groups it reads the world facts and rollup (already read for objects, one aggregate per request) narrowed to those ids, and draws Level, Side and Category on quest rows and Level, Type, Zone and Drops on NPC rows; item rows keep the icon, quality colour and type. The tab strip gets its own row under the title and field: All, then every group with results and its count, with Characters and Guilds tabs (no count, the counts load in the browser) when the text could start a name. A tab or an "All N" footer for a type with a list opens `/database/<list>?q=`; the lore tab opens `in=lore`; wiki, tools, docs and classes anchor to their section. `in=<type>` for any type with a list redirects to that list with `q`, so the scope chips and older links land on the full table. The scoped and paged result code in the page goes.

**Changelog.** One "Site:" line under Unreleased.

## Left to the builder

The exact header labels on the overview's fact columns (the list's words: Level, Side, Category, Type, Zone, Drops); whether the item category page sorts by rank through `sortItems` or before it; how the "Showing results for" line is shared between search and the lists (one small component in list-parts is fine).

## Verification

Vitest covers: `matchNames` ranks and respells; each list finds "cloth linen" and "lnen clth" and orders an exact name first; the search page draws the quest and NPC facts, the tab row with list hrefs and people tabs, the list footer links, and the `in=` redirect; the old lore links. Then lint, typecheck and the full web suite; a live check of `/search?q=test+of+lore` and the Quests tab after deploy.
