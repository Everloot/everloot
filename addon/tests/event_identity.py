"""Run with: uv run --with lupa python addon/tests/event_identity.py"""
from pathlib import Path
from lupa.lua51 import LuaRuntime

lua = LuaRuntime()
lua.execute("""
date = function() return '2026-10-07T00:00:00Z' end
time = function() return 123456 end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {RegisterEvent=function() end, SetScript=function(self, _, f) self.onEvent=f end} end
""")
lua.execute((Path(__file__).parents[1] / "core.lua").read_text(encoding="utf-8"))
lua.execute("""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
Everloot:Store('loot', {capturedAt='2026-10-07T00:00:00Z'})
local first = EverlootDB.records.loot[1].eventId
Everloot:Store('loot', {capturedAt='2026-10-07T00:00:00Z'})
assert(first ~= EverlootDB.records.loot[2].eventId)
assert(first == EverlootDB.records.loot[1].eventId)
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
Everloot:Store('loot', {})
assert(first ~= EverlootDB.records.loot[3].eventId)
assert(EverlootDB.nextEvent == 3)
EverlootDB.nextEvent = nil
Everloot:Store('loot', {})
assert(first ~= EverlootDB.records.loot[4].eventId)
Everloot.MAX_ROWS_PER_KIND = 4
assert(Everloot:Store('loot', {}) == false)
assert(#EverlootDB.records.loot == 4)
assert(first == EverlootDB.records.loot[1].eventId)
assert(string.find(Everloot:Status(), 'paused') ~= nil)
""")
# The loot rows above are stand-ins with no fields: this test checks ids, so the protocol schema check
# (protocol_schema.check_all) runs in the module tests, not here.

# Login and /reload say one line: modules on and off, any that could not start, any paused collection. The full
# list, every row count included, stays behind /everloot status. The census notice is untouched.
login = LuaRuntime()
login.execute("""
date = function() return '2026-10-07T00:00:00Z' end
time = function() return 123456 end
printed = {}
print = function(msg) printed[#printed + 1] = tostring(msg) end
SlashCmdList = {}
CreateFrame = function() return {RegisterEvent=function() end, SetScript=function(self, _, f) self.onEvent=f end} end
""")
login.execute((Path(__file__).parents[1] / "core.lua").read_text(encoding="utf-8"))
login.execute("""
Everloot:RegisterModule('openworld', function() return 'ready' end)
Everloot:RegisterModule('gold', function() return 'ready' end)
Everloot:RegisterModule('plan', function() error('no trait API', 0) end)
Everloot:RegisterModule('addons', function() return 'ready' end)
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
local first = printed[1]
assert(first == 'Everloot ' .. Everloot.VERSION .. ': 2 modules on, 1 off; could not start: plan. /everloot status for details.', first)
assert(not string.find(first, '\\n') and not string.find(first, 'rows'), 'one line, no row counts')
assert(string.find(printed[2], 'census on', 1, true) and #printed == 2, 'the census notice still follows once: ' .. table.concat(printed, ' | '))
printed = {}
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
assert(#printed == 1, 'a reload says the one line only: ' .. table.concat(printed, ' | '))
EverlootDB.paused = { loot = true }
assert(string.find(Everloot:LoginLine(), '; 1 collection paused at capacity.', 1, true), Everloot:LoginLine())
printed = {}
SlashCmdList.EVERLOOT('status')
local full = table.concat(printed, '\\n')
assert(string.find(full, 'plan: disabled: no trait API', 1, true) and string.find(full, 'addons: off by toggle', 1, true)
  and string.find(full, 'rows loot: 0', 1, true) and string.find(full, 'loot: collection paused', 1, true), '/everloot status keeps the full list: ' .. full)
""")
print("Lua 5.1 event identity: same-second events, reload, reset and retained IDs passed; login says one status line")
