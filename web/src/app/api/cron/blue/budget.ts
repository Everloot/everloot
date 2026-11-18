// Time budget for one blue-posts cron run, all measured from the moment the handler starts.
//
// A run that outlasts about half a minute is cut off by the platform before it saves anything, so its whole pass is
// repeated and never advances. Worst case, a run reads the store, works until WORK_ENDS_MS, waits out one request that
// was in flight at that point, then makes both store writes. Those steps must end by RUN_BUDGET_MS, with margin left
// under CANCEL_MS. The next run (10 minutes later) carries on from the saved place.

/** Where Cloudflare cancels a scheduled invocation. */
export const CANCEL_MS = 30_000;
/** Everything, both writes included, ends by this point. */
export const RUN_BUDGET_MS = 25_000;
/** One upstream request; the one in flight at WORK_ENDS_MS may run this long. */
export const REQUEST_TIMEOUT_MS = 8_000;
/** Kept free for the two store writes (posts, then fetch state). They share it. */
export const WRITE_RESERVE_MS = 6_000;
/** No new upstream request starts after this point; a slow store read shortens the work, never the writes. */
export const WORK_ENDS_MS = RUN_BUDGET_MS - WRITE_RESERVE_MS - REQUEST_TIMEOUT_MS;
