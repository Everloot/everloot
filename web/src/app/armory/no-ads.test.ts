import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { isAdFreePath } from "@/lib/document-boundary";

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

// Not placing a slot is not enough: AdSense Auto ads fills any page its script loads on. The armory is on the ad-free
// list, so the script never loads there (components/OptionalScripts.tsx) and a move to it loads a new document.
test("the armory is an ad-free path, so the ad script never loads on it", () => {
  for (const path of ["/armory", "/armory/us/a-character", "/armory/eu/guilds/a-guild", "/armory/rankings/item-level", "/armory/submit"]) {
    expect(isAdFreePath(path), path).toBe(true);
  }
  expect(isAdFreePath("/armoryx")).toBe(false);
  expect(isAdFreePath("/database/items/954")).toBe(false);
});

test("the check bites", () => {
  expect(AD.test('import AdSlot from "@/components/AdSlot";')).toBe(true);
  expect(AD.test("<ins className=\"adsbygoogle\" />")).toBe(true);
  expect(AD.test("Data from Blizzard Entertainment")).toBe(false);
});
