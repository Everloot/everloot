# Player pages: find a character by name

Date: 2026-10-20. Status: built behind a switch, off. Needs the owner steps in §12 and the legal review in §13
before the switch goes on. Owner decision: Carlos, 2026-10-20: open player search. Any character the addon has
seen can be found by name, like Raider.IO and ironforge.pro, but it stays light on players' game and uploads and
on our servers. This is part 5 of `2026-10-20-site-structure-plan-design.md`.

## 1. What this changes

Today Everloot promises the opposite. This design breaks each of these on purpose, and §10 lists the text that
has to change with it.

| Today | With player pages on |
|---|---|
| Census never reads another player's name or guild. | A separate addon module, `/everloot players on`, reads other players' name and guild. The census module stays anonymous. |
| Uploaded observations carry no character names. | `player_seen` rows carry names, but they never go into the stored upload or the public corpus. |
| Named records need a verified sharing grant (`publication_grants`). | Player rows need no grant. Nobody is asked, not the uploader's own characters and not the players they saw. |
| Guild data is published only through an officer's upload. | A player's guild name appears on that player's page. No member list is published, and no guild page exists in version 1. |
| `character_suppressions` hides named records of owners who opted out. | The same table also hides player pages. |

What does not change: census rows stay anonymous and counts only; guild rosters, loot awards, gold, gear and
collection stay behind grants and officer uploads; no position, gear, history or GUID is ever stored for a
player page.

## 2. The data: one row per character

| Field | Source | Shown |
|---|---|---|
| name | `UnitName` | yes |
| realm | `GetRealmName` | yes |
| ruleset | constant `forever` until launch day (§6) | in the address |
| race, class | `UnitRace`, `UnitClass` second returns | yes |
| level | `UnitLevel` | yes |
| guild | `GetGuildInfo` first return, when the game shows one | yes, as text |
| last seen | the UTC date of the newest sighting | yes, a date, never a time |

Not stored, in version 1 or later without a new design: where the player was, gear, talents, professions,
gold, achievements, history of earlier levels or guilds, which install reported it, the GUID, a time of day.
The table has one row per `(ruleset, realm, name)`, lower-cased for matching. A newer sighting replaces the row.
A sighting without a guild keeps the guild the row had, so a guild can be out of date. The page says the data is
as of the day shown.

## 3. Where it comes from: the addon

A new module, `addon/modules/players.lua`, off until `/everloot players on` (then `/reload`). When off it
registers no events and reads nothing. Turning it off deletes every row it wrote, like the census.

| When | Event | Calls |
|---|---|---|
| Your character, at login | `PLAYER_LOGIN` | `UnitName("player")`, `UnitLevel`, `UnitRace`, `UnitClass`, `GetGuildInfo("player")`, `GetRealmName` |
| Your character, at level-up | `PLAYER_LEVEL_UP` | the same, with the level the event passes |
| A player you target | `PLAYER_TARGET_CHANGED` | `UnitIsPlayer("target")`, `UnitGUID`, then the calls above on `"target"` |
| A player you mouse over | `UPDATE_MOUSEOVER_UNIT` | the same on `"mouseover"` |
| Your group | `GROUP_ROSTER_UPDATE`, `PLAYER_LOGIN` | the same on `party1`..`party4` or `raid1`..`raid40` (`IsInRaid`) |

The whole list of game calls is `UnitIsPlayer`, `UnitGUID`, `UnitName`, `UnitLevel`, `UnitRace`, `UnitClass`,
`GetGuildInfo`, `GetRealmName`, `GetTime` and `IsInRaid`. `addon/tests/players_contract.py` fails if the module
names any call outside that list, and also fails on a list of calls and events it must not use. `UnitGUID` is
used only to tell one player from another in memory; it is never saved or sent.

Considered and left out of version 1:

- **Guild roster** (`GetGuildRosterInfo`, `C_GuildInfo`). It would list a whole guild in one read, which is
  the officers' data under today's rules, and it is up to 2,000 rows at a time.
