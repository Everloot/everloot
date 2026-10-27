# C05 pilots: review checklist

Four drafts for the editor, Carlos. Nothing in them is reviewed or published: each file is `status: draft` with
`reviewed: null`, and every piece of gameplay advice sits under an **Editor to confirm** heading as a line that starts
with `Proposed:`. Each file is published on its own, in a small pull request of its own, by the person who reviewed
it. Delete this checklist once the four are published or dropped.

| Draft | What changed | Status |
|---|---|---|
| [`kb/guides/mage-leveling.md`](../kb/guides/mage-leveling.md) | New guide: one talent set for levels 10 to 60, with its spend order | draft, never published |
| [`kb/wiki/ragefire-chasm.md`](../kb/wiki/ragefire-chasm.md) | Rewritten to its sources; Before you go added | draft, as before |
| [`kb/wiki/deadmines.md`](../kb/wiki/deadmines.md) | Rewritten to its sources; links to two draft pages taken out; Before you go added | draft, as before |
| [`kb/wiki/wailing-caverns.md`](../kb/wiki/wailing-caverns.md) | Rewritten to its sources; Before you go added | draft, as before |

## Where the facts come from

- **Game files**, the layers committed for build 1.60.1.70634 (`wowf`): the Mage talent catalog
  ([`mage.json`](../web/src/data/game-data/talents/mage.json)), the map layer
  ([`map.json`](../web/src/data/game-data/map.json): entrances, levels, flight points) and the talent text hashes in
  [`spell-values.json`](../web/src/data/game-data/spell-values.json). The guide describes a talent only where its text,
  read from the 1.60.1.70450 snapshot (sha256 `6c8c1e4715e4…`, the one the
  [source audit](sources/2026-10-27-class-legacy-dungeon-source-audit.md) uses), has the same hash as in 70634, so the
  text is unchanged in the current build. Five Mage talent texts differ, and the guide describes none of them: Missile
  Barrage, Improved Channeling, Ice Barrier, Winter's Chill and Frost Warding.
- **Blizzard**: the [Mage deep dive](https://worldofwarcraft.blizzard.com/en-us/news/24302097), read 2026-10-27, and
  the 1,314 Blizzard posts the tracker stores in [`blue-posts.json`](../kb/changes/blue-posts.json) (the latest of
  2026-10-23). None of them names these three dungeons for WoW: Forever; the two that name the Deadmines are Classic
  Era and Cataclysm Classic hotfix notes.
- **Lore**: Everloot's lore pages (`/lore/<id>`, the Warcraft Wiki dump the [ledger](sources/LEDGER.md) lists as
  published data), read 2026-10-27. Each page id is the same in the 2026-10-16 and 2026-10-24 knowledge releases. The
  source audit does not cover lore: to keep wiki lore to Blizzard's posts instead, cut the lines marked *lore* below.
- **Not used**: the game files' boss names (the instance pages show them as the files' names; a wiki page's facts
  list only the bosses three installs report), quest data (blocked in the files, per the audit), and any other site.

## Mage leveling guide

The plan was built one point at a time with the calculator's own rules, each point within the budget its level gives,
and places exactly on the 70634 Mage tree: no unknown, cut or refused talent, 51 of 51 points, the last at level 60.

- `code`: `EL1-mage-1482-1.60.1.70634-MTA1NzYyOjEsMTA1NzY0OjIsMTA1NzY2OjEsMTA1NzY3OjEsMTA1NzY4OjMsMTA1NzY5OjEsMTA1NzcyOjMsMTA1Nzc0OjMsMTA1Nzc1OjIsMTA1Nzc2OjMsMTA1Nzc3OjUsMTA1Nzc4OjMsMTA1Nzc5OjUsMTA1Nzg1OjMsMTA1Nzk0OjUsMTA1Nzk1OjUsMTA1Nzk2OjMsMTA1Nzk3OjI`
- `order`: `O1g-MMMMMHHHKKKKKDGGGEEEFCBBLLLJJJAPPPPPQQQOOOOORRNNNII`, legal point by point. It is **provisional on purpose**:
  no person has planned it yet. The check refuses to publish a provisional order, and Copy for addon stays off for it.

| Levels | Talent (tree) | Levels | Talent (tree) |
|---|---|---|---|
| 10–14 | Improved Frostbolt 1–5 (Frost) | 37–39 | Permafrost 1–3 (Frost) |
| 15–17 | Frostbite 1–3 (Frost) | 40 | Ice Barrier (Frost) |
| 18–22 | Ice Shards 1–5 (Frost) | 41–45 | Improved Fireball 1–5 (Fire) |
| 23 | Ice Lance (Frost) | 46–48 | Incineration 1–3 (Fire) |
| 24–26 | Frost Channeling 1–3 (Frost) | 49–53 | Ignite 1–5 (Fire) |
| 27–29 | Shatter 1–3 (Frost) | 54–55 | Improved Fire Blast 1–2 (Fire) |
| 30 | Ice Block (Frost) | 56–58 | Master of Elements 1–3 (Fire) |
| 31 | Cold Snap (Frost) | 59–60 | Improved Frost Nova 1–2 (Frost) |
| 32–33 | Fingers of Frost 1–2 (Frost) | | |
| 34–36 | Elemental Precision 1–3 (Frost) | | |

