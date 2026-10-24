# Changelog

All notable changes to Everloot, in the style of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The addon is versioned (`0.3.x`, tagged `addon-vX.Y.Z`) and so is the desktop app (tagged `desktop-vX.Y.Z`). The site and the knowledge base deploy from
`main` and have no version number, so their milestones are listed by date at the bottom. Site and MCP
server changes under Unreleased are already live on everloot.app; Unreleased means not yet in a tagged
addon or desktop release.

This file was started on 2026-10-17 from the merged pull requests and commit history. Addon releases
from 0.3.0 on have a GitHub release page with the zip and its `SHA256SUMS`; `0.2.1` is the first addon
build that has a zip in the repository. Earlier builds have none.

## [Unreleased]

Pull requests merged to `main` are listed in the nightly pre-releases until the next tagged release.

### Added
- Site: **Copy for addon** on both planners, exporting the selected talent set or planned raid code.
- Site: a news section. Posts are Markdown files under `kb/news/` with front matter (`npm run kb -- news-check`
  runs in CI), written in the wiki's syntax so they link database entities and wiki pages the same way. Published
  posts appear at `/news` and `/news/<slug>` with Article structured data, in the `/news/feed.xml` RSS feed, in the
  sitemap and in llms.txt; a draft is built nowhere. Blizzard's own posts stay on `/changes`, which the hub links.

### Changed
- Knowledge base: `entities.name_norm` stores each name's words as the search re-rank reads them, with an index on
  `(name_norm, kind)`. The exact-name lookup reads it instead of scanning every row through `lower(replace(...))`,
  and now matches non-ASCII capitals and punctuation the SQL expression missed. A punctuated name with stopwords
  ("Rise of the Lich-King") is found when asked with all its words. Releases built before the column still open and
  search through the old expression; the speedup reaches the site with the next knowledge release.
- Site and MCP: the public page tools count only reports after a recheck scope's date, as the coverage score and
  the site's pages already did. `ToolOptions.recheck` carries the curated scopes into every page tool, the object
  pages cut their loot windows, names and pins the same way, relation edges settle their drop, vendor, quest and zone
  facts on the same cut-off, world-map-near drops stale entrance confirmations, and answer_sources stops citing a
  scoped-out NPC name. The site's relation edges read the same scopes as the MCP tool, so both answer with the same
  edges. The facts memo keys on the scopes so a scoped and an unscoped read never share facts. The standalone MCP
  server has no curated file and stays unscoped.
- Site and knowledge base: the settled list leaves out about 2% of settled facts each ISO week (the spot check), so
  the desktop app re-sends them and a hotfix that never changed a build still reaches the corpus. A loot source under
  a recheck scope counts only its windows after the scope's date and settles again, instead of staying out until the
  scope is removed. The cron rewrites the list once per ISO week even when no uploads arrive, so the spot check keeps
  rotating across an idle week; the heartbeat keeps the week it last wrote, and a failed rewrite is retried next run.
- Site: an upload whose R2 PUT rejects on the network logs `R2 put failed` and the error, like a refused PUT,
  rather than the generic `store failed`, so the half behind a 503 is named in the log.
- Site: the snapshot cron stops rewriting the whole corpus when nothing arrived. One query asks whether an
  upload is newer than the snapshot; if not, the snapshot and the completion rollup are skipped, the market fold
  runs only when the UTC day changed, and `/api/health` reads the last successful run from a heartbeat instead
  of the corpus's age. An idle week no longer reads as an outage, and the cron does no work for nothing.
- Site: the item pages and the hover card say the item's set, its restrictions, its class and race
  requirements, the skill it needs and its Use, Equip and Chance-on-hit lines, read from the game files. A
  value the files do not carry reads `[?]` and says which table the game uses and the extract does not: the
  stat amounts and the armour, which the game works out from tables we do not read, and the weapon damage,
  which it works out from its weapon damage tables, the weapon speed and its own rounding. The numbers are
  checked against the game's own tooltip before any range is printed.
- Site: the sitemap is back. It had answered 500 since the wiki landed, because the build traced the wiki's
  pages into the `/wiki` routes only, and the sitemap reads them on every request. The site had no sitemap for
  two days; a build now fails for any route that reads the wiki without carrying it.
- Site: records in `/api/corpus/public` and the bulk `corpus.ndjson` carry a per-install pseudonym (`pub-` and 32
  hex, a keyed hash) in place of the install id, so they pass the protocol's parser again and anyone can count
  installs. The addon's install id still never leaves. Protocol package 1.13.0, description only.
- Site and knowledge base: game objects show the name three installs agree on, on the object page, the objects
  and drops lists, hover cards, search and the item pages that list them as a source, and in the `object_page`
  answer. Until three agree, they still read Object and the id.
- Site: every item, quest, item set and spell the game files or the Warcraft Wiki name is named on its page,
  with no id range and no placeholder filter. A name from the game files alone carries the unconfirmed marker;
  a name from the wiki says so in its tooltip. Items no source names still read "Item N" until players name them.
- Site: the player pages are live. A player page shows what the addon last saw of a character — race, class,
  level, guild and the day — found by the start of the name, and every page carries a hide link and a hide
  form. The search index stays off for now, so the pages are reached by name and are not listed anywhere.

### Added
- Site: the open data export, at `/database/download`. The published data as NDJSON files anyone can download
  and build on, under CC BY-SA 4.0: what three installs agree on, and the game files' own layer, with a
  manifest that says the build, the date the data was current, the method, the row count of every file and
  what each one counts. The local Classic baseline is never in it — it is GPL-derived and stays on the
  maintainer's machine — and a fact fewer than three installs agree on is not in it either. The page says so
  in the same words as the policy.
- Site: `/database/coverage` says how much of the game three players have agreed on, per zone, per type and
  per field, with the confirmed share beside the settled one, and the zones that need players first. A type is
  at its plateau when 90% of its expected facts are confirmed, 75% are settled, and under 0.5% became confirmed
  in the 28 days before the data date; about 2% of the settled facts are left out each week, picked by a hash
  of the fact and the week, so every settled fact is looked at again about once a year and the load stays
  flat. A fact a patch may have changed counts as neither confirmed nor settled.
