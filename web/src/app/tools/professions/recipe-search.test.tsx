// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,expect,test,vi} from "vitest";
import RecipeSearch from "./recipe-search";
let root:Root|null=null;
afterEach(async()=>{if(root) await act(async()=>root!.unmount());root=null;vi.unstubAllGlobals();});
test("missing-name status is visible and profession counts follow material and skill filters",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const rows=[
  {profession:"Alchemy",slug:"alchemy",spellId:1,name:"Potion",itemName:null,yellow:5,grey:10,recipeItems:[],reagents:[{itemId:1,name:"Iron Ore",count:1}]},
  {profession:"Smithing",slug:"smithing",spellId:2,name:"Widget",itemName:null,yellow:null,grey:null,recipeItems:[],reagents:[{itemId:1,name:"Iron Ore",count:1}]},
 ];
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({named:false,recipes:rows})})));
 const host=document.createElement("div");root=createRoot(host);
 await act(async()=>root!.render(<RecipeSearch />));
 expect(host.textContent).toContain("Some names are not available yet");
 const setInput=async(input:HTMLInputElement,value:string)=>act(async()=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);
  input.dispatchEvent(new Event("input",{bubbles:true}));
 });
 await setInput(host.querySelector('input[type="search"]')!,"Iron Ore");
 expect(host.querySelector("select")!.textContent).toContain("Alchemy (1)");
 await setInput(host.querySelector('input[type="number"]')!,"10");
 expect(host.querySelector("select")!.textContent).toContain("Alchemy (0)");
 expect(host.querySelector("select")!.textContent).toContain("Smithing (1)");
});
