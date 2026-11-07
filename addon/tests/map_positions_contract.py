"""Run with: uv run --with lupa --with jsonschema python addon/tests/map_positions_contract.py

Positions for the world map. At an NPC window the player's position is recorded as the NPC's
(`positionKind = "interaction"`) with the window's role; at an object's loot window the row gains the
player's position, how the object was opened (from UNIT_SPELLCAST_SENT) and its name. The event names
and the spellcast arguments follow Blizzard's documented signatures and were not checked on the Forever
client, so every missing event, call or field must record nothing rather than error.
"""
from pathlib import Path
from lupa.lua51 import LuaRuntime

STUBS = """
date = function() return '2026-10-21T00:00:00Z' end
time = function() return 123456 end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function(self, name) self.events=self.events or {}; self.events[name]=true end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
guids = { npc = 'Creature-0-1-2-3-3158-0000000001' }
UnitGUID = function(unit) return guids[unit] end
UnitName = function() return 'Duokna' end
UnitLevel = function() return 15 end
UnitIsFriend = function() return true end
UnitCanAttack = function() return false end
UnitCreatureType = function() return 'Humanoid' end
UnitClassification = function() return 'normal' end
map, px, py = 1411, .512, .428
C_Map = {GetBestMapForUnit=function() return map end,
 GetPlayerMapPosition=function() if px then return {x=px,y=py} end end}
clock = 100
GetTime = function() return clock end
"""

root = Path(__file__).parents[1]


def fresh(extra=""):
    lua = LuaRuntime()
    lua.execute(STUBS + extra)
    for file in ["core.lua", "modules/openworld.lua"]:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("""
Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')
function event(name, ...) for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, name, ...) end end
function sightings() return EverlootDB.records.npc_sighting or {} end
function last() local rows = sightings(); return rows[#rows] end
""")
    return lua


