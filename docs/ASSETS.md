# Blizzard icons, tooltip text and interface art

How the site gets Blizzard's own icons, tooltip text, talent window art and map pictures, and what a
maintainer does to put them on the site. The rules are in
[DATA_POLICY](DATA_POLICY.md) ("Blizzard's icons, tooltip text and window frame"). In short: only
from unencrypted files in the public client, read by our extractor; kept in asset storage with a
build stamp, **never in git**; credited on every page that shows them; pages only, never the API,
the MCP server or the data downloads. Blizzard's marketing art (key art, marketing logos, press kit,
wallpapers) is not part of this and is never used.

The talent art was decided first; item, class, buff and profession icons, item tooltip facts and map
pictures were approved on 2026-10-18 (DATA_POLICY, "Extension"). Loading screens, race and faction
emblems, spell tooltips where a spell is named and the game's own WoW: Forever logo were approved the
same day (DATA_POLICY, "Second extension", which quotes Carlos's decision). The code stays off on any
deployment where the variables below are unset.

The site works without any of this. With `NEXT_PUBLIC_GAME_ASSETS_URL` unset, or a manifest that
cannot be read in 2.5 seconds, every page shows the text it always had, with no error, no empty
image box and no credit line (the credit is there only when the art is). Without the private bucket
variables (`GAME_DATA_*`), item links stay plain while the other art still shows.

## Where the art shows

| Page | What appears |
| --- | --- |
| `/tools/talents/<class>` | Talent icons, tooltips, node frames and spec backgrounds |
| `/database/drops`, `/database/vendors/<id>`, `/tools/auctions` | Item icon beside each item link, the item's tooltip on hover and keyboard focus |
| `/database/items/<id>` | The item's tooltip as a card, once players have reported the item; the icon of each spell that creates or uses the item, beside that relation; the item's name, quality colour and icon where the game files and the Warcraft Wiki give the same name |
| `/database/items/<class>/<subclass>` | Icon and game file name of each listed item players have reported, and name, quality colour and icon for every item the game files or the Warcraft Wiki name; other rows stay "Item N" |
| `/tools/professions` | Profession icons as a picker |
| `/tools/raid` | Class, talent tree and buff icons, each buff's tooltip on hover and keyboard focus, and Molten Core's loading screen as the banner |
| `/map` | The game's own continent and zone pictures under the zone outlines, with a switch to hide them; the continent's loading screen as the banner; each dungeon's and raid's loading screen, small, beside its entrance; the game's minimap icons on the legend rows and the pins they switch, where the upload has them |
| `/changes` | Kalimdor's loading screen as the banner; a talent or raid buff a post names gets its icon, its tooltip and a link to the page that shows it |
| `/` | The launch banner: the game's own WoW: Forever logo over Eastern Kingdoms' loading screen, the launch countdown (moved from the hero onto the banner), and "Not affiliated with or endorsed by Blizzard Entertainment" on the banner. Class and profession icons, linking to the talent calculator and the profession hubs |
| `/wow-forever` | Race and faction emblems beside the race and faction names in the race and class table |

Every icon sits beside the name it already had, so it is marked decorative (`alt=""`,
`aria-hidden`). An item's or spell's tooltip text is also its description for screen readers. Banners
and the logo are decorative too: the page title, the game's name and the disclaimer are real text,
never part of a picture.

The launch banner is drawn only when the upload has the game's own logo. Without it there is no
banner, and nothing stands in for it: Blizzard's marketing logos are not used. Spell names in patch
notes are matched only for names of two words or more that stand for one spell the site shows
(`web/src/lib/spell-mentions.ts`), so a plain word like "Precision" is never taken for a talent.

Spoilers follow the same rule as everywhere else:

- **Items.** A page asks for an item's facts only when 3 installs have reported the item (a drop, a
  vendor offer, an auction scan). An id typed into a URL gets nothing, and nothing is read for it.
  The item facts live in a private bucket that only the site's server reads, because the extract
  holds every named item in the build, released or not.
- **Maps.** A held-back zone's picture, outline and name show only with spoilers on. A continent's
  own picture always shows: it is the original world's parchment map, with no names and no new land.
