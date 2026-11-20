# Lifetime stats: Blizzard's play history for everyone, the addon's gold for its owner

Date: 2026-11-20. Status: design, waiting on Carlos's approval. Branch: `t3/character-stats-tracking`.

## Why

A third-party addon ("Ironforge Revenue Service") showed each character's lifetime numbers: gold acquired, most gold
held, income by source, spending, auction activity, quests, kills, dungeons, fish, flight paths, deaths. It is no
longer maintained, and players liked having those numbers. Carlos wants Everloot to be the place that keeps them:
on each character's page, totalled across a player's characters, and ranked against the world where that is fair.

The build follows the rule the site already runs on (`docs/design/specs/2026-11-17-blizzard-api-first.md`):
Blizzard's API is the base for every character, and the addon adds only what Blizzard cannot see. Carlos sees that
two-layer model as Everloot's edge over other sites; this feature should make it visible.

### What the sources hold (read-only probe, 2026-11-20)

- `GET /profile/wow/character/{slug}/achievements/statistics?namespace=profile-forever-{region}` answers 200 in both
  regions (EU: byakko-howaito, joe-gun; US: denied-works), about 8-11 KB. The 11/17 spec lists
  "`achievement-statistics` 404": that was a different path, or the endpoint has been switched on since then.
  The crawler does not read it today. Its `statistics` section is the combat-stats endpoint (strength, crit).
- It returns nested categories of `{ id, name, quantity, description? }`. For Byakko: quests completed 791 (id 98),
  creatures killed 11,256 (107), total kills 11,342 (1197), killing blows 5,765 (1487), total deaths 56 (60), fish
  caught 1,993 (1518), flight paths 152 (349), times hearthed 45 (353), 5-player dungeons entered 23 (932), kills
  per boss, profession skill and recipes known, consumables, reputation counts, honorable kills, battlegrounds,
  emotes. The ids are the client's statistic achievement ids (`web/src/data/game-data/client-achievements.json`).
- **No gold or auction statistics are returned.** The client's Wealth statistics exist (ids 328 total gold
  acquired, 333 gold looted, 326 gold from quest rewards, 921 gold from vendors, 919 gold earned from auctions,
  334 most gold ever owned, 329 auctions posted, 1146 travel, 1147 barber shops, 1148 postage, and the auction
  stats around them), but only the game itself can read them, through `GetStatistic(id)`. Carlos's screenshot of
  the old addon on Byakko shows the Forever client does track them: 10 of 19 money counters readable (total
  acquired, most held, looted, quests, vendors, auctions, travel, postage, auctions posted and won, largest sale
  and bid), with barber shops and talent respecs "--".

## Goals

1. **Play history for every armory character.** The crawler reads the statistics endpoint. Every armory character
   page gets a "Play history" section with all of Blizzard's categories.
2. **World boards for the fair numbers.** New boards on `/armory/rankings/<metric>` (and the `/rankings` hub), with
   the same region, ruleset, class and faction filters as the gear boards.
3. **Gold lifetime from the addon.** The addon reads the Wealth and auction statistics for the player's own logged-in
   character. The Desktop App syncs them for linked characters under a new private-sync category, `gold`. They are
   shown on that character's page only when the owner turns on `show_gold` (already a column on `character_visibility`,
   off by default).
4. **One lifetime summary across the owner's characters.** A signed-in, owner-only view totals every linked
   character: Blizzard play history plus synced gold. Each figure says which source it came from.

## Non-goals

- Reading other players' gold. The old addon read it through Inspect. Everloot reads only the logged-in character.
- Gold on any world board. Only addon users who opted in would appear on it, so a "world" gold rank would
  mislead. The existing `ranked_gold` flag stays unused.
- A public account page. Totals across characters are shown to their owner only.
- Re-sending from the addon what Blizzard already serves (quests, kills, deaths and the rest). The 11/17 rule retired
  those kinds; this feature does not bring them back.
- History over time (charts of quests per week). This version shows the current lifetime value. Keeping history would
  run into the 30-day limit on Blizzard data and needs its own design.

## Anti-goals (a failure even if it works)

- Any Blizzard-sourced number outside the armory rules: an ad on its page, a missing credit line or read time, kept
  longer than 30 days, still shown after a hide, indexed, or copied into the dataset, open data or exports.
- A gold figure on a public page without the owner having turned it on.
- A "--" or unreadable statistic shown as 0. Unknown stays "not reported", the way the old addon showed it.
- Misconduct framing. The old addon called its gold check "consistent with active play" and added a disclaimer about
  proof of misconduct. Everloot shows the numbers and makes no judgment about the player.

