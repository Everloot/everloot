"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, Input, SectionHeading } from "@/components/ui";
import { filterRecipes, type SearchRecipe } from "@/lib/profession-planner";
export default function RecipeSearch({ rows }: { rows: SearchRecipe[] }) {
  const status = rows.some(r => /^Spell \d+$/.test(r.name) || r.reagents.some(x => /^Item \d+$/.test(x.name))) ? "Some names are not available yet. Search by item or spell number where names are missing." : "";
  const [query,setQuery] = useState("");
  const [skill,setSkill] = useState("");
  const [limit,setLimit] = useState(50);
  const filtered = useMemo(()=>filterRecipes(rows,query,/^\d+$/.test(skill) ? Number(skill) : null),[rows,query,skill]);
  const results = filtered;
  return <section aria-labelledby="recipe-search" className="space-y-4">
    <SectionHeading id="recipe-search">Search recipes</SectionHeading>
    <Card className="space-y-3">
      <label className="block">Recipe, recipe item or material<Input className="mt-1" type="search" value={query} onChange={e=>{setQuery(e.target.value);setLimit(50);}} placeholder="Iron Ore" /></label>
      <div className="flex flex-wrap gap-4">
        <label>My skill<Input className="ml-2 max-w-24" type="number" min={1} max={500} value={skill} onChange={e=>{setSkill(e.target.value);setLimit(50);}} /></label>
      </div>
      <p className="text-sm text-muted">Recipe facts: found in game files, unconfirmed. Names follow the existing profession pages (player reports, game files or Warcraft Wiki). My skill hides grey recipes only when yellow and grey ranks are both recorded. A material match means the recipe uses that material; it may need others too. Recipe item requirements and sources not in our data are not confirmed yet.</p>
      <p className="text-sm text-muted">Recipe sources: Not confirmed yet.</p>
      <p role="status" className="text-sm text-muted">{`${results.length} recipes match.`} {status}</p>
    </Card>
    <ul className="space-y-3">{results.slice(0,limit).map(r=><li key={`${r.slug}-${r.spellId}`} className="rounded-card border border-line bg-panel p-3">
      <Link href={`/database/spells/${r.spellId}`} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{r.name}</Link> <Badge tone="files" />
      {r.itemName && <p className="text-sm text-muted">Makes: {r.itemName} {r.itemUnconfirmed && <Badge tone="files" />}</p>}
      <p className="text-sm text-muted">Materials: {r.reagents.length ? r.reagents.map(x=><span key={x.itemId} className="mr-2">{x.count} {x.name} {x.unconfirmed && <Badge tone="files" />}</span>) : "None recorded"}</p>
      {r.recipeItems.length>0 && <p className="text-sm text-muted">Recipe item (game files, unconfirmed): {r.recipeItems.map(x=><span key={x.itemId} className="mr-2">{x.name} {x.unconfirmed && <Badge tone="files" />}</span>)}</p>}
    </li>)}</ul>
    {results.length>limit && <button type="button" className="btn" onClick={()=>setLimit(n=>n+50)}>Show 50 more</button>}
  </section>;
}