- Knowledge base: `npm run kb -- coverage-report`, a local report of the facts that are missing, reported,
  contested or spread, by zone and level, with the expected counts written beside it. Local only: the counts
  are uploaded, never the rows.
- Knowledge base: the settled list, one list per client build of the facts three players confirmed and two
  more agreed on, and the uploaders that stop sending what is already settled. The site's copy is served at
  `/api/coverage/settled`. The server-side tally of the extra agreement is behind a switch that stays off
  until the data policy says how it is published.
- Site and MCP server: a `coverage` tool, the same counts as the coverage page as text, per zone and per
  type. The public tool list is 29 tools; the directory submissions carry the older count until they are
  updated.
- Site: a page per dungeon and raid, with the entrance players confirmed, the bosses and their kill counts,
  and the treasure markers on the map, all read from the same readers the zone and object pages use, so a
  marker on the map and a row on a page cannot disagree. The pages are in the sitemap and `/database` links
  the index.
- Knowledge base: `npm run kb -- name-gaps` opens with the counts: how many items, quests, item sets and
  spells carry a name today, and which source each name came from — the game files, the Warcraft Wiki, the
  local baseline, or the players. A source that was not read says so instead of printing a zero.
- Knowledge base: `npm run kb -- name-gaps`, a local report of the items, quests, item sets and spells that
  still print as an id, each with the reason and what would fill it (a rule decision, the addon's uploads, or no
  source yet). Ids only, never names.
- Site: the data layer for linking a character to an account, off by default. A signed-in player gets a code
  (live 15 minutes, good once), and a `character_link` row with that code is sent to `/api/me/characters/links`
  from the site or with an API key that has the new `link:own` scope. The GUID is replaced by a keyed hash, the
  census must agree on race, class and faction, hidden characters are refused, and a character claimed by a second
  account is frozen on both. Nothing is public and there is no page for it yet. Off until the migration is applied
  and `EVERLOOT_CHARACTER_LINKS=1` is set; intake never stores link rows.
- Site: rankings at `/rankings`. Classes, races and faction balance by ISO week, from the census under its
  usual rule, with a weekly chart and each rank's change against the week before. They start with the first
  full week after launch.
- Site: an achievement's page lists its criteria, with how many each needs, once three players sent the same complete list; the list is agreed apart from the entry itself. Lists and search still show no criteria wording. Run the completion rebuild (`?rebuild=1`) once to fill it from uploads already stored.
- Knowledge base: an NPC seen at its window places a pin like a spawn position (three installs on one map);
  a targeting position still never does. Object spawn points are clustered per object and zone, become a pin
  at three installs with a key that stays put once published, and an object's name needs three installs to
  agree. Fishing (the bobber, or an object installs agree is fished) is never a pin. An upload of an event
  that only adds fields to an earlier copy, as when an older Desktop App had dropped them, replaces that copy
  instead of withdrawing the event as a conflict. The map shows none of this yet.

## [0.3.11] - 2026-10-24

Release channel: Alpha

Live-client verification is pending. This is a pre-release for WoW: Forever 1.60.1, not a verified stable build.

### Added
- A Talents / Raid workspace opened with `/everloot` or the minimap. Build on the website, choose
  **Copy for addon**, then paste into the matching tab and choose **Import**.
- Talent progress, next-point guidance and click-through highlights, with one Everloot window at a time.
- Raid plan imports compare class counts by group beside the current roster's buff check. Plans stay local;
  the addon cannot identify players from a plan or verify their talent choices. No points are spent or players moved.
- Copy imported plans or the current raid back to the website. Right-click the minimap button for settings.

### Fixed
- Mail collection stops retain an unresolved money transfer until its event or timeout clears it. An early
  restart asks for another click rather than automatically taking the same pending money again.
- Planner links handle saved builds, second-set-only links and differing game builds; damaged imports keep
  the last valid plan. Workspace preference survives reloads without opening a second guide panel.

## [0.3.10] - 2026-10-23

### Added
- Addon, protocol and site: item numbers players see. When the game shows an item's tooltip, the addon records
  its armor, block, damage per second, stats and resistances for the plain item, with the client build (record
  kind `item_fact`, protocol package 1.15.0, record protocol 1.8.0). The item page, the site's hover card and the
  embeddable card show a number in place of its `[?]` once three installs on the newest build agree, with the
  installs, the build and when it was last seen; a line installs disagree on stays `[?]` and says so. MCP tools
  are unchanged. Not yet run in the Forever client.
- Addon and desktop app: item tooltips show where an item drops. The Desktop App writes the public drop rates
  (three installs looted the source) into the `EverlootPrices` file beside the prices, at most once a day; the
  tooltip and `/everloot price` show up to three sources as drops of loot windows, with installs and the upload
  date. With the file in the game, a missing price or drop source is said in one grey line. Nothing new is
  written to SavedVariables. Design: `docs/design/specs/2026-10-21-addon-value-loop-design.md`.
- Places for the world map. When an NPC's window opens (merchant, gossip, quest, trainer, flight map, bank,
  auction house, stable, innkeeper) the addon records where you stand as that NPC's place, with the service the
  window offered, once per NPC, service and zone. When you loot a herb, ore vein, chest or other object, its loot
  row gets where you stand, how you opened it (from the spell you cast) and the object's name. Trainer rows name
  the trainer. Event names and spell arguments not yet seen on the Forever client are read defensively: a missing
  one records nothing. Launch-day checks: `docs/2026-10-21-addon-0.3.10-launch-checklist.md`.

