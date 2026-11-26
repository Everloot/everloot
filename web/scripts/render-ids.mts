/**
 * Writes the id lists `npm run kb -- client-renders` draws model pictures for, from the site's own gates
 * (docs/ASSETS.md, "Model pictures"), so nothing found only in the game files gets a picture:
 *   npcs.txt   every NPC the NPC list shows (npcRows, /database/npcs)
 *   items.txt  every item players reported under the 3-install rule (loadItemSeen, the item lists' "Seen" set)
 *
 *   cd web && npx tsx --tsconfig tsconfig.scripts.json scripts/render-ids.mts <out folder>
 *
 * It reads the corpus the way the site does: with the R2 and Supabase variables set, the live store; without
 * them, the upload files in web/data/uploads. It prints counts only, and writes ids, never names.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadItemSeen } from "../src/lib/item-seen";
import { computeRollups, loadWorldFacts } from "../src/lib/rollup-compute";
import { npcRows } from "../src/lib/world-lists";

const out = process.argv[2];
if (!out) {
  console.error("usage: npx tsx scripts/render-ids.mts <out folder>");
  process.exit(1);
}
const [facts, { rates }, seen] = await Promise.all([loadWorldFacts(), computeRollups(), loadItemSeen()]);
if (facts.unreachable || seen.unreachable) {
  console.error("The corpus could not be read; no lists written.");
  process.exit(1);
}
const npcs = npcRows(facts, rates).map((r) => r.npcId).sort((a, b) => a - b);
const items = [...seen.seen].sort((a, b) => a - b);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "npcs.txt"), `${npcs.join("\n")}\n`);
writeFileSync(join(out, "items.txt"), `${items.join("\n")}\n`);
console.log(`npcs: ${npcs.length} (the NPC list), items: ${items.length} (reported by 3 installs) -> ${out}`);
