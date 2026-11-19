import { z } from "zod";

/**
 * Track 2, step 2: rollups. The agreement rule lives in kb/src/drop-rollup.ts
 * so the site and the item_page tool share one function.
 */
export {
  INDEPENDENT_INSTALLS,
  lootWindowsFromRecords,
  rollupDrops,
  type DropRate,
  type LootRow,
  type MeasuredZero,
  type RollupResult,
} from "@kb/drop-rollup";

export const rollupFile = z.object({
  generatedAt: z.string(),
  rates: z.array(z.object({
    sourceNpcId: z.number().optional(),
    sourceObjectId: z.number().optional(),
    itemId: z.number(),
    kills: z.number(),
    drops: z.number(),
    rate: z.number(),
    reporters: z.number(),
    public: z.boolean(),
  })),
});
export type RollupFile = z.infer<typeof rollupFile>;
