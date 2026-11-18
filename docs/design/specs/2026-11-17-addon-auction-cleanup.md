# Auction house and settings cleanup

Approved scope: the 2026-11-17 request to apply the discussed Auctionator-inspired cleanup.

- One Everloot tab beside the game's auction tabs, containing the existing scan, price lookup and shopping lists. Keep a single fallback scan button only if the panel cannot be built.
- A scan starts only on a player's click. Show Scan prices, Scanning... or Ready in M:SS on the scan button; disable it while busy or cooling down. Keep last-scan age and saved-file status visible.
- Remove the recurring floating scan prompt. Use the existing once-per-install chat introduction; keep its setting and slash command compatible with saved preferences. Put the scan explanation in the tab.
- Native WoW fonts, gold headings and standard buttons/check boxes on AH and settings surfaces. Do not restyle the main Everloot window.
- Settings pages: General, Tooltips, Auction House, Helpers, Data Sharing. Retain every current switch, saved preference, recording boundary and deletion behavior. Data Sharing includes the existing character/local settings with descriptions that preserve their actual privacy scope.
- Support modern Settings subcategories and older Interface Options child categories. Keep all controls reachable in the standalone fallback.
- No posting, buying, cancellation, automatic scans, new dependencies or release/version changes.

Verification: Lua 5.1 contracts for tab attachment and failure paths, first-use introduction, scan state transitions, settings routing on both client APIs, and the full addon suite. A live client check remains necessary before publication.
