# Auction region filtering

**Goal:** Let players select a region before browsing recorded auction markets.

**Design:** Preserve the existing auction interface and full recorded market keys. Reuse `realmRegion` and the existing ruleset and house controls. Provide all regions, US, EU, KR, TW and unknown-region views; never guess an unknown region or combine prices across recorded markets. Explain that recorded realm labels do not prove auction-house connectivity. The region selection must survive search, sorting, pagination, category, ruleset and house changes. Region changes leave a realm-specific page and reset pagination.

**Architecture:** Add a validated optional region query parameter, filter boards before producing rows, scope counts and summaries to the same region, and add the existing accessible menu control. Display compact recorded realm names while retaining the full identity for hover and assistive technology.

**Tech stack:** Existing Next.js server components, TypeScript and Vitest; no dependencies or schema changes.

## Implementation

- [x] Add failing query and rendered-page tests for US/EU/unknown isolation, scoped counts and navigation preservation.
- [x] Implement query parsing/serialization, board filtering, region menu and region-aware empty states.
- [x] Add compact realm labels and recorded-market explanation without modifying canonical identities.
- [ ] Run auction/realm regression tests, strict types and lint; review the diff.
- [ ] Merge after required checks, verify deployment and production response, then update the shared handoff.

Database receipt metrics and named attribution were implemented separately in #1158. Their production migration activation requires a database-write credential and is tracked separately from this filter change.
