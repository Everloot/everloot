import { z } from "zod";
import { gearNumbers, type GearRefusal, type ItemFileFacts } from "../../../kb/src/gear-score";
import { loadItemTips, loadSiteAssets } from "./game-assets";
import { gearBoardStore } from "./gear-board-store";
import { CLIENT_LAYER } from "./items";
import { characterPath, DEFAULT_RULESET } from "./player-pages";
import { realmParts, realmRegion, rulesetParam, type RulesetSlug } from "./realms";
import { loadShownNames } from "./shown-item-names";
import { authQuery } from "./supabase/server";
import { REGIONS, type Region } from "../data/realms";

/**
 * The gear rankings (leaderboards plan 2026-11-06; rankings design section 6.2, approved 2026-10-21): item level and
 * Everloot Gear Score v1 for linked characters whose owner made the page public and turned "Rank my gear" on. Only
 * those characters, nobody else's: no sighting, inspect or other site feeds a board. The numbers come from
 * kb/src/gear-score.ts over the owner's synced gear, with every item checked against the game files; gear that fails
 * a check is left out and counted as "not counted". The profile cron (profile-pipeline.ts) scores them every 30 minutes
 * and stores one snapshot; a page reads that and filters it against the links on the boards right now
 * (ranked_gear_links, one query), so a switch turned off is gone on the next request. Behind EVERLOOT_LEADERBOARDS=1,
 * which also needs the character pages and private sync.
 */

export { leaderboardsOn } from "./leaderboard-switch";

export type GearMetric = "item-level" | "gear-score";
export const GEAR_BOARDS: Record<GearMetric, { title: string; lede: string; description: string; column: string }> = {
  "item-level": {
    title: "Item level", column: "Item level",
    lede: "Linked characters by the average item level of what they wear: 17 slots, an empty one counting 0.",
    description: "WoW Forever characters ranked by average equipped item level, from players who linked their character to Everloot and chose to be ranked.",
  },
  "gear-score": {
    title: "Gear Score", column: "Gear Score",
    lede: "Linked characters by Everloot Gear Score: item level weighted by each slot's stat budget in the game files.",
    description: "WoW Forever characters ranked by Everloot Gear Score, an item level weighted by each slot's stat budget, from players who linked their character and chose to be ranked.",
  },
};
export const gearBoardPath = (metric: GearMetric) => `/rankings/${metric}`;
/** Rows a board prints. */
export const BOARD_ROWS = 100;

export interface GearEntry {
  name: string; realm: string; realmBase: string; ruleset: RulesetSlug | null; region: Region | null;
  race: string; class: string; faction: "Alliance" | "Horde"; level: number;
  path: string; capturedAt: string; itemLevel: number; gearScore: number;
}
export interface RankedEntry<E extends GearEntry = GearEntry> { rank: number; entry: E }
/** A board entry as the snapshot keeps it: with the link it belongs to, which never leaves the server. */
export interface StoredEntry extends GearEntry { linkId: string }
export interface BoardQuery { ruleset: RulesetSlug | null; region: Region | null }

/** One row as `ranked_gear_board` returns it. */
const BoardRow = z.object({
  ruleset: z.string(), realm: z.string(), name: z.string(), race: z.string(), class: z.string(),
  faction: z.enum(["Alliance", "Horde"]), level: z.number().int(), captured_at: z.string(),
  data: z.object({ equipped: z.array(z.object({ slot: z.string(), itemId: z.number().int().positive(), itemLevel: z.number().int().positive() })) }),
});
export type BoardRow = z.infer<typeof BoardRow>;

/** Each row scored, or left out with its reason; rows of an unknown shape are left out too. */
export function scoreRows(rows: readonly unknown[], files: (itemId: number) => ItemFileFacts | undefined): { entries: GearEntry[]; notCounted: Partial<Record<GearRefusal | "shape", number>> } {
  const entries: GearEntry[] = [];
  const notCounted: Partial<Record<GearRefusal | "shape", number>> = {};
  for (const raw of rows) {
    const r = BoardRow.safeParse(raw);
    if (!r.success) { notCounted.shape = (notCounted.shape ?? 0) + 1; continue; }
    const row = r.data;
    const n = gearNumbers(row.data.equipped, files);
    if (!n.ok) { notCounted[n.reason] = (notCounted[n.reason] ?? 0) + 1; continue; }
    const parts = realmParts(row.realm);
    entries.push({
      name: row.name, realm: row.realm, realmBase: parts.base, ruleset: parts.ruleset, region: realmRegion(row.realm),
      race: row.race, class: row.class, faction: row.faction, level: row.level,
      path: characterPath(row.ruleset || DEFAULT_RULESET, row.realm, row.name), capturedAt: row.captured_at,
      itemLevel: n.itemLevel, gearScore: n.gearScore,
    });
  }
  return { entries, notCounted };
}

const valueOf = (e: GearEntry, metric: GearMetric) => (metric === "item-level" ? e.itemLevel : e.gearScore);

/**
 * The board: entries in the filter, highest first; equal values share a rank (1, 1, 3), and within them the
 * earlier capture and then the name come first, so the order is stable. Ranks are within the filter.
 */
