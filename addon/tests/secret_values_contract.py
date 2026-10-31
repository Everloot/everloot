"""Run with: uv run --with lupa python addon/tests/secret_values_contract.py

Secret values: the Forever client can hand an addon a value it may hold but not read (a unit's GUID or name, a
position, a chat line). Parsing or calculating with one raises an error, and an error here would stop the capture
that raised it. A secret value counts as missing: nothing raises, no row holds it, and the rest of the row's rules
still apply. Which values are secret on the live client is not known, so every read below is made secret in turn.
"""
from pathlib import Path

from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]

WORLD = """
date = function() return '2026-10-08T00:00:00Z' end
time = function() return 123456 end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end

-- A secret string is a real string, as on the client, and the string library refuses it. `..` and `==` cannot be
-- trapped on a string, so the checks below also search every stored row for it.
SECRET = {}
local SECRET_GUID, SECRET_TEXT = 'Creature-0-1-2-3-777-0000009', 'Secret Text'
SECRET[SECRET_GUID] = true
SECRET[SECRET_TEXT] = true
for _, name in ipairs({ 'find', 'match', 'gmatch', 'gsub', 'sub', 'lower', 'upper', 'byte', 'len' }) do
 local real = string[name]
 string[name] = function(s, ...)
  if SECRET[s] then error('attempt to read a secret string with string.' .. name) end
  return real(s, ...)
 end
end
-- A secret number raises on any arithmetic or comparison.
local function refuse() error('attempt to calculate with a secret number') end
secretNumber = setmetatable({}, { __add=refuse, __sub=refuse, __mul=refuse, __div=refuse, __mod=refuse, __unm=refuse,
 __lt=refuse, __le=refuse, __eq=refuse, __concat=refuse, __index=refuse })
SECRET[secretNumber] = true
issecretvalue = function(v) return v ~= nil and SECRET[v] == true end
secretGuid, secretText = SECRET_GUID, SECRET_TEXT

guid, name, level, x, friend, race, class, faction = nil
function normal()
 guid, name, level, x, friend = 'Creature-0-1-2-3-999-0000001', 'Forest Spider', 60, .42, false
 playerGuid, playerName, race, class, faction = 'Player-4242-00AABBCC', 'Thrall', 'Orc', 'SHAMAN', 'Horde'
 selfGuid, realmSecond = 'Player-4242-00FFFFFF', nil
end
normal()
UnitGUID = function(unit)
 if unit == 'player' then return selfGuid end
 if unit == 'party1' then return playerGuid end
 return guid
end
UnitName = function(unit)
 if unit == 'party1' then return playerName, realmSecond end
 if unit == 'player' then return 'Me', realmSecond end
 return name
end
UnitLevel = function() return level end
UnitIsFriend = function() return friend end
UnitCanAttack = function() return true end
UnitIsPlayer = function(unit) return unit == 'party1' or unit == 'player' end
UnitRace = function() return race, race, 2 end
UnitClass = function() return 'Display', class, 7 end
UnitFactionGroup = function() return faction, faction end
GetGuildInfo = function() return nil end
GetRealmName = function() return 'Test Realm' end
GetTime = function() return 1000 end
IsInRaid = function() return false end
C_Map = { GetBestMapForUnit=function() return 141 end, GetPlayerMapPosition=function() return { x=x, y=.61 } end }
GetNumLootItems = function() return 1 end
GetLootSlotLink = function() return 'item:1234' end
GetLootSlotInfo = function() return 'icon', 'Cloth', 5 end
GetLootSourceInfo = function() return guid, 2 end

function holds(value, bad)
 if value == bad then return true end
 if type(value) == 'table' then for k, v in pairs(value) do if holds(k, bad) or holds(v, bad) then return true end end end
 return false
end
function noSecretStored()
 for _, bad in ipairs({ secretGuid, secretText, secretNumber }) do
  assert(not holds(EverlootDB.records, bad), 'a secret value reached a stored row')
 end
end
function event(ev, ...) for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, ev, ...) end end
function rows(kind) return EverlootDB.records[kind] and #EverlootDB.records[kind] or 0 end
"""