### Changed
- Targeting or mousing over the same NPC at the same spot (to 1 unit on the map's 0 to 100 scale) records it
  once, not every time. NPC window rows and object loot rows have their own 2,000-row room, apart from
  targeting rows and creature loot, so a full targeting or corpse share pauses only itself.
- An object's name comes only from a herb, ore or chest cast, never from another spell's target (such as a
  player you healed). A fishing cast counts for 30 seconds, for a slow bite.
- The raid buff list (`/everloot raid`) is read from the game files of build 1.60.1.70532.

## [0.3.9] - 2026-10-21

### Added
- A button at the top-left of the minimap, the way every other addon in the game is found. It opens
  Everloot's panel, so nothing needs a command typed any more.
- A box at the top of that panel to ask Everloot a question. The question goes into your file, the
  companion answers it with its sources, and `/reload` prints the answer in the chat, exactly as
  `/ask <question>` does.

## [0.3.8] - 2026-10-21

### Fixed
- The player pages record the players you see again. The module asked the client for a name and a realm
  and skipped anyone whose realm was not empty; the beta client answers every unit with its server, so
  every player was dropped and no page ever had anything on it. It compares the realm with ours now, and
  only a realm that is not ours is another realm.

## [0.3.7] - 2026-10-20

### Added
- An Everloot settings page in the game: Esc > Options > AddOns > Everloot, or `/everloot options`. One switch
  per module and for the auction scan prompt, each saying what it records and where it goes, and a Reload now
  button. A switch with a `/everloot` command runs it, so turning the census, players, completion or addon
  list off deletes their rows exactly as in chat. Clients without the options API get it as a window.

## [0.3.6] - 2026-10-20

### Added
- An Everloot tab at the auction house, after Blizzard's tabs. It has a Scan this house button with the
  cooldown, says whether the last scan is in your saved file yet, has a Share now button (a `/reload`, so
  the Desktop App can send the scan) and looks up an item's price with the tooltip's lines. Shift-click an
  item into its box. It never posts, bids or buys, and a scan still starts only from your click.

### Changed
- Auction scans are on in a new addon install, which says once at the first auction house what a scan
  reads. An install where scans were turned off keeps them off.

## [0.3.5] - 2026-10-20

### Changed
- The census starts on in a new addon install and says so once in chat; an install from before keeps it
  off until `/everloot census on`. The Desktop App sends census rows with its uploads when the player leaves
  the census box ticked on its setup screen, or turns it on in Settings; a setup finished before this keeps
  it off. Still never names, guilds, gear or places, and the site shows only totals.

## [desktop-v0.1.7] - 2026-10-24

### Added
- A Stop button ends the current chat request and any tool calls still to come. The question and text already
  received stay in the transcript, marked "Stopped", and a screen reader hears "Stopped".
- Chat shares the site's provider and model catalogue, reads model lists from the configured provider, and
  falls back to the catalogue when that provider cannot be reached.
- The prices file includes public drop rates beside market prices, refreshed at most once a day. With that
  file in the game, addon tooltips can show up to three sources under the usual three-install agreement rule.

### Changed
- The app keeps the settled-facts list beside its sent log, refreshes it once a day, skips rows that are already
  settled, and reports how many it skipped.

### Fixed
- A screen reader hears "Copied" or "Copy failed" after Copy. The button keeps its feedback for the full second
  and a half even when the thread redraws. Clear is disabled while an answer is being written.

### Security
- Update Electron to 44.9.1, including its compromised-certificate mitigation.
- Update the locked body-parser and fast-uri dependencies to their patched releases.

## [desktop-v0.1.6] - 2026-10-21

### Added
- The player pages can go with the uploads, on a switch in Settings: "Send the player pages with the
  uploads". It is off by default, so nothing changes until it is turned on, and the rows stay in
  `Everloot.lua` until then — the same rule the named data follows. The privacy policy and the data
  policy say so, in the words the switch uses.

## [desktop-v0.1.5] - 2026-10-20

### Added
- Sign in with everloot.app. The setup screen and Settings open everloot.app's new
  `/desktop/connect` page in the browser; after Battle.net sign-in and Connect, the app has its own key named
  "Everloot Desktop App". The key travels back to `127.0.0.1` sealed to a one-time key only that app holds
  (ECDH P-256, AES-GCM), so it is never in a URL in the clear, and the app never sees a password. Pasting a key
  still works. The setup screen also asks to agree to the Terms of Use and Privacy Policy before Start.

## [desktop-v0.1.4] - 2026-10-20

### Added
- Census switch. The setup screen has a census box, ticked by default, and Settings has a Census switch. With
  it on, census rows (race, class, level and faction, never names) go out with the uploads after logout; with
  it off they wait for the upload page. A setup finished before this keeps it off.
- Saved talent builds reach the game. With an account key that has the "Read my saved builds" permission, the
  app writes your builds from everloot.app into the `EverlootBuilds` slot addon after sign-in, on Sync builds
  and every 15 minutes. The key goes only to the site it was signed in on, and uploads never carry it.

### Fixed
- The account panel links to the keys page (`/docs/api/keys`) instead of the old `/connect` page.
- The builds sync stays quiet when a key is refused, and sends the key only to the site it was signed in on.

## [desktop-v0.1.3] - 2026-10-20

### Fixed
- Browse for the game folder now lands on the product folder. Picking `World of Warcraft` itself chose the
  folder one level above the one that holds `WTF`, so the app found no account files; it now takes the product
  folder with Everloot data (`_classic_era_`, `_anniversary_` and the rest). Picking `WTF` or `Interface`
  steps back up to the product folder too.

## [desktop-v0.1.2] - 2026-10-20

### Fixed
- A nightly addon build (such as 0.3.4-nightly) counts as newer than the release before it. The Addon page and
  the Overview used to offer the older release as an update, and the app sent a "newer addon" notice, so one
  click put back a build without the nightly's features. The page now says the nightly is newer than the latest
  release; putting the release back is the small repair link.

## [desktop-v0.1.1] - 2026-10-20

Everloot Desktop App 0.1.1. From this version, Windows installs download the next update inside the app and
install it on restart. Updating from 0.1.0 is one manual download.

### Added
- An account row at the top of the sidebar footer. Signing in means pasting a free key made on
  everloot.app after Battle.net sign-in; the app checks it with the site and keeps it in a file in the data
  folder. Chat and the in-game `/ask` send it to the site's public MCP server, so their requests count against
  the account instead of the internet address. Uploads and price refreshes never carry it. `/ask` no longer
  needs a private token file: without one it answers from the public server, like Chat.
- On a Windows install, the update downloads inside the app, is checked against the release's
  SHA256SUMS, and installs on restart: a Restart to update button appears in the footer and asks first, waits
  for a running upload, then runs the installer silently and opens the app again. A bug button beside Settings
  opens GitHub's bug form with the app version and its diagnostics filled in (user folder hidden, never the
  token), or copies them. The Addon page says Up to date instead of offering Reinstall as the main button;
  reinstalling is a small repair link.
