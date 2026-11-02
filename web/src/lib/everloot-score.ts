import type { ScoreInstance } from "../../../kb/src/everloot-score";
import type { InstanceDef } from "../../../kb/src/guilds";
import type { InstanceRow } from "./instances";

/**
 * The bosses the Everloot Score counts (kb/src/everloot-score.ts): each instance's 3-install agreed boss list, the one
 * the guild ladder ranks (`instanceDefs`), with what the site's instance row adds from the game files: raid or dungeon,
 * the lowest level for the level check, and the final boss, the last encounter the files list for a dungeon. A final
 * boss nobody has agreed on yet is not on the list, so it scores nothing until it is. Nothing reads this yet; the
 * score is not shown anywhere until the public-character policy is accepted.
 */
export function scoreInstances(defs: readonly InstanceDef[], rows: ReadonlyMap<number, Pick<InstanceRow, "raid" | "level" | "encounters">>): ScoreInstance[] {
  return defs.map((d) => {
    const row = rows.get(d.instanceMapId);
    const raid = row?.raid ?? (d.instanceType === null ? null : d.instanceType === "raid");
    const kind = raid === null ? null : raid ? "raid" : "dungeon";
    const last = row?.encounters.at(-1)?.id;
    return {
      instanceMapId: d.instanceMapId,
      kind,
      bosses: d.bosses.map((b) => b.encounterId),
      ...(kind === "dungeon" && last !== undefined ? { finalBoss: last } : {}),
      ...(row?.level ? { minLevel: row.level.min } : {}),
    };
  });
}
