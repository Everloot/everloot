# Addon price presentation verification

Date: 2026-11-05. Implementation source: `dff680671bd7bc31eda7d242b88d5703be8cfbea`.
Price UI commit: `6d1330f0`; integrated current main through `1a48e20d`, retaining 0.3.17 and the minimap drawer.

## Result

Implemented aligned tooltip price rows and native coin textures, readable evidence/warnings, optional vendor comparison, wrapped drop details, structured auction lookup with a scrollable result, and shared native styling for Home/Options/AH. Plain chat still uses the same values. No new disenchant model, backend, schema or automatic auction actions.

Independent review found no blockers or high-severity code defects. Fixed its three small findings: shared missing-price explanations for chat/AH, narrow scan/share button sizing, and consistent documentation terms. Focused tests reproduced the first two before the fixes and passed afterward. Parent also reproduced and fixed unwrapped drop evidence before the final suite.

## Final checks

- `uv run --with lupa --with jsonschema python addon/tests/run_all.py`: 34 PASS after main integration.
- Same runner for `raid_plan_contract.py` and `planner_contract.py`: both PASS.
- Whitespace check: clean.
- Published downloads: unchanged by implementation/tests/build.
- Private scratch build `0.3.17-price.1`: 33 archive entries verified against build source, all unstamped files verified against the checkout. Only TOC/core candidate version differs from tested source.
- Deterministic rebuild: identical ZIP bytes.
- ZIP size: 493,865 bytes. SHA-256: `047d7488fe53fe0c803b240fd4220e35906f9b51aed395f47d5263a9404a6a7f`.

Candidate and install/rollback checklist are in the local scratch artifact directory `tmp/everloot-price-candidate/`. They are not public release assets. No branch push, PR, tag, merge into main, production deployment or installation was performed.

## Remaining acceptance

A separate concurrent realm/ruleset styling lane also edits the tooltip and drop presentation. Its uncommitted work was preserved and its owner notified. This private candidate does not include that separate lane. Public integration must reconcile both implementations rather than overwrite either. The shared project status records the coordination handoff.

Reconciled 2026-11-05 on `feat/addon-price-presentation`, on top of `99108611`. This branch's coin format, colours, vendor row, wrapping, quiet words and plain chat lines are kept as they are. The realm lane adds three things: the header's right column names the realm, with its ruleset split off in its own colour, before "per unit" (`E.RealmRuleset`, matching the site's `rulesetFromName`); a drop rate is a value-column row with its loot windows and installs on a muted line beneath (`detail`), while chat and the no-columns fallback keep the sentence; and the missing note loses its "Everloot:" prefix. Its zero-padded coin format was not carried over, because chat and the tooltip must show the same amount. After the reconciliation: 34 addon contracts and both planner contracts PASS.

Real Forever rendering is unverified: tooltip height, native coin sizing, 100/125/150% UI scales, Spanish, the AH scroll/footer and possible duplication of the game's native vendor-price row. Automated frame stubs do not prove those visuals. Existing data and stale/missing-state behavior are tested; visual improvement is not claimed as measured in the game.
