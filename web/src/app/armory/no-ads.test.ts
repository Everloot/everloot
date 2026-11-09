import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// Blizzard's Developer API Terms: the armory pages carry no ad. Every file in this folder, tests included except this
// one, is read for an ad component or the ad script.
const here = fileURLToPath(new URL(".", import.meta.url));
const self = fileURLToPath(import.meta.url);
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
const AD = new RegExp(["Ad" + "Slot", "ads" + "bygoogle", "Ad" + "Sense", "components/Ad"].join("|"));

test("no armory file places an ad", () => {
  const sources = files(here).filter((f) => /\.(tsx?|css)$/.test(f) && f !== self);
  expect(sources.length).toBeGreaterThan(5);
  const offenders = sources.filter((f) => AD.test(readFileSync(f, "utf8"))).map((f) => relative(here, f));
  expect(offenders).toEqual([]);
});

test("the check bites", () => {
  expect(AD.test('import AdSlot from "@/components/AdSlot";')).toBe(true);
  expect(AD.test("<ins className=\"adsbygoogle\" />")).toBe(true);
  expect(AD.test("Data from Blizzard Entertainment")).toBe(false);
});
