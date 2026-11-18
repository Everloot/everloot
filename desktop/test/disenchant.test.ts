import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { writePricesAddon } from "../../companion/src/prices";
import { fetchDisenchant, readDisenchantBlock, refreshMarket } from "../src/main/market";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-disenchant-")); dirs.push(d); return d; };
const material = { itemId: 10, withMaterial: 4, perDisenchant: 1.23456, min: 1, max: 3 };
const band = { bandId: 1, state: "rated", installs: 3, windows: 5, materials: [material] };
const now = new Date("2026-11-17T00:00:00Z");
const sendBody = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

test("rated yields only, bounded integer columns, mean rounded over all windows", async () => {
  const send = sendBody({ unreachable: false, dataAsOf: now.toISOString(), bands: [
    { ...band, state: "short" }, { ...band, installs: 2 }, { ...band, windows: 0 },
    { ...band, materials: [material, { ...material, itemId: 11, withMaterial: 6 }, { ...material, itemId: 12, min: -1 },
      { ...material, itemId: 13, perDisenchant: 4 }, { ...material, itemId: 14.5 }] },
  ] });
  const result = await fetchDisenchant("https://everloot.app", send, now);
  expect(result.rows).toEqual([[1, 10, 4, 5, 1235, 1, 3]]);
  expect(result.fetchedAt).toBe(now.toISOString());
  expect(vi.mocked(send).mock.calls[0][0]).toBe("https://everloot.app/api/rollups/disenchant");
});

test("unreachable, invalid shape and failed HTTP never mean an empty successful read", async () => {
  for (const body of [{ unreachable: true, bands: [] }, { bands: [] }, { unreachable: false, bands: {} }, null]) {
    await expect(fetchDisenchant("https://everloot.app", sendBody(body))).rejects.toThrow();
  }
  await expect(fetchDisenchant("https://everloot.app", (async () => new Response("", { status: 503 })) as typeof fetch)).rejects.toThrow("503");
});

test("file roundtrip, daily carryover, failure preserves the last good block, next success replaces it", async () => {
  const d = dir();
  const good = { dataAsOf: now.toISOString(), fetchedAt: now.toISOString(), rows: [[1, 10, 4, 5, 1235, 1, 3] as [number, number, number, number, number, number, number]] };
  writePricesAddon(d, [], undefined, undefined, good);
  expect(readDisenchantBlock(d)).toEqual(good);
  let attempts = 0;
  const fail = vi.fn(async (url: string) => { if (url.endsWith("/disenchant")) attempts++; return new Response("", { status: 503 }); }) as unknown as typeof fetch;
  const options = { svFiles: [], followed: [], addonsDir: d, endpoint: "https://everloot.app", send: fail };
  await refreshMarket({ ...options, now: new Date(now.getTime() + 3600_000) });
  expect(attempts).toBe(0);
  expect(readDisenchantBlock(d)).toEqual(good);
  await refreshMarket({ ...options, now: new Date(now.getTime() + 86400_000) });
  expect(attempts).toBe(1);
  expect(readDisenchantBlock(d)).toEqual(good);
  const next = new Date(now.getTime() + 2 * 86400_000);
  const send = vi.fn(async (url: string) => url.endsWith("/disenchant")
    ? new Response(JSON.stringify({ unreachable: false, bands: [] })) : new Response("", { status: 503 })) as unknown as typeof fetch;
  await refreshMarket({ ...options, send, now: next });
  expect(readDisenchantBlock(d)).toEqual({ rows: [], dataAsOf: null, fetchedAt: next.toISOString() });
  writePricesAddon(d, [], undefined, undefined, good);
  const path = join(d, "EverlootPrices/EverlootPrices.lua");
  writeFileSync(path, readFileSync(path, "utf8").replace("1235", "1236"));
  expect(readDisenchantBlock(d)).toBeNull();
});
