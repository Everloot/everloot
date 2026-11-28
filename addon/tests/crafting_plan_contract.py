"""Run with: uv run --with lupa --with jsonschema python addon/tests/crafting_plan_contract.py

Local, character-scoped recipe capability (modules/crafting_plan.lua, captured by modules/professions.lua).
EverlootDB.craftingKnown[characterKey][professionId] holds what the current character's own profession window
proved: learned recipes, output range, basic reagent item IDs and whether a cooldown was readable and clear.

Source boundaries (Gethe/wow-ui-source forever d9c22e32cb, see the task's api-research.md section 4):
- learned is evidence only when recipeInfo.learned is exactly true while IsTradeSkillLinked, IsTradeSkillGuild and
  IsNPCCrafting all report false.
- Neither GetFilteredRecipeIDs nor GetAllRecipeIDs is documented as complete, so a window read never claims a
  complete profession and never treats a recipe missing from the list as forgotten.
- GetRecipeCooldown is undocumented: feature-detected and guarded. Unreadable means availability unknown.
Nothing here is a record: no E:Store kind, no upload, no change to recipe_observed.

CraftingPlan.Resolve (Task 5) turns recipe requests into a buy-or-make plan. Oracles: the task folder's
resolver-qa-cases.md and resolver-qa-rulings.md.
"""
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\crafting_plan.lua" in toc, "crafting_plan module must be in the TOC"
assert toc.index("modules\\crafting_plan.lua") < toc.index("modules\\professions.lua"), \
    "crafting_plan.lua loads before professions.lua, which captures into it"

FIXTURE = """
date = function() return '2026-11-27T00:00:00Z' end
NOW = 1000
time = function() return NOW end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
timers = {}
C_Timer = { After = function(seconds, f) table.insert(timers, { seconds = seconds, f = f }) end }
function drain() while #timers > 0 do table.remove(timers, 1).f() end end

guid = 'Player-1-0000000A'
UnitGUID = function(unit) if unit == 'player' then return guid end end
UnitClass = function() return 'Mage', 'MAGE' end
UnitLevel = function() return 30 end

C_Item = { GetItemNameByID = function(id) return 'Item ' .. id end, RequestLoadItemDataByID = function() end }
local function slot(ids, quantity, dataSlotType, reagentType)
 local reagents = {}
 for _, id in ipairs(ids) do reagents[#reagents + 1] = { itemID = id } end
 return { reagents = reagents, reagentType = reagentType or 1, quantityRequired = quantity, dataSlotType = dataSlotType or 1, required = true }
end
recipes = {
 [3001] = { name = 'Bolt of Linen', output = 2996, min = 1, max = 1, slots = { slot({ 2589 }, 2) } },
 [3002] = { name = 'Mooncloth', output = 14342, min = 1, max = 1, slots = { slot({ 14256 }, 2) } },
 [3003] = { name = 'Variable Yield', output = 4000, min = 2, max = 3, slots = { slot({ 2589 }, 1), slot({ 2321 }, 1),
   slot({ 9999 }, 1, 1, 2) } },
 [3004] = { name = 'Either Cloth', output = 4001, min = 1, max = 1, slots = { slot({ 2589, 2592 }, 2) } },
 [3005] = { name = 'Enchant', output = nil, min = 1, max = 1, slots = { slot({ 10940 }, 1) } },
}
learned = { [3001] = true, [3002] = true, [3003] = true, [3004] = true, [3005] = true }
cooldowns = {}
listed = { 3001, 3002, 3003, 3004, 3005 }
child = { professionID = 197, professionName = 'Tailoring', skillLevel = 150, maxSkillLevel = 225 }
linked, guildSource, npcSource = false, false, false
C_TradeSkillUI = {
 GetChildProfessionInfo = function() return child end,
 GetBaseProfessionInfo = function() return child end,
 GetFilteredRecipeIDs = function() return listed end,
 GetRecipeInfo = function(id)
  local r = recipes[id]; if not r then return nil end
  return { recipeID = id, name = r.name, relativeDifficulty = 1, learned = learned[id], isDummyRecipe = false }
 end,
 GetRecipeSchematic = function(id)
  local r = recipes[id]
  return { recipeID = id, outputItemID = r.output, quantityMin = r.min, quantityMax = r.max, reagentSlotSchematics = r.slots }
 end,
 IsTradeSkillLinked = function() return linked, linked and 'Other' or nil end,
 IsTradeSkillGuild = function() return guildSource end,
 IsNPCCrafting = function() return npcSource end,
 GetRecipeCooldown = function(id)
  local c = cooldowns[id]
  if c == 'throws' then error('not ready') end
  if c then return c[1], c[2], c[3], c[4] end
 end,
}
"""