- **Loading screens.** A dungeon or raid with a map id after the original world's (above 533,
  Naxxramas) is marked held back, and its picture shows only with spoilers on. The banners the pages
  use (Eastern Kingdoms, Kalimdor, Molten Core) are all original maps.

## What the extractor makes

```
cd kb
npm run kb -- client-extract --product wow_classic_beta --refresh   # once per build, adds the item, spell, atlas and map art tables
npm run kb -- client-assets data/client/<product>-<build>-<config>.sqlite
```

`client-assets` needs Python with [Pillow](https://pypi.org/project/pillow/) (`pip install pillow`).
It writes two folders under `kb/data/assets/` (gitignored, like all of `kb/data/`):

```
<product>-<build>-<config>/            -> the PUBLIC bucket
  manifest.json            build stamp, label, counts, one entry per talent, class, profession,
                           buff spell (icon and tooltip), map, loading screen, race and faction, and the
                           logo; file names and sizes, no hashes, no item data
  icons/<fileDataID>.webp  one icon per icon file (talents, items, classes, trees, professions, buffs),
                           64 px as the game stores it
  frames/<name>.webp       node frames (round, square, choice; grey, green, gold), connector arrows,
                           the row gate piece and one background per spec
  maps/<uiMapID>.webp      one picture per continent and zone, at the game's base zoom,
  maps/<uiMapID>-small.webp  and a copy at most 320 px for the zoomed-out view
  loading/<fileDataID>.webp  one loading screen picture, at most 1600 px, whichever maps show it,
  loading/<fileDataID>-small.webp  and a copy at most 640 px for phones and thumbnails
  emblems/<name>.webp      race icons (raceicon128-<race>-<female|male>) and faction emblems, by their atlas name
  poi/<element>.webp       the minimap icons the world map's legend and pins use (Dungeon, Raid, TaxiNode_Neutral, ...), by their atlas name
  logo/<name>.webp         the game's own WoW: Forever logo (logo-wow-forever-2x, or the 1x piece)
  checksums.json           size and sha256 of every file above; the upload script checks it, it is
                           not uploaded

<product>-<build>-<config>-private/    -> the PRIVATE bucket
  items.json               build stamp, shard size, item count, each shard's size and sha256
  items/<n>.json           item tooltip facts, 512 item ids per file
```

Options: `--list lists/raid-buffs.yaml` (the default) names the raid buff spells whose icons the raid
builder shows. `--items <file>` limits items to the ids in a file (a JSON array or one id per line);
without it every named item in the build is written to the private folder.

How it works, and what it will not do:

- **Talent icons.** `SpellMisc.SpellIconFileDataID` of each talent's shown spell. The BLP file is
  fetched from Blizzard's CDN the same way the DB2 tables are, and converted to WebP.
- **Item icons and tooltips.** `Item.IconFileDataID` for the icon; name, quality, item level,
  required level, binding, slot, armour or weapon kind, weapon speed, stat kinds, flavour text and
  sell price from `ItemSparse` and `Item`. Stat amounts, armour and damage are worked out by the
  client from tables we do not read, so the tooltip shows `[?]` for them and says so: `+[?] Stamina`,
  `[?] Armor` on cloth to plate and shields, and `[?] - [?] Damage` with `([?] damage per second)` on
  weapons. Build 1.60.1's `ItemSparse` has no `MinDamage`/`MaxDamage` columns (WoWDBDefs layout
  6FCC3191, shared with retail 12.1.7); the client works damage out from the `ItemDamage*` tables (damage
  per second by item level, one column per quality, one table per weapon kind), the weapon speed and
  `ItemSparse.DmgVariance`. The snapshot now reads those tables, and each weapon's record keeps the
  inputs as `w` (`t` table, `dps`, `dv` variance, `ds` damage school); the site does not print numbers
  from them yet. Before it does, a maintainer checks a few weapons' `w` against the game's own tooltip
  (which table each weapon kind uses, and how min and max are rounded), and the item name rule's list
  of tooltip facts in `docs/DATA_POLICY.md` gains weapon damage. Which stat
  slots count is read from `StatPercentEditor` (a slot with a zero share is left out); that reading
  still has to be checked against a real snapshot.
