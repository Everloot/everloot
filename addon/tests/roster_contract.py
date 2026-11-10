"""Run with: uv run --with lupa --with jsonschema python addon/tests/roster_contract.py"""
import re
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\roster.lua" in toc and toc.index("modules\\roster.lua") > toc.index("modules\\gold.lua"), "roster loads after gold"
source = (root / "modules/roster.lua").read_text(encoding="utf-8")
assert "E:Store(" not in source, "the roster is not a record"
assert not re.search(r"records\s*[\[\.]", source), "the roster never touches EverlootDB.records"

lua = LuaRuntime()
lua.execute("""
date = function() return '2026-11-07T00:00:00Z' end
local clock = 5000
time = function() clock = clock + 1; return clock end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
UnitName = function() return 'Thrall' end
GetRealmName = function() return 'Test Realm' end
UnitGUID = function(unit) assert(unit == 'player'); return 'Player-4242-0ABCDEF1' end
UnitClass = function() return 'Shaman', 'SHAMAN', 7 end
level = 42
UnitLevel = function() return level end
UnitFactionGroup = function() return 'Horde', 'Horde' end
money = 1234567
GetMoney = function() return money end
GetProfessions = function() return 3, nil, 5, nil, nil end
GetProfessionInfo = function(i)
 if i == 3 then return 'Mining', 136248, 75, 150, 0, 0, 186, 0, 0, 0, 'Mining' end
 if i == 5 then return 'Cooking', 133971, 30, 75, 0, 0, 185, 0, 0, 0, 'Cooking' end
end
""")
for file in ["core.lua", "modules/gold.lua", "modules/roster.lua", "modules/completion.lua", "modules/options.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute("""
function boot(toggles)
 EverlootDB = toggles and { toggles = toggles } or nil
 Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
end
function event(name, ...)
 for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, name, ...) end
end
boot()
local E, R = Everloot, Everloot.Roster
assert(R and E.CharacterKey, 'the roster and the shared key exist')
assert(EverlootDB.toggles.roster == true, 'on by default')