- **Nameplates** (`NAME_PLATE_UNIT_ADDED`). Fires for every player in view, so it would read far more people
  than the player is looking at.
- **Inspect, who list, chat, friends.** More data per player, none of it needed for a name page.
- **Players from another realm.** `UnitName` returns their realm as a second value. A row holds one realm
  string, so they are skipped until launch day shows how Forever names realms.

To confirm in the game before the switch goes on (the beta closes 2026-10-21, so this is a launch-day check):

1. That `UnitName` returns an empty or nil realm for players on your own realm in Forever.
2. That `GetGuildInfo(unit)` answers for a targeted or moused-over player without inspecting them.
3. That `UnitRace`'s second return for Skyborne is a letters-only token (the census already needs this).
4. How realms and rulesets are named, so `rulesetOf` in `web/src/lib/player-pages.ts` can stop returning
   `forever` for everything.

## 4. Load budget

**In the game.** Nothing runs while the setting is off.
With it on:

- A player already read is not read again for 10 minutes. The check is one table lookup and allocates nothing
  (the contract test runs 20,000 mouseover events and fails if memory grows by 1 KB).
- Two reads from target or mouseover are at least 0.25 seconds apart. A roster change reads the group once.
- At most 300 new characters a UTC day. A character already in the file still updates.
- At most 1,000 rows in the file. Over that, the oldest rows go; the module never stops collecting.
- A row is about 200 bytes, so a full file adds about 200 KB to SavedVariables.
- The memory of who was read recently is capped at 2,000 players and cleared when it fills.

**Upload.** The rows go only from the upload page, after its preview ("Players in this upload: 312"). The
companion holds them back, like the census. One upload carries at most 1,000 player rows
(`UPLOAD_LIMITS.playersPerUpload`), about 250 KB of JSON against the 1 MB body limit. A row is a character, not an event, so
sending the same file again changes nothing on the server.

**Server.**

- One batched call per upload: `upsert_players(rows)` writes up to 1,000 rows in one statement.
- One row per character, primary key `(ruleset, realm_key, name_key)`. A repeat of rows already stored writes
  nothing (the update has a `where` for "something changed").
- The realm key is the realm as one key however it was spelled: lower case, the curly apostrophe as a straight
  one, any run of spaces and hyphens as one space — the same rule the character links use, and for the same
  reason: a spelling cannot dodge a hide. The key is not the realm as the game spells it, so the hide of a
  character reaches it however the realm was typed. The realm the page shows is the game's own spelling.
- Name search is `name_key like 'abc%'` on an index built with `text_pattern_ops`. At least 2 letters, at most 25
  results, no paging, so a search cannot list the table.
- Search results are cached for 5 minutes by prefix. A character page is cached for an hour. An opt-out clears
  the caches at once.
- Reads and writes go through database functions that only the server's role may call. No bulk download, API,
  MCP tool or corpus feed carries player rows.
- Rate limits: the intake route keeps its per-address and per-install limits; the opt-out form uses the same
  per-address limit.
- With the switch off the table is never touched.

## 5. Intake

`player_seen` is a new record kind in `@everloot/protocol` 1.4.0 (protocol 1.2.0): `name`, `realm`, `race`,
`class`, `level`, optional `guild`, on the usual `installId`, `eventId`, `capturedAt`. Names are letters only,
2 to 12; guilds are 2 to 24 characters of letters, digits, spaces, apostrophes and hyphens. It is not on the public
corpus allowlist.

In `POST /api/intake`:

- Switch off: every `player_seen` row is rejected with "Player pages are not collected yet.". The rest of the
  upload is handled as before. An upload of nothing but player rows is refused with 422 and writes nothing.
- Switch on: a row dated more than 30 days back or a day ahead is refused; rows beyond 1,000 are refused; the
  rest are written in one batch as the date only, never later than today. Player rows are not put in the stored
  upload object, so the R2 uploads and their rebuilds never hold names.