- **Class, tree, profession and buff icons.** `ChrClasses.IconFileDataID`; each talent tree's
  `SkillLine.SpellIconFileID`; professions and secondary skills from `SkillLine` (categories 11 and
  9, top-level lines only); the raid buff list's spells from `SpellMisc`.
- **Relation spell and pet family icons.** `spellIcons` also holds the icon of every spell the
  committed client layer (`web/src/data/game-data/client-layer.json`) says an item is created by or
  used in, for the `/database` item pages; `familyIcons` holds `CreatureFamily.IconFileID` by pet
  family id. Spells and families are not items, so these are not gated on reports.
- **Map pictures.** `UiMapXMapArt` names each map's art, `UiMapArtTile` its tiles by row and column,
  `UiMapArtStyleLayer` the tile and picture size. The tiles of the base zoom layer are laid on their
  grid and cut to the picture, which covers exactly the rectangle `UiMapAssignment` gives the map, so
  it lines up with the zone outlines. Phased art is left out. A map with a missing, encrypted or
  unreadable tile is skipped and listed in `skippedMaps`, never drawn with a hole. The map page draws
  only the pictures in view, from their small copies until the reader zooms in.
- **Map legend icons.** The pieces the game's own map and minimap draw (`Dungeon`, `Raid`,
  `TaxiNode_Neutral`, `Innkeeper`, `Profession`, `QuestNormal`, `VignetteLoot`), cut out of the interface
  atlas like the emblems and listed in the manifest's `poi` by the map's legend category. The map page puts
  each on its legend row and on the pins that row switches, so the legend is the map. A category with no piece
  in the build keeps the site's glyph; vendors and other NPCs have none in the game either.
- **Loading screens.** `Map.LoadingScreenID` names each map's row in `LoadingScreens`; the widest
  picture the row names is used (`MainImageFileDataID`, else the 16:9, 16:10 and 4:3 files). Only
  continents, and dungeons and raids entered somewhere on a continent (the map layer's rule for
  entrances), are made. A picture shared by several maps is converted once. Lossy WebP, quality 80.
- **Race and faction emblems.** The client's race icons are named pieces of its interface atlas
  (`raceicon128-<race>-<female|male>`); the race name in the piece is ChrRaces' `ClientFileString`
  in lower case, except Undead (`Scourge`, piece `undead`). Only the races Blizzard has announced for
  WoW: Forever are extracted (`RACE_ATLAS` in `kb/src/assets/banners.ts`). The faction emblems are
  `AllianceEmblem` and `HordeEmblem`. Lossless, like the frame pieces.
- **The logo.** `logo-wow-forever-2x` (640 px), or `logo-wow-forever` (320 px) if the sharper piece
  is missing or unreadable, cut out of its atlas file like a frame piece. The manifest records the
  atlas element and file data id. If neither is in the build, the manifest's `logo` is null, the
  console says so, and the home page shows no launch banner. Nothing stands in for it.
- **Buff tooltips.** For the raid buff list's spells, `Spell.Description_lang` resolved the same way
  as the talent tooltips, into `spellTips`.
- **Tooltip text.** `Spell.Description_lang` with its `$` variables resolved from `SpellEffect`,
  `SpellDuration`, `SpellAuraOptions` and other spells' rows: `$s1`-`$s3`, `$m`, `$M`, `$d`, `$t`,
  `$o`, `$a`, `$x`, `$h`, `$n`, `${...}` arithmetic, `$/1000;s1`, plural `$l`, `$@spellname`, and
  `$<spellid>s1` references. What it cannot resolve (conditions on the player's auras, named
  variables, other spells' text, an effect value of 0 that the tables hold for a number that lives in
  a triggered spell) becomes the placeholder `[?]`, and the manifest lists the tokens. Nothing is
  guessed. The tooltip says so when it holds a placeholder.
