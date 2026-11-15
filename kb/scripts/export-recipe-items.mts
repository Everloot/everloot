/** Export readable teaching-item relations for the recipe search, from the matching Blizzard build.
 * Run from kb: npx tsx scripts/export-recipe-items.mts. No keys are loaded; encrypted blocks are skipped.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {openCdn,pinDefinitions} from "../src/client-extract.js";
import {CLIENT_TABLES} from "../src/client-snapshot.js";
import {recipeItemDetails} from "../src/client-recipes.js";
const recipes=JSON.parse(readFileSync("../web/src/data/game-data/client-recipes.json","utf8"));
const spells=new Set<number>(recipes.professions.flatMap((p:{recipes:number[][]})=>p.recipes.map(r=>r[0])));
const {build,source}=await openCdn("wowf");
if(build.version!==recipes.build.version) throw Error("Client build must match the current recipe export");
const definitions=await pinDefinitions();
const tables=new Map<string,Map<number,Record<string,unknown>>>();
const encryptedBlocksSkipped:Record<string,number>={};
for(const name of ["ItemEffect","ItemXItemEffect","SpellEffect"]){
 const rows=await source.read(CLIENT_TABLES[name]);
 if(!rows) throw Error(`Table absent: ${name}`);
 tables.set(name,rows.rows);encryptedBlocksSkipped[name]=rows.encryptedBlocks;
}
const details=recipeItemDetails(n=>tables.get(n),spells);
writeFileSync("../web/src/data/game-data/client-recipe-items.json",JSON.stringify({schema:"everloot.recipe-items/1",label:"Found in game files, unconfirmed",credit:recipes.credit,build,definitions,extractedAt:new Date().toISOString(),encryptedBlocksSkipped,...details},null,1)+"\n");
console.log(`${Object.keys(details.links).length} recipe spells`);