# --- NPC windows: one row per window, the player's position as the NPC's, the window's role ---
lua = fresh("""
CanMerchantRepair = function() return repairs end
GetMerchantNumItems = function() return 0 end
GetMerchantItemLink = function() end
GetMerchantItemInfo = function() end
""")
lua.execute("""
local registered = Everloot.frame.events
for _, name in ipairs({'MERCHANT_SHOW','GOSSIP_SHOW','QUEST_DETAIL','QUEST_GREETING','TRAINER_SHOW','TAXIMAP_OPENED',
  'BANKFRAME_OPENED','AUCTION_HOUSE_SHOW','PET_STABLE_SHOW','CONFIRM_BINDER','PLAYER_INTERACTION_MANAGER_FRAME_SHOW',
  'LOOT_OPENED','LOOT_CLOSED'}) do
  assert(registered[name], name .. ' is not registered')
end

local windows = {
  {'MERCHANT_SHOW', 'vendor', 3158}, {'TRAINER_SHOW', 'trainer', 3347}, {'QUEST_DETAIL', 'questgiver', 3143},
  {'QUEST_GREETING', 'questgiver', 3144}, {'TAXIMAP_OPENED', 'flightmaster', 3310}, {'BANKFRAME_OPENED', 'banker', 3309},
  {'AUCTION_HOUSE_SHOW', 'auctioneer', 9856}, {'PET_STABLE_SHOW', 'stablemaster', 9988}, {'CONFIRM_BINDER', 'innkeeper', 6929},
}
for i, w in ipairs(windows) do
  guids.npc = 'Creature-0-1-2-3-' .. w[3] .. '-0000000001'
  event(w[1])
  assert(#sightings() == i, w[1] .. ' records one sighting')
  local row = last()
  assert(row.npcId == w[3] and row.positionKind == 'interaction' and row.role == w[2], w[1] .. ' gives role ' .. w[2])
  assert(row.mapId == 1411 and math.abs(row.x - 51.2) < 1e-9 and math.abs(row.y - 42.8) < 1e-9, 'the player position, 0..100')
  assert(row.name == 'Duokna' and row.level == 15 and row.reaction == 'friendly' and row.creatureType == 'Humanoid')
  event(w[1])
  assert(#sightings() == i, w[1] .. ' reopened at the same NPC and map adds nothing')
end
local n = #sightings()

-- A merchant who repairs is a repair NPC.
repairs = true
guids.npc = 'Creature-0-1-2-3-3160-0000000001'
event('MERCHANT_SHOW')
assert(last().role == 'repair' and #sightings() == n + 1)
repairs = nil
n = n + 1

-- A gossip window names no service: the row has no role, unless the old gossip options say innkeeper.
guids.npc = 'Creature-0-1-2-3-4000-0000000001'
event('GOSSIP_SHOW')
assert(#sightings() == n + 1 and last().positionKind == 'interaction' and last().role == nil)
GetGossipOptions = function() return 'Make this inn your home.', 'binder', 'Let me browse your goods.', 'vendor' end
guids.npc = 'Creature-0-1-2-3-4001-0000000001'
event('GOSSIP_SHOW')
assert(#sightings() == n + 2 and last().role == 'innkeeper')
GetGossipOptions = function() error('broken') end
guids.npc = 'Creature-0-1-2-3-4002-0000000001'
event('GOSSIP_SHOW')
assert(#sightings() == n + 3 and last().role == nil, 'a failing gossip call still records the NPC, without a role')
n = n + 3

-- A quest window from a quest NPC unit; nothing for an item, an object or a shared quest.
guids.npc = nil
guids.questnpc = 'Creature-0-1-2-3-4003-0000000001'
event('QUEST_DETAIL')
assert(#sightings() == n + 1 and last().npcId == 4003 and last().role == 'questgiver')
guids.questnpc = 'GameObject-0-1-2-3-1561-0000000001'
event('QUEST_DETAIL')
guids.questnpc = 'Player-1-00000001'
event('QUEST_GREETING')
guids.questnpc = nil
event('QUEST_GREETING')
assert(#sightings() == n + 1, 'no creature, no row')
n = n + 1

-- The newer clients' interaction manager, by Enum.PlayerInteractionType name. The same NPC through both events is one row.
Enum = { PlayerInteractionType = { Gossip = 3, Merchant = 5, Banker = 8, TaxiNode = 9, Trainer = 10, Binder = 12, Auctioneer = 21, StableMaster = 26, QuestGiver = 4, MailInfo = 17 } }
guids.npc = 'Creature-0-1-2-3-3158-0000000001'
event('PLAYER_INTERACTION_MANAGER_FRAME_SHOW', 5)
assert(#sightings() == n, 'the vendor already recorded through MERCHANT_SHOW is not recorded twice')
guids.npc = 'Creature-0-1-2-3-5000-0000000001'
event('PLAYER_INTERACTION_MANAGER_FRAME_SHOW', 12)
assert(#sightings() == n + 1 and last().role == 'innkeeper')
event('PLAYER_INTERACTION_MANAGER_FRAME_SHOW', 17)
event('PLAYER_INTERACTION_MANAGER_FRAME_SHOW', 999)
event('PLAYER_INTERACTION_MANAGER_FRAME_SHOW', nil)
assert(#sightings() == n + 1, 'a mailbox, an unknown type or none records nothing')
Enum = nil
event('PLAYER_INTERACTION_MANAGER_FRAME_SHOW', 5)
assert(#sightings() == n + 1, 'no enum, nothing')
n = n + 1

-- The same NPC on another map is a new place.
map = 1429
guids.npc = 'Creature-0-1-2-3-3158-0000000001'
event('MERCHANT_SHOW')
assert(#sightings() == n + 1 and last().mapId == 1429)
map = 1411
n = n + 1

-- Missing position, level or calls: nothing, and no error.
guids.npc = 'Creature-0-1-2-3-6000-0000000001'
px = nil
event('BANKFRAME_OPENED')
px = .5
UnitLevel = function() return -1 end
event('BANKFRAME_OPENED')
UnitLevel = function() return 15 end
UnitName = function() return nil end
event('BANKFRAME_OPENED')
UnitName = function() return 'Duokna' end
local savedMap = C_Map
C_Map = nil
event('BANKFRAME_OPENED')
C_Map = { GetBestMapForUnit = function() error('no map') end, GetPlayerMapPosition = function() end }
event('BANKFRAME_OPENED')
C_Map = savedMap
assert(#sightings() == n, 'no position, no level or no name: no row')
event('BANKFRAME_OPENED')
assert(#sightings() == n + 1, 'the window records once the calls answer')
n = n + 1

-- Targeting still records the player's own position, never as the NPC's.
guids.target = 'Creature-0-1-2-3-3158-0000000001'
event('PLAYER_TARGET_CHANGED')
assert(#sightings() == n + 1 and last().positionKind == 'player' and last().role == nil)
""")
from protocol_schema import check_all  # noqa: E402
counts = check_all(lua)
assert counts["npc_sighting"] >= 17, counts

