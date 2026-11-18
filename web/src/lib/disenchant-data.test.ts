import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { disenchantLua } from "../../../kb/src/disenchant-lua";
import table from "../data/game-data/client-disenchant.json";

test("addon disenchant classification exactly matches the current game-file extract", () => {
  expect(readFileSync(resolve(import.meta.dirname, "../../../addon/modules/disenchant_data.lua"), "utf8").replace(/\r\n/g, "\n")).toBe(disenchantLua(table));
});
