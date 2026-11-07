"""Run with: uv run --with lupa --with jsonschema python addon/tests/addons_contract.py"""
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\addons.lua" in toc, "addons module must be in the TOC"

STUBS = """
NOW = '2026-10-17T00:00:00Z'
date = function() return NOW end
NOW_T = 123456
time = function() return NOW_T end
DAY = 86400
printed = {}
print = function(text) table.insert(printed, text) end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
-- name, title, notes, loadable, reason, security; titles carry colour codes and textures.
addons = {
 {'Everloot', 'Everloot', '1', true},
 {'Questie', '|cff00ff00Questie|r', '9.5.1', true},
 {'Bagnon', '|TInterface\\\\Icons\\\\INV_Misc_Bag_08:16|t Bagnon', nil, true},
 {'OldMap', '', '1.0', false},
}
local function find(name) for _, a in ipairs(addons) do if a[1] == name then return a end end end
API = {
 GetNumAddOns = function() return #addons end,
 GetAddOnInfo = function(i) local a = addons[i]; return a[1], a[2], 'notes', true, nil, 'INSECURE' end,
 GetAddOnMetadata = function(name, field) if field == 'Version' then return find(name)[3] end end,
 IsAddOnLoaded = function(name) return find(name)[4] end,
}
"""


def fresh(api: str, saved: str = "nil"):
    lua = LuaRuntime()
    lua.execute(STUBS)
    lua.execute(api)
    lua.execute(f"EverlootDB = {saved}")
    for file in ["core.lua", "modules/addons.lua"]:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("""
Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')
function event(name) for _, hook in ipairs(Everloot.frame.hooks or {}) do hook(nil, name) end end
function reload() Everloot.frame.hooks = nil; Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot'); event('PLAYER_LOGIN') end
""")
    return lua


# C_AddOns client: off by default, on after /everloot addons on and a reload.
lua = fresh("C_AddOns = API")
lua.execute("""
assert(EverlootDB.toggles.addons == false, 'the addon list is off by default')
event('PLAYER_LOGIN')
assert(Everloot:Count('addon_seen') == 0, 'nothing is recorded while the addon list is off')
assert(string.find(Everloot:Status(), 'addons: off by toggle', 1, true), 'status shows the addon list is off')
local _, mentions = Everloot:Status():gsub('addons', '')
assert(mentions == 1, 'status shows the addon list state once; got ' .. mentions)

SlashCmdList.EVERLOOT('addons on')
assert(EverlootDB.toggles.addons == true, '/everloot addons on turns it on')
assert(string.find(printed[#printed], 'upload page', 1, true) and string.find(printed[#printed], 'Desktop App', 1, true)
 and not string.find(printed[#printed], 'companion', 1, true),
 'turning it on says the list goes only through the upload page, never the Desktop App')
reload()
local rows = EverlootDB.records.addon_seen
assert(rows and #rows == 4, 'one row per installed addon; got ' .. tostring(rows and #rows))
local byName = {}
for _, r in ipairs(rows) do byName[r.name] = r end
assert(byName.Questie.title == 'Questie' and byName.Questie.version == '9.5.1' and byName.Questie.loaded == true,
 'colour codes leave the title; version comes from the .toc')
assert(byName.Bagnon.title == 'Bagnon' and byName.Bagnon.version == nil, 'textures leave the title; no version stays nil')
assert(byName.OldMap.title == 'OldMap' and byName.OldMap.loaded == false, 'an empty title falls back to the folder name')
assert(byName.Questie.installId == EverlootDB.installId and byName.Questie.capturedAt == NOW)
for _, r in ipairs(rows) do
 for key in pairs(r) do
  assert(({installId=1, capturedAt=1, name=1, title=1, version=1, loaded=1, eventId=1, kindLoggedAt=1})[key], 'unexpected field ' .. key)
 end
end
assert(string.find(Everloot:Status(), 'rows addon_seen: 4', 1, true))

-- A row only when an addon is new or its version or loaded state changes, plus one check-in a week.
reload()
assert(Everloot:Count('addon_seen') == 4, 'another login adds nothing')
addons[2][3] = '9.6.0'
reload()
assert(Everloot:Count('addon_seen') == 5 and EverlootDB.records.addon_seen[5].version == '9.6.0', 'a new version is recorded')
NOW_T = NOW_T + 6 * DAY
reload()
assert(Everloot:Count('addon_seen') == 5, 'daily logins within a week add nothing')
addons[4][4] = true
reload()
assert(Everloot:Count('addon_seen') == 6 and EverlootDB.records.addon_seen[6].loaded == true, 'a change in loaded state is recorded')
NOW_T = NOW_T + DAY
NOW = '2026-10-24T00:00:00Z'
reload()
assert(Everloot:Count('addon_seen') == 9, 'a week after its last row, each unchanged addon checks in once; got ' .. Everloot:Count('addon_seen'))
assert(EverlootDB.records.addon_seen[9].capturedAt == NOW, 'the check-in carries the new date')
reload()
assert(Everloot:Count('addon_seen') == 9, 'the check-in is not repeated')
addons[5] = {'Details', 'Details!', '1.0', true}
reload()
assert(Everloot:Count('addon_seen') == 10 and EverlootDB.records.addon_seen[10].name == 'Details', 'a new addon is recorded at once')

-- Off deletes every recorded addon row, lifts a capacity pause and stops recording.
EverlootDB.paused = { addon_seen = true, loot = true }
SlashCmdList.EVERLOOT('addons off')
assert(EverlootDB.toggles.addons == false and Everloot:Count('addon_seen') == 0, 'off deletes the recorded addon rows')
assert(EverlootDB.paused.addon_seen == nil and EverlootDB.paused.loot == true, 'off clears the addon pause only')
assert(string.find(printed[#printed], 'deleted', 1, true) and not string.find(printed[#printed], 'not yet uploaded', 1, true),
 'the off message says what was deleted, accurately')
NOW_T = NOW_T + 30 * DAY
reload()
assert(Everloot:Count('addon_seen') == 0, 'nothing is recorded after off')
""")

