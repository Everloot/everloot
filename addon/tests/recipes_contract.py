"""Run with: uv run --with lupa --with jsonschema python addon/tests/recipes_contract.py

The mock follows the signatures in Blizzard's own API documentation for build 1.60.1.70450
(C_TradeSkillUI, C_Item, ProfessionInfo, TradeSkillRecipeInfo, CraftingRecipeSchematic) and the
trainer globals as Blizzard's trainer window calls them.
The optional GetAllRecipeIDs capability is tested separately: clients without it must retain
the filtered reader. Field types: Gethe/wow-ui-source 172a387, Blizzard_APIDocumentationGenerated/
TradeSkillUITypesDocumentation.lua (TradeSkillRecipeInfo.recipeID and learned).
"""
import re
from pathlib import Path
from lupa.lua51 import LuaRuntime

lua = LuaRuntime()
lua.execute("""
date = function() return '2026-10-10T00:00:00Z' end
time = function() return 123456 end
printed = {}
print = function(...) printed[#printed + 1] = table.concat({ ... }, ' ') end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end

-- C_Timer runs nothing by itself: the test drains it, so chunking and debouncing are visible.
timers = {}
C_Timer = { After = function(seconds, f) table.insert(timers, { seconds = seconds, f = f }) end }
function drain() local n = 0; while #timers > 0 do local t = table.remove(timers, 1); n = n + 1; t.f() end return n end

-- Nothing here may craft, learn, train, buy, post or change the window: every such call is a trap.
forbidden = {}
local function trap(name) return function() forbidden[#forbidden + 1] = name end end

-- Enum values from the documentation: TradeskillRelativeDifficulty Optimal 0, Medium 1, Easy 2, Trivial 3;
-- CraftingReagentType Modifying 0, Basic 1, Finishing 2; TradeskillSlotDataType Reagent 1, Currency 3.
local items = { [2447] = 'Peacebloom', [3371] = 'Empty Vial', [2450] = 'Briarthorn', [118] = 'Minor Healing Potion',
  [10940] = 'Strange Dust', [2589] = 'Linen Cloth', [2592] = 'Wool Cloth' }
itemsLoaded = true
loadRequests = {}
C_Item = {
 GetItemNameByID = function(itemInfo)
  if itemInfo == 9999 then return itemsLoaded and 'Late Herb' or nil end
  return items[itemInfo]
 end,
 RequestLoadItemDataByID = function(itemInfo) loadRequests[#loadRequests + 1] = itemInfo end,
}

local function slot(itemIDs, quantity, reagentType, required, dataSlotType)
 local reagents = {}
 for _, id in ipairs(itemIDs) do reagents[#reagents + 1] = { itemID = id } end
 return { reagents = reagents, reagentType = reagentType or 1, variableQuantities = {}, quantityRequired = quantity,
  dataSlotType = dataSlotType or 1, dataSlotIndex = 1, slotIndex = 1, required = required ~= false, hiddenInCraftingForm = false }
end
recipes = {
 [1001] = { name = 'Minor Healing Potion', difficulty = 3, output = 118, slots = { slot({ 2447 }, 1), slot({ 3371 }, 1),
   slot({ 2450 }, 1, 2, false), slot({ 2450 }, 5, 0, false) } },
 [1002] = { name = 'Lesser Healing Potion', difficulty = 0, output = 858, slots = { slot({ 2450 }, 1), slot({ 118 }, 1) } },
 [1003] = { name = 'No Colour Yet', difficulty = nil, output = 1, slots = { slot({ 2450 }, 1) } },
 [1004] = { name = 'Bolt of Cloth', difficulty = 1, output = 2996, slots = { slot({ 2589, 2592 }, 2) } },
 [1005] = { name = 'Late Potion', difficulty = 2, output = 5, slots = { slot({ 9999 }, 3) } },
 [1006] = { name = 'Currency Craft', difficulty = 0, output = 6, slots = { slot({ 2450 }, 2), { reagents = { { currencyID = 1 } },
   reagentType = 1, quantityRequired = 5, dataSlotType = 3, required = true } } },
 [2001] = { name = 'Enchant Bracer - Minor Health', difficulty = 1, output = nil, slots = { slot({ 10940 }, 1) } },
}
function recipeInfo(id)
 local r = recipes[id]
 if not r then return nil end
 return { categoryID = 1, name = r.name, relativeDifficulty = r.difficulty, maxTrivialLevel = 100, itemLevel = 0, numSkillUps = 1,
  canSkillUp = true, firstCraft = false, learned = true, disabled = false, favorite = false, supportsQualities = false,
  craftable = true, recipeID = id, skillLineAbilityID = id, isDummyRecipe = false }
end
function schematic(id)
 local r = recipes[id]
 return { recipeID = id, icon = 1, quantityMin = 1, quantityMax = 1, name = r.name, recipeType = 1, outputItemID = r.output,
  reagentSlotSchematics = r.slots, isRecraft = false, hasCraftingOperationInfo = false }
end

-- The window: Alchemy at 60/75.
child = { professionID = 171, sourceCounter = 1, professionName = 'Alchemy', expansionName = '', skillLevel = 60, maxSkillLevel = 75,
 skillModifier = 0, isPrimaryProfession = true }
listed = { 1001, 1002, 1003, 1004, 1005, 1006 }
getInfoCalls = 0
C_TradeSkillUI = {
 GetChildProfessionInfo = function() return child end,
 GetBaseProfessionInfo = function() return child end,
 GetFilteredRecipeIDs = function() return listed end,
 GetRecipeInfo = function(id, recipeLevel) getInfoCalls = getInfoCalls + 1; return recipeInfo(id) end,
 GetRecipeSchematic = function(id, isRecraft, recipeLevel) return schematic(id) end,
}
for _, name in ipairs({ 'CraftRecipe', 'CraftEnchant', 'CraftSalvage', 'RecraftRecipe', 'RecraftRecipeForOrder', 'OpenTradeSkill',
  'OpenRecipe', 'CloseTradeSkill', 'SetRecipeTracked', 'SetShowLearned', 'SetShowUnlearned', 'SetSourceTypeFilter',
  'SetProfessionChildSkillLineID' }) do
 C_TradeSkillUI[name] = trap('C_TradeSkillUI.' .. name)
end
for _, name in ipairs({ 'DoTradeSkill', 'DoCraft', 'BuyTrainerService', 'SelectTrainerService', 'CloseTrainer', 'LearnTalent',
  'LearnPreviewTalents', 'LearnSkill', 'UseTradeSkillItem' }) do
 _G[name] = trap(name)
end

-- Trainer window, in the order Blizzard's trainer window reads: name, serviceType, texture, reqLevel, subText, category.
services = {
 {'Potions', 'header', nil, 0, '', ''},
 {'Lesser Healing Potion', 'available', 'icon', 0, '', 'Alchemy', 'Alchemy', 55, 250},
 {'Elixir of Minor Agility', 'unavailable', 'icon', 0, '', 'Alchemy', 'Alchemy', 50, 300},
 {'Fireball', 'available', 'icon', 4, 'Rank 2', 'Mage', nil, nil, 100},
 {'Next Step', 'available', 'icon', 0, '', '', 'Alchemy', 75, 99999},
}
stepIndex = 5
GetNumTrainerServices = function() return #services end
GetTrainerServiceInfo = function(i) local s = services[i]; return s[1], s[2], s[3], s[4], s[5], s[6] end
-- skill, rank, hasSkillReq
GetTrainerServiceSkillReq = function(i) local s = services[i]; if s[7] then return s[7], s[8], true end end
-- moneyCost, isProfession
GetTrainerServiceCost = function(i) return services[i][9] or 0, false end
GetTrainerServiceStepIndex = function() return stepIndex end
""")
root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\professions.lua" in toc, "professions module must be in the TOC"
for file in ["core.lua", "modules/professions.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute("""
Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')
local function event(name) for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, name) end end
function fire(name) event(name); return drain() end
local function rows() return EverlootDB.records.recipe_observed or {} end
local function byName(name) for _, r in ipairs(rows()) do if r.recipe == name then return r end end end