# --- Loot from objects: position, gather kind from the spell, the object's name ---
lua = fresh("""
GetNumLootItems = function() return 1 end
GetLootSlotLink = function() return 'item:2447' end
GetLootSlotInfo = function() return 'icon', 'Peacebloom', 2 end
source = 'GameObject-0-1-2-3-1618-0000000001'
GetLootSourceInfo = function() return source, 2 end
C_Spell = { GetSpellName = function(id) if id == 99999 then return 'Collect' end end }
""")
lua.execute("""
local function rows() return EverlootDB.records.loot or {} end
local function lastLoot() local r = rows(); return r[#r] end
local spawn = 1
local function loot(guid)
  source = guid or ('GameObject-0-1-2-3-1618-00000000' .. string.format('%02d', spawn))
  spawn = spawn + 1
  event('LOOT_OPENED')
  event('LOOT_CLOSED')
end

-- Herb Gathering by spell id, the newer signature: unit, target, castGUID, spellID.
event('UNIT_SPELLCAST_SENT', 'player', 'Peacebloom', 'Cast-3-1-2-3-2366-0000000001', 2366)
clock = clock + 2
loot()
local herb = lastLoot()
assert(#rows() == 1 and herb.sourceObjectId == 1618 and herb.sourceEvidence == 'loot-api')
assert(herb.mapId == 1411 and math.abs(herb.x - 51.2) < 1e-9 and math.abs(herb.y - 42.8) < 1e-9, 'the player position')
assert(herb.gatherKind == 'herb' and herb.sourceObjectName == 'Peacebloom')

-- Mining by spell name, the old signature: unit, spell name, rank, target.
event('UNIT_SPELLCAST_SENT', 'player', 'Mining', 'Apprentice', 'Copper Vein')
loot('GameObject-0-1-2-3-1731-0000000001')
assert(lastLoot().sourceObjectId == 1731 and lastLoot().gatherKind == 'ore' and lastLoot().sourceObjectName == 'Copper Vein')

-- Chests and fishing; fishing has no target name.
event('UNIT_SPELLCAST_SENT', 'player', 'Battered Chest', 'Cast-1', 3365)
loot('GameObject-0-1-2-3-2843-0000000001')
assert(lastLoot().gatherKind == 'chest' and lastLoot().sourceObjectName == 'Battered Chest')
event('UNIT_SPELLCAST_SENT', 'player', '', 'Cast-2', 7620)
loot('GameObject-0-1-2-3-35591-0000000001')
assert(lastLoot().gatherKind == 'fishing' and lastLoot().sourceObjectName == nil)
-- A fish can take 20 seconds to bite: the fishing cast still counts.
event('UNIT_SPELLCAST_SENT', 'player', '', 'Cast-2b', 7620)
clock = clock + 20
loot('GameObject-0-1-2-3-35591-0000000002')
assert(lastLoot().gatherKind == 'fishing', 'a slow bite is still fishing')
event('UNIT_SPELLCAST_SENT', 'player', '', 'Cast-2c', 7620)
clock = clock + 31
loot('GameObject-0-1-2-3-35591-0000000003')
assert(lastLoot().gatherKind == nil, 'past 30 seconds the cast is not this window')

-- A spell the addon does not know is "other", and its target never becomes a name.
event('UNIT_SPELLCAST_SENT', 'player', 'Strange Crate', 'Cast-3', 99999)
loot('GameObject-0-1-2-3-7000-0000000001')
assert(lastLoot().gatherKind == 'other' and lastLoot().sourceObjectName == nil, 'an unknown spell keeps no target')
-- Healing a player, then opening a crate with no cast: the player's name never reaches the loot row.
event('UNIT_SPELLCAST_SENT', 'player', 'Bob', 'Cast-heal', 2050)
loot('GameObject-0-1-2-3-7009-0000000001')
assert(lastLoot().sourceObjectName == nil, 'a heal target is not an object name')
event('UNIT_SPELLCAST_SENT', 'player', 'Lesser Heal', 'Rank 1', 'Bob')
loot('GameObject-0-1-2-3-7010-0000000001')
assert(lastLoot().sourceObjectName == nil, 'nor with the old argument order')
-- A gather cast whose target is the targeted player's name keeps no name either.
UnitIsPlayer = function(unit) return unit == 'target' end
UnitName = function(unit) if unit == 'target' then return 'Bob' end end
event('UNIT_SPELLCAST_SENT', 'player', 'Bob', 'Cast-odd', 2366)
loot('GameObject-0-1-2-3-7011-0000000001')
assert(lastLoot().gatherKind == 'herb' and lastLoot().sourceObjectName == nil, 'a targeted player name is dropped')
UnitIsPlayer = function() error('broken') end
event('UNIT_SPELLCAST_SENT', 'player', 'Peacebloom', 'Cast-ok', 2366)
loot('GameObject-0-1-2-3-7012-0000000001')
assert(lastLoot().sourceObjectName == 'Peacebloom', 'a failing UnitIsPlayer does not lose a real herb name')
UnitIsPlayer, UnitName = nil, nil
local names = {}
for _, row in ipairs(rows()) do if row.sourceObjectName then names[row.sourceObjectName] = true end end
assert(not names.Bob and not names['Strange Crate'])
C_Spell = nil
event('UNIT_SPELLCAST_SENT', 'player', 'Odd Thing', 'Cast-4', 123456)
loot('GameObject-0-1-2-3-7001-0000000001')
assert(lastLoot().gatherKind == 'other', 'no spell name call: still other')

-- No cast, a stale cast, a failed cast, another unit's cast: the position stays, the kind and name do not.
loot('GameObject-0-1-2-3-7002-0000000001')
assert(lastLoot().mapId == 1411 and lastLoot().gatherKind == nil and lastLoot().sourceObjectName == nil)
event('UNIT_SPELLCAST_SENT', 'player', 'Peacebloom', 'Cast-5', 2366)
clock = clock + 30
loot('GameObject-0-1-2-3-7003-0000000001')
assert(lastLoot().gatherKind == nil, 'a cast 30 seconds ago is not this window')
event('UNIT_SPELLCAST_SENT', 'player', 'Peacebloom', 'Cast-6', 2366)
event('UNIT_SPELLCAST_FAILED', 'player', 'Cast-6', 2366)
loot('GameObject-0-1-2-3-7004-0000000001')
assert(lastLoot().gatherKind == nil, 'a failed cast is not this window')
event('UNIT_SPELLCAST_SENT', 'target', 'Peacebloom', 'Cast-7', 2366)
loot('GameObject-0-1-2-3-7005-0000000001')
assert(lastLoot().gatherKind == nil, 'another unit casting is not the player')
event('UNIT_SPELLCAST_SENT', 'player', 'Peacebloom', 'Cast-8', 2366)
event('LOOT_CLOSED')
loot('GameObject-0-1-2-3-7006-0000000001')
assert(lastLoot().gatherKind == nil, 'a closed window ends the cast')
event('UNIT_SPELLCAST_SENT', 'player', string.rep('x', 121), 'Cast-9', 2366)
loot('GameObject-0-1-2-3-7007-0000000001')
assert(lastLoot().gatherKind == 'herb' and lastLoot().sourceObjectName == nil, 'an over-long name is left out')
event('UNIT_SPELLCAST_SENT', 'player', nil, nil, nil)
event('UNIT_SPELLCAST_SENT', 'player', 42, {}, 'x')
event('UNIT_SPELLCAST_SENT')
loot('GameObject-0-1-2-3-7008-0000000001')
assert(lastLoot().gatherKind == 'other' and lastLoot().sourceObjectName == nil, 'odd arguments never error')

-- A creature's corpse gets no position or object fields, even right after a cast.
local count = #rows()
event('UNIT_SPELLCAST_SENT', 'player', 'Kobold', 'Cast-10', 8613)
loot('Creature-0-1-2-3-6-0000000099')
local corpse = lastLoot()
assert(#rows() == count + 1 and corpse.sourceNpcId == 6 and corpse.mapId == nil and corpse.x == nil and corpse.gatherKind == nil)

-- No position: the object row is kept, without one.
px = nil
event('UNIT_SPELLCAST_SENT', 'player', 'Peacebloom', 'Cast-11', 2366)
loot('GameObject-0-1-2-3-1618-0000000099')
assert(lastLoot().mapId == nil and lastLoot().x == nil and lastLoot().gatherKind == 'herb')
C_Map = nil
loot('GameObject-0-1-2-3-1618-0000000098')
assert(lastLoot().sourceObjectId == 1618 and lastLoot().x == nil, 'no map API, no position, no error')
GetTime = nil
event('UNIT_SPELLCAST_SENT', 'player', 'Peacebloom', 'Cast-12', 2366)
loot('GameObject-0-1-2-3-1618-0000000097')
assert(lastLoot().gatherKind == 'herb', 'without GetTime the cast still counts for the next window')

-- Reopening the same object adds nothing.
count = #rows()
loot('GameObject-0-1-2-3-1618-0000000097')
assert(#rows() == count)
""")
counts = check_all(lua)
assert counts["loot"] == 23, counts