# Upgrading from 0.2.5: an existing file has no addons toggle, and the list stays off.
lua = fresh("C_AddOns = API", "{ installId = 'abcd-1234', toggles = { openworld = true, auctions = true }, records = {} }")
lua.execute("""
assert(EverlootDB.toggles.addons == false, 'an upgraded install starts with the addon list off')
assert(EverlootDB.toggles.auctions == true, 'existing toggles are kept')
event('PLAYER_LOGIN')
assert(Everloot:Count('addon_seen') == 0)
""")

# Legacy globals work the same way.
lua = fresh("GetNumAddOns, GetAddOnInfo, GetAddOnMetadata, IsAddOnLoaded = API.GetNumAddOns, API.GetAddOnInfo, API.GetAddOnMetadata, API.IsAddOnLoaded",
            "{ installId = 'abcd-1234', toggles = { addons = true }, records = {} }")
lua.execute("""
event('PLAYER_LOGIN')
assert(Everloot:Count('addon_seen') == 4, 'the legacy AddOns API records the same rows')
""")

# Neither API: the module disables itself and never errors.
lua = fresh("", "{ installId = 'abcd-1234', toggles = { addons = true }, records = {} }")
lua.execute("""
event('PLAYER_LOGIN')
assert(Everloot:Count('addon_seen') == 0)
assert(string.find(Everloot:Status(), 'addons: disabled', 1, true), 'a client without the AddOns API disables the module')
""")

# A broken API call skips that addon instead of raising.
lua = fresh("C_AddOns = API; local info = API.GetAddOnInfo; API.GetAddOnInfo = function(i) if i == 2 then error('boom') end return info(i) end",
            "{ installId = 'abcd-1234', toggles = { addons = true }, records = {} }")
lua.execute("""
event('PLAYER_LOGIN')
assert(Everloot:Count('addon_seen') == 3, 'one failing addon is skipped')
""")
# Every row the addon wrote is a record the site would accept (packages/protocol/schema).
from protocol_schema import check_all  # noqa: E402
check_all(lua)
print("Lua 5.1 addons: off by default and after upgrade, C_AddOns and legacy API, plain titles, rows on change plus a weekly check-in, off deletes and unpauses")
