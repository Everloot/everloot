import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));
/** A module specifier that climbs out of web/ into the knowledge code; a `new URL(...)` file path is not one. */
const RELATIVE_KB = /(?<!new URL\(\s*)(["'`])(\.\.\/)+kb\/src\b/;

test("web/src reaches the knowledge code through @kb/, never a relative path", () => {
  const offenders = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    // This file's own examples below are the only allowed ones.
    .filter((file) => /\.tsx?$/.test(file) && file !== "kb-alias.test.ts")
    .flatMap((file) => readFileSync(join(SRC, file), "utf8").split("\n").filter((line) => RELATIVE_KB.test(line)).map((line) => `${file}: ${line.trim()}`));
  expect(offenders).toEqual([]);
});

test("the check bites", () => {
  for (const line of ['import { openDb } from "../../../kb/src/db";', 'vi.mock("../../kb/src/market", () => ({}));', "await import('../../../../kb/src/guilds');"]) {
    expect(RELATIVE_KB.test(line), line).toBe(true);
  }
  for (const line of ['import { openDb } from "@kb/db";', 'new URL("../../../../../kb/src/catalog-index.ts", import.meta.url)', "// kb/src/market.ts keys it"]) {
    expect(RELATIVE_KB.test(line), line).toBe(false);
  }
});