## Constraints

- **Blizzard data rules** (`docs/DATA_POLICY.md` "Armory", decisions 2026-11-13 and 2026-11-20): ad-free paths,
  "Data from Blizzard Entertainment" with read time, deleted after 30 days unrefreshed, deleted on 404 or hide,
  `noindex`, never in the CC BY-SA dataset, corpus, open data or exports. MCP and API answers may carry it only in
  its own field with its own notice. This feature adds none.
- **Crawl budget.** Each character costs one more call per refresh (7 detail sections become 8, roughly +12%). The
  crawler's per-run `budget` and refresh cadence stay as they are, so a full cycle takes slightly longer.
- **Row size.** `armory_characters.details` is capped at 64 KB. Play history is stored compact (id → quantity, plus
  the description string where there is one), not the raw response.
- **Production SQL** needs Carlos's explicit OK before it is applied (memory recipe `everloot-prod-sql-via-preview`).
- **Addon release.** The gold half needs an addon release, a Desktop App release (sender + `LOCAL_ONLY_KINDS`), and an
  in-game check by Carlos before the tag: `GetStatistic` on Forever for each Wealth id, the money format it returns,
  and "--" handling. The 11/06 sync plan already lists the "--" and comma cases for honorable kills.
- **Repo rules:** DCO `-s`, no AI attribution, `type(scope):` titles, `- Site:` / `- Addon:` CHANGELOG lines (CRLF),
  the web design guard, DATA_POLICY fixture names, full web suite before a PR, Carlos merges.

## Approaches considered

1. **Blizzard play history only.** Every character gets play history and boards. No gold. Lowest risk, but the
   gold lifetime (the core of the old addon) would be missing.
2. **Addon gold ledger only.** Gold for linked characters, no world boards. Small reach: only linked, syncing
   players get anything.
3. **Both, in the site's two-layer model (chosen).** Part 1 ships Blizzard play history and boards to everyone. Part 2
   adds the addon's gold layer for owners who opt in. Carlos picked this on 2026-11-20: "it's what we have been
   building across our logic ... it's our value."

## How it is built

### Part 1: Blizzard base (site and crawler, no addon release)

- **Crawl.** Add `["playHistory", "achievements/statistics"]` to `SECTIONS` in `kb/src/armory/crawl.ts`. It follows
  the existing rules: a failed optional endpoint keeps the previous copy for up to 30 days, and a 404 or 403 does
  not void the profile. Parse with a zod schema in `kb/src/armory/parse.ts` into
  `{ asOf, stats: Record<id, { q: number, d?: string }> }`, keeping Blizzard's category tree as id lists so the
  page can group them.
- **Store.** Play history goes into `details.playHistory`. The ranked numbers also go into their own integer columns
  on `armory_characters` so the boards can sort them. One migration adds the columns, extends
  `armory_board_filtered` (and `armory_board`, if separate) with the new metrics, and adds a test in
  `supabase/tests/armory_class_boards.sql`.
- **Boards** (my call, Carlos can change the list): quests completed (98), creatures killed (107), fish caught
  (1518), flight paths taken (349), 5-player dungeons entered (932), total deaths (60). Each gets an
  `ARMORY_BOARDS` entry in `web/src/lib/armory.ts` with a one-line lede that names Blizzard as the source. Ties break
  on last login, as the gear boards do.
- **Page.** A "Play history" section on `/armory/[region]/[slug]` (`web/src/app/armory/profile.tsx`), with a headline
  row (quests, creatures killed, deaths, dungeons, fish, flight paths) and then each Blizzard category in a list.
  Each headline figure links to its board and shows the character's rank when they are in the top 100 of that
  board. The section joins the existing credit line and read time.
- **Coverage.** Existing rows get play history at their next full read (about every 20 days). To fill faster, a
  row whose `details` has no `playHistory` gets that one endpoint read on its own (one call, not eight), within the
  existing per-run budget. Until most rows are filled, each new board shows how many characters it covers, the
  way the census pages do.
- **Rank on the page.** The world rank: both regions, every ruleset, no filter, the board a player reaches from
  `/rankings`. Shown only inside the top 100, from the board RPC; no extra query per page view beyond one bounded
  call.