- Chat answers appear as the model writes them, with the tool it is running shown while
  it looks something up (Anthropic and OpenAI-compatible providers; a server that does not stream
  still answers in one piece). Each answer has a Copy button.
- A model menu under the Chat box, as in other chat apps. It lists the models of every
  provider saved on the page (one key each for Anthropic, OpenRouter, OpenCode Zen, a custom server, plus
  Ollama), and picking one switches Chat and the in-game `/ask`. Keys can be added, replaced or removed one
  provider at a time. When search alone finds nothing, the answer says a model would read the question and
  offers to add one.
- Settings is pinned at the bottom of the sidebar and holds everything the app can be set to: what
  runs (upload, market prices, in-game `/ask`), the AI model keys, the game folder, startup and the app itself.
  The site's tools are no longer shown inside the window; the sidebar links to the database, talent calculator,
  raid builder and auction prices on everloot.app, which open in the browser. The world map and lore archive
  links are gone; Chat answers those questions.
- The Market page looks up an item's price in the prices file the game reads: paste an item link from game
  chat or type its id, and it shows each realm's community value, minimum, historical price and units up, with
  a link to the item's history on everloot.app.
- When a newer release is out, an arrow button sits beside Settings. It opens a panel with the
  new version, its release date, what the release lists as changed (the first eight, then a link to the rest
  on GitHub) and a Download button for this system's installer. Escape or Later closes it.

### Fixed
- An `Everloot.lua` written after the app started (the first logout, a second account) is
  found within 30 seconds and uploaded; before, the app kept saying there was no file until it was
  restarted. Resuming after Pause catches up on a logout that was skipped. A failed upload or `/ask`
  run is tried again after 1, 5 and 15 minutes. On Linux and macOS the file watch is armed again after
  the game replaces the file at logout, so later logouts are not missed.
