# Everloot Score v1: the library

Date: 2026-11-02. Status: **library and formula text only. Nothing shows a score.** Public display waits on the
[public-character policy draft](2026-11-01-public-character-policy-draft.md) and the decisions below.

This is the code half of section 3 of the profiles, score and rankings plan
(`docs/design/2026-11-02-profiles-score-rankings-plan.md`, in review in
[#685](https://github.com/Everloot/everloot/pull/685)). It follows that formula. Where the
plan leaves a gap, this document says what the code does and why, so the owner can change it in one place.

## What exists

| File | What it is |
| --- | --- |
| `kb/src/everloot-score.ts` | Pure functions: `scoreCharacter` and `scoreAccount`. Every weight and threshold is a named constant |
| `kb/src/everloot-score-example.ts` | The plan's worked example as made-up data, run through the real formula |
| `web/src/lib/everloot-score.ts` | `scoreInstances`: joins the agreed boss list with the game files' level, kind and final boss |
| `web/src/app/methodology/score.tsx` | The formula in plain English on `/methodology#score`, with the example's numbers printed from the code |

Nothing calls `scoreCharacter` outside the tests and the example. No loader, table, route or flag reads it.

## The formula

**Character score = Progress + Completion.** Speed and PvP are defined and not scored.

| Part | Counts | Points |
| --- | --- | --- |
| Raid | Each distinct raid boss and difficulty killed this season, corroborated | 10 × the raid's tier, from a tier list the owner signs off |
| Dungeon | Each distinct dungeon boss and difficulty killed this season, corroborated | 1, or 3 for the dungeon's final boss |
| Achievements | Completed, earned by this character, on the agreed list, not earned before launch | The list's points ÷ 10, rounded down over the total |
| Reputations | Factions at Exalted (reaction 8) on the agreed list; major and renown-style factions left out | 10 each |
| Titles | Titles on the agreed list | 5 each |
| Quests | Completed quests on the agreed quest list | 1 per 25, rounded down |

**Account score** = the best character total among the account's counted characters in one ruleset. A character
counts when its link is not frozen, it is not hidden, its install is a source the account owns, its total is known
and it was scored with the same formula version. The account also gets a `record`: the distinct bosses any counted
character killed, for a profile, never ranked. `scoreAccount` takes an optional alt bonus (`{ share, cap }`), off by
default, so decision D4 is one argument.

**Worked example** (made-up, `kb/src/everloot-score-example.ts`): 4 corroborated tier-1 raid bosses (40), 12 dungeon
bosses with 3 final bosses (18), 410 achievement points (41), 2 Exalted factions (20), 1 title (5), 180 quests (7).
Progress 58, Completion 73, score 131, matching the plan. Two more characters on the account score 34 and 9; the
account scores 131.

## Anti-gaming

Only the character's own rows count: rows from its own install under its own completion key. A row with the same
key from another install, or from another character on the same install, is ignored. Every rule below has a test in
`kb/test/everloot-score.test.ts` that breaks it.

- **Corroboration.** A kill counts when 2 other installs, from 2 other addresses (the upload's keyed address hash),
  report a successful kill of the same encounter and difficulty within 10 minutes. Or the character's own guild has
  that kill, agreed by 2 installs, on the same UTC day. The character's own install never corroborates itself.
- **Boss list.** The boss must be on the 3-install agreed list for the instance the kill names. An instance whose
  kind is unknown scores nothing. A raid off the tier list scores nothing.
- **Level band.** A kill counts only when the character is at most 5 levels under the instance's lowest level in the
  game files. A kill whose character level is unknown counts for nothing.
- **Dates.** Nothing before launch or the season start, nothing after the server's clock, nothing dated more than 30
  days before its upload or more than a day after it.
- **Contested installs.** No row from a contested install counts: not its own kills or completion, and not as a
  witness.
- **Repeats.** Each boss counts once per difficulty. A later kill can still count if the first one was not
  corroborated.

The result lists why each dropped kill scored nothing (`kills.dropped`), so a profile can say "3 kills not
corroborated" instead of hiding them.

**Never counted:** gear and item level, talents, gold, damage or healing, deaths, play time, census sightings,
`player_seen` rows, other players' uploads about the character, guild lockouts as a character's own kills, and any
catalog entry fewer than 3 installs agree on.

## Unknown is not zero

Each component is one of three things:

- `scored`: points, including a measured 0. A character whose own kills are synced and who killed nothing has 0.
- `unknown`: others have this data and this character does not (no own kill rows, no completion rows). It has no
  total, rather than a low one.
- `not-scored`: nobody's data of this kind is scored yet. It is left out of every total alike. Today that is
  Progress (no addon records a character's own kills), Speed and PvP.

So until the addon records own kills, a character's total is its Completion alone, for everyone the same.

## Adding Speed later

Speed is its own component with its own status. It reads no other component's data, and the total adds it only once
it is scored. Turning it on is a new `SCORE_VERSION`, so totals from before and after are never mixed: `scoreAccount`
leaves out a character scored under another version.

## Where this differs from the plan

1. **Page.** The plan names `/methodology/score`. This adds a section at `/methodology#score` instead, so no new
   indexable route, sitemap or llms entry comes before the owner's decisions. Moving it is a small change.
2. **Level band.** The plan says "the level band its kills require" without a number. The code uses 5 levels under
   the instance's lowest level (`LEVEL_SLACK`), and drops a kill when the character's level is unknown.
3. **Final boss.** The plan does not define it. The code uses the last encounter the game files list for a dungeon.
   If that encounter is not on the agreed list yet, no boss in the dungeon is worth 3.
4. **The 30-day rule** is measured from each row's upload, not from the day the score is computed, so a season-long
   score keeps its early kills.
5. **Completion outliers** "held for review" are not built: that needs a review queue. A total above the list's total
   cannot happen, because only listed entries count.
6. **Witness addresses.** The plan's corroboration needs each anonymous `encounter` row's address hash. Stored upload
   parts carry `reporter`; the loader that attaches it to each row is not written yet.

The brief for this work also suggested three things the plan settles differently. The code follows the plan:
collections are left out of Completion (no addon module writes `collection_owned`); raid weight comes from a curated
tier list, not from game-file levels; and the account score is the best character only, with the alt bonus as an
option.

## What is not built

- The `kill_owned` record (plan, P2): `OwnKill` in the library is its proposed shape, not a protocol kind.
- Loaders from storage, the `character_scores` table and the nightly job (plan, 3.4).
- The tier list file. With an empty list no raid boss scores.
- The agreed quest list. With none, Quests is left out for everyone.
- Any public display, board or `ranked_score` flag.

## Owner decisions

1. **D2 weights.** Accept the table above as version 1, or change a constant in `WEIGHTS`.
2. **Tier list.** Which raid is tier 1, 2 and so on. Without it no raid boss scores.
3. **Level band.** 5 levels under the instance's lowest level, or another number.
4. **Final boss rule.** The files' last encounter, or a curated list.
5. **D4 alt bonus.** Best character only (the default), or a capped share of the others.
6. **D3 Completion.** Its own "self-reported" board, profile only, or merged into one rank. Completion rows can be
   written by hand; Progress needs other installs to agree.
7. **Season start.** Launch, then each new raid tier's opening day.
8. **Page location.** Keep `/methodology#score`, or move it to `/methodology/score`.
