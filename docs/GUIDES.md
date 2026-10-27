# Guides

A guide is Everloot's own advice on one talent plan for one class: who it is for, why it fits an activity, how to
play it and what is not known yet. This page is the contract every guide meets. How to write one is in
[kb/guides/README.md](../kb/guides/README.md).

The contract is code, in three places:

| File | What it holds |
|---|---|
| [`kb/src/guides/guide.ts`](../kb/src/guides/guide.ts) | The schema: every field, and the rules the fields keep with each other. Every reader parses a guide here, so a reader that only parses still refuses a guide that breaks them. |
| [`kb/src/guides/check.ts`](../kb/src/guides/check.ts) | The check: the rules that need the talent trees, the wiki, the other guides, or the guides as they were before a change. Each problem names its file and line. |
| [`web/src/lib/guides.ts`](../web/src/lib/guides.ts) | The site's reader. |

## Lifecycle and freshness

A guide's `status` is `draft` or `published`. People set it, through review, and nothing automatic changes it.

How current a published guide still is (whether the game build it was reviewed on is still the live one, whether
anything its plan depends on has changed) is a separate question. Readers work it out from the data. It is not a
field: a file that declares one fails the check as an unknown field. A newer game build does not make a guide wrong
by itself and never rewrites it. When a change to a talent tree means a published plan no longer fits, the check
fails until a person acts, with a new reviewed version or with `status: draft` to withdraw the guide.

## Versions and history

`version` is the version the file holds. `history` lists every published version, oldest first, as
`{ version, on, by, build, note }`: the review that published it, and what changed.

- A published guide's `version` is the last entry in `history`, and that entry is the review in `reviewed`.
- A draft holds the last published version (a withdrawn guide) or the next one (a revision in progress). A guide that
  was never published is version 1, with an empty history.
- Versions count up from 1, one entry each, and their dates never go back.

A file holds one version, and readers go by its status, so a draft is off the site either way. A revision merged to
main as a draft takes the published version down until the revision is published. Keep a revision on its branch until
it is reviewed and merge it as published; set a published guide to draft only to withdraw it.

Given the guides as they were before a change (`previous`; for a pull request, a copy of `kb/guides` at its base),
the check also holds published versions to what they were:

- A published version that changes in any way, its review date included, fails. The change is the next version,
  with its own review in `history`.
- Versions never go down, and history only grows: an entry is never edited or removed.
- A guide that has been published keeps its slug, so its address stays, and its file stays. To withdraw it, set
  `status: draft`; its history stays with it.
- A guide that was never published may change or go.
- A file in that copy that no longer reads (bad YAML, or front matter today's schema refuses) fails the check, with
  its line, so an edit or a deletion is never let through unchecked.

`npm run kb -- guide-check --previous <folder>` passes the check that copy. CI runs it on every pull request with
`kb/guides` as it was at the base, and on a push to main with the folder as it was before the push. The base's files
are read from git as data, never checked out or run. A base without the folder is compared with an empty one; a base
that cannot be fetched or read fails the step, so the comparison is never skipped.

## Review

`reviewed` is `{ by, on, build }`: who reviewed the version the file holds, on which day, and the game build they
checked it against. A published guide has one. The date is not after today, and only the person who actually reviewed
that version is named.

## Plans and spend orders

`code` and the optional `code2` are [talent share codes](2026-10-17-talent-share-code.md); `order` and `order2` are
the spend order tokens that ride with them. Against the class's talent tree, as the calculator reads it:

- A code is the guide's class and places exactly as written: every talent is on the tree, every rank is within its
  maximum and the point rules allow every point.
- It spends no more points than the levels give, and its last point arrives by `levels.to`, which is within the
  tree's levels.
- An order reads with its code and is legal point by point: each point could be taken where it stands.
- A published guide carries only orders a player planned (`O1p-`). A provisional order a tool generated (`O1g-`)
  stays usable in personal plans and may sit in a draft, but is never published as a reviewed order.
- A guide without an order is valid. Readers show its order as unknown and never derive one.
- The plan lives in the front matter. A link in the body that carries `plan=`, `plan2=`, `order=` or `order2=`, or
  is a build link (`/tools/talents/<class>/b/…`, `/b/…`), fails, so every plan a guide shows is one the check has
  read.

## Sections and words

The body has four `##` sections, in order: Who it is for, Why this plan, How to play it, What we do not know yet. On
a published guide each one has words of our own, and the guide has at least 150 words of its own prose, the same
floor as a wiki page. The floor is there to catch a guide that says nothing. It is not a target, and it promises
nothing about search.

Numbers in the prose are allowed. A guide talks about levels and points, so the check does not refuse them; the
reviewer checks each one against its evidence.

## Sources and links

- `sources` are Blizzard's own posts, on worldofwarcraft.blizzard.com, news.blizzard.com and the US and EU forums.
  Each is linked in the body where the claim it supports is made, and records the day it was checked. Every link off
  the site is a listed source.
- Everything else a guide says comes from Everloot's own data, linked on the site: database tokens, wiki pages, tool
  pages, and the `/changes` page of a Blizzard post shown there. Other sites' guides are not sources, and nothing is
  copied from them
  ([data policy](DATA_POLICY.md#what-we-refuse)). The narrow exceptions in the [source ledger](sources/LEDGER.md)
  stay where it scopes them.
- `[[slug]]`, `/wiki/` and `/guides/` links name pages that exist, and a published guide links only to published
  pages.

## Readers

A draft, or a file that fails the schema, is shown nowhere. In the site's reader, `publishedGuides`, `publishedGuide`
and `guidesFor` return published guides only, and `guidesFor` narrows them by class, activity, role and level.
Anything that shows guides reads them through these.
