# Everloot Score v1: the library

Date: 2026-11-02. Status: **library and formula text only. Nothing shows a score.** Public display waits on the
[public-character policy draft](2026-11-01-public-character-policy-draft.md) and the decisions below.

This is the code half of section 3 of the profiles, score and rankings plan
(`docs/design/2026-11-02-profiles-score-rankings-plan.md`, in review in
[#685](https://github.com/Everloot/everloot/pull/685)). It follows that formula and Carlos's decisions of
2026-11-02. Where the plan leaves a gap, this document says what the code does and why, so the owner can change it
in one place.

## What exists

| File | What it is |
| --- | --- |
| `kb/src/everloot-score.ts` | Pure functions: `scoreCharacter`, `scoreAccount` and `independentWitnesses`. Every weight and threshold is a named constant |
| `kb/src/everloot-score-example.ts` | The plan's worked example as made-up data, run through the real formula |
| `web/src/lib/everloot-score.ts` | `scoreInstances`: joins the agreed boss list with the game files' kind, difficulties and lowest level |
| `web/src/app/methodology/score.tsx` | The formula in plain English on `/methodology#score`, with the example's numbers printed from the code |

Nothing calls `scoreCharacter` outside the tests and the example. No loader, table, route or flag reads it.

## The formula

Two numbers per character: **Progress** and **Completion**. Speed and PvP are defined and not scored.

| Part | Counts | Points |
| --- | --- | --- |
| Raid | Each distinct raid boss and difficulty killed this season, confirmed | 10 × the raid's tier, from a tier list the owner signs off |
| Dungeon | Each distinct dungeon boss and difficulty killed this season, confirmed | 1; 3 for a boss on the curated final-boss list once it exists |
| Achievements | Completed, earned by this character, on the agreed list, not earned before launch | The list's points ÷ 10, rounded down over the total |
| Reputations | Factions at Exalted (reaction 8) on the agreed list; major and renown-style factions left out | 10 each |
| Titles | Titles on the agreed list | 5 each |
| Quests | Completed quests on the agreed quest list | 1 per 25, rounded down |

Progress = Raid + Dungeon. Completion = Achievements + Reputations + Titles + Quests. Completion is self-reported
and is never merged into the Progress ranking: the Progress board ranks Progress, a Completion board (if any) ranks
Completion under a "self-reported" label. `CharacterScore.total`, their sum, is for the character's profile only;
no board ranks it.

**Account score** (D4: best character only, no alt bonus): account Progress is the best Progress among the
account's counted characters in one ruleset, and account Completion the best Completion, each chosen on its own. A
high Completion never decides which character stands for the account's Progress. A character counts when its link
is not frozen, it is not hidden, its install is a source the account owns and it was scored with the same formula
version; for each number, only characters with that number scored take part. The account also gets a `record`: the
distinct bosses any counted character killed, for a profile, never ranked.

**Worked example** (made-up, `kb/src/everloot-score-example.ts`): 4 confirmed tier-1 raid bosses (40), 12 dungeon
bosses with 3 on a made-up final-boss list (18), 410 achievement points (41), 2 Exalted factions (20), 1 title (5),
180 quests (7). Progress 58, Completion 73, profile sum 131, matching the plan. Two more characters on the account
have Progress 0 and 2 and Completion 34 and 7; the account's Progress is 58 and its Completion 73.

## Anti-gaming

Only the character's own rows earn points: rows from its own install under its own completion key. A row with the
same key from another install, or from another character on the same install, is ignored. Every rule below has a
test in `kb/test/everloot-score.test.ts` that breaks it.

- **Confirmation.** A kill counts when another uploader's `pull_summary` (PR #697, on by default for the uploader)
  lists the character in the group for a pull of the same encounter and difficulty that ended in a kill, within 10
  minutes. The witness must come from an install that is not the character's and an address that is not the one its
  kill row was uploaded from. With more than one witness required (`CONFIRMATION.witnesses`), witnesses count as
  independent (install, address) pairs: no install and no address counts twice (`independentWitnesses`).
- **Reported, not confirmed.** An anonymous `encounter` row from another install, or the character's own guild's
  agreed kill that UTC day, on the same encounter and difficulty, shows the kill happened but not that this
  character was in it. It labels the kill `reported, not confirmed` in `kills.dropped` and scores nothing.
- **Boss list and difficulty.** The boss must be on the 3-install agreed list for the instance the kill names, and
  the difficulty must be one the game files give that instance. An instance whose kind is unknown, or with no
  difficulty in the files, scores nothing. A raid off the tier list scores nothing.
- **Level band.** A kill counts only when the character is at most 5 levels under the instance's lowest level in
  the game files. An instance with no level in the files scores nothing there. A character whose level is unknown
  has Progress `unknown` rather than a scored total that leaves those kills out.
- **Dates.** Three rules, as the plan sets them. *Intake*: an own kill row counts only when it arrived at most 60
  days after it was dated (`KILL_DAYS_BACK`), the save file's window. *Eligibility*: the season, from the later of
  launch and the season start, to the server's clock. *Retention* (season plus 1 year) is storage's job, not this
  library's. Any row, own kill or witness, that arrived after the server's clock, or is dated more than 10 minutes
  after it arrived (`CLOCK_SKEW_MINUTES`), counts for nothing.
- **Contested installs.** No row from a contested install counts: not its own kills or completion, and not as a
  witness.
- **Repeats.** Each boss counts once per difficulty. A later kill can still count if the first one was not
  confirmed.

The result lists why each dropped kill scored nothing (`kills.dropped`), so a profile can say "3 kills reported,
not confirmed" instead of hiding them.

**What the witness rule cannot stop.** A player with two installs behind two addresses (a second PC on a phone
connection, or a friend's) can still confirm their own kills. Confirmation raises the cost of a forged kill from
editing one file to running a second uploader with its own address that lists the character in matching pulls. The
library also cannot tell whether two installs belong to the same account; when the loader knows an account's other
sources, it should leave their pull summaries out before calling the score.

**Never counted:** gear and item level, talents, gold, damage or healing, deaths, play time, census sightings,
`player_seen` rows, other players' uploads as points of their own, guild lockouts as a character's own kills, and
any catalog entry fewer than 3 installs agree on.

## Unknown is not zero

Each component is one of three things:

- `scored`: points, including a measured 0. A character whose own kills are synced and who killed nothing has 0.
- `unknown`: others have this data and this character does not (no own kill rows, no completion rows, no level to
  check its kills, or a kind of completion row it never uploaded). It has no number, rather than a low one.
- `not-scored`: nobody's data of this kind is scored yet. It is left out alike for everyone. Today that is
  Progress (no addon records a character's own kills), Speed and PvP.

Completion needs to know which kinds of rows each character's uploads carried (`completionCoverage`): an upload of
achievements alone says nothing about titles. A kind with no agreed list yet is not needed.

## Adding Speed later

Speed is its own component with its own status. It reads no other component's data. Turning it on is a new
`SCORE_VERSION`, so numbers from before and after are never mixed: `scoreAccount` leaves out a character scored
under another version.

## Where this differs from the plan

1. **Page.** The plan names `/methodology/score`. This adds a section at `/methodology#score` instead, so no new
   indexable route, sitemap or llms entry comes before the owner's decisions. Moving it is a small change.
2. **Level band.** The plan says "the level band its kills require" without a number. The code uses 5 levels under
   the instance's lowest level (`LEVEL_SLACK`).
3. **Clock skew.** The plan says nothing dated after the server's clock. The code allows a row's own clock to run
   10 minutes ahead of its arrival, and no more.
4. **Completion outliers** "held for review" are not built: that needs a review queue. A total above the list's total
   cannot happen, because only listed entries count.
5. **Inputs the loader must supply.** Each kill row's upload address hash (`OwnKill.addressHash`), each pull
   summary's members resolved to linked characters (`PullWitness.members`), and which completion kinds each
   character uploaded. None of these loaders is written yet.

## What is not built

- The `kill_owned` record (plan, P2): `OwnKill` in the library is its proposed shape, not a protocol kind.
- Loaders from storage, the `character_scores` table and the nightly job (plan, 3.4).
- The tier list and final-boss list files. With no tier list no raid boss scores; with no final-boss list every
  dungeon boss is worth 1.
- The agreed quest list. With none, Quests is left out for everyone.
- Any public display, board or `ranked_score` flag.

## Owner decisions

Settled on 2026-11-02 and followed here: confirmation by another uploader's pull summary only; guild kills and
anonymous rows confirm nothing; final boss 3 only from a curated list; Completion self-reported and never merged
into the Progress ranking (D3), with the sum on the profile only; account numbers from the best character, chosen
per number, with no alt bonus (D4); intake 60 days, eligibility the season, retention season plus 1 year.

Still open:

1. **D2 weights.** Accept the table above as version 1, or change a constant in `WEIGHTS`.
2. **Tier list and final-boss list.** Which raid is tier 1, 2 and so on, and each dungeon's final boss.
3. **Level band.** 5 levels under the instance's lowest level, or another number.
4. **Clock skew.** 10 minutes, or another allowance.
5. **Season start.** Launch, then each new raid tier's opening day.
6. **Page location.** Keep `/methodology#score`, or move it to `/methodology/score`.