# --- Budgets: a full targeting share and a full corpse share never stop NPC windows or object positions ---
# An upgraded file: five targeting rows (one from before positionKind existed) and five corpse rows, with
# 0.3.7's whole-kind pause flags. The cap is lowered to five so "full" is easy to reach.
lua = fresh("""
local function seen(i, kind)
  return { installId = 'abcd-1234', eventId = 'old:' .. i, capturedAt = '2026-10-20T00:00:00Z', npcId = 100 + i, name = 'Kobold',
    mapId = 1429, x = 10 + i, y = 10, level = 5, reaction = 'hostile', positionKind = kind }
end
local function corpse(i)
  return { installId = 'abcd-1234', eventId = 'old:c' .. i, capturedAt = '2026-10-20T00:00:00Z', sourceNpcId = 6,
    sourceEvidence = 'loot-api', items = { { itemId = 2589, count = 1 } } }
end
EverlootDB = { installId = 'abcd-1234', toggles = { openworld = true }, paused = { npc_sighting = true, loot = true },
  records = { npc_sighting = { seen(1), seen(2, 'player'), seen(3, 'player'), seen(4, 'player'), seen(5, 'player') },
    loot = { corpse(1), corpse(2), corpse(3), corpse(4), corpse(5) } } }
GetNumLootItems = function() return 1 end
GetLootSlotLink = function() return 'item:2447' end
GetLootSlotInfo = function() return 'icon', 'Peacebloom', 1 end
GetLootSourceInfo = function() return source, 1 end
""")
lua.execute("""
Everloot.MAX_ROWS_PER_KIND = 5
assert(EverlootDB.paused.npc_sighting == nil and EverlootDB.paused.loot == nil, 'the whole-kind pauses of 0.3.7 are lifted')

-- Targeting is full: a new NPC adds nothing, and only the targeting share pauses.
guids.target = 'Creature-0-1-2-3-200-0000000001'
event('PLAYER_TARGET_CHANGED')
assert(#sightings() == 5 and EverlootDB.paused['npc_sighting (targeting)'], 'the targeting share is full')
assert(Everloot:Status():find('npc_sighting (targeting): collection paused', 1, true), Everloot:Status())

-- NPC windows still record, up to their own cap.
for i = 1, 6 do
  guids.npc = 'Creature-0-1-2-3-' .. (300 + i) .. '-0000000001'
  event('BANKFRAME_OPENED')
end
local interaction = 0
for _, row in ipairs(sightings()) do if row.positionKind == 'interaction' then interaction = interaction + 1 end end
assert(interaction == 5 and #sightings() == 10, 'five window rows despite a full targeting share, then their own cap')
assert(EverlootDB.paused['npc_sighting (interaction)'])
assert(EverlootDB.interactionSeen['306::1411'] == nil and EverlootDB.interactionSeen['306:banker:1411'] == nil, 'a refused row is not marked seen')

-- Corpses are full; an object's loot row with its position still records.
source = 'Creature-0-1-2-3-6-0000000077'
event('LOOT_OPENED'); event('LOOT_CLOSED')
assert(#EverlootDB.records.loot == 5 and EverlootDB.paused['loot (creatures)'])
source = 'GameObject-0-1-2-3-1618-0000000001'
event('UNIT_SPELLCAST_SENT', 'player', 'Peacebloom', 'Cast-1', 2366)
event('LOOT_OPENED'); event('LOOT_CLOSED')
local herb = EverlootDB.records.loot[6]
assert(herb and herb.sourceObjectId == 1618 and herb.mapId == 1411 and herb.gatherKind == 'herb', 'the object row records')
assert(not EverlootDB.paused['loot (objects)'])

-- The shares were counted from the rows already in the file (above); re-initialising keeps the window cap.
Everloot:InitModules()
guids.npc = 'Creature-0-1-2-3-400-0000000001'
event('BANKFRAME_OPENED')
assert(#sightings() == 10, 'still five window rows after a reload')
""")
counts = check_all(lua)
assert counts == {"npc_sighting": 10, "loot": 6}, counts