-- The key is the completion module's key: one formula.
local key, class, lvl = E.CharacterKey()
assert(key and #key == 8 and key:find('^%x+$') and class == 'SHAMAN' and lvl == 42, 'key, class token, level')
local ckey, cclass, clvl = E.Completion.Identity()
assert(ckey == key and cclass == class and clvl == lvl, 'C.Identity returns what E.CharacterKey does')
assert(E.CharacterKey() ~= nil and not key:find('Thrall'), 'opaque')

-- Login: one row, the player's own facts.
event('PLAYER_ENTERING_WORLD')
assert(R.Current() == key, 'Current is this character')
local rows = R.Rows()
assert(#rows == 1, 'one row')
local r = rows[1]
assert(r.key == key and r.name == 'Thrall' and r.realm == 'Test Realm' and r.class == 'SHAMAN' and r.level == 42 and r.faction == 'Horde', 'identity fields')
assert(r.copper == 1234567 and r.peakCopper == 1234567, 'gold read at login')
assert(#r.professions == 2 and r.professions[1].name == 'Mining' and r.professions[1].icon == 136248
  and r.professions[1].rank == 75 and r.professions[1].maxRank == 150 and r.professions[2].name == 'Cooking', 'professions')
assert(type(r.lastSeen) == 'number', 'lastSeen is time()')
assert(EverlootDB.roster[key].key == nil and EverlootDB.roster[key].name == 'Thrall', 'stored without the key field')
assert(EverlootDB.records.roster == nil, 'no roster record kind')

-- Level and money follow their events; the peak never drops.
level = 43; event('PLAYER_LEVEL_UP')
assert(R.Rows()[1].level == 43, 'level up')
money = 500; event('PLAYER_MONEY')
r = R.Rows()[1]
assert(r.copper == 500 and r.peakCopper == 1234567, 'copper follows, peak holds')
money = 2000000; event('PLAYER_MONEY')
assert(R.Rows()[1].peakCopper == 2000000, 'peak rises')

-- A skill change re-reads professions.
GetProfessionInfo = function(i)
 if i == 3 then return 'Mining', 136248, 100, 150 end
 if i == 5 then return 'Cooking', 133971, 30, 75 end
end
event('SKILL_LINES_CHANGED')
assert(R.Rows()[1].professions[1].rank == 100, 'profession rank updated')

-- Rows sort by realm, then name; Forget removes one.
EverlootDB.roster['aaaaaaaa'] = { name = 'Zed', realm = 'Alpha', class = 'MAGE', level = 10 }
EverlootDB.roster['bbbbbbbb'] = { name = 'Amy', realm = 'Test Realm', class = 'MAGE', level = 10 }
rows = R.Rows()
assert(#rows == 3 and rows[1].name == 'Zed' and rows[2].name == 'Amy' and rows[3].name == 'Thrall', 'realm then name')
assert(rows[1].key == 'aaaaaaaa', 'key comes back on the row')
R.Forget('aaaaaaaa')
assert(#R.Rows() == 2 and EverlootDB.roster['aaaaaaaa'] == nil, 'Forget removes the row')
assert(E:Status():find('roster: ready', 1, true), 'Status has a roster line: ' .. E:Status())

-- No profession API: an empty list and a note, never an error.
boot()
GetProfessions = nil
event('PLAYER_ENTERING_WORLD')
r = Everloot.Roster.Rows()[1]
assert(#r.professions == 0, 'no API, no professions')
assert(Everloot:Status():find('professions: no API', 1, true), 'status says so: ' .. Everloot:Status())
GetProfessions = function() return 3, nil, 5, nil, nil end

-- Gold off: no copper is written.
boot({ gold = false })
event('PLAYER_ENTERING_WORLD'); event('PLAYER_MONEY')
r = Everloot.Roster.Rows()[1]
assert(r and r.copper == nil and r.peakCopper == nil, 'no gold fields when the gold module is off')

-- A missing value records nothing for that field, never a wrong one.
boot()
UnitFactionGroup = function() return nil end
event('PLAYER_ENTERING_WORLD')
r = Everloot.Roster.Rows()[1]
assert(r.faction == nil and r.name == 'Thrall', 'missing faction left out')
UnitFactionGroup = function() return 'Horde', 'Horde' end

-- A secret GUID: no key, no row.
boot()
issecretvalue = function(v) return v == 'Player-4242-0ABCDEF1' end
event('PLAYER_ENTERING_WORLD')
assert(Everloot.Roster.Current() == nil and #Everloot.Roster.Rows() == 0, 'no row without a readable key')
issecretvalue = nil

-- Roster off: nothing is written.
boot({ roster = false })
event('PLAYER_ENTERING_WORLD'); event('PLAYER_MONEY')
assert(EverlootDB.roster == nil, 'no roster table when off')

-- The options page lists it after Your gold.
local rowsByKey, order = {}, {}
for i, row in ipairs(Everloot.Options.ROWS) do rowsByKey[row.key] = row; order[row.key] = i end
assert(rowsByKey.roster and rowsByKey.roster.label == 'Your characters' and order.roster == order.gold + 1, 'options row after Your gold')
assert(rowsByKey.roster.text == "Name, realm, class, level, faction, gold and professions of each character you log in with, for the window's Home. Stays in this file; never uploaded.", 'options text')
""")
print("roster contract: PASS")

lua.execute("""
boot()
-- Identical display names do not merge roster identities: the key includes the GUID and install.
UnitName = function() return 'Thrall' end
GetRealmName = function() return 'CAMWOW US1 Realm 4 PVP' end
UnitGUID = function() return 'Player-4242-0ABCDEF1' end
Everloot.Roster.Update()
local first = Everloot.CharacterKey()
UnitGUID = function() return 'Player-4242-0ABCDEF2' end
Everloot.Roster.Update()
local second = Everloot.CharacterKey()
assert(first ~= second and #Everloot.Roster.Rows() == 2, 'same name, different GUIDs stay separate')
EverlootDB.installId = 'another-install'
local third = Everloot.CharacterKey()
assert(third ~= first and third ~= second, 'install namespaces the opaque key')
""")
