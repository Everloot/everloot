"""Run with: uv run --with lupa --with jsonschema python addon/tests/loot_types_contract.py

What a loot window is (loot tables spec, sections 3 to 5): its `lootType` from the spell cast just before it
(Pick Pocket, Skinning, Disenchant, Pick Lock, by English name or Classic id), `sourceItemId` for a disenchanted
or opened item, and the coin in the window as `copper`. The local GUID set keys on GUID and loot type, so a kill
and a skinning or pick-pocket window on one corpse are both kept. Spell ids, the item GUID lookups and the coin
slot type are from Blizzard's documentation and were not checked on the Forever client, so a missing call must
record nothing rather than error. No name other than an object's own ever enters a row.
"""
from pathlib import Path
from lupa.lua51 import LuaRuntime
from protocol_schema import check_all

STUBS = """
date = function() return '2026-10-23T00:00:00Z' end
time = function() return 123456 end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function(self, name) self.events=self.events or {}; self.events[name]=true end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
UnitGUID = function() end
clock = 100
GetTime = function() return clock end
-- One loot window: slots[i] = { link, text, count, type, sources = { guid, quantity, ... } }
slots = {}
GetNumLootItems = function() return #slots end
GetLootSlotLink = function(i) return slots[i].link end
GetLootSlotInfo = function(i) return 'icon', slots[i].text or 'x', slots[i].count or 1 end
GetLootSlotType = function(i) return slots[i].type or 1 end
GetLootSourceInfo = function(i) return unpack(slots[i].sources) end
"""