# --- Vignettes: a rare's and a treasure's own position, from C_VignetteInfo (documented for Forever 1.60.1) ---
lua = fresh("""
vignettes = {
  ['Vignette-1'] = { info = { objectGUID = 'Creature-0-1-2-3-61-0000000001', name = 'Thuros Lightfingers' }, x = .25, y = .75 },
  ['Vignette-2'] = { info = { objectGUID = 'GameObject-0-1-2-3-2843-0000000001', name = 'Battered Chest' }, x = .5, y = .5 },
}
C_VignetteInfo = {
  GetVignettes = function() local list = {}; for guid in pairs(vignettes) do list[#list + 1] = guid end; return list end,
  GetVignetteInfo = function(guid) return vignettes[guid] and vignettes[guid].info end,
  GetVignettePosition = function(guid, uiMap)
    local v = vignettes[guid]
    if v and uiMap == map and v.x then return { x = v.x, y = v.y } end
  end,
}
instance = { 'Elwynn Forest', 'none', 0, '', 0, 0, false, 0 }
GetInstanceInfo = function() return unpack(instance, 1, 10) end
""")
lua.execute("""
local function objects() return EverlootDB.records.object_sighting or {} end
event('VIGNETTE_MINIMAP_UPDATED', 'Vignette-1', true)
local rare = last()
assert(#sightings() == 1 and rare.npcId == 61 and rare.name == 'Thuros Lightfingers' and rare.positionKind == 'vignette')
assert(rare.mapId == 1411 and rare.x == 25 and rare.y == 75, 'the rare own position, not the player one')
assert(rare.level == nil and rare.reaction == nil and rare.role == nil, 'a vignette tells no level or reaction')
event('VIGNETTE_MINIMAP_UPDATED', 'Vignette-2', true)
local chest = objects()[1]
assert(#objects() == 1 and chest.objectId == 2843 and chest.name == 'Battered Chest' and chest.x == 50 and chest.y == 50)
assert(chest.mapId == 1411 and chest.instanceMapId == nil, 'outdoors: no instance')
event('VIGNETTES_UPDATED')
event('VIGNETTE_MINIMAP_UPDATED', 'Vignette-1', true)
assert(#sightings() == 1 and #objects() == 1, 'the same vignette at the same spot adds nothing')

-- Leaving the minimap, a player vignette, no name, no position, a broken API: nothing, and no error.
vignettes['Vignette-3'] = { info = { objectGUID = 'Creature-0-1-2-3-62-0000000001', name = 'Gath Ilzogg' }, x = .1, y = .1 }
event('VIGNETTE_MINIMAP_UPDATED', 'Vignette-3', false)
vignettes['Vignette-3'] = { info = { objectGUID = 'Player-1-00000001', name = 'Bob' }, x = .1, y = .1 }
event('VIGNETTE_MINIMAP_UPDATED', 'Vignette-3', true)
vignettes['Vignette-3'] = { info = { objectGUID = 'Creature-0-1-2-3-62-0000000001', name = '' }, x = .1, y = .1 }
event('VIGNETTE_MINIMAP_UPDATED', 'Vignette-3', true)
vignettes['Vignette-3'] = { info = { objectGUID = 'Creature-0-1-2-3-62-0000000001', name = 'Gath Ilzogg' } }
event('VIGNETTE_MINIMAP_UPDATED', 'Vignette-3', true)
vignettes['Vignette-3'] = { info = { objectGUID = 'Creature-0-1-2-3-62-0000000001', name = 'Gath Ilzogg' }, x = 1.5, y = .1 }
event('VIGNETTE_MINIMAP_UPDATED', 'Vignette-3', true)
event('VIGNETTE_MINIMAP_UPDATED', nil, true)
event('VIGNETTE_MINIMAP_UPDATED', 'Vignette-404', true)
local savedApi = C_VignetteInfo
C_VignetteInfo = { GetVignettes = function() error('broken') end, GetVignetteInfo = function() error('broken') end,
  GetVignettePosition = function() error('broken') end }
event('VIGNETTES_UPDATED')
event('VIGNETTE_MINIMAP_UPDATED', 'Vignette-1', true)
C_VignetteInfo = nil
event('VIGNETTES_UPDATED')
event('VIGNETTE_MINIMAP_UPDATED', 'Vignette-1', true)
assert(#sightings() == 1 and #objects() == 1, 'nothing recorded from a refused vignette')
C_VignetteInfo = savedApi

-- A treasure inside an instance carries the instance map id (GetInstanceInfo's 8th return).
instance = { 'The Deadmines', 'party', 1, 'Normal', 5, 0, false, 36 }
vignettes['Vignette-4'] = { info = { objectGUID = 'GameObject-0-1-2-3-4096-0000000001', name = 'Solid Chest' }, x = .3, y = .4 }
event('VIGNETTES_UPDATED')
assert(#objects() == 2 and objects()[2].instanceMapId == 36)
""")
counts = check_all(lua)
assert counts == {"npc_sighting": 1, "object_sighting": 2}, counts

