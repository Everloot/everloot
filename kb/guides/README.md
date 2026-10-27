# kb/guides/: Everloot's guides

**Licence: CC BY-SA 4.0**, like the wiki pages and the news posts. The guides in this folder are content, not
code: they are under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), not the AGPL that covers the
rest of the repository. Game facts a guide names stay Blizzard's.

A guide is Everloot's own advice on one talent plan for one class: who it is for, why it fits an activity, how to
play it and what we do not know yet. One person writes it and someone else reviews it before it is published. The
site's guide reader returns published guides only; a draft, or a file that breaks the rules below, is shown nowhere. The contract behind these rules, versions and history included, is in
[docs/GUIDES.md](../../docs/GUIDES.md).

## A guide

One file per guide, `<slug>.md`, Markdown with YAML front matter. Not MDX: a guide holds text and references, never
code.

```yaml
---
id: 1                         # stable, never reused
slug: mage-leveling           # the file name and the address, /guides/mage-leveling; kept once published
version: 1                    # the version this file holds
status: draft                 # draft guides are not shown on the site
title: Mage leveling
summary: "One or two sentences in our own words, shown under the title and as the search snippet."
classSlug: mage               # warrior, paladin, hunter, rogue, priest, shaman, mage, warlock or druid
activity: leveling            # leveling, dungeons or raids
roles: [damage]               # the roles the plan is written for: tank, healer, damage
levels: { from: 10, to: 60 }  # the levels the guide covers
code: EL1-mage-...            # the first talent set: the plan= value of a calculator link
order: O1p-...                # optional: that set's spend order, the order= value
code2: EL1-mage-...           # optional: the second talent set (plan2=)
order2: O1p-...               # optional: the second set's spend order (order2=)
author: Your Name             # who wrote it, as the page names them
reviewed: null                # published guides: { by, on, build } from the person who reviewed this version
sources: []                   # [{ title, url, checkedOn }]: Blizzard's posts, each cited in the body
history: []                   # every published version: [{ version, on, by, build, note }]
---
```

Quote a title or summary that holds a colon and a space, such as "WoW: Forever", or YAML reads it as a nested field
and the check refuses the file.

The body has four `##` sections, in this order: "Who it is for", "Why this plan", "How to play it" and "What we do
not know yet". `###` subsections, lists and `>` quotes work inside them. Inside a text run, `[text](https://…)` and
`[text](/database/items)` make links, and these tokens link to the database and the wiki:

| Token | Renders |
|---|---|
| `{item:N}`, `{npc:N}`, `{quest:N}`, `{zone:N}`, `{faction:N}` | the entity's name, linked to its database page |
| `[[slug]]` | a link to a wiki page |

## Rules

- **Our own words, reviewed by someone else.** A guide names its writer in `author`. A published guide records its
  review in `reviewed`: who read this version, on which day, against which game build. The reviewer is a different
  person from the author, and only someone who actually reviewed it is named there. No AI tool credits.
- **The plan fits the tree.** Each code is the guide's class and places on the class's talent tree exactly as
  written: every talent is on the tree, every rank is within its maximum and the point rules allow every point. It
  spends no more points than the levels give, and its last point arrives by `levels.to`.
- **Only a planned order is published.** An order is checked point by point against the tree. A published guide
  carries only an order a player planned in the calculator (`O1p-`). An order a tool generated (`O1g-`) may sit in a
  draft while it is written, but is never published. A guide without an order is valid, and readers show its order
  as unknown.
- **The plan lives in the front matter.** A link in the body does not carry `plan=`, `plan2=`, `order=` or `order2=`:
  a guide's plan is its code and order, which the check reads.
- **Evidence next to the claim.** Sources are Blizzard's own posts (worldofwarcraft.blizzard.com,
  news.blizzard.com, the US and EU forums). Each one records the day it was checked and is linked in the body where
  the claim it supports is made. Every link off the site is a listed source. Everything else a guide says comes from
  Everloot's own data, linked on the site; other sites' guides are not sources. Numbers in the text are fine, and the
  reviewer checks each one.
- **Each section says something.** On a published guide, every section has words of our own, not only a quote, and
  the guide has at least 150 words of its own prose in all. The 150 words are a floor, not a target.
- **Links name real pages.** `[[slug]]`, `[text](/wiki/slug)` and `[text](/guides/slug)` name pages that exist, and a
  published guide links only to published pages.
- **Published versions stay as they were.** Any change to a published guide is a new version: raise `version`, add
  its entry to `history` with its review, and update `reviewed` to match. History only grows. To withdraw a guide,
  set `status: draft`; a guide that has been published is never deleted and keeps its slug.
- No private paths, internal names or workspace folders.

## Check a guide

From `kb/`:

    npx vitest run test/guides.test.ts

It runs the guide check on every committed guide, so a problem fails kb's tests and CI. Each problem names the file
and the line. Every guide is reviewed like code: the check passes, and someone other than the author reads and
approves it before it merges as published.
