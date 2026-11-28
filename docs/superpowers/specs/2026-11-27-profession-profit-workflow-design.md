# Profession profit workflow

Date: 2026-11-27. Status: approved by Carlos ("siybds good") in this thread.

## Intent

Bring the crafting conveniences Carlos identified in CraftProfit into Everloot, implemented independently using Everloot's data and UI. A player should be able to find a promising learned recipe, understand its costs, choose whether to buy or make its reagents, and prepare a shopping list from the profession window.

"Better" means actionable quantities, visible evidence and a consistent calculation across Everloot's native display and crafting comparison page. Feature descriptions are requirements references, not permission to copy another addon's code or artwork.

References inspected November 26–27:

- https://www.curseforge.com/wow/addons/craftprofit-forever
- https://github.com/Vystery/CraftProfit (README only as product documentation)
- Carlos's tailoring screenshot. Its Facebook post could not be retrieved.

## Existing foundations

- `addon/modules/native_crafting.lua` reads the selected native schematic, displays cost/profit, refreshes after a scan and explains reagent quotes in Details.
- `addon/modules/view_professions.lua` owns the current evaluator, price selection, profit-ranked comparison page, profitable-only filter, craft counts and shopping handoff.
- `addon/modules/shopping.lua` maintains lists, merges reagent quantities, reports list limits and performs player-triggered AH searches.
- `addon/modules/professions.lua` records recipe IDs, learned flags, output ranges and trainer spell/item identities. Existing saved recipe observations are install-wide and do not prove that the current character learned a recipe.
- `addon/modules/auctions.lua` already computes a unit-weighted cheapest-quarter asking-price value. Persistent scan summaries contain counts, minimum and market value, not the full listing ladder.
- Current native pricing prefers a recent same-house scan, then community quotes per item, and observed cheaper vendor purchase prices. Missing prices remain unknown.

## Approaches

1. **Extend Everloot's shared calculator and native UI — recommended.** Reuse lists, scans and quote provenance; make the existing comparison page and native display agree. Requires careful integration with recycled Blizzard recipe rows.
2. Separate crafting addon. Smaller independent UI surface, but duplicates settings, scanning, price selection and release work.
3. Website-only planner. Easier cross-character browsing, but misses the in-game decision Carlos highlighted.

Approved choice: approach 1, extending Everloot's shared calculator and native UI.

## Player experience

Keep Blizzard's profession appearance and controls. Add compact signed profit tags to visible recipe rows, with money/margin/both modes. Recycled rows must clear their tags when rebound. Native categories, filters and selection remain intact.

Offer profit sorting and a profitable-only view. If the supported client cannot safely sort native categories, use an Everloot comparison panel attached to the profession window, explicitly labeled, with recipe selection opening the native schematic. Do not mutate undocumented Blizzard internals to force sorting.

Selected recipe summary:

```text
Est. profit per craft  +1g 20s (18%)
Materials  6g 40s       Sell via [AH | Vendor]
Reagents   [Buy | Cheapest available]
[1 craft -/+] [Add materials] [Details]
```

The labels and dimensions are illustrative. Keep reagent slots, Track Recipe and Create controls accessible at reduced UI scale. A compact details panel may dock beside the native window when space is insufficient. Text/signs convey status alongside color.

## Capability scope and delivery order

### 1. Consistent prices and recipe comparison

Extract the existing evaluator only as needed to share it between native rows, selected recipe, comparison page and trainer estimates. Keep one quote policy and calculation. Add native recipe tags, money/margin modes, profit sorting and profitable-only filtering. A missing input is unpriced, never zero. Margin means net profit divided by materials cost; it is unavailable for zero/unknown cost. Sorting uses profit per craft; ties use stable name then recipe ID. Filters exclude unknown profit.

Show reagent unit and required-quantity totals, auction cut, expected output range and quote source/age in Details. Stale estimates remain visibly stale in both row and detail views. Default quote mode keeps Everloot's current same-house scan/community policy. Optional Auctionator and TSM adapters follow the core workflow in a separate integration slice, contingent on documented public APIs for the supported client; they are explicit choices, never silent overrides. An unavailable selected source produces an explanation and explicit fallback choice.

