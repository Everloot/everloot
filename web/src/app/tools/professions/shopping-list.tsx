"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Card, CopyButton, Input, SectionHeading } from "@/components/ui";
import { formatCopper } from "@kb/profession-path";
import { cheapestPrices, planShopping, type ListedPrice, type PlannerRecipe, type SearchRecipe } from "@/lib/profession-planner";
import { SELECT_CLASS } from "./controls";
import { realmRuleset, RULESET_LABEL } from "@/lib/realms";

const KEY = "everloot.profession-shopping.market";
const HOUSES = ["Alliance","Horde","Neutral"];
type Preferences = { realm: string; ruleset: string; houses: string[] };
const defaults: Preferences = { realm:"",ruleset:"pvp",houses:HOUSES };
function remember(p: Preferences) { try { localStorage.setItem(KEY,JSON.stringify(p)); } catch { /* Device storage can be unavailable. */ } }
export default function ShoppingList({ profession, recipes, catalog = [], from = 1, to = 300 }: { profession: string; recipes: PlannerRecipe[]; catalog?: SearchRecipe[]; from?: number; to?: number }) {
  const totalRef = useRef<HTMLParagraphElement>(null);
  const [ready,setReady] = useState(false);
  const [start,setStart] = useState(String(from));
  const [end,setEnd] = useState(String(to));
  const [skipped,setSkipped] = useState<string[]>([]);
  const [prefs,setPrefs] = useState<Preferences>(defaults);
  const [marketRequest,setMarketRequest] = useState(0);
  const priceRequested=marketRequest>0;
  const [marketVersion,setMarketVersion] = useState(0);
  const [markets,setMarkets] = useState<Record<string,string[]>>({});
  const [listed,setListed] = useState<{key:string;rows:ListedPrice[];asOf:string|null;failed:string[]}>({key:"",rows:[],asOf:null,failed:[]});
  const [status,setStatus] = useState("Load auction prices to choose a realm.");
  const [copied,setCopied] = useState("");
  function change(next: Preferences) { setPrefs(next); remember(next); }
  useEffect(()=>{
    setReady(true);
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (saved && typeof saved.realm==="string" && typeof saved.ruleset==="string" && Array.isArray(saved.houses)) setPrefs({realm:saved.realm,ruleset:saved.ruleset,houses:saved.houses.filter((h:unknown)=>typeof h==="string" && HOUSES.includes(h))});
    } catch { /* Use the visible defaults. */ }
  },[]);
  useEffect(()=>{
    if (!priceRequested) return;
    const abort = new AbortController();
    fetch("/api/market/prices",{signal:abort.signal}).then(r=>{if(!r.ok) throw Error();return r.json();}).then(data=>{setMarkets(data.houses ?? {});setMarketVersion(marketRequest);setStatus("Choose a realm for listed prices.");}).catch(()=>{if(!abort.signal.aborted)setStatus("Auction prices are unavailable. Materials with no price stay unknown.");});
    return ()=>abort.abort();
  },[marketRequest,priceRequested]);
  const eligibleHouses = useMemo(()=>HOUSES.filter(h=>prefs.houses.includes(h) && markets[prefs.realm]?.includes(h)),[prefs.houses,markets,prefs.realm]);
  const priceKey = `${prefs.realm}|${eligibleHouses.join(",")}`;
  useEffect(()=>{
    if (!priceRequested || marketVersion!==marketRequest || !prefs.realm || eligibleHouses.length===0) return;
    const abort = new AbortController();
    setStatus("Loading listed prices…");
    const houses = eligibleHouses;
    Promise.allSettled(houses.map(async house=>{
      const q = new URLSearchParams({realm:prefs.realm,house});
      const response = await fetch(`/api/market/prices?${q}`,{signal:abort.signal});
      if (!response.ok) throw Error();
      const data = await response.json();
      if (!data.ok || !Array.isArray(data.items)) throw Error();
      return { asOf: typeof data.dataAsOf==="string" ? data.dataAsOf : null, rows:data.items.map((x:[number,number,number,number,number,string,number])=>({itemId:x[0],copper:x[2],day:x[5],house})) as ListedPrice[] };
    })).then(results=>{
      if (abort.signal.aborted) return;
      const parts=results.flatMap(p=>p.status==="fulfilled" ? [p.value] : []);
      const failed=houses.filter((_,i)=>results[i].status==="rejected");
      setListed({key:priceKey,rows:parts.flatMap(p=>p.rows),asOf:parts.map(p=>p.asOf).filter((s):s is string=>Boolean(s)).sort()[0] ?? null,failed});
      setStatus(failed.map(h=>`${h} unavailable`).join("; "));
    });
    return ()=>abort.abort();
  },[marketRequest,marketVersion,priceRequested,prefs.realm,eligibleHouses,priceKey]);
  const prices = useMemo(()=>cheapestPrices(listed.key===priceKey ? listed.rows : [],prefs.houses),[listed,priceKey,prefs.houses]);
  const ids = useMemo(()=>{
    const byName = new Map<string,Set<number>>();
    for (const r of catalog) for (const x of r.reagents) {
      const key=x.name.trim().toLowerCase(); const matches=byName.get(key) ?? new Set<number>();matches.add(x.itemId);byName.set(key,matches);
    }
    return new Map([...byName].filter(([,ids])=>ids.size===1).map(([name,ids])=>[name,[...ids][0]]));
  },[catalog]);
  const byName = Object.fromEntries([...ids].flatMap(([name,id])=>prices[id] ? [[name,prices[id].copper]] : []));
  let error="";
  let plan: ReturnType<typeof planShopping> | null = null;
  try { if (ready && start!=="" && end!=="") plan=planShopping(recipes,profession,Number(start),Number(end),skipped,byName); } catch(e) {error=(e as Error).message;}
  const requirements = (name:string) => {
    const matches=catalog.filter(r=>r.profession===profession && r.name.trim().toLowerCase()===name.trim().toLowerCase());
    return matches.length===1 ? matches[0].recipeItems : [];
  };
  const sourceText = (name:string) => {
    const items=requirements(name);
    return items.length ? "Teaching item (game files, unconfirmed): " + items.map(x=>`Item ${x.itemId}: source not confirmed yet`).join("; ") : "Recipe item requirement: Not confirmed yet";
  };
  const incompleteHouses=listed.key===priceKey && listed.failed.length>0;
  const pricing=`${incompleteHouses ? "Listed prices from available houses (comparison incomplete)" : "Listed prices, cheapest house you chose"} (${prefs.houses.join(", ") || "none"}), ${prefs.realm || "no realm chosen"}, as of ${listed.key===priceKey && listed.asOf ? listed.asOf : "time not available"}.`;
  const materialLines=plan?.reagents.map(r=>{
    const price=prices[ids.get(r.item.trim().toLowerCase()) ?? -1];
    return `${r.count} ${r.item} — ${price ? `${formatCopper(price.copper*r.count)} (${formatCopper(price.copper)} each, ${price.house}, ${price.day})` : "no price yet"}`;
  }) ?? [];
  const subtotal=plan?.reagents.reduce((sum,r)=>sum+(byName[r.item.trim().toLowerCase()] ?? 0)*r.count,0) ?? 0;
  const pricedMaterials=plan?.reagents.filter(r=>byName[r.item.trim().toLowerCase()]!==undefined).length ?? 0;
  const subtotalText=pricedMaterials ? `${formatCopper(subtotal)} for ${pricedMaterials} of ${plan?.reagents.length ?? 0} materials` : "no prices yet";
  const total=!incompleteHouses && plan && plan.steps.length>0 && plan.gaps.length===0 && plan.copper!==null ? formatCopper(plan.copper) : "no price yet (list incomplete)";
  const copy=[`${profession} shopping list, skill ${start}–${end}`,pricing,"Listed minima are medians of reporters' latest public scan day, not guaranteed live offers. Limited to the market API's most-listed items; absent prices stay unknown.",...materialLines,`Grand total: ${total}`,`Known material subtotal: ${subtotalText}`,"Counts use the agreed path's whole crafts; training and recipe item purchase costs are excluded.",...(plan?.steps.map(s=>`${s.fromSkill}–${s.toSkill}: ${s.recipe}, ${s.crafts} crafts. ${sourceText(s.recipe)}`) ?? []),...(plan?.gaps.map(g=>`No alternative agreed recipe for ${g.fromSkill}–${g.toSkill}.`) ?? [])].join("\n");
  return <section aria-labelledby="shopping-list" className="space-y-4">
    <SectionHeading id="shopping-list">Shopping list</SectionHeading>
    <Card className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <label>From skill<Input className="ml-2 max-w-24" type="number" min={1} max={500} value={start} onChange={e=>setStart(e.target.value)} /></label>
        <label>To skill<Input className="ml-2 max-w-24" type="number" min={1} max={500} value={end} onChange={e=>setEnd(e.target.value)} /></label>
        <button className="btn" type="button" onClick={()=>{setStart("1");setEnd("300");}}>Whole path: 1–300</button>
      </div>
      <button type="button" className="btn" onClick={()=>setMarketRequest(n=>n+1)}>{priceRequested ? "Refresh auction prices" : "Load auction prices"}</button>
      <div className="flex flex-wrap gap-4">
        <label>Ruleset<select className={SELECT_CLASS} value={prefs.ruleset} onChange={e=>change({...prefs,ruleset:e.target.value,realm:""})}>{Object.entries(RULESET_LABEL).map(([key,label])=><option value={key} key={key}>{label}</option>)}<option value="forever">Ruleset not confirmed</option></select></label>
        <label>Realm<select className={SELECT_CLASS} value={prefs.realm} onChange={e=>change({...prefs,realm:e.target.value})}><option value="">Choose a realm</option>{Object.keys(markets).filter(r=>realmRuleset(r)===prefs.ruleset).map(r=><option key={r} value={r}>{r}</option>)}</select></label>
      </div>
      <fieldset><legend>Houses I can buy from</legend><div className="flex flex-wrap gap-4">{HOUSES.map(h=><label key={h} className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={prefs.houses.includes(h)} onChange={e=>change({...prefs,houses:e.target.checked ? [...prefs.houses,h] : prefs.houses.filter(x=>x!==h)})} />{h}</label>)}</div></fieldset>
      <p className="text-sm text-muted">{pricing} Each material shows its house and scan day. Listed minima are medians of reporters&apos; latest public scan day, not guaranteed live offers. The price feed lists only its most-listed items; missing items have no price yet.</p>
      <p className="text-sm text-muted">Counts use the agreed path&apos;s whole crafts. Training and recipe item purchase costs are excluded. Teaching-item links from game files are unconfirmed and do not prove the item is required; other learning sources may exist. Missing links and acquisition sources are not confirmed yet.</p>
      {status && <p role="status" className="text-sm text-muted">{status}</p>}
      {error && <p role="status" className="text-danger">{error}</p>}
      {!ready && <p data-empty-state className="text-muted">The shopping list runs on your device. Enable JavaScript to plan a range.</p>}
      {plan && <>
        <ul className="space-y-2">{materialLines.map((line,i)=><li key={plan.reagents[i].item}>{line}</li>)}</ul>
        <p ref={totalRef} tabIndex={-1} className="font-medium">Grand total: {total}</p>
        <p className="text-sm text-muted">Known material subtotal: {subtotalText}</p>
        {plan.steps.length===0 && <p data-empty-state>No agreed recipes cover this range yet.</p>}
        <ul className="space-y-3">{plan.steps.map((step,i)=><li key={`${step.recipe}-${i}`} className="border-t border-line pt-3">
          <p>{step.fromSkill}–{step.toSkill}: {step.recipe} · {step.crafts} crafts</p>
          <p className="text-sm text-muted">Listed materials per craft: {step.copper===null ? "no price yet" : formatCopper(step.copper/step.crafts)}{step.trainingCopper!==undefined && ` · Agreed training cost (unscoped): ${step.trainingCopper===null ? "not recorded" : formatCopper(step.trainingCopper)}`}</p>
          <p className="text-sm text-muted">{sourceText(step.recipe)}</p>
          {requirements(step.recipe).map(x=><Link key={x.itemId} href={`/database/items/${x.itemId}`} className="mr-3 text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{x.name}{x.unconfirmed && <Badge tone="files" />}</Link>)}
          <button type="button" className="btn mt-2" onClick={()=>{setSkipped(s=>[...s,step.recipe]);totalRef.current?.focus();}}>Skip this recipe: {step.recipe}</button>
        </li>)}</ul>
        {plan.gaps.map(g=><p key={g.fromSkill}>No alternative agreed recipe for {g.fromSkill}–{g.toSkill}. This range is not included in the materials.</p>)}
        {skipped.length>0 && <button type="button" className="btn" onClick={()=>setSkipped([])}>Restore skipped recipes ({skipped.length})</button>}
        <CopyButton text={copy} label="Copy shopping list" onResult={(ok)=>setCopied(ok ? "Shopping list copied." : "Copy unavailable. Select the text below.")} />
        <p role="status" className="text-sm text-muted">{copied}</p>
        <details><summary className="cursor-pointer">Shopping list as text</summary><pre className="mt-2 whitespace-pre-wrap text-sm">{copy}</pre></details>
      </>}
    </Card>
  </section>;
}