- Pages keep an open drawer, the focus and what you are typing when the app refreshes them. The Characters
  week bars draw again (the page's security rules had blocked their heights), and a setting the app could not
  save shows why and switches back.
- Network calls time out instead of hanging, backups skip account files that did not change, and the app
  no longer holds up a Windows sign-out.

## [desktop-v0.1.0] - 2026-10-19

The first Everloot Desktop App release. Tagged `desktop-v0.1.0`; the desktop app has its own
version line, separate from the addon. Builds are not code-signed yet.

### Added
- **Everloot Desktop App** (`desktop/`): the companion as a tray app with a sidebar window. First run
  shows what leaves the computer and finds the game folder; then it uploads after every logout,
  refreshes market prices after each upload and hourly, and answers `/ask` when turned on. Pages
  for each thing to manage: what each account file holds, realm picks for the prices file (your
  scans plus the realms you follow), the `/ask` setup and recent answers, addon install and update
  checked against the release's `SHA256SUMS`, the change tracker, the log, a chat over Everloot's
  MCP tools with sources (a tool loop on the player's own key: Anthropic, OpenRouter, OpenCode Zen's
  zero-retention free models, a local Ollama or any OpenAI-compatible server, picked on the page and
  shared with the in-game `/ask`; plain sourced search without one; three local tools let the model
  read the player's own characters, scan ages and the app's own job status, sourced as this
  computer; starter questions on an empty thread and an "ask why" link from a failed job), a
  local characters view (gold history, gear, progress), and the site's tools embedded. A dated
  backup of each account file after every upload, with restore; a tray reminder when a realm's
  scan is older than a day; the window remembers its place. Electron, built on
  `companion/src`, same data folder as the command line. Tagged `desktop-vX.Y.Z`; the first
  release is not code-signed.

## [0.3.4] - 2026-10-20

### Added
- Site: the player pages' disclosure text: the privacy policy, the terms, the data policy, the methodology page and the addon page now say what the player pages collect, that the pages are unverified information reported by other players, how long a row is kept, and how a character is hidden. It goes live with the switch, not before.
- Site: an item's page shows its Source (Drop, Vendor, Crafted, Quest, Object) in the quick facts, each linking to its tab, from the same 3-install index as the item lists. Items nobody has reported show no row.
- Site: database pages for achievements, factions, titles and quest chains (`/database/achievements`,
  `/database/factions`, `/database/titles`, `/database/quest-chains`), with lists you can filter and sort, a page for each entry, and entries in the hub, sitemap and search. An entry
  shows only once three players report it the same way; until then each list says so.
- Addon, protocol and database: NPC lists gain Type and Rank columns and filters (creature type and rank as the game shows them on target), and quest lists gain Category, Side and Group columns, with Category and Side filters. The addon now records a quest when you accept it: title, level, the quest log header, suggested group size and tag, the giver, and your faction (Alliance or Horde, no character name). Every value is public only after 3 installs agree; a side needs 3 installs on that faction and none on the other. Older addons keep working. Needs an addon release to start collecting; the quest-log calls have not been tried in the Forever client yet.
- Player pages, off by default: search a WoW: Forever character by name and open a page with its race, class, level, guild and the day it was last seen, with a hide link on every page that needs no account. Nothing is collected or shown until `EVERLOOT_PLAYER_PAGES=1` is set on the site and a player turns on `/everloot players on` in an addon release that includes it; the design and the open legal questions are in `docs/design/specs/2026-10-20-player-pages-design.md`.
- Site: a game version label in the header ("Beta · 1.60.1") with a menu of Live (at launch), PTR (none running) and Beta, read from one list in `web/src/lib/game-version.ts`; a test checks every game-data layer names the current build. The build is also named on `/methodology`.
- Site: `/docs`, one documentation area for players and developers: Overview, Guides, API Reference, MCP and
  Cookbook tabs, a grouped sidebar, "On this page", "Copy page" as Markdown, and a page per API endpoint and
  per MCP tool generated from the protocol, with cURL, JavaScript and Python examples. "Docs" replaces "Open data"
  in the header, and docs pages are in search, the sitemap and `llms.txt`. `/connect` now redirects to `/docs`, and its old
  `#anchors` land on the matching docs page.
- Addon: gold per hour. `/everloot gph start` opens a small window and counts your own looted items, looted
  money, quest money and vendor sales while the session runs (pause, resume, stop, reset; a reload pauses the
  clock). Items are valued from the Everloot market value, else your own last scan, else the vendor price,
  each marked with its source, with the 5% auction cut on market and scan values unless you turn it off. The
  last 50 sessions stay in your SavedVariables file for the Desktop App; they are never uploaded.
- Addon: each auction scan records your faction and which house it read (Alliance, Horde, or Neutral for a
  goblin house). At the auction house, when a scan can run, a "Scan prices for Everloot" prompt starts one
  with a click, once per visit; `/everloot scanprompt off` hides it. With scans off, the first visit
  prints how to opt in.
- Market: scans that name their house also build that house's own market values, next to the realm-wide
  ones. `GET /api/market/prices?realm=<realm>&house=horde` serves them, and the realm list says which houses
  have values. Older scans and readers keep the realm-wide view.
- Accounts: `/sign-in`, `/sign-up` and `/reset-password` pages, and an `/account` page with your profile,
  sign-in methods and API keys. Under `EVERLOOT_AUTH_V2`, with `RESEND_API_KEY` and `EMAIL_FROM` set,
  anyone can make an account with an email and password; the email has to be confirmed before the first
  sign-in. Without them Battle.net stays the only sign-in. The header's Sign in now opens `/sign-in`.
- Site: embeddable tooltips. Any site can load `https://everloot.app/tooltips.js` so links to Everloot item, NPC, quest and object pages show a hover card (keyboard, touch, no cookies, no tracking), fed by the cached `GET /api/tooltip/<type>/<id>`; see `/connect#tooltips`.
- Site: the world map is now a Leaflet map that fills the screen: click a zone to zoom to it, search for a zone or NPC, flight masters and flight paths from the game files, coordinates on hover with a copyable `/way` line, a bottom card for a tapped pin, and an address that keeps your view; `/map?zone=<id>` opens that zone.
- One search on everloot.app: the header box and `/search` find items, NPCs, quests, zones, lore pages and
  tools by name or id, grouped by type with an exact id or name first. Drop, reward, giver and vendor lists
  show names and icons instead of "Item 1234", NPC, item and quest pages show a Lore section when the lore
  archive has a page of the same name, and those lore pages link back to the database.
- Addon: `/everloot price <item>` prints an item's price in chat, anywhere in the world: a shift-clicked
  link, an item id, or the name of an item the client has seen. It shows the same lines as the tooltip (community
  market value, minimum, historical, units up, reporters, how fresh the file is, and your own last scan) and
  links the full history on everloot.app. Nothing is fetched in game; the prices come from the file the
  Desktop App or companion writes.
- Battle.net sign-in can run on Better Auth behind `EVERLOOT_AUTH_V2`. Existing accounts and API keys
  carry over. No provider tokens, IP addresses or user agents are stored. With the flag off, sign-in
  behaves as before.
- Census in the addon, off until `/everloot census on`. It records the race, class, level and faction of
  your own characters and of players you target, mouse over or group with: one row per character per UTC
  day, at most 2,000 rows of each kind. It never reads another player's name, guild, gear or position.
  `/everloot census off` deletes every census row. The rows go only from the upload page, which counts
  them first; the companion keeps them. `/everloot selftest` prints your race token.
- Census intake: two kinds, `census_self` (your own characters) and `census_seen` (players you target, mouse
  over or group with), holding race, class, level and faction, plus the realm name for your own characters.
  The site replaces each character's GUID with a keyed hash (`EVERLOOT_CHARACTER_KEY`) and keeps only the
  server id from it before anything is stored, and rewrites the event id so nothing from the GUID survives.
  Without the key, census rows are dropped and the rest of the upload is kept. Census rows are kept out of
  the public corpus; only counts will be shown, from 10 characters and 3 installs. The data policy and
  `/privacy` say so. The upload page may send a character's row for the day again with a higher level;
  `mergeCensusRows` (`kb/src/census-rows.ts`) keeps the copy with the latest time, then the higher level,
  and never treats a repeat as a conflict. One install counts at most 500 players seen and 50 own characters
  per UTC day across all of its uploads, at intake and in that fold. Rows dated more than a day ahead or 30 days
  back of the server clock are refused, each row keeps the keyed address hash of its sender (never the address)
  so a count can ask for distinct addresses as well as installs, the key must be 32 characters or more, and
  `uploadStore.loadCensus()` reads the stored keyed rows back for the summary. The addon module and the `/census` page come in later steps.
- Site: zone pages at `/database/zones`, one for every released zone, with its map, the dungeons and raids
  entered there, and the NPCs, vendors and quests players have confirmed in it. Zone links in the database
  now open the zone page instead of the map.
- Site: the item lists have a Source column and a `src` filter (Drop, Vendor, Crafted, Quest reward, Container or object),
  from what players reported: drops, vendor offers, recipes and quest rewards, each once 3 installs agree.

### Changed
- The upload record contract moved from `web/src/lib/intake.ts` into one package, `packages/protocol`
  (`@everloot/protocol`), that the site, the knowledge base and the companion install. Uploads now carry
  `protocol`, the contract version; the server accepts the current major and the previous one. The
  addon's contract tests validate the rows it writes against the package's JSON Schema files. The
  addon's Lua comments still name the old file; they change with the next addon release.
- The package also holds the licence and credit line, the JSON API's response shapes with a route
  catalogue, and the MCP server's tool table (22 tools). The server registers its tools from that table,
  the connect page and `llms.txt` list from it, and each API route's test parses a real response with the
  protocol's schema, so none of the three can drift from the others.
- `/connect` gained a reference of every MCP tool with its arguments and of every JSON endpoint with its
  parameters and responses, rendered from the protocol, plus paging examples in JavaScript and Python. The
  site serves `/api/openapi.json` (OpenAPI 3.1, assembled from the same catalogue) and the protocol's JSON
  Schema files under `/schema/`. `llms.txt` lists both.
- A 23rd MCP tool, `answer_sources`: the evidence behind a question, observed facts first (with install
  counts), then curated facts and the 2023 wiki, every piece with its source URL, licence and date, plus
  search links on other sites (links only). Structured output from the start.
- Two talent tools on the MCP server, answered from the same catalogs and rules as the calculator:
  `talent_tree` (one class's trees from the game files, every node with its talents, ranks, position,
  prerequisites and row gate, with the build) and `talent_plan` (a share code or calculator link read
  against the trees: talents, points per tree, the lowest level, and every problem in plain words).
  The knowledge base now typechecks with bundler resolution so it can import the site's talent modules.
- Structured output for `item_categories`, `ecosystem_projects` and `everloot_plan`, the three tools that
  read no uploads: the same cases as the text (a tree, one item's path, a filtered list with its total;
  a board's ranked rows with GitHub facts flattened, or not connected; every tracker row with its proof).
- Structured output for the five page tools (`item_page`, `npc_page`, `quest_page`, `vendor_page`,
  `object_page`): the same page object the text is written from, under one envelope for answers built on
  uploads (`connected`, `dataAsOf`, `reason`). With no corpus read the page is absent, not empty.
- Structured output for `auction_history`, `collection_gap` and `guild_board`, the same result objects
  their text is written from, under the same envelope.
- Structured output for `profession_path`, `recipe_thresholds`, `entity_relations`, `completion_progress`
  and `market_value`: the path, the ranges with each cost as numbers, the edges the text lists, one
  install's progress, and the market value with its history, under the same envelope.
- Structured output for `gold_ledger` (one ledger per install, never merged, unrecorded as null) and
  `world_map_near` (entrances and pins with distances, or the refused query with its reason). Both
  formatters now write their text from a result object, so every one of the 25 tools answers with
  structured content beside its text.
- Every MCP tool answers a plain `GET /api/tools/{tool}` too, for developers without an MCP client: the
  tool's arguments as query parameters, read with the tool's own schema after the text-to-number coercion a
  URL needs; the answer is the same structured content and the same text an MCP client gets, from the same
  handlers, release and store. A wrong argument is a 400 that names it, an unknown tool a 404 that lists
  them. In the route catalogue, OpenAPI, the `/connect` reference and `llms.txt`.
- The bulk export: `npm run export-bulk` in `web/` writes the published data as files, one NDJSON
  file per dataset (public corpus, drop rates and measured zeros, relations, items) and an `index.json`
  (`bulkIndex` in the protocol) listing each file's rows, bytes, SHA-256, data class and the API response
  whose rows it holds. Rows come through the API's own loaders, so a file can never hold a row the API
  would not. `scripts/upload-bulk.mjs` uploads a folder create-only, index last, and points `latest.json`
  at it. `/connect` and `llms.txt` link the export once `NEXT_PUBLIC_BULK_URL` is set (docs/RELEASING.md).
- The MCP server's implementation info carries a title, a one-line description and the site's icon (64 and
  512 px), so clients that draw a server list show Everloot by name and picture. `/connect` shows a curl
  call of `/api/tools/get_by_name` beside the MCP one.
- `/census` and the MCP tool `population`: who plays what, from the census rows of players who turn it on.
  Each character counts once (the latest report per character key, across both kinds and every install), in
  two windows (the last 7 days and since launch) with a daily trend. A count shows only at 10 characters
  reported by 3 installs, and every count is rounded to the nearest 5 so a hidden one can't be recovered by
  subtraction. Until a window gets there it says it is still collecting, which is the state at launch.
  `/methodology` states the rules. Reads `census_self` and `census_seen` once intake accepts them.
- `/api/items/categories` joins the protocol's route catalogue with its response shape, so it appears in
  `/api/openapi.json`, the endpoint reference on `/connect` and `/schema/api/itemCategoriesResponse.json`,
  and its route test parses a real body with the shape. The endpoint itself is unchanged.
- Completions on the MCP server (`completion/complete`): a client typing the `what_changed` prompt's game
  or the class in `everloot://talents/{class}` is offered the values the protocol knows, by prefix. The
  nine class resources are now listed under `resources/list` beside the three static ones, so a client
  that browses resources finds every class's trees without knowing the slugs.
- `search` and `fetch` on the MCP server, the two tools ChatGPT's connectors, deep research and company
  knowledge call by name, after OpenAI's contract: results with an id, a title and a URL to cite, then one
  record whole with its source, licence and date as metadata. A lore page's URL is its page on the site;
  any other record points at its source. Both answer as structured content with the same JSON as text.
- Resource templates on the MCP server: `everloot://item/{id}`, `npc`, `quest`, `vendor`, `object` and
  `talents/{class}` read as the same JSON the matching tool returns as structured content, so a client that
  prefers resources to tool calls gets the same page. A variable the tool refuses is an error in words.
- The MCP server's first prompts, commands a client offers and fills: `answer_with_sources` (a question,
  answered from `answer_sources` with a source on every piece), `review_talent_plan` (a share code, read
  with `talent_plan` and `talent_tree`) and `what_changed` (`recent_changes`, newest first, excerpts
  only). Listed on `/connect`, in `llms.txt` and in `/schema/mcp/prompts.json`.
- The tool reference on `/connect` shows each tool's answer: the top-level fields of its structured
  content with types and meanings, from the same schema the server validates against.
- The protocol's publish path: `protocol-publish.yml` publishes `@everloot/protocol` to npm with
  provenance on a `protocol-v<version>` tag, after checking the tag, `package.json` and the changelog
  agree; and `scripts/check-semver.ts` holds every pull request to the package's semver rule by comparing
  the committed `schema/` with the latest published tarball (it passes with a notice until the first
  publish). The steps are in `docs/RELEASING.md`, "Protocol".
- The MCP server's first resources, documents an assistant reads whole: `everloot://builds` (the build the
  game-file facts come from and the build registry, JSON), `everloot://methodology` (how uploads become
  facts) and `everloot://data-policy` (the policy in short, with the link to the full one). The two texts
  are held to the methodology page and `docs/DATA_POLICY.md` by tests. Listed on `/connect`, in `llms.txt`
  and in `/schema/mcp/resources.json`.