# --- Instance entrances and encounters (GetInstanceInfo, ENCOUNTER_END; documented for Forever 1.60.1) ---
lua = fresh("""
instance = { 'Elwynn Forest', 'none', 0, '', 0, 0, false, 0 }
GetInstanceInfo = function() return unpack(instance, 1, 10) end
""")
lua.execute("""
local function entrances() return EverlootDB.records.instance_entrance or {} end
local function encounters() return EverlootDB.records.encounter or {} end
for _, name in ipairs({'VIGNETTE_MINIMAP_UPDATED','VIGNETTES_UPDATED','PLAYER_LEAVING_WORLD','PLAYER_ENTERING_WORLD','ENCOUNTER_END'}) do
  assert(Everloot.frame.events[name], name .. ' is not registered')
end

-- Zoning in from outdoors: the position where the loading screen started is the entrance.
map, px, py = 1436, .422, .716
event('PLAYER_LEAVING_WORLD')
instance = { 'The Deadmines', 'party', 1, 'Normal', 5, 0, false, 36 }
px = nil
event('PLAYER_ENTERING_WORLD', false, false)
local entrance = entrances()[1]
assert(#entrances() == 1 and entrance.instanceMapId == 36 and entrance.name == 'The Deadmines' and entrance.instanceType == 'party')
assert(entrance.difficulty == 1 and entrance.mapId == 1436 and math.abs(entrance.x - 42.2) < 1e-9 and math.abs(entrance.y - 71.6) < 1e-9)

-- Out and back in through the same door: one row.
px = .422
event('PLAYER_LEAVING_WORLD')
instance = { 'Westfall', 'none', 0, '', 0, 0, false, 0 }
event('PLAYER_ENTERING_WORLD')
event('PLAYER_LEAVING_WORLD')
instance = { 'The Deadmines', 'party', 1, 'Normal', 5, 0, false, 36 }
event('PLAYER_ENTERING_WORLD')
assert(#entrances() == 1, 'the same instance from the same map adds nothing')

-- A reload inside, a login inside, a dungeon finder teleport, a battleground, no position: nothing.
event('PLAYER_LEAVING_WORLD')
event('PLAYER_ENTERING_WORLD', false, true)
event('PLAYER_ENTERING_WORLD', true, false)
instance = { 'Westfall', 'none', 0, '', 0, 0, false, 0 }
event('PLAYER_LEAVING_WORLD')
instance = { 'Shadowfang Keep', 'party', 1, 'Normal', 5, 0, false, 33, 5, 8 }
event('PLAYER_ENTERING_WORLD')
instance = { 'Westfall', 'none', 0, '', 0, 0, false, 0 }
event('PLAYER_LEAVING_WORLD')
instance = { 'Warsong Gulch', 'pvp', 0, '', 10, 0, false, 489 }
event('PLAYER_ENTERING_WORLD')
instance = { 'Westfall', 'none', 0, '', 0, 0, false, 0 }
px = nil
event('PLAYER_LEAVING_WORLD')
instance = { 'Shadowfang Keep', 'party', 1, 'Normal', 5, 0, false, 33 }
event('PLAYER_ENTERING_WORLD')
assert(#entrances() == 1, 'no entrance without an outdoor start, or from a dungeon finder or a battleground')

-- A raid, and no difficulty when the client gives none.
px = .5
instance = { 'Burning Steppes', 'none', 0, '', 0, 0, false, 0 }
event('PLAYER_LEAVING_WORLD')
instance = { 'Molten Core', 'raid', nil, '', 40, 0, false, 409 }
event('PLAYER_ENTERING_WORLD')
assert(#entrances() == 2 and entrances()[2].instanceType == 'raid' and entrances()[2].difficulty == nil)

-- A missing or failing GetInstanceInfo records nothing and never errors.
instance = { 'Westfall', 'none', 0, '', 0, 0, false, 0 }
event('PLAYER_LEAVING_WORLD')
local saved = GetInstanceInfo
GetInstanceInfo = function() error('broken') end
event('PLAYER_ENTERING_WORLD')
GetInstanceInfo = nil
event('PLAYER_LEAVING_WORLD')
event('PLAYER_ENTERING_WORLD')
assert(#entrances() == 2)
GetInstanceInfo = saved

-- ENCOUNTER_END: encounterID, encounterName, difficultyID, groupSize, success, and the boss units when sent.
instance = { 'The Deadmines', 'party', 1, 'Normal', 5, 0, false, 36 }
event('ENCOUNTER_END', 1144, 'Edwin VanCleef', 1, 5, 1, { { creatureID = 639, creatureName = 'Edwin VanCleef', remainingHealthPercent = 0 } })
local kill = encounters()[1]
assert(kill.encounterId == 1144 and kill.name == 'Edwin VanCleef' and kill.instanceMapId == 36 and kill.success == true)
assert(kill.difficulty == 1 and kill.size == 5 and #kill.npcIds == 1 and kill.npcIds[1] == 639)
event('ENCOUNTER_END', 1144, 'Edwin VanCleef', 1, 5, 0)
local wipe = encounters()[2]
assert(wipe.success == false and wipe.npcIds == nil, 'a wipe, no unit list')
local many = {}
for i = 1, 45 do many[i] = { creatureID = 1000 + i } end
many[46] = { creatureID = 1001 }
many[47] = 'odd'
event('ENCOUNTER_END', 1145, 'Big Fight', 9, 40, true, many)
assert(#encounters()[3].npcIds == 40 and encounters()[3].size == 40, 'at most 40 boss ids, each once')

-- Odd arguments, outdoors, no instance info: nothing, and no error.
event('ENCOUNTER_END', 1144, 'Edwin VanCleef', 1, 5, 2)
event('ENCOUNTER_END', 0, 'Edwin VanCleef', 1, 5, 1)
event('ENCOUNTER_END', 1144, '', 1, 5, 1)
event('ENCOUNTER_END')
instance = { 'Kalimdor', 'none', 0, '', 0, 0, false, 1 }
event('ENCOUNTER_END', 1144, 'Edwin VanCleef', 1, 5, 1)
GetInstanceInfo = nil
event('ENCOUNTER_END', 1144, 'Edwin VanCleef', 1, 5, 1)
assert(#encounters() == 3)
""")
counts = check_all(lua)
assert counts == {"instance_entrance": 2, "encounter": 3}, counts
print("Lua 5.1 map positions: NPC windows (merchant, repair, trainer, quest detail and greeting, taxi, bank, auction house, "
      "stable, innkeeper, gossip, interaction manager) record interaction positions once per NPC, role and map; targeting stays "
      "player; object loot rows carry position, gather kind and name; missing events, calls and fields record nothing")
