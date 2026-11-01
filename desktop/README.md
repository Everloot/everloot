# desktop/: Everloot Desktop App

The command-line uploader as an app. It sits in the system tray beside the game and does what the
[command-line uploader](../companion/README.md) does, without a terminal: after every logout or `/reload`
it uploads the addon's anonymous observations, keeps community market prices in your item tooltips,
and, if you turn it on, answers `/ask` questions. Design:
[`docs/design/specs/2026-10-18-desktop-app-design.md`](../docs/design/specs/2026-10-18-desktop-app-design.md).

![The Overview page of Everloot Desktop App](../docs/media/desktop.webp)

It follows the same rules ([`docs/DATA_POLICY.md`](../docs/DATA_POLICY.md)). It sends anonymous
open-world events, and census rows if you allowed the census on its setup screen (the box starts ticked)
or later in Settings; the command-line uploader never sends census rows. The automatic uploader keeps guild, gear, gold, collection and installed-addon rows on your computer.
Player sightings are sent only if you enable player pages in Settings. Chat is separate: a configured
model provider receives your questions, conversation history and any local character details the model
uses to answer, including names, gold, gear and progress.
Nothing touches the game client. The window never shows an ad.

## Install

Downloads are on [everloot.app/addon](https://everloot.app/addon) and the
[releases page](https://github.com/Everloot/everloot/releases) under `desktop-v*`: a Windows installer
and a portable exe, a macOS disk image, a Linux AppImage. The builds are not code-signed yet, so
Windows shows a SmartScreen notice (More info, Run anyway). On macOS, open System Settings, Privacy &
Security and choose Open Anyway (on macOS 14 and earlier, right-click the app and choose Open). The `SHA256SUMS` file on each release lets you check
a download.

On first run the app shows what leaves your computer, finds your World of Warcraft folder (or you
browse to the folder of your game version that holds `WTF`, under `World of Warcraft`), and
runs nothing until you press **Start**. If that folder has no Everloot addon yet, it says so and offers
**Install the addon**, the same checksum-checked install as the Addon page. WoW: Forever's `_forever_`
folder is offered first. If the app reads another client's folder beside it (the closed beta, a classic
realm), Overview and Settings offer **Use Forever** in one click, or **Keep this folder**; the app never
switches on its own.

## What it does

| Job | What | When |
|---|---|---|
| Upload | Sends events the site has not confirmed, from every account's `Everloot.lua` under the game folder | After the game writes the file (logout or `/reload`), once the write settles |
| Market prices | Writes the `EverlootPrices` slot addon for the realms you scanned plus the realms you follow, and beside them the public drop rates (three installs looted the source) from `/api/rollups/drops`, which the addon shows in item tooltips. Nothing is sent but the GET | After each upload and every hour; drop rates at most once a day, the last good set kept when a fetch fails |
| `/ask` | Answers pending `/ask` questions into the `EverlootAnswers` slot addon | After the game writes the file; the public search needs no token file or key (an MCP URL and token file are an optional private-server setup under Advanced on the Ask page) |
| Saved builds | Reads the talent builds you saved on everloot.app with your account key (it needs the "Read my saved builds" permission) and writes them into the `EverlootBuilds` slot addon, where `/everloot plan` lists them after a `/reload`. Nothing goes back to the site | After you sign in, on **Sync builds** (Addon page), and every 15 minutes, only to the site you signed in on and over https. Never without a key; a key the site refuses stops the timer until you press Sync builds or sign in again; signing out takes the builds out of the game |

The window is a sidebar with one page per thing to manage:

| Page | What it shows and does |
|---|---|
| Overview | The four states at a glance (upload, prices, `/ask`, addon), recent activity, the latest Blizzard changes |
| Chat | Ask anything about the game, or about your own characters. With a provider the model works Everloot's own MCP tools itself and names the sources; three local tools read your characters' gold, gear and progress, each realm's last scan, and the app's own status (what is on, what failed and why, the addon and app versions) from this computer, sourced as "this computer". Local tool results used for an answer are sent to the selected model provider. When the tools have nothing it answers from its own knowledge and says so. The answer shows as the model writes it, with the tool it is running, and each answer has a Copy button. An empty thread offers a few questions to start with; a failed job on the Overview or Log page has an "ask why" link that puts the failure to the chat, the Characters page has an "Ask the assistant" chip, and the tray menu an "Ask Everloot" item. Providers are your own account, and the model menu under the question box switches between the models of every provider you saved (for Chat and the in-game `/ask`), with an Assistant setup entry to add a provider or manage saved ones, the same inline setup as on the Ask and Settings pages (each preset links to its provider's own key page, and the model id box shows for "Another model id" or when the provider has no model list): an Anthropic key, an OpenRouter key (cheap or free models), an OpenCode Zen key (its zero-retention free models), an Ollama on this computer, or any OpenAI-compatible server. The key goes into a file in the data folder and `config.json` names it, so the in-game `/ask` uses the same pick. Saving selects that provider for Chat and puts it first for `/ask`; it does not test the key or send a test completion. Chat uses the first provider only, while `/ask` goes down the configured list. Everloot search itself is free and needs no key; a provider you add is your own account, so its pricing and limits apply. With no provider you get the sourced search hits as they are. Claude.ai and ChatGPT subscriptions cannot be used: both companies allow API keys in other apps, not their consumer sign-ins. The transcript stays in your data folder |
| Characters | Your own characters from the save file: gold with a line of every snapshot the addon kept and the last seven days as earned, spent and net, peak, item level, and the completion tracker's progress per character key. Stored locally; asking the assistant may send these details to the selected model provider |
| Upload | Each account file: when it was written, addon and client build, records per kind, how many the site confirmed. Run now |
| Market | Realm picks: your scanned realms are always carried; tick more from the realms the site has public values for (TSM-style realm picks, on Everloot's own scan data). Your characters' realms, read from the save file on this computer, are offered as one Follow click (the Overview offers it too while the game has no prices); nothing is asked of the site for them before you press it, a followed one is removed like any other, and No thanks keeps the offer away. When you last scanned each realm, with a reminder past a day. What the last refresh wrote |
| Ask | Assistant setup and which provider answers, the private MCP server and token file under an Advanced section (open from the start when one is saved), questions pending in game, recent answers with the time each was answered (not the source's own date) |
| Addon | Installed version against the latest `addon-v*` release (an Alpha included, the version the download page serves), install or update in one click (the zip is checked against the release's `SHA256SUMS` before anything is written), the slot addons' state, and the saved-builds sync: when it last synced, Sync builds, and why it could not (a key without the permission links to the key page) |
| Changes | The site's change tracker feed: Blizzard posts, hotfixes and builds |
| Log | Everything the engine did this session, with Pause |
| Settings | Pinned at the bottom of the sidebar. What runs (upload, market prices, in-game `/ask`), Assistant setup (the model keys: use, add, remove), the game folder, startup, the site address under Advanced, the data folder and the update check |
| On everloot.app | Links to the site's database, talent calculator, raid builder and auction prices. They open in your browser (tagged `utm_source=desktop-app`), not inside the app; Chat answers what the database and lore archive would |

### Recorded item prices, without a model

Desktop Chat, website Chat and in-game `/ask` recognize explicit price questions such as
`price 2589 on Nightslayer` or `what is the price of Linen Cloth on Nightslayer`. They look up
Everloot's recorded market directly, before any model or general search. An ambiguous item needs
an item id or link; a missing realm needs a realm name. New in-game questions carry the player's realm.

The answer identifies the all-house community scope, per-unit values, observation day and missing or
stale data, with a website history link. These are recorded asking-price estimates, not live auction quotes.
In-game online answers still use the file bridge: `/reload` or logout writes the question; after the app
answers, another `/reload` loads it. `/everloot price` gives immediate cached prices anywhere in game.
No model key is needed for these price lookups. Assistant setup adds an optional model for other questions;
website and desktop provider credentials remain separate.

The tray menu shows each job's last result, a reminder when a realm's last full scan is older
than a day, the newer app release when there is one, and Upload now, Refresh prices now, Pause and Quit.
Closing the window keeps the app in the tray. The window opens where you left it, at the same
size, unless that screen is gone. The release checks (app and addon) run at start, after the first Start, every hour
and when the window is opened. A newer app shows as **Update to X** in the sidebar and on the Overview, and once per
version as a notification while the window is not in front. On a Windows install one click downloads it and checks
it against the release's `SHA256SUMS`, and **Restart to update** installs it; if the old version is still there at the
next start, the app says the update failed. Elsewhere the button opens the download.

The app shares its data folder with the command line (`%APPDATA%\Everloot`,
`~/Library/Application Support/Everloot`, `~/.config/everloot`): `sent.json` for confirmed events,
`answers.json`, `settings.json` (a damaged one is moved aside to `settings.json.corrupt-<id>` rather than saved over), `chat.json`, an `updates/` folder with a downloaded Windows update until it is installed (the next start deletes it), a `backups/` folder with the newest ten copies of each
account's `Everloot.lua` before upload attempts, including while offline (the Upload page lists them and can restore one with the game closed,
and says so instead while World of Warcraft is running; the file it replaces is backed up first), and the optional `config.json` for `/ask` model providers (same
format and same rules as the [companion README](../companion/README.md#providers-design-sections-6465):
keys come from a file named by `apiKeyFile`, never from the config itself).

Everything stays on this computer when you uninstall the app: the installer leaves the data folder in place, so a
reinstall picks up where you left off. That includes your everloot.app key (`everloot-key.txt`), any model keys the
Assistant setup saved, `chat.json` and the `backups/` copies of your save files (gold, gear, guild and the rest the
addon records). The keys are plain files, protected by your user account like the rest of the folder, because the
command line reads the same files. To remove it all, quit the app and delete the data folder (Settings shows where it is
and opens it).

## Run it from source

```
cd web && npm ci && cd ../kb && npm ci --ignore-scripts && cd ../companion && npm ci && cd ../desktop
npm install
npm start
```

`npm start` bundles `src/` with esbuild into `dist/` and opens Electron. The bundle includes the
companion's modules and the site's parser (`web/src/lib/sv-parse.ts`), so `web` and `companion`
must be installed too.

```
npm test            # vitest: every module under src/main and the renderer's text helpers
npm run typecheck
npm run pack        # installers into release/ (electron-builder)
npm run icons       # remake build/*.png from web/src/app/icon.svg
```

Set `EVERLOOT_DATA_DIR` to a scratch folder to keep a development run away from your real
`sent.json` and settings. For a screenshot: `npx electron . --remote-debugging-port=9333`, then
`node scripts/screenshot.mjs shot.png`.

## Where things live

| Path | What |
|---|---|
| `src/main/index.ts` | Electron: single instance, the window, the tray, IPC handlers |
| `src/main/engine.ts` | Watches the account files and runs the jobs; every job is injected, so tests need no network |
| `src/main/jobs.ts` | The jobs, built on `companion/src` (uploader, prices, bridge) |
| `src/main/market.ts`, `inspect.ts`, `addon.ts`, `changes.ts` | Realm picks and the prices file, what a save file holds, addon install with checksum, the changes feed |
| `src/main/agent.ts`, `chat.ts` | The agent over the MCP server (the tool loop on Anthropic's API or any OpenAI-compatible one, or plain search) and the Chat page's transcript |
| `src/main/local-tools.ts` | The three tools the model can call about this computer: `my_characters` and `my_realm_scans` from the save files, `my_app_status` from the app's own job status; text only, through the same reads the Characters, Market and Overview pages use |
| `src/main/characters.ts` | Gold, gear and progress per character from the save file |
| `src/main/backups.ts`, `providers.ts` | The dated copies of each account file and their restore; the picked provider's key file and its `config.json` entry |
| `src/shared/providers.ts` | The provider presets the Chat page offers: base URLs, key shapes, the curated models and their data notes |
| `src/main/window-state.ts`, `json-file.ts` | The window's remembered size and place; JSON files read with a byte order mark allowed |
| `src/shared/website.ts` | The site pages the sidebar links to, and their address with the source tag |
| `src/main/settings.ts`, `game-folder.ts`, `updates.ts`, `external.ts`, `login-item.ts` | Settings file, where the game is, the release check, the browser allow-list, the start-at-sign-in entry (the portable exe names itself, not its temporary folder) |
| `src/preload.ts` | The only bridge the page can call (`window.everloot`) |
| `src/renderer/` | The window: one page, no framework, the site's colours; `format.ts` holds the text helpers, tested without the DOM |
| `src/shared/types.ts` | Shapes both sides use |
| `build/` | App and tray icons |
| `scripts/` | The esbuild bundle, the icon maker, the screenshot helper |

## Release

Set the version in `package.json`, add a `desktop-vX.Y.Z` section to the root `CHANGELOG.md`, tag
`desktop-vX.Y.Z` and push the tag. Before the first tag of a version, run the same workflow by hand
(`gh workflow run desktop-release.yml --ref <branch>`): it builds the three installers as workflow
artifacts and publishes nothing. `.github/workflows/desktop-release.yml` builds on Windows, macOS
and Ubuntu, runs the tests, and publishes the GitHub release with `SHA256SUMS`.