- **Frame art.** The client's own talent window pieces are named in its interface atlas tables
  (`UiTextureAtlasElement`, for example `talents-node-circle-green`); the extractor cuts each piece
  out of its atlas file. The per-spec backgrounds are named for the modern specs. Our Classic trees
  whose spec the client has no background for use the nearest one, and the manifest says which
  (`nearest: true`): Rogue Combat (Outlaw), Priest Shadow Magic (Shadow), Shaman Elemental Combat
  (Elemental), Druid Feral Combat (Feral).
- **Round or square.** Active talents get the round frame and passive ones the square frame, from the
  spell's passive attribute bit (`SpellMisc.Attributes`), not from a guess.
- **Encrypted or missing files** are counted in the manifest and the console and left out. No key is
  loaded and no listfile is used. A talent or item without an icon file shows without one.
- **Sizes.** Icons and map pictures are lossy WebP (quality 90 and 82); frame pieces stay lossless.
- Every record is labelled *found in game files, unconfirmed* and stamped with the build.

## Game versions: Live, PTR and Beta

The site knows its game versions in one list, `web/src/lib/game-version.ts`. The header label next to the
search ("Beta · 1.60.1") and the build line on `/methodology` read from it. Today only Beta exists; Live
arrives at launch on 2026-11-04, and Blizzard runs no PTR for Forever. The Beta build is not typed in: it
comes from the `build` in `web/src/data/game-data/client-layer.json`. `game-version.test.ts` fails if any
committed game-data layer (client layer, map, talents, digests, spell values, raid file) names a different
build, so a build bump cannot leave one layer behind.

**Adding a product or build** (Live at launch, or a PTR):

1. Let the build watch see the product (`kb/src/builds.ts`, `kb/changes/builds.json`) and add it to the
   ecosystem products in `kb/src/ecosystem.ts` (`FOREVER_PRODUCT` is the Beta product today).
2. Extract and upload it as above. It gets its own `<product>-<build>-<config>/` asset folder, so the
   older version keeps working.
3. In `game-version.ts`, fill in `product` and `build` for its entry and set `available: true`. The
   test then expects every layer to name the build of the version the site shows, so regenerate the
   layers from the new snapshot in the same change. Beta's entry reads its build from the layer today,
   so give it its own build as a fixed value there, or it would show the new build under its name.
4. In `web/src/data/build-versions.json`, set `served` to the version the layers now hold. The test
   fails while it names another one.

**Version addresses.** The unprefixed pages show the served version; their URLs do not change when it
does, and only they are in the sitemap. `/beta/...` and `/ptr/...` (the `prefixes` in
`build-versions.json`, rewritten in `web/next.config.js`) show the same pages when that version is the
served one, with the canonical tag on the unprefixed page. Any other version's prefix shows one noindex
page saying the site holds no snapshot of it (`web/src/app/game-version/[id]`); no page is filled in
from another version's files. Showing two versions' data at once needs a second snapshot, which the site
does not have yet (`docs/2026-10-22-lane-version-routing-closeout.md`). The header label is information
only; the menu does not switch anything.

## Owner steps for the buckets

Done for production on 2026-10-18: public bucket `everloot-assets` at `https://assets.everloot.app`
(CORS GET/HEAD from everloot.app and www), private bucket `everloot-game-data`, an upload token (read and
write on both) and a site token (read-only, private bucket only), build 70450 uploaded, and the five
variables set in Vercel production. The code never creates a bucket, touches DNS or changes an account;
repeat these steps for a new build or another deployment.

1. **Public bucket.** In the Cloudflare dashboard, R2, create a bucket, for example
   `everloot-game-assets`. Keep it separate from the uploads bucket. Give it a public address:
   either a custom domain (for example `assets.everloot.app`, which needs a DNS record in the
   Everloot zone) or the free `r2.dev` address while testing. On it, allow CORS `GET` from
   `https://everloot.app` (and `http://localhost:3000` for local work), header `*`: the talent
   calculator reads `manifest.json` in the browser. The other pages read it on the server.
2. **Private bucket.** Create a second bucket, for example `everloot-game-data`, with **no** public
   address and no CORS. It holds the item facts.
3. **Upload key.** Create an R2 API token with *Object Read & Write* on those two buckets only. Keep
   the key id and secret out of git and out of the Vercel project; they are only for the upload.
4. **Server read key.** Create a second R2 API token with *Object Read only* on the private bucket
   only. This one goes into the Vercel project (step 7).
