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

### Figures

A paragraph that is only an image shows as a figure, the image across the column with its caption under it:

```markdown
![The zone map with the camps marked](/news/figures/<slug>/camps.webp "Where the camps are")
```

- **Alt text is required:** the words in `[ ]` describe the image for someone who cannot see it.
- **The caption is optional:** the words in quotes after the path. Alt text and caption are plain text, no
  tokens or links.
- **The file is ours:** a `.webp` committed at `web/public/news/figures/<slug>/`, in the post's own folder
  (lowercase letters, digits, `-` and `_` in the file name). No other address works, an https URL included.
- **Every figure is 1600×900.** The page draws each one at that size so nothing moves while it loads, and the check
  reads each file's header to hold it to that.
- **An image is its own paragraph.** An image inside a sentence, a list or a quote is not supported.

The check fails a post with an image that breaks a rule. If one reaches the site anyway, the page leaves that block
out. The feed carries the summary only, so a figure never shows there. The post's plain text (its reading time)
reads a figure as its caption, or its alt text when it has none. A figure's words do not count toward the 80 words
of prose.

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