-- Before the window opens nothing is read.
assert(#rows() == 0 and getInfoCalls == 0)

-- Alchemy: colours at the rank, product and basic reagents from the schematic. Optional and finishing slots,
-- currency slots, a recipe with no colour and a recipe whose reagent name is not loaded yet record nothing wrong.
itemsLoaded = false
fire('TRADE_SKILL_SHOW')
local lesser = byName('Lesser Healing Potion')
assert(lesser.profession == 'Alchemy' and lesser.rank == 60 and lesser.maxRank == 75 and lesser.difficulty == 'optimal')
assert(lesser.productItemId == 858 and #lesser.reagents == 2, 'two basic reagents')
assert(lesser.reagents[1].item == 'Briarthorn' and lesser.reagents[1].count == 1 and lesser.reagents[2].item == 'Minor Healing Potion')
local minor = byName('Minor Healing Potion')
assert(minor.difficulty == 'trivial' and minor.productItemId == 118 and #minor.reagents == 2, 'optional and finishing slots are not reagents')
assert(minor.reagents[1].item == 'Peacebloom' and minor.reagents[2].item == 'Empty Vial')
assert(byName('No Colour Yet') == nil, 'no relativeDifficulty, no row')
local bolt = byName('Bolt of Cloth')
assert(bolt.difficulty == 'medium' and #bolt.reagents == 0, 'a slot with several possible items is not guessed')
assert(byName('Currency Craft') and #byName('Currency Craft').reagents == 1, 'a currency slot is not an item reagent')
assert(byName('Late Potion') == nil and #loadRequests > 0 and loadRequests[1] == 9999, 'an unloaded reagent name defers the row and asks the client to load it')
assert(#rows() == 4, 'got ' .. #rows())
for _, r in ipairs(rows()) do assert(r.installId and r.capturedAt and r.eventId) end

-- The name loads: the next read adds it; reopening at the same rank adds nothing.
itemsLoaded = true
fire('TRADE_SKILL_LIST_UPDATE')
assert(byName('Late Potion').reagents[1].item == 'Late Herb' and byName('Late Potion').reagents[1].count == 3)
assert(#rows() == 5)
fire('TRADE_SKILL_SHOW'); fire('TRADE_SKILL_LIST_UPDATE'); fire('TRADE_SKILL_DATA_SOURCE_CHANGED')
assert(#rows() == 5, 'same rank and colour is not observed twice')

-- A new rank is a new observation.
child.skillLevel = 70
fire('TRADE_SKILL_LIST_UPDATE')
assert(#rows() == 10, 'a new rank records each recipe again; got ' .. #rows())
assert(rows()[#rows()].rank == 70)

-- A burst of list updates is one read.
local before = getInfoCalls
event('TRADE_SKILL_LIST_UPDATE'); event('TRADE_SKILL_LIST_UPDATE'); event('TRADE_SKILL_LIST_UPDATE')
drain()
assert(getInfoCalls - before == #listed, 'one read for a burst of updates, got ' .. (getInfoCalls - before))

-- Updates while no window is open read nothing; closing the window ends a read in progress.
fire('TRADE_SKILL_CLOSE')
before = getInfoCalls
fire('TRADE_SKILL_LIST_UPDATE')
assert(getInfoCalls == before, 'no read for a closed window')

-- Enchanting in the same window: the profession info reports 0/0 levels, so the rank comes from the
-- profession book, as Blizzard's own frame does. Enchants have no product item.
child = { professionID = 333, sourceCounter = 1, professionName = 'Enchanting', expansionName = '', skillLevel = 0, maxSkillLevel = 0,
 skillModifier = 0, isPrimaryProfession = true }
listed = { 2001 }
GetProfessions = function() return nil, 3 end
GetProfessionInfo = function(index)
 -- name, texture, rank, maxRank, numSpells, spellOffset, skillLine, rankModifier
 if index == 3 then return 'Enchanting', 'icon', 40, 75, 2, 0, 333, 0 end
end
fire('TRADE_SKILL_SHOW')
local enchant = byName('Enchant Bracer - Minor Health')
assert(enchant and enchant.profession == 'Enchanting' and enchant.rank == 40 and enchant.maxRank == 75 and enchant.difficulty == 'medium')
assert(enchant.productItemId == nil and enchant.reagents[1].item == 'Strange Dust')
-- With no book to ask, 0/0 is not a rank: nothing is written.
GetProfessions = nil
child.professionID = 334
listed = { 1002 }
local count = #rows()
fire('TRADE_SKILL_LIST_UPDATE')
assert(#rows() == count, 'a rank that cannot be read records nothing')
assert(Everloot:Status():find('nothing recorded: no skill level', 1, true), Everloot:Status())

-- The intake allows ranks 1 to 500: a larger rank writes nothing, a larger maximum is left out.
child = { professionID = 171, professionName = 'Alchemy', skillLevel = 501, maxSkillLevel = 600 }
listed = { 1002 }
count = #rows()
fire('TRADE_SKILL_LIST_UPDATE')
assert(#rows() == count, 'rank above 500 records nothing')
child = { professionID = 171, professionName = 'Alchemy', skillLevel = 120, maxSkillLevel = 501 }
fire('TRADE_SKILL_LIST_UPDATE')
assert(rows()[#rows()].rank == 120 and rows()[#rows()].maxRank == nil, 'maxRank above 500 is left out')

-- A child (expansion) profession names its parent; the parent is the profession written.
child = { professionID = 2823, parentProfessionID = 171, parentProfessionName = 'Alchemy', professionName = 'Classic Alchemy',
 expansionName = 'Classic', skillLevel = 80, maxSkillLevel = 150, skillModifier = 0, isPrimaryProfession = true }
listed = { 1002 }
fire('TRADE_SKILL_LIST_UPDATE')
assert(rows()[#rows()].profession == 'Alchemy' and rows()[#rows()].rank == 80)
assert(Everloot:Status():find('Alchemy 80/150, 1 recipes listed, 1 new rows', 1, true), Everloot:Status())

-- A long list is read in chunks across frames.
child = { professionID = 171, professionName = 'Alchemy', skillLevel = 90, maxSkillLevel = 150 }
for id = 5000, 5119 do recipes[id] = { name = 'Bulk ' .. id, difficulty = 2, output = id, slots = {} } end
listed = {}
for id = 5000, 5119 do listed[#listed + 1] = id end
before = getInfoCalls
fire('TRADE_SKILL_CLOSE'); event('TRADE_SKILL_SHOW')
local first = table.remove(timers, 1)  -- the debounce
first.f()
assert(getInfoCalls - before == 50 and #timers == 1, 'the first frame reads one chunk of 50, got ' .. (getInfoCalls - before))
drain()
assert(getInfoCalls - before == 120)
assert(#rows() >= 120)

-- Closing the window between frames stops the read.
for id = 6000, 6119 do recipes[id] = { name = 'Stop ' .. id, difficulty = 2, output = id, slots = {} } end
listed = {}
for id = 6000, 6119 do listed[#listed + 1] = id end
child.skillLevel = 91
before = getInfoCalls
event('TRADE_SKILL_LIST_UPDATE')
table.remove(timers, 1).f()
assert(getInfoCalls - before == 50)
event('TRADE_SKILL_CLOSE')
drain()
assert(getInfoCalls - before == 50, 'a closed window ends the read')

-- Trainer: each recipe's required rank and cost; headers, class spells and the profession step row are skipped.
event('TRAINER_SHOW')
local trained = EverlootDB.records.trainer_seen
assert(trained and #trained == 2, 'two trainer recipes; got ' .. tostring(trained and #trained))
assert(trained[1].profession == 'Alchemy' and trained[1].recipe == 'Lesser Healing Potion' and trained[1].requiredRank == 55 and trained[1].costCopper == 250)
assert(trained[2].recipe == 'Elixir of Minor Agility' and trained[2].requiredRank == 50, 'a recipe not yet learnable is still listed with its rank')
event('TRAINER_UPDATE'); event('TRAINER_SHOW')
assert(#EverlootDB.records.trainer_seen == 2, 'reopening the trainer adds nothing')
assert(trained[1].trainerNpcId == nil, 'no NPC unit, no trainer id')
-- With the trainer's GUID readable, its rows name it, once per trainer.
UnitGUID = function(unit) if unit == 'npc' then return 'Creature-0-1-2-3-3347-0000000001' end end
event('TRAINER_SHOW')
assert(#EverlootDB.records.trainer_seen == 4 and trained[3].trainerNpcId == 3347 and trained[4].trainerNpcId == 3347)
event('TRAINER_SHOW')
assert(#EverlootDB.records.trainer_seen == 4, 'reopening the same trainer adds nothing')
UnitGUID = function() return 'Player-1-00000001' end
event('TRAINER_SHOW')
assert(#EverlootDB.records.trainer_seen == 4, 'a GUID that is not a creature adds no trainer id and nothing new')
UnitGUID = nil

-- Missing calls record nothing, never error, and the status says which.
local saved = C_TradeSkillUI.GetFilteredRecipeIDs
C_TradeSkillUI.GetFilteredRecipeIDs = nil
child.skillLevel = 99
count = #rows()
fire('TRADE_SKILL_SHOW')
assert(#rows() == count)
assert(Everloot:Status():find('missing C_TradeSkillUI.GetFilteredRecipeIDs (records nothing)', 1, true), Everloot:Status())
C_TradeSkillUI.GetFilteredRecipeIDs = saved
local trainerCount = #EverlootDB.records.trainer_seen
GetTrainerServiceSkillReq = nil
services[2][8] = 56
event('TRAINER_SHOW')
assert(#EverlootDB.records.trainer_seen == trainerCount)
assert(Everloot:Status():find('missing GetTrainerServiceSkillReq (records nothing)', 1, true), Everloot:Status())
C_TradeSkillUI = nil
C_Item = nil
fire('TRADE_SKILL_SHOW')

assert(#forbidden == 0, 'forbidden call: ' .. table.concat(forbidden, ','))
""")

# The complete list is independent of search/learned filters; identity is the API recipe ID.
lua.execute("""
C_Item = { GetItemNameByID = function() return 'Herb' end }
child = { professionID = 171, professionName = 'Alchemy', skillLevel = 100, maxSkillLevel = 150 }
local all = { 7101, 7102 }
local learned = false
local recipeName = 'Same Name'
local colour = 0
local allCalls, filteredCalls = 0, 0
C_TradeSkillUI = {
 GetChildProfessionInfo = function() return child end,
 GetBaseProfessionInfo = function() return child end,
 GetAllRecipeIDs = function() allCalls = allCalls + 1; return all end,
 GetFilteredRecipeIDs = function() filteredCalls = filteredCalls + 1; return { 7101 } end,
 GetRecipeInfo = function(id) return { recipeID = id, name = recipeName, relativeDifficulty = colour, learned = learned } end,
 GetRecipeSchematic = function() return { reagentSlotSchematics = {} } end,
}
local function rows() return EverlootDB.records.recipe_observed end
local count = #rows()
fire('TRADE_SKILL_SHOW')
assert(#rows() == count + 2, 'all IDs include filtered-out recipes and same-name IDs stay distinct')
assert(allCalls == 1 and filteredCalls == 0, 'prefer the complete list without touching filters')
assert(rows()[count + 1].recipeId == 7101 and rows()[count + 2].recipeId == 7102)
assert(rows()[count + 1].learned == false, 'unlearned is a boolean, not missing')
recipeName = 'Localized Name'
fire('TRADE_SKILL_LIST_UPDATE')
assert(#rows() == count + 2, 'localization does not change recipe identity')
learned = true
fire('NEW_RECIPE_LEARNED')
assert(#rows() == count + 4 and rows()[#rows()].learned == true, 'learning at the same rank and colour adds a row')
colour = 1
fire('TRADE_SKILL_LIST_UPDATE')
assert(#rows() == count + 6, 'a new difficulty at the same rank adds a row')
child.skillLevel = 101
fire('TRADE_SKILL_LIST_UPDATE')
assert(#rows() == count + 8, 'a new rank still adds rows')
-- A bad optional learned value stays unknown; it must never become true or false by truthiness.
learned = 'false'
fire('TRADE_SKILL_LIST_UPDATE')
assert(#rows() == count + 10 and rows()[#rows()].learned == nil)
local secret = {}
issecretvalue = function(value) return value == secret end
learned = secret
fire('TRADE_SKILL_LIST_UPDATE')
assert(#rows() == count + 10, 'secret learned is the same unknown state')
all = { 0, -1, 1.5, math.huge, 9007199254740992, '7101', secret, 7101 }
child.skillLevel = 102
local getInfo = C_TradeSkillUI.GetRecipeInfo
local invalidCalls = 0
C_TradeSkillUI.GetRecipeInfo = function(id) if id ~= 7101 then invalidCalls = invalidCalls + 1; return nil end; return getInfo(id) end
fire('TRADE_SKILL_LIST_UPDATE')
assert(invalidCalls == 0, 'invalid list ID reached API')
assert(#rows() == count + 11 and rows()[#rows()].recipeId == 7101)
issecretvalue = nil
-- Missing, throwing or invalid complete-list APIs fall back honestly to the filtered list.
for _, mode in ipairs({ 'missing', 'throws', 'invalid' }) do
 if mode == 'missing' then C_TradeSkillUI.GetAllRecipeIDs = nil
 else C_TradeSkillUI.GetAllRecipeIDs = function() if mode == 'throws' then error('not ready') end; return false end end
 child.skillLevel = child.skillLevel + 1
 fire('TRADE_SKILL_LIST_UPDATE')
 assert(Everloot:Status():find('filtered recipe list', 1, true), Everloot:Status())
end
assert(filteredCalls == 3)
-- Complete-list-only clients need no filtered reader.
C_TradeSkillUI.GetFilteredRecipeIDs = nil
C_TradeSkillUI.GetAllRecipeIDs = function() allCalls = allCalls + 1; return { 7101 } end
child.skillLevel = 106
fire('TRADE_SKILL_LIST_UPDATE')
assert(rows()[#rows()].rank == 106)
fire('TRADE_SKILL_CLOSE')
local closedCalls = allCalls
fire('NEW_RECIPE_LEARNED')
assert(allCalls == closedCalls, 'learning while closed cannot open or read a profession')
""")

# Turning the module off stops an already chunked read and refuses later window events.
lua.execute("""
local function rows() return EverlootDB.records.recipe_observed or {} end
local pending = {}
C_Timer = { After = function(_, fn) pending[#pending + 1] = fn end }
C_TradeSkillUI.GetAllRecipeIDs = function()
 local ids = {}; for i = 1, 110 do ids[i] = 8000 + i end; return ids
end
C_TradeSkillUI.GetRecipeInfo = function(id) return { name = 'Recipe ' .. id, relativeDifficulty = 0, learned = true } end
C_TradeSkillUI.GetRecipeSchematic = function() return { outputItemID = 1, reagentSlotSchematics = {} } end
local before = #rows()
fire('TRADE_SKILL_SHOW')
table.remove(pending, 1)()
assert(#rows() == before + 50, 'the first chunk records before disabling')
EverlootDB.toggles.professions = false
while #pending > 0 do table.remove(pending, 1)() end
assert(#rows() == before + 50, 'disabling stops pending chunks')
fire('TRADE_SKILL_SHOW')
fire('NEW_RECIPE_LEARNED')
while #pending > 0 do table.remove(pending, 1)() end
assert(#rows() == before + 50, 'disabled window events cannot collect')
EverlootDB.toggles.professions = true
fire('TRADE_SKILL_SHOW')
while #pending > 0 do table.remove(pending, 1)() end
assert(#rows() == before + 110, 'reenabling collects the remaining recipes')
fire('TRADE_SKILL_CLOSE')
""")

# A client with none of the modern API loads the module and says so.
lua2 = LuaRuntime()
lua2.execute("""
date = function() return '2026-10-10T00:00:00Z' end
time = function() return 1 end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end, SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end } end
""")
for file in ["core.lua", "modules/professions.lua"]:
    lua2.execute((root / file).read_text(encoding="utf-8"))
lua2.execute("""
Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')
local status = Everloot:Status()
assert(status:find('missing C_TradeSkillUI', 1, true) and status:find('missing GetNumTrainerServices', 1, true), status)
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, 'TRADE_SKILL_SHOW'); hook(nil, 'TRAINER_SHOW') end
assert(Everloot:Count('recipe_observed') == 0 and Everloot:Count('trainer_seen') == 0)
""")

# Display and read only: the professions module calls nothing that crafts, learns, trains, buys or posts, and
# the only C_TradeSkillUI functions it names are these five readers. Source files outside tests are scanned.
READERS = {"GetBaseProfessionInfo", "GetChildProfessionInfo", "GetAllRecipeIDs", "GetFilteredRecipeIDs", "GetRecipeInfo", "GetRecipeSchematic"}
professions = (root / "modules" / "professions.lua").read_text(encoding="utf-8")
code = "\n".join(line.split("--")[0] for line in professions.splitlines())
named = set(re.findall(r"\b(?:T|C_TradeSkillUI)\.(\w+)", code))
assert named <= READERS, f"professions.lua names a C_TradeSkillUI function that is not a reader: {sorted(named - READERS)}"
actions = (r"CraftRecipe|CraftEnchant|CraftSalvage|RecraftRecipe|RecraftRecipeForOrder|DoTradeSkill|DoCraft|UseTradeSkillItem|"
           r"BuyTrainerService|SelectTrainerService|CloseTrainer|LearnTalent|LearnTalents|LearnPreviewTalents|LearnSkill|"
           r"OpenTradeSkill|OpenRecipe|CloseTradeSkill|SetRecipeTracked|SetShowLearned|SetShowUnlearned|SetSourceTypeFilter|"
           r"SetProfessionChildSkillLineID|PostItem|PostCommodity|PlaceBid|PlaceAuctionBid|StartCommoditiesPurchase|"
           r"ConfirmCommoditiesPurchase|BuyoutItem|StartAuction|PostAuction|CancelAuction")
for source in sorted(root.rglob("*.lua")):
    if "tests" in source.parts:
        continue
    text = "\n".join(line.split("--")[0] for line in source.read_text(encoding="utf-8").splitlines())
    called = re.search(rf"\b({actions})\s*\(|pcall\(\s*(?:[A-Za-z_]+\.)?({actions})\b", text)
    assert not called, f"{source.name} calls a craft, learn, train, buy or post API: {called.group(0)}"
# Every row the addon wrote is a record the site would accept (packages/protocol/schema).
from protocol_schema import check_all  # noqa: E402
check_all(lua)
print("Lua 5.1 recipes: modern C_TradeSkillUI profession window, schematic reagents, chunked reads, rank fallback, trainer window, "
      "missing APIs reported, no craft, learn, train, buy or post call")
