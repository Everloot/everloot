# Profession profit workflow: acceptance

Date: 2026-11-28. Spec: `docs/superpowers/specs/2026-11-27-profession-profit-workflow-design.md`. Plan:
`docs/superpowers/plans/2026-11-27-profession-profit-workflow.md`. Branch `t3/competing-crafting-addon`, from base
`35e840d24` (after merging `origin/main`).

Release: addon 0.3.33, **Release channel: Alpha**, `ADDON_LIVE_VERIFIED=false`. The release tooling records the
exact source commit, archive name and SHA-256 at packaging. No live check below has
been observed on any archive, so none is attested. A stable (verified) release needs the owner's checks on the exact
archive.

## Candidate archive

The integrated candidate was packaged from `1ce1fe06c` after merging current main `451a22b77` and retaining its
profession leveling and gathering guides. Archive: `Everloot-0.3.33.zip`, 56 source files and one texture.
SHA-256: `d059444ee5b0e2b472668a44ae8cc75e690b85b84762668e8ed726e80833d8be`.
This records locally packaged bytes, not publication or live acceptance. The release receipt must confirm the final
merged source and the independently downloaded public bytes. Any later runtime change requires a new digest here.

## Capabilities

Every spec capability, where it was built and how it was checked. "Automated" means the Lua contract tests (Lua 5.1
through lupa), the web/kb tests or the local browser journey. "Live" means WoW: Forever with the exact archive.

| Capability | Built in | Automated | Live |
|---|---|---|---|
| One calculator and quote policy for native, Crafting costs and trainers; missing price unpriced, never 0; margin = profit / materials, none for zero or unknown cost | 58e0d40bc, 10f758056 (Task 1) | crafting_contract, native_crafting_contract, view_professions_contract | not observed |
| Compact native recipe tags, recycled rows cleared; docked list with gold/margin/both, profit sort, name/ID ties, Profitable only; selection opens the native recipe | d4d252240, 6608f42cf (Task 2) | native_crafting_contract, options_contract | not observed |
| Recorder-only and CraftProfit default off with a per-character override | Task 2 | native_crafting_contract, options_contract | not observed |
| AH (house cut) or vendor (game sell price) destination for tags, sorting and summary; both in Details; vendor purchase price never a sell price | 3f15d8e35, a09a6adc7, 62c26bb44 (Task 3) | crafting_contract, native_crafting_contract, view_professions_contract | not observed |
| Character-scoped recipe knowledge; filtered reads never prove completeness; old install-wide rows never unlock routes | 42944c38d, 7037ffdaf (Task 4) | crafting_plan_contract, recipes_contract, protocol_contract | not observed |
| Buy or cheapest route by item and recipe ID: whole crafts, leftovers, minimum yield, cycles and bounds, shared intermediates aggregated before rounding, build-stamped cooldown evidence and current reads | 9458277d8, 4b0a52f30 (Task 5) | crafting_plan_contract, crafting_contract, native_crafting_contract | not observed |
| Character recipe plans: preview then save, repeat replaces, fresh bags consumed once, alt plans view only, partial receipts, separate manual and plan sources, Search needed under the throttle, late replies ignored | 5646306ec, 1f970ee0d (Task 6) | shopping_contract, inventory_contract, auction_tab_contract, crafting_plan_contract, native_crafting_contract | not observed |
| Trainer profit and payback from the exact recipe spell ID only | 8a2e0f2ac, 23c14b286 (Task 7) | recipes_contract, native_crafting_contract, view_professions_contract | not observed |
| Own-scan 14-day history, 7-day median after 3 days, listing depth with shortfall and truncation, break-even, future/partial scans rejected | 36fbb1e1d, 3320d534f, 772277f8b (Task 8) | crafting_history_contract, auction_contract, native_crafting_contract | not observed |
| Optional Auctionator/TSM sources, runtime only, explicit fallback, never in records, history or uploads | 7e78e3953, 070be8588 (Task 9) | crafting_sources_contract, options_contract | unavailable: neither addon installed on Forever |
| Website quote basis: market value only, missing market unpriced | 2bfd256f1 (Task 11) | recipe-shopping web tests | browser: passed (local) |
| Build-stamped output quantities, item-ID vendor agreement, spell-ID trainer joins | 9b6f38aa0 (Task 12) | kb client-recipes/profession-path/recipe-thresholds tests | n/a |
| Website valuation, catalog plans, share links, merchant unit evidence (addon, local only) | 452d80874, 874bd940f (Task 13) | crafting-profit and parity tests, crafting_contract | browser: passed (local), see below |
| All surfaces together: one learned chain through native summary, Crafting costs and the AH plan; destination, route and count changed; preview, shortfall, Search needed; one missing price | this commit (Task 10) | crafting_integration_contract | not observed |

## Automated evidence

