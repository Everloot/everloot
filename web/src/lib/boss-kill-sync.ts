import { z } from "zod";
import { CHARACTER_KEY, INSTALL_ID } from "@everloot/protocol";
import { privateSyncOn } from "./private-sync";

/** Separate from public recordSchemas and public character facts: these kills are always private. */
export const bossKillOwned = z.object({
  kind: z.literal("boss_kill_owned"), installId: INSTALL_ID, characterKey: CHARACTER_KEY,
  capturedAt: z.string().datetime({ offset: true }).optional(),
  encounterId: z.number().int().positive().max(2_000_000_000),
  instanceMapId: z.number().int().positive().max(2_000_000_000),
  difficulty: z.number().int().nonnegative().max(1000),
  firstKillAt: z.string().datetime({ offset: true }), lastKillAt: z.string().datetime({ offset: true }),
  killCount: z.number().int().positive().max(2_000_000_000),
}).refine((r) => Date.parse(r.firstKillAt) <= Date.parse(r.lastKillAt))
  .transform((r) => ({ ...r, capturedAt: r.lastKillAt }));
export type BossKillRow = z.infer<typeof bossKillOwned>;
export function parseBossKillRow(value: unknown): BossKillRow | null {
  const result = bossKillOwned.safeParse(value);
  return result.success ? result.data : null;
}

/** No reads or writes of the new table until the maintainer enables this after applying the migration. */
export function bossKillSyncOn(env: Record<string, string | undefined> = process.env): boolean {
  return privateSyncOn(env) && env.EVERLOOT_BOSS_KILL_SYNC === "1";
}

/** Last kill, not the original capture time: the addon updates cumulative rows in place. */
export function bossKillCapture(rows: readonly BossKillRow[], now: Date) {
  const usable = rows.filter((r) => Date.parse(r.lastKillAt) <= now.getTime() + 86_400_000);
  if (!usable.length) return null;
  const latest = usable.reduce((a, b) => Date.parse(b.lastKillAt) > Date.parse(a.lastKillAt) ? b : a);
  const mine = usable.filter((r) => r.installId === latest.installId);
  if (new Set(mine.map((r) => r.characterKey)).size !== 1) return null;
  const by = new Map<string, BossKillRow>();
  for (const r of mine) {
    const key = `${r.instanceMapId}:${r.encounterId}:${r.difficulty}`;
    const had = by.get(key);
    if (!had || Date.parse(r.lastKillAt) > Date.parse(had.lastKillAt)) by.set(key, r);
  }
  return {
    installId: latest.installId, capturedAt: latest.lastKillAt,
    kills: [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, r]) => ({
      encounterId: r.encounterId, instanceMapId: r.instanceMapId, difficulty: r.difficulty,
      firstKillAt: r.firstKillAt, lastKillAt: r.lastKillAt, killCount: r.killCount,
    })),
  };
}
