import { beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "@kb/market";
import { HOUSES, agreementSoFar, pendingRealms, realmBoards } from "./auction-house";
import { STAMP } from "./stored-view-freshness";

const shown = vi.hoisted(() => ({ loadShownNames: vi.fn() }));
vi.mock("./shown-item-names", () => ({ loadShownNames: shown.loadShownNames }));

import {
  BOARDS_REVISION, boardsFromFile, buildMarketBoards, fileIsCurrent, forgetMarketBoards, loadMarketBoards, parseBoards, writeMarketBoards, type BoardsFile,
} from "./market-boards";
import { auctionNames } from "../app/tools/auctions/art";

const now = new Date("2026-10-20T12:00:00.000Z");
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
/** One full scan per install; `items` are [itemId, unit market value] with 40 units each. */
const scans = (realm: string, faction: "Horde" | "Alliance", daysAgo: number, items: [number, number][], installs = ["install-a", "install-b", "install-c"]) =>
  installs.map((installId) => ({
    kind: "auction_snapshot", installId, capturedAt: at(daysAgo), realm, faction,
    items: items.map(([id, value]) => [id, 2, 40, value, value]),
  }));

// Made-up realms and ids. Forever has both houses, Nightfall only two reporters (below the gate).
const state = foldMarket(emptyMarket(), [
  ...scans("Forever", "Horde", 0, [[101, 205], [102, 33], [103, 100]]),
  ...scans("Forever", "Horde", 1, [[102, 30]]),
  ...scans("Forever", "Horde", 7, [[103, 80]]),
  ...scans("Forever", "Horde", 30, [[104, 950]]),
  ...scans("Forever", "Alliance", 0, [[101, 220], [105, 12]]),
  ...scans("Forever", "Alliance", 7, [[101, 200]]),
  ...scans("Mal'Ganis", "Horde", 0, [[101, 300]]),
  ...scans("CAMWOW US1 Realm 4 PvP", "Alliance", 0, [[101, 999]], ["install-x", "install-y"]),
], now);
const marketAsOf = at(0);
const NAMES = new Map([[101, "Made-up Cloth"], [102, "Made-up Herb"]]);
const names = async (ids: number[]) => new Map(ids.map((id) => [id, { name: NAMES.get(id) ?? null, quality: NAMES.has(id) ? "common" : null }]));
/** The file as a page reads it: through JSON, as the cron writes it. */
const roundTrip = async () => parseBoards(JSON.stringify(await buildMarketBoards(state, marketAsOf, now, names)))!;

beforeEach(() => {
  forgetMarketBoards();
  shown.loadShownNames.mockReset().mockResolvedValue({ agreed: new Map([[103, "Players' Name"]]), matched: null, degraded: false });
});

test("the stored boards equal what realmBoards builds, for every house and for all houses apart", async () => {
  const view = boardsFromFile(await roundTrip());
  for (const house of [null, ...HOUSES]) expect(view.boards(house)).toEqual(realmBoards(state, now, house));
  expect(view.boards(null).map((b) => b.realm.slug)).toEqual(["forever", "malganis"]);
  // Put together once per house per file.
  expect(view.boards("Horde")).toBe(view.boards("Horde"));
});

test("the realms below the gate and the agreement meter equal the rollup's, and no reporter is named", async () => {
  const file = await roundTrip();
  const view = boardsFromFile(file);
  expect(view.pending()).toEqual(pendingRealms(state, now));
  expect(view.pending().map((p) => p.slug)).toEqual(["camwow-us1-realm-4-pvp"]);
  for (const slug of ["forever", "malganis", "camwow-us1-realm-4-pvp", "nowhere"]) {
    for (const house of [null, ...HOUSES]) expect(view.agreement(slug, house)).toBe(agreementSoFar(state, slug, undefined, house));
  }
  expect(JSON.stringify(file)).not.toMatch(/install-/);
});

test("the names come from the file, and a page reads the names only for an id the file does not hold", async () => {
  const view = boardsFromFile(await roundTrip());
  expect(view.names!.get(101)).toBe("Made-up Cloth");
  expect(view.names!.get(103)).toBeNull();
  const fromFile = await auctionNames([101, 102, 103], new Map(), view.names);
  expect([...fromFile]).toEqual([[101, "Made-up Cloth"], [102, "Made-up Herb"]]);
  expect(shown.loadShownNames).not.toHaveBeenCalled();
  // 999 is on no board (a disenchanting material without a price): read as before.
  expect([...await auctionNames([101, 999, 103], new Map(), new Map([[101, "Made-up Cloth"]]))]).toEqual([[101, "Made-up Cloth"], [103, "Players' Name"]]);
  expect(shown.loadShownNames).toHaveBeenCalledTimes(1);
});

test("a file stands in only for its own rollup or an older one, on the day it was built", () => {
  const file = { marketAsOf, day: "2026-10-20" };
  expect(fileIsCurrent(file, { dataAsOf: marketAsOf }, now)).toBe(true);
  expect(fileIsCurrent(file, { dataAsOf: at(0.01) }, now)).toBe(true);
  expect(fileIsCurrent(file, { dataAsOf: new Date(now.getTime() + 60_000).toISOString() }, now)).toBe(false);
  expect(fileIsCurrent(file, { dataAsOf: marketAsOf }, new Date("2026-10-21T00:05:00.000Z"))).toBe(false);
  expect(fileIsCurrent(file, { dataAsOf: null }, now)).toBe(false);
});

test("a file of another revision or shape is not read", async () => {
  const file = await buildMarketBoards(state, marketAsOf, now, names);
  expect(parseBoards(JSON.stringify({ ...file, revision: "boards-0" }))).toBeNull();
  expect(parseBoards(JSON.stringify({ ...file, realms: null }))).toBeNull();
  expect(parseBoards("{")).toBeNull();
});

const cloud = { r2AccountId: "acct", r2AccessKeyId: "key", r2SecretAccessKey: "secret", r2Bucket: "uploads" };

test("pages read the file with a short keep and its ETag, and build live when it is stale, missing or unreadable", async () => {
  const body = JSON.stringify(await buildMarketBoards(state, marketAsOf, now, names));
  const seen: (string | null)[] = [];
  let reply: () => Response = () => new Response(body, { headers: { etag: '"one"' } });
  const fetch = vi.fn(async (req: Request) => {
    expect(req.url).toBe("https://acct.r2.cloudflarestorage.com/uploads/snapshots/market-boards.json");
    seen.push(req.headers.get("if-none-match"));
    return reply();
  }) as unknown as typeof globalThis.fetch;
  let clock = 0;
  const load = (dataAsOf: string) => loadMarketBoards({ state, dataAsOf }, now, { cloud, fetch, clock: () => clock });

  expect((await load(marketAsOf))!.source).toBe("file");
  expect((await load(marketAsOf))!.source).toBe("file");
  expect(seen).toEqual([null]);
  // A rollup newer than the file: the cron has not caught up, so the page builds the boards.
  const live = (await load(new Date(now.getTime() + 60_000).toISOString()))!;
  expect(live.source).toBe("live");
  expect(live.names).toBeNull();
  expect(live.boards(null)).toEqual(realmBoards(state, now));

  clock += 60_000;
  reply = () => new Response(null, { status: 304 });
  expect((await load(marketAsOf))!.source).toBe("file");
  expect(seen).toEqual([null, '"one"']);

  clock += 60_000;
  reply = () => new Response("not json", { status: 200 });
  expect((await load(marketAsOf))!.source).toBe("live");
  clock += 60_000;
  reply = () => new Response(null, { status: 404 });
  expect((await load(marketAsOf))!.source).toBe("live");
  expect(await loadMarketBoards({ state: null, dataAsOf: null }, now, { cloud, fetch })).toBeNull();
});

test("the cron writes the file when the rollup or the day changed, stamped with both and the revision", async () => {
  let stamp: string | null = null;
  const puts: string[] = [];
  const fetch = vi.fn(async (req: Request) => {
    if (req.method === "HEAD") return stamp === null ? new Response(null, { status: 404 }) : new Response(null, { headers: { [STAMP]: stamp } });
    if (req.method === "PUT") { stamp = req.headers.get(STAMP); puts.push(await req.text()); return new Response(null); }
    throw new Error(`unexpected ${req.method}`);
  }) as unknown as typeof globalThis.fetch;
  const run = (when: Date, dataAsOf = marketAsOf) => writeMarketBoards(when, { cloud, fetch, names, market: async () => ({ state, dataAsOf }) });

  const first = await run(now);
  expect(first).toMatchObject({ written: true });
  expect(stamp).toBe(`${marketAsOf};2026-10-20;${BOARDS_REVISION}`);
  const file = JSON.parse(puts[0]!) as BoardsFile;
  expect(file).toMatchObject({ version: 1, revision: BOARDS_REVISION, marketAsOf, day: "2026-10-20" });
  expect(first.bytes).toBe(new TextEncoder().encode(puts[0]!).length);

  expect(await run(new Date(now.getTime() + 60_000))).toEqual({ written: false });
  expect((await run(now, at(-0.01))).written).toBe(true);
  expect((await run(new Date("2026-10-21T00:05:00.000Z"), at(-0.01))).written).toBe(true);
  expect(puts).toHaveLength(3);
  await expect(writeMarketBoards(now, { cloud, fetch, names, market: async () => ({ state: null, dataAsOf: null }) })).rejects.toThrow("market unavailable");
});

test("the cron's names follow the Auction House pages' rule and refuse a degraded read", async () => {
  vi.resetModules();
  const fetch = vi.fn(async (req: Request) => (req.method === "HEAD" ? new Response(null, { status: 404 }) : new Response(null))) as unknown as typeof globalThis.fetch;
  shown.loadShownNames.mockResolvedValue({ agreed: new Map(), matched: null, degraded: true });
  await expect(writeMarketBoards(now, { cloud, fetch, market: async () => ({ state, dataAsOf: marketAsOf }) })).rejects.toThrow("item names unreachable");
});
