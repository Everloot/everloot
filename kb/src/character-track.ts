/**
 * Tracking (leaderboards decision 2026-11-06): each ranked character's numbers over time, at most one point per day
 * and metric, stored in `character_track` (supabase/migrations/20261107150000_profile_pipeline.sql). Pure.
 *
 * A point is dated by the day its gear was captured (UTC), not the day the cron ran: a point dated today from gear
 * sent three weeks ago would claim a number nobody saw today. When the owner sends gear twice in a day, the later
 * capture replaces the day's point. `source` says where the number came from; the owner's own sync is the only
 * source today. Level is the link's level when the gear was scored.
 */

export type TrackMetric = "level" | "item_level" | "gear_score" | "achievement_points" | "honorable_kills";
export type TrackSource = "owner_sync" | "addon_pvp" | "blizzard_api";

/** One point as `record_character_track` takes it. */
export interface TrackPoint {
  link_id: string; day: string; metric: TrackMetric; value: number; source: TrackSource; version?: string;
}

/** The day (YYYY-MM-DD, UTC) of a time, or null when it is not one. */
function utcDay(at: string): string | null {
  const t = Date.parse(at);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** The points one scored board entry gives: level, item level and Gear Score (with its formula version). */
export function gearTrackPoints(
  e: { linkId: string; capturedAt: string; level: number; itemLevel: number; gearScore: number },
  gearScoreVersion: string,
): TrackPoint[] {
  const day = utcDay(e.capturedAt);
  if (!day) return [];
  const point = (metric: TrackMetric, value: number): TrackPoint => ({ link_id: e.linkId, day, metric, value, source: "owner_sync" });
  return [point("level", e.level), point("item_level", e.itemLevel), { ...point("gear_score", e.gearScore), version: gearScoreVersion }];
}

/** One day of a character's chart; null where that day has no point for the metric. */
export interface TrackDay { day: string; itemLevel: number | null; gearScore: number | null }

/** Stored points as one row per day, oldest first, for the chart: only days with an item level or a Gear Score. */
export function trackDays(rows: readonly { day: string; metric: string; value: unknown }[]): TrackDay[] {
  const days = new Map<string, TrackDay>();
  for (const r of rows) {
    if (r.metric !== "item_level" && r.metric !== "gear_score") continue;
    const value = typeof r.value === "string" ? Number(r.value) : r.value;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const d = days.get(r.day) ?? { day: r.day, itemLevel: null, gearScore: null };
    if (r.metric === "item_level") d.itemLevel = value; else d.gearScore = value;
    days.set(r.day, d);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
