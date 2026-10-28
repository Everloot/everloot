# SEO and AI discoverability

What the site does so search engines and AI assistants can find and quote it, and the account steps that only
the owner can do. Written after the 2026-10-17 audit.

## What the code does

- **Titles, H1s, descriptions.** Each page states its own, led by the query terms ("WoW Forever Talent
  Calculator"). Titles may say "WoW Forever"; body copy keeps "WoW: Forever". Descriptions are 120 to 160
  characters; `web/src/app/metadata.test.ts` checks every static route. Use `pageMetadata()` from
  `web/src/lib/seo.ts` for a new page: a page's `openGraph`, `twitter` and `alternates` replace the layout's, so
  each page must state them in full.
- **Social cards.** `/opengraph-image` for the site; text-only cards for the talent class pages, raid, map and
  changes (`web/src/lib/og-card.tsx`). No Blizzard art.
- **Structured data.** All of it is built in `web/src/lib/jsonld.ts` from the values the page shows. No ratings,
  no `license` on game data, no game build as `softwareVersion`, no FAQPage, Person or speakable. The Dataset on
  /database appears only once uploads exist.
- **Breadcrumbs.** `web/src/components/Breadcrumbs.tsx` (in the layout) draws the trail and its BreadcrumbList
  from `web/src/lib/breadcrumbs.ts`. /tools is not a page, so no trail links it.
- **Answer blocks.** Counted from the data files: talent points and tree facts (`web/src/lib/talents/facts.ts`),
  raid buffs that need a talent (`web/src/lib/raid-facts.ts`), the latest build line
  (`web/src/lib/changes-facts.ts`). /wow-forever quotes Blizzard's launch sentence from
  `web/src/data/wow-forever.ts`; when you re-read the source, update `checkedOn` there.
- **llms.txt and llms-full.txt** are route handlers built from the tool catalog, the MCP tool list in
  `web/src/lib/docs/connect-data.ts` and the changes data. A test fails if an MCP tool registered in
  `kb/src/mcp-server.ts` is missing from either.
- **Sitemap.** `lastModified` only where one is known: newest change entry for /changes, the build extraction
  date for the talent, raid and map pages, the checked-on date for /wow-forever.
- **Database sitemap.** `/database-sitemap.xml` indexes chunks of up to 40,000 item, NPC, quest, object and
  vendor detail pages. It lists a page by the same function its robots metadata calls
  (`web/src/lib/indexable.ts`), so it never lists a noindex page. It answers 503 when upload storage cannot be
  read. A plain list's later pages (`?page=2`) are their own canonical; filters, sorts and name searches stay
  noindex. An item category page is indexed once half the rows it shows have a name; named rows come first.
- **Unknown ids** under /database (no client-layer row and no upload mentions them) are a 404, not an empty page.
- **Guides** (`/guides/<slug>`) are indexed, and listed in the sitemap dated by their review, only while published,
  reviewed, with 150 words of their own and neither stale nor broken (`guideIndexable` in
  `web/src/lib/guide-freshness.ts`, the rule the page's robots use too). A filtered list on /guides is noindex. A
  class hub is indexed, and listed, once it lists a published guide.
- **Lore archive.** The Warcraft Wiki copies stay readable, linked to their originals, but say `noindex, follow`
  and are in no sitemap (owner decision, 2026-10-20). /lore, its browse pages and /lore/coverage stay indexed.
- **www.** `www.everloot.app` answers 301 to the same path and query on `everloot.app` (`web/next.config.js`).
- **Auction House pages** (`/tools/auctions/<realm>`, `/tools/auctions/<realm>/<itemId>`,
  `/tools/auctions/item/<itemId>`) are built on first visit and rebuilt at most every five minutes. One is
  indexed, and listed in `/auctions-sitemap.xml`, only when it has a market value: a day 3 reporters scanned,
  with more than 5 units listed, in the last 14 days (`indexable` in `web/src/lib/auction-house.ts`). Every
  other price page says noindex. Item pages carry a Dataset, not a Product: nobody here sells the item.
- **RSS.** Every page advertises `/changes/feed.xml`. A post's item links its page on Everloot and names the
  original in its description.
- **Blue post pages** (`/changes/<id>-<slug>`, id from the stored post: `us-`, `eu-` or `bsky-`). /changes, the
  home page's What's new and the signed-in home's rail link here; each page links Blizzard's original. A wrong
  slug answers 308 to the canonical address, an unknown id 404. A page says `noindex, follow` until it has a
  reviewed write-up (`kb/curated/blue-writeups/`); then it is indexed, self-canonical, in the sitemap with the
  review date as `lastModified`, and carries an `Article` by Everloot based on Blizzard's post.
- **Security headers** in `web/next.config.js`: nosniff, `X-Frame-Options: SAMEORIGIN`, Referrer-Policy,
  Permissions-Policy, HSTS with `includeSubDomains`, an enforced CSP with only `object-src 'none'`,
  `base-uri 'self'` and `frame-ancestors 'self'`, and a report-only CSP that lists the analytics and ads
  hosts. AdSense supports only a nonce-based CSP, so script, connect and frame sources are not enforced. The
  report-only CSP has no report endpoint yet; violations show in the browser console.
  The `Access-Control-Allow-Origin: *` seen on pages is added by Vercel for prerendered responses; it is not set in
  this repo and a header set here could not remove it. Check a preview deployment before trying to narrow it.

## IndexNow

- `INDEXNOW_KEY` (8 to 128 characters: letters, digits, dashes) is read from the environment. `/indexnow.txt`
  serves it, and every ping names that file as `keyLocation`. No key is committed. Without the variable the file
  is a 404 and nothing is sent.
- `pingIndexNow(urls)` in `web/src/lib/indexnow.ts` sends nothing for an empty list or another host.
- `/api/cron/indexnow` runs hourly (`web/vercel.json`, same `CRON_SECRET` auth as the snapshot cron). It submits
  /changes, its feed and /wow-forever when the changes list has an entry from the last two hours, and sends
  nothing when the list is empty. It decides from the entry count, never from a page answering 200.
- There is no automatic ping for a newly deployed page. To announce one, send a POST to
  `https://api.indexnow.org/indexnow` with `host`, `key`, `keyLocation` and `urlList`, or add the page to
  `changeUrlsToPing`.

## Steps for Carlos

1. **Vercel env var.** Add `INDEXNOW_KEY` (Production). Generate one, for example 32 random hex characters. After
   the deploy, open `https://everloot.app/indexnow.txt` and confirm it shows the key.
2. **www redirect.** The site now answers 301 itself when a request reaches it on `www.everloot.app`. A
   permanent redirect in Vercel Domains as well is fine; after the deploy, `curl -I https://www.everloot.app/about`
   should show a 301 or 308 to `https://everloot.app/about`.
3. **Google Search Console.** Add the property for `everloot.app`. Either verify by DNS, or set `GSC_VERIFICATION`
   (the content value of the meta tag) in Vercel. Submit `https://everloot.app/sitemap.xml`,
   `https://everloot.app/database-sitemap.xml` and `https://everloot.app/auctions-sitemap.xml`. If the lore
   sitemap was submitted before, remove it: it no longer exists.
4. **Bing Webmaster Tools.** Add the site, or import it from Search Console. Set `BING_VERIFICATION` if you
   verify by meta tag. Submit the same three sitemaps. IndexNow submissions show under "IndexNow" once the key
   works.
5. **MCP registry.** Publish the public server (`https://everloot.app/mcp/public`) to the official MCP
   registry as `io.github.Everloot/everloot`, then to Glama, Smithery and mcp.so. The server must have
   `EVERLOOT_MCP_PUBLIC=1` set in Production, or the endpoint answers 404.
6. **Bot protection.** Check that Vercel's bot protection is not challenging GPTBot, ClaudeBot, PerplexityBot or
   OAI-SearchBot. The audit saw 200s for all of them.
7. **Decided 2026-10-20:** the Warcraft Wiki copies under /lore are noindex and out of the sitemaps; /about names
   R21 Media Group, LLC.