- Four MCP tools (`search_knowledge`, `get_entity`, `get_by_name`, `recent_changes`) declare an output schema
  and answer with structured content beside the text, so a client can read hits and timeline entries as
  objects instead of parsing prose. The schema files and `/connect` show which tools do.
- `scripts/upload-bulk.mjs` refuses a folder whose `index.json` or any data file carries what looks like a
  machine's own filesystem path (a Windows drive path, `/Users/`, `/home/` or `AppData`) before anything is
  sent, like the sha256 check, so a bug in the export cannot publish a local path alongside the data.
- The header menu brightens to the site's green on hover instead of the body text colour.

### Fixed
- Addon: `/everloot selftest` printed the failure text on two passing lines ("PASS C_Traits exists: no C_Traits
  table: talents cannot be read"). Both now say "present".

## [0.3.3] - 2026-10-18

### Added
- A **completion tracker** module for achievements, reputation, titles and quest chains. It is off until
  `/everloot completion on` (`/everloot completion` reads now, `/everloot completion off` deletes every
  row it wrote). It reads with the calls Forever's own windows use (the achievement globals the Legacy
  Challenges window calls, `C_Reputation`, the title functions, `C_QuestLog.GetAllCompletedQuestIDs`,
  `C_QuestLine`), in chunks across frames, waits out combat and never acts: no tracking, no expanding
  headers, no window changes. A missing call records nothing for that part and `/everloot status` names it.
