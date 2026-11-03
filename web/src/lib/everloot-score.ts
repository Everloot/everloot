import type { ScoreInstance } from "../../../kb/src/everloot-score";
import type { InstanceDef } from "../../../kb/src/guilds";
import type { InstanceRow } from "./instances";

/**
 * The bosses the Everloot Score counts (kb/src/everloot-score.ts): each instance's 3-install agreed boss list, the one
 * the guild ladder ranks (`instanceDefs`), with what the site's instance row adds from the game files: raid or dungeon,
 * the difficulties it has and its lowest level. Final bosses are not taken from here: the files' encounter order does
 * not say which boss is last, so they come from a curated list (`ProgressFacts.finalBosses`). An instance the files
 * give no level or difficulty scores nothing. Nothing reads this yet; the score is not shown anywhere until the
 * public-character policy is accepted.
 */
export function scoreInstances(defs: readonly InstanceDef[], rows: ReadonlyMap<number, Pick<InstanceRow, "raid" | "level" | "difficulties">>): ScoreInstance[] {
  return defs.map((d) => {
    const row = rows.get(d.instanceMapId);
    const raid = row?.raid ?? (d.instanceType === null ? null : d.instanceType === "raid");
    return {
      instanceMapId: d.instanceMapId,
      kind: raid === null ? null : raid ? "raid" : "dungeon",
      bosses: d.bosses.map((b) => b.encounterId),
      difficulties: [...(row?.difficulties ?? [])],
      ...(row?.level ? { minLevel: row.level.min } : {}),
    };
  });
}
