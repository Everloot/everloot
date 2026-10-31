# Addon capture and Home window acceptance

Prepared 2026-10-31. **Status: NOT RUN IN GAME.** This is a focused addon checklist; the launch,
authentication, native app and upload acceptance runs retain their own owners and checklists.

## Before the run

- Record the addon version, game build, realm type, UI scale and date. Do not equate a Retail check with a
  Forever pass. On this machine the installed executable was Forever 1.60.1.70634; no Retail executable
  or running game was found during preparation.
- Keep the Desktop App/companion's automatic upload paused for this local collection check. Do not upload
  the test file until reviewing the collection/sharing preview with the upload-acceptance owner.
- Preserve the existing addon and its SavedVariables before installing a candidate. Never delete `WTF`.
  A public Alpha and a local candidate must be clearly distinguished in the evidence.
- Start with the released 0.3.14 Alpha to establish the Home window baseline. The capture fixes in the
  follow-up PR require their own candidate build and the checks below before being called verified.

## Home window and capture

| Check | Action | Pass evidence |
|---|---|---|
| UI-01 | `/everloot status`, then click the minimap icon and try `/everloot window` | Window opens/closes; status names the tested version; no Lua error |
| UI-02 | Inspect Home at the usual UI scale, then at a second scale | Crest and bronze border load; fonts are readable; character, ledger, professions and counters fit without overlap |
| UI-03 | Drag the window, close it, reopen it and press Escape | Drag works, controls remain reachable, Escape closes it |
| UI-04 | Inspect gold against the game display. Start a gold-per-hour session, Pause and Resume | Gold agrees; time stops while paused and resumes; no invented rate before a session exists |
| UI-05 | Open a profession window, then Home | Names and ranks agree with the profession book; unused rows are hidden; unavailable values show a dash |
| UI-06 | Open one populated and one unpopulated item tooltip | One Everloot header, intact existing price/drop text; no unsupported value invented for missing data |
| UI-07 | Turn **Everloot window** off in Settings, reload and use the minimap icon | The previous panel opens; recording still works. Restore the starting setting afterwards |
| UI-08 | Loot one ordinary creature, visit a vendor and complete a quest when available | Status counts increase as appropriate; no error prevents the next capture. Do not enable optional helpers just to pass this check |

## Recipe candidate checks

Use a profession with at least two known recipes and one visible unlearned recipe, if available.

1. Record the profession rank and the recipe list/filter state. Open the profession window and wait for
   capture to finish. Copy the saved file privately after `/reload` or logout.
2. Confirm observed recipes carry the API's recipe identifier, not a guessed spell identifier. Learned
   `true`/`false` must agree with the profession window; unavailable state must remain absent.
3. Hide a recipe with the profession search/filter and repeat. An available unfiltered API should still
   capture it without changing the player's filters. If only the filtered API exists, record that limit.
4. Reopen unchanged: no duplicate recipe/rank/difficulty/learned observation. Learn a recipe, or gain a
   rank that changes a recipe's colour, and repeat: the changed observation must be captured.
5. Close the profession window during a chunked read: pending work must stop. Reopen and confirm capture
   still works. A recipe the character has not learned must not become an inferred craftable step.

These anonymous recipe observations do not establish a linked character's private learned-recipe list.

## Auction candidate checks

Only start scans through the player's click or `/everloot scan` at an open auction house. Keep other
auction addons from issuing searches during the fallback check; record any interference encountered.

1. Normal replication path: verify the existing full scan, skipped/unloaded diagnostics and saved snapshot.
2. Replication-unavailable/timeout path: confirm the explicit **partial** fallback message. Record the
   observed API and timing; never force a live failure through game-file edits. If a real timeout cannot be
   reached, mark this live check UNVERIFIED; the simulated timeout test is separate evidence.
3. Inspect the partial rows privately: actual listing item IDs, unit asking prices and quantities, no
   sellers and no invented full-market snapshot or listing distribution from browse summary prices.
4. Close the auction house midway: queries stop and late results cannot revive a cancelled scan. Disable
   auctions and repeat: no new rows or queries. Restore the starting setting afterwards.
5. Check cooldown and empty-result behavior against the candidate's documented bounds. Record throttle or
   API errors. Do not repeatedly trigger searches to discover the server's rate limit.

## Screenshots for the listing

Capture actual game rendering with the game's screenshot key (normally Print Screen). Keep original files
and note their build, addon version and UI scale. Review chat, other players' names and unrelated overlays
before selecting a public image. Do not replace these with HTML mockups or stub-renderer images.

- **Home:** crest, character panel, gold/session controls and profession bars at a readable scale.
- **Tooltip:** one item with the Everloot header and real price/drop evidence, including its caveats.
- **Auction tab:** the normal scan result or clearly labelled partial result, with no seller data exposed.

Only publish screenshots for checks that actually passed on the stated client/version. A Retail image must
say Retail; it is preliminary UI evidence, not proof of Forever capture compatibility.

## Result record

For each check record `PASS`, `FAIL`, `UNAVAILABLE` or `UNVERIFIED`, the exact version/build and an evidence
filename. Include the first error and the command/action that caused it. Unperformed checks remain
UNVERIFIED. Public evidence must not include a raw SavedVariables file, tokens or a desktop-upload preview
containing private player information.
