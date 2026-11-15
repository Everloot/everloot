"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, Input, SectionHeading } from "@/components/ui";
import { SELECT_CLASS } from "./controls";
import { filterRecipes, type SearchRecipe } from "@/lib/profession-planner";
export default function RecipeSearch() {
  const [rows,setRows] = useState<SearchRecipe[]>([]);
  const [status,setStatus] = useState("Loading recipe search…");
  const [query,setQuery] = useState("");
  const [skill,setSkill] = useState("");
  const [profession,setProfession] = useState("");
  const [limit,setLimit] = useState(50);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/tools/professions/recipe-catalog.json",{signal:abort.signal}).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(data => {
      setRows(data.recipes); setStatus(data.named ? "" : "Some names are not available yet. Search by item or spell number where names are missing.");
    }).catch(() => { if (!abort.signal.aborted) setStatus("Recipe search is unavailable. Try reloading the page."); });
    return () => abort.abort();
  },[]);
  const filtered = useMemo(()=>filterRecipes(rows,query,/^\d+$/.test(skill) ? Number(skill) : null),[rows,query,skill]);
  const counts = new Map<string,number>();
  for (const r of filtered) counts.set(r.profession,(counts.get(r.profession) ?? 0)+1);
  const results = filtered.filter(r=>!profession || r.profession===profession);
  return <section aria-labelledby="recipe-search" className="space-y-4">
    <SectionHeading id="recipe-search">Search recipes</SectionHeading>
    <Card className="space-y-3">
      <label className="block">Recipe, recipe item or material<Input className="mt-1" type="search" value={query} onChange={e=>{setQuery(e.target.value);setLimit(50);}} placeholder="Iron Ore" /></label>
      <div className="flex flex-wrap gap-4">
        <label>My skill<Input className="ml-2 max-w-24" type="number" min={1} max={500} value={skill} onChange={e=>{setSkill(e.target.value);setLimit(50);}} /></label>
        <label>Profession<select className={SELECT_CLASS} value={profession} onChange={e=>{setProfession(e.target.value);setLimit(50);}}><option value="">All professions ({filtered.length})</option>{[...new Set(rows.map(r=>r.profession))].map(p=><option key={p} value={p}>{p} ({counts.get(p) ?? 0})</option>)}</select></label>
      </div>
      <p className="text-sm text-muted">Recipe facts: found in game files, unconfirmed. Names follow the existing profession pages (player reports, game files or Warcraft Wiki). My skill hides grey recipes only when yellow and grey ranks are both recorded. A material match means the recipe uses that material; it may need others too. Recipe item requirements and sources not in our data are not confirmed yet.</p>
      <p className="text-sm text-muted">Game data © Blizzard Entertainment, Inc. Warcraft Wiki names: CC BY-SA 4.0. <Link href="/methodology#credits" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Sources and credits</Link>.</p>
      <p role="status" className="text-sm text-muted">{status || `${results.length} recipes match.`}</p>
    </Card>
    <ul className="space-y-3">{results.slice(0,limit).map(r=><li key={`${r.slug}-${r.spellId}`} className="rounded-card border border-line bg-panel p-3">
      <Link href={`/database/spells/${r.spellId}`} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{r.name}</Link>{" · "}<Link href={`/tools/professions/${r.slug}`} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{r.profession}</Link>
      {r.itemName && <p className="text-sm text-muted">Makes: {r.itemName}</p>}
      <p className="text-sm text-muted">Materials: {r.reagents.map(x=>`${x.count} ${x.name}`).join(", ") || "None recorded"}</p>
      {r.recipeItems.length>0 && <p className="text-sm text-muted">Recipe item (game files, unconfirmed): {r.recipeItems.map(x=>x.name).join(", ")}</p>}
    </li>)}</ul>
    {results.length>limit && <button type="button" className="btn" onClick={()=>setLimit(n=>n+50)}>Show 50 more</button>}
  </section>;
}
