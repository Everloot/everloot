# companion/: the Everloot desktop companion

A command-line helper that runs beside the game. It uploads the addon's SavedVariables file
(`upload`, or `watch` while you play) and answers `/ask` questions through a file bridge
(`bridge`). Node and TypeScript. [Everloot Desktop App](../desktop/README.md) is the same thing as a
tray app with an installer, built on these modules; the builds are not code-signed yet.

## Run it

```
cd web && npm install && cd ../companion   # the companion reuses the site's parser
npm install
npx tsx src/cli.ts upload --file "<WoW>/WTF/Account/<ACCOUNT>/SavedVariables/Everloot.lua"
npx tsx src/cli.ts watch --game "<World of Warcraft folder>"
```

Before it sends anything it prints how uploads are licensed (CC BY-SA 4.0) and where the source is.

- Sends only events the site has not confirmed (`sent.json` in the app data folder:
  `%APPDATA%\Everloot`, `~/Library/Application Support/Everloot`, or `~/.config/everloot`).
- Named data (guild, gear, gold, collection) never leaves the machine from here; share it on the
  website with a verified grant.
- The installed addon list (`/everloot addons on`) and the census (`/everloot census on`) never leave
  from here either; they are sent only from the upload page, which lists the addons and counts the
  census first.
- Reuses the site's parser and batching (`web/src/lib/sv-parse.ts`, `upload-batches.ts`), so
  `web` must be installed too. `--endpoint` targets another deployment; `--state` another state file.
- It only reads the file the game writes. It never touches the game client.

## Market prices in game

```
npx tsx src/cli.ts prices --game "<World of Warcraft folder>"
```

Reads the realms of your own auction scans in `Everloot.lua` (`lastScans` and the auction record kinds
only; the realm of a guild or gold record is never sent), fetches each one from `/api/market/prices`, and writes
the `EverlootPrices` slot addon under `Interface/AddOns`. Item tooltips show the community market
value, minimum and historical price after the next `/reload`. `watch --game` refreshes them after
every upload.

- Prices are public market values only: a day counts when 3 reporters (distinct upload addresses) scanned the item
  (`kb/src/market.ts`). A realm's file holds at most 2,000 items, the ones with the most units listed. Your own latest scan shows in tooltips without the companion.
- Each realm is one Lua-escaped string with an Adler-32 `sum`; the addon ignores a realm whose sum
  fails. `addon/tests/market_contract.py` loads the golden file
  (`companion/scripts/write-prices-fixture.ts`) in real Lua 5.1.
- A failed fetch keeps the previous file; it is never replaced with an empty list.

## /ask bridge (file bridge, per the design's public-build rule)

```
npx tsx src/cli.ts bridge --game "<World of Warcraft folder>" --mcp https://<host>/mcp --token-file <file>
```

The addon stores `/ask` questions in SavedVariables (written at logout or `/reload`). The bridge
answers new ones from the Everloot MCP server's `answer_sources` (the evidence the site's chat uses: observed,
curated, the current game files' facts, then the 2023 wiki) and writes them into the `EverlootAnswers` slot addon
under `Interface/AddOns`; they show after the next `/reload`. With no AI provider the answer is the first piece of
evidence and its page; with one, the provider phrases it from the evidence alone.

A follow-up such as `/ask what does he drop` right after `/ask where is Edwin VanCleef` (within 30 minutes) is looked
up alone first; only when that finds nothing named (no game-files, observed or curated fact) is it looked up again
with the question it follows, and a provider is then told that question and its answer. So `/ask is it in orgrimmar`
keeps to Orgrimmar however it is typed. The questions are kept only in the companion's own `answers.json`; the slot
addon carries answers. Characters on one account share that store, so a question can follow another character's.

Explicit item-price questions use `market_value` before search or a model, so they need no AI provider.
For example, `/ask price 2589 on Nightslayer` asks for that realm's recorded all-house values.
New addon questions carry the player's realm when none is named; older questions must name one.
The answer reports observation age and insufficient or unavailable data rather than inventing a price.
Write a queued question with `/reload` or logout, let the bridge process it, then `/reload` again to read it.
For an immediate offline answer from the current game files, use `/everloot price` with an item link or id.
The Desktop App's public-search setup needs no token file; the command above is the CLI's private-server setup.

- Every string is a Lua-escaped literal (`src/bridge/lua.ts`); `addon/tests/answers_contract.py`
  loads the golden file in real Lua 5.1 and proves hostile text stays data.
- Each answer carries an Adler-32 `sum` the addon can verify with Lua 5.1 arithmetic.
- No source, no answer: an unsourced search result is reported as "No sourced answer found."
- The token is read from a file, never passed on the command line.
- With no providers configured, answers are the top search hit. With providers, the bridge
  passes the top three hits to a model, which writes at most two sentences from those
  sources only, named "(answered by <model>)". No source means no model call.

### Providers (design sections 6.4–6.5)

`config.json` sits next to `sent.json` in the companion's data folder. Providers are tried in
order and fall through only on auth, billing, rate-limit, timeout or server errors, never on
answer quality. Keys are read from files (`apiKeyFile`); a key written inside the config is refused.

```json
{ "providers": [
  { "type": "openai-compatible", "baseUrl": "http://127.0.0.1:11434/v1", "model": "gemma4:12b" },
  { "type": "anthropic", "apiKeyFile": "C:/Users/<you>/keys/anthropic.txt" }
] }
```

- `openai-compatible` covers DeepSeek, OpenRouter and a local Ollama (no key needed locally).
- `anthropic` uses the official SDK, `claude-opus-5-5` unless `model` is set, at low effort,
  with server-side refusal fallback turned on. Calls bill the user's own key.
- The addon side is `addon/modules/ask.lua` (since 0.2.5).

## Test it

```
npm test
npm run typecheck
```

## Where things live

| Path | What |
|---|---|
| `src/cli.ts` | Commands and arguments |
| `src/uploader.ts`, `src/sent-state.ts`, `src/savedvariables.ts` | Uploading and remembering what the site confirmed |
| `src/bridge/` | The `/ask` file bridge: questions in, Lua-escaped answers out |
| `src/prices.ts` | Market prices: realms from your file, the site's prices, the `EverlootPrices` slot addon |
| `src/providers/` | Optional model providers for answers |
| `test/` | Vitest tests |
