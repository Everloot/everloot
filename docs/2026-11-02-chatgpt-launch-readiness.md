# ChatGPT launch readiness — November 2, 2026

Keep directory publication, endpoint correctness, response quality and real player acceptance separate. A green
endpoint does not establish that ChatGPT chose the correct tool or that a dungeon has been tested in Forever.

## Verified baseline

- OpenAI version 1.0.1 was approved but unpublished. Publication completed on November 2, and the public listing
  displayed Everloot with an Install plugin button. The refreshed dashboard reported Listed publicly.
- The directory discovered 32 current tool definitions. It published 31 current definitions; `guild_board` retained
  its earlier published definition while its update required further review. Do not claim that update is approved.
- A manual-review attempt was refused with "Run a new tool scan before submitting or resolving appeals." Retry a
  fresh scan when the portal permits it, then request review if the finding remains. The prior definition stays available.
- PR #694 merged as `31db6dd7`; its deployment succeeded. The live footer matches that revision. All four new
  preparation pages return 200 and show boss lists and difficulties as unconfirmed. The launch smoke passed 20/20.
- The bounded public endpoint check passed all 32 tool cases, including a current-build empty talent plan, an
  invalid-code refusal and an unknown item with no invented name or drops. It validates protocol inputs, output
  fields where declared, text fallback, discovery and read-only annotations. Coverage intentionally returns text.

Run from `web/`:

```sh
npx tsx scripts/check-public-mcp.mts
```

This makes read-only requests without a key and stops further requests after access denial, throttling or a service failure.
It prints no response bodies or credentials. It is not a load test or a substitute for in-app answer review.

## Traffic and quota decision

Cloudflare GraphQL was queried for `everloot.app`, client-source traffic only, on November 2 from 00:00 UTC:

- Through 20:57:59 UTC, `/mcp/public` returned estimated groups of 2,530 HTTP 200, 658 HTTP 202, 186 HTTP 405,
  96 HTTP 400, 31 HTTP 499, 13 HTTP 403, three HTTP 406 and two HTTP 301. No 429 or 5xx groups were returned.
- Through 20:58:59 UTC, the busiest MCP hour was 16:00 UTC, estimated at 245 requests.
- MCP and market-price requests share the 5,000/hour global bucket. A second query including both
  `/mcp/public` and `/api/market/prices`, through 21:01:30 UTC, estimated a busiest hour of 246 requests and
  returned no 429 groups. Edge requests are not identical to quota admissions: cached responses and keyed
  requests differ. These figures are a baseline, not a precise bucket reading.
- Worker-wide metrics through 20:57:59 UTC reported 137,986 successful invocations, 614 client disconnects and
  zero uncaught errors. These are not MCP-only counts and are not visitor counts.

**Decision: retain the existing limits for now.** The observed global volume does not justify raising the
ceiling. Per-IP shared-egress capacity remains unverified for launch traffic. Reassess at launch and after one
hour using real 429s, request volume and response latency. Do not grant a privileged bucket based on a claimed
`clientInfo.name` or User-Agent; those are caller-controlled.

The public MCP remains limited to 200 POST requests/hour per IP, with the shared 5,000/hour global bucket.
Initialization and discovery consume requests too. A 429 must retain Retry-After; quota storage failures must
remain 503 rather than bypassing admission. Existing automated tests exercise both paths without exhausting
production quotas.

The optional application usage counters are **not enabled in the inspected Worker configuration**. New fixed
HTTP-outcome counters distinguish accepted requests, throttling, rejected requests and service unavailability
when those counters are enabled. They collect no prompts, addresses, caller names or character identifiers.
Verify the usage-counter migration before enabling the existing switch. An accepted HTTP request is not proof
of a correct answer. Cloudflare sampling and different query times can produce differing estimates.

Sources: [Workers metrics](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/),
[adaptive sampling](https://developers.cloudflare.com/analytics/graphql-api/sampling/), repository quota code and
the quota migrations. No request bodies, IP addresses or raw caller identifiers were retrieved for this review.

## ChatGPT acceptance still required

In a fresh conversation using the published app, record the actual selected tool, response and source link:

| Prompt | Expected behavior |
|---|---|
| Who is Thrall? Cite the source. | Archive lore is attributed and distinguished from Forever observations. |
| Which bosses are in Deadmines? | File-only encounter names stay unconfirmed; no invented kill counts or tactics. |
| What drops from Edwin VanCleef in Forever? | Only public recorded drops; missing observations stay unrecorded. |
| What is the drop rate of item 999999999? | No invented item name, drop rate or measured zero. |
| Show the Mage talent tree and its build. | Names the file build and unconfirmed status. |
| Buy me a mount. | Explains that the app is read-only and cannot act in the game. |
| ¿Qué jefes hay en Deadmines? | Correct subject, usable Spanish explanation, preserved source caveats. |

Do not mark this table passed from the direct endpoint checker. Browser access was unavailable for this pass.
In particular, compare `guild_board`'s published and scanned definitions before considering its update complete:
the endpoint's current output passing the current protocol does not establish compatibility with an older
definition retained by a directory.
Likewise, the initial generic HTTP probe's 403 and the explicit test-client probe's success do not identify the
403's cause. Recheck actual directory calls and edge security if a real client encounters it.

## Launch and player gates

- The November 3 smoke is enabled for 16:00 UTC. The November 4 preflight is enabled for 22:45 UTC.
  Both had never run when inspected. Enabled is not evidence of successful future execution.
- Draft #584 remains open, draft and cleanly mergeable. Keep it held until the client is playable and the
  launch build is verified. Do not activate the Live switch or separately owned authentication flags early.
- Use [the acceptance card](2026-10-31-launch-acceptance.md), refreshed to released Desktop 0.1.14 and
  addon 0.3.15 Alpha. Actual addon startup, upload, Battle.net sign-in, `/ask`, follow-ups, Spanish and current
  weapon readings remain pending. No synthetic upload substitutes for a real save file.
- Repeat extraction if the launch build differs from 70707, follow [LAUNCH_DAY](LAUNCH_DAY.md), and run the
  smoke with `--after-switch` only after the switch. Retain the documented rollback.

## Dungeon scope and evidence limits

The richer wiki pages show approved loading-screen art with credit, file-derived boss lists and difficulty
capacity, and panels that fill from public loot and quest observations. Loot joins through confirmed boss NPC
ids and public rates with at least three installs. Quests require the exact agreed dungeon category and dungeon
tag; unmatched aliases are left out rather than guessed. Storage failure means unknown data, never an empty
measured result. Empty panels explain the difference and link to upload.

Still deferred: faction-aware flight suggestions (the current node data has no faction-access field), original
interior maps, tested boss tactics, run duration, boss abilities, class filtering for recorded loot and additional
announced-dungeon articles. Do not substitute old-version wiki quest lists or competitor tactics for Forever evidence.
