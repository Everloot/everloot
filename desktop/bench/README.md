# Desktop App main-thread benchmark (audit items F11, F12, F24)

`npm run bench` in `desktop/` (add `-- --quick` for a smoke run). It takes about six minutes.

## Method

- **Save files.** `synthetic.ts` writes `Everloot.lua` the way the game writes SavedVariables: one field per line, tab
  indents, a `-- [n]` comment after each array item. Row shapes follow the addon's `E:Store` calls; every value comes
  from a seeded generator. There are three sizes:
  - **small**: a casual week. 2,277 records, 1.5 MB, one auction scan.
  - **heavy**: a month of an active raider. 19,720 records, 13.9 MB. Most kinds sit at the addon's 2,000-row cap
    (`addon/core.lua`), and there are 3 full scans on each of 2 realms (3.6 MB of the file). Rows are never removed
    after an upload, so this is near the steady-state size of one busy account.
  - **extreme**: 5x heavy, 98,600 records, 70 MB. It goes past the per-kind caps, so it is a stress bound, not a
    file the addon can write.
- **Counting.** `run.mjs` bundles `bench.ts` with the app's real modules. It wraps `parseEverlootLua`,
  `parseEverlootTable` and `createSentState` so every call is counted and timed. The app's source is not changed.
- **One logout.** The real `createEngine` and `companionJobs` run with upload, prices and /ask on, against a local
  stub site that answers at once. After the first run, each logout is a new file write: the real file watcher picks it
  up after the app's settle times (5 s upload, 2 s ask). Every state push does what `index.ts`'s broadcast does with
  the save file (the scan ages behind `staleScans`). "Longest event-loop stall" is the largest gap between ticks of a
  1 ms timer while the jobs run. It includes everything synchronous, not only parsing.
- **sent.json.** One install's receipts with 10k, 100k and 1M event ids in the addon's id format.
- **Machine.** A 12-core desktop CPU on Windows 11, Node 22. Run-to-run noise on this machine is about ±25%: one
  heavy parse measured between 180 and 290 ms (p50) across three full runs. No real save file was available, so every
  number here is synthetic.

## Results

### F12: save file parses per logout

One full parse (p50 / p95, ms):

| size | file | parseEverlootLua | parseEverlootTable |
| --- | --- | --- | --- |
| small | 1.5 MB | 22 / 27 | 22 / 29 |
| heavy | 13.9 MB | 201 / 269 | 199 / 239 |
| extreme | 70 MB | 1,154–1,544 | 1,089–1,583 |

A steady logout (the next write after the first upload; p50 / p95):

| size | | full parses | parse ms | longest single parse | longest stall |
| --- | --- | --- | --- | --- | --- |
| small | before | 4 | 121 / 203 | 35 / 82 | 95 / 164 |
| small | after | 2 | 51 / 84 | 29 / 46 | 47 / 88 |
| heavy | before | 4 | 1,102 / 1,176 | 323 / 349 | 722 / 773 |
| heavy | after | 2 | 534 / 663 | 276 / 441 | 391 / 494 |
| extreme | before | 4 | 6,014 / 6,258 | 1,680 / 1,775 | 3,510 / 4,038 |
| extreme | after | 2 | 2,315 / 2,334 | 1,276 / 1,284 | 1,536 / 1,657 |

Before the change, the parses in one heavy logout were: `uploadFile` (upload job), `readRealms` (prices job),
`readAsks` (ask job) and `readScanAges` (first state push after the write). With /ask off, which is the default, it
was 3. The pages added more. Each Overview or Market reload ran `ownRealms`, a full parse (about 210 ms at heavy).
The renderer reloads the open page 800 ms after the last state push, so at least once per logout. The Ask page
parsed on every load. The hourly price refresh parsed each file even when nothing had changed.

After the change it is `uploadFile` plus one shared parse. A reload of the same file costs 0.04 ms.

The realm suggestions added to the Overview and Market page later brought a full parse back to each reload
(`characterRealms`, about 165 ms at heavy in a quick run). They now come from the same shared parse: 0.02 ms per
reload, for about 6 ms more per write at heavy (26 ms at extreme), the cost of summarizing the characters.

Not changed, each parsing on its own:

- The Upload page parses 4 times once per write (`summarizeFiles`, cached afterwards): 804–1,156 ms at heavy.
- The Characters page and the chat's `my_characters` tool parse on every call: 234–258 ms at heavy.

### F11: sent.json

| event ids | file | load at launch | save after one batch | Upload page read |
| --- | --- | --- | --- | --- |
| 10,000 | 0.4 MB | 2–3 ms | 1.5–3 ms | 1–2 ms |
| 100,000 | 3.9 MB | 20–29 ms | 8–11 ms | 9–12 ms |
| 1,000,000 | 39.9 MB | 455–537 ms | 94–136 ms | 117–203 ms |

The first upload of a heavy file writes sent.json 8 times (21 ms in total); a steady logout writes it once (3 ms).
The first heavy upload leaves a 0.5 MB file.

How big sent.json gets in 3 months is an estimate from the addon's code, not a measurement. Filling every capped kind
once is about 80k ids. Census rows turn over daily (one row per player per day, the oldest days dropped past 2,000).
At about 500 players seen a day, that adds about 45k over 90 days. Pruned auction scans add about 1k. That makes
roughly 100k–150k ids, which load in about 20–45 ms. Reaching 1M would take years of play, or many installs or sites.

### F24: state pushes

Measured: 6 state pushes per steady logout (8 on the first run, which also has the launch pushes). Each push redraws
the open page in the renderer and rebuilds the tray menu. The render cost was not measured, because there is no DOM
in this harness. The renderer is its own process, and the tray menu has 14 items. The expensive part of a push was the
main-process page reload behind it (the `ownRealms` parse above), and the F12 change removes that.

## Recommendation, ranked

1. **F12: over the threshold. A partial fix is in this branch.** A heavy logout blocked the main thread for about
   1.1 s of parsing and stalled for 0.7 s at once. Sharing one parse per write (`src/main/save-facts.ts`) halves the
   parse time and removes the page-reload parses. That brings small saves under 100 ms per logout. Heavy saves are
   still above it, because one parse of a 14 MB file takes 200–300 ms by itself. Next steps, in order:
   - give the Upload page's `summarizeFiles` and the Characters page the same shared parse;
   - move the remaining parses to a worker thread, which is the only change that gets a heavy save under 100 ms.
2. **F11: no fix warranted.** At a plausible 3-month size, sent.json loads in 20–45 ms and saves in about 10 ms, far
   under 200 ms. If it ever matters, the safe cap is to keep only the ids still present in that install's save file
   after each upload: rows that left the file can never be sent again.
3. **F24: no fix warranted on these numbers.** There are 6 pushes per logout, and the costly work behind them was the
   F12 parse. Debouncing the redraw or tray rebuild can wait until a render cost is measured in Electron.