- Eight intake kinds. Catalog rows (`achievement_catalog`, `reputation_catalog`, `title_catalog`,
  `quest_chain_catalog`) are game facts with no player data, listed on the site after 3 reporters (distinct
  upload addresses) report the same entry. Owned rows (`achievement_owned`, `reputation_owned`, `title_owned`, `quest_owned`) are one
  character's progress under an opaque key, not the name. They are named data in the collection sharing
  category, like `collection_owned`. A changed achievement or standing replaces its earlier row, so the
  file does not grow with each point of reputation, and the module's rows have hard caps reported in
  `/everloot status`. None of the eight kinds is in the public corpus: the site folds them into a separate
  completion rollup, so pages that do not show completion never read them.
- `/tools/collections` shows, per character, what is done and what is closest to done (achievements with
  the most criteria met, reputations nearest the next standing, quest chains with the fewest quests left),
  with an empty state that says when the data is unrecorded rather than zero.
- MCP tool `completion_progress`, read-only, taking an install id and an optional character key.
- [`docs/2026-10-19-addon-0.3.3-beta-checklist.md`](docs/2026-10-19-addon-0.3.3-beta-checklist.md): the
  calls confirmed in the build's own files, and the in-client check to run.

Forever opens achievements as Legacy Challenges, so the catalog is the list the game gives those calls.
The module has passed the automated tests against a mock of the documented calls; it has not run in the
Forever client.

## [0.3.2] - 2026-10-17

### Fixed
- Recipes now read from Forever's own profession window (`C_TradeSkillUI`). The old trade-skill and
  craft calls the addon used are not in the client's API documentation for build 1.60.1.70450, so no
  `recipe_observed` rows could be written. Each row keeps its shape: profession, rank, recipe, colour,
  product item and reagents. The product and reagents come from the recipe schematic; a reagent slot
  that accepts several items is written without reagents instead of a guess. The read is chunked across
  frames and debounced.
- Trainer rows read the trainer window's values in the order Forever returns them. The old addon read
  the texture as a category, and now also skips the window's "next profession step" row.
- Auction buyouts and commodity purchases are read with `C_AuctionHouse` (the item bid at its buyout,
  and the total the house quoted for a commodity), watched from the player's own click and never called.
  The old `GetAuctionItemInfo` and `PlaceAuctionBid` path stays for older clients.
- A pending buyout is dropped after 5 seconds, on `AUCTION_HOUSE_SHOW_ERROR`, on
  `COMMODITY_PURCHASE_FAILED` and on `COMMODITY_PRICE_UNAVAILABLE`, so a rejected bid cannot later
  label a same-sized money change (a repair) as a purchase. Ranks above 500 are not written.
- `/everloot status` names any call this client lacks and says the module records nothing, and reports
  what the last profession window held.

### Added
- [`docs/2026-10-18-addon-0.3.2-beta-checklist.md`](docs/2026-10-18-addon-0.3.2-beta-checklist.md): the
  calls confirmed in the build's own files, and the in-client check to run.

The profession and purchase paths have passed the automated tests against a mock of the documented API;
they have not run in the Forever client. This release also contains everything in 0.3.1.

## [0.3.1] - 2026-10-17

### Fixed
- The TOC declared interface 70058, an old build number, so the client listed the addon as out of
  date. It now declares 16001, derived from build 1.60.1. The companion's `EverlootAnswers` addon
  declares the same number.

## [0.3.0] - 2026-10-17

### Added
- An **Everloot scan** button on the auction house, or `/everloot scan`, reads the full auction
  listing with `C_AuctionHouse.ReplicateItems()`. It runs only when you click, with the auction house
  open, at most once every 15 minutes, and never buys, bids or posts. The result is summarised per
  item and stored as `auction_snapshot` records. The last three scans per realm are kept.
- Item tooltips show your own latest scan and the community prices the companion wrote. The tooltip
  shows the date the prices were fetched and marks them stale after two days.
- The companion's `prices --game` (and `watch --game`) writes the checksummed `EverlootPrices` addon
  the tooltips read, after the next `/reload`.
- `auction_snapshot` records are accepted by the upload intake. They stay out of the public corpus.

### Fixed
- A scan that gets no answer from the game within 30 seconds clears itself and gives the cooldown
  back. Closing the auction house while waiting does the same.

This release also contains everything in 0.2.8. It has passed the automated tests; the in-client
checks are still open.

## [0.2.8] - 2026-10-17

### Added
- `/everloot raid` lists the raid buffs missing in each group of your current group. It is display
  only and records nothing.
