// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import ShoppingList from "./shopping-list";
import * as planner from "@/lib/profession-planner";
vi.mock("@/lib/profession-planner", async original => {
 const m = await original<typeof import("@/lib/profession-planner")>();
 return {...m,planShopping:vi.fn(m.planShopping)};
});
const recipes = [
 {profession:"Alchemy",recipe:"Potion",skillMin:1,skillMax:10,points:1,reagents:[{item:"Iron Ore",count:2}],reporters:3},
 {profession:"Alchemy",recipe:"Other potion",skillMin:1,skillMax:10,points:1,reagents:[{item:"Iron Ore",count:3}],reporters:3},
];
const catalog = [{profession:"Alchemy",slug:"alchemy",spellId:1,name:"Potion",itemName:"Potion",yellow:10,grey:20,reagents:[{itemId:1,name:"Iron Ore",count:2}],recipeItems:[{itemId:2,name:"Recipe: Potion",unconfirmed:true,sources:[]}]}];
let root: Root | null = null;
afterEach(async()=>{if(root) await act(async()=>root!.unmount());root=null;vi.unstubAllGlobals();localStorage.clear();vi.clearAllMocks();});
test("server rendering does not run the optimizer or make extra price/catalog requests",()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 vi.mocked(planner.planShopping).mockClear();
 const html=renderToStaticMarkup(<ShoppingList catalog={catalog} profession="Alchemy" recipes={recipes} />);
 expect(html).toContain("Shopping list");
 expect(planner.planShopping).not.toHaveBeenCalled();
 expect(fetcher).not.toHaveBeenCalled();
});
test("device preferences, dated house prices, skip recomputation and clipboard match the visible list",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 localStorage.setItem("everloot.profession-shopping.market",JSON.stringify({ruleset:"pvp",realm:"CAMWOW US1 Realm 4 PvP",houses:["Alliance"]}));
 vi.stubGlobal("fetch",vi.fn(async(input:string)=>({ok:true,json:async()=>input.includes("realm=") ? {ok:true,dataAsOf:"2026-11-15T00:00:00Z",items:[[1,100,10,100,30,"2026-11-14",3]]} : {houses:{"CAMWOW US1 Realm 4 PvP":["Alliance"]}}})));
 const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,"clipboard",{value:{writeText},configurable:true});
 const host=document.createElement("div");root=createRoot(host);
 await act(async()=>root!.render(<ShoppingList catalog={catalog} profession="Alchemy" recipes={recipes} from={1} to={4} />));
 await act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="Load auction prices")!.click());
 expect(host.textContent).toContain("6 Iron Ore — 60c");
 expect(host.textContent).toContain("Alliance, 2026-11-14");
 expect(host.textContent).toContain("Item 2: source not confirmed yet");
 expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith("/api/market/prices"))).toBe(true);
 const button=(text:string)=>[...host.querySelectorAll("button")].find(b=>(b.querySelector("[data-copy-labels] > span")?.textContent ?? b.textContent)===text)!;
 await act(async()=>button("Skip this recipe: Potion").click());
 expect(host.textContent).toContain("9 Iron Ore — 90c");
 await act(async()=>button("Copy shopping list").click());
 expect(writeText).toHaveBeenCalledWith(expect.stringContaining("9 Iron Ore — 90c"));
 expect(writeText).toHaveBeenCalledWith(expect.stringContaining("2026-11-14"));
 await act(async()=>button("Skip this recipe: Other potion").click());
 expect(host.textContent).toContain("No alternative agreed recipe for 1–4");
 expect(host.textContent).toContain("Grand total: no price yet (list incomplete)");
 await act(async()=>button("Restore skipped recipes (2)").click());
 expect(host.textContent).toContain("6 Iron Ore — 60c");
});
test("auction loading is opt-in and zero known prices stay unknown",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const fetcher=vi.fn(async()=>({ok:true,json:async()=>({recipes:catalog})}));vi.stubGlobal("fetch",fetcher);
 const host=document.createElement("div");root=createRoot(host);
 await act(async()=>root!.render(<ShoppingList catalog={catalog} profession="Alchemy" recipes={recipes} from={1} to={4} />));
 expect(fetcher.mock.calls.every(([url]:unknown[])=>!String(url).includes("/api/market"))).toBe(true);
 expect(host.textContent).toContain("Known material subtotal: no prices yet");
 expect(host.textContent).not.toContain("subtotal: 0c");
});
test("one unavailable selected house preserves the other house's prices and marks the comparison incomplete",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 localStorage.setItem("everloot.profession-shopping.market",JSON.stringify({ruleset:"pvp",realm:"CAMWOW US1 Realm 4 PvP",houses:["Alliance","Horde"]}));
 const fetcher=vi.fn(async(input:string)=>input.includes("house=Horde") ? {ok:false,status:429} : {ok:true,json:async()=>input.includes("realm=") ? {ok:true,items:[[1,100,10,100,30,"2026-11-14",3]]} : {houses:{"CAMWOW US1 Realm 4 PvP":["Alliance","Horde"]}}});vi.stubGlobal("fetch",fetcher);
 const host=document.createElement("div");root=createRoot(host);
 await act(async()=>root!.render(<ShoppingList catalog={catalog} profession="Alchemy" recipes={recipes} from={1} to={4} />));
 const load=[...host.querySelectorAll("button")].find(b=>b.textContent==="Load auction prices");
 expect(load).toBeDefined();
 await act(async()=>load!.click());
 expect(host.textContent).toContain("6 Iron Ore — 60c");
 expect(host.textContent).toContain("Horde unavailable");
 expect(host.textContent).toContain("comparison incomplete");
 expect(fetcher.mock.calls.some(([url])=>url.includes("Neutral"))).toBe(false);
});
test("ruleset choices show only matching realms including explicitly unconfirmed ones",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({houses:{"CAMWOW US1 Realm 4 PvP":["Alliance"],"Unmapped Realm":["Neutral"]}})})));
 const host=document.createElement("div");root=createRoot(host);
 await act(async()=>root!.render(<ShoppingList catalog={catalog} profession="Alchemy" recipes={recipes} from={1} to={4} />));
 await act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="Load auction prices")!.click());
 const [ruleset,realm]=host.querySelectorAll("select");
 expect(realm.textContent).toContain("CAMWOW US1 Realm 4 PvP");
 expect(realm.textContent).not.toContain("Unmapped Realm");
 await act(async()=>{ruleset.value="forever";ruleset.dispatchEvent(new Event("change",{bubbles:true}));});
 expect(realm.textContent).toContain("Unmapped Realm");
 expect(realm.textContent).not.toContain("CAMWOW US1 Realm 4 PvP");
});