### Claims

| Claim | Source |
|---|---|
| The first point arrives at level 10, then one a level to 60, 51 in all; the plan spends all of them | Catalog `rules.pointLevels` (game files, unconfirmed); the plan |
| Talents start at level 10 | Deep dive |
| Frostfire Bolt is learned at level 40, counts as Fire and Frost, and is meant for builds with both | Deep dive |
| Improved Fireball also shortens Frostfire Bolt; Incineration raises Ice Lance's critical strike chance; Master of Elements refunds mana on Fire and Frost critical strikes | Talent texts, unchanged in 70634 |
| Cone of Cold's duration was cut against kiting by farmers and boosters; Improved Blizzard's slow was weakened to rein in Frost area damage | Deep dive |
| Talents, ranks and texts are from the game files and unconfirmed | Catalog `label` |
| Where Ice Barrier's gate counts is not settled; the calculator reads it as points in Frost | Catalog node 105762, `unlock.scope: unconfirmed`, and `rules.note` |
| Abilities and talents may keep changing through the beta | Deep dive |
| The game files have changed since the deep dive | Build 70630 changed Mage talents ([audit](sources/2026-10-27-class-legacy-dungeon-source-audit.md#build-and-evidence)); the catalog on main has them |
| A later build that changes a planned talent shows on the guide's page | [Guide freshness](GUIDES.md#guide-pages) |
| The second set opens at level 40; the deep dive gives 40 for Dual Specialization | Catalog `rules.dualSpecLevel` (from the beta notes); deep dive |
| Ragefire Chasm 13, the Deadmines 16, Wailing Caverns 17, and their pages | Map layer; `/database/instances/389-ragefire-chasm`, `/36-deadmines`, `/43-wailing-caverns` |
| Inside proposals: Improved Frostbolt speeds up Frostbolt; Frostbite gives chill effects a chance to freeze; Ice Lance hits frozen targets harder; Shatter raises critical strike chance against them; Fingers of Frost treats the target as frozen; Cold Snap finishes the other Frost cooldowns | Talent texts, unchanged in 70634 |
| Inside proposals: Improved Fire Blast opens Fire's fourth row | Catalog: Master of Elements needs 15 Fire points above it; 5 + 3 + 5 + 2 |
| Inside a proposal: Frost Nova freezes its target | **Not checked against the current files** (a baseline spell); confirm or cut |

### Proposed, awaiting you

1. Who it is for: players who level mostly on their own, by questing, and want enemies slowed and at a distance.
2. Why: levels 10 to 40 in Frost, Improved Frostbolt and Frostbite first, then Ice Lance, Shatter and Fingers of Frost.
3. Why: Ice Block and Cold Snap on the way, so the plan reaches Ice Barrier at 40.
4. Why: levels 41 to 58 in Fire (Improved Fireball, Incineration, Ignite, Master of Elements, and Improved Fire Blast to
   open the fourth row); the last two points on Improved Frost Nova.
5. Why: no points in Improved Blizzard or Improved Cone of Cold; level on one or two enemies at a time.
6. How: lead with Frostbolt; on a frozen target (Frostbite or Frost Nova), Ice Lance.
7. How: spend Fingers of Frost on Ice Lance.
8. How: keep Ice Block and Cold Snap for a fight that goes wrong.
9. How: from 40, Frostfire Bolt in place of Frostbolt on enemies that live long enough.
10. How: the three dungeons above, on the way.
11. The plan itself: every talent and its level, in the table above.

### To publish the guide (its own pull request)

1. Confirm, rewrite or cut each proposal. Take out the `### Editor to confirm` headings and the `Proposed: ` prefixes.
   Each of the four sections keeps words of its own, and the guide keeps at least 150.
2. Make the order a planned one. Either open `/tools/talents/mage`, import the code, reset the set, spend the 51 points
   in the order you want and copy `plan=` and `order=` from the calculator's link into `code` and `order`; or, if you
   keep the order exactly as listed, change `O1g-` to `O1p-`, leaving the 51 letters after it as they are.
3. In the front matter, with the build you checked it against (1.60.1.70634 today), and `version` left at 1:

   ```yaml
   status: published
   reviewed: { by: <your name>, on: <YYYY-MM-DD>, build: 1.60.1.70634 }
   history:
     - { version: 1, on: <the same date>, by: <your name>, build: 1.60.1.70634, note: "First published version." }
   ```

   If you rewrote the advice, put your name in `author` too; it reads `Everloot Team`, as the news posts do.
4. From `kb/`: `npm run kb -- guide-check` and `npx vitest run test/guides.test.ts`.

## Ragefire Chasm

| Claim | Source |
|---|---|
| Volcanic caves beneath Orgrimmar; troggs came up from below and met peace with hostility | *Lore*: Ragefire Chasm |
| Orgrimmar is the Horde's capital | *Lore*: Orgrimmar |
| The Searing Blade hides there: a Shadow Council sect, sister group of the Burning Blade clan, formed in Durotar to undermine the new Horde | *Lore*: Ragefire Chasm, Searing Blade |
| The Burning Blade began as an orc clan; part stayed loyal to the Burning Legion and became a cult | *Lore*: Burning Blade clan |
| The entrance is inside Orgrimmar, so Alliance groups cross a Horde city | Map layer (zone 1454), with the line above |
| Its level is the lowest of any dungeon entrance in the files | Map layer (13; the Deadmines next at 16) |
| The entrance is in the Cleft of Shadow | *Lore*: Ragefire Chasm (not in the committed game data) |
| Orgrimmar's own flight point is the nearest | Map layer |
| Blizzard has announced nothing specific for WoW: Forever; the page's entrance and level are the files', and its bosses are listed once players report them | Tracked posts, as above; the page's facts ([`dungeon-facts.tsx`](../web/src/app/wiki/dungeon-facts.tsx)) |

Proposed: (1) go with a group around the level the facts give; (2) Alliance groups plan their way through Orgrimmar;
(3) bring someone to hold the enemies' attention and a healer.

Taken out: the quest givers in the summary and History (quests are blocked in the files); the demon waiting at the
bottom (a boss; its identity waits on three installs); the warlock and rogue trainers, "a short one" and the walk in
through the main gate (no source); "the cult belongs to the Burning Blade" (the lore page makes them sister groups);
"the current beta build" (the current build is WoW: Forever's own).

## The Deadmines

| Claim | Source |
|---|---|
| Old gold mines under Westfall, abandoned in the First War, taken by the Defias Brotherhood, former laborers turned bandits | *Lore*: Deadmines |
| The entrance is in Moonbrook, in the southwest of Westfall | *Lore*: Deadmines; map layer (the entrance sits in the zone's southwest) |
| VanCleef is building a ship deep inside, with goblins | *Lore*: Deadmines, Edwin VanCleef |
| The Brotherhood overran the zone's farms | *Lore*: Edwin VanCleef |
| Sentinel Hill is the zone's only flight point in the files, with the entrance to its southwest | Map layer |
| The Stonemasons rebuilt Stormwind, went unpaid, were disbanded, rioted and fled to Westfall with VanCleef, where they became the Brotherhood, set against Stormwind's government | *Lore*: Edwin VanCleef |
| Blizzard has announced nothing specific for WoW: Forever; the page's entrance and level are the files', and its bosses are listed once players report them | Tracked posts, as above; the page's facts ([`dungeon-facts.tsx`](../web/src/app/wiki/dungeon-facts.tsx)) |

Proposed: (1) go with a group around the level the facts give; (2) fly to Sentinel Hill and travel southwest to
Moonbrook; (3) expect to fight the Brotherhood from the entrance to the ship, and rest when the group can.

Taken out: the militia's investigation, Gryan Stoutmantle and the letter that leads to the Stockade (quests); the
Horde's reasons to go (opinion); the Defias-held tunnels before the portal (no source checked); the links to
`westfall` and `stormwind-stockade`, both drafts, which a published page cannot link. The zone token still links
Westfall's database page.

## Wailing Caverns

| Claim | Source |
|---|---|
| Caves beneath the Barrens, named for the sound of wind and steam through the rock | *Lore*: Wailing Caverns |
| Naralex, a night elf druid, meant to reach the Emerald Dream through the waters and green the plains | *Lore*: Wailing Caverns, Naralex |
| The Emerald Nightmare overwhelmed him and, through him, corrupted the waters, the animals and most of his followers | *Lore*: Wailing Caverns |
| His followers, once a noble order, became the Druids of the Fang, spread the corruption and keep him asleep; a few still try to free him | *Lore*: Druids of the Fang |
| The entrance is in the Barrens, southwest of the Crossroads, whose flight point is the nearest of the zone's three | Map layer |
| Blizzard has announced nothing specific for WoW: Forever; the page's entrance and level are the files', and its bosses are listed once players report them | Tracked posts, as above; the page's facts ([`dungeon-facts.tsx`](../web/src/app/wiki/dungeon-facts.tsx)) |

Proposed: (1) go with a group around the level the facts give; (2) fly to the Crossroads and head southwest; (3) the
tunnels loop and double back, so agree on a route before the first pull (no source checked for the layout).

Taken out: the quest givers in the summary and History and the people at the cave mouth (quests and NPCs); the four
Fanglords, Mutanus and the disciple who wakes Naralex (bosses and an encounter; the page's facts list bosses once
three installs report them); "the first real dungeon in Kalimdor" (opinion).

## To publish a dungeon page (one pull request each)

1. Confirm, rewrite or cut each proposal; take out the `### Editor to confirm` heading and the `Proposed: ` prefixes.
   With no advice left, take out Before you go too.
2. In the front matter: `status: published` and `reviewed: { by: <your name>, on: <YYYY-MM-DD> }`.
3. From `kb/`: `npm run kb -- wiki-check` and `npx vitest run test/wiki-check.test.ts`. The test that kept every page a
   draft now lets these three be published, and still fails for any other page.

Publishing the dungeon pages before the guide changes nothing for it: the guide links their database pages, which are
always published, not the wiki pages.