- `/everloot raid code` prints a link that opens your raid in the site's raid builder.

### Changed
- The raid builder's buff rules come from a committed file generated from our own game-file
  extract for the current beta build, instead of a hand-written table.

This release also contains everything in 0.2.7.

## [0.2.7] - 2026-10-17

### Added
- Talents module: reads your build through `C_Traits` and `C_ClassTalents` for the active spec
  group, and the second one once dual spec is unlocked. A row is saved only when the build changes.
  Talent rows are not in the public corpus.
- `/everloot selftest` checks each talent API and whether the loadout export and import functions
  exist, and writes the result to chat and the saved variables file.
- `/everloot plan <share code>` shows the next point to spend and where your build differs from a
  plan made in the site's talent calculator. It never spends a point, clicks or imports a loadout.

## [0.2.6] - 2026-10-16

### Added
- An opt-in list of your installed addons (`/everloot addons on`). It leaves the addon only from the
  upload page, after the preview. `/everloot addons off` stops it and deletes the recorded rows.
- The bounds of each zone you enter, recorded as a position, for the world map.
- The game client build is stored with every upload.

## [0.2.5] - 2026-10-10

### Added
- Trainer rows: the required skill rank and cost of each recipe a trainer offers
  (`trainer_seen`), read when the trainer window opens.

## [0.2.4] - 2026-10-10

### Added
- Auction sales taken from the mailbox are recorded in the gold ledger, net of the auction house's
  cut. The buyer's name is never read.
- Buyouts you pay are recorded as auction purchases. Plain bids are not, since they can be refunded.
- Postage for letters the server confirmed sent. The recipient and text are not read.

## [0.2.3] - 2026-10-10

### Added
- Recipe colour observations: one row per profession, recipe, skill rank and colour as the
  profession window shows them (`recipe_observed`). The site infers difficulty ranges from them once
  three installs agree.

## [0.2.2] - 2026-10-09

### Added
- `/ask <question>` stores your question. The companion answers it and the answer shows in chat
  after `/reload`, with its source, once its checksum verifies.
- Quest rewards, vendor sales and flight costs in the gold ledger.
- `/everloot auctions on|off` to switch auction capture in game (it applies after `/reload`).

### Fixed
- Auction rows stored a whole stack's buyout as one item's price. Rows now carry the stack count
  and a per-unit price, and bid-only listings are skipped instead of being saved as free.

## [0.2.1] - 2026-10-08

### Fixed
- Collection repairs in the open-world and guild modules. This is the first addon zip built by
  `scripts/package-addon.py`.

## [Site and knowledge base milestones]

Dated by the pull request or commit that landed them.

### 2026-10-17
- Forever market (#15): scans players start are folded into daily prices. A day is published once
  three reporters agree, and a thin or outlying day is labelled or trimmed instead of averaged in.
  `/tools/auctions` shows a realm table and an item view with a 60-day chart, `/api/market/prices`
  serves the prices without install ids, and the `market_value` MCP tool brings the server to 16 tools.
- Build watch (#34): a scheduled workflow notices a new WoW: Forever build within about half an hour,
  regenerates the talent, raid and map data with the site's own generators, and opens a reviewed pull
  request titled `data(game-data): build <version>` with a list of what changed. Nothing merges itself.
  See `docs/BUILD_WATCH.md`.
- Talent calculator at `/tools/talents` (#27), reading our own catalog extracted from the game
  files (#30).
- Raid group builder at `/tools/raid` (#32).
- World map at `/map`, drawn from zone and entrance positions in the game files (#28).
- Blizzard change tracker at `/changes` with an RSS feed, and the `recent_changes` MCP tool (#37).
- Addon leaderboard at `/addons/popular` (#22) and addon profile pages at `/addons/<name>` (#26).
  Counts, titles and dates appear only when three installs report them.
- `/connect`: how to use the open data from an AI assistant or your own code (#31).
- Opt-in analytics with consent categories (#33).
- Data policy extended to game-file data: talents, the raid buff table and the map (#14, #29, #30).
- CI rejects AI tool credits in commits and pull request descriptions (#38).
- Lore pages are cached instead of running a function per view (#35).

### 2026-10-16
- Open-sourced under AGPL-3.0-only, with the data under CC BY-SA 4.0: contributing guide, code of
  conduct, security policy, issue forms, DCO sign-off check, secret and private-path guards,
  third-party notices, a provenance ledger of every source, and the data and no-spoiler policy.
- New visual identity: colour tokens for light and dark, Geist, outline pill buttons, bracket
  navigation.
- Addons hub and Polestar pages.
- Public corpus no longer carries install ids.
- Client table snapshots and field-level diffs in the knowledge base tooling (#16), and a build
  registry from Blizzard's public version service (#13).

### 2026-10-15
- Lore archive: `/lore` pages, `/search`, browsing by type, letter and facet, a coverage page, and
  sitemaps, built from the Warcraft Wiki dump (CC BY-SA 4.0).

### 2026-10-10
- Public read-only MCP endpoint at `everloot.app/mcp` for AI assistants, rate limited.
- Recipe difficulty ranges (`recipe_thresholds` tool and profession page section), and profession
  paths that price reagents from per-unit auction scans.
- Generated social preview card.

### 2026-10-07 to 2026-10-09
- Replay-safe, resumable uploads with event identity and de-duplication.
- Guild authority, claim tokens, quotas and opt-out.
- Battle.net sign-in.
- Public MCP HTTP server with authentication, rate limiting and CORS.
- Public rollups that state a fact only when three installs agree, with opt-out and suppression.
- Pages show the age of the data.

### 2026-09-29 to 2026-10-04
- everloot.app live (2026-10-03). Upload page and intake contract, drop-rate rollups, database
  pages for items, NPCs, quests and vendors, profession and farming route pages, guild pages.
- Uploads stored in object storage with a Supabase index; pages read one corpus snapshot, extended
  every ten minutes.
- First MCP knowledge server over stdio (3 tools). The server now has 16.
- Knowledge base (`kb/`): lore import from the Warcraft Wiki dump, provenance on every row,
  publishable-only snapshots with a licence manifest.
