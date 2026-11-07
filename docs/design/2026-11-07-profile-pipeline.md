# Profile pipeline: digest linked characters on a schedule, serve what was stored

Date: 2026-11-07. Status: first step built behind `EVERLOOT_LEADERBOARDS` (off by default). Builds on the gear
rankings (leaderboards plan and decision of 2026-11-06: named boards only for linked owners who opt in; "tracking"
means each ranked character's history, one point per day).

## Why

Pages that rebuild their numbers from raw rows on every view make the Worker's CPU grow with traffic, and traffic
grew sharply at launch. The gear boards as first built did the same thing: every board view and every ranked
character page called `ranked_gear_board()`, read the game files for every equipped item, and scored every character.
Armory sites solve this by digesting characters on a schedule and showing "Last scanned N minutes ago". This note
moves character profiles to that model, starting with the gear boards: **a cron digests, pages read what it stored,
and no page view computes anything.**

## What is stored

1. **The board snapshot.** One R2 object, `snapshots/gear-board.json` in the private bucket, beside the market rollup:

   ```
   { version: 1, generatedAt, fullAt, watermark,
     entries: [{ linkId, name, realm, ruleset, region, race, class, faction, level, path, capturedAt, itemLevel, gearScore }],
     refused: { <linkId>: "unknown_item" | "wrong_slot" | "level_mismatch" | "duplicate_slot" | "no_items" | "shape" } }
   ```

   `entries` is every ranked character whose gear passed the game-file checks; `refused` says why each other one was
   left out, so the "Not counted" line stays right. `watermark` is the newest `character_facts.received_at` the cron
   has read; `fullAt` is its last full pass. The object holds link ids, so it never leaves the server.

2. **Tracking points.** A new table, `character_track (link_id, day, metric, value, source, version)`, primary key
   `(link_id, day, metric)`, `on delete cascade` from `character_links`. Metrics allowed now: `level`, `item_level`,
   `gear_score`, `achievement_points`, `honorable_kills`; only the first three are written today. A point is dated by
   the UTC day its gear was **captured**, not the day the cron ran: a point dated today from gear sent three weeks
   ago would claim a number nobody saw today. A later capture on the same day replaces that day's point. The table is
   closed to every role, including `service_role`; it is reached only through two security-definer functions.

3. **The profile row per linked character** is, today, the snapshot entry above. When more than the gear boards read
   profiles, the entry moves to a `character_profile` table (one row per link, the same fields plus `source` and
   `digested_at`) with the same rule: written only by the cron, read by pages.

## Who may appear, and how fast a switch takes effect

The rule lives in one SQL function, `ranked_gear_links()`: a live link (linked, not frozen, no frozen link claiming
it), page public, "Rank my gear" on, gear sync on, not hidden by a hide request, gear captured in the last 30 days.
`ranked_gear_board()`, `record_character_track()` and `character_track_points()` all go through it, so the board, the
points the cron may write and the points a page may read can never disagree about who is ranked.

The snapshot is at most 30 minutes old, but privacy must not wait for it. Each board view and each ranked character
page reads `ranked_gear_links()` once (one query, link ids only) and drops every snapshot entry not in it. Turning
ranking off, making the page private, turning gear sync off, a hide request or unlinking therefore takes the character
off on the **next request**. If either read fails, the boards say they are unavailable; they are never shown
unfiltered. History is kept while a character is off the boards (nothing reads it) and deleted when the link is.

## The run (every 30 minutes, `7,37 * * * *`, `/api/cron/profiles`)

```
prev   = R2 snapshot (or none)
full   = no snapshot, none yet this UTC day, or ?rebuild=1
live   = ranked_gear_links()                             -- link ids
rows   = full ? ranked_gear_board()
              : ranked_gear_board(p_since = prev.watermark,
                                  p_link_ids = live - known)   -- back on the boards without new gear
files  = game files for the items in rows only           -- skipped when rows is empty
fold   : keep prev entries still in live, rescore rows, drop the rest
points : level, item level, Gear Score for each rescored character -> record_character_track
write  : points first, then the snapshot
```

The schedule is off the 10-minute marks so it never starts together with the upload snapshot run. Points are written
before the snapshot: if the snapshot write fails, the next run reads the same rows and writes the same points again,
which changes nothing. If the game files cannot be read while there is gear to check, the run fails and the stored
snapshot stays as it was (its age shows on the boards).

The full pass once a day picks up what an incremental run cannot see: a game-file update that makes a refused item
known, a level or race change on the link row, and any row whose `received_at` was written by a transaction that
committed after a later one. `?rebuild=1` forces one.

## How much work each run does

Per run, with C = characters whose gear arrived since the last run, R = characters back on the boards without new
gear, and N = everyone ranked:

| Step | Incremental run | Full pass (once a day) |
| --- | --- | --- |
| `ranked_gear_links()` | 1 query, N ids | same |
| `ranked_gear_board()` | 1 query, C + R rows (plus a 5-minute overlap) | 1 query, N rows |
| Game files | items of C + R characters | items of N characters |
| Scoring | C + R characters | N characters |
| `record_character_track()` | 1 call, 3 points each for C + R | 3 points each for N (same values, rewritten) |
| R2 | 1 read, 1 write | same |

A run with nothing new reads the links and an empty board, scores nothing and writes no points. Per page view the cost
is fixed: one cached R2 read (each Worker instance reuses it for a minute), one `ranked_gear_links()` query, and on a
ranked character's page one `character_track_points()` query. None of it grows with uploads.

## Later sources feed the same rows

Every point carries a `source`. Sources, in the order they are expected:

- `owner_sync`: the owner's own addon through private sync (today).
- `addon_pvp`: the addon PvP collector being built separately; it adds `honorable_kills` points.
- `blizzard_api`: scheduled pulls from Blizzard's Forever API, behind `EVERLOOT_BLIZZARD_FOREVER`, after the read-only
  probe and the policy update the decision of 2026-11-06 requires.
- The website submission queue is not a source of numbers: a submitted name only queues a Blizzard API lookup, whose
  answer arrives as `blizzard_api`.

Each source adds a step to the same cron that reads only what that source received since its own watermark and writes
the same snapshot entry and tracking points. Today `record_character_track()` accepts points only for characters on
the gear boards; a source that ranks characters by another rule (the Blizzard source, once approved) gets its own gate
function before it writes, never a wider gate for everyone.

## Open points for the owner

- Should turning gear sync off (which deletes the stored gear at once) also delete gear-derived tracking points? Today
  they are kept and hidden while the character is off the boards, and deleted on unlinking.
- The board read has no row cap (a cap could drop changed rows while the watermark moved past them). Each row is about 1-2 KB of gear, so past a few thousand ranked characters the daily full pass should page by received_at. Incremental runs re-read a 5-minute overlap behind the watermark, and a row holding the capture already stored is not scored again, so the overlap costs no game-file read and no point write.
- Two overlapping runs could write the snapshot out of order; the 30-minute schedule makes this unlikely, and the
  market rollup's ETag check can be added if it ever matters.
