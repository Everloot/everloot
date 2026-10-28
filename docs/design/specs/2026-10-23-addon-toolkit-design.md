# Addon toolkit: what players install other addons for, built into Everloot

## Why

A WoW: Forever player who installs Everloot (addon, site, Desktop App) should not need the usual stack of
addons for money, loot, mail, vendors, alts and gear. Everloot already does part of this; this spec lists the
rest, in rounds.

## Decisions (Carlos, 2026-10-23)

- **One addon, many modules.** Every feature is a module inside `addon/`, switched on or off in `/everloot`
  options. No family of separate addons. Modules share the price, drop and item data and the one Desktop App
  upload; the site reads what a module records through the same intake and privacy rules as every other
  record.
- **Clean room.** Same idea, our own code, data, names and look. Nothing is read, copied or adapted from
  another addon's code, data or art. This extends the market spec's rule
  (`2026-10-16-forever-market-design.md`, "takes none of TSM's code or data").
- **Actions are opt-in.** A module that acts (sells, repairs, takes mail) is off by default and says what it
  did. The auction house stays read-only: nothing posts, bids or buys.

## The list

"Like" names the kind of addon players know; nothing is taken from it.

| # | Like | What it does | Everloot today | Round |
|---|---|---|---|---|
| 1 | TSM | Market values | `auctions`, `prices`, Desktop App realm picks | done |
| 2 | Auctionator | Scans, tooltip prices, shopping lists | scans and tooltips; no shopping lists | 3 |
| 3 | Disenchant value addons | Disenchant value per item | results not recorded | 1 |
| 4 | Gold trackers | Income per hour, money record | `gph`, `gold` | done |
| 5 | Mailbox helpers | Collect all | none | 1 |
| 6 | Junk sellers | Sell greys, repair | none | 1 |
| 7 | Alt trackers | Alts' bags, bank, gold, professions | none | 2 |
| 8 | Gathering maps | Herb and ore nodes | farming routes on the site | 2 |
| 9 | Quest helpers | Objectives and givers on the map | quest data on the site only | 3 |
| 10 | Loot browsers | Dungeon and raid loot | `drops` tooltips, site database | 2 |
| 11 | Upgrade finders | Is this an upgrade? | `gear` | 2 |
| 12 | Gear sets | Saved sets | none | 3 |
| 13 | Leveling guides | Step-by-step route | none | 3 |
| 14 | Quality-of-life settings | Small client settings | none | 3 |
| 15 | Profession helpers | Next recipe, crafting cost | profession planner | 2 |
| 16 | Talent planners | Builds | `talents` | done |
| 17 | Raid tools | Rolls, attendance | `raid` | done |
| 18 | Guild tools | Roster, board | `guild` | done |
| 19 | Collection trackers | What is missing | `completion`, collections | done |
| 20 | Damage meters | Damage and healing | none | 3 |

Left out on purpose: boss timers and aura frameworks (need encounter scripting we do not have), and bag,
nameplate and action bar replacements (replace Blizzard's interface, break often, and our data adds nothing).

## Rounds

1. **Before the addon release of 2026-10-30.**
   - Loot types: slice 2 of `2026-10-21-loot-tables-design.md` (`lootType`, `sourceItemId`, coin). Recording
     disenchants and opened containers from launch day is what a disenchant value needs later.
   - Merchant and mailbox conveniences: sell greys, repair, collect all. Off by default.
2. **After launch, data first.** Disenchant value on item pages and tooltips once disenchants reach the loot
   spec's install threshold; crafting cost against our prices; alt tracking in the Desktop App; gathering nodes
   in game from our own uploads; upgrade hints.
3. **Later.** Shopping lists, quest objectives in game, leveling routes, gear sets, small settings, damage
   meter. Each gets its own spec before work starts.

## What the site gets

Each module that records adds its record types to `packages/protocol`, so the intake, the corpus and the
privacy rules (own character only, no other player's name) apply unchanged. Display-only and action modules
record nothing new.
