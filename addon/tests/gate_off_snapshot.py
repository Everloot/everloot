"""What a player can see of the addon with E.RUN_RECORDS off: the saved file, everything printed, /everloot status,
the commands around pulls, the events registered and the settings rows, over one session with a boss pull.

pulls_contract.py compares this tree's snapshot with fixtures/gate_off_main.json, the same scenario run on main's
addon before pull timing existed. Regenerate that file only from main, never from this branch:

    git archive origin/main addon | tar -x -C /tmp/main
    uv run --with lupa python addon/tests/gate_off_snapshot.py /tmp/main/addon > addon/tests/fixtures/gate_off_main.json
"""
import json
import sys
from pathlib import Path

from lupa.lua51 import LuaRuntime

# Every file pull timing touches. pulls.lua is absent on main; with the gate off it returns before doing anything.
FILES = ("core.lua", "modules/openworld.lua", "modules/pulls.lua", "modules/options.lua")

WORLD = """
NOW_T = 1793620800 -- 2026-11-02T12:00:00Z
time = function() return NOW_T end
date = function(format, t) return os.date(format, t or NOW_T) end
GetTime = function() return NOW_T end
math.random = function(a, b) return a or 0 end
printed = {}
print = function(...) printed[#printed + 1] = table.concat({ ... }, ' ') end
SlashCmdList = {}
registered = {}
-- A frame answers every UI method with a frame, so the settings page builds as it does in the game.
local function widget()
 local w = {}
 return setmetatable(w, { __index = function(_, name) return function() return widget() end end })
end
CreateFrame = function()
 local f = widget()
 f.RegisterEvent = function(_, name) registered[name] = (registered[name] or 0) + 1 end
 f.RegisterUnitEvent = function(_, name) registered[name] = (registered[name] or 0) + 1 end
 f.SetScript = function(self, _, fn) self.onEvent = fn end
 f.HookScript = function(self, _, fn) rawset(self, "hooks", rawget(self, "hooks") or {}); table.insert(self.hooks, fn) end
 return f
end
UIParent = widget()
UnitLevel = function() return 20 end
UnitIsFriend = function() return true end
UnitCanAttack = function() return false end
UnitCreatureType = function() return 'Humanoid' end
UnitClassification = function() return 'normal' end
C_Map = { GetBestMapForUnit=function() return 1436 end, GetPlayerMapPosition=function() return { x = .4, y = .7 } end }
INSTANCE_RESET_SUCCESS = '%s has been reset.'
OUTSIDE = { 'Westfall', 'none', 0, '', 0, 0, false, 0 }
DEADMINES = { 'The Deadmines', 'party', 1, 'Normal', 5, 0, false, 36 }
instance = OUTSIDE
GetInstanceInfo = function() return unpack(instance, 1, 10) end
units = { player = { guid = 'Player-4242-00000001', name = 'Myself', class = 'HUNTER' }, party1 = { guid = 'Player-4242-00000002', name = 'Tankie', class = 'WARRIOR' } }
UnitGUID = function(unit) local u = units[unit]; return u and u.guid end
UnitName = function(unit) local u = units[unit]; if u then return u.name end end
UnitClass = function(unit) local u = units[unit]; if u then return 'Display', u.class, 3 end end
UnitGroupRolesAssigned = function() return 'NONE' end
GetRealmName = function() return 'Forever' end
IsInRaid = function() return false end
InCombatLockdown = function() return false end
UnitAffectingCombat = function() return false end
C_DamageMeter = { IsDamageMeterAvailable = function() return true, '' end,
 GetCombatSessionFromType = function() return { durationSeconds = 60, combatSources = {} } end }
"""

SESSION = """
function event(name, ...) for _, hook in ipairs(rawget(Everloot.frame, "hooks") or {}) do hook(nil, name, ...) end end
function zone(where) event('PLAYER_LEAVING_WORLD'); instance = where; event('PLAYER_ENTERING_WORLD') end
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
zone(DEADMINES)
event('ENCOUNTER_START', 1144, "Rhahk'zor", 1, 5)
NOW_T = NOW_T + 75
event('PLAYER_REGEN_ENABLED')
event('ENCOUNTER_END', 1144, "Rhahk'zor", 1, 5, 1)
event('PLAYER_REGEN_ENABLED')
zone(OUTSIDE)
NOW_T = NOW_T + 4000
event('CHAT_MSG_SYSTEM', 'The Deadmines has been reset.')
zone(OUTSIDE)
for _, msg in ipairs({ 'status', 'pulls', 'pulls on', 'pulls off', 'help' }) do
 SlashCmdList.EVERLOOT(msg)
end
"""


def plain(value):
    """A Lua value as JSON: tables with keys 1..n are lists, other tables objects with sorted string keys."""
    if hasattr(value, "items"):
        items = list(value.items())
        if items and all(isinstance(k, int) for k, _ in items) and sorted(k for k, _ in items) == list(range(1, len(items) + 1)):
            return [plain(v) for _, v in sorted(items)]
        return {str(k): plain(v) for k, v in sorted(items, key=lambda kv: str(kv[0]))}
    return value


def snapshot(root: Path) -> dict:
    """The scenario on the addon at `root`, with E.RUN_RECORDS off: once as a new install, once as an upgrade."""
    files = [f for f in FILES if (root / f).exists()]
    result = {}
    for case, saved in (("new", "nil"), ("upgrade", '{ installId = "abcd-1234", toggles = { openworld = true }, records = {} }')):
        lua = LuaRuntime()
        lua.execute(WORLD)
        lua.execute(f"EverlootDB = {saved}")
        for file in files:
            lua.execute((root / file).read_text(encoding="utf-8"))
            if file == "core.lua":
                lua.execute("Everloot.RUN_RECORDS = false")
        lua.execute(SESSION)
        g = lua.globals()
        result[case] = {
            "saved": plain(g.EverlootDB),
            "printed": plain(g.printed) or [],
            "status": g.Everloot.Status(g.Everloot),
            "registered": plain(g.registered),
            "options": [r.get("key") or r.get("field") for r in plain(g.Everloot.Options.ROWS)],
        }
    return result


if __name__ == "__main__":
    print(json.dumps(snapshot(Path(sys.argv[1])), indent=1, sort_keys=True))
