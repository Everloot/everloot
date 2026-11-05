import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

// The player and guild stores fetch with cache: "no-store". A page Next.js may keep (revalidate or
// generateStaticParams) refuses such a fetch at run time with "Page changed from static to dynamic", a 500 on every
// address. The character sighting page shipped that way and the realm page nearly did (#774).
const READS_STORE = /playerStore\(\)|loadGuild\w*\(|loadRealm\w*\(|searchPlayers\(|peopleSearch\(/;
const KEPT = /export (async )?function generateStaticParams|export const revalidate/;

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

test("every page that reads the player or guild store renders on each visit", () => {
  const readers = pages(__dirname).filter((path) => READS_STORE.test(readFileSync(path, "utf8")));
  // The guild pages and /players at least; an empty list would mean the pattern no longer finds the readers.
  expect(readers.length).toBeGreaterThanOrEqual(3);
  const kept = readers.filter((path) => {
    const source = readFileSync(path, "utf8");
    return !source.includes('export const dynamic = "force-dynamic"') || KEPT.test(source);
  }).map((path) => relative(__dirname, path).replaceAll("\\", "/"));
  expect(kept).toEqual([]);
});
