# The character profile, and the release-day showcase

Date: 2026-10-24. Status: design; the showcase is built behind `EVERLOOT_SHOWCASE` (off). Owner brief (Carlos,
2026-10-24): the character page should read like Blizzard's Armory profile
(`worldofwarcraft.blizzard.com/.../armory/character/<realm>/<name>`), in a structure close to WoW: Forever's own
interface, and the guild, rankings, census and completionist pages should be ready as a demo for release day so
the site shows their shape before real uploads arrive. Builds on `2026-10-20-player-pages-design.md`,
`2026-10-24-guild-board-design.md` and the completionist overview (`web/src/app/tools/collections`).

## 1. What the Armory does, and what we can honestly do

The Armory profile is a header (name, title, level, race, class, spec, item level, guild, realm, faction), a tab row
(Character, Achievements, Collections, Dungeons & Raids, Player vs Player, Reputation), the equipped gear around a
model, stats, specialisations, a dungeon strip, raid progression cards per instance with kills per difficulty, and
PvP. It reads everything from Blizzard's database.

Everloot has no armory feed. A character page shows only what the addon saw and what its owner chose to share,
and each section says which it is:

| Armory section | Everloot source | Shown when |
| --- | --- | --- |
| Header: name, level, race, class, guild, realm, last seen | `players` row (player pages) | Always on a player page |
| Faction | Derived from the race (CENSUS_RACES; Skyborne reads "Skyborne" with no side) | Always |
| Raid progression per instance | The guild's agreed kills (`kb/src/guilds.ts`), the same cards as the guild page | When the character's guild has a page and a kill |
| Equipped gear and item level | A `gear_snapshot` naming this character, published under a verified grant and agreed by two officer uploads (`guild-board.ts` gear rows) | When published |
| Talents | A build the owner shared on a public profile whose character has this name and realm (`/u/<handle>`) | When shared |
| Achievements, Reputation, Titles, Quests | The completion rollup, keyed by the addon's opaque character key, visible only to the install that uploaded it | Never on the public page in this version. The tab explains how a player sees their own progress (the Completionist tool) and that it is not public. |
| PvP, dungeons, stats, model | Nothing | Not shown; no empty box either |

No section invents a number. A section with nothing to show says so once, as an `EmptyState`, and sections the data
cannot ever fill are left out rather than shown empty.

## 2. The page (`/players/<ruleset>/<realm>/<name>`)

- `Container width="wide"`. `PageHeader`: trail Home > Players > realm; title = the name; lede = "Level 60 Orc
  Shaman"; meta = guild (a link when guilds are on), realm, "Last seen <day>".
- A tab row (`Tabs`, hash state, as the design system defines): **Character**, **Raids**, **Progress**.
  - **Character**: the `Facts` grid (class in its colour, race, level, guild, realm, last seen), then "Equipped"
    (a `DataTable` of slot, item linked to its database page, item level, with the average and "from N officer
    uploads") when a published snapshot exists, then "Talents" (the shared builds with their short links) when any.
  - **Raids**: one card per instance the guild has kills in, newest tier first, `killed/bosses`, each boss with its
    kill day, exactly the guild page's progression cards (shared component), with the line "Kills reported by
    members of <guild>; the whole guild's progress, not this character's attendance."
  - **Progress**: the completionist explanation and a link to the tool; nothing else until a public opt-in exists.
- The hide-this-character card and the privacy link stay at the foot. noindex rules unchanged.

## 3. The showcase (`EVERLOOT_SHOWCASE=1`)

A set of pages at `/showcase` that render the real components with sample rows, so the site can show, before
launch, what a guild page, a ladder, a character profile, the census and the completionist overview look like.

- `/showcase`: the index. One `Banner`: "Sample data. Everything on these pages is made up to show the shape; the
  real pages fill with players' uploads after launch on 4 November 2026." Cards linking to each sample page.
- `/showcase/character`: the character page for "Examplechar", a level 60 Orc Shaman of "Sampleguild" on the realm
  "Showcase", with a published gear snapshot of real items from the game data (names and ids the database already
  shows; item levels from the same files), a shared build, and the guild's raid cards.
- `/showcase/guild`: Sampleguild's page: progression in two instances, a seen roster of eight sample characters,
  an activity list.
- `/showcase/rankings`: the rankings hub with six sample weeks (the stacked chart and the leaderboards).
- `/showcase/guilds`: the ladder with ten sample guilds.
- `/showcase/census`: the census with sample counts.
- `/showcase/completionist`: the completionist overview with a sample character 37% through the sample catalog.

Rules: every showcase page carries the banner at the top and `noindex`; sample names are clearly samples
(Examplechar, Sampleguild, Showcase); sample numbers are round and small; no sample page is linked from the
navigation (Carlos decides where to link it; the home and `/addon` are the candidates); the fixtures live in
`web/src/data/showcase.ts` and feed the same components the real pages use, so a showcase page can never drift
from the real one. Off: `/showcase/*` is 404.

## 4. Decisions for Carlos

a. Whether the showcase goes live before launch, and where it is linked from.
b. Whether the character page may show a build whose public profile names a character of the same name and realm
   (a match by name, not a verified link; the page would say "shared by @handle").
c. Whether the Progress tab should offer an owner opt-in to publish completion on the public page later (a new
   grant category); not built here.

## 5. Testing

Character page: each tab's section renders only with its data and is left out otherwise; gear needs a published
snapshot; the raid cards reuse the guild component (one test asserts the same markup); the hide card stays.
Showcase: 404 with the switch off; every page carries the banner and noindex; the fixtures pass the same schemas
the real rows do (`anyRecord` for records, the kb types for the rest).
