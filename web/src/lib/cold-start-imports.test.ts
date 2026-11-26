import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const web = join(__dirname, "..", "..");

/** The source file a static import names, or null for a package import. */
function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(web, "src", spec.slice(2))
    : spec.startsWith("@kb/") ? join(web, "..", "kb", "src", spec.slice(4))
    : spec.startsWith(".") ? join(from, "..", spec) : null;
  if (base === null) return null;
  if (base.endsWith(".json")) return base;
  const bare = base.replace(/\.js$/, "");
  return [`${bare}.ts`, `${bare}.tsx`, join(bare, "index.ts"), join(bare, "index.tsx")].find((f) => existsSync(f)) ?? null;
}

/**
 * The chain of static imports from `entry` to the first file whose path contains `banned`, or null when none does.
 * A dynamic `import()` is not followed: its module loads only when the code runs it. Neither is `import type`, which
 * the build erases.
 */
function importChain(entry: string, banned: string): string[] | null {
  const parent = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (file.includes(banned)) {
      const chain: string[] = [];
      for (let at: string | null = file; at !== null; at = parent.get(at) ?? null) chain.unshift(at.slice(web.length - 3));
      return chain;
    }
    if (file.endsWith(".json")) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:^|[\s;}])(?:import|export)\s(?!type\s)(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']/gm)) {
      const next = resolve(file, match[1]);
      if (next !== null && !parent.has(next)) { parent.set(next, file); queue.push(next); }
    }
  }
  return null;
}

// The full client layer is 2.9 MB of JSON. Parsed, with its 48,000 relations rebuilt as objects, it adds about 20 MB to
// a Worker isolate that has 128 MB, and every request that lands on a fresh isolate pays for it. These pages are among
// the most requested HTML pages (crawlers included). They need only the item list, its categories and the game-file
// filters, which come from small cuts of the layer (scripts/item-categories.mjs), and the build stamp, which
// data/game-data/build-version.json holds.
test.each([
  "src/lib/items.ts",
  "src/app/page.tsx",
  "src/app/search/page.tsx",
  "src/app/database/(hub)/page.tsx",
  "src/app/database/items/page.tsx",
  "src/app/tools/auctions/page.tsx",
  "src/app/wiki/[slug]/page.tsx",
])("%s does not load the full client layer", (entry) => {
  expect(importChain(join(web, entry), "client-layer")).toBeNull();
});

// Better Auth's code is 0.7 MB and takes about 30 ms to load on a fresh isolate. The root layout (every page) and the
// Supabase helpers (the armory and account pages) need only its on/off switch until a request has a session to read.
test.each([
  "src/app/layout.tsx",
  "src/lib/supabase/server.ts",
])("%s does not load Better Auth until a session is read", (entry) => {
  expect(importChain(join(web, entry), join("lib", "auth", "auth.ts"))).toBeNull();
});

test("the import walk finds the layer where it is imported", () => {
  expect(importChain(join(web, "src", "lib", "edges.ts"), "client-layer")).not.toBeNull();
  expect(importChain(join(web, "src", "app", "sign-in", "page.tsx"), join("lib", "auth", "auth.ts"))).not.toBeNull();
});
