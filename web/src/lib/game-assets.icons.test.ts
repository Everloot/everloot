import v8 from "node:v8";
import vm from "node:vm";
import { expect, test } from "vitest";
import { iconUrl, parseSiteManifest } from "./game-assets";
import { siteManifest } from "./game-assets.fixture";

// The icon tables (spell id -> icon file and the like) are most of a manifest: the live one carries ~32k spell icons. A page
// reads them through `get`, `has`, `size` and `keys`; these tests hold that what it reads is unchanged and that an isolate
// keeps the tables small.

const BASE = "https://assets.example.test/wow_classic_beta-70450-84bea423";
const SIZE = 32_000;
// Spread out like real spell ids, with file ids in the range real icons use.
const bigTable = () => Object.fromEntries(Array.from({ length: SIZE }, (_, i) => [String(1 + i * 13), `${132_000 + ((i * 7919) % 900_000)}.webp`]));
const gc = () => { v8.setFlagsFromString("--expose-gc"); return vm.runInNewContext("gc") as () => void; };

test("every icon id reads the same URL, presence and order as the manifest's table", () => {
  const spellIcons = bigTable();
  const a = parseSiteManifest({ ...siteManifest, spellIcons, achievementIcons: { "627": "236755.webp" }, petIcons: {}, currencyIcons: { "1792": "1.webp" } }, BASE)!;
  expect(a.spellIcons.size).toBe(SIZE);
  for (const [id, file] of Object.entries(spellIcons)) {
    expect(a.spellIcons.get(Number(id))).toBe(iconUrl(BASE, file));
    expect(a.spellIcons.has(Number(id))).toBe(true);
  }
  for (const miss of [0, 2, 15, 1 + SIZE * 13, -1, 1.5, 2 ** 40]) {
    expect(a.spellIcons.get(miss)).toBeUndefined();
    expect(a.spellIcons.has(miss)).toBe(false);
  }
  expect([...a.spellIcons.keys()]).toEqual(Object.keys(spellIcons).map(Number));
  expect(a.achievementIcons.get(627)).toBe(`${BASE}/icons/236755.webp`);
  expect(a.currencyIcons.get(1792)).toBe(`${BASE}/icons/1.webp`);
  expect(a.petIcons.size).toBe(0);
});

test("an icon table the compact form does not cover still reads as before: other paths, odd ids, ids past 32 bits", () => {
  const spellIcons = { "7": "sub/7.webp", "01": "12.webp", "x": "13.webp", "4294967296": "14.webp", "9": "0099.webp" };
  const a = parseSiteManifest({ ...siteManifest, spellIcons }, BASE)!;
  expect(a.spellIcons.get(7)).toBe(`${BASE}/icons/sub/7.webp`);
  expect(a.spellIcons.get(1)).toBe(`${BASE}/icons/12.webp`);
  expect(a.spellIcons.get(4294967296)).toBe(`${BASE}/icons/14.webp`);
  expect(a.spellIcons.get(9)).toBe(`${BASE}/icons/0099.webp`);
  // A key that is not a number is left out, as before.
  expect(a.spellIcons.size).toBe(4);
});

test("a page's isolate keeps a 32k-entry spell icon table in well under a megabyte, and not the table it was read from", async () => {
  const collect = gc();
  let json: Record<string, unknown> | null = { ...siteManifest, spellIcons: bigTable() };
  const raw = new WeakRef(json.spellIcons as object);
  collect();
  const before = process.memoryUsage().heapUsed;
  const a = parseSiteManifest(json, BASE)!;
  // Measured while the manifest is still held, so what the parse keeps is not hidden by the manifest being freed.
  collect();
  const kept = process.memoryUsage().heapUsed - before;
  json = null;
  await new Promise((r) => setTimeout(r, 0));
  collect();
  expect(raw.deref()).toBeUndefined();
  expect(a.spellIcons.size).toBe(SIZE);
  expect(kept).toBeLessThan(1_000_000);
});