lua = LuaRuntime()
lua.execute(FIXTURE)
for file in ["core.lua", "modules/crafting_plan.lua", "modules/professions.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute("""
Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')
local E = Everloot
local CP = E.CraftingPlan
assert(type(CP) == 'table' and type(CP.Known) == 'function' and type(CP.ReplaceKnown) == 'function')
local function event(name) for _, hook in ipairs(E.frame.hooks) do hook(nil, name) end end
function fire(name) event(name); drain() end
local function count(t) local n = 0; for _ in pairs(t) do n = n + 1 end; return n end
local stores = {}
local store = E.Store
E.Store = function(self, kind, row, ...) stores[#stores + 1] = kind; return store(self, kind, row, ...) end
local function rows() return EverlootDB.records.recipe_observed or {} end

-- Unknown identity: nothing is read back and nothing is written under any key.
for _, bad in ipairs({ false, '', 'default', 'not-hex!', 42 }) do
 assert(count(CP.Known(bad or nil)) == 0)
 assert(CP.ReplaceKnown(bad or nil, 197, { [3001] = { recipeId = 3001, learned = true } }, true) == false)
end
assert(count(EverlootDB.craftingKnown or {}) == 0, 'no shared default key')
local savedGuid = guid
guid = nil
fire('TRADE_SKILL_SHOW')
assert(count(EverlootDB.craftingKnown or {}) == 0, 'a window read without a character identity captures nothing')
assert(#rows() > 0, 'public observations are unaffected by the missing identity')
fire('TRADE_SKILL_CLOSE')
guid = savedGuid
local A = E.CharacterKey()
assert(type(A) == 'string')

-- Legacy install-wide observations prove nothing about this character.
assert(count(CP.Known(A)) == 0, 'install-wide recipeSpan/recipeOutput do not unlock a craft')

-- Character A, own window: learned recipes with output range, reagent IDs and cooldown availability.
cooldowns[3001] = { 0, false, 0, 0 }        -- explicit readable zero
cooldowns[3002] = { 3600, true, 0, 0 }      -- cooling down
cooldowns[3003] = { 0, false, 0, 0 }        -- readable, clear
cooldowns[3004] = 'throws'                  -- unreadable: unknown
fire('TRADE_SKILL_SHOW')
local known = CP.Known(A)
assert(count(known) == 5, 'got ' .. count(known))
local bolt = known[3001]
assert(bolt.recipeId == 3001 and bolt.learned == true and bolt.professionId == 197)
assert(bolt.itemId == 2996 and bolt.minimum == 1 and bolt.maximum == 1)
assert(#bolt.reagents == 1 and bolt.reagents[1].itemId == 2589 and bolt.reagents[1].count == 2)
assert(bolt.available == true and bolt.cooldownCheckedAt == NOW)
assert(known[3002].available == false, 'a running cooldown is not available')
local variable = known[3003]
assert(variable.available == true and variable.minimum == 2 and variable.maximum == 3, 'variable yield keeps its range')
assert(variable.reagents == nil, 'an unsupported required slot makes the route incomplete')
assert(known[3004].available == nil and known[3004].cooldownCheckedAt == nil, 'an unreadable cooldown stays unknown')
assert(known[3004].reagents == nil, 'a slot with several possible items gives no reagent route')
assert(known[3005].itemId == nil, 'no product item, no output')
assert(known[3002].cooldownLimited == true and known[3002].cooldown == 3600 and known[3002].isDayCooldown == true)
assert(known[3002].charges == 0 and known[3002].maxCharges == 0 and known[3002].cooldownReturned == true)
assert(EverlootDB.craftingKnown[A][197].complete == false, 'a filtered window read never claims completeness')
-- Known hands out copies: callers cannot edit the saved state.
known[3001].learned = false
assert(CP.Known(A)[3001].learned == true)

-- Cooldown API missing entirely: availability unknown, recipes still learned.
local getCooldown = C_TradeSkillUI.GetRecipeCooldown
C_TradeSkillUI.GetRecipeCooldown = nil
fire('TRADE_SKILL_LIST_UPDATE')
assert(CP.Known(A)[3001].available == nil and CP.Known(A)[3001].learned == true, 'missing cooldown API means unknown')
C_TradeSkillUI.GetRecipeCooldown = getCooldown
cooldowns[3002] = { 3600, true, 1, 2 }      -- a charge left: available
fire('TRADE_SKILL_LIST_UPDATE')
assert(CP.Known(A)[3002].available == true and CP.Known(A)[3001].available == true)
assert(CP.Known(A)[3002].charges == 1 and CP.Known(A)[3002].maxCharges == 2, 'retain the available charge count')
cooldowns[3002] = { 0, false, 0, 0 }
cooldowns[3001] = nil
fire('TRADE_SKILL_LIST_UPDATE')
local ready = CP.Known(A)[3002]
assert(ready.available == true and ready.cooldownLimited == true and ready.cooldown == 0, 'known limited survives a ready read')
local empty = CP.Known(A)[3001]
assert(empty.available == nil and empty.cooldownReturned == false, 'a call returning nothing is not verified zero')
cooldowns[3001] = { 0, false, 0, 0 }

-- Required currency costs cannot become a complete or zero-material route.
recipes[3001].slots[#recipes[3001].slots + 1] = {
 reagentType=1, dataSlotType=3, required=true, quantityRequired=5, reagents={{currencyID=1}}
}
fire('TRADE_SKILL_LIST_UPDATE')
assert(CP.Known(A)[3001].reagents == nil, 'required currency is unpriced, never silently omitted')
table.remove(recipes[3001].slots)
fire('TRADE_SKILL_LIST_UPDATE')

-- A filtered read that omits a recipe does not forget it.
listed = { 3001 }
fire('TRADE_SKILL_LIST_UPDATE')
assert(count(CP.Known(A)) == 5, 'a recipe missing from a filtered list is not forgotten')
-- A complete list from GetAllRecipeIDs is still not proof of completeness.
C_TradeSkillUI.GetAllRecipeIDs = function() return { 3001 } end
fire('TRADE_SKILL_LIST_UPDATE')
assert(count(CP.Known(A)) == 5 and EverlootDB.craftingKnown[A][197].complete == false, 'a function name is not completeness evidence')
C_TradeSkillUI.GetAllRecipeIDs = nil
-- An explicit own-source learned=false is authoritative for that one recipe.
listed = { 3001, 3005 }
learned[3005] = false
fire('TRADE_SKILL_LIST_UPDATE')
assert(CP.Known(A)[3005] == nil and count(CP.Known(A)) == 4, 'explicit unlearned removes only that recipe')
learned[3005] = true
fire('TRADE_SKILL_CLOSE')

-- Character B on the same install: different learned recipes. The public spans and outputs are already known
-- from A, so no new public row is written, yet B's own capability is still captured.
guid = 'Player-1-0000000B'
local B = E.CharacterKey()
assert(B ~= A)
assert(count(CP.Known(B)) == 0, 'A\\'s recipes are not B\\'s')
learned = { [3001] = true, [3002] = false, [3003] = false, [3004] = false, [3005] = true }
listed = { 3001, 3002, 3003, 3004, 3005 }
local publicRows = #rows()
fire('TRADE_SKILL_SHOW')
assert(#rows() == publicRows, 'public install-wide dedup is preserved: no new observation')
local kb = CP.Known(B)
assert(kb[3001] and kb[3005] and count(kb) == 2, 'install-wide dedup does not suppress a new character\\'s capture')
-- Missing or malformed learned values are not evidence.
learned[3002], learned[3003] = nil, 'true'
fire('TRADE_SKILL_LIST_UPDATE')
kb = CP.Known(B)
assert(kb[3002] == nil and kb[3003] == nil and count(kb) == 2, 'learned must be exactly true')
assert(count(CP.Known(A)) == 4, 'B\\'s read leaves A untouched')
fire('TRADE_SKILL_CLOSE')

-- Someone else's recipes: linked, guild and NPC sources are not this character's.
for _, source in ipairs({ 'linked', 'guild', 'npc' }) do
 guid = 'Player-1-000000' .. source:upper():sub(1, 1) .. '0'
 local key = E.CharacterKey()
 linked, guildSource, npcSource = source == 'linked', source == 'guild', source == 'npc'
 learned = { [3001] = true }
 listed = { 3001 }
 fire('TRADE_SKILL_SHOW'); fire('TRADE_SKILL_CLOSE')
 assert(count(CP.Known(key)) == 0, source .. ' source is not captured')
end
linked, guildSource, npcSource = false, false, false
-- A client that cannot say whose window this is captures nothing.
guid = 'Player-1-000000C0'
local C = E.CharacterKey()
local isNpc = C_TradeSkillUI.IsNPCCrafting
C_TradeSkillUI.IsNPCCrafting = nil
fire('TRADE_SKILL_SHOW'); fire('TRADE_SKILL_CLOSE')
assert(count(CP.Known(C)) == 0, 'an unprovable source is not captured')
C_TradeSkillUI.IsTradeSkillGuild = function() error('no') end
C_TradeSkillUI.IsNPCCrafting = isNpc
fire('TRADE_SKILL_SHOW'); fire('TRADE_SKILL_CLOSE')
assert(count(CP.Known(C)) == 0, 'a throwing source check is not captured')
C_TradeSkillUI.IsTradeSkillGuild = function() return guildSource end

-- The character changes before a chunked read finishes: nothing is written for either.
for id = 5000, 5079 do recipes[id] = { name = 'Bulk ' .. id, output = id, min = 1, max = 1, slots = {} }; learned[id] = true end
listed = {}
for id = 5000, 5079 do listed[#listed + 1] = id end
guid = 'Player-1-000000D0'
local D = E.CharacterKey()
event('TRADE_SKILL_SHOW')
table.remove(timers, 1).f()   -- the debounce, then the first chunk of 50
guid = 'Player-1-000000E0'
local Ekey = E.CharacterKey()
drain()
assert(count(CP.Known(D)) == 0 and count(CP.Known(Ekey)) == 0, 'a read that changed character captures nothing')
fire('TRADE_SKILL_CLOSE')

-- Own profession changes during a chunked read, before the next debounced read.
guid = 'Player-1-000000F0'
local F = E.CharacterKey()
event('TRADE_SKILL_SHOW')
table.remove(timers, 1).f()
child = { professionID=171, professionName='Alchemy', skillLevel=150, maxSkillLevel=225 }
drain()
assert(count(CP.Known(F)) == 0, 'a read that changed profession captures nothing')
fire('TRADE_SKILL_CLOSE')
child = { professionID=197, professionName='Tailoring', skillLevel=150, maxSkillLevel=225 }

-- ReplaceKnown: complete replaces the profession, incomplete merges; other professions are untouched.
local Z = 'abcdef01'
assert(CP.ReplaceKnown(Z, 197, { [1] = { recipeId = 1, learned = true, itemId = 10, minimum = 1, maximum = 1 },
  [2] = { recipeId = 2, learned = true } }, true) == true)
assert(CP.ReplaceKnown(Z, 171, { [9] = { recipeId = 9, learned = true } }, true) == true)
assert(EverlootDB.craftingKnown[Z][197].complete == true)
assert(CP.ReplaceKnown(Z, 197, { [3] = { recipeId = 3, learned = true } }, false))
assert(count(CP.Known(Z)) == 4 and EverlootDB.craftingKnown[Z][197].complete == false)
assert(CP.ReplaceKnown(Z, 197, { [1] = { recipeId = 1, learned = true } }, true))
local z = CP.Known(Z)
assert(z[1] and z[9] and z[2] == nil and z[3] == nil, 'a complete read removes formerly known recipes of that profession only')
assert(CP.ReplaceKnown(Z, 197, { [7] = { recipeId = 7, learned = nil }, [8] = { recipeId = 8, learned = 'true' } }, false))
assert(CP.Known(Z)[7] == nil and CP.Known(Z)[8] == nil, 'not explicitly learned is not stored')
assert(CP.ReplaceKnown(Z, 0, {}, true) == false and CP.ReplaceKnown(Z, 1.5, {}, true) == false, 'a profession needs a whole ID')

-- Local state only: no record kind, no upload.
for _, kind in ipairs(stores) do assert(kind == 'recipe_observed' or kind == 'trainer_seen', 'stored ' .. kind) end
for kind in pairs(EverlootDB.records) do assert(kind ~= 'crafting_known' and kind ~= 'craftingKnown') end
""")

# Task 5: quantity-aware buy-versus-craft resolution. Oracles: resolver-qa-cases.md and resolver-qa-rulings.md
# (synthetic IDs, integer copper). Valuation is owned = {}; shopping passes bag counts. options.noCooldown stands for
# a build-stamped source proving a recipe has no cooldown; the client API alone never proves that.
lua.execute(r"""
local CP = Everloot.CraftingPlan
assert(type(CP.Resolve) == 'function', 'CraftingPlan.Resolve exists')
NOW = 100000
quotes = { [101] = 25, [102] = 120, [103] = 10, [106] = 30, [107] = 100, [110] = 40, [111] = 50, [114] = 50,
  [115] = 80, [117] = 130 }
local ctx = { Quote = function(_, id) local u = quotes[id]; if u then return { unit = u, vendor = id == 103 } end end }
local function R(id, item, reagents, min, max, extra)
  local r = { recipeId = id, professionId = 197, learned = true, itemId = item, minimum = min or 1, maximum = max or min or 1,
    reagents = {}, cooldownReturned = false, cooldownCheckedAt = NOW - 60 }
  for i = 1, #reagents, 2 do r.reagents[#r.reagents + 1] = { itemId = reagents[i], count = reagents[i + 1] } end
  for k, v in pairs(extra or {}) do r[k] = v end
  return r
end
local function world()
  return {
    [201] = R(201, 102, { 101, 3 }, 2), [202] = R(202, 104, { 102, 3, 103, 1 }), [203] = R(203, 105, { 102, 1, 103, 2 }),
    [204] = R(204, 106, { 107, 1 }, 5), [205] = R(205, 108, { 106, 1, 103, 1 }), [206] = R(206, 109, { 106, 3, 103, 1 }),
    [207] = R(207, 111, { 110, 1 }, 1, 3), [208] = R(208, 112, { 111, 4 }),
    [210] = R(210, 114, { 115, 1 }), [211] = R(211, 115, { 114, 1 }, 2), [212] = R(212, 116, { 114, 1 }),
  }
end
local A = world()
local free = setmetatable({}, { __index = function() return true end })
local function plan(requests, strategy, known, owned, extra)
  local options = { strategy = strategy, now = NOW, noCooldown = free }
  for k, v in pairs(extra or {}) do options[k] = v end
  return CP.Resolve(requests, ctx, known or A, owned or {}, options)
end
local function count(list, id)
  local n = 0
  for _, p in ipairs(list) do if p.id == id then n = n + p.count end end
  return n
end
local function steps(p)
  local out = {}
  for _, s in ipairs(p.steps) do out[#out + 1] = s.recipeId .. 'x' .. s.crafts end
  return table.concat(out, ',')
end
local function excluded(p, recipeId, reason)
  for _, x in ipairs(p.exclusions) do
    if x.recipeId == recipeId and (not reason or x.reason == reason) then return true end
  end
  return false
end
local function limited(p, kind) for _, l in ipairs(p.limits) do if l.kind == kind then return true end end return false end
local function eq(got, want, what) assert(got == want, tostring(what) .. ': got ' .. tostring(got) .. ', want ' .. tostring(want)) end

-- Case 1: whole batches, leftovers never credited.
local p = plan({ { recipeId = 202, crafts = 1 } })
eq(p.strategy, 'buy', 'default strategy'); eq(p.cost, 370, 'case 1 buy')
eq(count(p.purchases, 102), 3, 'buy bolts'); eq(steps(p), '202x1', 'buy steps')
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest')
eq(p.cost, 160, 'case 1 cheapest'); eq(steps(p), '201x2,202x1', 'two bolt crafts, dependency ordered')
eq(count(p.purchases, 101), 6, 'cloth'); eq(count(p.purchases, 103), 1, 'thread'); eq(count(p.purchases, 102), 0, 'no bolts')
eq(p.leftovers[102], 1, 'leftover bolt'); eq(p.complete, true, 'complete'); eq(p.cashCost, 160, 'cash equals valuation without stock')
eq(p.buyCost, 370, 'the buy route is kept for comparison')

-- Case 2: shared intermediate summed before rounding; 201 listed once.
p = plan({ { recipeId = 202, crafts = 1 }, { recipeId = 203, crafts = 1 } }, 'cheapest')
eq(p.cost, 180, 'case 2'); eq(steps(p), '201x2,202x1,203x1', 'one 201 step with 2 crafts')
eq(count(p.purchases, 101), 6, 'case 2 cloth'); eq(p.leftovers[102], nil, 'no leftover')
eq(plan({ { recipeId = 202, crafts = 1 }, { recipeId = 203, crafts = 1 } }).cost, 510, 'case 2 buy')

-- Case 3: the fractional-cost trap and its reversal.
eq(plan({ { recipeId = 205, crafts = 1 } }, 'cheapest').cost, 40, 'gloves buy dye')
eq(plan({ { recipeId = 206, crafts = 1 } }, 'cheapest').cost, 100, 'robe buy dye')
p = plan({ { recipeId = 205, crafts = 1 }, { recipeId = 206, crafts = 1 } }, 'cheapest')
eq(p.cost, 120, 'combined makes dye'); eq(steps(p), '204x1,205x1,206x1', 'combined steps'); eq(p.leftovers[106], 1, 'dye left')
eq(plan({ { recipeId = 205, crafts = 4 } }, 'cheapest').cost, 140, 'four gloves')

-- Case 4 (ruling A1): whole make batches plus a bought remainder.
p = plan({ { recipeId = 205, crafts = 7 } }, 'cheapest')
eq(p.cost, 230, 'split route'); eq(steps(p), '204x1,205x7', 'one dye craft')
eq(count(p.purchases, 106), 2, 'buy remaining dye'); eq(count(p.purchases, 107), 1, 'one pigment')
local dye
for _, d in ipairs(p.decisions) do if d.itemId == 106 then dye = d end end
assert(dye and dye.made == 5 and dye.bought == 2 and dye.recipeId == 204 and dye.crafts == 1, 'dye decision explained')

-- Case 5 (A2/A3): stock counted once; economic valuation separate from cash.
local reqs5 = { { recipeId = 202, crafts = 1 }, { recipeId = 203, crafts = 2 } }
p = plan(reqs5, 'cheapest')
eq(p.cost, 275, 'case 5 valuation'); eq(count(p.purchases, 101), 9, 'valuation cloth'); eq(steps(p), '201x3,202x1,203x2', 'valuation steps')
local bags = { [102] = 2, [101] = 2 }
local shop = plan(reqs5, 'cheapest', A, bags)
eq(shop.cost, 275, 'valuation ignores bags'); eq(shop.cashCost, 150, 'cash shortfall')
eq(count(shop.purchases, 101), 4, 'shortfall cloth'); eq(count(shop.purchases, 103), 5, 'shortfall thread')
eq(steps(shop), '201x2,202x1,203x2', 'owned bolts reduce batches'); eq(shop.leftovers[102], 1, 'shopping leftover')
eq(shop.used[102], 2, 'owned bolts used'); eq(shop.used[101], 2, 'owned cloth used')
eq(bags[102], 2, 'owned map is not consumed for the caller')
-- Case 5b: owned pigment does not change the economic route.
shop = plan({ { recipeId = 205, crafts = 1 } }, 'cheapest', A, { [107] = 1 })
eq(shop.cost, 40, '5b valuation'); eq(shop.cashCost, 40, '5b cash'); eq(count(shop.purchases, 106), 1, '5b buys dye')
eq(steps(shop), '205x1', '5b no dye craft')

-- Case 6: variable yield fulfils with the minimum; possible surplus separate.
p = plan({ { recipeId = 208, crafts = 1 } }, 'cheapest')
eq(p.cost, 160, 'case 6a'); eq(steps(p), '207x4,208x1', 'four essence crafts')
eq(p.leftovers[111], nil, 'no guaranteed leftover'); eq(p.possibleLeftovers[111], 8, 'possible surplus 8')
quotes[110] = 60
eq(plan({ { recipeId = 208, crafts = 1 } }, 'cheapest').cost, 200, 'case 6b buys')
quotes[110] = 40

-- Case 7: unlearned, alt-only, unproven and cooldown routes cannot win.
local function without(id, replacement) local k = world(); k[id] = replacement; return k end
local catalog = { { recipeId = 201, itemId = 102 } }
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, nil), {}, { catalog = catalog })
eq(p.cost, 370, 'alt-only'); assert(excluded(p, 201, 'not learned'), 'names the unlearned recipe')
local legacy = R(201, 102, { 101, 3 }, 2); legacy.learned = nil
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, legacy))
eq(p.cost, 370, 'learned=nil is no route'); assert(excluded(p, 201, 'not learned'))
-- No evidence of no cooldown: the client API cannot tell a ready cooldown from none.
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', A, {}, { noCooldown = {}, capacityDetail = 'not in client cooldown data' })
eq(p.cost, 370, 'unproven capacity buys'); assert(excluded(p, 201, 'capacity'), 'capacity exclusion')
eq(p.exclusions[1].detail, 'not in client cooldown data', 'the exclusion says why')
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, R(201, 102, { 101, 3 }, 2, 2, { cooldownReturned = true,
  cooldown = 0, isDayCooldown = false, charges = 0, maxCharges = 0 })), {}, { noCooldown = {} })
eq(p.cost, 370, 'an explicit zero read is not proof of no cooldown'); assert(excluded(p, 201, 'capacity'))
-- A no-cooldown source is labelled: the plan names the steps that rely on it and the basis.
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', A, {}, { noCooldownBasis = 'No cooldown recorded in client data, build X' })
eq(p.cost, 160, 'build-scoped evidence allows the route'); eq(p.assumed[1], 201, 'assumed step')
eq(p.basis, 'No cooldown recorded in client data, build X', 'basis carried')
eq(plan({ { recipeId = 202, crafts = 1 } }).basis, nil, 'no assumption, no basis')
-- Current reads: tests stand in for E.CurrentRecipeCooldown. nil means no read in the own open window.
local function reader(read, why)
  local calls = {}
  return function(r) calls[#calls + 1] = r.recipeId; return read, why end, calls
end
local ready = reader({ returned = false })                       -- Blizzard's ready shape: all nil
local closed = reader(nil, 'profession window closed')
-- Observed limitation overrides a no-cooldown source; without a current read it is excluded, whatever was saved.
local sticky = R(201, 102, { 101, 3 }, 2, 2, { cooldownLimited = true, cooldownReturned = true, cooldown = 0 })
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, sticky), {}, { readCooldown = closed })
eq(p.cost, 370, 'saved ready snapshot is not current'); assert(excluded(p, 201, 'cooldown'))
local why
for _, x in ipairs(p.exclusions) do if x.recipeId == 201 then why = x.detail end end
eq(why, 'profession window closed', 'why there was no current read')
local oldSave = R(201, 102, { 101, 3 }, 2, 2, { cooldownLimited = true, cooldownReturned = nil, available = true })
eq(plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, oldSave)).cost, 370, 'N7: saved available is not a read')
-- A current ready read (nil cooldown) allows one craft; the rest is bought.
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, sticky), {}, { readCooldown = ready })
eq(p.cost, 205, 'ready nil: one craft'); eq(steps(p), '201x1,202x1', 'capped at one'); eq(count(p.purchases, 102), 1)
local zero = reader({ cooldown = 0, isDayCooldown = true, charges = 0, maxCharges = 0, returned = true })
eq(plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, sticky), {}, { readCooldown = zero }).cost, 205, 'explicit 0')
-- Client data marks a recipe limited even when every read so far was ready.
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', A, {}, { limited = { [201] = { ms = 3600000 } }, readCooldown = closed })
eq(p.cost, 370, 'recorded cooldown overrides absence and a ready snapshot'); assert(excluded(p, 201, 'cooldown'))
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', A, {}, { limited = { [201] = { ms = 3600000 } }, readCooldown = ready })
eq(p.cost, 205, 'recorded cooldown, ready now: one craft')
-- Cooling, charges and unreadable reads.
local cooling = reader({ cooldown = 3600, isDayCooldown = true, returned = true })
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, sticky), {}, { readCooldown = cooling })
eq(p.cost, 370, 'cooling'); assert(excluded(p, 201, 'cooldown'))
eq(plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, sticky), {},
  { readCooldown = reader({ cooldown = 3600, charges = 1, maxCharges = 2, returned = true }) }).cost, 205, 'one charge')