export function rankEntries<E extends GearEntry>(entries: readonly E[], metric: GearMetric, q: BoardQuery): RankedEntry<E>[] {
  const shown = entries.filter((e) => (!q.ruleset || e.ruleset === q.ruleset) && (!q.region || e.region === q.region));
  shown.sort((a, b) => valueOf(b, metric) - valueOf(a, metric) || a.capturedAt.localeCompare(b.capturedAt) || a.name.localeCompare(b.name));
  let rank = 0;
  return shown.map((entry, i) => {
    if (i === 0 || valueOf(entry, metric) !== valueOf(shown[i - 1]!, metric)) rank = i + 1;
    return { rank, entry };
  });
}

/** `?ruleset=pvp&region=us`; null when a value is not one we know (the page answers 404 rather than guess). */
export function boardQuery(search: Record<string, string | string[] | undefined>): BoardQuery | null {
  const one = (k: string) => (typeof search[k] === "string" ? (search[k] as string) : undefined);
  const ruleset = rulesetParam(one("ruleset"));
  const rawRegion = one("region");
  const region = rawRegion === undefined || rawRegion === "" ? null : (REGIONS as readonly string[]).includes(rawRegion) ? (rawRegion as Region) : undefined;
  if (ruleset === undefined || region === undefined) return null;
  return { ruleset, region };
}

export function boardHref(metric: GearMetric, q: BoardQuery): string {
  const params = new URLSearchParams();
  if (q.ruleset) params.set("ruleset", q.ruleset);
  if (q.region) params.set("region", q.region);
  const s = params.toString();
  return s ? `${gearBoardPath(metric)}?${s}` : gearBoardPath(metric);
}

/**
 * What the profile cron stores (snapshots/gear-board.json): every character it scored, and why each one it left out
 * was left out, by link. `watermark` is the newest `received_at` it has read, so the next run reads only gear received
 * since; `fullAt` is its last full pass (one a day). Only characters on the boards when it ran are in it, and a page
 * still filters it against the boards as they are now.
 */
export interface GearBoardSnapshot {
  version: 1; generatedAt: string; fullAt: string; watermark: string | null;
  entries: StoredEntry[]; refused: Record<string, GearRefusal | "shape">;
}

export type GearBoard =
  | { state: "unavailable" }
  | { state: "ready"; entries: StoredEntry[]; notCounted: number; generatedAt: string };

/** The stored boards as they may be shown now: only links in `live` (the links on the boards right now). */
export function liveBoard(snapshot: GearBoardSnapshot, live: ReadonlySet<string>): GearBoard {
  return {
    state: "ready",
    entries: snapshot.entries.filter((e) => live.has(e.linkId)),
    notCounted: Object.keys(snapshot.refused).filter((id) => live.has(id)).length,
    generatedAt: snapshot.generatedAt,
  };
}

/** "Updated 12 min ago", from the snapshot's time. */
export function updatedLine(generatedAt: string, now = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(generatedAt)) / 60_000));
  if (!Number.isFinite(minutes)) return "Update time unrecorded";
  if (minutes < 1) return "Updated just now";
  if (minutes < 120) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `Updated ${hours} h ago` : `Updated ${Math.floor(hours / 24)} days ago`;
}

/** What the game files say about the items: the inventory type from the client layer, the level from the tooltip facts. */
export async function itemFiles(ids: readonly number[]): Promise<((id: number) => ItemFileFacts | undefined) | null> {
  const assets = await loadSiteAssets();
  if (!assets) return null;
  const shown = await loadShownNames();
  // Only items a page may show the facts of (players reported them, or the item name rule names them): any other id
  // may be unreleased content, and gear holding one is not counted.
  const tips = await loadItemTips(assets, ids.filter((id) => shown.showsTip(id)));
  const inventory = new Map(CLIENT_LAYER.items.map((r) => [r[0], r[3]] as const));
  return (id) => {
    const tip = tips.get(id), inv = inventory.get(id);
    return tip && inv !== undefined && tip.level > 0 ? { inventoryType: inv, level: tip.level } : undefined;
  };
}

/**
 * The boards as a page shows them: the stored snapshot, filtered against the links on the boards right now. Both reads
 * must work; with either one out of reach the boards are unavailable, never shown unfiltered. Never throws.
 */
export async function loadGearBoard(): Promise<GearBoard> {
  try {
    const [snapshot, live] = await Promise.all([
      gearBoardStore().read(),
      authQuery<unknown>("rpc/ranked_gear_links", { method: "POST", body: "{}" }),
    ]);
    if (!snapshot || !Array.isArray(live)) return { state: "unavailable" };
    const ids = new Set(live.flatMap((r) => {
      const id = (r as { link_id?: unknown } | null)?.link_id;
      return typeof id === "string" ? [id] : [];
    }));
    return liveBoard(snapshot, ids);
  } catch {
    return { state: "unavailable" };
  }
}

/** One character's rank on both boards (no filter), or null when it is not on them. */
export function ranksOf<E extends GearEntry>(entries: readonly E[], realm: string, name: string): Record<GearMetric, RankedEntry<E>> | null {
  const hit = (r: RankedEntry<E>) => r.entry.realm.toLowerCase() === realm.toLowerCase() && r.entry.name.toLowerCase() === name.toLowerCase();
  const all: BoardQuery = { ruleset: null, region: null };
  const il = rankEntries(entries, "item-level", all).find(hit), gs = rankEntries(entries, "gear-score", all).find(hit);
  return il && gs ? { "item-level": il, "gear-score": gs } : null;
}
