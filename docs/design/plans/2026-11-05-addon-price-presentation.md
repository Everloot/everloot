# Addon price presentation implementation plan

**Goal:** Make existing item prices readable at a glance in the native tooltip and auction panel, with consistent Everloot styling.

**Approval:** Carlos said to proceed on November 5 after the tooltip-first proposal, using subagents and a review/fix loop. The proposal includes later disenchant data; this pass must not manufacture outcomes or prices.

**Architecture:** Keep the existing price readers, checksums, data bridge and action boundaries. Extend price-line presentation with optional left/right fields while retaining plain `text` for chat. Native tooltips use aligned double lines and native coin textures; auction lookup can consume the same presentation. Reuse existing native palette and fonts across touched surfaces. No new dependencies.

**Spec:** `docs/design/2026-11-05-addon-item-decisions-analysis.md`; accepted tooltip-first response in the current conversation.

## Constraints

- No copied competitor code, tables or art. No fabricated disenchant odds or placeholder values presented as real.
- Preserve realm/all-house scope, thin-market/missing/checksum/stale states and dates/reporters.
- No auction actions, record/schema changes, release tags, merges or production deployments in this pass.
- Keep `E.PriceLines(realm, itemId)` returning an array with plain `.text` and `.r/.g/.b`; add optional `.left` and `.right` for label/value rows. Existing text consumers remain functional.
- Native tooltip display must degrade safely if a stub or client lacks `AddDoubleLine`.
- Each worker owns only its assigned files, accommodates concurrent edits, and starts no further subagents.

## Tasks and verification

1. Tooltip worker owns `addon/modules/prices.lua` and price-related contracts. First write a meaningful failing test for observable label/value alignment, valid coin output, source/age labels and missing-data behavior. Preserve numerical agreement between chat and tooltip, and a single Everloot section. Add vendor value when the native item reader supplies it safely; do not imply successful auction proceeds. Run focused contracts to green and report exact commands/results.
2. Native surface worker owns `addon/modules/auctiontab.lua`, `addon/modules/options.lua`, `addon/modules/window.lua` and corresponding UI contracts. Align auction result values using the shared optional fields, retain fallback to plain text, improve compact hierarchy and consistent native palette without widening features. Preserve scanner/reload handlers, cooldowns, options scrolling and lazy/error-isolated Home behavior. First exercise behavior with focused failing tests, then run the owning contracts. No new broad styling framework.
3. Parent inspects combined diff and runs all addon contracts. An independent review checks scope, truth of prices, native API safety, stale/missing/long strings, layout, and test gaps. Parent fixes findings and repeats affected checks.
4. Verify packaging to a scratch candidate with source-byte comparison if the packaging CLI supports a scratch destination. Never overwrite an existing published archive under the same version. Record exact artifact and limits. Native rendering remains unverified unless tested in the real client.

## Review focus

- All-house community values must never appear as a live house quote.
- An uncached item or absent native vendor API must not error or become a zero vendor price.
- Narrow/long localized labels and expanded stale warnings must not collide with values or panel footer.
- Changes must not bypass tooltip secret-value guards or break price commands/drop rows.
- Aesthetic contracts and a packaged zip do not prove real-client appearance.
