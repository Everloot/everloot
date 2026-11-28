# Profession Profit Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Forever players compare crafting profits, choose how to obtain reagents, and prepare accurate shopping plans inside the profession window.

**Architecture:** Extract Everloot's existing evaluator into a shared quote/calculation module, then build native displays and quantity-aware plans on it. Local character knowledge and recipe plans remain separate from public observations and legacy manual shopping lists. Existing scan summaries remain the market baseline; local depth/history and optional price adapters extend them without changing uploads.

**Tech Stack:** Lua 5.1, Blizzard Forever addon APIs, existing Python/Lupa behavior contracts. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-27-profession-profit-workflow-design.md` (approved).

## Global Constraints

- Independent implementation; no competitor code or assets.
- Preserve native appearance, filters, selection, Track Recipe and Create controls.
- Missing prices remain unknown; scans describe listings, not confirmed sales.
- Quotes and caches retain source, observation time, realm and house.
- External-addon quotes are runtime-local only; never upload estimates or those prices.
- Preserve legacy manual-list counts; recipe plans are character-scoped full requirements.
- Owned materials retain value in profit calculations; inventory reduces purchase shortfall only.
- Respect recorder-only mode, inventory-capture consent and existing release acceptance holds.
- No automatic buying, posting, crafting, paid services or server schema changes.

## Review Focus

1. Recycled native rows and late callbacks must not show a different recipe's profit (Task 2).
2. Filtered/incomplete profession reads must not prove alt or unlearned crafting capability (Task 4).
3. Shared intermediates and variable yields must not understate shopping quantities (Task 5).
4. Inventory changes, withdrawn consent and switching characters must not reuse stale stock (Task 6).
5. External quote selection must never contaminate own-scan history or uploads (Task 9).

## Execution and verification conventions

Work in this existing worktree. Before source work, fetch origin and inspect divergence; integrate upstream changes only after checking the diff, preserving the approved design and existing edits. Read the exact supported Forever UI source before implementing each UI hook. Use the project's behavior contracts, not assertions that merely search source strings.

Run every test/build command through the canonical lifecycle wrapper, for example:

`python <brain-root>/scripts/workspace_lifecycle.py --workspace . run --budget-gib 1 -- python addon/tests/crafting_contract.py`

Below, `test NAME` means that exact wrapper command with `addon/tests/NAME.py`. Run a new test red before production edits, then green. Register new contracts in `addon/tests/run_all.py`. Commit each task's named files after focused verification; do not stage unrelated files. Source commits use `[Everloot] Feature: ...` descriptions. Tests inspect observable results, selection and quantities.

The wrapper runs commands from the workspace root, regardless of the caller's shell working directory. For package tests use `npm --prefix web test -- <focused test paths>` or `npm --prefix kb test -- <focused test paths>` after the wrapper's `--`; likewise use `npm --prefix web run typecheck` and `npm --prefix web run lint`. Use this worktree's own dependency installation, never a junction to another checkout's node_modules.

## File responsibilities

- `crafting.lua` (new): recipe valuation and quote context; no UI or saved plan writes.
- `crafting_plan.lua` (new): bounded quantity resolution and character recipe-plan storage.
- `crafting_history.lua` (new): local own-scan depth/history, independent of uploaded records.
- `crafting_sources.lua` (new): optional runtime external price adapters.
- `native_crafting.lua`: selected schematic and recycled recipe/trainer decorations.
- Existing `view_professions.lua`, `professions.lua`, `shopping.lua`, `inventory.lua`, `options.lua`, `auctions.lua`: adapt their current responsibilities only where specified.
- `addon/Everloot.toc`: load model modules before their consumers. Extend the existing test loader to match TOC order when necessary.

### Task 1: Share the existing calculator without changing results

Files: create `addon/modules/crafting.lua`, `addon/tests/crafting_contract.py`; modify `addon/modules/view_professions.lua`, `addon/Everloot.toc`, `addon/tests/run_all.py` and, if needed, `addon/tests/window_world.py`.

Interfaces: `Everloot.Crafting.Context(realm, house, options) -> context`; `Everloot.Crafting.Evaluate(recipe, context, crafts) -> estimate`. Recipe contains `id`, `product`, `output={itemId, minimum, maximum}`, `reagents={{id,item,count,ambiguous}}`. Estimate retains existing `parts,cost,value,yield,cut,profit,source,observed,unpriced,output` fields and adds `crafts,margin,oldQuote`. Quotes use `{unit,source,observed,vendor}`. Context owns lookup caches for one refresh, not global mutable character state.

- [x] Write `crafting_contract.py`: a 200c input yielding two 900c items gives 1,510c net profit at 5%; a missing required input gives unknown cost/profit; zero-cost margin is unavailable; stale/cross-house inputs stay marked or excluded. Compare the existing native and comparison displays against the same fixture.
- [x] Run `test crafting_contract` and confirm missing shared interface causes failure.
- [x] Move the existing evaluator and quote policy into `crafting.lua`; adapt both views, keeping display-specific listing history outside valuation. Resolve integer copper rounding once for the requested craft count.
- [x] Run `test crafting_contract`, `test native_crafting_contract` and `test view_professions_contract`; all pass with unchanged existing fixture outcomes.
- [x] Commit this task's files.

### Task 2: Native recipe comparison and coexistence

Files: modify `addon/modules/native_crafting.lua`, `addon/modules/options.lua`, `addon/tests/native_crafting_contract.py`, `addon/tests/options_contract.py`.

Interfaces: `Everloot.Crafting.NativeEnabled() -> boolean,reason`; `Everloot.Crafting.Ranked(recipes, context, options) -> orderedEstimates`, with `options={sort='profit'|'name', profitableOnly, tag='money'|'margin'|'both'}`. Stable ties use name then recipe ID; unknown profits are last and excluded by profitable-only.

- [x] Add behavior cases for a recycled recipe row, collapsed category, selected recipe retained after filtering, delayed callback after closing, price verification in progress, recorder-only mode and CraftProfit detection with explicit override. Verify signs/text convey loss and stale state without color.
- [x] Run `test native_crafting_contract` and `test options_contract`; confirm new behavior fails.
- [x] Add row tags and sorting/filter controls using documented client hooks. If native category sorting is unsupported, attach the spec's comparison panel and use the native recipe-selection API. Add a per-character native-decoration preference; recorder-only wins and initial CraftProfit detection defaults off.
- [x] Run both contracts plus `test view_professions_contract`; verify no duplicate panels or stale tag on recycled rows.
- [x] Commit this task's files.

### Task 3: AH/vendor destinations and reagent detail

Files: modify `crafting.lua`, `native_crafting.lua`, `view_professions.lua`, `options.lua` and their contracts; extend `addon/modules/itemfacts.lua` only if the supported item API cannot supply a current output sell price without local caching.

Interfaces: Context options add `destination='ah'|'vendor'`; estimate adds `saleGross,cutCopper,vendorProfit`. `Crafting.VendorSell(itemId) -> unitCopper|nil` reads a verified sell price, never the observed vendor purchase-price index.

- [x] Add assertions: 1,000c output minus 100c input gives 850c at a 5% AH, 750c at a 15% house; verified 300c vendor output gives 200c; missing vendor sell data stays unknown even when vendor purchase data exists. Reagent Details exposes unit/line totals and source age.
- [x] Run the affected contracts and confirm destination behavior fails.
- [x] Add destination controls and both comparisons in Details; all recipe tags and ranking use the selected destination and shared evaluator.
- [x] Run `test crafting_contract`, `test native_crafting_contract`, `test view_professions_contract` and `test item_facts_contract` if touched.
- [x] Commit this task's files.

### Task 4: Character-scoped recipe capability

Files: modify `addon/modules/professions.lua`, `addon/tests/recipes_contract.py`; create `addon/modules/crafting_plan.lua`, `addon/tests/crafting_plan_contract.py`; update TOC and test registry.

Interfaces: `CraftingPlan.Known(characterKey) -> recipesById`; `CraftingPlan.ReplaceKnown(characterKey,professionId,recipes,complete)`. Saved state is `EverlootDB.craftingKnown[characterKey][professionId]`. Recipes carry learned state, output range, reagent IDs and cooldown availability. No calls to `E:Store` for this local state.

- [x] Test two characters with different learned recipes, legacy install-wide observations, filtered/incomplete reads, unknown cooldown availability and a complete read that removes a formerly known recipe. Unknown identity never uses a shared default key.
- [x] Run `test crafting_plan_contract` and `test recipes_contract`; confirm local capability behavior fails.
- [x] Capture current-character capabilities from supported API reads. Complete reads replace that profession; filtered reads may update proven entries but never claim completeness or infer missing entries as forgotten. Exclude cooldown-limited intermediate routes unless availability is verified.
- [x] Run both contracts and `test protocol_contract`; public observation shape remains unchanged.
- [x] Commit this task's files.

### Task 5: Quantity-aware buy-versus-craft resolution

Files: modify `crafting_plan.lua`, `crafting.lua`, `native_crafting.lua`, `view_professions.lua` and their contracts.

Interfaces: `CraftingPlan.Resolve(requests, context, known, owned) -> plan`; request is `{recipeId,crafts}`; plan is `{purchases={{id,item,count}},steps={{recipeId,crafts}},leftovers,unpriced,exclusions,cost}`. `owned` is an item-count map; use `{}` for a valuation estimate, actual inventory only for shopping. Strategy is `buy` by default or `cheapest`.

- [x] Assert needing three bolts with a two-bolt output requires two crafts; shared intermediates aggregate before rounding; variable output uses minimum to fulfill need; a cycle, unknown ingredient, alt-only recipe or unavailable cooldown cannot create a cheaper valid route. Leftovers never reduce cost by an assumed sale.
- [x] Run `test crafting_plan_contract`; confirm new resolution cases fail.
- [x] Implement bounded resolution (maximum depth 12, 500 unique recipe candidates, 50 purchase item IDs, 9,999 requested crafts per plan). On a bound, retain a valid buy route if available, otherwise show an explicit incomplete plan. Compare complete route costs only; emit a dependency-ordered make list and source explanations.
- [x] Run plan/calculator/native/comparison contracts; same craft count produces consistent valuation and shopping quantities.
- [x] Commit this task's files.

### Task 6: Character recipe plans and native shopping handoff

Files: modify `crafting_plan.lua`, `native_crafting.lua`, `addon/modules/shopping.lua`, `addon/modules/inventory.lua`, `addon/modules/auctiontab.lua`, `addon/tests/shopping_contract.py`, `addon/tests/inventory_contract.py`, `addon/tests/auction_tab_contract.py` and plan/native contracts.

Interfaces: `CraftingPlan.Put(characterKey,professionId,recipeId,crafts) -> receipt`; `Remove(...)`; `Preview(characterKey,context) -> plan`; `Inventory.CurrentBags() -> counts|nil,reason` is an ephemeral read and does not enable persistent inventory capture. Saved recipe plans contain full requirements; repeated Put replaces the same recipe. Manual lists remain unchanged. `Shopping.Search` remains the existing player-triggered one-item operation; needed-plan search progresses through that operation under its throttle/exclusion rules.

- [x] Test repeat Put replaces rather than adds, two plans share inventory once, purchases refresh shortfalls, alt view cannot search, consent withdrawal leaves no persisted stock, absent inventory APIs show full needs, unresolved item IDs/list caps give partial receipts, manual-list counts stay additive, and a late AH response after context change is ignored.
- [x] Run the affected contracts; confirm new plan and handoff behavior fails.
- [x] Add craft-count/preview/Add materials controls and separate manual/recipe search-source selection. Read current bags ephemerally; persist inventory only under existing consent. Bank counts are excluded unless currently open and completely readable; mail/alt counts are excluded. Show coverage. Plan changes invalidate queued searches. No purchase or crafting API is called.
- [x] Run all six affected contract scripts; verify saved full needs, displayed shortfalls and searched item identities agree.
- [x] Commit this task's files.

### Task 7: Trainer profit and payback

Files: modify `professions.lua`, `native_crafting.lua`, `view_professions.lua`, `addon/tests/recipes_contract.py`, `addon/tests/native_crafting_contract.py`, `addon/tests/view_professions_contract.py`.

Interfaces: `Crafting.TrainerEstimate(service,context) -> estimate|nil,reason`, with service `{spellId,trainingCostCopper}`. Uses a schematic identified by spell ID; payback is `ceil(trainingCostCopper / profit)` only for complete positive-profit estimates.

- [x] Assert 1,001c training / 500c positive profit requires three crafts; item links never masquerade as spell IDs, same-name recipes never join, missing schematics and zero/negative profit yield no payback. Test native trainer row reuse.
- [x] Run the three contracts and confirm trainer guidance assertions fail.
- [x] Add supported native trainer decorations and the equivalent ranks/trainers details. Reuse destination/source settings and coexistence rules. Do not mark trainer offerings as learned capabilities.
- [x] Run all three contracts plus calculator/plan contracts.
- [x] Commit this task's files.

### Task 8: Local price history, depth and break-even context

Files: create `addon/modules/crafting_history.lua`, `addon/tests/crafting_history_contract.py`; modify `auctions.lua`, `crafting.lua`, `native_crafting.lua`, TOC and test registry; extend auction contracts.

Interfaces: `CraftingHistory.Observe(realm,house,at,byItem)` accepts only completed Everloot full-scan listings; `Quote(realm,house,itemId,quantity,now) -> {cost,available,shortfall,at}|nil`; `Baseline(realm,house,itemId,today) -> median|nil,days`; `Crafting.BreakEven(recipe,itemId,context,crafts) -> unitCopper|nil` holds other inputs fixed and solves the buy-reagent break-even condition, unavailable for ambiguous/subcrafted target routes.

- [x] Test quantity walks versus a misleading cheap single listing, insufficient depth, partial scans excluded, separate realm/house caches, no baseline before three prior days, today excluded, duplicate same-day samples and history gaps. Verify the break-even quote makes net profit nonnegative and one copper higher makes it negative under identical rounding.
- [x] Run history/auction/calculator contracts; confirm new context behavior fails.
- [x] Store own-scan-only local data outside records. Keep 14 UTC days for at most 500 recently used input/output items per house; depth uses only newest completed scan, maximum 200 price levels per item, omitting overflow with an explicit truncated marker. A truncated ladder never claims complete quantity coverage. Prune least-recently-used items deterministically. Existing upload summaries remain unchanged. Show baseline change/depth availability in Details.
- [x] Run history/auction/native/calculator contracts and protocol contract. Exercise a synthetic 500-item, 200-level scan; report runtime and serialized cache size, reducing limits if it stalls the client budget. Reuse existing chunk scheduling rather than processing a full cache synchronously.
- [x] Commit this task's files.

### Task 9: Optional runtime price sources

Files: create `addon/modules/crafting_sources.lua`, `addon/tests/crafting_sources_contract.py`; modify calculator/options/TOC/test registry and their contracts.

Interfaces: `CraftingSources.Available(name) -> boolean,reason`; `Quote(name,itemId,realm,house) -> quote|nil,reason`. Names: `everloot`, `auctionator`, `tsm`. Quotes have `unit,source,observed,scope`; an unknown scope/age remains explicit, never invented. Re-read supported official addon API documentation before writing either adapter; unsupported APIs leave that adapter visibly unavailable.

- [x] Test absent addons, API errors, unknown age/scope, selected-source disappearance and explicit fallback. Assert external prices are absent from records, own-scan/history caches and public uploader inputs after UI refresh and save simulation.
- [x] Run source/calculator/options contracts; confirm new adapter behavior fails.
- [x] Add read-only adapters using documented APIs and source selection after core tasks pass. No new scan is started by source selection. Keep quotes in runtime memory only, with no automatic write into Everloot observations.
- [x] Run source/options/calculator/history/protocol contracts. Document exact client/API versions supported and adapters unavailable on the actual client.
- [x] Commit this task's files.

### Task 10: Integration, packaging and exact-archive acceptance (execute after Tasks 11–13)

Files: update `addon/README.md`, `docs/superpowers/plans/2026-11-27-profession-profit-workflow.md`, and a new `docs/2026-11-27-profession-profit-acceptance.md`. Release version/metadata changes only under the existing release workflow; do not overwrite released 0.3.31 ZIP while developing.

- [x] Add an integration behavior fixture that selects a learned recipe, changes destination/strategy/count, previews aggregate needs and searches the correct shortfall. Assert consistent money/quantities across native summary, comparison view and plan, including one missing-price case. (`addon/tests/crafting_integration_contract.py`)
- [x] Run that fixture red, wire only missing integration behavior, then rerun it green. Its red runs were fixture defects, not product gaps; no production change was needed. Three source mutants each fail it.
- [x] Run lifecycle-wrapped `python addon/tests/run_all.py` (62 PASS), `python addon/tests/raid_plan_contract.py` and `python addon/tests/planner_contract.py` (PASS). Candidate packaging/classification, deterministic ZIP and metadata verification belong to the release owner with version 0.3.33 Alpha.
- [x] Review the full branch diff against every spec capability; record automated evidence separately from live acceptance (`docs/2026-11-27-profession-profit-acceptance.md`). Update README with supported features, explicit exclusions and unavailable adapters.
- [ ] With an exact candidate archive, verify tailoring chains/bags, vendor returns, variable yields, missing prices, sorting/filtering, shopping/trainer flows, fresh same-house scanning, reduced UI scale and coexistence. Do not attest to unobserved checks. Record remaining failures; do not tag or publish until existing release requirements and authorization are satisfied. Not observed: owner checks; the release ships on the Alpha channel with `ADDON_LIVE_VERIFIED=false`.
- [ ] Commit tested integration/docs and hand off the canonical shared status with the exact candidate SHA, archive hash and live-check state. Integration/docs committed; candidate SHA, archive hash and shared status belong to the release owner.

### Task 11: Correct website quote basis

Files: `web/src/app/tools/professions/recipe-shopping.tsx` and `recipe-shopping.test.tsx`.

Interface: existing `FullPriceRow` stays unchanged; index 1 is market value and index 2 is lowest listing. A missing market value is unpriced even when a minimum exists. Preserve incomplete subtotal copy and existing links.

- [x] Write a rendering interaction fixture where market and minimum differ and another where market is null but minimum exists; assert cost/copy use market only and missing input remains visible.
- [x] Run focused `npx vitest run src/app/tools/professions/recipe-shopping.test.tsx` through the lifecycle wrapper in `web`; confirm red.
- [x] Correct all material line/copy/total calculations to market basis, without changing the price API or public data.
- [x] Rerun focused test green and recipe-shopping/recipe-table page regression tests.
- [x] Commit this narrow behavior fix; do not publish it separately from the authorized complete workflow.

### Task 12: Build-stamped output quantities and identity-safe community inputs

Files: `kb/src/client-recipes.ts`, `kb/test/client-recipes.test.ts`, `kb/src/profession-path.ts`, `kb/test/profession-path.test.ts`, `kb/src/recipe-thresholds.ts`, `kb/test/recipe-thresholds.test.ts`, `web/src/lib/professions.ts`, `web/src/lib/recipe-catalog.ts`, `web/src/lib/profession-planner.ts`, `web/src/lib/profession-store.ts`, their focused tests and generated `web/src/data/game-data/client-recipes.json`.

Interfaces: add optional build-stamped `outputs[spellId] = {itemId,minimum,maximum,cooldownMs}` to the client recipe schema; retain existing recipe tuples and row payload budgets. Extend RecipeView/SearchRecipe with optional output item/range. Add `agreeVendorPricesById(rows)` retaining only positive copper prices with item-ID identity and the existing three-install agreement threshold; preserve existing name-based levelling planner APIs. Preserve trainer spell IDs through aggregation; no recipe/product namespace or name-only payback join.

- [x] Test exact base-difficulty CREATE_ITEM effect identity, multiple unrelated effects, conflicting create outputs, missing/random/ambiguous quantity fields and cooldowns. Test vendor zero/negative values excluded and distinct same-name items separated. Test same-name trainer offerings cannot attach training cost to the wrong spell ID.
- [x] Run focused client-recipes/profession-path/recipe-thresholds tests red via lifecycle wrapper.
- [x] Extend the generator from real SpellEffect rows with explicit provenance. Fixed positive integral quantities can be emitted only from the matching unambiguous create-item effect; unsupported random-yield formulas remain unavailable until validated against the supported client's schematic. Record ambiguity counts. Do not infer one item per craft. Add identity-safe community inputs as additive snapshot fields with old-snapshot fallback, preserving public observation schemas.
- [x] Re-extract/read a real same-build client snapshot using the client-mining workflow, regenerate the committed catalog with its actual build stamp, and inspect representative ammunition/single-output/multi-effect recipes. No hand-written generated JSON or mixing yields from a different build. Run focused kb/web tests, typechecks and row-budget guards.
- [x] Commit generator, fixtures, consumers and generated data together with a source/coverage receipt; no unconfirmed client price becomes a verified vendor sell price.

### Task 13: Website crafting valuation, plans and sharing

Files: create `web/src/lib/crafting-profit.ts`, `web/src/lib/crafting-profit.test.ts`, `web/src/lib/crafting-profit.parity.test.ts`, `addon/tests/fixtures/crafting-parity.json`; modify existing recipe shopping/table/profession page and their tests, `addon/tests/crafting_contract.py`, and a focused website plan component only if needed.

Interfaces: `evaluateCraft(recipe,quotes,options) -> estimate` matches current Lua cost/yield/cut/per-craft margin/batch rounding semantics; `rankCrafts(rows,options)` matches profit/name/ID ties. `resolveCraftPlan(requests,context,catalog,makeChoices,owned) -> plan` uses explicit allowed catalog recipe IDs, bounded traversal and aggregated whole-batch quantities/leftovers. Defaults are Buy strategy, AH destination, no assumed character capability, and empty browser-supplied owned quantities. Context uses selected realm/house and source dates. Reuse existing server `uploadStore.loadMarket()` / `marketPrices` only after realm+house selection, avoiding price-API item-limit bypass or unbounded client request loops.

- [x] Promote and extend the prepared ten conformance fixtures following existing ledger parity patterns; exercise market-null/min-present, positive vendor purchases, stale dates, Neutral cut, variable yields, missing verified vendor sale, sort ties, leftovers, cycles and shared intermediate stock in both Lua and TS. Render selected/unselected realm states and assert no extra recipe-row payload when ranking is off.
- [x] Run Lua calculator and TS/render regression tests through the lifecycle wrapper. Lua had an initial red run; the first website implementation did not. Its later fix regressions failed before their fixes. This records test evidence without claiming a missing initial web red run.
- [x] Implement pure valuation/resolution, then integrate existing website controls for source-aware profit/margin, destination, Buy/make choices, owned quantities, ordered steps, leftovers and copyable shopping plan. Explicitly label catalog routes as not checked against a character; cooldown/unknown yield routes excluded with reasons. Vendor profit remains unavailable without verified sell evidence. Whole-profession rankings are server-computed only with selected realm/house; label Everloot estimates separately from AH Ledger and do not import its sales/day claims.
- [x] Round-trip `recipe`, `crafts`, `realm`, `house`, destination, make choices and non-sensitive user-supplied plan quantities through a share link with bounded validation. Keep no external-addon or local game data in links/uploads. Test stale responses after selection changes, unknown inputs, long recipe names, keyboard controls and copied details.
- [x] Run focused web/kb/Lua conformance tests, web typecheck/lint and applicable performance/row-budget checks. Exercise the website player journey through the shared browser if accessible; report actual runtime evidence separately. Commit tested source and fixtures before final Task 10/whole-branch review/release.

## Self-review

Coverage: native comparison/quotes (1–3), capability and chains (4–5), shopping/inventory (6), trainers (7), history/depth/break-even (8), adapters (9), website quote correction/data/parity (11–13), then live acceptance/docs/release (10). Every Review Focus risk has an owning task's red/green behavior check. Interfaces use the same recipe IDs and quote fields across consumers. API feasibility remains a documented implementation check, never permission to guess data. Research found bank layout unverified: restrict initial plans to fresh bags and label coverage. Vendor destination on the website remains unavailable without verified sell evidence. Website catalogs never prove character capability.

Execution selected by Carlos: subagent implementation and independent task/whole-branch reviews, with autonomous fix loops. Reuse this worktree and serialize implementation tasks sharing modules. Carlos subsequently authorized evaluating the finished workflow and publishing the new CurseForge release through the existing workflow, with player update delivery. Website parity is also authorized; its source-grounded tasks are added before final integration/release.
