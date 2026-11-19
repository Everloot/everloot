import { unstable_cache } from "next/cache";
import { ARMORY_BOARDS, ARMORY_METRICS, armoryOn, isArmoryRegion, type ArmoryMetric, type ArmoryRegion } from "./armory";
import { loadGuildDirectory } from "./armory-guilds";
import { armoryStore, type ArmoryBoardRow, type ArmoryGuildRow } from "./armory-store";
import { GUILD_SEARCH_TAG, guildsOn, loadGuildData, loadLadder, raidsOpen, type RankedRow } from "./guilds";
import { PLAYER_SEARCH_TAG } from "@/app/players/player-view";
import { playerStore } from "./player-store";

// The leaderboards the /rankings hub leads with: the armory's character boards and guild gear, and the progression
// ladder from members' uploads. Each is a preview of a page that lists everything; the hub never computes a rank itself.

/** Rows each board previews; its full list is one link away. */
export const BOARD_PREVIEW = 10;

/** One character board: null rows when the armory could not be read. */
export interface CharacterBoard { metric: ArmoryMetric; rows: ArmoryBoardRow[] | null }
/** Guilds by the average item level of the members read, newest read first among equals (the directory's order). */
export type GuildGear = { state: "ready"; rows: ArmoryGuildRow[] } | { state: "not-ready" } | { state: "unreachable" };
/** The newest raid's ladder: its top rows, the raid's name, whether raids have opened, and whether uploads could be read. */
export interface RaidProgress { rows: RankedRow[]; instance: string | null; open: boolean; unreachable: boolean }

export interface Leaderboards {
  region: ArmoryRegion | null;
  /** Null while the armory is off. */
  characters: CharacterBoard[] | null;
  /** Null while the armory is off. */
  guildGear: GuildGear | null;
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

/** The three boards at once; a board the store could not answer is null, the others still come. */
const characterBoards = unstable_cache(async (region: ArmoryRegion | null): Promise<CharacterBoard[]> => {
  const store = armoryStore();
  return Promise.all(ARMORY_METRICS.map(async (metric) => ({
    metric,
    rows: await store.board(ARMORY_BOARDS[metric].key, region, null, BOARD_PREVIEW).catch(() => null),
  })));
}, ["rankings-character-boards"], { revalidate: BOARDS_KEPT_SECONDS, tags: [PLAYER_SEARCH_TAG] });

/** The directory's top of the average-item-level sort; an unreachable read throws, so it is never kept. */
const guildGear = unstable_cache(async (region: ArmoryRegion | null): Promise<GuildGear> => {
  const dir = await loadGuildDirectory({ prefix: null, region, ruleset: null, sort: "item-level", page: 1 }, await hiddenGuilds());
  if (dir.state === "unreachable") throw new Error("guild directory unreachable");
  if (dir.state !== "ready") return { state: "not-ready" };
  // A guild with no member read has no gear to rank by.
  return { state: "ready", rows: dir.rows.filter((g) => g.averageItemLevel !== null).slice(0, BOARD_PREVIEW) };
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
  const [characters, gear, raids] = await Promise.all([
    armory ? characterBoards(region) : null,
    armory ? guildGear(region).catch((): GuildGear => ({ state: "unreachable" })) : null,
    guildsOn() ? raidProgress().catch((): RaidProgress => ({ rows: [], instance: null, open: raidsOpen(), unreachable: true })) : null,
  ]);
  return { region, characters, guildGear: gear, raids };
}
