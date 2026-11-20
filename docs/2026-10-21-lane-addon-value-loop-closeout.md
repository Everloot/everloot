# Lane closeout: the addon value loop, first slice (2026-10-21)

Drop-rate rule updated 2026-11-19: rates, measured zeros and unanimous drop source names now show from one install, labelled reported, verified at two, confirmed at three or more. This supersedes the drop publication thresholds described below; other thresholds stay unchanged. See [DATA_POLICY.md](DATA_POLICY.md).

Wave 2, lane D. Recording was a one-way street: the addon collected, the site stored, and the player saw almost
nothing back in the game. The spec for the whole loop is
[`docs/design/specs/2026-10-21-addon-value-loop-design.md`](design/specs/2026-10-21-addon-value-loop-design.md):
five modules, each with what the player sees, what exists and what it costs. This pull request builds the first:
where an item drops, in its tooltip, beside the prices that were already there. Nothing here has run in the
Forever client; the contract tests run the addon in Lua 5.1.

## What the player sees

With the Desktop App's `EverlootPrices` file in the game (after a `/reload`), hovering Linen Cloth:

```
Everloot market 2s 5c · min 2s 0c · historical 1s 90c
  40 up · 3 reporters · 2026-10-20
  prices fetched 2026-10-20
Everloot drop: NPC 116 · 12.4% (42 of 340 loot windows) · 5 installs
Everloot drop: NPC 94 · 6.0% (12 of 200 loot windows) · 3 installs
Everloot drop: NPC 474 · 4.2% (5 of 120 loot windows) · 4 installs
  drop rates from uploads as of 2026-10-20 · 1 more source
```

The price lines are unchanged from 0.3.10; the drop lines are new. What is missing is said in one grey line:
`Everloot: no price on Forever yet`, `Everloot: no drop source reported by 3 installs`, both joined by `·` when
neither is there, `drop sources not in the price file yet` for a file from an app without drops, and
`drop sources failed their checksum`. Without the file there is no Everloot line, as before. `/everloot price`
prints the same lines in chat. Sources show by id: the game cannot name a creature from its id, and the rollup
carries no names (Open, in the spec).

## What changed

| File | Change |
| --- | --- |
| `addon/modules/drops.lua` (new), `addon/Everloot.toc` | Reads the drops block, checks its Adler-32 a slice per frame, shows up to three sources best rate first, counts the rest, ignores any row under three installs. Writes nothing. |
| `addon/modules/prices.lua` | Exposes the sliced checksum, resets drops with prices, adds drop lines and the missing line to the tooltip and `/everloot price`. |
| `companion/src/prices.ts` | `renderPricesAddon(realms, drops?)`: a `drops = { data, sum, dataAsOf, fetchedAt }` block beside `realms`. Without drops the file is as before. |
| `desktop/src/main/market.ts`, `jobs.ts` | `fetchDropSources` reads `/api/rollups/drops` (same site, at most 10 pages, 5,000 rows); once a day, the last good block kept between fetches and when a fetch fails. The job message counts drop sources. |
| `addon/tests/drops_contract.py` (new), `.github/workflows/checks.yml` | The new contract, added to the addon test step. |
| `addon/tests/market_contract.py` | Loads `drops.lua`; three assertions that expected an empty tooltip now expect the missing line. |
| `addon/tests/fixtures/EverlootPrices.lua`, `companion/scripts/write-prices-fixture.ts` | The golden file carries a drops block. |
| `companion/test/prices.test.ts`, `desktop/test/market.test.ts` | Writer shape, fetch, paging, filtering, daily carry-over, the realm reader ignoring the block. |
| `addon/README.md`, `desktop/README.md`, `CHANGELOG.md` | What the tooltip and the app's market job now do. |
| `web/public/downloads/Everloot-0.3.10.zip` | Rebuilt; 0.3.10 is not tagged, so CI compares it byte for byte. `## Version` untouched. |

## Memory budget

| | Cost |
| --- | --- |
| SavedVariables | +0 bytes, measured: `EverlootDB` serialised before and after tooltips and `/everloot price` is byte for byte equal. |
| Slot file, 5,000 rows (the cap) | 108,892 bytes on disk. |
| Lua memory | about 107 KB for the addon's `;`-delimited copy, measured, on top of the string the file loads. |
| Checksum | 6 frames of 20,000 characters for 5,000 rows. |
| Site | 1 GET a day per app today (guard off); up to 10 with `EVERLOOT_DATA_GUARD=1`. |

## Tested

- All 25 runnable files in `addon/tests/` pass, including `drops_contract.py`: slot file shape, a tooltip with a
  price, one with a drop source (NPC and object), one with neither, a row under three installs, a missing date, a
  tampered block, a file without drops, a 5,000-row block checked across frames, the chat command, and the
  SavedVariables size.
- `companion`: 41 tests and `tsc --noEmit` pass. `desktop`: 134 tests and `tsc --noEmit` pass.
- `scripts/check_internal_paths.py` and `scripts/check_md_links.py` pass.

## Not done, and for someone else

- **Desktop version.** The app's new market job ships with the next desktop release; only the release lane cuts it.
  An older app keeps writing files without drops, and the addon says so.
- **Source names.** Needs a names source on the site (outside this lane): see Open in the spec.
- **The download page and disclosure.** The app now GETs `/api/rollups/drops`. It sends nothing new, and the addon
  reads nothing new, so the disclosure is unchanged; if the site's desktop page lists the app's requests, its owner
  should add this one. Web pages are outside this lane.
- **Modules 2 to 5** of the spec are design only.
