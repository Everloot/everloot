import { z } from "zod";

/**
 * Blizzard auction house prices and daily history, read through the dedicated SQL functions with the service key
 * (supabase/migrations/20261113120000_blizzard_auctions.sql and 20261115160000_blizzard_auction_browse.sql).
 *
 * Blizzard Developer API Terms: only the Blizzard auction pages (app/blizzard-auctions) may read this. Each is an
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
const Kind = z.enum(["items", "commodities"]);
const HouseRow = z.object({
  item_id: num, kind: Kind, snapshot_at: z.string().refine((s) => Number.isFinite(Date.parse(s))),
  min_unit: num, typical_unit: num, quantity: num, auctions: num,
}).transform((r) => ({
  itemId: r.item_id, kind: r.kind, snapshotAt: new Date(r.snapshot_at).toISOString(),
  minUnit: r.min_unit, typicalUnit: r.typical_unit, quantity: r.quantity, auctions: r.auctions,
}));
const HistoryRow = z.object({
  region: z.enum(["us", "eu"]), house_id: num, house_name: z.string(), kind: Kind,
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  snapshot_at: z.string().refine((s) => Number.isFinite(Date.parse(s))),
  min_unit: num, typical_unit: num, quantity: num, auctions: num,
}).transform((r) => ({
  region: r.region, houseId: r.house_id, houseName: r.house_name, kind: r.kind, day: r.day,
  snapshotAt: new Date(r.snapshot_at).toISOString(), minUnit: r.min_unit, typicalUnit: r.typical_unit,
  quantity: r.quantity, auctions: r.auctions,
}));

export type BlizzardHouseItem = z.output<typeof HouseRow>;
export type BlizzardHistoryPrice = z.output<typeof HistoryRow>;
export type BlizzardBrowseRead<T> = { ok: true; rows: T[] } | { ok: false; reason: "unavailable" | "failed" };

/** Page-only readers: paginate past PostgREST's row limit, never return a partial read as a complete result. */
async function browseRead<T>(
  rpc: string, args: Record<string, string | number>, schema: z.ZodType<T>,
  env: Record<string, string | undefined>, fetchImpl: typeof fetch,
): Promise<BlizzardBrowseRead<T>> {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return { ok: false, reason: "failed" };
  const rows: T[] = [];
  try {
    const signal = AbortSignal.timeout(2_500);
    for (let offset = 0; ; offset += 1000) {
      const response = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/rpc/${rpc}?limit=1000&offset=${offset}`, {
        method: "POST", cache: "no-store", signal,
        headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (response.status === 404) {
        const body = await response.json().catch(() => null);
        return { ok: false, reason: body?.code === "PGRST202" ? "unavailable" : "failed" };
      }
      if (!response.ok) return { ok: false, reason: "failed" };
      const parsed = z.array(schema).safeParse(await response.json());
      if (!parsed.success) return { ok: false, reason: "failed" };
      rows.push(...parsed.data);
      if (parsed.data.length < 1000) return { ok: true, rows };
    }
  } catch { return { ok: false, reason: "failed" }; }
}

export function loadBlizzardHouseItems(region: "us" | "eu", houseId: number,
  env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch,
): Promise<BlizzardBrowseRead<BlizzardHouseItem>> {
  return browseRead("blizzard_auction_house_items", { p_region: region, p_house_id: houseId }, HouseRow, env, fetchImpl);
}

export function loadBlizzardHistory(itemId: number,
  env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch,
): Promise<BlizzardBrowseRead<BlizzardHistoryPrice>> {
  return browseRead("blizzard_auction_item_history", { p_item_id: itemId }, HistoryRow, env, fetchImpl);
}

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
