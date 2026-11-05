"""Run with: uv run --with lupa --with jsonschema python addon/tests/collection_contract.py"""
from pathlib import Path
from lupa.lua51 import LuaRuntime

lua = LuaRuntime()
lua.execute("""
date = function() return '2026-10-08T00:00:00Z' end
time = function() return 123456 end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
UnitGUID = function() return 'Creature-0-1-2-3-999-0000001' end
UnitName = function() return 'Forest Spider' end
UnitLevel = function() return 60 end
UnitIsFriend = function() return false end
UnitCanAttack = function() return true end
UnitCreatureType = function() return 'Beast' end
UnitClassification = function() return 'rareelite' end
questLog = {
 {'Elwynn Forest', 0, 0, true},
 {'Wanted: Hogger', 11, 5, false, nil, nil, nil, 176},
 {'Mage', 0, 0, true},
 {'Arcane Missive', 12, 'Elite', false, nil, nil, nil, 177},
 {'Bad Level', 0, 0, false, nil, nil, nil, 178},
}
GetQuestLogTitle = function(i)
 local r = questLog[i]
 if not r then return nil end
 return r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]
end
Enum = {QuestTag = {Group = 1, PvP = 41, Raid = 62, Dungeon = 81}}
C_QuestLog = {GetQuestTagInfo = function(id) if id == 176 then return {tagID = 81} end end}
C_Map = {GetBestMapForUnit=function() return 141 end,
 GetPlayerMapPosition=function() return pos end}
pos = {x=.42,y=.61}
GetNumLootItems = function() return 1 end
GetLootSlotLink = function() return 'item:1234' end
GetLootSlotInfo = function() return 'icon','Cloth',5 end
local corpse = 'Creature-0-1-2-3-42-0000002'
GetLootSourceInfo = function() return corpse,2,'Creature-0-1-2-3-43-0000003',3 end
GetGuildInfo = function() return 'Test Guild' end
GetRealmName = function() return 'Test Realm' end
UnitFactionGroup = function() return 'Alliance' end
C_GuildInfo = {GuildRoster=function() end}
GetNumGuildMembers = function() return 1 end
GetGuildRosterInfo = function() return 'Player-Realm','Officer',1,60,nil,nil,nil,nil,true,nil,'MAGE' end
""")
root = Path(__file__).parents[1]
for file in ["core.lua", "modules/openworld.lua", "modules/guild.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute("""
Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')
local function event(name)
 for _, hook in ipairs(Everloot.frame.hooks) do hook(nil,name) end
end
event('LOOT_OPENED')
assert(#EverlootDB.records.loot == 2, 'area loot must split physical sources')
local counts = {}
for _, row in ipairs(EverlootDB.records.loot) do
 counts[row.sourceNpcId] = row.items[1].count
 assert(row.sourceEvidence == 'loot-api')
end
assert(counts[42] == 2 and counts[43] == 3, 'source quantities must survive Lua returns')
event('LOOT_OPENED')
assert(#EverlootDB.records.loot == 2, 'reopening cannot add observations')
-- Reload the module against the same SavedVariables: retained corpse identities persist.
""")
lua.execute((root / "modules/openworld.lua").read_text(encoding="utf-8"))
lua.execute("""
Everloot:InitModules()
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil,'LOOT_OPENED') end
assert(#EverlootDB.records.loot == 2, 'reload cannot duplicate retained corpses')
GetLootSourceInfo = nil
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil,'LOOT_OPENED') end
assert(#EverlootDB.records.loot == 2, 'missing source API must not guess the target')
GetNumLootItems = function() return 0 end
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil,'LOOT_OPENED') end
assert(#EverlootDB.records.loot == 2, 'empty window must not invent a kill')
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil,'PLAYER_TARGET_CHANGED') end
assert(EverlootDB.records.npc_sighting[1].positionKind == 'player')
local sighting = EverlootDB.records.npc_sighting[1]
assert(sighting.creatureType == 'Beast' and sighting.rank == 'rare_elite', 'type and rank come from the unit')
UnitCreatureType = function() return 'Bestie' end
UnitClassification = function() return 'trivial' end
pos = {x=.45,y=.61}
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil,'PLAYER_TARGET_CHANGED') end
local last = EverlootDB.records.npc_sighting[#EverlootDB.records.npc_sighting]
assert(last.creatureType == nil and last.rank == nil, 'a localized type and a minor rank record nothing')
UnitCreatureType = nil
UnitClassification = nil
pos = {x=.48,y=.61}
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil,'PLAYER_TARGET_CHANGED') end
assert(EverlootDB.records.npc_sighting[#EverlootDB.records.npc_sighting].creatureType == nil, 'missing APIs leave the fields out')
local n = #EverlootDB.records.npc_sighting
-- Targeting or mousing over the same NPC at the same spot (rounded to 1 on the 0..100 scale) adds nothing.
pos = {x=.482,y=.613}
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil,'UPDATE_MOUSEOVER_UNIT') end
assert(#EverlootDB.records.npc_sighting == n, 'a repeat at the same spot adds no row')
-- Quest accept: level, category (nearest header above), group size, tag, faction and giver.
local function accept(index, id) for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, 'QUEST_ACCEPTED', index, id) end end
accept(2, 176)
local quest = EverlootDB.records.quest[1]
assert(quest.questId == 176 and quest.title == 'Wanted: Hogger' and quest.level == 11, 'quest title and level come from the log row')
assert(quest.category == 'Elwynn Forest' and quest.suggestedGroup == 5 and quest.tag == 'dungeon' and quest.faction == 'alliance')
assert(quest.giverNpcId == 999, 'giver is the NPC whose window is open')
accept(2, 176)
assert(#EverlootDB.records.quest == 1, 'accepting it again on the same side adds nothing')
accept(4, 177)
local second = EverlootDB.records.quest[2]
assert(second.category == 'Mage' and second.suggestedGroup == nil and second.tag == nil, 'a tag string is not a group size')
accept(3, 177)
accept(5, 178)
accept(2, 999)
assert(#EverlootDB.records.quest == 2, 'a header, a level of zero and a different quest id record nothing')
GetQuestLogTitle = nil
accept(2, 176)
assert(#EverlootDB.records.quest == 2, 'no quest log call, no quest row')
-- Forever's client (build 1.60.1.70790, mainline UI): QUEST_ACCEPTED carries only the quest id, and the log is
-- read through C_QuestLog.GetLogIndexForQuestID and C_QuestLog.GetInfo (QuestLogDocumentation.lua in the build).
modernLog = {
 {title = 'Durotar', questID = 0, level = 0, suggestedGroup = 0, isHeader = true},
 {title = 'Lazy Peons', questID = 180, level = 4, suggestedGroup = 0, isHeader = false},
 {title = 'Vile Familiars', questID = 181, level = 3, suggestedGroup = 3, isHeader = false},
 {title = 'No Level', questID = 182, level = 0, suggestedGroup = 0, isHeader = false},
}
C_QuestLog.GetInfo = function(i) return modernLog[i] end
C_QuestLog.GetLogIndexForQuestID = function(id)
 for i, q in ipairs(modernLog) do if q.questID == id and not q.isHeader then return i end end
end
local function acceptId(id) for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, 'QUEST_ACCEPTED', id) end end
acceptId(180)
local modern = EverlootDB.records.quest[3]
assert(modern and modern.questId == 180 and modern.title == 'Lazy Peons' and modern.level == 4, 'the quest id alone finds the log row')
assert(modern.category == 'Durotar' and modern.suggestedGroup == nil and modern.faction == 'alliance' and modern.giverNpcId == 999)
acceptId(181)
assert(EverlootDB.records.quest[4].suggestedGroup == 3 and EverlootDB.records.quest[4].category == 'Durotar')
acceptId(180)
acceptId(182)
acceptId(999)
assert(#EverlootDB.records.quest == 4, 'a repeat, a level of zero and a quest not in the log record nothing')
C_QuestLog.GetInfo, C_QuestLog.GetLogIndexForQuestID = nil, nil
-- Vendors on Forever's client: its merchant window reads prices with C_MerchantFrame.GetItemInfo
-- (Mainline/MerchantFrame.lua in the build); the old GetMerchantItemInfo is not there.
GetMerchantNumItems = function() return 3 end
GetMerchantItemLink = function(i) return ({ '|cffffffff|Hitem:159::::::::4:::::|h[Refreshing Spring Water]|h|r', '|Hitem:4540|h[Tough Hunk of Bread]|h' })[i] end
GetMerchantItemInfo = nil
C_MerchantFrame = { GetItemInfo = function(i)
 return ({ { name = 'Water', price = 25, stackCount = 1, numAvailable = -1 }, { name = 'Bread', price = 25, stackCount = 1, numAvailable = 5 },
  { name = 'No Link', price = 10, numAvailable = -1 } })[i]
end }
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, 'MERCHANT_SHOW') end
local vendor = EverlootDB.records.vendor and EverlootDB.records.vendor[1]
assert(vendor and vendor.vendorNpcId == 999 and #vendor.items == 2, 'the modern merchant reader records the vendor')
assert(vendor.items[1].itemId == 159 and vendor.items[1].priceCopper == 25 and vendor.items[1].limitedStock == nil)
assert(vendor.items[2].itemId == 4540 and vendor.items[2].limitedStock == 5)
C_MerchantFrame = nil
local vendors = #EverlootDB.records.vendor
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, 'MERCHANT_SHOW') end
assert(#EverlootDB.records.vendor == vendors, 'no price reader, no vendor row')
n = #EverlootDB.records.npc_sighting  -- the merchant windows above recorded the vendor as a sighting
C_Map.GetPlayerMapPosition = function() return nil end
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil,'PLAYER_TARGET_CHANGED') end
assert(#EverlootDB.records.npc_sighting == n, 'missing coordinates must not become zero')
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil,'GUILD_ROSTER_UPDATE') end
local member = EverlootDB.records.guild_snapshot[1].members[1]
assert(member.rank == 'Officer' and member.level == 60 and member.class == 'MAGE')
assert(member.lastOnlineDays == 0)
""")
# The names of drop sources this install met, for the tooltip's drop rows: read from its own sightings and loot, never
# written; each lookup reads only rows stored since the last one, and a pipe in a name cannot start an escape.
lua.execute("""
local records = EverlootDB.records
local function add(kind, row) records[kind] = records[kind] or {}; table.insert(records[kind], row) end
local before = {}
for kind, rows in pairs(records) do before[kind] = #rows end
add('npc_sighting', { npcId = 990001, name = 'Defias Bandit' })
add('object_sighting', { objectId = 990002, name = 'Copper Vein' })
add('loot', { sourceObjectId = 990003, sourceObjectName = 'Battered Chest', items = {} })
add('npc_sighting', { npcId = 990004, name = 4 })
assert(Everloot:SourceName('npc', 990001) == 'Defias Bandit', 'an NPC this install saw')
assert(Everloot:SourceName('object', 990002) == 'Copper Vein' and Everloot:SourceName('object', 990003) == 'Battered Chest', 'objects seen and looted')
assert(Everloot:SourceName('npc', 990004) == nil and Everloot:SourceName('npc', 990002) == nil, 'no name, or the wrong kind, is nil')
add('npc_sighting', { npcId = 990005, name = 'Mr. |cffff0000Red' })
assert(Everloot:SourceName('npc', 990005) == 'Mr. ||cffff0000Red', 'a later row is read, its pipe shown as a pipe')
for kind, rows in pairs(records) do
  local n = (before[kind] or 0) + ((kind == 'npc_sighting' and 3) or ((kind == 'object_sighting' or kind == 'loot') and 1) or 0)
  assert(#rows == n, 'looking up names stores nothing: ' .. kind)
end
-- Leave the rows as they were, for the schema check below.
for kind, n in pairs({ npc_sighting = 3, object_sighting = 1, loot = 1 }) do
  for _ = 1, n do table.remove(records[kind]) end
  if #records[kind] == 0 and not before[kind] then records[kind] = nil end
end
""")
# Every row the addon wrote is a record the site would accept (packages/protocol/schema).
from protocol_schema import check_all  # noqa: E402
check_all(lua)
print("Lua 5.1 collection: physical sources, quantities, reopen/reload, missing APIs, position provenance, NPC type and rank, quest accept and roster passed")
