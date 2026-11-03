# scripts/news-hero/

Renders the Everloot cards that news posts use as their `hero:` image. A card is type and data
only: the post's topic and date, a headline from its title, one line from its TL;DR and the key facts
in a panel, on the site's dark colours with the everloot wordmark.

**No Blizzard material.** A card holds no game logo, screenshot, scene, key art, icon or press image,
and no AI-generated art (see [docs/ASSETS.md](../../docs/ASSETS.md): Blizzard's marketing art is never
used). The fonts are Geist and Geist Mono, the site's own; the colours are the dark tokens in
`web/src/design/tokens.ts`; the diamond is `web/src/app/icon.svg`. A card is never tagged "Blue post":
that names a Blizzard staff post.

## Files

| File | What it holds |
|---|---|
| `cards.mjs` | One entry per card: slug, tag, date, headline, takeaway, panel rows, source. Also the alt text builder. |
| `render.mjs` | The HTML template and the renderer. Writes three files per card and prints its alt text. |

Every fact on a card comes from the post it belongs to (`kb/news/<slug>.md`). When a post's facts
change, change `cards.mjs` to match and render again.

## Render

The renderer takes `sharp` and the Geist fonts from `web/node_modules`, and Playwright's Chromium from
this folder:

    cd web && npm ci && cd ../scripts/news-hero
    npm ci
    npx playwright install chromium
    node render.mjs                     # every card
    node render.mjs <slug> [<slug> ...]  # some cards

Each card is drawn at 1600×900 and written to `web/public/news/heroes/<slug>/`:

| File | Size | Used as |
|---|---|---|
| `<slug>-clean.webp` | 1600×900 | `hero.src`, the post's top image |
| `<slug>-card.webp` | 800×450 | `hero.thumb`, the hub and related-post card |
| `<slug>-share.png` | 1200×675 | `hero.share`, the share image |

Each size is drawn by the browser at its own scale rather than shrunk from the large one, so the small
labels stay sharp. Open every file and look at it before committing.

## Alt text

`render.mjs` prints each card's alt text: everything the card says, in reading order, starting
"Everloot card:" and at most 500 characters (it stops if one is longer). Put it in the post's
front matter as `hero.alt`, quoted:

```yaml
hero:
  src: /news/heroes/<slug>/<slug>-clean.webp
  alt: "Everloot card: ..."
  thumb: /news/heroes/<slug>/<slug>-card.webp
  share: /news/heroes/<slug>/<slug>-share.png
```

Then run `npm run kb -- news-check` from `kb/`.
