import { z } from "zod";

/**
 * Blizzard auction house prices for one item (issue #1122), read from blizzard_auction_item
 * (supabase/migrations/20261113120000_blizzard_auctions.sql) with the service key.
 *
 * Blizzard Developer API Terms: the Blizzard auction page (app/blizzard-auctions/[id]) is the only reader. It is an
 * ad-free page (data/ad-free-paths.json): AdSense loads on every other public page, the item pages included, so no
 * page with ads may read this. Nothing here may feed an API route, an export or open data, the MCP tools, chat
 * answers, a sitemap or the addon price file (blizzard-auctions.test.ts checks which files use it). Never mixed
 * with player-reported prices.
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
 * What the page shows: the rows (none when nothing is stored for the item, or the migration is not applied yet,
 * so the job has never run), or that the read failed. A failure is never shown as "no data".
 */
export type BlizzardRead = { ok: true; rows: BlizzardPrice[] } | { ok: false };

/**
 * The item's current Blizzard prices, one row per house that lists it, each with the time Blizzard published it.
 * Never throws: storage not configured, an error answer, a malformed answer or a read slower than 2.5 s are
 * `{ ok: false }`. Only PostgREST's "function not found" (PGRST202: the migration is not applied) counts as no rows.
 */
export async function loadBlizzardPrices(
  itemId: number,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<BlizzardRead> {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return { ok: true, rows: [] };
  if (!url || !key) return { ok: false };
  try {
    const response = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/rpc/blizzard_auction_item`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_item_id: itemId }),
    });
    if (response.status === 404) {
      const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
      return body?.code === "PGRST202" ? { ok: true, rows: [] } : { ok: false };
    }
    if (!response.ok) return { ok: false };
    const parsed = z.array(Row).safeParse(await response.json());
    return parsed.success ? { ok: true, rows: parsed.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}
