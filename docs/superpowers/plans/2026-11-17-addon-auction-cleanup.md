# Auction House Cleanup Implementation Plan

> **For agentic workers:** Execute task by task in the current worktree, following failing-test, implementation and verification steps.

**Goal:** Consolidate AH scanning and organize native settings using the approved reference direction.

**Architecture:** Preserve the existing auction panel and settings row model. Fix compatible attachment and failure handling locally, reuse scan readiness for both scan controls, and register the same settings groups on both game APIs.

**Tech Stack:** WoW Lua 5.1; Python contracts using lupa.

**Spec:** docs/design/specs/2026-11-17-addon-auction-cleanup.md

## Global Constraints

- Scanning requires a player click; the 15-minute cooldown and upload/consent behavior remain intact.
- Preserve saved preferences and every existing switch. No new dependencies or release tags.
- Native styling changes are confined to AH and settings surfaces.

## Review Focus

- The native auto-registering tab template must place Everloot after the final native tab and hide its panel when native tabs are selected.
- A rejected template or failed panel must leave one working action and a useful diagnostic.
- New visits, reloads and cooldown completion must never resurrect a floating prompt or start a scan.
- Busy/cooldown transitions must update the button and retain saved-file status.
- A refused settings child must leave all switches reachable through the standalone fallback.

## Tasks

1. AH attachment and scan controls (`addon/modules/auctiontab.lua`, `addon/modules/auctions.lua`, `addon/tests/auction_tab_contract.py`, `addon/tests/scan_prompt_contract.py`).
   - [x] Reproduce attachment compatibility and write failing behavior checks.
   - [x] Apply the minimal attachment fix, consolidate introduction, add scan button state and native styling.
   - [x] Run AH and shopping contracts.
2. Settings (`addon/modules/options.lua`, `addon/tests/options_contract.py`).
   - [x] Write failing tests for the five groups and legacy child categories.
   - [x] Regroup existing rows and register child categories with native headings/fonts.
   - [x] Run settings contracts, including fallback and saved preferences.
3. Closeout (`addon/README.md`, shared Everloot status).
   - [x] Update the behavior documentation and in-game checklist.
   - [x] Run all addon and planner contracts; inspect the diff.
   - [x] Record verification and remaining live-client check.

## Verification

50 addon contract suites and both connected-planner contracts pass on Lua 5.1. Native template auto-registration was reproduced as a failing regression before the fix. Live acceptance remains open; use docs/2026-11-17-auction-ui-checklist.md. No game install or release was performed.

## Merge review fixes

- Preserve branded typography, crest and surface for Settings embedded in the main window; native Options pages use native styling. A separate embedded-settings contract covers the boundary.
- Permit a real click on the currently selected native AH tab while the Everloot overlay is open. Restore its disabled state only if it is still selected; independently disabled tabs remain disabled.
- Treat either saved introduction flag as an already-introduced install, including when auction recording changes later.
- All three findings have regression coverage; full addon suite rerun before publication.
