import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  ahledgerItemUrl, ahledgerMarket, ahledgerMarketLabel, ahledgerMarkets, ahledgerRegionMarkets, isAhledgerMarket, itemsParam, lifetimes,
  tooltipPrices,
} from "./ahledger";

test("each ruleset, faction and region maps to AH Ledger's market id", () => {
  expect(ahledgerMarket("pvp", "horde", "us")).toBe("forever.pvp.horde.us");
  expect(ahledgerMarket("normal", "alliance", "eu")).toBe("forever.normal.alliance.eu");
  expect(ahledgerMarket("rp", "alliance", "kr")).toBe("forever.rp.alliance.kr");
  expect(ahledgerMarket("rp-pvp", "horde", "eu")).toBe("forever.rppvp.horde.eu");
  // AH Ledger's kr markets also hold the Taiwanese realms.
  expect(ahledgerMarket("pvp", "alliance", "tw")).toBe("forever.pvp.alliance.kr");
  // No AH Ledger market for Hardcore or the pre-launch view.
  expect(ahledgerMarket("hardcore", "horde", "us")).toBeNull();
  expect(ahledgerMarket("forever", "horde", "us")).toBeNull();
  expect(ahledgerMarkets("hardcore", "us")).toEqual([]);
  expect(ahledgerMarkets("rp-pvp", "us")).toEqual(["forever.rppvp.alliance.us", "forever.rppvp.horde.us"]);
});

test("a region lists its eight markets in the auction pages' ruleset order, and each is a valid id with a label", () => {
  const us = ahledgerRegionMarkets("us");
  expect(us).toEqual([
    "forever.normal.alliance.us", "forever.normal.horde.us", "forever.pvp.alliance.us", "forever.pvp.horde.us",
    "forever.rp.alliance.us", "forever.rp.horde.us", "forever.rppvp.alliance.us", "forever.rppvp.horde.us",
  ]);
  expect(us.every(isAhledgerMarket)).toBe(true);
  expect(us.map(ahledgerMarketLabel)).toEqual(["PvE Alliance", "PvE Horde", "PvP Alliance", "PvP Horde", "RP Alliance", "RP Horde", "RP-PvP Alliance", "RP-PvP Horde"]);
  for (const bad of ["forever.pvp.neutral.us", "forever.hardcore.horde.us", "classic.pvp.horde.us", "forever.pvp.horde.us/../x", ""]) {
    expect(isAhledgerMarket(bad)).toBe(false);
  }
  expect(ahledgerItemUrl(2589, "forever.pvp.horde.us")).toBe("https://ahledger.com/items/2589/forever.pvp.horde.us");
});

test("only AH Ledger's public lifetimes are passed on, the shared one from s-maxage", () => {
  expect(lifetimes("public, max-age=300, s-maxage=600")).toEqual({ browser: 300, shared: 600 });
  expect(lifetimes("public, max-age=300")).toEqual({ browser: 300, shared: 300 });
  expect(lifetimes("Public, Max-Age=60")).toEqual({ browser: 60, shared: 60 });
  for (const kept of ["private, max-age=60", "public, no-store", "public, no-cache, max-age=60", "public", "max-age=60", null]) {
    expect(lifetimes(kept)).toBeNull();
  }
});

test("items is 1 to 100 distinct positive ids", () => {
  expect(itemsParam("2589")).toEqual([2589]);
  expect(itemsParam("2589,2592,4306")).toEqual([2589, 2592, 4306]);
  expect(itemsParam(Array.from({ length: 100 }, (_, i) => i + 1).join(","))).toHaveLength(100);
  for (const bad of [null, "", "0", "-1", "2589,", "2589,2589", "1.5", "abc", "2589 2592", Array.from({ length: 101 }, (_, i) => i + 1).join(",")]) {
    expect(itemsParam(bad)).toBeNull();
  }
});

test("a tooltip answer keeps only the price fields, and rows without an id are dropped", () => {
  const body = {
    market: { slug: "forever/pvp/horde/us", label: "PvP Horde US" },
    items: [
      { id: 2589, name: "Linen Cloth", icon: "https://render.worldofwarcraft.com/x.jpg", level: 5, median: 43, minBuyout: 20, quantity: 9085, observedAt: "2026-11-15T15:03:06.000Z", salesPerDay: 18095.4 },
      { id: 12784, median: null, minBuyout: "12", quantity: 0 },
      { name: "no id" },
    ],
  };
  expect(tooltipPrices(body)).toEqual([
    { itemId: 2589, minBuyout: 20, median: 43, quantity: 9085, salesPerDay: 18095.4, observedAt: "2026-11-15T15:03:06.000Z" },
    { itemId: 12784, minBuyout: null, median: null, quantity: 0, salesPerDay: null, observedAt: null },
  ]);
  expect(tooltipPrices({ error: "nope" })).toEqual([]);
  expect(tooltipPrices(null)).toEqual([]);
});

// AH Ledger's terms: free for community tools with a credit link, answers kept no longer than their cache time, and
// no keeping or redistributing the data. Only these files may name it; a new reader (the MCP tools, Chat, the API's
// own data, open data or bulk exports, a sitemap, the addon price file, the Desktop App, the kb) fails here until
// someone checks the terms allow it.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const ALLOWED = [
  "web/src/lib/ahledger.ts",
  "web/src/app/api/ahledger/[market]/route.ts",
  "web/src/app/tools/auctions/AhledgerPrices.tsx",
  "web/src/app/tools/auctions/item/[itemId]/page.tsx",
  "web/src/app/tools/auctions/[realm]/[itemId]/page.tsx",
  // Names AH Ledger only to say how the house-to-ruleset mapping was worked out; it keeps none of its prices.
  "web/src/lib/blizzard-houses.ts",
];
const SCANNED = ["web/src", "kb/src", "kb/scripts", "packages/protocol/src", "integrations", "addon", "companion/src", "desktop/src", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", "media"]);
const files = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (SKIP_DIRS.has(e.name) ? [] : files(join(dir, e.name))) : /\.(tsx?|m?js|lua|py|json)$/.test(e.name) ? [join(dir, e.name)] : [],
      )
    : [];
const AHLEDGER = /ahledger/i;

test("AH Ledger prices stay out of MCP, chat, exports, open data, sitemaps, the kb and the addon", () => {
  const sources = SCANNED.flatMap((d) => files(join(root, d))).filter((f) => !/\.test\.tsx?$|[\\/]test[\\/]|[\\/]tests[\\/]/.test(f));
  expect(sources.length).toBeGreaterThan(500);
  const users = sources.filter((f) => AHLEDGER.test(readFileSync(f, "utf8"))).map((f) => relative(root, f).replaceAll("\\", "/")).sort();
  expect(users).toEqual([...ALLOWED].sort());
});
