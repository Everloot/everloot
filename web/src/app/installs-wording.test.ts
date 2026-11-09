import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

// Distinct install ids do not prove independent players, so the site counts "3 installs", never "3 players"
// (the upload guide states the rule), and every table names that count "Installs" (#819). The auction pages
// count upload addresses and say so on the page, so they are left out. The scan covers all of web/src.
const PLAYERS_COUNT = /\b(?:three|3) players\b/i;
const OTHER_HEADERS = /header: "(?:Install IDs|Reporters)"/;
const LEFT_OUT = [/[\\/]tools[\\/]auctions[\\/]/, /[\\/]docs[\\/]guides[\\/]upload[\\/]page\.tsx$/];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");

test("every page counts installs, not players, under one column name", () => {
  const root = join(__dirname, "..");
  const files = sources(root).filter((path) => !LEFT_OUT.some((skip) => skip.test(path)));
  expect(files.length).toBeGreaterThan(100);
  const players = files.filter((path) => PLAYERS_COUNT.test(withoutComments(readFileSync(path, "utf8"))));
  const headers = files.filter((path) => OTHER_HEADERS.test(readFileSync(path, "utf8")));
  const names = (paths: string[]) => paths.map((path) => relative(root, path).replaceAll("\\", "/"));
  expect(names(players)).toEqual([]);
  expect(names(headers)).toEqual([]);
});
