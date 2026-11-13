import { z } from "zod";

/**
 * Blizzard auction house prices for one item (issue #1122), read from blizzard_auction_item
 * (supabase/migrations/20261113120000_blizzard_auctions.sql) with the service key.
 *
 * Blizzard Developer API Terms: the item database page is the only reader. Nothing here may feed an API route, an
 * export or open data, the MCP tools, chat answers, a sitemap or the addon price file (exclusions.test.ts checks
 * which files use it), and a page showing these rows places no ad. Never mixed with player-reported prices.
 */

export interface BlizzardPrice {
  region: "us" | "eu";
  houseId: number;
  houseName: string;
  snapshotAt: string;
  minUnit: number;
  typicalUnit: number;
  quantity: number;
  auctions: number;
}

// PostgREST sends bigint as a JSON number; a numeric string is accepted too.
const num = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]);
const Row = z
  .object({
    region: z.enum(["us", "eu"]),
    house_id: num,
    house_name: z.string(),
    snapshot_at: z.string().refine((s) => Number.isFinite(Date.parse(s))),
    min_unit: num,
    typical_unit: num,
    quantity: num,
    auctions: num,
  })
  .transform((r): BlizzardPrice => ({
    region: r.region, houseId: r.house_id, houseName: r.house_name, snapshotAt: new Date(r.snapshot_at).toISOString(),
    minUnit: r.min_unit, typicalUnit: r.typical_unit, quantity: r.quantity, auctions: r.auctions,
  }));

/**
 * The item's current Blizzard prices, one row per house that lists it. Empty, never thrown, when storage is not
 * configured, the migration is not applied yet (PostgREST answers 404), the tables are empty, the answer does not
 * match, or storage is slow: the page then shows no Blizzard section and keeps its ads.
 */
export async function loadBlizzardPrices(
  itemId: number,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<BlizzardPrice[]> {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || !Number.isSafeInteger(itemId) || itemId <= 0) return [];
  try {
    const response = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/rpc/blizzard_auction_item`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_item_id: itemId }),
    });
    if (!response.ok) return [];
    const parsed = z.array(Row).safeParse(await response.json());
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
