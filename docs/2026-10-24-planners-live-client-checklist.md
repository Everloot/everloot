# Planner Alpha: live-client verification

Status: pending. Source and Lua contracts pass; these steps require a running WoW: Forever client.
Use Alpha 0.3.11, record the client build, resolution, UI scale and other enabled addons. Back up the
existing Everloot addon folder before replacing it; keep SavedVariables and all other addons intact.

## Functional session

1. Confirm `/everloot version` says 0.3.11 and `/everloot selftest` reports the trait APIs available.
2. Make two different talent sets on the website. Copy each active set for the addon. Import each into
   the Talents tab and check class, points, next point and differences against the character.
3. Open the game's talent window. Drag the Everloot header beside it. Verify green/red highlights do
   not intercept clicks and that only one Everloot planner/guide window appears.
4. Paste a saved-build URL, second-set-only URL, short saved link, wrong-class code and damaged code.
   Check the explanation and preservation of the last valid plan. Press Escape while editing and scrolling.
5. Reload and confirm the plan and workspace preference persist. Switch spec and spend a point manually;
   confirm the comparison updates after events settle. Close the window and verify it stays closed.
6. With a real group, import a known website raid plan. Compare class counts in each group, including
   repeated classes, an empty slot and an extra group. Tree choices and player identities remain unverified.
7. Copy the current raid back to the website and compare its class/group placement. Check a distant or
   offline member is labelled unreadable in the buff check. Arrange all groups manually.

## Memory and responsiveness

Use the game's performance display for baseline and visible-window checks at the same location,
camera direction, resolution and enabled addons. Record a quiet 60-second baseline, 60 seconds with
Talents open, 60 seconds with Raid open in a full group, then 60 seconds closed. Repeat three times.
Record FPS range/median where available, addon memory before/after, errors and visible input/scroll delays.
The game UI's performance bar uses GetFramerate, UpdateAddOnMemoryUsage and GetAddOnMemoryUsage;
check API availability in this client before running any read-only diagnostic.
[Game UI performance implementation](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_PerformanceBar/PerformanceBar.lua).

Do not publish harness timings as game FPS or total addon memory. Do not change profiling settings
without recording them. An empty or unavailable group is not a full-raid performance test.

## Authentic gallery capture

Capture the actual game client at a readable UI scale: (1) Talents plan next to the native talent tree,
(2) Raid comparison with a real group. Hide chat and personal identifiers or obtain consent for any
player names retained. Preserve the original image; label the addon version and client build.
Inspect the image before uploading to website/CurseForge/Wago. Existing website-only screenshots
remain labelled website examples until these real captures exist.

## Results

- Game availability and session date: pending
- Functional steps 1–7: pending
- Memory/FPS observations: pending
- Authentic screenshots: pending
- No live-client session was completed during release preparation. Game availability remains unverified.
