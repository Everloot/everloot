# Auction house cleanup: in-game acceptance

Status: implementation and automated contracts only; no live-client acceptance or release claimed.

Use a test build containing this change. Back up the installed Everloot folder before replacing it; preserve SavedVariables.

1. Open an auction house. Expect **Everloot** after Buy / Sell / Auctions, no floating prompt and no separate scan button when the tab works.
2. Select Everloot. Expect native fonts and a gold heading, one **Scan prices** action, price lookup and the existing Shopping list switch.
3. Click Scan prices once. Expect **Scanning...**, disabled while busy; keep the house open until completion. Then expect **Ready in M:SS**, last-scan age and saved-file status. Reopening the house must not scan or show another popup.
4. Look up an item by name/id and shift-click an item into the focused lookup. Check long warnings and values remain inside the scrolling area. Open Shopping list and search one item; no purchase is made.
5. From Everloot, click the already-selected native tab directly, then test Buy, Sell and Auctions in turn. Each must hide the Everloot panel and work normally. Close/reopen the AH and repeat.
6. Open Esc > Options > AddOns > Everloot (or `/everloot options`). Expect General, Tooltips, Auction House, Helpers and Data Sharing under Everloot. Check each page and scroll to its last control. Expect merchant/mail controls in Helpers and all four tooltip controls in Tooltips.
7. Open Settings inside the main Everloot window: its branded crest, green heading and fonts should be retained. Change a tooltip preference and a non-destructive display preference, reload, and confirm the choices persist. Do not turn off data-recording switches merely for this check: some intentionally delete their recorded rows after confirmation.
8. If the tab cannot build, expect exactly one fallback Scan prices action. The failure is available through `/dump Everloot.AuctionTab.failureReason`; record it with the client build and installed addon version.

After these checks pass, include the changes in the next addon release. Do not mark the release as verified from automated tests alone.

Retest after the live feedback correction: Everloot shares the native tab baseline/height, and only the active tab looks selected. Expect one compact scan toolbar, one last-scan summary without a repeated cooldown, Search beside item lookup, and optional scan explanation on the question-mark hover. Save scan is in the footer, disabled for a scan already saved; it reloads rather than uploading. Check narrow layouts, Shopping list/back navigation and native Buy/Sell/Auctions return. Previous screenshots do not accept this corrected build.

Gold-frame acceptance (#1343): after installing the combined candidate and reloading, open the Everloot window at normal scale. Check the crest at the top-left gold corner, close button, first and last sidebar buttons, and resize grip: all must be visible and usable without overlapping the thicker border. Resize the window and repeat each check, then right-click the grip to reset. Capture both scales. Settings and the raid panel retain their bronze edge. These checks are not run until observed in-game.

Gathering skill acceptance (#1361): install the combined candidate and reload first. Record the profession book's rank and any displayed race/gear bonus for Herbalism, Mining and Skinning. Gather one herb, mine one ore node and skin one creature with a character holding each applicable profession (use other characters if needed). For each action inspect the newest matching `loot` row in `EverlootDB.records`, identify its gathering kind, and compare `gatherSkill` with that profession's rank plus bonus. If the action increases the profession rank, use the book value at that action and record the timing. Keep the three results separate; missing access to a profession or action is not run, not a pass. This verifies the eighth `GetProfessionInfo` result (`rankModifier`) is included; automated contracts do not replace the live checks.
