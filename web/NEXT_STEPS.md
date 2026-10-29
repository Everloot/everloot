# Next Steps — after this session

Tight checklist so you don't lose momentum.

## Today / this week

- [ ] `npm install` + `npm run dev` to see the site locally at http://localhost:3000
- [ ] Click through every page. Open the Auction House, pick a realm and an item, and check the price page.
- [ ] Pick a domain (see README for ideas) and buy it
- [ ] Push to GitHub, deploy the Cloudflare Worker, point the domain
- [ ] Share the site with 5–10 WoW-playing friends for "does it work / what would you add" feedback

## Before applying to AdSense (~1–2 weeks of content work)

AdSense rejects sites that are too thin. You need 5–10 real articles first.

- [ ] Write article #1 from the content roadmap in README (start with the "best gold farms in TWW" post — it has high search volume)
- [ ] Add a `/blog` route with MDX support
- [ ] Verify a Google Search Console property for your domain
- [ ] Submit sitemap to Google Search Console
- [ ] Post the Auction House on r/woweconomy for feedback (not self-promotion — actually useful there)

## Submit to AdSense

- [ ] Apply at adsense.google.com
- [ ] Drop the verification meta tag into layout.tsx
- [ ] **Wait 2–4 weeks.** Don't refresh obsessively. Use the time to build tool #2.

## After AdSense approval

- [ ] Fill in the `NEXT_PUBLIC_ADSENSE_CLIENT` GitHub repository variable (read at build time by the deploy workflow)
- [ ] Update `public/ads.txt` with your real publisher ID
- [ ] Add `<ins>` ad units where they make sense:
  - Between hero and tool grid on landing page
  - Below the price facts on an Auction House item page, `/tools/auctions/<realm>/<itemId>` (not above — don't bury the prices)
  - In the middle of long blog posts
- [ ] Don't overload. Google penalizes sites with too many ads / shitty UX.

## Tool #2 — Profession Planner

When you're ready:

1. Get Blizzard API credentials at https://develop.battle.net
2. Set `BNET_CLIENT_ID` and `BNET_CLIENT_SECRET` as Worker secrets (`npx wrangler secret put` from `web/`)
3. Implement `src/app/api/bnet/` routes for:
   - OAuth client-credentials token refresh (cache in-memory or in KV)
   - Auction house item price lookup by realm + item ID
4. Replace `src/app/tools/profession-planner/page.tsx` with a real interactive component
5. Update the status to `"live"` in `src/data/tools.ts`

## Tool #3 — Completionist Tracker

Heavier project. Read `completionism.com` for inspiration. Uses the Blizzard character-profile API (requires OAuth with user authorization, not just client credentials). Defer until tool #2 is live and getting traffic.

---

**Reality check on timelines:**
- Today: deploy takes 30 minutes once the domain is bought
- Week 1–2: content writing (this is the slog — don't skip it)
- Week 3–6: AdSense review (mostly waiting)
- Month 2: first AdSense revenue (if traffic exists)
- Month 3–6: tool #2 live, traffic compounds
- Month 6+: meaningful RPM (think $50–200/month for a niche site with 10k+ monthly pageviews)

This is a long game. The sites that win are the ones that ship tool #2 and #3 instead of quitting after month 2 AdSense checks come in at $4.
