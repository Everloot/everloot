# Chat item cards implementation plan

**Goal:** Resolve item questions to the correct database item and display its live card and published drop evidence inside Chat, with or without a provider key.

**Architecture:** Page-side lookup and rendering use `/search/suggest?in=item` and `/database/card/item/<id>`. Published drop data uses `/api/tools/item_page`. Store item IDs with messages; card facts never enter model history or tool outputs.

**Tech stack:** Existing Next.js App Router, React, TypeScript, Vitest and game card components; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-25-chat-item-cards-design.md` (approved by Carlos).

## Global constraints

Preserve publishing gates, protected-page CSP and per-tab provider keys. Never invent drops, expose page-only facts to a model, log raw questions or change environment configuration. Existing conversations must remain readable.

## Review focus

Similar names must not replace exact matches. Ambiguity must offer choices. Temporary storage failure must not imply zero drops. Older conversations must render without new metadata. Failed or stopped lookups must not write into another conversation.

## Task 1: Item lookup and reference integration

Files: new `web/src/lib/chat/items.ts` and its test; existing `agent.ts`, `store.ts`, `ChatClient.tsx` and corresponding tests.

- [x] Write and run failing tests: Linen Cloth wins over Red Linen Robe; ordinary non-item questions retain existing behavior; ambiguous names return choices; lookup failure falls back safely; saved messages retain only item references.
- [x] Implement a small browser-side resolver for supported item questions. Validate returned IDs and canonical links, never guess a candidate. Expose typed item references to rendering and attach them to assistant messages in both no-key and provider flows. Keep references and page facts separate from model input.
- [x] Verify cancellation and old-message compatibility in focused tests.

## Task 2: Live item card and drop evidence

Files: new `web/src/components/chat/ItemResult.tsx` and its test; existing `Message.tsx` and Chat integration tests.

- [x] Write and run failing tests for game card display, published drop counts, pending reports, empty results, unavailable data, item choices and canonical links.
- [x] Implement the live component with existing `GameCard`; fetch the existing page-side card and player-data item tool, abort on unmount, and show evidence and freshness where available. Render ambiguous choices as accessible controls that open the selected item in Chat.
- [x] Verify page-only card facts are never persisted or passed to provider requests; run lookup, Chat and publishing guard tests.

## Task 3: Verification and release

- [x] Run types, lint and production build plus relevant tests. Inspect the full diff independently and fix substantive findings.
- [x] Verify actual desktop and narrow-screen Chat, no-key Linen Cloth, unavailable-data behavior, database links and retained protected-page behavior.
- [ ] Open and link a PR with evidence; use required CI and existing deployment serialization before merge. Verify production before reporting deployed.

Execution: Carlos explicitly approved implementation. Continue in this thread without another plan approval round. Use a focused implementation delegate and an independent whole-branch review; root owns integration and release verification.

Review record: the final review approved the feature after regression fixes for install-count wording, pending evidence, neutral result text, choosing an item, real names beginning with articles, and common drop-rate question forms. Focused checks: 123 tests, typecheck and scoped lint passed. Release verification remains tracked in Task 3.

Final local verification: production build succeeds with `/chat` still static; settled full web suite 2,446 passed and 3 skipped; production dependency audit found zero vulnerabilities. Chrome verified desktop and 390px layout with no horizontal overflow, real Linen Cloth icon/tooltip/provenance and the missing-drop state. Both the suggestion and the drop-rate question resolve to item 2589. The local browser test forwards existing item read routes to production because the local checkout has no private knowledge release; no synthetic drop facts were used. Outage, pending and provider cases are verified by focused tests.

Ruling: retain the existing lore/model fallback for questions the bounded item patterns do not recognize. Arbitrary natural-language entity extraction and article-prefixed partial-name improvements are outside this change; exact names are never silently replaced.