- If the table write fails, the upload is not confirmed and the player keeps the file and retries. Nothing is half
  stored: the batch is one statement and a retry is harmless.
- The table has no install id, address hash or reporter. We cannot say who reported a row, and deleting an
  upload does not touch the table. An uploader who turns the module off stops sending, and cannot recall rows
  already sent. The cost of that is in §9.

## 6. Pages

All of these answer 404 until `EVERLOOT_PLAYER_PAGES=1`.

- `/players`: a search box (`?q=`), name prefix, 2 to 12 letters, 25 results.
- `/players/<ruleset>/<realm>/<name>` (since 2026-11-05 a redirect to `/characters/...`, #773): name, level, race and class, guild, last seen date, realm, a short
  statement that it is unchecked game data from the addon, a link to hide the character, and a link to the privacy
  policy. The realm in the address is lower case with hyphens.
- `/players/opt-out`: the hide form (§7). Every page and every search result links to it, filled in.
- A guild page is not built. The existing `/guilds/[slug]` pages are curated guild families from public web
  pages, not guilds from uploads, and a member list would publish what today needs an officer. The guild name on
  a player's page is plain text. A guild page, if wanted, is its own design.
- Pages carry `noindex, nofollow` until `EVERLOOT_PLAYER_PAGES_INDEX=1`, a second switch, so turning the pages on
  does not at the same time hand names to search engines. Search result pages are always `noindex`. The pages are
  not in the sitemap, `llms.txt`, the API or the MCP server.

Ruleset: `rulesetOf` returns `forever` for every realm until the launch-day check says how realms map to
rulesets and regions. The address shape is final; only the value changes.

## 7. Opting out, and owners

**Without an account.** `/players/opt-out` (and the link on every page) takes a character name and a realm and
posts to `/api/players/opt-out`. It works without JavaScript. The server:

1. checks the name and realm are shaped like one;
2. applies the per-address limit;
3. calls `suppress_player`, which inserts `(realm, name)` into `character_suppressions` and deletes the row;
4. clears the search and page caches and sends the person back with "Done".

From then on the row is refused on write (`upsert_players` skips suppressed characters), left out of every read
(`get_player` and `search_players` check the table), and the page is a 404. It is the same table the grant
logic already reads, so a hidden character is also hidden from named records.

Nobody proves they own the character. Anyone can hide any character. The harm of a wrong hide is a missing page,
which we judge smaller than the harm of asking people to prove who they are to a fan site. The owner can lift a
hide by hand (the SQL is at the foot of the migration), and an email to hello@everloot.app does the same.
Hiding is per character, by name and realm; a person with ten characters sends ten requests. A guild-wide
opt-out does not exist in version 1.

**Owners with a Battle.net account.** Not built. Forever has no Blizzard profile namespace today (see the census
design, §3), so there is no way to prove a Forever character belongs to a Battle.net account, and the accounts
work (PR 173) does not claim characters. When a namespace exists, a claim would let the signed-in owner hide or
show their characters without sending a form, and would remove the "anyone can hide anyone" gap for them. Until
then the form and the email are the route.

## 8. Retention

- A row is deleted 90 days after its last-seen date. `prune_players()` runs from the snapshot cron, only with the
  switch on.
- A hide is kept for good, so a hidden character does not come back. It stores the lower-case name and realm
  only.
- Turning the switch off stops collection and pages at once. Deleting the rows is `delete from public.players;`
  by hand.
- Nothing links a row to an upload, an install or an address.

## 9. Abuse risks

| Risk | What this design does | What it does not solve |
|---|---|---|
| **Stalking and harassment.** A page says someone's character exists and is level 60 in a guild. | No location, no time of day, no "online now". The date is a UTC day. Pages 90 days stale are removed. A hide is one form away and needs no account. No history, so no pattern of play. | The name, guild and date are public. Someone who knows a name can check that it is active. |
| **Enumeration and scraping.** | 2-letter minimum, 25 results, no paging, no bulk file, no API or MCP exposure, a 5-minute cache, `noindex`. | Anyone can run many searches slowly. Vercel's firewall is the next layer. |
| **Forged rows.** Anyone can upload fake `player_seen` rows: a made-up character, a false guild, a wrong level. | Name, guild and level are shape-checked; at most 1,000 rows an upload and the existing per-install upload limit; dates held to 30 days back. Pages say the data is unchecked. | Rows are not corroborated: one upload makes a page. A threshold of 2 installs from 2 addresses would need a reporter table, which conflicts with keeping nothing about who reported (open question in §13). |
| **Defamatory or abusive guild names.** A guild name is free text from the game. | Letters, digits and a few marks only, 24 characters. | The game's own names pass. A hide removes the character. |
| **Griefing by hiding.** Someone hides other people's characters. | Per-character only, rate limited, reversible by the owner. | It is possible, and cheap. |
| **Harm to minors.** Some players are children. | The page holds a character name, class and level, no personal data of the person. | Whether this is personal data about a child is a legal question (§13). |
| **Names that are real names.** Some players use their own. | Same as any character name, same hide route. | We cannot tell. |
| **Linking to other sites.** | Nothing links out. | |

## 10. What the privacy page and terms must say

The live pages stay as they are. The drafted text below goes in only when the switch goes on, and the changes to
existing sentences go in the same release. Nothing here is on the site today.

**Privacy policy, new item under "Information we collect" (anchor `player-pages`):**

> **Player pages (optional for uploaders, public for characters):** if you turn on `/everloot players on` in the
> game, the addon records the name, realm, race, class, level and guild of your own characters, and of players you
> target, mouse over or group with, and the day it saw them. It never records where a player is, what they wear
> or what they do. You send these rows only from the upload page, after a preview. We keep one row per character,
> the newest, and show it on a public page you can find by searching for the name. The row says nothing about who
> reported it, and we delete it 90 days after the character was last seen. The players it names have not been
> asked. Anyone can have a character hidden, without an account, on the hide form; a hidden character is deleted and
> not recorded again. If you play a character and do not want a page, hide it. You can also email
> hello@everloot.app.

**Privacy policy, sentences that stop being true and must change:**

- "Census (optional): ... It never reads another player's name, guild, gear or position." Add that the separate
  players module does read names and guilds, so the census paragraph stays accurate about the census alone.
- "Uploads: ... Your anonymous observations are published as individual records without the install id."
  Add that player rows are not part of the public records.

**`docs/DATA_POLICY.md`:** the paragraph "Uploaded observations are public as individual, anonymous records,
with no character names" and the sentence "named records only with that person's sharing choice" need an
exception for player pages, and a new paragraph with the §2 field list and §8 retention. The companion sentence,
"keeps named data (guild, gear, gold, collection) on your machine", stays true: the companion also holds player
rows.

**`/methodology`:** the description "names and addresses are never published" and the section "What we never
publish" need the same exception. **`/addon`:** "named data stays on your computer unless you choose to share it"
needs the same. **`/upload`:** the preview already shows a paragraph when player rows exist; it says "the server
drops these" until the switch is on and describes the page when it is.

**Terms of use:** a clause that the player pages show unverified information reported by other players, that
Everloot makes no statement that a character belongs to anyone, that hiding is available on request, that
Everloot may remove any page, and that using the pages to harass or locate a person is not allowed.

**In the game:** the addon's `/everloot players on` message already says what is read, that it is sent only from
the upload page, and that characters may appear on public pages and can be hidden.

## 11. The switches

| Name | Where | Effect |
|---|---|---|
| `EVERLOOT_PLAYER_PAGES=1` | web environment | Off (unset): intake drops player rows, `/players`, the character pages, the hide form and its route answer 404, retention does not run, and the table is not read or written. On: all of them work. |
| `EVERLOOT_PLAYER_PAGES_INDEX=1` | web environment | Needs the first. Lets search engines index the character pages. Off: `noindex, nofollow`. |
| `/everloot players on` | addon | Off by default. Off: no events, no reads, no rows. Needs a released addon version to reach players. |

## 12. Owner steps before the switch goes on

1. Legal review of §13 and the text in §10, done.
2. Publish the privacy, terms, DATA_POLICY, methodology and addon-page changes from §10, to go live with the
   switch, not before.
3. Apply `supabase/migrations/20261021130000_players.sql`. Check it with `supabase/tests/players.sql` on a
   disposable database first.
4. Release an addon version that includes `players.lua` (the module is in the source and off by default; the
   current release, 0.3.3, does not have it).
5. Do the launch-day checks in §3 and set `rulesetOf` if realms map to rulesets.
6. Set `EVERLOOT_PLAYER_PAGES=1` in Vercel and redeploy. Leave `EVERLOOT_PLAYER_PAGES_INDEX` unset for the first
   weeks and look at what the pages hold.
7. Decide separately whether to set `EVERLOOT_PLAYER_PAGES_INDEX=1`.
8. To switch off: unset `EVERLOOT_PLAYER_PAGES`, redeploy, and run `delete from public.players;` if the rows should go.

## 13. Open legal questions for the lawyer review

1. **Lawful basis and notice.** Players seen by an uploader are not asked and are not told. Is legitimate interest a
   workable basis for a public name page, and what notice is enough when the people named never visit the site?
   Does this change for players in the EU, UK and California?
2. **Is a game character name personal data?** And a guild name plus a character name plus a level and a date?
   Does it matter that some players use their own name?
3. **Minors.** Players under 18 are likely. Does publishing their character page need more than a hide form?
4. **Opt-out versus opt-in.** Is an opt-out that anyone can use, with no proof of ownership, enough? Is an
   objection or erasure request we cannot verify handled correctly by hiding at once?
5. **The uploader's side.** The uploader chooses to collect other players' names. Is the uploader a joint
   controller? Is the addon's on-screen notice and the upload preview enough, and does the uploader need terms of
   their own?
6. **Blizzard.** Does the World of Warcraft EULA, the Terms of Use or the API terms bar an addon from reading and
   sending other players' names and guilds, or us from showing them? The census design relied on never reading
   names; this does not. Does Blizzard's stance on third-party player-lookup sites (Raider.IO, ironforge.pro)
   settle it or not, since they use the Battle.net API and we use addon reads?
7. **Forged or false rows.** Is saying "unchecked, reported by players" enough protection if a row is false and
   defames someone? Do we need a corroboration threshold, and does keeping who reported a row (to count
   reporters) cost more privacy than it buys?
8. **Retention.** Is 90 days since last seen right? Is keeping a hide forever, as a lower-case name and realm,
   acceptable?
9. **Guild names.** Is a guild name on a character's page a statement about the guild's members, and does a guild
   need its own opt-out?
10. **Search engines.** Is indexing character names acceptable, and should it ever be on?
11. **Takedown and abuse.** What do we do with a court order, a harassment complaint, or a request from a
    person who cannot use the form?

## 14. What shipped, and how it was checked

Added: the protocol kind and limit (1.4.0); `addon/modules/players.lua` and `addon/tests/players_contract.py`;
the migration and `supabase/tests/players.sql`; the intake branch; `web/src/lib/player-pages.ts` and
`player-store.ts`; `/players`, the character page, `/players/opt-out` and `/api/players/opt-out`; the upload
preview line; the companion holding player rows back; the cron retention call. Nothing is on: no migration is
applied and no environment variable is set by this change.

Checked: protocol, web, kb and companion unit tests; the addon's Lua contract tests against the protocol's JSON
Schema; the SQL test on a disposable PostgreSQL 16, covering one row per character, newest day wins, guild kept,
prefix search, an opt-out deleting and then refusing a character, a suppressed row never read, retention and the
batch cap. Not checked: a real Forever client (no game install here), a real Supabase project, and the
behavior of the launch-day items in §3.