Final integrated checks, after the scoped fix review: website 7,753 passed / 30 skipped; KB 2,436 passed / one skipped;
all 62 addon contracts passed with the existing expected failure unchanged; both connected planners passed. Web/KB
typechecks, web lint, Alpha classification, CurseForge metadata, internal-path, Markdown-link and environment guards
passed. The cooldown generator matches the owned snapshot, and rebuilding the ZIP reproduces the committed bytes.
The full-branch review and its single scoped fix recheck approved Alpha publication with live verification off.

Recorded per task in the ignored SDD folder `.superpowers/sdd/2026-11-27-profession-profit-workflow/` (task reports,
independent reviews and saved outputs). For Task 10, on `874bd940f` plus `f9b1a253a` and this commit's files, every
command through the lifecycle wrapper:

- `crafting_integration_contract.py` passes. Its first runs failed on fixture stubs and assumptions (a frame text
  width, the order Search needed walks the rows, and a price file swapped mid-session, which the game cannot do), not
  on product behavior; no production change was needed. Three mutants on a scratch copy each fail it: the AH plan
  ignoring bags, the Crafting costs route ignoring the count, and the native preview showing the material value as the
  cash to buy.
- `python addon/tests/run_all.py`: Addon contract tests: 62 PASS (61 plus the new contract), with the existing
  expected failure.
- `python addon/tests/raid_plan_contract.py` and `python addon/tests/planner_contract.py`: PASS.
- Website (Tasks 11–13, recorded by those tasks): focused web 109/109, wider web 28 files / 283, kb 98, typecheck,
  lint with 4 earlier warnings.

The local browser journey on `874bd940f` (synthetic QA Realm uploads, never production) passed: two-craft Linen Bag
batch and average, copied text and share link, allowed-make toggle, a held old reply ignored after a house change,
realm-only links with no scoped request, invalid inputs isolated, vendor unavailable, Mooncloth's recorded cooldown,
unknown output count, Neutral 15% cut and a 375 px layout without horizontal overflow. It says nothing about the game.

A final integrated browser run after the fixes also preselected the guide from the card's canonical Horde link,
submitted Plan route without link errors, switched the guide to Alliance and submitted its canonical link, then saw
the card use Alliance prices (16,500 copper profit for one craft). The finished item and both purchased materials
retained their activity links. The 375 px screenshot showed no horizontal overflow. Synthetic uploads were local only,
removed after digest comparison with preserved copies; the owned tab and server were closed with the lease released.

## Live checks, not observed

To be run by the owner on the exact release archive. Not attested by this page:

1. Tailoring cloth to bolt to bag at a count needing rounded intermediate batches, with bags holding some cloth and a
   bolt: order, quantities, cost, leftovers.
2. A vendor reagent and a vendor output: sell price used, purchase price never.
3. A variable-yield recipe: minimum for materials, range shown.
4. A missing-price reagent: unpriced on the summary, tags, list, Details and plan.
5. Tag modes, profit sort and Profitable only, recipe switching, scrolling and collapsed categories; OpenRecipe for a
   hidden recipe.
6. Plan preview and save, repeat with a new count, a second recipe sharing materials, bag changes; Search needed at the
   house with throttle, a running scan and closing the house.
7. A trainer recipe with a verified spell ID, a class service and an unresolved item.
8. A fresh same-house scan refreshing the estimate, depth shortfall and history gaps.
9. Reduced UI scale: reagent slots, Track Recipe, Create and Details usable; both-mode tag width.
10. Coexistence: CraftProfit detection default and override after /reload; Auctionator and TSM where installed.
11. Per-character merchant unit prices (`at`, `build`) after /reload; no write for bundles or tokens; a stored row with
    no output reading "Output unknown".

## Local-only stores

Saved in `EverlootDB`, never records or uploads: `craftingKnown` (recipes each character proved), `craftingPlans`
(recipe plans and route), own-scan history and depth, `vendorUnitPrices` (merchant unit prices per character and build,
14 days), the price source choice and the native-display choice per character. The planner's fresh bag reads and
other addons' prices are not saved. Separate inventory capture retains its existing explicit-consent setting; this
feature does not enable it. Website plans live in the browser and its share links only.

## Exclusions and unavailable sources

Not built: market sold-per-day, confirmed sale prices, crafting with another character's recipes, bank, mail and alt
inventory, automatic buying, posting or crafting, paid price services, server schema changes. Auctionator and TSM
adapters follow historical official documentation (Auctionator v327 README, TSM archived 2022 API docs), are not
verified on Forever 1.60.1 (interface 16001) and report unavailable when absent. Their quotes have unknown age and
market scope. Website vendor profit stays unavailable without a verified sell price.

## Remaining minor findings

Carried from the task reviews for the owner's checks or later work; none was judged blocking:

- Native (Task 2): checking/unknown wording prefix; cold-cache reagent names until data loads; both-mode width at
  reduced scale; crafting page show/hide on real tab events; OpenRecipe guard structure.
- Destination (Task 3): permanently missing item data can stay "checking" while open; malformed price-day ages; text
  layout unobserved.
