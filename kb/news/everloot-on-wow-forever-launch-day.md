---
slug: everloot-on-wow-forever-launch-day
title: "Everloot on WoW: Forever Launch Day: What Works and What Fills In"
summary: "From launch, Everloot shows WoW: Forever's live game data. Names and stats come from the game files on day one; drops, prices and locations fill in as players upload."
author: Everloot Team
published: 2026-11-04
tags: [site, forever]
sources:
  - title: "Blizzard: World of Warcraft: Forever Goes Live Globally November 4!"
    url: https://news.blizzard.com/en-us/article/24315820/world-of-warcraft-forever-goes-live-globally-november-4
status: draft
---

**TL;DR:** From launch day, Everloot shows WoW: Forever as it is live. Item, spell and zone names come from the game's own files from the first hour. Drops, vendor lists, prices and where things are found depend on what players upload, so those pages start thin and fill in during the first days.

Blizzard opens the game at [3:00 p.m. PST on November 4](https://news.blizzard.com/en-us/article/24315820/world-of-warcraft-forever-goes-live-globally-november-4), which is 23:00 UTC. That is also the moment Everloot starts counting what players report.

## What is there from the first hour

The [database](/database) reads the live game files. An item page such as {item:2589} names the item and shows what the files hold about it: its item level, its sell price and the recipes that use it. The [dungeon and raid pages](/database/instances) list the bosses the files name for each instance, marked unconfirmed until players report kills.

The [class pages](/classes) and the [talent calculator](/tools/talents) use the live build's talents for all nine classes, with the game's own point rules. The [raid builder](/tools/raid) fills a 10, 20 or 40 player raid and shows which buffs and debuffs each group is missing. The [world map](/map) draws zones, flight paths and dungeon and raid entrances from the files.

The [changes timeline](/changes) lists the build the site is reading and Blizzard's posts. Pages for Beta now say that Beta is no longer running.

![The Everloot database page for Linen Cloth: item level, sell price and the recipes that use it, from the game files, with drop sources and map positions still empty](/news/figures/everloot-on-wow-forever-launch-day/linen-cloth-item-page.webp "An item page before launch: the game files fill the top, players fill the drop sources and map positions.")

## What fills in as people play

Some details aren't in the game files: which enemy drops an item, what a vendor sells, where a rare spawns, what an auction costs. Everloot only shows those after three different installs report the same thing. Until then, a page says it has no data rather than guessing. If nobody has recorded something, the page says unrecorded. A zero only appears when it was measured. The [methodology page](/methodology) explains how reports become facts.

Market prices work the same way. A day's price for an item on a realm becomes public once three different reporters have scanned it.

The rest of the site follows the same rule:

- **The map.** Vendors, trainers, quest givers, herbs, ore and chests appear on the [map](/map) once three installs agree on a place. On day one those layers read "waiting for player uploads".
- **Dungeon and raid entrances.** An entrance is confirmed once three installs zone in from the same spot.
- **The census.** The [census](/census) keeps only race, class, level and faction, never a name, and counts nothing from the beta. A count shows once it covers at least 10 characters reported by at least 3 installs from at least 3 addresses, and it is rounded to the nearest 5.
- **Guilds.** A boss kill counts for a guild on the [guild ladder](/guilds) once two installs report the same guild and boss. The kill is dated by the earliest report.

![The Everloot world map of the Eastern Kingdoms with the game art turned off: zone names, flight paths and dungeon entrances, and a sidebar where vendors, trainers, herbs and ore all read 0, waiting for player uploads](/news/figures/everloot-on-wow-forever-launch-day/map-waiting-for-uploads.webp "The world map before launch: flight paths and entrances come from the files; vendors, trainers and gathering spots wait for uploads.")

## Helping it fill faster

Install the [addon](/addon), play, and upload after you log out, either through the [upload page](/upload) or with the [Desktop App](/docs/guides/desktop), which uploads for you after every logout or `/reload`. If you turn on answers in the Desktop App and leave it running, you can also type `/ask` in game and read the answer after your next `/reload`.

A new install records the census and says so once in chat. An install from before the census needs `/everloot census on`. For guild kills, turn on `/everloot players on`.

If a page looks wrong, check where it says the fact came from, then tell us what you saw in game.
