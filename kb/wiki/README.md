# kb/wiki/: Everloot's wiki pages

**Licence: CC BY-SA 4.0** (same as the rest of the published dataset). The pages in this folder are
content, not code: they are under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), not the
AGPL that covers the rest of the repository. Game facts shown beside the text come from Blizzard's game
files and stay Blizzard's.

Each page is a short piece of writing in Everloot's own words wrapped around live data. The writing says
what a thing is and why it matters in WoW: Forever. Everything countable (levels, bosses, drops, positions,
player limits) comes from the game files or from player uploads and fills in by itself; an editor never
types it.

## A page

One file per page, `<slug>.md`, Markdown with YAML front matter. Not MDX: a page holds text and references,
never code.

```yaml
---
id: 7                      # stable, never reused
slug: deadmines            # the file name and the address, /wiki/deadmines
title: Deadmines
type: dungeon              # see "Types and sections"
binds: { entrance: deadmines, zone: 1436 }
summary: One or two sentences in our own words, shown on database pages and in search results.
categories: [dungeons, eastern-kingdoms, westfall]   # from categories.yaml
origin: original           # or adapted
adaptedFrom: []            # adapted pages: [{ title, url, extId, revision }] of each Warcraft Wiki page reused
sources: []                # [{ title, url, checkedOn }]: Blizzard posts and other evidence, for review, not printed
status: draft              # draft pages are not built on the site
reviewed: null             # published pages: { by: <maintainer>, on: YYYY-MM-DD }
---
```

In the body, sections are `##` headings in the order the page type sets. These tokens link to the database
and render the name the site may show:

| Token | Renders |
|---|---|
| `{item:N}`, `{npc:N}`, `{quest:N}`, `{zone:N}`, `{faction:N}` | the entity's name, linked to its database page |
| `[[slug]]` | a link to another wiki page |

Infoboxes and data blocks (bosses, loot, quests, NPCs) are placed by the page type, not written, so an
editor cannot drop or reorder them.

## Types and sections

| Type | Binds | Sections, in order |
|---|---|---|
| `dungeon`, `raid` | `entrance` (slug of the entrance name), optional `zone`, `lfgDungeon` | Overview, Getting there, History, In WoW: Forever, then optionally Before you go |
| `zone` | `zone` (UiMap id) | Overview, History, In WoW: Forever |
| `npc` | `npc` | Who they are, Where to find them, In WoW: Forever |
| `faction` | `faction` | Overview, History, How players gain standing, then optionally In WoW: Forever |
| `item-set` | `itemSet` | Overview, Who wears it, then optionally In WoW: Forever |
| `event` | `holiday` | What happens, In WoW: Forever |
| `concept` | optional `tool` (a site path) | free, at most four |
| `change` | `changes` (entry ids on /changes) | What changed, What it affects |
| `race`, `class` | `race`, `class` | Overview, In WoW: Forever |

## Rules

- **No hand-typed gameplay numbers.** A level, rate, count, coordinate, price or player limit comes from the
  infobox or a data block. Inside a quote (Blizzard's words, linked to the post) is the only exception.
- **Nothing above the shown id ranges.** New Forever content is written about only from a Blizzard post or
  from what players have recorded, never from the game files alone.
- **Announced but not in the files yet.** A `dungeon` or `raid` page may leave out `entrance`, and a `race` page
  `race`, only when its `sources` list a Blizzard post (worldofwarcraft.blizzard.com or the US or EU forums).
  The binding is added once the game files have it.
- **Before you go is advice.** A `dungeon` or `raid` page may end with what a group should know before going in,
  in our own words. An adapted page has none. On a published page the section needs words of its own, not only a
  quote; leave the heading out until there are some. The page shows the level, the entrance and the bosses in its
  facts, and the number rule above applies to the advice as to every section.
- **Original pages only for now.** An original page is written in our own words from the game files,
  Blizzard's posts and Everloot's data. An adapted page reuses Warcraft Wiki text; it needs `adaptedFrom` for
  its credit line and cannot be published until the overlap check against the wiki dump exists.
- **Published pages meet the index bar:** at least 150 words of our own prose, at least one binding so the
  page shows live data, an "In WoW: Forever" section (for `change` pages, "What changed") with something in
  it, and a maintainer's review recorded in `reviewed`.
- **Links:** every `[[slug]]` names an existing page, and so does every Markdown link into the wiki
  (`[text](/wiki/slug)`, also with a trailing slash, a query or a fragment, or written out on everloot.app). A
  published page links only to published pages; the site draws a link to any other page as plain words.
- No private paths, internal names or AI tool credits.

## Check a page

    npm run kb -- wiki-check

CI runs the same check on every pull request. Every content change is reviewed like code: the check passes,
a maintainer reads the page and approves it.