- Knowledge (Task 4): transient schematic overwrites, record/key mismatch, reread work, dropped professions retained.
- Routes (Task 5): real-size route performance and live recipe ID format; closed-profession wording.
- Plans (Task 6): local names saved independently of the roster option; Forget cleanup; same-item reply ambiguity after
  a timeout (the API has no query ID).
- Trainers (Task 7): tooltip redraw clears lines until re-hover; unconfirmed open-profession hint; tooltip spell versus
  recipe identity live; name-only legacy display dedup; header reason.
- History (Task 8): dense item frame cost and SavedVariables size; more than 500 items of interest; Details wording and
  zero counts; rare unloaded-scan frequency and server/local clock display drift.
- Sources (Task 9): per-plan-line provenance, privacy test coverage gaps, availability cache, checking notice,
  trainer/AH repaint, control widths.
- Website (Tasks 11–13): copy-after-count and stale-label test breadth; legacy name-level thresholds and unknown trainer
  IDs; duplicate-install test gap; capture-side age
  pruning not asserted directly; worst-recipe budget by catalog bytes; make toggles re-request without a cache.

The final whole-branch gate approved these limits for Alpha. Its Important guide/card market-link mismatch was fixed
in both directions, with regressions for canonical submission and preselection. The selected route now flags stale
intermediate prices even when typed stock covers the cash purchases. Remaining minor tradeoffs from its scoped
recheck: a stale quote used only in the secondary buy-all comparison has no separate stale marker; older display-name
guide links can still show the strict card's input notices, though newly written links are canonical; shared-slug
ambiguity fails closed but has no dedicated test. Activity links retain main's behavior and do not carry the market.

## Design rulings and tradeoffs

These choices resolve the implementation questions without claiming live evidence:

1. Bags are read only for a current preview and never saved. Manual lists retain additive counts; recipe plans store
   full requirements, and saving the same recipe replaces its count. If the intended workflow is cumulative, the
   player must raise that plan's count explicitly.
2. The initial calculator refactor retained the old page/scan split until the next task unified it. All final surfaces
   prefer a fresh same-house scan, then the price file. A newer scan can therefore change the page's old estimate.
3. Saved output metadata is usable for quantity, never proof the active character learned a recipe. Missing output
   now gives no sale estimate; this deliberately removes the old assumption of one output.
4. Native rows stay compact. The docked Everloot list exposes gold, margin and both directly. Both figures cannot be
   packed into every Blizzard row without risking overlap; details remain available in the panel.
5. Whole-batch costs drive routes. Shared needs aggregate before rounding; mixed buy/make is allowed, alternative
   recipes compete, and buying wins a tie. The bounded search may miss a globally cheaper combination.
6. Economic material value and route choice ignore owned stock; a second pass consumes stock once for cash needs.
   Leftovers are displayed, never credited as sale proceeds. A cash-minimizing route may differ from this valuation.
7. The 9,999 limit counts requested crafts; depth starts at zero. Limits and omitted purchase items produce incomplete
   plans rather than silently shortened lists. Recipe tags and ranking use one craft, while the selected plan uses
   its chosen count.
8. Matching-build client data with no recorded cooldown unlocks only a labelled assumption for covered recipes.
   Observed/recorded limits override it. A guarded current own-profession all-nil cooldown answer allows at most one
   limited craft; saved ready snapshots unlock none. A hidden server-side cooldown could still overstate a route.
9. Inventory coverage is bags only; other characters' plans show full needs without search. Bank, mail and alt stock
   are intentionally unavailable until their compatible APIs and complete observations are verified.
10. Website makes require explicit catalog allowances and never prove character knowledge. Strict links use decimal
    counts, reject duplicate fields independently and cap makes at 64, owned items at 128, owned counts at 1,000,000
    and encoded state at 8,192 characters. Unconventional or oversized input is refused rather than guessed.
11. A raw vendor offer cannot price the new recipe card. The existing leveling guide retains its separate legacy
    agreed-vendor-price policy; it has not been converted by this feature. The addon's new unit quotes require this
    character's latest single-unit, money-only observation on the current build within 14 days. Revisit merchants
    after updating; discounts and merchant differences can change the latest observed value.
12. Optional-source prices stay in memory with unknown age/scope; fallback needs an explicit switch. Own history
    admits completed full scans only, keeps the cheapest 200 levels with truncation and uses the prior seven UTC days
    after three samples. The even median is the floor of the mean of its two middle values; no depth is extrapolated.
13. Release 0.3.33 is explicitly Alpha, following the existing release guide while live checks remain unobserved.
    Version 0.3.32 belongs to another draft; this release does not include or claim its standalone cooldown tracker.
    A live-only defect may still appear despite automated/browser passes. No known reproduced regression is accepted.

Intermediate hashes above identify local implementation milestones. The public release receipt identifies the final
merged source and archive; the behavior contracts and this capability map are the durable acceptance record.