eq(plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, sticky), {},
  { readCooldown = reader({ cooldown = 0, charges = 2, maxCharges = 2, returned = true }) }).cost, 160, 'two charges')
eq(plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, sticky), {},
  { readCooldown = reader({ cooldown = -1, returned = true }) }).cost, 370, 'an unreadable read is not ready')
-- Each recipe is read once per resolution.
local once, calls = reader({ returned = false })
plan({ { recipeId = 202, crafts = 1 }, { recipeId = 203, crafts = 1 } }, 'cheapest', without(201, sticky), {}, { readCooldown = once })
eq(#calls, 1, 'one read per recipe')
-- Capacity holds across the combined plan.
p = plan({ { recipeId = 202, crafts = 1 }, { recipeId = 203, crafts = 1 } }, 'cheapest', without(201, sticky), {},
  { readCooldown = ready })
eq(steps(p), '201x1,202x1,203x1', 'two roots share one craft'); eq(count(p.purchases, 102), 2, 'buy the other bolts')
-- Shared cooldown category, across professions; without a category, the profession. Bolts (201) and dye (204) are
-- both worth making once for one bag and two robes; one item takes one recipe, so alternatives compete, never combine.
local function makers(cat201, cat204, prof204)
  local k = without(201, R(201, 102, { 101, 3 }, 2))
  k[204] = R(204, 106, { 107, 1 }, 5, 5, { professionId = prof204 or 197 })
  return k, { [201] = { ms = 1, category = cat201 }, [204] = { ms = 1, category = cat204 } }
end
local function made(p)
  local n = 0
  for _, s in ipairs(p.steps) do if s.recipeId == 201 or s.recipeId == 204 then n = n + s.crafts end end
  return n
end
local both = { { recipeId = 202, crafts = 1 }, { recipeId = 206, crafts = 2 } }
local k, lim = makers(310, 311, 171)
eq(made(plan(both, 'cheapest', k, {}, { limited = lim, readCooldown = ready })), 2, 'different categories, one craft each')
k, lim = makers(310, 310, 171)
eq(made(plan(both, 'cheapest', k, {}, { limited = lim, readCooldown = ready })), 1, 'one category, one craft, across professions')
k, lim = makers(nil, nil, 197)
eq(made(plan(both, 'cheapest', k, {}, { limited = lim, readCooldown = ready })), 1, 'no category: one profession, one craft')
k, lim = makers(nil, nil, 171)
eq(made(plan(both, 'cheapest', k, {}, { limited = lim, readCooldown = ready })), 2, 'no category, two professions')
local coolingOne = function(r) if r.recipeId == 204 then return { cooldown = 600, returned = true } end return { returned = false } end
k, lim = makers(310, 310, 171)
eq(made(plan(both, 'cheapest', k, {}, { limited = lim, readCooldown = coolingOne })), 0, 'a cooling member closes its category')
-- Requested crafts use the capacity first: root and intermediate of one recipe merge without exceeding it.
p = plan({ { recipeId = 201, crafts = 1 }, { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, sticky), {},
  { readCooldown = ready })
eq(steps(p), '201x1,202x1', 'the root takes the one craft'); eq(count(p.purchases, 102), 3, 'the bag buys its bolts')
eq(p.complete, true, 'within capacity')
p = plan({ { recipeId = 201, crafts = 2 } }, 'cheapest', without(201, sticky), {}, { readCooldown = ready })
eq(p.cost, 150, 'an over-capacity root keeps its valuation'); eq(p.complete, false, 'but cannot be made now')
assert(limited(p, 'cooldown'), 'and says so')
-- Category sibling roots.
k, lim = makers(310, 310, 171)
p = plan({ { recipeId = 201, crafts = 1 }, { recipeId = 204, crafts = 1 } }, 'cheapest', k, {}, { limited = lim, readCooldown = ready })
eq(p.complete, false, 'two sibling roots on one category slot'); assert(limited(p, 'cooldown'))
-- An excluded route and an unpriced item: never a zero.
quotes[102] = nil
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', without(201, sticky))
quotes[102] = 120
eq(p.cost, nil, 'missing price is not zero'); eq(count(p.purchases, 102), 3, 'listed with count'); eq(p.complete, false)
eq(p.unpriced[1] and p.unpriced[1].id, 102, 'unpriced bolt'); eq(p.cashCost, nil, 'no cash total either')

-- Case 8: a cycle never makes an item free.
p = plan({ { recipeId = 212, crafts = 1 } }, 'cheapest')
eq(p.cost, 50, 'cycle X50 Y80'); eq(count(p.purchases, 114), 1, 'buy X')
quotes[115] = 30
p = plan({ { recipeId = 212, crafts = 1 } }, 'cheapest')
eq(p.cost, 30, 'non-cyclic route'); eq(steps(p), '210x1,212x1', 'make X from bought Y'); eq(count(p.purchases, 115), 1)
quotes[115] = nil
p = plan({ { recipeId = 212, crafts = 1 } }, 'cheapest')
eq(p.cost, 50, 'Y unpriced'); assert(excluded(p, 211, 'cycle'), 'cycle exclusion')
quotes[114] = nil
p = plan({ { recipeId = 212, crafts = 1 } }, 'cheapest')
eq(p.cost, nil, 'both unpriced'); eq(count(p.purchases, 114), 1, 'X listed unpriced'); eq(p.complete, false)
quotes[114], quotes[115] = 50, 80

-- Case 9 (ruling A4): bounds and invalid counts.
for _, bad in ipairs({ { { recipeId = 202, crafts = 10000 } }, { { recipeId = 202, crafts = 5000 }, { recipeId = 203, crafts = 5000 } },
  { { recipeId = 202, crafts = 1.5 } }, { { recipeId = 202, crafts = 0 } }, { { recipeId = 202, crafts = -1 } },
  { { recipeId = 202 } }, {}, 'x' }) do
  p = CP.Resolve(bad, ctx, A, {}, { strategy = 'cheapest', now = NOW, noCooldown = free })
  assert(p.rejected and p.cost == nil and p.complete == false and #p.purchases == 0 and #p.steps == 0,
    'rejected, never truncated')
end
p = plan({ { recipeId = 202, crafts = 9999 } }, 'cheapest')
eq(p.cost, 1224915, '9999 crafts'); eq(steps(p), '201x14999,202x9999', 'intermediates are not root-limited')
eq(count(p.purchases, 101), 44997, 'large quantity kept exact')
-- Depth: root step 0; a step at depth 12 may be made, 13 may not.
local function chain(priced)
  local k = { [399] = R(399, 300, { 301, 1 }) }
  for level = 1, 14 do k[400 + level] = R(400 + level, 300 + level, { 301 + level, 1 }) end
  for level = 1, 15 do quotes[300 + level] = nil end
  quotes[priced] = 7
  return k
end
p = plan({ { recipeId = 399, crafts = 1 } }, 'cheapest', chain(313))
eq(p.cost, 7, 'a depth-12 step makes item 312 from bought 313'); eq(#p.steps, 13, 'twelve intermediate steps + root')
p = plan({ { recipeId = 399, crafts = 1 } }, 'cheapest', chain(314))
eq(p.cost, nil, 'a depth-13 step is blocked'); assert(limited(p, 'depth'), 'depth limit is reported')
quotes[314] = nil
-- 50 final purchase IDs: the 51st is named, never dropped.
local wide = R(398, 399, {})
for i = 0, 50 do wide.reagents[#wide.reagents + 1] = { itemId = 1000 + i, count = 1 }; quotes[1000 + i] = 1 end
local kw = world(); kw[398] = wide
p = plan({ { recipeId = 398, crafts = 1 } }, 'cheapest', kw)
eq(#p.purchases, 50, 'fifty listed'); eq(#p.omitted, 1, 'one omitted'); eq(p.omitted[1].id, 1050, 'the 51st is named')
eq(p.complete, false, 'partial receipt'); assert(limited(p, 'purchases'))
-- 500 recipe candidates for the whole resolution: bounded, reported, buy route kept.
local many = world()
for i = 1, 600 do many[5000 + i] = R(5000 + i, 102, { 101, 4 }, 2) end
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', many)
assert(limited(p, 'recipes'), 'candidate bound reported'); eq(p.cost, 160, 'the lowest IDs are tried first')

-- Case 12: recipe IDs, item IDs and names never cross.
local k12 = world(); k12[106] = R(106, 118, { 102, 1 })
p = plan({ { recipeId = 106, crafts = 1 } }, 'cheapest', k12, { [106] = 5 })
eq(p.cost, 75, 'case 12'); eq(steps(p), '201x1,106x1', 'case 12 steps'); eq(count(p.purchases, 106), 0, 'no dye bought')
eq(p.cashCost, 75, 'owned dye covers nothing here')
local k117 = world(); k117[219] = R(219, 120, { 117, 1 })
p = plan({ { recipeId = 219, crafts = 1 } }, 'cheapest', k117, { [102] = 4 })
eq(p.cost, 130, 'item 117 is bought'); eq(count(p.purchases, 117), 1); eq(p.cashCost, 130, 'owned 102 does not cover 117')

-- Case 13 (A5): two learned recipes for one item; cheaper complete route wins.
local k13 = world(); k13[213] = R(213, 102, { 101, 5 }, 4)
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', k13)
eq(p.cost, 135, 'case 13'); eq(steps(p), '213x1,202x1', 'cheaper recipe')

-- Case 14: incomplete quotes.
quotes[102] = nil
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest'); eq(p.cost, 160, 'only complete route')
p = plan({ { recipeId = 202, crafts = 1 } }); eq(p.cost, nil, 'buy never makes'); eq(count(p.purchases, 102), 3)
quotes[101] = nil
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest'); eq(p.cost, nil, 'both unpriced'); eq(count(p.purchases, 102), 3)
quotes[102] = 120
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest'); eq(p.cost, 370, 'cloth unpriced buys')
quotes[101] = 25

-- A8: buy wins an exact tie.
quotes[107] = 30
p = plan({ { recipeId = 205, crafts = 1 } }, 'cheapest'); eq(p.cost, 40, 'tie'); eq(steps(p), '205x1', 'tie buys')
quotes[107] = 100
-- Bolts at 50: one craft plus one bought bolt (125) beats both whole routes (150).
quotes[102] = 50
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest'); eq(p.cost, 135, 'split beats a tie'); eq(steps(p), '201x1,202x1')
quotes[102] = 120

-- Unknown root route: a recipe without a complete reagent list has no cost.
local k0 = world(); k0[202].reagents = nil
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', k0)
eq(p.cost, nil, 'unknown root route'); eq(p.complete, false); assert(excluded(p, 202, 'reagents'))
p = plan({ { recipeId = 7777, crafts = 1 } }, 'cheapest')
eq(p.cost, nil, 'a recipe nobody defined'); eq(p.complete, false); assert(excluded(p, 7777, 'unknown'))
-- An intermediate without a reagent list is no route.
local kr = world(); kr[201].reagents = nil
p = plan({ { recipeId = 202, crafts = 1 } }, 'cheapest', kr)
eq(p.cost, 370, 'unknown intermediate reagents'); assert(excluded(p, 201, 'reagents'))
-- A root not in known can be valued from its own definition, by item IDs.
p = CP.Resolve({ { recipeId = 9000, crafts = 2, recipe = { itemId = 104, minimum = 1, maximum = 1,
  reagents = { { itemId = 102, count = 3 }, { itemId = 103, count = 1 } } } } }, ctx, A, {},
  { strategy = 'cheapest', now = NOW, noCooldown = free })
eq(p.cost, 245, 'defined root: 6 bolts in 3 crafts (9 cloth) + 2 thread'); eq(steps(p), '201x3,9000x2', 'defined root steps')
-- A limited root with no current read keeps its valuation; the plan cannot be made now.
local kl = world(); kl[202] = R(202, 104, { 102, 3, 103, 1 }, 1, 1, { cooldownLimited = true, cooldownReturned = true,
  cooldown = 3600, isDayCooldown = true })
p = plan({ { recipeId = 202, crafts = 2 } }, 'buy', kl)
eq(p.cost, 740, 'root valuation stays'); assert(limited(p, 'cooldown'), 'root capacity limit reported')
eq(p.complete, false, 'not complete for making or shopping')

-- Same requests give the same plan; known is not modified; shopping with no stock matches valuation.
local before = plan(reqs5, 'cheapest')
local again = plan(reqs5, 'cheapest')
eq(steps(before), steps(again), 'idempotent'); eq(before.cost, again.cost, 'idempotent cost')
eq(A[201].reagents[1].count, 3, 'known untouched')
local valued, shopped = plan(reqs5, 'cheapest', A, {}), plan(reqs5, 'cheapest', A, { [999] = 3 })
eq(steps(valued), steps(shopped), 'same route'); eq(valued.cost, shopped.cost, 'same valuation')
for _, x in ipairs(valued.purchases) do eq(count(shopped.purchases, x.id), x.count, 'same quantity ' .. x.id) end
-- Bounds are reported honestly: no claim of global optimality.
eq(valued.optimality, 'bounded', 'the search is bounded, not a proven optimum')
""")

# Current cooldown reads for the planner (E.CurrentRecipeCooldown): only the identified character's own open window for
# that profession, and the client's all-nil ready shape kept apart from a failed or unreadable call.
lua.execute(r"""
local E = Everloot
guid = 'Player-1-0000000A'
local A = E.CharacterKey()
child = { professionID = 197, professionName = 'Tailoring', skillLevel = 150, maxSkillLevel = 225 }
linked, guildSource, npcSource = false, false, false
local real = C_TradeSkillUI.GetRecipeCooldown
local calls = 0
C_TradeSkillUI.GetRecipeCooldown = function(id) calls = calls + 1; return real(id) end
fire('TRADE_SKILL_CLOSE')
local read, why = E.CurrentRecipeCooldown(A, 197, 3002)
assert(read == nil and why == 'profession window closed' and calls == 0, 'a closed profession is never read')
fire('TRADE_SKILL_SHOW')
calls = 0
cooldowns[3002] = nil
read = E.CurrentRecipeCooldown(A, 197, 3002)
assert(type(read) == 'table' and read.returned == false and read.cooldown == nil and calls == 1, 'the ready nil shape')
cooldowns[3002] = { 3600, true, 0, 0 }
read = E.CurrentRecipeCooldown(A, 197, 3002)
assert(read.cooldown == 3600 and read.isDayCooldown == true and read.returned == true, 'cooling')
cooldowns[3002] = 'throws'
read, why = E.CurrentRecipeCooldown(A, 197, 3002)
assert(read == nil and why == 'read failed', 'an error is not ready')
cooldowns[3002] = { -5, false, 0, 0 }
read, why = E.CurrentRecipeCooldown(A, 197, 3002)
assert(read == nil and why == 'unreadable', 'an invalid value is not ready')
calls = 0
read, why = E.CurrentRecipeCooldown(A, 171, 3002)
assert(read == nil and why == 'another profession open' and calls == 0, 'another profession is not read')
read, why = E.CurrentRecipeCooldown('abcdef01', 197, 3002)
assert(read == nil and why == 'another character' and calls == 0)
linked = true
read, why = E.CurrentRecipeCooldown(A, 197, 3002)
assert(read == nil and why == "not the player's own window" and calls == 0, 'a linked window is not read')
linked = false
C_TradeSkillUI.GetRecipeCooldown = nil
read, why = E.CurrentRecipeCooldown(A, 197, 3002)
assert(read == nil and why == 'no cooldown API')
C_TradeSkillUI.GetRecipeCooldown = function(id) calls = calls + 1; return real(id) end
-- With the resolver: a recorded-cooldown recipe read ready in its own open window counts once.
cooldowns[3002] = nil
local q = { [14256] = 100, [14342] = 1000 }
local ctx = { Quote = function(_, id) if q[id] then return { unit = q[id] } end end }
local known = { [3002] = { recipeId = 3002, professionId = 197, learned = true, itemId = 14342, minimum = 1, maximum = 1,
  reagents = { { itemId = 14256, count = 2 } } } }
local function current(r) return E.CurrentRecipeCooldown(A, r.professionId, r.recipeId) end
local req = { { recipeId = 9100, crafts = 1, recipe = { reagents = { { itemId = 14342, count = 2 } } } } }
local p = E.CraftingPlan.Resolve(req, ctx, known, {}, { strategy = 'cheapest', limited = { [3002] = { ms = 1 } },
  readCooldown = current })
assert(p.cost == 1200 and p.steps[1].recipeId == 3002 and p.steps[1].crafts == 1, 'one ready craft, one bought: ' .. tostring(p.cost))
cooldowns[3002] = { 3600, true, 0, 0 }
p = E.CraftingPlan.Resolve(req, ctx, known, {}, { strategy = 'cheapest', limited = { [3002] = { ms = 1 } }, readCooldown = current })
assert(p.cost == 2000, 'cooling now: bought')
fire('TRADE_SKILL_CLOSE')
cooldowns[3002] = nil
calls = 0
p = E.CraftingPlan.Resolve(req, ctx, known, {}, { strategy = 'cheapest', limited = { [3002] = { ms = 1 } }, readCooldown = current })
assert(p.cost == 2000 and calls == 0, 'window closed: no read, no route')
C_TradeSkillUI.GetRecipeCooldown = real
""")

# The generated client cooldown data: build-stamped, reproducible from the owned snapshot (scripts/build-recipe-cooldowns.py).
assert toc.index("modules\\recipe_cooldown_data.lua") < toc.index("modules\\crafting_plan.lua"), \
    "the cooldown data loads before the planner and the calculator that read it"
data = LuaRuntime()
data.execute("Everloot = {}")
data.execute((root / "modules" / "recipe_cooldown_data.lua").read_text(encoding="utf-8"))
data.execute(r"""
local D = Everloot.RECIPE_COOLDOWNS
assert(D.build == '1.60.1.71139' and #D.sha256 == 64 and D.generator == 'scripts/build-recipe-cooldowns.py')
assert(D.encrypted.SpellCooldowns == 9 and D.encrypted.SpellCategories == 12, 'unreadable blocks are disclosed')
local covered, last = {}, 0
for _, id in ipairs(D.covered) do assert(id > last, 'sorted and unique'); last = id; covered[id] = true end
assert(#D.covered > 2000, 'every trade-skill recipe the files list')
for id, entry in pairs(D.limited) do assert(covered[id] and entry.ms > 0, 'limited recipes are covered recipes') end
assert(D.limited[18560] and D.limited[18560].ms == 342000000 and D.limited[18560].category == nil, 'Mooncloth')
assert(D.limited[17187].category == 310 and D.limited[17559].category == 310, 'transmutes share category 310')
assert(covered[2963] and not D.limited[2963], 'Bolt of Linen Cloth: covered, no cooldown recorded')
assert(not covered[1], 'an arbitrary ID is not covered')
""")
from protocol_schema import check_all  # noqa: E402
check_all(lua)

# Task 6: character recipe plans. EverlootDB.craftingPlans[characterKey] keeps each recipe's requested crafts and its
# full material requirement, never a bag-adjusted shortfall. Preview recomputes the combined plan from the OWNER's
# proven recipes and saved strategy; only the owner's own fresh bags reduce what to buy, once across every plan.
# Oracles: resolver-qa-cases.md cases 2, 10, 11 and 12 (synthetic IDs, integer copper).
plans = LuaRuntime()
plans.execute(FIXTURE)
plans.execute("""
NUM_BAG_SLOTS = 4
bag = {}
C_Container = {
  GetContainerNumSlots = function(b) if b == 0 then return 16 end return 0 end,
  GetContainerItemInfo = function(b, s)
    local entry = b == 0 and bag[s]
    if entry then return { itemID = entry[1], stackCount = entry[2] } end
  end,
}
function setBags(counts)
  bag = {}
  for id, n in pairs(counts) do bag[#bag + 1] = { id, n } end
end
""")
for file in ["core.lua", "modules/inventory.lua", "modules/crafting_plan.lua"]:
    plans.execute((root / file).read_text(encoding="utf-8"))
plans.execute(r"""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
local E, CP = Everloot, Everloot.CraftingPlan
for _, name in ipairs({ 'Put', 'Remove', 'Preview', 'SetStrategy', 'Plans' }) do
  assert(type(CP[name]) == 'function', 'CraftingPlan.' .. name .. ' exists')
end
quotes = { [101] = 25, [102] = 120, [103] = 10, [106] = 30, [107] = 100 }
local ctx = { Quote = function(_, id) local u = quotes[id]; if u then return { unit = u } end end }
local free = setmetatable({}, { __index = function() return true end })
local function R(id, item, reagents, min)
  local r = { recipeId = id, learned = true, itemId = item, minimum = min or 1, maximum = min or 1, reagents = {} }
  for i = 1, #reagents, 2 do r.reagents[#r.reagents + 1] = { itemId = reagents[i], count = reagents[i + 1] } end
  return r
end
local A = E.CharacterKey()
assert(CP.ReplaceKnown(A, 197, { R(201, 102, { 101, 3 }, 2), R(202, 104, { 102, 3, 103, 1 }), R(203, 105, { 102, 1, 103, 2 }),
  R(106, 118, { 102, 1 }), R(204, 106, { 107, 1 }, 5) }, false))
local evidence = { noCooldown = free }
local function preview(key, with) return CP.Preview(key, ctx, { evidence = evidence, with = with }) end
local function row(p, id)
  for _, r in ipairs(p.rows) do if r.id == id then return r end end
end
local function need(p, id) local r = row(p, id); return r and r.need or 0 end
local function full(p, id) local r = row(p, id); return r and r.full or 0 end
local function stored(key) return EverlootDB.craftingPlans[key].recipes end
setBags({})

-- Case 10.1: a repeated Put replaces the recipe's count; it never adds.
local before = CP.revision
local r1 = CP.Put(A, 197, 202, 1)
assert(r1.ok and r1.crafts == 1 and r1.previous == nil and CP.revision == before + 1, 'first Put stores the plan')
local r2 = CP.Put(A, 197, 202, 3)
assert(r2.ok and r2.crafts == 3 and r2.previous == 1 and r2.replaced, 'the same recipe again replaces its count')
local saved = stored(A)[202]
assert(saved.crafts == 3, 'stored crafts is 3, not 4: ' .. tostring(saved.crafts))
local needs = {}
for _, g in ipairs(saved.needs) do needs[g.itemId] = g.count end
assert(needs[102] == 9 and needs[103] == 3, 'the full material requirement for every craft is saved')
assert(EverlootDB.craftingPlans[A].strategy == 'buy', 'a plan routes by buying unless the player chose otherwise')
local p = preview(A)
assert(p.own and p.owner == A and need(p, 102) == 9 and need(p, 103) == 3 and p.cost == 9 * 120 + 30, 'buy route: ' .. tostring(p.cost))
-- The strategy is saved with the owner's plan and is used by every preview; changing it invalidates searches.
before = CP.revision
assert(CP.SetStrategy(A, 'cheapest') and CP.revision == before + 1)
p = preview(A)
assert(need(p, 101) == 15 and need(p, 103) == 3 and need(p, 102) == 0, 'cheapest: 9 bolts need 5 crafts, 15 cloth')
-- Case 10.2: a second plan aggregates before whole-batch rounding.
assert(CP.Put(A, 197, 203, 2).ok)
p = preview(A)
assert(need(p, 101) == 18 and need(p, 103) == 7, 'two plans share their bolts: ' .. need(p, 101))
assert(#p.entries == 2 and p.entries[1].recipeId == 202 and p.entries[2].recipeId == 203, 'entries in recipe order')
-- Case 10.4: previewing twice and a Put with the same count change nothing.
local again = preview(A)
assert(again.cost == p.cost and need(again, 101) == 18)
before = CP.revision
local same = CP.Put(A, 197, 203, 2)
assert(same.ok and same.crafts == 2 and same.previous == 2 and not same.changed and CP.revision == before,
  'an unchanged Put keeps the stored state and invalidates nothing')
-- Case 10.6 / 5: fresh bags reduce what to buy, counted once; the economic valuation never changes.
setBags({ [101] = 10 })
local bags = preview(A)
assert(bags.coverage.counted and need(bags, 101) == 8 and full(bags, 101) == 18, 'shortfall 8, full need 18')
assert(bags.cost == p.cost and bags.cashCost == p.cost - 10 * 25, 'owned cloth never lowers the valuation')
assert(stored(A)[202].crafts == 3 and stored(A)[203].crafts == 2, 'previews change no stored count')
setBags({ [101] = 18 })
bags = preview(A)
assert(need(bags, 101) == 0 and full(bags, 101) == 18, 'bags that cover the cloth need nothing')
-- Owned intermediates count once across both plans: 2 bolts cover 2 of the 11.
setBags({ [102] = 2, [101] = 2 })
bags = preview(A)
assert(need(bags, 101) == 13 and need(bags, 103) == 7, 'stock counted once: ' .. need(bags, 101))
setBags({})
-- Case 2 through the store: {202,1} + {203,1} needs 2 crafts of 201, 6 cloth.
assert(CP.Put(A, 197, 202, 1).ok and CP.Put(A, 197, 203, 1).ok)
p = preview(A)
assert(need(p, 101) == 6 and need(p, 103) == 3 and p.cost == 180, 'summed before rounding: ' .. tostring(p.cost))
assert(CP.Put(A, 197, 202, 3).ok and CP.Put(A, 197, 203, 2).ok)
-- Case 10.3: removing a plan removes only its contribution.
before = CP.revision
assert(CP.Remove(A, 197, 202) and CP.revision == before + 1 and stored(A)[202] == nil)
p = preview(A)
assert(need(p, 101) == 3 and need(p, 103) == 4, 'only the shirts remain')
assert(not CP.Remove(A, 197, 202), 'removing a missing plan says so')
assert(CP.Put(A, 197, 202, 3).ok)

-- A hypothetical replacement previews without storing.
local hyp = preview(A, { recipeId = 202, crafts = 1 })
assert(hyp.with and hyp.with.previous == 3 and stored(A)[202].crafts == 3, 'a preview with another count stores nothing')
assert(need(hyp, 101) == 9, 'preview of 202x1 plus 203x2: 5 bolts need 3 crafts, 9 cloth')
local gone = preview(A, { recipeId = 202, crafts = 0 })
assert(need(gone, 101) == 3, 'a preview of removal leaves the other plan')

-- Case 12: recipe 106 is not item 106; owned dye never stands in for it.
assert(CP.Put(A, 197, 106, 1).ok)
setBags({ [106] = 5 })
p = preview(A)
assert(row(p, 106) == nil and need(p, 101) == 18, 'item 106 is not bought or covered for recipe 106')
setBags({})
assert(CP.Remove(A, 197, 106))

-- Counts are never truncated: an over-limit or fractional request is refused, and nothing changes.
local snap = stored(A)[202].crafts
for _, bad in ipairs({ 0, -1, 2.5, 10000, 1 / 0 }) do
  local r = CP.Put(A, 197, 202, bad)
  assert(not r.ok and r.reason == 'count' and r.said:find('9,999', 1, true), tostring(bad) .. ': ' .. tostring(r.said))
end
local total = CP.Put(A, 197, 203, 9997)
assert(not total.ok and total.reason == 'total' and total.said:find('9,999', 1, true), total.said)
assert(stored(A)[202].crafts == snap and stored(A)[203].crafts == 2, 'a refused Put changes nothing')
-- Only a recipe the owner proved it learned can be planned.
local unknown = CP.Put(A, 197, 999, 1)
assert(not unknown.ok and unknown.reason == 'unknown' and unknown.said:find('not proven', 1, true), unknown.said)
local wrong = CP.Put(A, 171, 202, 1)
assert(not wrong.ok and wrong.reason == 'profession', 'the profession must be the recipe owner\'s')
assert(not CP.Put('nobody', 197, 202, 1).ok, 'no plan without a character')

-- Unresolved reagent identities: stored, visible and explicitly partial, never a complete plan.
assert(CP.ReplaceKnown(A, 197, { { recipeId = 300, learned = true, itemId = 400, minimum = 1, maximum = 1 } }, false))
local partial = CP.Put(A, 197, 300, 2, { unresolved = { { item = 'Slot accepts multiple reagents', count = 2 } } })
assert(partial.ok and partial.partial and partial.said:find('not all known', 1, true), partial.said)
p = preview(A)
assert(not p.complete and #p.unresolved == 1 and p.unresolved[1].recipeId == 300
  and p.unresolved[1].items[1].item == 'Slot accepts multiple reagents', 'unknown requirements stay visible')
assert(need(p, 101) == 18, 'the known plans still show their needs')
assert(CP.Remove(A, 197, 300))
-- More than 50 purchase IDs: item 51 is named and not searchable, the receipt partial.
local many = { recipeId = 301, learned = true, itemId = 401, minimum = 1, maximum = 1, reagents = {} }
for id = 5001, 5051 do many.reagents[#many.reagents + 1] = { itemId = id, count = 1 } end
assert(CP.ReplaceKnown(A, 197, { many }, false))
local big = CP.Put(A, 197, 301, 1)
assert(big.ok, big.said)
p = preview(A)
local over = row(p, 5051)
assert(not p.complete and over and over.omitted and over.need == 1, 'the 51st item is listed as omitted, not dropped')
assert(CP.Remove(A, 197, 301))

-- Another character's plan: the full requirement with the owner's own recipes, never this character's bags; no search.
setBags({ [101] = 18 })
guid = 'Player-1-0000000B'
local B = E.CharacterKey()
assert(B ~= A and next(CP.Known(B)) == nil, 'B knows no recipes')
local alt = preview(A)
assert(not alt.own and not alt.searchable and alt.searchWhy:find('another character', 1, true), tostring(alt.searchWhy))
assert(not alt.coverage.counted and need(alt, 101) == 18 and full(alt, 101) == 18, 'A\'s plan ignores B\'s bags')
assert(alt.steps[1].recipeId == 201, 'A\'s cheapest route uses A\'s own bolt recipe while B is logged in')
local bput = CP.Put(B, 197, 202, 1)
assert(not bput.ok and bput.reason == 'unknown', 'B cannot plan a recipe only A learned')
local bp = preview(B, { recipeId = 202, crafts = 1 })
assert(#bp.entries == 0 and bp.with and not bp.with.ok, 'B\'s preview never borrows A\'s recipe')
guid = 'Player-1-0000000A'

-- Missing bag APIs: the full needs, with the reason.
local saved_container = C_Container
C_Container = nil
p = preview(A)
assert(not p.coverage.counted and p.coverage.reason == 'no bag API' and need(p, 101) == 18, tostring(p.coverage.reason))
C_Container = saved_container

-- Nothing about the bags is ever saved with a plan.
local function walk(t, seen)
  for k, v in pairs(t) do
    assert(k ~= 'used' and k ~= 'owned' and k ~= 'bags' and k ~= 'have', 'a bag count was saved: ' .. tostring(k))
    if type(v) == 'table' and not seen[v] then seen[v] = true; walk(v, seen) end
  end
end
walk(EverlootDB.craftingPlans, {})
assert(EverlootDB.inventory == nil, 'previews never capture inventory without consent')

-- Caps: 50 recipes a character.
local fill = {}
for id = 600, 649 do fill[#fill + 1] = R(id, 900 + id, { 101, 1 }) end
assert(CP.ReplaceKnown(A, 197, fill, false))
for _, id in ipairs({ 202, 203 }) do assert(CP.Remove(A, 197, id)) end
for id = 600, 649 do assert(CP.Put(A, 197, id, 1).ok, 'plan ' .. id) end
assert(CP.ReplaceKnown(A, 197, { R(650, 1550, { 101, 1 }) }, false))
local full50 = CP.Put(A, 197, 650, 1)
assert(not full50.ok and full50.reason == 'full' and full50.said:find('50', 1, true), full50.said)
assert(CP.Put(A, 197, 600, 2).ok, 'an existing plan on a full list can still change')
""")
print("Lua 5.1 recipe plans: repeated Put replaces, plans aggregate before rounding, removal, owner-only bags counted "
      "once, full needs saved without bag counts, alt view full and unsearchable, partial receipts, caps")
print("Lua 5.1 crafting plan: character-scoped learned recipes, output ranges, reagent IDs, cooldown availability; "
      "own source only, filtered reads never complete, unknown identity writes nothing; buy-versus-craft resolution: "
      "whole batches summed before rounding, split routes, stock used once, cycles, bounds and capacity evidence")
