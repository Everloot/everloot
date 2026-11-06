"""Run with: uv run --with lupa --with jsonschema python addon/tests/owned_contract.py

addon/modules/owned.lua: this character's professions (profession_owned) and raid lockouts (lockout_owned), under the
completion module's key, with the completion switch, latest state only, and never in an upload. The mock returns
what the mainline API documentation gives for GetProfessions, GetProfessionInfo and GetSavedInstanceInfo; none of it
is checked in game yet.
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

-- GetProfessions: prof1, prof2, archaeology, fishing, cooking; a slot without a profession is nil.
professions = { 1, 2, nil, nil, 5 }
book = {
 [1] = { 'Tailoring', 136249, 250, 300, 40, 0, 197 },
 [2] = { 'Enchanting', 136244, 225, 300, 30, 0, 333 },
 [5] = { 'Cooking', 133971, 1, 75, 2, 0, 185 },
}
GetProfessions = function() return professions[1], professions[2], professions[3], professions[4], professions[5] end
GetProfessionInfo = function(index) local b = book[index]; if not b then return nil end; return unpack(b, 1, 7) end

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


# Off by default, like the completion tracker it follows: nothing is read, nothing is written.
lua = addon(completion=None)
lua.execute("event('PLAYER_ENTERING_WORLD'); event('SKILL_LINES_CHANGED'); event('UPDATE_INSTANCE_INFO')")
assert plain(lua, "profession_owned") == [] and plain(lua, "lockout_owned") == []
assert lua.eval("raidInfoAsked") == 0
assert "owned: off by toggle" in status(lua), status(lua)
assert "could not start" not in lua.eval("printed[#printed]"), "an off module is off, not failed"

# On: login reads the profession book and asks the server for the lockout list.
lua = addon()
assert "owned: ready: professions ready; lockouts ready" in status(lua), status(lua)
lua.execute("event('PLAYER_ENTERING_WORLD')")
key = lua.eval("(Everloot.Completion.Identity())")
assert isinstance(key, str) and len(key) == 8, key
profs = plain(lua, "profession_owned")
assert [p["profession"] for p in profs] == ["Tailoring", "Enchanting", "Cooking"], profs
tailoring = profs[0]
assert {k: tailoring[k] for k in ("characterKey", "class", "level", "profession", "skillLine", "rank", "maxRank", "installId")} == {
    "characterKey": key, "class": "MAGE", "level": 60, "profession": "Tailoring", "skillLine": 197, "rank": 250, "maxRank": 300,
    "installId": "test-install-1234"}, tailoring
assert set(tailoring) == {"characterKey", "class", "level", "capturedAt", "installId", "profession", "skillLine", "rank", "maxRank", "eventId", "kindLoggedAt"}, sorted(tailoring)
assert tailoring["capturedAt"] == "2026-11-09T12:00:00Z"
assert lua.eval("raidInfoAsked") == 1
# An empty saved list at login means the answer has not come yet: no lockout rows before UPDATE_INSTANCE_INFO.
assert plain(lua, "lockout_owned") == []

# The answer: raids this character is saved to, with an absolute reset. A dungeon and an expired raid are left out.
lua.execute("event('UPDATE_INSTANCE_INFO')")
locks = plain(lua, "lockout_owned")
assert [l["instance"] for l in locks] == ["Molten Core", "Onyxia's Lair"], locks
mc = locks[0]
assert {k: mc[k] for k in ("characterKey", "class", "level", "instance", "instanceId", "difficultyId", "difficulty", "bossesKilledCount", "bossesTotal", "resetAt")} == {
    "characterKey": key, "class": "MAGE", "level": 60, "instance": "Molten Core", "instanceId": 409, "difficultyId": 9,
    "difficulty": "40 Player", "bossesKilledCount": 6, "bossesTotal": 10, "resetAt": "2026-11-11T12:00:00Z"}, mc
assert set(mc) == {"characterKey", "class", "level", "capturedAt", "installId", "instance", "instanceId", "difficultyId", "difficulty",
                   "bossesKilledCount", "bossesTotal", "resetAt", "eventId", "kindLoggedAt"}, sorted(mc)
assert locks[1]["resetAt"] == "2026-11-13T12:00:00Z", locks[1]

# No name, realm or GUID in either kind, and no name call was made.
for row in profs + locks:
    assert not ({"character", "name", "realm", "guid"} & set(row)), row
assert lua.eval("#forbidden") == 0, list(lua.eval("forbidden").values())

# Latest state, not history: a re-read replaces this character's rows; a new rank shows; nothing doubles.
lua.execute("book[1][3] = 260; event('SKILL_LINES_CHANGED'); event('UPDATE_INSTANCE_INFO'); event('UPDATE_INSTANCE_INFO')")
profs = plain(lua, "profession_owned")
assert len(profs) == 3 and profs[[p["profession"] for p in profs].index("Tailoring")]["rank"] == 260, profs
assert len(plain(lua, "lockout_owned")) == 2

# A dropped profession goes from the file.
lua.execute("professions[2] = nil; event('SKILL_LINES_CHANGED')")
assert [p["profession"] for p in plain(lua, "profession_owned")] == ["Tailoring", "Cooking"]

# A second character on this install keeps its own rows beside the first one's.
lua.execute("""
guid = 'Player-4242-0FEDCBA2'
saved = { { 'Molten Core', 21, 6 * 86400, 9, true, false, 0, true, 40, '40 Player', 10, 2, false, 409 } }
event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')
""")
other = lua.eval("(Everloot.Completion.Identity())")
assert other != key
locks = plain(lua, "lockout_owned")
assert sorted((l["characterKey"], l["bossesKilledCount"]) for l in locks) == sorted([(key, 6), (key, 1), (other, 2)]), locks
assert {p["characterKey"] for p in plain(lua, "profession_owned")} == {key, other}

# Three days on, the first character's Molten Core lockout has reset: the next read drops it for every character.
lua.execute(f"NOW_T = NOW_T + 3 * {DAY}; event('UPDATE_INSTANCE_INFO')")
locks = plain(lua, "lockout_owned")
assert sorted((l["characterKey"], l["instance"]) for l in locks) == sorted([(key, "Onyxia's Lair"), (other, "Molten Core")]), locks

# The character now has no lockouts at all: its rows go, it does not get a zero row.
lua.execute("saved = {}; event('UPDATE_INSTANCE_INFO')")
assert [l["characterKey"] for l in plain(lua, "lockout_owned")] == [key]

# The rows the other kinds' validation reads are untouched; these two are left to this test by design.
counts = check_all(lua)
assert not (set(counts) & LOCAL_ONLY_KINDS), counts

# /everloot completion off deletes these rows with the completion rows.
lua.execute("SlashCmdList.EVERLOOT('completion off')")
assert plain(lua, "profession_owned") == [] and plain(lua, "lockout_owned") == []
lua.execute("event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')")
assert plain(lua, "profession_owned") == [] and plain(lua, "lockout_owned") == [], "off stops reading at once"

# The on message tells the player these stay on the computer.
lua.execute("SlashCmdList.EVERLOOT('completion on')")
assert "never uploaded" in lua.eval("printed[#printed]"), lua.eval("printed[#printed]")

# A missing call records nothing for its kind, never zeros; the other kind still works.
lua = addon(setup="GetProfessionInfo = nil")
assert "professions unavailable, missing GetProfessionInfo (records nothing)" in status(lua), status(lua)
lua.execute("event('PLAYER_ENTERING_WORLD'); event('SKILL_LINES_CHANGED'); event('UPDATE_INSTANCE_INFO')")
assert plain(lua, "profession_owned") == []
assert len(plain(lua, "lockout_owned")) == 2

lua = addon(setup="GetSavedInstanceInfo = nil; RequestRaidInfo = nil")
assert "lockouts unavailable, missing GetSavedInstanceInfo (records nothing)" in status(lua), status(lua)
lua.execute("event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')")
assert plain(lua, "lockout_owned") == [] and len(plain(lua, "profession_owned")) == 3

# RequestRaidInfo is optional: without it the list is still read when the server sends it.
lua = addon(setup="RequestRaidInfo = nil")
lua.execute("event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')")
assert len(plain(lua, "lockout_owned")) == 2

# Values the game leaves out are left out, not written as zeros.
lua = addon(setup="""
book[1] = { 'Tailoring', 1, 250, nil, 0, 0, 197 }
book[2] = { 'Enchanting', 1, 225, 300, 0, 0, nil }
saved = { { 'Molten Core', 11, 86400, 9, true, false, 0, true, 40, nil, nil, nil, false, nil } }
""")
lua.execute("event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')")
profs = plain(lua, "profession_owned")
assert [p["profession"] for p in profs] == ["Enchanting", "Cooking"], profs
assert "skillLine" not in profs[0], profs[0]
assert plain(lua, "lockout_owned") == [], "a lockout without boss counts is not written"

# Neither call there: the module cannot start and records nothing.
lua = addon(setup="GetProfessions = nil; GetNumSavedInstances = nil")
assert "owned: disabled:" in status(lua), status(lua)
lua.execute("event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')")
assert plain(lua, "profession_owned") == [] and plain(lua, "lockout_owned") == []

# No player id yet: nothing is written under an empty key.
lua = addon(setup="UnitGUID = function() return nil end")
lua.execute("event('PLAYER_ENTERING_WORLD'); event('UPDATE_INSTANCE_INFO')")
assert plain(lua, "profession_owned") == [] and plain(lua, "lockout_owned") == []

# The module calls nothing that changes the game and reads no name.
source = (root / "modules" / "owned.lua").read_text(encoding="utf-8")
code = "\n".join(line.split("--")[0] for line in source.splitlines())
for name in ("UnitName", "GetRealmName", "UnitGUID", "SendChatMessage", "SetSavedInstanceExtend", "ResetInstances"):
    assert name not in code, f"owned.lua must not call {name}"

print("Own professions and lockouts: keyed like completion, follow its switch, latest state only, missing calls record nothing")
