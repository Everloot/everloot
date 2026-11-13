# Lightweight character profiles

Approved direction: the conversation selected a Raider.IO-style portrait and equipment profile, rather than a full character model. Retain Everloot's existing visual tokens, noindex and ad-free armory boundaries.

Show identity, a small supported portrait (race/class fallback), all equipment slots with item links and tooltips, optional Blizzard stats/talents/professions, PvP and rankings. Every section has a source and read time; missing data is omitted, never invented. Link to the talent calculator and profession routes. No new dependencies for the interface.

Blizzard detail ingestion follows only same-region, same-character links returned by the profile. Normalize a small allowlist into armory-only JSON, with a schema revision and section dates. Optional failures leave the base character intact. Calls count against the crawler budget. Existing rows receive one unconditional backfill read. No full render or arbitrary remote URL fetch.

Manual submission accepts explicit fields or an official Forever armory URL. Refresh uses the queue, existing IP quota and a per-character one-hour cooldown. It promises a queued refresh, never immediate freshness.

Named uploads retain the optional surname returned by Forever's UnitName. With existing named sharing enabled, a single atomic player write queues each complete region/name/surname identity, including the contributor and nearby players. Missing surnames or unknown regions are never guessed. Source days expire after 30 days. Guild-roster discovery remains available for legacy uploads. Add an explicit association from an account's existing linked character to a validated armory identity. Only public, non-frozen, unhidden links may be acknowledged or linked publicly; existing public-character readers enforce section consent. Observations never imply contribution. An accepted-upload receipt is required for contributor credit; otherwise use the truthful linked-character label.

Alternatives: full model rendering adds a separate media pipeline and is deferred by the user. A first-name-only join cannot establish identity and is rejected. Blizzard data stays out of exports, MCP and addon datasets. Existing anonymous uploads cannot be retroactively attributed without evidence.

Verification: behavioral tests for normalization, hostile links, optional endpoint failures, budget accounting, 304 backfill, complete empty slots, submission, refresh cooldown, hidden/private/frozen identities, and SQL retention/security. Production API credentials are held in GitHub Actions, not this checkout; live API and deployment verification must be reported separately.

Implementation evidence for the surname tuple: https://github.com/ATTWoWAddon/AllTheThings/issues/2630 and https://github.com/xIGBClutchIx/ForeverPlusPlus/blob/main/docs/forever-api.md (author-recorded client behavior; live verification of this addon change remains required before release). The protocol adds an optional field as package 2.2.0 / record protocol 1.14.0; no registry or addon release is implied.
