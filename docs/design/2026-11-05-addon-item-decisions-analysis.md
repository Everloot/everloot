# Everloot item decisions and visual quality: reel analysis

Date: 2026-11-05. Status: analysis and proposed implementation sequence; no runtime changes.
Code examined: `5071aec0` (also origin/main at capture). Native-client appearance has not been tested in this session.

Later the same day, Carlos approved the tooltip-first implementation. That pass is now implemented locally; see [verification and remaining acceptance](2026-11-05-addon-price-verification.md). The analysis below remains the original research record, including the still-unimplemented disenchant outcome work.

## Source and evidence

[Lorumerth: To DE Greens or Sell Them](https://www.facebook.com/reel/971876555802599/), published November 5, captured November 5. Duration 73.77 seconds. Full source downloaded through the existing video-ingest pipeline. English subtitles available; metadata reports `transcript_source: subtitles`, `subtitle_file: source.en_US.srt`, `transcript_errors: []`. Reviewed captions and frames at the opening, 25 seconds and 45 seconds. Automated summary wording is unreliable; captions and frames are the evidence.

Raw source, captions, metadata and frames stay outside Git in the video-research-ingest corpus under `output/20261105-175021-https-www-facebook-com-reel-971876555802599/`. The reel does not establish the identity of the tooltip addon. Do not attribute it to TSM, Auctioneer or another product without evidence.

Source digest:

- 00:00–00:26: compare selling an uncommon item to a vendor, listing it, and disenchanting it. The armor tooltip shows material icons, outcome probabilities, quantity ranges, material unit prices and an aggregate disenchant value.
- 00:26–00:41: creator suggests trying an auction, possibly relisting, then disenchanting if it remains unsold. This is his heuristic, not a validated optimum.
- 00:41–00:52: a weapon example reverses the displayed relative likelihood of dust and essence. The creator generalizes by weapon versus armor. The clip cannot validate that rule across all items or Forever builds.
- The remaining section is channel promotion, with no additional addon requirement.

The prices and percentages in the recording are examples from that player's interface. They are neither current Everloot prices nor verified Forever outcome tables.

## Product conclusion

Build a compact item decision tooltip, supported by independently observed Forever disenchant outcomes. Improve the rest of the native addon using the same hierarchy and visual primitives. The useful feature is answering what to do with an item where the player already inspects it.

Confirmed intent from Carlos: include this kind of logic and substantially improve the addon's visual quality. Observed reference: compact dark tooltip, material icons, quality-colored names, probabilities and quantities beside outcomes, aligned coin values. Inferred design direction: a sharp native WoW utility with Everloot's existing warm dark palette, cream text and restrained fel green. Proposed variance/motion/density: 3/1/7. These dials are a proposal, not an approved redesign.

Do not copy the reference's art, data or implementation. The existing toolkit spec requires a clean-room implementation and keeps auction actions read-only.

## What the code already supplies

| Requirement | Current evidence | Remaining work |
|---|---|---|
| Community and own-scan prices | `addon/modules/prices.lua`: `CommunityPrice`, `OwnScan`, `PriceLines` | Present as compact labeled rows; retain provenance and missing/stale states. |
| Vendor value | `addon/modules/gph.lua`: vendor fallback; existing item-info access | Reuse the item sell-price reader in the comparison; handle uncached and unsellable items. |
| Disenchant capture | `addon/modules/openworld.lua`: spell/item correlation, typed `disenchant` records and `sourceItemId`; `addon/tests/loot_types_contract.py` | Prove actual Forever capture, attribution and deduplication before valuing outcomes. Automated contract coverage is not a live-client proof. |
| Disenchant outcome rollup | `kb/src/drop-rollup.ts` deliberately excludes disenchant windows from kill/gather rates | Separate rollup with the correct denominator and quantity distribution. |
| Game-file classification | `kb/src/client-coverage.ts` lists `ItemDisenchantLoot` class/subclass/quality fields | Investigate classification and eligibility only; this declaration does not establish captured probabilities or material yields. |
| Local data bridge | Existing checksummed `EverlootPrices` file | Extend its versioned payload and reader for outcome summaries, preserving old-file compatibility and bounds. |
| Main native window | `addon/modules/window.lua`: palette, crest, native fonts, sidebar | Carry one native visual system into Options, AH and tooltips. |

This continues the planned post-launch disenchant-value work in `specs/2026-10-23-addon-toolkit-design.md`; it is not a new product module. The October 21 loot-table spec remains the authority for public evidence and pooling.

## Decision logic

Keep three different kinds of value distinct:

1. **Vendor:** guaranteed sell value when the item is sellable, per item. Show stack total only when the inspected context supplies stack quantity.
2. **Auction:** an asking-price estimate with realm, house scope, source and age. Deduct the applicable house cut when estimating successful-sale proceeds. Explain deposit exposure separately: a returned deposit is not a successful-sale cost, while a failed/cancelled listing may forfeit it.
3. **Disenchant:** expected material value derived from observed outcomes and matching material prices. It is a distribution, not the next result the player will receive. If materials will be auctioned, label gross material value versus estimated proceeds after sale costs consistently with the item comparison.

For independently observed disenchants, expected gross value is:

`sum over materials(material units across all eligible windows / eligible disenchant windows * material unit price)`

This includes zero occurrences of each material in the denominator and does not assume quantities within a min/max range are equally likely. Alternatively display material occurrence frequency and conditional mean quantity; their product must equal unconditional mean quantity. A range is a range, not a mean.

Use complete, correctly attributed disenchant events only. Preserve build/ruleset and item identity; deduplicate repeated loot events and reuploads. Do not mix ordinary loot, opened containers or failed casts into this denominator. Record windows, distinct contributing installs and dates. A three-install gate is the existing public minimum, not evidence that a tiny sample gives precise odds. Pooling different items by class/level needs its own evidence under the shared-table policy; weapon/armor alone is insufficient.

If any material price, outcome model, house scope or item eligibility is missing, explain the limit. Missing data is not zero. Current community files combine all houses: they cannot silently become house-specific sale advice. A new per-house payload must follow the already separate market design work.

Suggested output wording: “Auction estimate is higher” or “Disenchant estimate is higher,” with reason and data state. Use “Not enough data to compare” when appropriate. Do not promise a sale or profit. Check binding, disenchant eligibility and the character's ability before presenting an actionable suggestion. Unknown ability remains unknown. No automatic selling, posting or disenchanting is introduced.

The reel's relist heuristic should not become a default timer or “two failed auctions” rule. A later relist recommendation needs actual expiration history, fees and evidence about sale likelihood. The cross-alt ledger and its privacy decision remain separate work.

## Native visual direction

The current price tooltip joins market, minimum, historical, per-unit and all-house scope into one sentence, followed by multiple metadata sentences. `prices.lua` renders these with `AddLine`. This makes comparison harder than the reel's aligned rows.

Home uses explicit warm-dark colors and custom native text helpers. Options and AH still use stock dialog backgrounds and independent font templates. This is a concrete consistency gap; it is not proof that every native screen has a rendering bug.

Proposed tooltip hierarchy:

- Preserve the game's item header and stats.
- One small Everloot heading and separator.
- Label/value rows for Vendor, Auction estimate and Disenchant estimate; right-align coin values using native tooltip double columns. Keep coin units explicit.
- Under the disenchant row, one row per supported material: native item icon, localized material name, observed occurrence frequency, quantity summary. Full denominator and evidence status must remain available in the tooltip; do not hide the facts that determine trust.
- One concise comparison sentence. Do not use green as a substitute for the sentence's meaning.
- Compact provenance rows for realm/house scope, price source and age, outcome windows/installs and dates. Show warnings adjacent to the affected estimate.
- Missing-file, checksum, stale, thin-market, missing-material and unconfirmed-outcome states are designed states, not debug paragraphs.

Use native item and coin icons; keep Everloot's crest modest and its fel green for identity/primary emphasis. Retain game quality colors. Use a restrained hierarchy of native readable fonts, consistent insets and row spacing. Match borders and label/value alignment across Home, Options and AH. Reuse native font assets rather than importing website typography into the addon.

“Sharper” must be verified at actual UI scales. Align lines and icons to effective pixel coordinates, avoid stretched low-resolution textures and excessive shadows, and test readable text at normal game viewing distance. The source is a compressed 720px portrait video; it does not justify exact font-size or pixel measurements. No full bag replacement is needed; the toolkit spec explicitly leaves that out.

## Implementation order and acceptance

1. **Tooltip layout first:** separate presentation from the existing price facts without changing their meaning. Verify command/tooltip numerical agreement, missing/checksum/stale/thin states, house labels, no duplicate headers and long/localized names. View in the actual Forever client before claiming improved visual quality.
2. **Prove disenchant capture and add its rollup:** real item-to-material capture, no duplicate denominator on reupload, variable quantity, multiple materials and no ordinary-loot contamination. Public outcomes obey existing evidence rules; sparse data stays labeled unconfirmed. Use meaningful tests with known independent event fixtures.
3. **Ship the data bridge and decision reader:** backward-compatible bounded payload, integrity check, uncached item handling, material availability, gross/net consistency, no invented sale probability. Test a higher vendor value, higher auction estimate, higher disenchant estimate, tie, stale prices, missing material, bound item and unknown eligibility. Preserve all auction-action guards.
4. **Unify native surfaces:** Home, Options, AH and prompts use the same native palette, text hierarchy, buttons, spacing and state language. Verify short viewports, scrolling, 100/125/150% UI scale and both English and Spanish. Record screenshots and native errors, not just contract-test success.

No runtime code, package, release tag, PR or deployment was changed for this analysis. No native-addon appearance, live capture or current market improvement is claimed. No separate learning/playbook entry is needed: the feature is already planned; this adds a source and a concrete visual/decision brief.