root = Path(__file__).parents[1]
lua = LuaRuntime()
lua.execute(STUBS)
for file in ["core.lua", "modules/openworld.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute("""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
function event(name, ...) for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, name, ...) end end
function rows() return EverlootDB.records.loot or {} end
function last() local r = rows(); return r[#r] end
function window(guid, items, coin)
  slots = {}
  for _, it in ipairs(items or {}) do slots[#slots + 1] = { link = 'item:' .. it[1], count = it[2] or 1, sources = { guid, it[2] or 1 } } end
  if coin then slots[#slots + 1] = { text = coin.text, type = 2, sources = { guid, coin.copper } } end
  event('LOOT_OPENED')
  event('LOOT_CLOSED')
end
local corpse = 'Creature-0-1-2-3-299-0000000001'

-- A kill, then a skinning window and a pick-pocket window on the same corpse: all three are kept.
window(corpse, { { 2589, 2 } })
assert(#rows() == 1 and last().lootType == 'kill' and last().sourceNpcId == 299)
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-1', 8613)
event('UNIT_SPELLCAST_SUCCEEDED', 'player', 'Cast-1', 8613)
window(corpse, { { 783, 1 } })
assert(#rows() == 2 and last().lootType == 'skinning' and last().sourceNpcId == 299 and last().gatherKind == nil)
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-2', 921)
window(corpse, { { 4306, 1 } })
assert(#rows() == 3 and last().lootType == 'pickpocket' and last().sourceNpcId == 299)
-- The same type on the same corpse is still one window; and no cast name or target is on any row.
window(corpse, { { 2589, 2 } })
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-3', 8618)
window(corpse, { { 783, 1 } })
assert(#rows() == 3, 'a window opened twice is one window')
for _, row in ipairs(rows()) do assert(row.sourceObjectName == nil and row.sourceItemId == nil) end

-- By spell name (old signature), herb gathering on a creature is skinning, a stale cast types nothing.
event('UNIT_SPELLCAST_SENT', 'player', 'Pick Pocket', 'Rank 1', 'Bob')
window('Creature-0-1-2-3-300-0000000001', { { 4306, 1 } })
assert(last().lootType == 'pickpocket' and last().sourceNpcId == 300)
event('UNIT_SPELLCAST_SENT', 'player', 'Skinning', 'Rank 1', 'Bob')
event('UNIT_SPELLCAST_SUCCEEDED', 'player', 'Rank 1', 8613)
clock = clock + 20
window('Creature-0-1-2-3-301-0000000001', { { 783, 1 } })
assert(last().lootType == 'kill', 'a cast 20 seconds ago is not this window')
event('UNIT_SPELLCAST_SENT', 'player', 'Peacebloom', 'Cast-4', 2366)
window('Creature-0-1-2-3-302-0000000001', { { 783, 1 } })
assert(last().lootType == 'skinning')

-- Objects: gather, or fishing.
event('UNIT_SPELLCAST_SENT', 'player', 'Peacebloom', 'Cast-5', 2366)
window('GameObject-0-1-2-3-1618-0000000001', { { 2447, 1 } })
assert(last().lootType == 'gather' and last().gatherKind == 'herb')
event('UNIT_SPELLCAST_SENT', 'player', '', 'Cast-6', 7620)
window('GameObject-0-1-2-3-35591-0000000001', { { 6358, 1 } })
assert(last().lootType == 'fishing')
window('GameObject-0-1-2-3-2843-0000000001', { { 2589, 1 } })
assert(last().lootType == 'gather', 'an object window with no cast is a gather window')

-- Disenchanting: the item's id is read from the cast target while the item is in the bags.
GetItemInfoInstant = function(name) if name == 'Green Iron Bracers' then return 3835 end end
local before = #rows()
event('UNIT_SPELLCAST_SENT', 'player', 'Green Iron Bracers', 'Cast-7', 13262)
event('UNIT_SPELLCAST_SUCCEEDED', 'player', 'Cast-7', 13262)
window('Item-4372-0-4000000000000001', { { 10940, 2 } })
assert(#rows() == before + 1 and last().lootType == 'disenchant' and last().sourceItemId == 3835)
assert(last().sourceNpcId == nil and last().sourceObjectId == nil and last().items[1].itemId == 10940)
-- An item the addon cannot name records nothing.
event('UNIT_SPELLCAST_SENT', 'player', 'Gone Item', 'Cast-8', 13262)
window('Item-4372-0-4000000000000002', { { 10940, 1 } })
assert(#rows() == before + 1, 'no item id, no row')
GetItemInfoInstant = nil

-- An opened container with no cast: the id comes from the item GUID, by either API the client may have.
C_Item = { GetItemIDByGUID = function(guid) if guid == 'Item-4372-0-4000000000000003' then return 5523 end end }
window('Item-4372-0-4000000000000003', { { 5498, 1 } })
assert(last().lootType == 'container' and last().sourceItemId == 5523)
C_Item = { GetItemLocation = function(guid) return { guid = guid } end, GetItemID = function(location)
  if location.guid == 'Item-4372-0-4000000000000004' then return 5524 end end }
window('Item-4372-0-4000000000000004', { { 5498, 1 } })
assert(last().lootType == 'container' and last().sourceItemId == 5524)
-- A lockbox picked: the cast names the item.
GetItemInfoInstant = function() return 4632 end
event('UNIT_SPELLCAST_SENT', 'player', 'Ornate Bronze Lockbox', 'Cast-9', 1804)
event('UNIT_SPELLCAST_SUCCEEDED', 'player', 'Cast-9', 1804)
window('Item-4372-0-4000000000000005', { { 2589, 1 } })
assert(last().lootType == 'container' and last().sourceItemId == 4632)
GetItemInfoInstant, C_Item = nil, nil
-- The client has no item lookup at all: nothing is recorded, nothing errors.
count = #rows()
window('Item-4372-0-4000000000000006', { { 5498, 1 } })
assert(#rows() == count)

-- Coin: the slot's text in copper, with the items or alone.
window('Creature-0-1-2-3-400-0000000001', { { 2589, 1 } }, { text = '1 Gold\\n20 Silver\\n5 Copper', copper = 12005 })
assert(last().lootType == 'kill' and last().copper == 12005 and #last().items == 1)
window('Creature-0-1-2-3-401-0000000001', {}, { text = '37 Copper', copper = 37 })
assert(last().copper == 37 and #last().items == 0 and last().sourceNpcId == 401, 'a coin-only window is a window')
window('Creature-0-1-2-3-402-0000000001', { { 2589, 1 } })
assert(last().copper == nil, 'no coin slot, no copper')
GOLD_AMOUNT, SILVER_AMOUNT, COPPER_AMOUNT = '%d Oro', '%d Plata', '%d Cobre'
window('Creature-0-1-2-3-403-0000000001', {}, { text = '2 Oro 9 Plata', copper = 20900 })
assert(last().copper == 20900, 'the game own amount strings')
GOLD_AMOUNT, SILVER_AMOUNT, COPPER_AMOUNT = nil, nil, nil
window('Creature-0-1-2-3-404-0000000001', {}, { text = '1,234 Gold', copper = 12340000 })
assert(last().copper == 12340000, 'a thousands separator')
-- A slot of coin type with text that holds no amount, and a slot that is not coin type, give none.
window('Creature-0-1-2-3-405-0000000001', {}, { text = 'Linen Cloth', copper = 5 })
assert(last().sourceNpcId ~= 405, 'nothing in it, nothing recorded')
-- Shared coin: two corpses, amounts that add up are split; amounts that do not are left out.
slots = { { link = 'item:2589', count = 2, sources = { 'Creature-0-1-2-3-406-0000000001', 1, 'Creature-0-1-2-3-407-0000000001', 1 } },
  { text = '1 Silver', type = 2, sources = { 'Creature-0-1-2-3-406-0000000001', 60, 'Creature-0-1-2-3-407-0000000001', 40 } } }
event('LOOT_OPENED'); event('LOOT_CLOSED')
local split = {}
for _, row in ipairs(rows()) do if row.sourceNpcId == 406 or row.sourceNpcId == 407 then split[row.sourceNpcId] = row.copper end end
assert(split[406] == 60 and split[407] == 40, 'coin split between two sources')
slots = { { link = 'item:2589', count = 2, sources = { 'Creature-0-1-2-3-408-0000000001', 1, 'Creature-0-1-2-3-409-0000000001', 1 } },
  { text = '1 Silver', type = 2, sources = { 'Creature-0-1-2-3-408-0000000001', 60, 'Creature-0-1-2-3-409-0000000001', 30 } } }
event('LOOT_OPENED'); event('LOOT_CLOSED')
for _, row in ipairs(rows()) do if row.sourceNpcId == 408 or row.sourceNpcId == 409 then assert(row.copper == nil, 'amounts that do not add up') end end

-- Windows recorded before the type existed (the GUID alone in the set) still count as the kill or gather window.
EverlootDB.lootSources['Creature-0-1-2-3-500-0000000001'] = true
count = #rows()
window('Creature-0-1-2-3-500-0000000001', { { 2589, 1 } })
assert(#rows() == count, 'an old key still covers the kill window')
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-10', 8613)
event('UNIT_SPELLCAST_SUCCEEDED', 'player', 'Cast-10', 8613)
window('Creature-0-1-2-3-500-0000000001', { { 783, 1 } })
assert(#rows() == count + 1 and last().lootType == 'skinning', 'but a skinning window on it is new')

-- A cast that did not succeed never types the next window: failed, quiet-failed or interrupted, by cast GUID.
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-20', 921)
event('UNIT_SPELLCAST_FAILED', 'player', 'Cast-20', 921)
clock = clock + 5
window('Creature-0-1-2-3-700-0000000001', { { 4306, 1 } })
assert(last().lootType == 'kill' and last().sourceNpcId == 700, 'a failed Pick Pocket leaves a kill window')
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-21', 8613)
event('UNIT_SPELLCAST_INTERRUPTED', 'player', 'Cast-21', 8613)
window('Creature-0-1-2-3-701-0000000001', { { 783, 1 } })
assert(last().lootType == 'kill' and last().sourceNpcId == 701, 'an interrupted Skinning leaves a kill window')
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-22', 921)
event('UNIT_SPELLCAST_FAILED_QUIET', 'player', 'Cast-22', 921)
window('Creature-0-1-2-3-702-0000000001', { { 4306, 1 } })
assert(last().lootType == 'kill', 'a quiet failure too')
-- Another cast's events do not stand in for this one; Skinning is cast-time, so it needs its own SUCCEEDED.
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-23', 8613)
event('UNIT_SPELLCAST_FAILED', 'player', 'Cast-99', 2050)
event('UNIT_SPELLCAST_SUCCEEDED', 'player', 'Cast-99', 2050)
window('Creature-0-1-2-3-703-0000000001', { { 783, 1 } })
assert(last().lootType == 'kill', 'another spell succeeding is not this cast')
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-24', 8613)
event('UNIT_SPELLCAST_FAILED', 'player', 'Cast-98', 2050)
event('UNIT_SPELLCAST_SUCCEEDED', 'player', 'Cast-24', 8613)
window('Creature-0-1-2-3-704-0000000001', { { 783, 1 } })
assert(last().lootType == 'skinning', 'an unrelated failure does not cancel the cast')
-- An instant Pick Pocket counts for 2 seconds without waiting for SUCCEEDED; later, only a succeeded one does.
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-25', 921)
clock = clock + 3
window('Creature-0-1-2-3-705-0000000001', { { 4306, 1 } })
assert(last().lootType == 'kill', 'an unconfirmed Pick Pocket older than 2 seconds')
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-28', 921)
window('Creature-0-1-2-3-706-0000000001', { { 4306, 1 } })
assert(last().lootType == 'pickpocket', 'within 2 seconds of the cast')
-- A pending Pick Pocket on an object or an item types nothing: the source decides.
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-26', 921)
event('UNIT_SPELLCAST_SUCCEEDED', 'player', 'Cast-26', 921)
window('GameObject-0-1-2-3-1618-0000000050', { { 2447, 1 } })
assert(last().lootType == 'gather')
C_Item = { GetItemIDByGUID = function() return 5523 end }
event('UNIT_SPELLCAST_SENT', 'player', 'Wolf', 'Cast-27', 921)
event('UNIT_SPELLCAST_SUCCEEDED', 'player', 'Cast-27', 921)
window('Item-4372-0-4000000000000050', { { 5498, 1 } })
assert(last().lootType == 'container')
C_Item = nil

-- Missing APIs never error.
GetLootSlotType = nil
window('Creature-0-1-2-3-600-0000000001', { { 2589, 1 } })
assert(last().sourceNpcId == 600 and last().copper == nil)
""")
counts = check_all(lua)
assert counts == {"loot": 33}, counts
