import { dungeonProgress, progressionCatalogue, type CharacterProgress, type ProgressionInstance, type ProgressionKill } from "@kb/progression";

/**
 * Dungeon and raid clears from synced boss-kill histories, the same public rows the Progress tab reads. Lifetime
 * per boss: a history holds one row per boss and difficulty with its first and last kill and kill count, so a boss
 * counts once across difficulties. There are no weekly lockouts here; the owner-published Raids section has those.
 */
export interface ClearKill extends ProgressionKill { firstKillAt?: string; killCount?: number }

export interface BossClear {
  id: number; name: string; killed: boolean;
  /** Summed across difficulties; null when not killed or the history has no count. */
  kills: number | null;
  firstKillDay: string | null; lastKillDay: string | null;
}
export interface InstanceClear {
  id: number; name: string; group: CharacterProgress["group"]; href?: string;
  killed: number; total: number; cleared: boolean;
  /** The day every boss had fallen at least once (exact: the latest of the bosses' first kills); null when not cleared or unknown. */
  firstClearDay: string | null;
  lastKillDay: string | null;
  bosses: BossClear[];
}
export interface DungeonsAndRaidsData {
  /** False when no synced history is available for the character: unknown, not "no kills". */
  synced: boolean;
  /** Tracked dungeons cleared, as the tooltip feed and Collection count them. */
  summary: { cleared: number; total: number } | null;
  /** Only instances with at least one boss killed, dungeons, then raids, then world bosses. */
  instances: InstanceClear[];
}

const day = (iso: string | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : null);
const latest = (days: (string | null)[]) => days.filter((d): d is string => d !== null).sort().at(-1) ?? null;

function bossClears(instance: ProgressionInstance, kills: readonly ClearKill[]): BossClear[] {
  return instance.bosses.map((boss) => {
    const rows = kills.filter((k) => k.instanceMapId === instance.id && k.encounterId === boss.id);
    if (!rows.length) return { id: boss.id, name: boss.name, killed: false, kills: null, firstKillDay: null, lastKillDay: null };
    const counted = rows.every((k) => typeof k.killCount === "number");
    const firsts = rows.map((k) => day(k.firstKillAt));
    return {
      id: boss.id, name: boss.name, killed: true,
      kills: counted ? rows.reduce((n, k) => n + k.killCount!, 0) : null,
      firstKillDay: firsts.every((d) => d !== null) ? (firsts as string[]).sort()[0]! : null,
      lastKillDay: latest(rows.map((k) => day(k.lastKillAt))),
    };
  });
}

function clearOf(instance: ProgressionInstance, kills: readonly ClearKill[]) {
  const bosses = bossClears(instance, kills);
  const killed = bosses.filter((b) => b.killed).length;
  const cleared = bosses.length > 0 && killed === bosses.length;
  const firsts = bosses.map((b) => b.firstKillDay);
  return {
    bosses, killed, total: bosses.length, cleared,
    firstClearDay: cleared && firsts.every((d) => d !== null) ? latest(firsts) : null,
    lastKillDay: latest(bosses.map((b) => b.lastKillDay)),
  };
}

/** One character's clears. `progress` is characterProgression's output for the same history. */
export function dungeonsAndRaids(progress: readonly CharacterProgress[], kills: readonly ClearKill[] | null,
  links: Readonly<Record<number, string>>): DungeonsAndRaidsData {
  if (kills === null) return { synced: false, summary: null, instances: [] };
  const instances = progress.filter((r) => (r.killed ?? 0) > 0).map((r): InstanceClear => ({
    id: r.id, name: r.name, group: r.group, ...(links[r.id] ? { href: links[r.id] } : {}), ...clearOf(r, kills),
  }));
  return { synced: true, summary: dungeonProgress(kills), instances };
}

export interface InstanceClearsRow { region: string; slug: string; name: string; surname: string; kills: readonly ClearKill[] }
export interface InstanceClears {
  /** Linked characters with a public kill here, among the ones read. */
  characters: number;
  /** Characters who have killed every boss, newest kill first. */
  clears: { region: string; slug: string; name: string; firstClearDay: string | null; lastKillDay: string | null }[];
  /** Per boss: how many of those characters killed it and their summed kills (null where a history has no count). */
  bosses: { id: number; name: string; characters: number; kills: number | null }[];
}

/** Clears of one instance from public histories; null when the files list no boss for it. */
export function instanceClears(mapId: number, rows: readonly InstanceClearsRow[]): InstanceClears | null {
  const instance = progressionCatalogue(null).find((r) => r.id === mapId);
  if (!instance || instance.bosses.length === 0) return null;
  const read = rows.map((row) => ({ row, clear: clearOf(instance, row.kills) })).filter((r) => r.clear.killed > 0);
  const clears = read.filter((r) => r.clear.cleared)
    .sort((a, b) => (b.clear.lastKillDay ?? "").localeCompare(a.clear.lastKillDay ?? ""))
    .map(({ row, clear }) => ({ region: row.region, slug: row.slug, name: `${row.name} ${row.surname}`, firstClearDay: clear.firstClearDay, lastKillDay: clear.lastKillDay }));
  const bosses = instance.bosses.map((boss, i) => {
    const mine = read.map((r) => r.clear.bosses[i]!).filter((b) => b.killed);
    return { id: boss.id, name: boss.name, characters: mine.length,
      kills: mine.every((b) => b.kills !== null) ? mine.reduce((n, b) => n + b.kills!, 0) : null };
  });
  return { characters: read.length, clears, bosses };
}