def fresh(files):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute("EverlootDB = { installId = 'abcd-1234', records = {}, censusNotice = true, "
                "toggles = { openworld = true, census = true, players = true, guild = false, gear = false, "
                "auctions = false, gold = false, talents = false, completion = false } }")
    lua.execute((root / "core.lua").read_text(encoding="utf-8"))
    for file in files:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')")
    return lua


# --- The check itself: a secret reads as missing, anything else is returned as it was ---
lua = fresh([])
lua.execute("""
local read = Everloot.Readable
assert(read(secretGuid) == nil and read(secretNumber) == nil, 'a secret reads as missing')
assert(read('Stormwind') == 'Stormwind' and read(7) == 7 and read(false) == false and read(nil) == nil, 'a plain value is untouched')
assert(Everloot.NpcIdFromGuid(secretGuid) == nil, 'a secret GUID names no NPC')
assert(Everloot.NpcIdFromGuid('Creature-0-1-2-3-999-0000001') == 999, 'a plain GUID still does')
local saved = issecretvalue
issecretvalue = nil
assert(read(secretGuid) == secretGuid, 'a client without the call has no secrets')
issecretvalue = saved
""")

# --- Open world: each read made secret in turn, then the same capture works once the values are plain ---
lua = fresh(["modules/openworld.lua"])
lua.execute("""
for _, secret in ipairs({
 function() guid = secretGuid end,
 function() name = secretText end,
 function() level = secretNumber end,
 function() x = secretNumber end,
}) do
 normal(); secret()
 event('PLAYER_TARGET_CHANGED')
 event('UPDATE_MOUSEOVER_UNIT')
 event('LOOT_OPENED')
 noSecretStored()
end
local looted = rows('loot')
normal(); guid = secretGuid
event('LOOT_OPENED')
assert(rows('loot') == looted, 'a secret corpse GUID names no source')
normal(); friend = secretNumber
event('PLAYER_TARGET_CHANGED')
noSecretStored()
local before = rows('npc_sighting')
normal(); x = .70
event('PLAYER_TARGET_CHANGED')
assert(rows('npc_sighting') == before + 1, 'capture carries on once the values are plain')
guid = 'Creature-0-1-2-3-888-0000003'
looted = rows('loot')
event('LOOT_OPENED')
assert(rows('loot') == looted + 1, 'loot carries on too')
""")

# --- Another player: census and the players module read the same unit ---
lua = fresh(["modules/census.lua", "modules/players.lua"])
lua.execute("""
Everloot:InitModules()
event('PLAYER_LOGIN')
for _, secret in ipairs({
 function() playerGuid = secretGuid end,
 function() playerName = secretText end,
 function() realmSecond = secretText end,
 function() level = secretNumber end,
 function() race = secretText end,
 function() class = secretText end,
 function() faction = secretText end,
 function() selfGuid = secretGuid end,
}) do
 normal(); secret()
 event('GROUP_ROSTER_UPDATE')
 event('PLAYER_LEVEL_UP')
 noSecretStored()
end
""")

# --- An item the client has not cached answers with a stand-in name: that is not the item's name ---
lua = fresh(["modules/openworld.lua"])
lua.execute("""
GetItemInfo = function(id) return 'Item ' .. id, nil, 0 end
event('LOOT_OPENED')
assert(rows('item_seen') == 0, 'a stand-in name is not recorded')
GetItemInfo = function() return 'Linen Cloth', nil, 1 end
local before = rows('item_seen')
guid = 'Creature-0-1-2-3-998-0000002'
event('LOOT_OPENED')
assert(rows('item_seen') == before + 1, 'a real name is')
""")

print("secret values contract ok")
