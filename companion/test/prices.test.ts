import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { adler32 } from "../src/bridge/lua";
import { fetchRealmPrices, readRealms, refreshPrices, renderPricesAddon, PRICES_ADDON } from "../src/prices";
import { FIXTURE_DROPS, FIXTURE_REALMS } from "../scripts/write-prices-fixture";

const FIXTURE = new URL("../../addon/tests/fixtures/EverlootPrices.lua", import.meta.url);

const SV = `EverlootDB = {
["installId"] = "abcd-1234-ef56-7890",
["lastScans"] = { ["Forever"] = { ["scanId"] = "abcd-1", ["at"] = 1 } },
["records"] = {
["auction_snapshot"] = { { ["realm"] = "Forever", ["items"] = {} } },
["gold_snapshot"] = { { ["realm"] = "Nightfall", ["character"] = "Thrall" } },
["loot"] = { { ["sourceNpcId"] = 5 } },
},
}`;

test("realms come from the player's own auction scans, once each; guild and gold realms are never sent", () => {
  expect(readRealms(SV)).toEqual(["Forever"]);
  expect(readRealms("EverlootDB = {}")).toEqual([]);
  const more = SV.replace('["loot"]', '["auction_scan"] = { { ["realm"] = "Doomhowl" } }, ["price_seen"] = { { ["realm"] = "forever" } }, ["guild_snapshot"] = { { ["realm"] = "Secret" } }, ["loot"]');
  expect(readRealms(more)).toEqual(["Forever", "Doomhowl"]);
});

test("a long answer is cut to the site's row cap", async () => {
  const items = Array.from({ length: 2500 }, (_, i) => [i + 1, 5, 5, 5, 5, "2026-10-20", 3]);
  const prices = await fetchRealmPrices("https://e.example", "Forever", vi.fn().mockResolvedValue(Response.json({ ...body, items })));
  expect(prices.items).toHaveLength(2000);
});

const body = {
  ok: true, realm: "Forever", dataAsOf: "2026-10-20T06:30:00.000Z",
  fields: ["itemId", "market", "min", "historical", "quantity", "day", "reporters"],
  items: [[2589, 205, 200, 190, 40, "2026-10-20", 3], [765, null, 30, 33, 900, "2026-10-05", 4]],
};

test("a realm's prices are fetched and every tuple is checked", async () => {
  const send = vi.fn().mockResolvedValue(Response.json({ ...body, items: [...body.items, [1, "x"], [2, 1, 1, 1, 1, "bad day", 1]] }));
  const prices = await fetchRealmPrices("https://everloot.example", "Forever", send);
  expect(send.mock.calls[0][0]).toBe("https://everloot.example/api/market/prices?realm=Forever");
  expect(prices).toEqual({ realm: "Forever", dataAsOf: "2026-10-20T06:30:00.000Z", items: body.items });
});

test("a failed fetch is an error, never an empty price list", async () => {
  await expect(fetchRealmPrices("https://e.example", "Forever", vi.fn().mockResolvedValue(Response.json({ ok: false }, { status: 503 }))))
    .rejects.toThrow(/503/);
});

test("the slot addon holds one checksummed string per realm and matches the golden file", () => {
  const { toc, lua } = renderPricesAddon(FIXTURE_REALMS, FIXTURE_DROPS);
  expect(toc).toContain(`${PRICES_ADDON}.lua`);
  const data = "2589,205,200,190,40,2026-10-20,3;765,,30,33,900,2026-10-05,4";
  expect(lua).toContain(`["data"] = "${data}"`);
  expect(lua).toContain(`["sum"] = ${adler32(data)}`);
  // Keys are lower-cased so the addon's GetRealmName():lower() finds them.
  expect(lua).toContain('["forever"] = {');
  // A hostile realm name stays a string literal.
  expect(lua).not.toMatch(/\n[^"\n]*os\.execute/);
  expect(lua).toBe(readFileSync(FIXTURE, "utf8").replace(/\r\n/g, "\n"));
});

test("drop rates sit beside the realms in one checksummed string, grouped by item and best rate first", () => {
  const { lua } = renderPricesAddon(FIXTURE_REALMS, FIXTURE_DROPS);
  const data = "2589,n,116,42,340,5;2589,n,94,12,200,3;2589,n,474,5,120,4;2589,n,6,1,90,3;2770,o,1731,300,310,6;12345,n,61,1,80,3";
  expect(lua).toContain(`}, ["drops"] = { ["data"] = "${data}", ["sum"] = ${adler32(data)}, ["dataAsOf"] = "2026-10-20T06:00:00.000Z", ["fetchedAt"] = "2026-10-20T06:30:00.000Z" } }`);
  // Without drops the file ends as it did before drops existed.
  expect(renderPricesAddon(FIXTURE_REALMS).lua).toMatch(/\n\} \}\n$/);
  expect(renderPricesAddon(FIXTURE_REALMS).lua).not.toContain("drops");
});

test("realm keys lower-case ASCII only, as Lua's string.lower does", () => {
  const { lua } = renderPricesAddon([{ realm: "Ärden Forever", dataAsOf: null, items: [] }]);
  expect(lua).toContain('["Ärden forever"]');
});

test("refresh writes the slot addon for the realms in the file, and keeps the old one on any failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-prices-"));
  const sv = join(dir, "Everloot.lua");
  writeFileSync(sv, SV.replace("gold_snapshot", "auction_scan"));
  const addons = join(dir, "AddOns");
  const ok = vi.fn(async (url: string) => Response.json({ ...body, realm: url.includes("Nightfall") ? "Nightfall" : "Forever" }));
  expect(await refreshPrices({ svFiles: [sv], addonsDir: addons, endpoint: "https://e.example", fetch: ok as unknown as typeof fetch }))
    .toEqual({ realms: 2, items: 4 });
  const written = join(addons, PRICES_ADDON, `${PRICES_ADDON}.lua`);
  const before = readFileSync(written, "utf8");
  expect(before).toContain('["nightfall"]');

  const down = vi.fn().mockResolvedValue(new Response("down", { status: 500 }));
  await expect(refreshPrices({ svFiles: [sv], addonsDir: addons, endpoint: "https://e.example", fetch: down })).rejects.toThrow(/500/);
  expect(readFileSync(written, "utf8")).toBe(before);
  expect(existsSync(join(addons, PRICES_ADDON, `${PRICES_ADDON}.toc`))).toBe(true);
});
