# Dungeon Progress Implementation Plan

**Goal** Show the same tracked dungeon progress on Everloot profiles and player tooltips, with no pasted URL.

**Architecture** Keep the existing owner association and public boss-kill history. Use a shared, versioned set of tracked encounters. The web renders the summary and serves a realm-scoped snapshot of public clears, which Desktop writes as optional addon data. Collection renders local history using the same encounter set.

- [x] Suggest only eligible Armory profiles using the linked character's identity. Verify account isolation, ambiguous matches, removal, and legacy callers.
- [x] Count distinct bosses by instance across difficulties. Only count named, playable dungeons whose full known roster is supported by the shipped agreement snapshot. Verify SQL visibility, catalog parity, and unavailable versus zero.
- [x] Add the profile header and the equivalent in-game summary. Verify expired data, exact realm and full name, and no duplicate tooltip rows.
- [x] Exercise the API, Desktop snapshot and Lua rendering with fixture data.
- [ ] Verify a real linked kill after Desktop sync and reload on a second player's install.

The approved scope covers public dungeon summaries. Publishing named group performance and scoring role-specific gear require their own validation and decisions.

## Follow-on checks

- **Dungeon coverage.** The November 22 agreement snapshot covers the full known lists for Shadowfang Keep, Wailing Caverns, Razorfen Kraul, Scarlet Monastery, and Ragefire Chasm. Confirm additional encounter sets in Forever before counting them. A partially supported list remains browsable.
- **Gear pilot.** Start with Warrior dungeon tanking on the website. Validate armor, stamina, shield block, set bonuses and any relevant effects against actual Forever tooltips. The item extract has slot, requirements and stat kinds, while some stat amounts need an independently verified observation. Compare two usable loadouts and show the tradeoff before assigning any score.
- **Runs and performance.** The existing addon's run and pull records already share a run ID. Verify cross-install deduplication and accept only explicitly published performance fields under the separate display policy. Keep the tooltip focused on clears.

## Release verification

Apply the database migration before releasing the web routes. Enable `EVERLOOT_DUNGEON_PROGRESS` for acceptance and ship the matching Desktop and addon builds together. On the first run the optional Everloot Progress addon may require a full game restart. Have one linked player clear a tracked dungeon, then compare Collection and the public Armory profile. Refresh a second player's Desktop snapshot, reload, and verify the tooltip count and size. Hide the test profile and confirm it drops from the next snapshot. A downloaded summary currently on screen is refreshed or expires within two hours.
