/** Refresh the recipe search's name snapshot from Everloot's own rendered profession pages.
 * Use only the current build, and only names those pages already show under the item/spell name rules.
 * This runs explicitly during data maintenance, never on a page request or a production build.
 */
import { writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { CLIENT_PROFESSIONS, RECIPES_BUILD } from "../src/lib/professions.ts";
const spells = {};
const items = {};
const source = "https://everloot.app/tools/professions";
for (const p of CLIENT_PROFESSIONS) {
  const response = await fetch(`${source}/${p.slug}`,{signal:AbortSignal.timeout(60_000)});
  if (!response.ok) throw Error(`Profession page returned ${response.status}: ${p.slug}`);
  const html=await response.text();
  if (!html.includes(`build ${RECIPES_BUILD}`)) throw Error(`Profession build mismatch: ${p.slug}`);
  const document=new JSDOM(html).window.document;
  for (const a of document.querySelectorAll("[data-recipes] a[href]")) {
    const match=/^\/database\/(items|spells)\/(\d+)(?:-|$)/.exec(a.getAttribute("href") ?? "");
    const name=a.textContent?.trim();
    if (!match || !name || /^(?:Item|Spell) \d+$/.test(name)) continue;
    (match[1]==="items" ? items : spells)[match[2]]=name;
  }
  document.defaultView?.close();
  console.log(`${p.slug}: names read`);
}
writeFileSync("src/data/profession-search-names.json",JSON.stringify({build:RECIPES_BUILD,source,capturedAt:new Date().toISOString(),spells,items},null,1)+"\n");
console.log(`${Object.keys(spells).length} spell names; ${Object.keys(items).length} item names`);
