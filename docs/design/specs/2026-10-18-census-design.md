# Census: who plays what on WoW: Forever

Date: 2026-10-18. Status: approved, decisions in §9. Owner decision: Carlos, 2026-10-18: "We need to build
our own census… added to our logic… make sure we max out everything on our own." No partnerships and no
outside census data.

## 1. Why

"How many Hunters are there?", "Alliance or Horde?" and "is my race/class combo rare?" are the questions
every new realm asks. Before launch they're also what the press quotes. Census sites that exist today work
from `/who` scans by a few volunteers. They publish character names, and they don't say whether a character
seen on ten days counts once or ten times.

Everloot can do better with what it already has: players running the addon and uploading. The census
counts each character once, never publishes a name, and states its method on `/methodology` before the
first number goes up.

## 2. What exists

- **Own character.** `addon/modules/completion.lua` `C.Identity()` reads the player's GUID, class token
  and level. It keys the character as `Adler32(installId:GUID)`, which is unique per install, not per
  character, so it can't de-duplicate across installs.
- **Other players.** `addon/modules/openworld.lua` already listens to `PLAYER_TARGET_CHANGED` and
  `UPDATE_MOUSEOVER_UNIT`, but it only keeps creatures (`npcIdFromGuid`). Player units are ignored today.
- **Realm.** Several modules send `GetRealmName()`. Forever is reported to be realmless (one realm per
  ruleset and region). That's not verified in game; see the 2026-10-17 data platform analysis.
- **Intake** (`web/src/app/api/intake/route.ts`) stores the *validated* upload, not the raw request body,
  and already adds a keyed hash of the upload address (never the address) before `putUpload`. The census
  uses the same pattern for character ids.
- **Publishing rule**: a fact appears once three installs agree. Addon lists are the precedent for data
  that's only ever published as counts, never row by row (`docs/DATA_POLICY.md`).

## 3. Sources, in order

| | Source | What it gives | When |
|---|---|---|---|
| A | **Your own characters** (`census_self`) | race, class, level, faction, realm string, for each character you log in | next addon release |
| B | **Players you see** (`census_seen`) | the same fields for player units you target or mouse over, or that are in your group; from the next addon release also players the game shows a nameplate for (§10) | next addon release |
| C | **Progress the addon already records** | completion module (achievements, reputations, titles, quests) for your own characters | exists (0.3.3) |
| D | **Blizzard profile API** | verified gear, level and achievements for a *named* character | only if Blizzard ships a Forever namespace; none exists (checked 2026-10-18) |

**A note on D.** The Battle.net profile API looks characters up by realm and name. It has no "list every
character" call, and Blizzard has never served beta or PTR namespaces. The census never holds names (§5),
so D can't produce population counts. It can enrich profile pages for players who share their name on
purpose (`site.sharing`, a verified grant), under the API terms: data refreshed at least every 30 days
and deleted when it's gone, and API data never behind a paywall. **Counts always come from A and B.**

## 4. Records

Two new intake kinds, the same shape:

```
census_self | census_seen
  installId, capturedAt
  guid        "Player-<server>-<id>"   (in transit only, see §5)
  race        race file token, e.g. "Scourge", "Skyborne"   (UnitRace second return)
  class       class token, e.g. "HUNTER"                    (UnitClass second return)
  level       1..60
  faction     "Alliance" | "Horde"
  realm       GetRealmName() for self; for seen, nothing: the server id inside the GUID says where they're from
  via         census_seen only: "target" | "mouseover" | "group" | "nameplate" (§10)
```

- No `UnitName`, guild, gear or position is read for other players. Ever.
- The addon keeps **one row per GUID per UTC day** (the latest level that day), so standing in a capital
  for an hour adds one row per player, not thousands. Within the 2,000-rows-per-kind cap, the oldest days
  go first.
- Opt-in, like every other non-basic module: `/everloot census on`. The upload page previews the counts
  ("312 characters seen, 2 of your own") before anything is sent.

## 5. Privacy

1. **The GUID never reaches storage.** Intake replaces `guid` with `characterKey =
   HMAC(EVERLOOT_CHARACTER_KEY, guid)` before `putUpload`, the same way it handles the address hash. The
   key is a server secret, so nobody can turn a GUID they see in game into our key. Rotating it resets
   de-duplication, nothing else.
2. **No record-level census rows are public.** Like addon lists, `census_*` rows stay out of the public
   corpus and feed a private rollup. Only aggregates are published.
3. **Small cells are hidden.** A count for any slice (ruleset × region × faction × race × class × level
   band) shows only when it covers at least 10 characters reported by at least 3 installs from at least 3
   distinct addresses. Intake stamps each stored row with `reporter`, a keyed hash of the sender's address;
   a row without one counts toward installs but not toward addresses, so many install ids behind one
   address don't clear the bar. Below that it
   reads "not enough reports", never a number that could point at one person. A cell with 40 characters
   from 2 installs is hidden too, so the label doesn't say "fewer than 10".
   While few players upload (2026-11-06), rows from Everloot's own installs (`EVERLOOT_TRUSTED_INSTALLS`) meet the
   install and address minimums on their own; the 10 characters, the suppression below and the rounding still
   apply, and the page and `population` say when their numbers include them (`kb/src/trusted-source.ts`).
   Hiding a cell is not enough on its own: a hidden part could be worked out from its total and the
   shown parts. So in every published sum, a relation with anything hidden has at least two hidden
   parts whose true counts add up to at least 10; where it wouldn't, the smallest shown part is hidden
   too (complementary suppression). Shown counts are also rounded to the nearest 5, each from its own
   true number.
   Before launch the census says the game has not launched yet and shows no window, not a date range
   that runs backwards.