External-addon quotes are runtime-local valuation inputs only. They never enter public observations, uploaded records, community rollups, or Everloot's own-scan history/cache. Every calculated result retains its quote source. Local 14-day history and depth values below are built only from Everloot's own scans. No source-selected estimate is itself uploaded. Existing public price and observation contracts remain unchanged.

### 2. AH versus vendor and buy versus craft

AH mode subtracts the actual house cut from estimated output value. Vendor mode uses a verified output sell price, not the vendor's purchase price. Show both comparisons in Details and let the selected destination drive tags and sorting. No verified vendor sell price means vendor profit unavailable.

Default reagent strategy is Buy, preserving current behavior. Cheapest available compares market/vendor purchasing with recipes proven learned by the current character. Record local character-scoped recipe knowledge without changing public observation identity. Old install-wide records alone do not unlock a craft route. Cross-character crafting is outside this batch; local scan sharing on the same realm/house remains supported.

Resolve crafting chains by item and recipe ID, never localized name alone. Prevent cycles, bound traversal and reject unknown/ambiguous routes. Account for whole crafts and output quantities: needing three bolts from a two-bolt recipe requires two crafts, with one leftover shown. Variable yields use the guaranteed minimum for material fulfillment and expose the range; expected sale revenue may use the displayed average. Do not double-count shared ingredients or leftover output across a multi-recipe shopping plan. Exclude a cooldown-limited craft as a cheaper reagent route until its availability can be verified; explain the exclusion.

Show the chosen chain with buy/make decisions and batch sizes. Costs include the materials consumed to produce leftovers; do not assume the leftovers sell. Owned materials still have acquisition/opportunity value in profit estimates, even when they reduce the shopping shortfall.

### 3. Shopping from the native profession window

Use the selected craft count to preview an aggregated materials plan, then add its leaf purchases to the existing shopping list. Include a visible make-order for intermediate reagents. Keep items without prices visible; reject unresolved item identities with an explicit partial-result receipt. Preserve existing list limits and per-item price caps.

Use a new local character-scoped recipe-plan store alongside existing manual lists; leave legacy manual `want` counts and additive edits unchanged. A recipe-plan entry is keyed by character, profession and recipe ID and stores the requested craft count and full material requirement, not a frozen shortfall. Adding that same recipe again replaces its plan/count after an explicit preview; different recipe plans aggregate. Clearing a plan removes only its contribution. Manual lists and recipe plans are separate selectable search sources, never implicitly merged or netted against each other.

Compute a recipe plan's shortfall from the owning current character's fresh bag inventory whenever shown or searched, consuming each owned item once across the combined plan and intermediate make steps. A plan owned by another character can be viewed as a full requirement but cannot use the active character's inventory or start searches until deliberately copied into a new plan for that character. Missing inventory APIs show full needs with an inventory-unavailable label. Only include bank inventory when the client provides trustworthy counts and state its coverage; do not imply mail or alt inventory is available without verified APIs. This additive plan store avoids changing the meaning of legacy manual lists. Add a player-triggered Search needed action that respects AH throttling and existing scan/search exclusion. No automatic buying, posting or crafting.

### 4. Trainer guidance

For a trainer service with a verified recipe spell ID and complete schematic, show estimated profit and how many profitable crafts repay training cost: ceiling(training cost / positive net profit per craft). Missing identity/materials/prices or nonpositive profit produces no payback claim. Never equate a product item ID with a recipe spell ID or join by name. Integrate this with Everloot's existing ranks/trainers view as well as the supported native trainer rows.

### 5. Market context and practical safeguards

Reuse the cheapest-quarter scan value, local listing history and existing community history before adding another statistic. Persist a bounded local 14-day series per realm/house/item for scanned learned-recipe inputs/outputs; show a seven-prior-day median only after at least three observed days. Show today's change versus that baseline and a selected reagent's break-even unit price when the other costs are known. Explain history gaps.

Current summaries cannot answer the purchase cost of a large batch at available depth. Add a bounded local listing ladder from existing full-scan data, separate from uploaded records, scoped to realm/house/scan time. Walk quantities for batch purchase quotes and show insufficient depth explicitly. Limits and pruning are builder choices, measured against a realistic large scan before release. No server schema or intake changes are needed for this local cache. Minimum-buyout and market-basis choices remain labeled; neither is a confirmed sale price.

Market-wide sold/day cannot be derived reliably from disappearing listings. Show listed units and listing changes instead. Any future sales-rate provider must have its own named source, age and estimate label. Confirmed personal sales require stable item identity and actual receipt evidence; the currently blocked payout identity work is not silently included.

