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
