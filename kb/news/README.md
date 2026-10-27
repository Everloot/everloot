# kb/news/: Everloot's news posts

**Licence: CC BY-SA 4.0**, like the wiki pages. The posts in this folder are content, not code: they are under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), not the AGPL that covers the rest of the
repository. Game facts a post names stay Blizzard's.

A news post is Everloot's own writing about the site and the game: what the site added, what a build changed
for players, what to look at before launch. Blizzard's own posts and hotfixes are not news posts; they live on
[/changes](https://everloot.app/changes), and a post links there when it talks about one.

Published posts appear at `everloot.app/news/<slug>`, on the hub at `/news`, in the feed at `/news/feed.xml`
and in the sitemap. A draft is read by nothing on the site.

## A post

One file per post, `<slug>.md`, Markdown with YAML front matter. Not MDX: a post holds text and references,
never code.

```yaml
---
slug: item-names-are-live        # the file name and the address, /news/item-names-are-live
title: Item names are live
summary: "One or two sentences in our own words, shown on the hub and as the search snippet."
author: Everloot team            # who wrote it, as the page names them
published: 2026-10-25            # the post's date; a published post cannot be dated after today
updated: 2026-10-26              # optional, the day it last changed
tags: [site, database]           # optional, up to six short lowercase labels
sources: []                      # optional, [{ title, url }]: Blizzard posts and other evidence, listed under the post
status: draft                    # draft posts are not built on the site
---
```

Optional `hero` front matter has `src` and nonempty `alt` text (at most 500 characters), with optional
`thumb` and `share` paths. Keep the full image description. The supplied images are 16:9: source 1600×900,
thumbnail 800×450, share 1200×675. Without a hero the post uses the site's default share image.

Quote a title or summary that holds a colon and a space, such as "WoW: Forever", or YAML reads it as a nested
field and the check refuses the file.

The body is plain paragraphs, `##` sections if the post needs them, lists and `>` quotes. Inside a text run,
`[text](https://…)` and `[text](/database/items)` make links, `**bold**` and `*emphasis*` work. These tokens link
to the database and render the name the site may show:

| Token | Renders |
|---|---|
| `{item:N}`, `{npc:N}`, `{quest:N}`, `{zone:N}`, `{faction:N}` | the entity's name, linked to its database page |
| `[[slug]]` | a link to a published wiki page |

## Rules

- **Our own words.** A post is written by a person and names that person in `author`. No AI tool credits.
- **No invented numbers.** A count a post states comes from a page the post links to, so a reader can check it.
- **Links name real pages.** `[[slug]]` must name a published wiki page; a site path must exist.
- **A published post has at least 80 words of prose,** a `published` date that is today or earlier, and no `#`
  heading in the body (the title comes from the front matter).
- No private paths, internal names or workspace folders.

## Check a post

    npm run kb -- news-check

CI runs the same check on every pull request. Every post is reviewed like code: the check passes, a
maintainer reads the post and approves it, and it goes live with the next deploy.
