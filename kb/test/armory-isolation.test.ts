import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/**
 * Blizzard's character data may show on pages, tools and API answers, but it never enters the CC BY-SA dataset, the
 * public corpus, the open-data snapshots or the bulk exports (data policy, amended 17 November 2026). This walks every
 * file those builds import, from their entry points, and fails if one reads the armory: its tables, its RPCs, its
 * store or the crawler's modules.
 */
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENTRIES = [
  "kb/src/corpus.ts",
  "kb/src/snapshot.ts",
  "kb/src/public-snapshot.ts",
  "kb/src/open-data/build.ts",
  "kb/src/open-data/write.ts",
  "kb/src/exporters/index.ts",
  "kb/src/exporters/cli.ts",
  "web/scripts/export-bulk.ts",
  "web/scripts/upload-bulk.mjs",
  "web/scripts/upload-open-data.mjs",
  "web/scripts/corpus-load.mts",
  "web/src/lib/open-data.ts",
];
/** What reading the armory looks like in source: a table or RPC name, the store, the crawler or the page loader. */
const ARMORY = /\barmory_[a-z_]+|armory-store|character-armory|\/armory\/(api|crawl|details|parse|store|index|gear)\b|public_character_armory/;
/** Comments may name the armory; only code that reads it counts. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const SPECIFIER = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gm;

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else if (spec.startsWith("@/")) base = resolve(repo, "web/src", spec.slice(2));
  else if (spec.startsWith("@kb/")) base = resolve(repo, "kb/src", spec.slice(4));
  else return null;
  const stem = base.replace(/\.(m?js)$/, "");
  for (const candidate of [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.mjs`, `${stem}.js`, `${stem}.json`, resolve(base, "index.ts")]) {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    return candidate.endsWith(".json") ? null : candidate;
  }
  return null;
}

/** Every repository source file the entry imports, the entry included. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(repo, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || file.includes("node_modules")) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      const next = resolveImport(file, m[1] ?? m[2] ?? m[3]!);
      if (next) queue.push(next);
    }
  }
  return seen;
}

test("the dataset, corpus, open data and bulk exports never read the armory", () => {
  const offenders: string[] = [];
  let files = 0;
  for (const entry of ENTRIES) {
    expect(existsSync(resolve(repo, entry)), entry).toBe(true);
    for (const file of reachable(entry)) {
      files++;
      if (ARMORY.test(code(readFileSync(file, "utf8")))) offenders.push(`${entry} -> ${relative(repo, file)}`);
    }
  }
  expect(files).toBeGreaterThan(ENTRIES.length);
  expect([...new Set(offenders)]).toEqual([]);
});

test("the check bites", () => {
  for (const source of ["rpc/armory_character", 'import { armoryStore } from "./armory-store";', 'from "../../../kb/src/armory/details"', "rpc/public_character_armory", 'from "@/lib/character-armory"']) {
    expect(ARMORY.test(source), source).toBe(true);
  }
  for (const source of ["Data from Blizzard Entertainment", "the armory boards", "/armory/rankings", "// read through armory-store.ts", "/** armory_board ranks */"]) {
    expect(ARMORY.test(code(source)), source).toBe(false);
  }
});
