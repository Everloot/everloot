"""Run with: uv run --with lupa --with jsonschema python addon/tests/owned_contract.py

addon/modules/owned.lua: this character's raid lockouts (lockout_owned), under the completion module's key, with the
completion switch, latest state only, and never in an upload. Professions (profession_owned) and the active talent build
(talent_owned) are no longer read or recorded: Blizzard's character API supplies them. The mock returns what the
mainline API documentation gives for GetSavedInstanceInfo; none of it is checked in game yet.
"""
from pathlib import Path

from lupa.lua51 import LuaRuntime

from protocol_schema import LOCAL_ONLY_KINDS, check_all, to_plain

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\owned.lua" in toc, "the module must be in the TOC"
assert toc.index("modules\\owned.lua") > toc.index("modules\\completion.lua"), "it uses the completion module's key, so it loads after it"

NOW = 1794225600  # 2026-11-09T12:00:00Z
DAY = 24 * 3600

WORLD = """
NOW_T = %d
time = function() return NOW_T end
date = function(format, t) return os.date(format, t or NOW_T) end
math.random = function(a, b) return a or 0 end
printed = {}
print = function(...) printed[#printed + 1] = table.concat({ ... }, ' ') end
SlashCmdList = {}
registered = {}
CreateFrame = function() return {
 RegisterEvent=function(_, name) registered[name] = true end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
C_Timer = { After = function() end }
forbidden = {}
UnitName = function() forbidden[#forbidden + 1] = 'UnitName' end
GetRealmName = function() forbidden[#forbidden + 1] = 'GetRealmName' end

guid = 'Player-4242-0ABCDEF1'
UnitGUID = function(unit) assert(unit == 'player'); return guid end
UnitClass = function() return 'Mage', 'MAGE', 8 end
UnitLevel = function() return 60 end

-- GetSavedInstanceInfo: name, lockoutId, reset, difficultyId, locked, extended, instanceIDMostSig, isRaid,
-- maxPlayers, difficultyName, numEncounters, encounterProgress, extendDisabled, instanceId.
saved = {
 { 'Molten Core', 11, 2 * 86400, 9, true, false, 0, true, 40, '40 Player', 10, 6, false, 409 },
 { 'Onyxia\\'s Lair', 12, 4 * 86400 + 0.5, 9, true, false, 0, true, 40, '40 Player', 1, 1, false, 249 },
 { 'Deadmines', 13, 3600, 2, true, false, 0, false, 5, 'Heroic', 5, 5, false, 36 },
 { 'Zul\\'Gurub', 14, 0, 148, false, false, 0, true, 20, '20 Player', 10, 10, false, 309 },
}
GetNumSavedInstances = function() return #saved end
GetSavedInstanceInfo = function(i) return unpack(saved[i], 1, 14) end
raidInfoAsked = 0
RequestRaidInfo = function() raidInfoAsked = raidInfoAsked + 1 end

function event(name, ...)
 for _, hook in ipairs(Everloot.frame.hooks or {}) do hook(nil, name, ...) end
end
function rows(kind) return EverlootDB.records[kind] or {} end
""" % NOW


def addon(completion=True, setup=""):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(setup)
    if completion is not None:
        lua.execute("EverlootDB = { installId = 'test-install-1234', toggles = { completion = %s }, records = {} }" % ("true" if completion else "false"))
    for file in ("core.lua", "modules/completion.lua", "modules/owned.lua"):
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')")
    return lua


def plain(lua, kind):
    return to_plain(lua.eval(f"rows('{kind}')"))


def status(lua):
    return lua.eval("Everloot:Status()")


# Explicitly off: follows the completion switch, reading and writing nothing.
lua = addon(completion=False)
lua.execute("event('PLAYER_ENTERING_WORLD'); event('SKILL_LINES_CHANGED'); event('UPDATE_INSTANCE_INFO')")
assert plain(lua, "lockout_owned") == []
assert lua.eval("raidInfoAsked") == 0
assert "owned: off by toggle" in status(lua), status(lua)
assert "could not start" not in lua.eval("printed[#printed]"), "an off module is off, not failed"

# On: login asks the server for the lockout list. The profession book is not read: professions are no longer recorded.
lua = addon(setup="GetProfessions = function() forbidden[#forbidden + 1] = 'GetProfessions' end")
assert "owned: ready: lockouts ready" in status(lua) and "professions" not in status(lua), status(lua)
lua.execute("event('PLAYER_ENTERING_WORLD'); event('SKILL_LINES_CHANGED'); event('TRAIT_CONFIG_UPDATED')")
key = lua.eval("(Everloot.Completion.Identity())")
assert isinstance(key, str) and len(key) == 8, key
assert plain(lua, "profession_owned") == [] and plain(lua, "talent_owned") == [], "professions and talents are not recorded"
assert lua.eval("raidInfoAsked") == 1
# An empty saved list at login means the answer has not come yet: no lockout rows before UPDATE_INSTANCE_INFO.
assert plain(lua, "lockout_owned") == []

