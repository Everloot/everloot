# Player profiles, Everloot Score and the rankings hub: plan

Date: 2026-11-02. Status: **plan, no code.** Base: `main` at `6620aa7e`. Launch is 2026-11-04 15:00 PT; the first
raids open 2026-12-09.

Goal, as the owner put it: every player Everloot meets counted in the census; an Everloot account that holds all of a
player's characters, with a shareable profile and Battle.net, Twitch, Google and Discord logins; an "Everloot Score"
per character and per account; a rankings hub with many boards and charts; guilds ranked by progression with a
profile page each; and an addon leaderboard. This document says what of that the data supports, in what order, and
what the owner has to decide.

Rules this plan keeps (from [DATA_POLICY](../DATA_POLICY.md), the
[owned-character identity ADR](specs/2026-10-28-owned-character-identity.md), the
[showcase plan](2026-11-01-character-showcase-plan.md) and the
[public-character policy draft](2026-11-01-public-character-policy-draft.md)):

- A named public number about a character comes only from that character's linked owner, with their switch on.
  Nothing from `/who`, inspect or other players' sightings feeds a score or a profile. Another uploader's pull
  summary can only confirm a kill the owner's own row reports (3.3); it never adds points by itself.
- The census stays aggregate: counts only, same thresholds and rounding as today.
- Nothing is copied from Raider.io, Warcraft Logs, WoWProgress or any other site, including their formulas. The
  Everloot Score is our own, published in full.
- No number from Blizzard is shown unless Blizzard published it and we cite it.

