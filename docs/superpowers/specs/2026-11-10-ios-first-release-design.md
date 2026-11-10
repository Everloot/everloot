# Everloot for iPhone: first release

## Intent and authority

Build a useful iPhone release around chat, search, and the shared database, then expand gradually.
The owner authorized continuous implementation on 2026-11-10 after the proposed four stages:
database foundation, native iPhone experience, TestFlight and submission preparation, then expansion.
Items, NPCs, and quests are the initial complete flow; this scope is an implementation choice.

## Approach

Use a native SwiftUI client in the existing private `Everloot/ios` repository. Reuse the public
Everloot service and its schemas. A cross-platform client would share future Android code, but the
current priority is iOS. A website wrapper would not deliver the intended native experience.
No new database, upload pipeline, authentication system, or paid inference service is needed.

## First complete experience

- Search across the database, initially emphasizing items, NPCs, and quests.
- Keep gameplay game IDs separate from knowledge-record IDs. Historical lore never becomes a
  current gameplay fact merely because it mentions the same subject.
- Open native record details, with source links, observation dates, missing facts, and unconfirmed
  game-file labels preserved. The initial details may render the service's sourced text while
  dedicated sections use its structured fields.
- Ask a question, see which read-only searches are running, read a sourced response, and open its
  referenced records. Follow-up turns retain bounded conversation context.
- Use the existing free completion proxy when available, with an allowlisted tool loop bounded
  to three rounds, six prior turns, 4,000 characters per result, and 1,000 output tokens. Search
  remains usable if the model is off, exhausted, or unavailable. Never call a fallback search
  result a model answer. Do not add paid providers or collect users' API keys for this release.
- Obtain consent before sending conversation text to an external model service; disclose the
  actual recipient/provider policy. Revoking consent restores search-only behavior immediately.
- Store history and saved records locally, with visible delete controls. No account required.
- Native sharing, Dynamic Type, VoiceOver labels, cancellable requests, empty/error/retry states,
  and useful behavior with slow or absent connectivity. Saved content shows its age offline.

## Database milestone

Complete means the client/API contract and supported journeys are reliable, not that every game
record has been observed. Search, source evidence, item/NPC/quest detail, coverage, and health must
work without a browser session or embedded secrets. Missing fields remain unknown, not zero.
Public mobile clients must work through normal public endpoints without a privileged WAF header.

Readiness checks on 2026-11-10 initially passed eight public requests: health, item search,
no-match search, item 2589, NPC 639, quest 1, sourced question evidence, and measured coverage.
The coverage snapshot was build 1.60.1.70862, with 14 installs and only 11 confirmed quest records.
Coverage is incomplete and must not be described as complete. An initial probe using Python's
default user agent received 403; a descriptive app user agent received 200. Verify URLSession's
actual public access on the device and handle challenges explicitly, never embed bypass secrets.
The negative search fixture uses one nonsense token: hyphenated English words are tokenized and
can legitimately match historical lore. The final smoke check asserts the known item's ID, empty
results for that single nonsense token, matching detail IDs, and valid nullable evidence dates.

## Delivery and later expansion

Build and test on macOS with Xcode. Inspect actual Developer Program, signing, bundle identifier,
App Store Connect, and agreements access; an unlocked laptop alone does not prove them. Prepare
the icon, screenshots, support/privacy URLs, data disclosures, age rating, review notes, archive,
and export settings. Mark TestFlight upload, review submission, and approval separately. Do not
claim a distribution milestone without a receipt. Spend nothing or accept new legal agreements
without the owner's explicit authorization. Present the concrete candidate before public release.

After the core journeys pass, add native support for the existing vendor, profession, and spell
records. Talent planning, linked character sync, collections, and other write/account features each
need a separate acceptance milestone; build them sequentially rather than adding placeholders.

## Verification

Behavior tests cover identifier routing, source labels, empty/disconnected data, 429/503 and HTML
responses, cancellation and out-of-order search, malformed model tool arguments, unknown tools,
loop limits, consent revocation, and local deletion. Run a simulator journey from search through
detail and a sourced chat answer, then repeat an offline/error path. Archive/build success alone
does not establish UI correctness, distribution readiness, or review approval.

Apple references checked 2026-11-10:
[Review guidelines](https://developer.apple.com/app-store/review/guidelines/), especially 1.2,
4.2, 5.1.1 and 5.1.2; [submission requirements](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app).
