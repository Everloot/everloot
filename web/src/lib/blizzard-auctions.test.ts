import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";
import { loadBlizzardPrices } from "./blizzard-auctions";

const env = { SUPABASE_URL: "https://example.test/", SUPABASE_SERVICE_ROLE_KEY: "test-key" };
const row = { region: "us", house_id: 110, house_name: "Alliance Auction House", snapshot_at: "2026-11-13T12:22:37+00:00", min_unit: 150, typical_unit: "172", quantity: 26, auctions: 3 };

test("reads one item's rows through blizzard_auction_item with the service key", async () => {
  const fetchImpl = vi.fn(async () => Response.json([row]));
  expect(await loadBlizzardPrices(954, env, fetchImpl as unknown as typeof fetch)).toEqual([
    { region: "us", houseId: 110, houseName: "Alliance Auction House", snapshotAt: "2026-11-13T12:22:37.000Z", minUnit: 150, typicalUnit: 172, quantity: 26, auctions: 3 },
  ]);
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://example.test/rest/v1/rpc/blizzard_auction_item");
  expect(JSON.parse(String(init.body))).toEqual({ p_item_id: 954 });
  expect(new Headers(init.headers).get("apikey")).toBe("test-key");
});

test("degrades to no rows, never an error: unconfigured, migration not applied, down, slow or malformed", async () => {
  const never = vi.fn();
  expect(await loadBlizzardPrices(954, {}, never as unknown as typeof fetch)).toEqual([]);
  expect(never).not.toHaveBeenCalled();
  const answers: (() => Promise<Response>)[] = [
    async () => Response.json({ code: "PGRST202", message: "Could not find the function public.blizzard_auction_item" }, { status: 404 }),
    async () => Response.json({ code: "42P01", message: 'relation "public.blizzard_auction_houses" does not exist' }, { status: 400 }),
    async () => new Response("bad gateway", { status: 502 }),
    async () => { throw new TypeError("fetch failed"); },
    async () => { throw new DOMException("timed out", "TimeoutError"); },
    async () => Response.json([{ ...row, region: "kr" }]),
    async () => new Response("not json"),
    async () => Response.json([]),
  ];
  for (const answer of answers) expect(await loadBlizzardPrices(954, env, answer as unknown as typeof fetch)).toEqual([]);
});

// Blizzard Developer API Terms: the data reaches Everloot's own pages only. These are the only files that may name the
// store, its functions or the loader. A new reader (an API route, the MCP tools, chat answers, open data or bulk exports,
// a sitemap, the addon price file, the Desktop App) fails here until someone decides it is allowed, which the terms
// say it is not.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const ALLOWED = [
  "web/src/lib/blizzard-auctions.ts",
  "web/src/app/database/items/[id]/blizzard-auctions.tsx",
  "web/src/app/database/items/[id]/page.tsx",
  "kb/src/cli.ts",
];
/** The hourly job's own folder. */
const JOB = "kb/src/blizzard-auctions/";
const SCANNED = ["web/src", "kb/src", "kb/scripts", "packages/protocol/src", "integrations", "addon", "companion/src", "desktop/src", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", "data", "media"]);
const files = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (SKIP_DIRS.has(e.name) ? [] : files(join(dir, e.name))) : /\.(tsx?|m?js|lua|py|json)$/.test(e.name) ? [join(dir, e.name)] : [],
      )
    : [];
const BLIZZARD = /blizzard_auction|blizzard-auctions|loadBlizzardPrices|BlizzardPrice|BlizzardAuctions/;

test("Blizzard auction data stays out of MCP, chat, exports, open data, API routes, sitemaps and the addon", () => {
  const sources = SCANNED.flatMap((d) => files(join(root, d))).filter((f) => !/\.test\.tsx?$|[\\/]test[\\/]|[\\/]tests[\\/]/.test(f));
  expect(sources.length).toBeGreaterThan(500);
  const users = sources.filter((f) => BLIZZARD.test(readFileSync(f, "utf8"))).map((f) => relative(root, f).replaceAll("\\", "/")).filter((f) => !f.startsWith(JOB)).sort();
  expect(users).toEqual([...ALLOWED].sort());
});

test("the exclusion check bites", () => {
  expect(BLIZZARD.test('import { loadBlizzardPrices } from "@/lib/blizzard-auctions";')).toBe(true);
  expect(BLIZZARD.test('rpc("blizzard_auction_item", { p_item_id })')).toBe(true);
  expect(BLIZZARD.test("from public.blizzard_auction_prices")).toBe(true);
  expect(BLIZZARD.test('import { MarketBox } from "@/app/tools/auctions/MarketBox";')).toBe(false);
  // The game's own auction UI addon, which Everloot's addon hooks, is not this data.
  expect(BLIZZARD.test('C_AddOns.IsAddOnLoaded("Blizzard_AuctionHouseUI")')).toBe(false);
});