Parallel work this plan does not redesign: pull and run timing with per-pull summaries (PR #697; on by default for
the uploader since Carlos's 2026-11-02 decision), and a realm to ruleset map (PR #689). Both are **in progress** in other pull requests; where this plan needs them it says so.

## 1. What exists today

Production flags are read from `web/wrangler.jsonc` vars (lines 56 to 71). Applied database migrations were not read
back for this plan.

| Surface | Flag (production) | What it does | Code |
| --- | --- | --- | --- |
| `/census` | none (live) | Factions, races, classes, level bands; a week window and a since-launch window; a count shows from 10 characters, 3 installs and 3 addresses, rounded to 5, with complementary suppression. No filters besides `?window=` | `web/src/app/census/page.tsx`, `kb/src/census.ts` |
| `/players/<ruleset>/<realm>/<name>` | `EVERLOOT_PLAYER_PAGES=1`; `EVERLOOT_PLAYER_PAGES_INDEX` unset, so noindex | One sighting row per character from `player_seen`; hide form at `/players/opt-out` | `web/src/lib/player-pages.ts` |
| `/rankings`, `/rankings/<slug>` | none (live) | Classes, races, factions, one ISO week at a time, from the census rollup per week. `WeeklyChart` and `StackedWeeks` SVG charts; races filter by faction and class, and filters only pick published cells | `web/src/lib/rankings.ts`, `web/src/app/rankings/parts.tsx` |
| `/guilds`, guild pages | `EVERLOOT_GUILDS=1` | Ladder by bosses killed in one instance, then by who got there first; "There is no combined score". A kill is the guild's once 2 installs report it. Seen roster from the players table; officer board under a grant | `web/src/lib/guilds.ts`, `kb/src/guilds.ts` (`GUILD_KILL_AGREEMENT = 2`) |
| `/addons/popular` | none (live) | Addons from opt-in `addon_seen` rows, public once 3 installs report one; Everloot itself left out | `kb/src/addon-rollup.ts`, `web/src/app/addons/popular/page.tsx` |
| `/addons/<name>` | none | Live GitHub facts per profile (licence, release, issues, contributors), cached an hour, `GITHUB_TOKEN` optional | `web/src/lib/addon-github.ts` |
| `/addons/ecosystem` | none | Curated projects with GitHub stars and star history, joined to install counts | `kb/curated/ecosystem.json`, `kb/changes/ecosystem.json`, `kb/src/ecosystem.ts` |
| `/tools/completionist` | none | Redirects to `/tools/collections`: owned against missing, plus achievement, reputation, title and quest progress | `web/src/app/tools/completionist/page.tsx` |
| `/u/<handle>` | `EVERLOOT_PROFILES=1` | Profile with typed character labels and shared builds; `main_character_id` points at a typed build label, not a game character | `supabase/migrations/20261021170000_account_profiles.sql` line 29 |
| Social sign-in | `EVERLOOT_AUTH_V2` unset | Google, Microsoft, Twitch, Discord through Better Auth; Battle.net keeps its own OAuth. Provider tokens discarded | [social sign-in](../2026-10-30-social-sign-in.md) |
| Character links | `EVERLOOT_CHARACTER_LINKS` unset (404) | Code shown on the site, typed in game, one `character_link` row per character | `web/src/lib/character-links.ts`, `supabase/migrations/20261021190000_character_links.sql` |
| `/characters/<ruleset>/<realm>/<name>` | `EVERLOOT_SHOWCASE` unset | Showcase page and share cards for a linked character; stages S0 to S7 | `web/src/app/characters/`, `web/src/components/showcase/` |
| `character_visibility` | unwired | `page_public`, `show_*`, `ranked_gear`, `ranked_achievements`, `ranked_gold`, `indexable`, all default false | same migration, lines 85 to 87 |

What the addon uploads that matters here (`packages/protocol/src/records.ts`):

| Kind | Names a character? | Useful for |
| --- | --- | --- |
| `census_self`, `census_seen` | No: the GUID becomes a keyed hash at intake | Population, race, class, faction, level |
| `player_seen` | Yes (name, realm, race, class, level, guild), seen by any install | Player pages, guild seen roster |
| `encounter` | No: anonymous. `encounterId`, `instanceMapId`, `difficulty`, `size`, `success`, `capturedAt`. **No duration** | Boss kill and wipe counts |
| `guild_kill` | No: names the guild only | Guild ladder |
| `raid_lockout`, `attendance`, `loot_award`, `guild_snapshot` | Guild-scoped; officer grant | Officer board |
| `achievement_owned`, `reputation_owned`, `title_owned`, `quest_owned` | Opaque 8-hex `characterKey`; joined to a link through `completionKey` | Completion, owner only today (`collection` grant) |
| `achievement_catalog`, `reputation_catalog`, `title_catalog`, `quest_chain_catalog` | No | What exists, and achievement `points`, once 3 installs agree |
| `gear_snapshot`, `gold_snapshot` | `character`, `realm` | Not used by this plan (see section 3.5) |
| `addon_seen` | No | Addon usage |
| `character_link` | Yes, in transit to the link endpoint only | Account to character |

Not captured at all: per-character boss kills, run or pull duration (in progress elsewhere), PvP of any kind, and
mount or pet collections (`collection_owned` is in the schema; no addon module writes it).

## 2. Data model

```
Everloot account (Better Auth user)
 ├─ logins: Battle.net, Google, Microsoft, Twitch, Discord        (auth tables; tokens discarded)
 ├─ profile: handle, main link, switches                          (user_profiles, extended)
 └─ linked characters: one character_links row each               (ruleset, realm_key, name_key, link_key, completion_ref)
      ├─ visibility: page_public, show_*, ranked_*, indexable     (character_visibility)
      ├─ own synced rows: completion, lockouts, kills, guild      (joined by completion key; S5)
      └─ score rows: per character, per formula version           (new, section 3)
Guild (realm, name)  ←  members: linked characters whose own sync names this guild, with their switch on
                     ←  seen roster: players table (sightings, separate)
                     ←  kills: guild_kill agreed by 2 installs, plus officer board
```

**How alts are tied together.** A character belongs to an account only when it typed that account's live link code
in game (`/everloot link <code>`, which writes one `character_link` row; the ADR's Step 1, showcase stage S2). Alts
are simply all the characters linked to one account. Nothing is inferred from:

- a shared name, guild, realm or class;
- a shared install id (it travels with copies of the save file; ADR table, "Completion key");
- a shared address, play times or `player_seen` rows.

The site never calls a linked character "verified", "proven" or "owned"; the ADR forbids those words. It says
"linked". A second account linking the same character freezes both links, and a frozen character is in no profile,
score or board.

**The main.** `user_profiles.main_character_id` references `build_characters`, a typed label. The profile needs a
`main_link_id uuid references character_links(id) on delete set null`. Only an unfrozen link of the same account
can be the main. The old column stays for builds.

**Guild membership.** `characterLink` carries no guild field (records.ts), so the showcase's "guild from the link
row" needs one. Proposal: the S5 own-character sync adds the character's guild name from `GetGuildInfo`, dated, as
part of the owner's own rows. A guild page lists a linked member only when that member's `show_guild` switch is on.
Sightings (`player_seen.guild`) keep feeding the separate seen roster and never a member's profile.

**Logins.** Each login is a way in, not a public fact. A profile may show a Twitch or Discord name only through a
new per-login switch, off by default. Assumption to check: Better Auth's account row keeps the provider account id
but not a display name; showing a name may need it saved at link time.

**Battle.net as stronger evidence (later).** If Blizzard publishes a WoW: Forever profile namespace, the Battle.net
login's account-profile call could list the account's characters. That would be the first check from outside the
save file. It belongs to the showcase plan's section 5 (Blizzard API mirror) and needs the ADR's wording to change
before the site calls anything confirmed.

## 3. Everloot Score v1

The score is a published formula over rows we capture, never an estimate. Every shown score carries its formula
version (`v1`) and an "as of" date, and links to `/methodology/score`, which prints this section's tables. A change
to any weight is a new version; old versions are never rewritten silently.

### 3.1 Two numbers, not one

Our rows have two levels of trust, so v1 keeps them apart:

| Number | From | Can a forged save file inflate it? | Ranked? |
| --- | --- | --- | --- |
| **Progress score** | Raid and dungeon boss kills where another uploader's pull summary puts the character in the group (3.3) | Only if an install the character does not control also lists it in that pull | Yes, on its own board, after the owner's switch |
| **Completion score** | The character's own achievement, reputation, title and quest rows | Yes: the rows can be written by hand (ADR, policy draft) | On a board labelled "self-reported", or not at all (decision D3) |

The profile shows both and their sum as "Everloot Score", with the breakdown one click away. The sum is
profile-only: no board ranks it (D3). The Progress board ranks Progress only, and the Completion board ranks
Completion only, labelled "self-reported".

### 3.2 Formula

All weights below are a **proposal for the owner** (decision D2), not settled numbers. "Agreed" means the catalog
entry has 3 installs, as the site already requires for public facts.

| Part | Counts | Points |
| --- | --- | --- |
| Raid | Each distinct raid boss killed in the current season, corroborated, once per boss and difficulty | 10 × tier number. Tier 1 is the first raid tier (opening 2026-12-09), tier 2 the next, and so on. The tier list is a curated file the owner signs off |
| Dungeon | Each distinct dungeon boss killed, corroborated, once per boss and difficulty | 1, or 3 for a dungeon's final boss once the curated final-boss list exists; until then every dungeon boss is 1 |
| Achievements | Achievements with `completed` and `earnedByMe` not false, on the agreed catalog | The catalog's `points` ÷ 10, rounded down per character total |
| Reputations | Factions at Exalted (`reaction` 8) on the agreed catalog; renown factions excluded | 10 each |
| Titles | Titles on the agreed catalog | 5 each |
| Quests | Completed quests on the agreed quest list | 1 per 25 |
| Speed | Timed dungeon runs | Not in v1. Needs the in-progress timing work and its own formula (v2) |
| PvP | Honor, rank, kills | Not in v1. Nothing is captured (section 4) |

Progress score = Raid + Dungeon. Completion score = Achievements + Reputations + Titles + Quests.

**Final bosses.** `instanceDefs()` (`kb/src/guilds.ts`) lists encounters in id order, which cannot say which boss
is last. The final-boss list is a curated file, reviewed with the raid tier list; until it exists, every dungeon
boss scores 1.

Worked example (made-up numbers, for the arithmetic only): a character with 4 corroborated tier-1 raid bosses, 12
dungeon bosses including 3 final bosses, 410 achievement points, 2 Exalted factions, 1 title and 180 quests scores
Raid 40, Dungeon 9 + 9 = 18, so Progress 58; Achievements 41, Reputations 20, Titles 5, Quests 7, so Completion 73.
Everloot Score 131.

**Seasons.** Progress resets when a new raid tier opens; the old season's board is frozen and stays readable.
Completion never resets. Whether to keep a lifetime Progress board too is decision D2.

**Per account.** Account Progress = the best Progress among the account's characters that have `ranked_score`
on, in one ruleset (D4: best character only, no alt bonus). There are two aggregates. The **public** one (the
account's number on a board, and its record of every distinct boss) counts only characters with `page_public`
and `show_alts` on, and drops a character at once when it is switched off, hidden, frozen or unlinked. A private
alt never changes a public number. The **private** one counts every linked, unfrozen character and shows only to
the signed-in owner.

**Rulesets.** Scores are per ruleset. Player, guild and link addresses use `rulesetOf()`
(`web/src/lib/player-pages.ts`), which returns `"forever"` for every realm. The realm map (PR #689) groups Auction
House prices only; moving player rows to their ruleset needs its own migration of the stored rows, so v1 has one
ruleset.

### 3.3 Anti-gaming rules

The site's existing thresholds are the model: 3 installs and 3 addresses for a public fact, 2 installs for a guild
kill, 10 characters for a census count.

1. **Only linked characters, with their switch on.** Unfrozen, not hidden through the hide form, and a new
   `ranked_score` flag on `character_visibility`, default false. Turning it off removes the character from every
   board on the next request.
2. **A kill counts only when another uploader saw the character there.** The character's own kill row (new,
   section 9, P2) counts when at least 1 other install, from another address, uploaded a `pull_summary` (pull
   and run records, PR #697) for the same `encounterId` and difficulty within 10 minutes that lists this character
   in the group and ends in a kill. Anonymous `encounter` rows from other installs, or a same-day `guild_kill`,
   show that the kill happened, not that this character was in it: on their own they label the kill "reported,
   not confirmed" on the owner's profile and score nothing. The score matches pulls itself and does not use
   `agreedKills()`, which merges reports across dates and difficulties. Assumption: enough group members run the
   addon with pull summaries on; if not, Progress is thin early, which is the honest result. Pull summaries are on
   by default for the uploader (Carlos, 2026-11-02, following the Warcraft Logs model in section 8).
3. **The boss must be on the agreed list.** Bosses come from `instanceDefs()` (`kb/src/guilds.ts`), the 3-install
   agreed instance facts the guild ladder already uses.
4. **Census agreement.** The link row's race, class and faction already must match the census at link time (ADR).
   A character must also be at the level band its kills require (a raid kill at level 20 is dropped).
5. **No contested sources.** Rows from an install id that the ADR's D9 marks contested do not count.
6. **Dates.** Nothing before launch (`CENSUS_LAUNCH`) and nothing dated after the server's clock. Three
   separate rules, not one: **intake** accepts a `kill_owned` row up to 60 days old at its first sync (the save
   file's window), so a late first sync loses nothing; **score eligibility** is the season window, so the nightly
   recompute never turns a season into a rolling month; **retention** keeps kill and pull evidence for the
   season plus 1 year (Carlos, 2026-11-02: 1 year to start, reviewed after season 1). The player rows'
   30-days-back rule (`PLAYER_DAYS_BACK`) stays theirs and does not apply here.
7. **Completion sanity.** A completion total above the agreed catalog's total, an achievement earned before launch,
   or a catalog entry fewer than 3 installs agree on scores nothing. Outliers are held for review, not shown.
8. **One character, one account.** A second claim freezes both (ADR D0, accepted 2026-10-28).

### 3.4 Where it is computed

A pure function, `kb/src/everloot-score.ts`, from rows to `{ version, progress, completion, parts[], asOf }`, so
the pages, the MCP tools and the export agree, like `kb/src/guilds.ts`. A nightly job writes one row per character
per version into a `character_scores` table; pages read that table. Tests: every rule in 3.3 has a fixture that
breaks it; the worked example above is a fixture; a score never includes another account's rows.

### 3.5 Not counted

| Not counted | Why |
| --- | --- |
| Gear and item level (`gear_snapshot`) | A forged file can claim any gear, and item level rewards luck as much as play. The unused `ranked_gear` flag stays off |
| Gold (`gold_snapshot`, `money_event`) | Rewards trading, invites bots, and DATA_POLICY lists gold as named data that leaves the machine only with a grant. `ranked_gold` stays off |
| Damage, healing, parses | No combat log is captured, and the ADR puts combat logs out of scope |
| Deaths, play time, level-up speed | Not captured per character; punishes casual play |
| Sightings (`player_seen`, `census_seen`) | Other people's observations; the ADR forbids mixing them into a linked character |
| Blizzard API data | Kept separate and labelled when it exists (showcase plan section 5) |
| Beta, PTR, pre-launch rows | Different game state |
| Mounts and pets | No collector writes `collection_owned`; shown as "not supported yet", never zero |

## 4. Rankings hub

`/rankings` grows from three boards into groups. Each board says what it counts, its rule, and its "as of" date;
an empty board says when it starts instead of showing zeros (as `START_LINE` does today).

"When" uses five states: **Now** (data and code exist), **Launch** (data starts 2026-11-04, code exists or is
small), **Map** (needs the realm to ruleset map, in progress), **Links** (needs links, S5 sync and a ranking
contract), **Capture** (needs a new addon record).

| Group | Board | Source | Chart | When |
| --- | --- | --- | --- | --- |
| Population | Classes, races, factions by week | Census rollup per week (`rankings.ts`) | `WeeklyChart`, `StackedWeeks`, `ShareBar` | Now (live) |
| Population | Characters counted per week | Census week totals | `WeeklyChart`, one series | Launch |
| Population | Level spread | Census level bands | `ShareBar` rows | Launch |
| Population | Any of the above per ruleset | Census rollup per ruleset scope (census design step 4) | same | Map |
| Bosses | Kills and wipes per boss, wipe rate | Anonymous `encounter` rows, boss on the agreed list, a count from 3 installs | Bar rows (`ShareBar`) | Launch (dungeons), 2026-12-09 (raids) |
| Guilds | Progression ladder | `guildLadder()` | `RankTable` | Now; fills from 2026-12-09 |
| Guilds | First kills timeline | Agreed kill times | New small SVG timeline | 2026-12-09 |
| Guilds | Most members seen | Players table, hidden guilds out | `RankTable` | Now |
| Players | Progress score, overall and by class, race, faction | `character_scores`, `ranked_score` on | `RankTable`, score histogram (new) | Links |
| Players | Completion, labelled self-reported (D3) | same | same | Links |
| Players | Rarest achievements (share of reporting characters) | `achievement_owned` rollup, counts only, 10-character rule | `ShareBar` | Links (owned rows need the sync consent) |
| Dungeons | Fastest runs by dungeon | Timing records (in progress) | `RankTable` | Capture |
| PvP | Honor, rank, kills | Nothing yet | — | Capture, after a client probe of the honor calls (PROBE-01) |
| Addons | Most run, with GitHub stars | `/addons/popular` rollup joined to the ecosystem snapshot | `ShareBar`, `WeeklyChart` | Now |
| Official | Our counts against published figures | Section 5 | Side-by-side table | Only when a qualifying source exists |

**Charts.** The repo has no chart library. The existing pieces are `WeeklyChart` (line), `StackedWeeks`
(stacked), `ShareBar`, `RankTable`, `ChangeMark` and `Swatch` in `web/src/app/rankings/parts.tsx`, the census share
bars in `web/src/app/census/page.tsx`, and `AgreementMeter` in `web/src/components/ui/`. Plan: keep server-rendered
SVG, and move `WeeklyChart`, `StackedWeeks` and `ShareBar` to `web/src/components/charts/` when the guild or addon
board becomes their second caller. New: a histogram (score spread) and a timeline (first kills), both small SVGs in
the same style. Each chart has a table of the same numbers under it for screen readers and copying.

**Filters.** Ruleset (after the map), faction, class, race, level band, week. A filter only picks cells that are
already published in the unfiltered rollup, as `RankingFilterKey` does today. It never reruns the rollup with its
own thresholds: a filtered total next to the unfiltered one bounds a hidden cell. Example from the review of this
plan, reproduced with `kb/src/census.ts`: with 100 Orcs, 10 Tauren and 1 Troll, the global view publishes 110 and
Orc 100 and hides the rest; a Tauren filter that publishes its own total of 10 bounds the Trolls below 10. Filters
on their own rollup wait for complementary suppression across every exposed filter and total, the same review as
the cube below. Never a sum of rounded parts.

**Drill-down into the census.** Clicking Trolls on the race board opens `/census?race=Troll` (and `&ruleset=` once
the map lands). v1 of that page highlights the Troll row and shows its class split, which the race × class grid
already publishes. Race × level, or race × class × level, is a new cube: publishing it next to the totals lets a
reader subtract a hidden cell. It waits for complementary suppression across the cube in `kb/src/census.ts`
(size M, its own review). The census drill-down never lists names; a named "all Trolls" list would be a new public
listing of other people's sightings and is out of scope (decision D7).

**Indexing.** Boards follow `rankingIndexable()`: unfiltered, enough ranked rows. Player boards stay noindex until
the owner accepts indexing for owner pages (policy draft decision 2).

## 5. Our numbers against official numbers

To our knowledge, Blizzard has not published a player count, subscriber count or realm population figure for WoW:
Forever. Nothing in the repo cites one. So the hub has no "official" column at launch, and none is estimated.

A comparison may show only a figure that a qualifying source published, quoted, with its URL, its date and what it
covers (Forever only, or all of WoW). Qualifying sources:

- Blizzard's own posts: news.blizzard.com, worldofwarcraft.blizzard.com, and staff ("blue") posts on the official
  Blizzard forums, which [the source ledger](../sources/LEDGER.md) already allows as link-only citations.
- Investor documents from Blizzard's owner (earnings releases, filings), quoted with the page.
- Blizzard's Game Data API, under the [Blizzard Developer API Terms of Use](https://www.blizzard.com/en-us/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use),
  if it serves Forever realms. Assumption, not checked: a realm entry carries a population label (such as Low or
  High) rather than a number, so the comparison would be our count beside Blizzard's label, never a ratio.

Not qualifying: other trackers and armories (WoWProgress, Raider.io, Warcraft Logs, Ironforge.pro), streamers,
Reddit, press estimates, and anything a reader has to scrape.

Every Everloot number on such a panel says what it is: "characters that Everloot installs counted this week", not
"players on Forever". We never scale our sample up to a population estimate.

## 6. Guild profiles and the ladder

Today a guild page shows agreed kills, the seen roster and the officer board (`loadGuildPage()` in
`web/src/lib/guilds.ts`). Upgrades:

| Upgrade | Source | Needs |
| --- | --- | --- |
| Boss grid per instance: killed or not, first agreed date, source (members or officers) | `guildProgression()` | Pure code |
| Progression timeline chart | Agreed kill times | Pure code; the timeline component |
| Faction and ruleset filters on the ladder | `guild_kill.faction`, the realm map | Ruleset waits for the map |
| Difficulty and size columns | `guild_kill.difficulty`, `size` | Pure code |
| Linked members: name, class, level, link to their character page | Members' own synced guild with `show_guild` on | S5, S6 |
| A member's alts | Only when that member turns on a new "show my other characters" switch, default off | D5 |
| Guild score (for example the median of the top 10 linked members' Progress scores) | `character_scores` | Not in v1. The ladder stays kill-based, as `kb/src/guilds.ts` says ("There is no combined score"); decision D6 |

Hiding a guild (`/guilds/hide`) keeps removing it from all sources, and its members' scores still count for
themselves but no board groups them under that guild.

## 7. Addons

| Piece | Source | Allowed? |
| --- | --- | --- |
| Usage rank #1, #2, #3… with share of reporting installs and versions | Opt-in `addon_seen`, 3 installs (`kb/src/addon-rollup.ts`) | Yes; live at `/addons/popular` |
| Weekly trend of an addon's share | Same rows, one rollup per ISO week like `rankingWeeks()` | Yes; pure code |
| GitHub stars, star history, latest release, last commit | The ecosystem snapshot `kb/changes/ecosystem.json`, written by the "Refresh ecosystem" workflow (`.github/workflows/ecosystem.yml`, every 6 hours) | Yes. GitHub's [terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms) allow API use within its [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) |
| CurseForge downloads, followers, profile data | CurseForge API | **No.** Section 3.1 of the [CurseForge 3rd Party API Terms](https://support.curseforge.com/support/solutions/articles/9000207405-curseforge-3rd-party-api-terms-and-conditions) (modified 2024-08-14) says a developer shall not "save or cache any data obtained through the API or SDK", and section 3.1 also bars using it to build a competing service. Link only, as the [ledger](../sources/LEDGER.md#link-only) already records |
| Wago Addons listing data | — | No documented read API for listings (ledger, checked 2026-10-18). Link only |
| WoWInterface | — | Its terms forbid automated access (ledger). Link only |

**Fitting around PR #611.** #611 is the standing "data(kb): refresh GitHub facts for the ecosystem tracker" pull
request the workflow keeps up to date; a maintainer merges it, never the bot. This plan reads stars from that
snapshot and never calls GitHub per board view. It does not edit `kb/changes/ecosystem.json` by hand. Adding an
addon to the board is an edit to `kb/curated/ecosystem.json` in its own pull request; the next refresh fills its
GitHub facts into #611. The usage rank joins to the registry through `addonNames` with the existing
`joinInstalls()` (`kb/src/ecosystem.ts`). An addon without a curated entry shows its install count and a CurseForge
search link, as `/addons/popular` does now.

## 8. Privacy

Every public piece maps to the [public-character policy draft](2026-11-01-public-character-policy-draft.md):

| Piece | Opt in | Opt out | Hide (no account) | Dispute |
| --- | --- | --- | --- | --- |
| Character page and card | `page_public` | Switch off: 404 at once | Hide form deletes it | Freeze both links (D8 contact) |
| Score on a board | New `ranked_score`, off by default, needs `page_public` | Switch off: gone on next request | Hidden characters never rank | Frozen characters never rank |
| Completion visual on a page | `show_collections` | Switch off | as above | as above |
| Main and alts on a profile | Main: owner picks; alts: new `show_alts`, off | Switch off | Hidden characters drop out | Frozen characters drop out |
| Login names (Twitch, Discord) | New per-login switch, off | Switch off | — | — |
| Member on a guild page | `show_guild` | Switch off | Hidden guild: whole page gone | — |
| Census and population boards | Census opt-in in the addon (`/everloot census on`); the uploader's census permission gates census rows | Turn it off in the addon | Counts only; nothing to hide | — |
| Anonymous boss kills, pull timing, runs | The addon's World recording (open-world module), on by default; census does not gate them | Turn World recording off | No names in them | — |
| Named pull summaries (group members, role, totals) | On by default for the uploader (Carlos, 2026-11-02); upload page and Desktop App, after the preview | `/everloot pulls off` deletes the rows | Hidden characters are dropped at intake; public only through a ranked board (D1) and a per-character hide | Frozen characters never rank |
| Addon usage | Addon list opt-in | Turn it off | Counts only | — |

Linking alts together publicly says that two characters are the same person. That is the most sensitive thing on
the profile, so it is its own switch, never implied by `page_public`. Accepting this plan's public pieces needs a
DATA_POLICY "Rankings" section, the ranking contract the ADR asks for in its section 5, and a matching paragraph on
/privacy. It also changes one line of the showcase plan: its risks say "no rankings are built on showcase data".
This plan ranks Progress on kills another uploader's pull summary confirms, which do not rest on the showcase's
self-reported rows; Completion has its own board labelled self-reported, and the combined total is never ranked.
Carlos accepted that change on 2026-11-02 (D1, D3).

**Other players' names.** The 2026-10-30 combat-log design said no other player's name would be stored. Carlos
changed that on 2026-11-02 to follow the Warcraft Logs model: whoever uploads sends the whole group, and the
protection is a per-character hide, like Warcraft Logs' hidden character parses
(https://www.warcraftlogs.com/help/hiding-characters). Its privacy policy says uploaded logs are public by design
(https://www.warcraftlogs.com/help/privacy). Before an addon release carries it: a DATA_POLICY.md change, a /privacy
paragraph, the upload preview's wording, and hides applied at intake.

## 9. Phases

Sizes: S about a day, M a few days, L a week or more. "Pure code" can merge on review behind its flag; "Owner" means
it waits on a decision, flag flip or applied migration. Showcase stages are named where they are prerequisites.

| # | Phase | Size | Depends on | Owner |
| --- | --- | --- | --- | --- |
| P0 | Hub v2 with what exists: population total and level spread, boss kills and wipes, guild and addon boards in the rail | M | Nothing | Review only |
| P1 | Census drill-down `?race=` and `?class=` on published cells; race and class boards link to it | S | Nothing | Review only |
| P2 | Addon: record the player's own kills, lockouts and guild locally from the first post-launch release (below) | M | Timing PR for the shared pull hooks | Release |
| P3 | Ruleset filter on census, rankings and ladder | S | Realm map PR #689; census and ladder also need the player-row migration (3.2) | Review only |
| P4 | Links and identity pages | — | Showcase S2, S3 | Policy draft decisions, D8 |
| P4a | Social sign-in on: provider apps and callbacks, `BETTER_AUTH_SECRET`, accounts migration check, the acceptance list in `docs/2026-10-30-social-sign-in.md`, then `EVERLOOT_AUTH_V2=1` | M | Built behind the flag; look redesigned in PR #686 | Carlos: provider keys, acceptance run |
| P5 | Profile v2: main from a link, alts switch, login switches, completion visual (owner preview) | M | P4, P4a; migration for `main_link_id`, `show_alts`, login switches | D4, D5 |
| P6 | Own-row sync including kills and guild; score computed, owner preview only, `/methodology/score` | L | Showcase S5; P2 data | D2, D9 |
| P7 | Public score boards and score on character pages | M | Showcase S6; P6; ranking contract; DATA_POLICY section | D1, D3; `ranked_score` migration |
| P8 | Guild profile upgrades: boss grid, timeline, linked members | M | P0 timeline; linked members need P6 | D6 |
| P9 | Dungeon speed boards (Progress v2) | M | Timing PR merged and its data flowing | Formula v2 |
| P10 | PvP capture and boards | L | A client probe that the honor calls exist on Forever | New record kind |
| P11 | Official figures panel | S | A qualifying published figure | Source check |

P0 and P1 can land in launch week. P6 should be in owner preview before the raids open on 2026-12-09, so the first
raid week is scored from day one; P7 follows once the owner accepts the contract.

**What the addon must start recording early (P2).** Scores are only as old as their data. The proposal is to
record from the first release after launch, kept in the player's own save file and sent only once the owner's sync
consent (S5) exists:

- `kill_owned` (new): `characterKey`, `encounterId`, `instanceMapId`, `difficulty`, `success`, `capturedAt`, from
  `ENCOUNTER_END`, the same event the anonymous `encounter` row and `guild_kill` already use. Per-pull timing fields
  come from the in-progress timing PR; this row does not add its own.
- `lockout_owned`: the showcase plan's S5 kind (instance, difficulty, bosses killed, reset), recorded at every reset.
- The character's own guild name and date for the owner sync.
- `kill_owned` holds only the player's own kill. Other players reach the server through the timing PR's pull
  summaries (section 8), which are what confirm attendance (3.3). The anonymous `encounter` row stays as it is.

The save file keeps 60 days of `kill_owned` rows (assumption; size to be checked against the upload limits in
`UPLOAD_LIMITS`). A protocol change follows CONTRIBUTING: build `packages/protocol`, reinstall it in `web`, `kb` and
`companion`, commit `dist/` and `schema/`.

## 10. Owner decisions

Carlos decided all ten on 2026-11-02, as recommended, with D1 and D9 sharpened by the review of this plan and by
his combat-data decisions the same day.

| # | Decision | Decided |
| --- | --- | --- |
| D1 | Ranking named characters, which changes the showcase plan's "no rankings" line and needs the ADR's ranking contract | Accepted. Progress ranks kills another uploader's pull summary confirms (3.3); reported-only kills score nothing |
| D2 | Score weights, tier list, season reset, lifetime board | The table in 3.2; seasons reset Progress; a frozen lifetime board later. Final-boss weight waits for the curated list |
| D3 | Completion score: own board, profile only, or merged | Profile, plus its own board labelled self-reported. Never merged into the Progress rank; the combined total is profile-only |
| D4 | Account score: best character only, or best plus an alt bonus | Best character only |
| D5 | Alts on profiles and guild pages | Own switch (`show_alts`), off by default |
| D6 | A guild score from members' scores | Not in v1; the ladder stays kill-based |
| D7 | Census drill-down: aggregate only, or named lists | Aggregate only, on already-published cells (section 4) |
| D8 | CurseForge: link only, or ask Overwolf | Link only |
| D9 | P2 addon capture: which release, and retention | First release after launch; the save file keeps 60 days; the server keeps evidence for the season plus 1 year |
| D10 | Login names on profiles (Twitch, Discord) | Per-login switch, off by default |

Combat data (PR #697), Carlos 2026-11-02: pull timing and run records on by default; named pull summaries on by
default for the uploader, also from the Desktop App; roles guessed when the game shows none, labelled "inferred";
1 year retention to start (section 8).

## 11. Risks

- **Thin corroboration.** Early on, few group members may run the addon, so many real kills will not count. The
  board says how many kills were not corroborated rather than lowering the bar.
- **Collusion.** One friend's install could list a character in a pull it was not in. The summary must match the
  boss, difficulty and 10-minute window of a real kill and come from another address, and the boss must be on the
  agreed list; an operator can drop a group's rows. Worth a review queue for sudden jumps and for confirmations that
  always come from the same install.
- **Client calls unverified.** `ENCOUNTER_END` works (the `encounter` rows exist); `GetSavedInstanceInfo`,
  `GetGuildInfo` for the sync, the completion calls and any honor call on Forever are PROBE-01 items. A missing call
  means "not supported yet", never zero.
- **Score disputes.** A published formula invites argument. Versioning, the methodology page and the worked example
  are the answer; weights change only with a version bump.
- **Two parallel PRs.** P2, P3 and P9 assume the timing and realm-map PRs land roughly as described. If they change
  shape, those phases change with them.
