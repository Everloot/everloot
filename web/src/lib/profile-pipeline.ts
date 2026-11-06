import { z } from "zod";
import { gearTrackPoints, trackDays, type TrackDay } from "../../../kb/src/character-track";
import { GEAR_SCORE_VERSION, type ItemFileFacts } from "../../../kb/src/gear-score";
import { gearBoardStore, type GearBoardStore } from "./gear-board-store";
import { itemFiles, scoreRows, type GearBoardSnapshot, type StoredEntry } from "./leaderboards";
import { authQuery } from "./supabase/server";

/**
 * The profile pipeline's first step (design docs/design/2026-11-07-profile-pipeline.md): every 30 minutes the cron
 * (/api/cron/profiles) scores the gear boards and stores them, and writes each scored character's tracking points.
 * Pages read what it stored and never score anything.
 *
 * A run reads only what changed: gear received since the last run's watermark, plus characters that came back onto
 * the boards without new gear. Characters no longer on the boards are dropped from the snapshot. Once a day (the
 * first run of a UTC day) it reads every ranked character again, so a change in the game files or on the link row
 * (level, race) reaches the boards within a day.
 */

/** A read of the database through PostgREST (authQuery; tests pass their own). */
type Query = (path: string, init?: RequestInit) => Promise<unknown>;

/** The run is a full pass: no snapshot yet, or none yet this UTC day. */
export function needsFull(prev: GearBoardSnapshot | null, now: Date): boolean {
  return !prev || prev.fullAt.slice(0, 10) !== now.toISOString().slice(0, 10);
}

/** What the fold needs of each row besides what scoreRows reads. */
const RowLink = z.object({ link_id: z.string().min(1), received_at: z.string().min(1) });

/**
 * One run's new snapshot. Pure. `live` is the links on the boards now; `rows` the board rows read this run. On a full
 * pass the snapshot is rebuilt from `rows`; otherwise the previous one is kept for links still live and each row
 * read replaces its link's entry. `scored` is the entries scored this run, which get tracking points.
 */
export function foldBoard(
  prev: GearBoardSnapshot | null, live: ReadonlySet<string>, rows: readonly unknown[],
  files: (itemId: number) => ItemFileFacts | undefined, now: Date, full: boolean,
): { snapshot: GearBoardSnapshot; scored: StoredEntry[] } {
  const entries = new Map<string, StoredEntry>();
  const refused: GearBoardSnapshot["refused"] = {};
  if (prev && !full) {
    for (const e of prev.entries) if (live.has(e.linkId)) entries.set(e.linkId, e);
    for (const [id, why] of Object.entries(prev.refused)) if (live.has(id)) refused[id] = why;
  }
  let watermark = full ? null : prev?.watermark ?? null;
  const scored: StoredEntry[] = [];
  for (const raw of rows) {
    const link = RowLink.safeParse(raw);
    if (!link.success || !live.has(link.data.link_id)) continue;
    const { link_id: linkId, received_at: receivedAt } = link.data;
    if (Number.isFinite(Date.parse(receivedAt)) && (!watermark || Date.parse(receivedAt) > Date.parse(watermark))) watermark = receivedAt;
    entries.delete(linkId);
    delete refused[linkId];
    const { entries: [entry], notCounted } = scoreRows([raw], files);
    if (entry) {
      const stored = { ...entry, linkId };
      entries.set(linkId, stored);
      scored.push(stored);
    } else {
      refused[linkId] = (Object.keys(notCounted)[0] ?? "shape") as GearBoardSnapshot["refused"][string];
    }
  }
  const at = now.toISOString();
  return {
    snapshot: { version: 1, generatedAt: at, fullAt: full ? at : prev?.fullAt ?? at, watermark, entries: [...entries.values()], refused },
    scored,
  };
}

export interface ProfileRun { full: boolean; read: number; scored: number; entries: number; points: number }

/**
 * One cron run. Reads the links on the boards, then only the board rows that changed (all of them on a full pass),
 * scores them against the game files, writes their tracking points, then the snapshot. Points go first: when the
 * snapshot write fails the next run reads the same rows and writes the same points again, which changes nothing.
 * Throws when a read or write fails or the game files cannot be read while there is gear to check; the stored
 * snapshot is then left as it was.
 */
export async function writeGearBoard(opts: { rebuild?: boolean } = {}, deps: {
  query?: Query;
  store?: GearBoardStore;
  files?: (ids: readonly number[]) => Promise<((id: number) => ItemFileFacts | undefined) | null>;
  now?: Date;
} = {}): Promise<ProfileRun> {
  const query = deps.query ?? authQuery;
  const store = deps.store ?? gearBoardStore();
  const now = deps.now ?? new Date();
  const prev = await store.read();
  const full = !!opts.rebuild || needsFull(prev, now);
  const liveRows = await query("rpc/ranked_gear_links", { method: "POST", body: "{}" });
  if (!Array.isArray(liveRows)) throw new Error("ranked_gear_links answered with no list");
  const live = new Set(liveRows.flatMap((r) => {
    const id = (r as { link_id?: unknown } | null)?.link_id;
    return typeof id === "string" ? [id] : [];
  }));
  let body: Record<string, unknown> = {};
  if (!full && prev) {
    const known = new Set([...prev.entries.map((e) => e.linkId), ...Object.keys(prev.refused)]);
    body = { p_since: prev.watermark ?? now.toISOString(), p_link_ids: [...live].filter((id) => !known.has(id)) };
  }
  const rows = await query("rpc/ranked_gear_board", { method: "POST", body: JSON.stringify(body) });
  if (!Array.isArray(rows)) throw new Error("ranked_gear_board answered with no list");
  const ids = rows.flatMap((r) => {
    const equipped = (r as { data?: { equipped?: unknown } } | null)?.data?.equipped;
    return Array.isArray(equipped) ? equipped.flatMap((e) => (typeof e?.itemId === "number" ? [e.itemId as number] : [])) : [];
  });
  const files = rows.length ? await (deps.files ?? itemFiles)(ids) : () => undefined;
  if (!files) throw new Error("the game files could not be read; the boards were left as they were");
  const { snapshot, scored } = foldBoard(prev, live, rows, files, now, full);
  const points = scored.flatMap((e) => gearTrackPoints(e, GEAR_SCORE_VERSION));
  let written = 0;
  if (points.length) {
    const n = await query("rpc/record_character_track", { method: "POST", body: JSON.stringify({ p_points: points }) });
    written = typeof n === "number" ? n : 0;
  }
  await store.write(snapshot);
  return { full, read: rows.length, scored: scored.length, entries: snapshot.entries.length, points: written };
}

/**
 * One ranked character's tracked days for its chart, or null when they cannot be read. The database returns nothing
 * for a link that is not on the boards right now, so a page never draws an unranked character's history.
 */
export async function loadTrack(linkId: string, query: Query = authQuery): Promise<TrackDay[] | null> {
  try {
    const rows = await query("rpc/character_track_points", { method: "POST", body: JSON.stringify({ p_link_id: linkId }) });
    if (!Array.isArray(rows)) return null;
    return trackDays(rows.filter((r): r is { day: string; metric: string; value: unknown } =>
      typeof (r as { day?: unknown })?.day === "string" && typeof (r as { metric?: unknown })?.metric === "string"));
  } catch {
    return null;
  }
}
