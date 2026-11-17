import type { DisenchantResponse } from "@everloot/protocol";
import { allBandYields, bandLabel, placer, type BandYield, type DisenchantTables, type Placer } from "../../../kb/src/disenchant";
import { CLIENT_DISENCHANT } from "../data/game-data/client-disenchant";
import { loadDisenchantTables } from "./rollup-compute";

/**
 * The disenchant tables the pages, the tool and the API read: every band of the current build with what it yields,
 * and a placer that puts an item in its band (the files' level, else the one players reported). Unreachable storage
 * gives every band with no disenchants and `unreachable: true`, never zero.
 */
export interface DisenchantView {
  tables: DisenchantTables;
  yields: BandYield[];
  placer: Placer;
  dataAsOf: string | null;
  unreachable: boolean;
}

export async function loadDisenchant(): Promise<DisenchantView> {
  const { tables, unreachable, dataAsOf } = await loadDisenchantTables();
  const sort = placer(CLIENT_DISENCHANT, tables.playerBands);
  return { tables, yields: allBandYields(tables, sort.bands), placer: sort, dataAsOf, unreachable };
}

const QUALITY = { 2: "uncommon", 3: "rare", 4: "epic" } as const;

/** The API's bands: every band, materials only where 3 installs disenchanted in it. */
export function disenchantBands(yields: readonly BandYield[]): DisenchantResponse["bands"] {
  return yields.flatMap((y) => {
    const quality = QUALITY[y.band.quality as keyof typeof QUALITY];
    if (!quality) return [];
    return [{
      bandId: y.band.id,
      itemClass: y.band.itemClass === 2 ? "weapon" as const : "armor" as const,
      quality,
      minLevel: y.band.minLevel,
      maxLevel: y.band.maxLevel,
      label: bandLabel(y.band),
      state: y.state,
      windows: y.windows,
      installs: y.installs,
      first: y.first,
      last: y.last,
      missingInstalls: y.missingInstalls,
      materials: y.rows.map((r) => ({ itemId: r.materialId, withMaterial: r.withMaterial, chance: r.chance, perDisenchant: r.perDisenchant, min: r.min, max: r.max })),
    }];
  });
}

export const DISENCHANT_BUILD = CLIENT_DISENCHANT.build.version;