4. **Data policy and privacy page** gain a census paragraph in the same PR as the intake change, before
   any upload can carry these kinds.

## 6. Counting

- **One character, one count.** The rollup keeps the latest row per `characterKey` across both kinds and
  all installs. A player seen by 50 uploaders, who also uploads their own data, counts once.
- **Windows.** "Active in the last 7 days" (the headline) and "seen since launch". Daily trend from the
  7-day window.
- **Level.** The latest level seen. Level bands 1–9, 10–19, … 60, plus "at 60".
- **Ruleset and region.** From the realm string (self) and the GUID's server id (seen, read before the
  GUID is hashed), mapped server-side once the in-game check at launch confirms how Forever names realms. Until then the census shows one global view.
- **Bias, stated on the page.** Self rows over-represent people who install addons; seen rows
  over-represent the zones uploaders play in. The page shows both shares ("62% seen, 38% own") so readers
  can judge.

- **Known risk: forged uploads.** Someone who fakes uploads from 3 installs and 3 addresses can make a small cell clear
  the 3-install threshold. By adding rows one at a time and watching the published counts move, they can
  still narrow down hidden numbers. Rounding and complementary suppression don't help against someone who
  controls the rows. The per-install daily cap slows this down but doesn't stop it. It is stated on
  `/methodology`, and the census doesn't claim more than that.

## 7. What players get

- **`/census`**: factions, races, classes, race × class grid (Blizzard's table from `/wow-forever`, now
  with counts), level bands, a 7-day trend, filters for ruleset and level. A sentence at the top says how
  many characters, from how many installs, in which window, and links `/methodology`.
- **MCP tool `population`**: "most played class on PvP", "how rare are Gnome Priests", with the same
  thresholds and the window in every answer.
- **`/methodology`** section "Population numbers" rewritten from "not yet" to the exact counting rules,
  merged before the first number is shown.

## 8. Plan

| Step | Scope | Needs the game? |
|---|---|---|
| 1 | Intake kinds `census_self` / `census_seen`, the GUID → `characterKey` swap, tests that a GUID is never stored; DATA_POLICY and `/privacy` paragraphs | No |
| 2 | `addon/modules/census.lua` + Lua contract tests (once-per-GUID-per-day, no names read, opt-in), selftest line for `UnitRace`; ships in the next addon release | Tests no; one beta login to confirm `UnitRace` tokens for Skyborne |
| 3 | Rollup (`kb/src/census.ts`): de-dupe, windows, thresholds; `/census` page and `population` MCP tool, showing "collecting" until thresholds are met | No |
| 4 | Realm → ruleset/region mapping after the launch-day check | Yes (launch day) |
| 5 | Blizzard API enrichment for shared profiles, if and when a Forever namespace exists | — |

Steps 1–3 fit before 2026-11-04 if the addon release goes out with step 2. The beta closes 2026-10-21, so
step 2's in-game check has to happen before then or on launch day.

## 9. Decisions (Carlos, 2026-10-18: "Yes, all three defaults")

1. **Players you see (source B): included**, with §5's protections. Only race, class, level and faction
   are kept, under a key nobody can reverse, and nothing is shown below 10.
2. **Opt-in.** Census is off until the player runs `/everloot census on`, like every other module. The
   privacy promise doesn't change.
3. **Small-cell threshold: 10 characters**, reported by at least 3 installs from at least 3 addresses.

## 10. Nameplates (Carlos, 2026-11-04)

The census also counts players the game shows a nameplate for (`NAME_PLATE_UNIT_ADDED`), not only the ones
you target, mouse over or group with. The game draws nameplates by the player's own settings (friendly and
enemy plates on or off, and how far away), so those settings decide which players this adds.

- **Same row, same fields.** A nameplate player is read like a mouseover: `UnitIsPlayer`, `UnitGUID`,
  `UnitLevel`, `UnitRace`, `UnitClass` and `UnitFactionGroup` on the `nameplateN` unit the event names, and
  `via` is `"nameplate"`. Hostile and other-faction players count as they do on mouseover. No call was added
  to the census list, and the contract test forbids `C_NamePlate` (reading every plate at once).
- **Load.** One row per player per UTC day and the 2,000-row cap are unchanged. A player already recorded
  today costs a few table reads and allocates nothing. New players are read from nameplates at most 10 a
  second, so arriving in a city spreads the reads out; a plate that waited is read when it shows again.
  Target, mouseover and the group are not throttled.
- **Names stay out.** The players module (`players.lua`, names and guilds) does not read nameplates, as its
  design says (`2026-10-20-player-pages-design.md`, what was left out), and its contract test still fails on
  any nameplate event, call or unit.
- **Server.** The protocol's `via` takes `"nameplate"` (protocol 1.26.0, record protocol 1.13.0); any other
  value is still refused. Census rows are stored in the upload store, not in a database table, so there is
  no migration. Nothing on the site breaks the counts down by `via`.
- **Bias.** Seen rows now lean further toward busy places, cities above all, where many nameplates show at
  once, so §6's bias note applies more strongly.
