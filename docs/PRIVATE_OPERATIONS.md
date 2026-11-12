# Private operations

`/ops` is a private, read-only view of contributing installations, intake outcomes, source health and cost estimates. `/api/ops/summary` serves the same aggregates to separately authorized automated readers. It never includes the contributor explorer or named identities.

## Access

All grants are server configuration. Public player accounts and ordinary API keys have no operations permission. Missing or malformed configuration fails closed.

- `EVERLOOT_OPS_USER_IDS`: comma-separated immutable website account IDs allowed to open the dashboard.
- `EVERLOOT_OPS_CONTRIBUTOR_USER_IDS`: a separate subset allowed to read opted-in character details. A dashboard grant alone does not grant named access.
- `EVERLOOT_OPS_AGENT_TOKEN_HASHES`: JSON object mapping a revocable reader label to the SHA-256 hex digest of a strong random bearer token. Each reader should have a separate token. Only the digest belongs in server configuration; the token belongs in the reader's protected secret store. Bearer credentials work on the aggregate summary only.

An optional Cloudflare Access boundary is also supported: configure `EVERLOOT_OPS_ACCESS_ISSUER`, `_AUDIENCE` and explicit `_HUMAN_SUBJECTS` or `_HUMAN_EMAILS`. Separate `_CONTRIBUTOR_SUBJECTS` or `_CONTRIBUTOR_EMAILS` grant named details. `_SERVICE_SUBJECTS` grants only aggregate access using the signed service identity. JWT signature, issuer, audience and expiry are checked inside the application. An unverified forwarded identity header grants nothing. Cover every reachable hostname and both `/ops` and `/api/ops` when configuring edge policies.

Remove a grant or token digest to revoke future requests. Never share one person's browser session with teammates. Keep operations and user-facing API credentials separate.

## Collection

Apply the operations activity and attribution migrations before enabling telemetry. Tables have RLS and no public/player access; narrowly granted service functions perform writes. The migration files and disposable PostgreSQL tests describe the exact permissions.

- `EVERLOOT_OPS_METRICS=1`: records best-effort final intake outcomes and successful receipt activity after persistence.
- `EVERLOOT_OPS_HMAC_SECRET`: stable, strong server-only secret used to pseudonymize installations. Back it up; rotating it changes the identity namespace and invalidates prior comparisons.
- `EVERLOOT_OPS_EXCLUDED_INSTALLS`: private JSON array of known owner/test installation IDs. Do not put this list in the repository. Changes invalidate old aggregates until the next collection.
- `EVERLOOT_USAGE_METRICS=1`: enables existing MCP tool counters after their migration is present.
- Optional `EVERLOOT_OPS_CF_ANALYTICS_TOKEN` and `EVERLOOT_OPS_WORKER_NAME`: scoped Cloudflare analytics reader and target Worker. Without a working analytics credential, cost estimates remain unavailable; actual billed amounts are never invented.

The existing hourly trigger calls `/api/cron/ops` with the existing cron credential. The collector reads a bounded upload index and receipt counters, not every raw upload. It writes `private/ops/summary-v1.json` in the existing private upload bucket. Dashboard/API requests read that object without rebuilding it. Collection failures retain last-good values with source-specific freshness/availability markers. Sources older than 90 minutes are stale; truncated sources are explicitly incomplete. Private responses use no-store and noindex headers.

Optional one-time `ops/contributor-hints.json` associates pseudonymous contributor IDs with previously observed realm/kind labels. Format: `{version:1,generatedAt,contributors:[{id,realms,kinds}]}`. It cannot supply account identities, successful receipt dates or retention. The loader bounds size/count and selects permitted fields only.

## What the numbers mean

Installations are not unique people. Receipt days use server receive time. Historical stored-upload activity is a separate baseline because fully successful tally/player-only requests may not create an upload row. Gameplay capture dates are not website visits. Owner exclusions apply only to recognized install identities; browser/MCP counts keep their own coverage and probe caveats.

CPU costs are estimates with their formula, period, pricing date and included services. Account-shared allowances, base fees and other services must not be silently combined into a purported bill. No configured authoritative billing source means billed total is unavailable.

## Optional contributor names

After a successful browser upload, an authenticated contributor can explicitly attribute those upload receipts to one of their own linked public characters. Matching character keys, current ownership, non-frozen link, current visibility and suppression are checked. It labels the submitted request's chosen character context, not authorship of every record or earlier installation history. Uploading anonymously remains supported.

The contributor can revoke all their attribution choices from the upload page. Unlinking or deleting the account cascades the associations; hiding or freezing the character prevents disclosure immediately on the next detail read. Private profile, account and character data are not added to the aggregate snapshot. Agents with aggregate credentials cannot query named details.

## Verify and recover

Verify unauthorized page/API requests reveal no private data, an authorized human can open `/ops`, and a dedicated reader token can read only `/api/ops/summary`. Confirm the hourly collector updates the object and that each source accurately states its coverage. Check owner exclusions against independently known local IDs before interpreting growth.

If collection fails, inspect the source markers and scheduled-job outcome. Fix source access instead of returning zero or rebuilding the corpus on page requests. Disable `EVERLOOT_OPS_METRICS` to stop telemetry; it must not affect upload success. Revert the application change to remove the dashboard while preserving additive private tables for recovery. Avoid dropping those tables during an incident. No dashboard control deploys code, changes quotas, grants access or deletes user data.