- **Showcase page.** A linked character's `/characters/...` page shows the same section when its armory row is
  linked through `armory_links`, read from the armory tables, never copied. Like every other Blizzard part there
  (`BLIZZARD_SWITCH` in `web/src/lib/character-armory.ts`), it has its own owner switch: a new `show_history`
  column on `character_visibility`, off by default, added to `public_character_armory` and the Settings toggles.

### Part 2: Everloot's gold layer (addon, Desktop App, site)

- **Addon.** A small reader (in `gold.lua` or its own module) calls `GetStatistic(id)` for the Wealth and auction ids
  out of combat, at login and after money events, debounced. It writes one `wealth_owned` row per character key:
  `{ capturedAt, stats: { [id]: copper | count } }`. Unreadable ("--", nil, secret) values are left out, never 0. The
  money format is parsed to copper, with contract tests for "--", plain numbers, comma-formatted numbers and the
  money-texture string, the shapes the in-game check has to confirm.
- **Protocol and Desktop App.** `wealth_owned` is added to `@everloot/protocol` private-sync kinds. The sender sends
  it only for linked characters with the `gold` category on. The sender is `companion/src/sync-sender.ts`, which the Desktop App
  imports, so it ships in the same Desktop App release as the addon. It is also added to `LOCAL_ONLY_KINDS`
  (`web/src/lib/upload-batches.ts`) so the website's upload page never takes it from a file.
- **Site.** `SYNC_CATEGORIES` gains `gold` with `SHOW_SWITCH.gold = "show_gold"`. The sync route keeps the newest row,
  as it does for the other categories. Settings → Linked characters gets the gold sync toggle and the "Show on my
  page" switch, both off by default. The visibility route currently rejects `show_gold` on purpose
  (`web/src/app/api/me/characters/links/[id]/visibility/route.test.ts`); this PR reverses that, with tests. The character page shows a "Gold" section labelled "From your addon" with its
  capture time: income (looted, quests, vendors, auctions), spending (travel, postage, barber), auctions (posted,
  won, largest sale, largest bid), most gold ever held, total acquired. "Not reported" for anything missing. "Most gold ever held" never
  falls back to the addon's own peak (`gold_snapshot`): that peak only counts since install, a different number.
  The new figures appear on the site only; the addon's Gold tab and the Desktop App keep what they show today.
- **Data policy.** A new paragraph under "Private sync" names the `gold` category, what `wealth_owned` holds, the
  default (off), and that it is never ranked.

### Lifetime summary (after Part 1; gold joins after Part 2)

- An owner-only page: signed in, `noindex`, added to `web/src/data/ad-free-paths.json` because it shows Blizzard
  data. One row per linked character and a total row: quests, creatures killed, deaths, dungeons, fish, flight
  paths, and, where synced, total gold acquired and most gold ever held. Each column is labelled with its source.
  A character with no armory row or no sync shows "not reported", and the total says how many characters it covers.

## Order of work (each its own PR)

1. Crawl + parse + `details.playHistory` + migration (columns, board RPC). Production SQL waits for Carlos's OK.
2. Armory page section + boards + rankings hub entries.
3. Lifetime summary page (Blizzard figures only).
4. Addon `wealth_owned` reader + contract tests; Desktop App sender + `LOCAL_ONLY_KINDS`; protocol kind.
5. Site `gold` category, settings switches, character-page Gold section, summary gold columns, DATA_POLICY paragraph.
   Addon tag waits on Carlos's in-game check.

## Calls made after the builder check (Carlos can change any)

- Play history on a linked character's page gets its own switch, `show_history`, off by default, like every other
  Blizzard part.
- The rank shown on a page is the world rank (both regions, all rulesets).
- Rows without play history get that one endpoint read on its own to fill the boards sooner; boards show their
  coverage until then.
- Gold lifetime figures appear on the site only. No fallback from the addon's own peak to "most gold ever held".
- The old addon's screenshot is the evidence that the Forever client tracks the Wealth statistics, so Part 2 does
  not wait on a separate probe. The exact `GetStatistic` format is still checked in game before the addon tag.
- The six boards listed under Part 1.

## Left to the builder

- Exact column names, the zod schema shape, and how categories are grouped on the page.
- The headline layout and the wording of each board's lede (plain, in the site's voice).
- Whether the gold reader lives in `gold.lua` or a new module, and its debounce timing.
- The route of the summary page, as long as it is owner-only, `noindex` and ad-free.
- Whether the rank shown on the page comes from a new RPC or from the board RPC with a filter, as long as it adds
  no unbounded query per page view.
