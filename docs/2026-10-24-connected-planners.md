# Connected planners

Players can create a talent or raid plan on the website and paste its share code into the addon.
The existing talent comparison stays intact. Raid imports compare class counts per group, ignoring
slot order within each group. Names are not part of raid codes, and other players' talent choices
cannot be verified. Build mismatches remain visible.

## Interface

A single native Lua window, created only when opened, with Talents and Raid tabs, one import field,
readable results, and explicit refresh, clear and copy controls. Charcoal surfaces, a green
selection indicator and quiet separators follow Everloot's palette. No browser, added library,
animation or continuous update loop. The minimap opens this workspace; right-click opens settings.
Existing commands and the talent-window guide remain available.

Website copy controls export the active talent set or raid code, with short instructions to open
the addon and import it. Empty talent builds cannot be exported. Existing share links remain.

## Verification

Run malformed-code and round-trip tests, group comparison tests, saved-plan recovery and UI action
contracts. Run existing addon contracts and focused website tests/typecheck. Inspect a labelled
interface preview; actual in-game layout and client behavior still require a running Forever client.
Prepare a reviewable PR; published Alpha archives remain unchanged.