# The answer: raids this character is saved to, with an absolute reset. Saved dungeons are included; an expired raid is left out.
lua.execute("event('UPDATE_INSTANCE_INFO')")
locks = plain(lua, "lockout_owned")
assert [l["instance"] for l in locks] == ["Molten Core", "Onyxia's Lair", "Deadmines"], locks
mc = locks[0]
assert {k: mc[k] for k in ("characterKey", "class", "level", "instance", "instanceId", "difficultyId", "difficulty", "bossesKilledCount", "bossesTotal", "resetAt")} == {
    "characterKey": key, "class": "MAGE", "level": 60, "instance": "Molten Core", "instanceId": 409, "difficultyId": 9,
    "difficulty": "40 Player", "bossesKilledCount": 6, "bossesTotal": 10, "resetAt": "2026-11-11T12:00:00Z"}, mc
assert set(mc) == {"characterKey", "class", "level", "capturedAt", "installId", "instance", "instanceId", "difficultyId", "difficulty",
                   "bossesKilledCount", "bossesTotal", "resetAt", "eventId", "kindLoggedAt"}, sorted(mc)
assert locks[1]["resetAt"] == "2026-11-13T12:00:00Z", locks[1]

# No name, realm or GUID in a row, and no name or profession call was made.
for row in locks:
    assert not ({"character", "name", "realm", "guid"} & set(row)), row
assert lua.eval("#forbidden") == 0, list(lua.eval("forbidden").values())

# Latest state, not history: a re-read replaces this character's rows; nothing doubles.
lua.execute("event('UPDATE_INSTANCE_INFO'); event('UPDATE_INSTANCE_INFO')")
assert len(plain(lua, "lockout_owned")) == 3

# A second character on this install keeps its own rows beside the first one's.
lua.execute("""
guid = 'Player-4242-0FEDCBA2'
saved = { { 'Molten Core', 21, 6 * 86400, 9, true, false, 0, true, 40, '40 Player', 10, 2, false, 409 } }
event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')
""")
other = lua.eval("(Everloot.Completion.Identity())")
assert other != key
locks = plain(lua, "lockout_owned")
assert sorted((l["characterKey"], l["bossesKilledCount"]) for l in locks) == sorted([(key, 6), (key, 1), (key, 5), (other, 2)]), locks

# Three days on, the first character's Molten Core lockout has reset: the next read drops it for every character.
lua.execute(f"NOW_T = NOW_T + 3 * {DAY}; event('UPDATE_INSTANCE_INFO')")
locks = plain(lua, "lockout_owned")
assert sorted((l["characterKey"], l["instance"]) for l in locks) == sorted([(key, "Onyxia's Lair"), (other, "Molten Core")]), locks

# The character now has no lockouts at all: its rows go, it does not get a zero row.
lua.execute("saved = {}; event('UPDATE_INSTANCE_INFO')")
assert [l["characterKey"] for l in plain(lua, "lockout_owned")] == [key]

# The rows the other kinds' validation reads are untouched; lockouts are left to this test by design.
counts = check_all(lua)
assert not (set(counts) & LOCAL_ONLY_KINDS), counts

# /everloot completion off deletes these rows with the completion rows.
lua.execute("SlashCmdList.EVERLOOT('completion off')")
assert plain(lua, "lockout_owned") == []
lua.execute("event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')")
assert plain(lua, "lockout_owned") == [], "off stops reading at once"

# The on message tells the player lockouts stay on the computer unless the Desktop App sends a linked character's,
# and says which progress is no longer recorded.
lua.execute("SlashCmdList.EVERLOOT('completion on')")
said = lua.eval("printed[#printed]")
assert "for a character you linked" in said and "never go in an upload" in said and "Blizzard's API" in said, said
assert "never uploaded" not in said and "professions" not in said and "talent" not in said and "PvP" not in said, said

# A missing call records nothing, never zeros, and the module cannot start.
lua = addon(setup="GetSavedInstanceInfo = nil; RequestRaidInfo = nil")
assert "owned: disabled: lockouts unavailable, missing GetSavedInstanceInfo (records nothing)" in status(lua), status(lua)
lua.execute("event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')")
assert plain(lua, "lockout_owned") == []

# RequestRaidInfo is optional: without it the list is still read when the server sends it.
lua = addon(setup="RequestRaidInfo = nil")
lua.execute("event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')")
assert len(plain(lua, "lockout_owned")) == 3

# Values the game leaves out are left out, not written as zeros.
lua = addon(setup="""
saved = { { 'Molten Core', 11, 86400, 9, true, false, 0, true, 40, nil, nil, nil, false, nil } }
""")
lua.execute("event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')")
assert plain(lua, "lockout_owned") == [], "a lockout without boss counts is not written"

# No player id yet: nothing is written under an empty key.
lua = addon(setup="UnitGUID = function() return nil end")
lua.execute("event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')")
assert plain(lua, "lockout_owned") == []

# The module calls nothing that changes the game and reads no name.
source = (root / "modules" / "owned.lua").read_text(encoding="utf-8")
code = "\n".join(line.split("--")[0] for line in source.splitlines())
for name in ("UnitName", "GetRealmName", "UnitGUID", "SendChatMessage", "SetSavedInstanceExtend", "ResetInstances",
             "GetProfessions", "GetProfessionInfo", "Talents"):
    assert name not in code, f"owned.lua must not call {name}"

print("Own lockouts: keyed like completion, follow its switch, latest state only, missing calls record nothing; "
      "professions and talents not recorded")
