import { expect, test } from "vitest";
import { recipeItemsBySpell } from "../src/client-recipes.js";
test("joins teaching items through numeric item effects and learn-spell effects only", () => {
 const tables = new Map<string, Map<number, Record<string, unknown>>>([
  ["ItemEffect", new Map([[1,{SpellID:100}],[2,{SpellID:200}]])],
  ["ItemXItemEffect",new Map([[1,{ItemID:50,ItemEffectID:1}],[2,{ItemID:51,ItemEffectID:2}]])],
  ["SpellEffect",new Map([[1,{SpellID:100,Effect:36,EffectTriggerSpell:300}],[2,{SpellID:200,Effect:24,EffectTriggerSpell:301}]])],
 ]);
 expect(recipeItemsBySpell(n=>tables.get(n))).toEqual({300:[50]});
 expect(recipeItemsBySpell(()=>undefined)).toEqual({});
});
test("learning-trigger items link directly and non-base difficulty effects are excluded", () => {
 const tables=new Map<string,Map<number,Record<string,unknown>>>([
  ["ItemEffect",new Map([[1,{SpellID:300,TriggerType:6}],[2,{SpellID:100,TriggerType:0}]])],
  ["ItemXItemEffect",new Map([[1,{ItemID:50,ItemEffectID:1}],[2,{ItemID:51,ItemEffectID:2}]])],
  ["SpellEffect",new Map([[1,{SpellID:100,Effect:36,EffectTriggerSpell:301,DifficultyID:1}]])],
 ]);
 expect(recipeItemsBySpell(n=>tables.get(n))).toEqual({300:[50]});
});
test("only allowed recipe spells publish numeric teaching links", async () => {
 const {recipeItemDetails}=await import("../src/client-recipes.js");
 const tables=new Map<string,Map<number,Record<string,unknown>>>([
  ["ItemEffect",new Map([[1,{SpellID:300,TriggerType:6}],[2,{SpellID:301,TriggerType:6}]])],
  ["ItemXItemEffect",new Map([[1,{ItemID:50,ItemEffectID:1}],[2,{ItemID:51,ItemEffectID:2}],[3,{ItemID:52,ItemEffectID:1}]])],
  ["ItemSparse",new Map([[50,{Display_lang:"Recipe: Widget"}],[51,{Display_lang:"Unrelated"}]])],
 ]);
 expect(recipeItemDetails(n=>tables.get(n),new Set([300]))).toEqual({links:{300:[50,52]}});
});