All new helpers and decorations obey existing recorder-only mode. When CraftProfit is detected, default Everloot's native recipe/trainer decorations and docked helper off, explain why and offer an explicit per-character override. Preserve its data collection and separate crafting view; do not disable other addons. Existing explicit preferences win over detection defaults. Scope caches and saved preferences to the correct character/realm/house and clear pending work when the window closes or context changes.

## Verification and completion

Each slice starts with failing behavior coverage, then focused checks and the relevant existing Lua contracts. Required examples: recycled recipe rows; selection after sorting/filtering; zero and missing quotes; stale and cross-house quotes; vendor buy/sell distinction; multi-output rounding; variable yields; cycles; unlearned/alt routes; shared ingredients; inventory counted once; list full/partial receipt; trainer identities; depth shortfall; missing baseline days; late AH responses after context switch; optional-source absence.

Read the exact supported Forever UI/API source before implementing hooks or adapters. API feasibility can change the attachment technique, not permit unsupported identity or data assumptions. Run required addon packaging/classification checks for a release candidate and preserve the existing released ZIP. No broad web/Desktop rewrite or dependency install is implied.

Live acceptance uses the exact candidate archive: tailoring chains and bags, a vendor reagent/output, a variable-yield recipe, a missing-price item, profit sort/filter and recipe switching, a multi-craft shopping plan, a trainer, a fresh same-house scan and reduced UI scale. Check coexistence with CraftProfit/Auctionator/TSM where available. Automated checks do not replace this acceptance.

This design approval authorizes implementation and review, not publication. Existing exact-archive release acceptance requirements remain. Deliver slices as independently reviewable changes; capability completion is tracked explicitly, and a partial slice is never reported as the full workflow.

Subsequent explicit authorization: Carlos asked to evaluate the finished work and deploy the fully new version to CurseForge, providing an update as soon as possible. Publication through the existing protected PR/tag workflow is now authorized after implementation, independent review, required checks and exact-archive live acceptance. Verify GitHub/website/CurseForge delivery and the existing automatic Discord announcement. Do not publish an unfinished subset as the completed workflow.

## Builder decisions and exclusions

The builder selects module boundaries, supported hook details, cache limits and UI dimensions from the current client source. Preserve the existing native appearance; no visual redesign is proposed. No competitor code/assets, paid data service, unverified sold/day number, server migration, cross-character crafting execution or replacement auction addon is part of this work.

## Design review

Read-only builder check completed November 27. Resolved shopping ownership/idempotency with a separate character recipe-plan store, retained legacy manual-list semantics, restricted external-addon valuations to runtime-local use, moved optional adapters after core delivery, and specified recorder-only/coexistence defaults. Carlos approved this design in the following turn. No product implementation or live validation has occurred.

## Approved scope extension: in-game and website

During execution Carlos requested the same logic inside the game and on the website, emphasizing not needing to leave WoW. Native crafting remains the primary in-game journey. Extend the existing website profession/recipe tools as a companion planning and sharing surface, preserving their look and current links.

- Both surfaces use equivalent valuation, destination, quantity/yield and buy-versus-craft arithmetic. Shared language-neutral fixtures prove conformance; do not embed a Lua runtime in the website or call the website on every in-game refresh.
- Website ranking, recipe breakdown and shopping controls must use the same selected realm/house and explain price dates/missing quotes. Destination/strategy/craft count are linkable for sharing.
- The website uses its existing public game catalog and community price API. A catalog crafting route is a hypothetical plan, not proof the player's character learned it; label required recipes. Do not upload addon local inventory, plans, external addon prices or raw depth ladders to simulate parity.
- For website inventory shortfalls, accept explicit per-plan user quantities in the browser; do not invent live bag access. Owned materials reduce purchases, not economic input valuation.
- Show vendor return, trainer payback and market context only when current verified source data supports the same claim as the addon; unsupported values remain unavailable with a reason.
- Scope existing profession tools and reuse current market history/quotes. No new navigation hub, website redesign, paid service, automatic live deployment, account integration or server migration.
- Validate equivalent examples through both implementations and exercise website controls through existing rendering tests, plus browser interaction when the shared browser becomes available. Record runtime UI access failures separately from logic-test outcomes.