5. **Snapshot.** On a maintainer machine with the game's build available from the CDN, run
   `client-extract --refresh` (above) once for the build, so the snapshot has the item, map art and
   atlas tables.
6. **Extract and upload, one command.** In `web/`, with the upload key in the environment (never on
   the command line):

   ```
   export ASSETS_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
   export ASSETS_BUCKET=everloot-game-assets
   export ASSETS_PRIVATE_BUCKET=everloot-game-data
   export ASSETS_ACCESS_KEY_ID=...
   export ASSETS_SECRET_ACCESS_KEY=...
   node scripts/upload-game-assets.mjs --snapshot ../kb/data/client/<product>-<build>-<config>.sqlite --dry-run
   node scripts/upload-game-assets.mjs --snapshot ../kb/data/client/<product>-<build>-<config>.sqlite
   ```

   `--snapshot` runs `client-assets` first and prints its counts: icons extracted, encrypted
   skipped, tooltips resolved and unresolved, items recorded, map pictures made and skipped, and
   any frame piece that was not available. Read them. To upload folders you already extracted, give
   the public folder instead (the private one is found beside it):
   `node scripts/upload-game-assets.mjs ../kb/data/assets/<product>-<build>-<config>`.
   `--skip-items` uploads without the item facts (item links then stay plain).

   The script checks each folder against its list (nothing missing, nothing extra, every hash, only
   images and the manifest for the public bucket, only `items.json` and `items/<n>.json` for the
   private one), refuses a private bucket that is the public one, uploads eight files at a time,
   tries a failed file again up to four times, and uploads `manifest.json` and `items.json` last.
   Both land under `<product>-<build>-<config>/`, so each build has its own folder and an older page
   keeps working.

   **Re-uploading.** Files go up with a one-year `immutable` cache, and the script never deletes
   anything. Uploading changed files into a folder that is already live does not refresh browsers or
   the CDN, and files from an earlier run stay. A changed extract goes to a new build folder (a new
   build gives one by itself); to change one in place, delete the folder in the dashboard and purge
   the cache first. Removing anything is done in the dashboard.
7. **Turn it on.** In the Vercel project for `web/`, set:
   - `NEXT_PUBLIC_GAME_ASSETS_URL`: the public address plus the build folder, no trailing slash, for
     example `https://assets.everloot.app/wow_classic_beta-70450-84bea423`. Read at build time.
   - For item tooltips, server-only (never with a `NEXT_PUBLIC_` prefix): `GAME_DATA_S3_ENDPOINT`
     (`https://<account id>.r2.cloudflarestorage.com`), `GAME_DATA_BUCKET` (`everloot-game-data`),
     `GAME_DATA_ACCESS_KEY_ID` and `GAME_DATA_SECRET_ACCESS_KEY` (the read-only key from step 4).
     The server reads `<GAME_DATA_BUCKET>/<build folder>/items.json`, where the build folder is the
     last part of `NEXT_PUBLIC_GAME_ASSETS_URL`, and only for the same build as the manifest.

   Redeploy. Open `/`, `/tools/talents/hunter`, `/database/drops`, `/tools/raid`, `/map` and
   `/changes`: the icons, pictures, banners and the credit line appear. Pages read the manifest and item files again at most once an
   hour. To turn it off, clear the variables and redeploy.
