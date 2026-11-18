// Run from web/: npx tsx scripts/build-disenchant-data.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { disenchantLua } from "../../kb/src/disenchant-lua";

const root = resolve(import.meta.dirname, "../..");
const table = JSON.parse(readFileSync(resolve(root, "web/src/data/game-data/client-disenchant.json"), "utf8"));
writeFileSync(resolve(root, "addon/modules/disenchant_data.lua"), disenchantLua(table));
