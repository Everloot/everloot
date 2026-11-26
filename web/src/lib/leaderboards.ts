import { loadGuildProgressionRanking, type GuildProgressionRank } from "./progression";
import { unstable_cache } from "next/cache";
import { ARMORY_BOARDS, ARMORY_METRICS, armoryOn, isArmoryRegion, type ArmoryMetric, type ArmoryRegion } from "./armory";
import { loadGuildDirectory } from "./armory-guilds";
import { armoryStore, type ArmoryBoardRow, type ArmoryGuildRow } from "./armory-store";
import { GUILD_SEARCH_TAG, guildsOn, loadGuildData, loadLadder, raidsOpen, type RankedRow } from "./guilds";
import { PLAYER_SEARCH_TAG } from "@/app/players/player-view";
import { playerStore } from "./player-store";

// The leaderboards the /rankings hub leads with: every armory character board as a card with its top three, guild
// gear, and the progression ladder from members' uploads. Each is a preview of a page that lists everything; the hub
// never computes a rank itself.

/** Rows each guild board previews; its full list is one link away. */
export const BOARD_PREVIEW = 10;
/** Rows each character board's card shows: the head of the board, its full list one link away. */
export const BOARD_TOP = 3;

/** One character board's top three, US and EU ranked together (or the region chosen): null rows when the armory could not be read. */
export interface BoardTop { metric: ArmoryMetric; rows: ArmoryBoardRow[] | null }
/**
 * The guild gear board keeps guilds with at least this many members read (owner decision D6, the benchmark's
 * recommended default, awaiting the owner): one member's gear is not a guild's. The full directory still lists them all.
 */
export const GUILD_GEAR_MIN_READ = 5;

/**
 * Guilds by the average item level of the members read, newest read first among equals (the directory's order).
 * `minRead` is the minimum the database applied; absent until 20261126110000_armory_honest_ranks.sql is applied.
 */
export type GuildGear = { state: "ready"; rows: ArmoryGuildRow[]; minRead?: number } | { state: "not-ready" } | { state: "unreachable" };
/** The newest raid's ladder: its top rows, the raid's name, whether raids have opened, and whether uploads could be read. */
export interface RaidProgress { rows: RankedRow[]; instance: string | null; open: boolean; unreachable: boolean }

export interface Leaderboards {
  progression?: GuildProgressionRank[];
  region: ArmoryRegion | null;
  /** Every board's top, in board order; null while the armory is off. */
  characters: BoardTop[] | null;
  /** Null while the armory is off. */
  guildGear: GuildGear | null;
  bestOfClass: ArmoryBoardRow[] | null;
  /** Null while guild progression is off. */
  raids: RaidProgress | null;
}

/** `?region=us|eu` in any casing, anything else every region. */
export function leaderboardRegion(raw: string | undefined): ArmoryRegion | null {
  const r = raw?.toLowerCase();
  return isArmoryRegion(r) ? r : null;
}

/** The guild hide list, or null when it could not be read (then no guild is listed). */
async function hiddenGuilds(): Promise<Set<string> | null> {
  try { return await playerStore().hiddenGuilds(); } catch { return null; }
}

/** The boards' reads are kept five minutes (the metric pages keep theirs thirty); a hide clears them through its tags. */
const BOARDS_KEPT_SECONDS = 300;

/** Every board's top three, one read of three rows each; a board the store could not answer is null, the others still come. */
const boardTops = unstable_cache(async (region: ArmoryRegion | null): Promise<BoardTop[]> => {
  const store = armoryStore();
  return Promise.all(ARMORY_METRICS.map(async (metric) => ({
    metric,
    rows: await store.boardFiltered(ARMORY_BOARDS[metric].key, region, null, null, null, BOARD_TOP).catch(() => null),
  })));
}, ["rankings-board-tops"], { revalidate: BOARDS_KEPT_SECONDS, tags: [PLAYER_SEARCH_TAG] });

const bestOfClass = unstable_cache(async (region: ArmoryRegion | null) =>
  armoryStore().topPerClass("gear_score", region, null),
  ["rankings-best-of-class"], { revalidate: BOARDS_KEPT_SECONDS, tags: [PLAYER_SEARCH_TAG] });

/** The directory's top of the average-item-level sort; an unreachable read throws, so it is never kept. */
const guildGear = unstable_cache(async (region: ArmoryRegion | null): Promise<GuildGear> => {
  const dir = await loadGuildDirectory({ prefix: null, region, ruleset: null, sort: "item-level", page: 1 }, await hiddenGuilds(), GUILD_GEAR_MIN_READ);
  if (dir.state === "unreachable") throw new Error("guild directory unreachable");
  if (dir.state !== "ready") return { state: "not-ready" };
  // A guild with no member read has no gear to rank by.
  const rows = dir.rows.filter((g) => g.averageItemLevel !== null).slice(0, BOARD_PREVIEW);
  return dir.minRead === undefined ? { state: "ready", rows } : { state: "ready", rows, minRead: dir.minRead };
}, ["rankings-guild-gear"], { revalidate: BOARDS_KEPT_SECONDS, tags: [GUILD_SEARCH_TAG, PLAYER_SEARCH_TAG] });

/** The newest raid's ladder; a dungeon ladder (the only kind before raids open) is not raid progress, so it stays empty. */
async function raidProgress(): Promise<RaidProgress> {
  const open = raidsOpen();
  const data = await loadGuildData();
  if (data.unreachable) return { rows: [], instance: null, open, unreachable: true };
  const view = await loadLadder(data, {});
  if (view.instance?.instanceType !== "raid") return { rows: [], instance: null, open, unreachable: false };
  return { rows: view.rows.slice(0, BOARD_PREVIEW), instance: view.instance.name, open, unreachable: false };
}

/** Every board at once; a board that cannot be read says so on its own, never the whole hub. */
export async function loadLeaderboards(region: ArmoryRegion | null): Promise<Leaderboards> {
  const armory = armoryOn();
  const [characters, gear, raids, best] = await Promise.all([
    armory ? boardTops(region) : null,
    armory ? guildGear(region).catch((): GuildGear => ({ state: "unreachable" })) : null,
    guildsOn() ? raidProgress().catch((): RaidProgress => ({ rows: [], instance: null, open: raidsOpen(), unreachable: true })) : null,
    armory ? bestOfClass(region).catch(() => null) : null,
  ]);
  const progression = armory ? await loadGuildProgressionRanking(region) : [];
  return { region, characters, guildGear: gear, raids, bestOfClass: best, ...(progression.length ? { progression } : {}) };
}