8. **Item names.** The category lists and item pages name an item before players do wherever the game
   files or the Warcraft Wiki name it ([data policy](DATA_POLICY.md), "Item names from the game files
   and the Warcraft Wiki"). In `kb/`, with the snapshot and a knowledge base or release that holds the
   wiki dump:

   ```
   npm run kb -- item-names data/client/<product>-<build>-<config>.sqlite --wiki data/release/<release>.sqlite
   ```

   It adds both sources to the name ledger (`data/item-names/ledger.json`, which only grows and stays on
   this machine), prints the count per tier and the mismatches, and writes the names to show to
   `data/assets/<product>-<build>-<config>-names/item-names.json`. Check the counts and a sample of the
   names in a pull request, then upload that one file to the private bucket from `web/`, with the same
   upload key in the environment:

   ```
   node scripts/upload-item-names.mjs ../kb/data/assets/<product>-<build>-<config>-names/item-names.json --dry-run
   node scripts/upload-item-names.mjs ../kb/data/assets/<product>-<build>-<config>-names/item-names.json
   ```

   It goes to `<private bucket>/<build folder>/item-names.json` with a five-minute cache, so a re-run
   replaces it. The server reads it with the read-only key from step 7, only for the build of the
   committed client layer. Without it, every unconfirmed item reads "Item N".

   The server looks in the folder at the end of `NEXT_PUBLIC_GAME_ASSETS_URL`. If that is a re-extract of
   the same build under another name (production's ends in `-2`), add `--folder=<that folder>`; the script
   refuses a folder of another build. Then open an item page, such as `/database/items/25`, to check the name.

   Quest titles, item set names and spell names follow the same path ([data policy](DATA_POLICY.md),
   "Quest titles from the game files and the Warcraft Wiki" and "Item set and spell names from the game
   files"):

   ```
   npm run kb -- game-names data/client/<product>-<build>-<config>.sqlite --wiki data/release/<release>.sqlite
   ```

   It prints the counts and writes `quest-names.json`, `item-set-names.json` and `spell-names.json` beside
   `item-names.json`. Upload each one with the same script, dry run first. Without them, the pages read
   "Quest N", "item set N" and "spell N".

   To see what is still unnamed and why, run the gap report with the same two files:

   ```
   npm run kb -- name-gaps data/client/<product>-<build>-<config>.sqlite --wiki data/release/<release>.sqlite --out data/name-gaps.md
   ```

   For items, quests, item sets and spells it gives every id the source of its name, or, for an id without
   one, what would fill it: the addon's uploads, or no source yet. It lists ids, never names, and writes no
   name file; keep it local.
9. **Next build.** Repeat steps 5 to 8 with the new build. Check the counts against the last run
   before uploading; a jump in `iconsEncrypted`, `tooltipsUnresolved`, `mapsSkipped` or
   `loadingScreensSkipped`, or `logoExtracted` falling to 0, means Blizzard changed something.

If Blizzard asks for any of it to be removed, delete the build folders from both buckets and clear
the variables. The pages fall back to text by themselves.

## What to check on the site

At 1440 and 390 px wide:

- **Talents.** The icons sit inside the frames, the spec background shows behind each tree, gold
  means full, green means a point can be added, grey means locked, multi-rank talents show
  `rank/max` at the corner, the connector arrows are gold once the talent above is full, the tooltip
  opens on hover, keyboard focus and a long press (Escape closes it), and the credit line is under the
  trees. Each talent's accessible name still says its rank and whether it is locked, and its tooltip
  text is read by a screen reader without hovering.
- **Items.** On the drops, vendor and auction pages each item link has its icon in front; hovering
  or tabbing to the link opens the tooltip with the name in its quality colour; Escape closes it.
  An item page shows the tooltip card under the title, and a spell icon beside "Created by" and
  "Reagent for" when the item has those relations. A category page such as
  `/database/items/weapons/one-handed-swords` shows an icon only on rows players have reported. The
  credit line is at the bottom. No browser request ever goes to the private bucket.
- **Raid builder.** Class icons in the slots and the class picker, tree icons beside the tree names,
  buff icons in the coverage tables.
- **Map.** The zone pictures sit exactly inside the zone outlines; "Game map art" turns them off and
  "Zones" turns the outlines off. The continent picture shows, and a zone's own picture appears
  once you zoom in over it. The
  continent's loading screen is above the map, and each entrance in the list has its small picture.
- **Banners.** On `/`, `/tools/raid`, `/map` and `/changes` the loading screen fills its strip
  without stretching, at 390 px too. On `/` the logo is crisp, the game's name, launch line and "Not
  affiliated with or endorsed by Blizzard Entertainment" are readable over the picture, and the
  credit line is under the banner.
- **Spell tooltips.** In the raid builder, tabbing to a buff's name or hovering it opens its tooltip;
  Escape closes it. On `/changes`, a talent or buff a post names is a link with its icon and tooltip.
