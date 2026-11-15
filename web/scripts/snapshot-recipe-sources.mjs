/** Snapshot only public, agreed acquisition relations for linked teaching items. */
import {readFileSync,writeFileSync} from "node:fs";
const items=new Set(Object.values(JSON.parse(readFileSync("src/data/game-data/client-recipe-items.json","utf8")).links).flat());
const source="https://everloot.app/api/edges";
const sources={};let dataAsOf=null;
for(const rel of ["sold_by","dropped_by","reward_from"]){
 let next=`${source}?from_kind=item&rel=${rel}&evidence=observed&limit=100`;
 let read=0;let total=null;
 while(next){
  const url=new URL(next,source);
  if(url.origin!=="https://everloot.app" || url.pathname!=="/api/edges") throw Error("Unexpected source page");
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw Error(`Source page returned ${response.status}`);
  const page=await response.json();
  if(page.unreachable || !Array.isArray(page.edges)) throw Error("Sources unavailable");
  if(dataAsOf && page.dataAsOf!==dataAsOf) throw Error("Source snapshot changed during pagination; retry");
  dataAsOf=page.dataAsOf;total=page.total;read+=page.edges.length;
  for(const edge of page.edges) if(items.has(edge.fromId) && edge.evidence==="observed" && edge.installs>=3){
   (sources[edge.fromId] ??= []).push({rel:edge.rel,kind:edge.toKind,id:edge.toId,lastSeen:edge.lastSeen});
  }
  next=page.next;
 }
 if(read!==total) throw Error(`Incomplete ${rel} pagination`);
}
writeFileSync("src/data/profession-recipe-sources.json",JSON.stringify({source,capturedAt:new Date().toISOString(),dataAsOf,licence:"CC BY-SA 4.0",sources},null,1)+"\n");
console.log(`${Object.keys(sources).length} teaching items with agreed acquisition sources, as of ${dataAsOf}`);
