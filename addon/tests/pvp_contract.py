"""Run with: uv run --with lupa --with jsonschema python addon/tests/pvp_contract.py

addon/modules/pvp.lua: this character's PvP rank and honorable kills (pvp_owned), under the completion module's key,
with the completion switch, latest state only, and never in an upload. The mock returns what Forever's Camelot PvP rank
frame (C_MajorFactions faction 2800) and statistics frame calls return (not yet checked in game).
"""
from pathlib import Path

from lupa.lua51 import LuaRuntime

from protocol_schema import LOCAL_ONLY_KINDS, check_all, to_plain

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\pvp.lua" in toc, "the module must be in the TOC"
assert toc.index("modules\\pvp.lua") > toc.index("modules\\owned.lua"), "it follows owned.lua"
assert "pvp_owned" in LOCAL_ONLY_KINDS, "pvp_owned never leaves the computer"

NOW = 1794225600  # 2026-11-09T12:00:00Z

WORLD = """
NOW_T = %d
time = function() return NOW_T end
date = function(format, t) return os.date(format, t or NOW_T) end
math.random = function(a, b) return a or 0 end
printed = {}
print = function(...) printed[#printed + 1] = table.concat({ ... }, ' ') end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function(_, name) end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
timers = {}
C_Timer = { After = function(_, f) timers[#timers + 1] = f end }
function settle() local run = timers; timers = {}; for _, f in ipairs(run) do f() end end
forbidden = {}
UnitName = function() forbidden[#forbidden + 1] = 'UnitName' end
GetRealmName = function() forbidden[#forbidden + 1] = 'GetRealmName' end

guid = 'Player-4242-0ABCDEF1'
UnitGUID = function(unit) assert(unit == 'player'); return guid end
UnitClass = function() return 'Mage', 'MAGE', 8 end
UnitLevel = function() return 60 end

-- Statistics: categories 10 and 20; statistic 588 is Total Honorable Kills.
CATS = { 10, 20 }
STATS = { [10] = { { '5', false, 100 } }, [20] = { { '--', false, 200 }, { '1,234', false, 588 } } }
GetStatisticsCategoryList = function() return CATS end
GetCategoryNumAchievements = function(cat) return #STATS[cat] end
GetStatistic = function(cat, i) local s = STATS[cat][i]; return s[1], s[2], s[3] end
-- Rank is renown on major faction 2800.
asked = {}
INFO = { renownLevel = 7, renownReputationEarned = 450, renownLevelThreshold = 1000, maxLevel = 14 }
C_MajorFactions = { GetMajorFactionProgressionInfo = function(id) asked[#asked + 1] = id; return INFO end }
GetCurrentArenaSeason = function() return 3 end

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
    for file in ("core.lua", "modules/completion.lua", "modules/owned.lua", "modules/pvp.lua"):
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')")
    return lua


def plain(lua, kind="pvp_owned"):
    return to_plain(lua.eval(f"rows('{kind}')"))


def status(lua):
    return lua.eval("Everloot:Status()")


def read(lua, name="PLAYER_ENTERING_WORLD"):
    lua.execute(f"event('{name}'); settle()")


FULL = {"rank": 7, "rankPoints": 450, "rankThreshold": 1000, "rankMax": 14, "season": 3, "honorableKills": 1234}
META = {"kind", "characterKey", "installId", "capturedAt", "class", "level", "eventId", "kindLoggedAt"}

# Off by default like the completion tracker: nothing is read, nothing is written.
lua = addon(completion=None)
read(lua)
assert plain(lua) == []
assert "pvp: off by toggle" in status(lua), status(lua)

# On: the full row; "1,234" becomes 1234; rank read from faction 2800 only.
lua = addon()
assert "pvp: ready" in status(lua), status(lua)
read(lua)
key = lua.eval("(Everloot.Completion.Identity())")
rows_ = plain(lua)
assert len(rows_) == 1, rows_
row = rows_[0]
assert {k: v for k, v in row.items() if k not in META} == FULL, row
assert {k: row[k] for k in ("kind", "characterKey", "installId", "capturedAt", "class", "level")} == {
    "kind": "pvp_owned", "characterKey": key, "installId": "test-install-1234", "capturedAt": "2026-11-09T12:00:00Z",
    "class": "MAGE", "level": 60}, row
assert set(row) == META | set(FULL), sorted(row)
assert not ({"character", "name", "realm", "guid", "rankTitle"} & set(row)), row
assert set(lua.eval("asked").values()) == {2800}
assert lua.eval("#forbidden") == 0

# Every listed event reads; a burst reads once.
for name in ("PLAYER_ENTERING_WORLD", "UPDATE_FACTION", "MAJOR_FACTION_RENOWN_LEVEL_CHANGED", "PLAYER_PVP_RANK_CHANGED"):
    lua.execute("INFO = { renownLevel = %d, renownReputationEarned = 1, renownLevelThreshold = 2, maxLevel = 14 }" % (8 + len(plain(lua))))
    read(lua, name)
    assert len(plain(lua)) == 1
lua.execute("event('UPDATE_FACTION'); event('UPDATE_FACTION'); assert(#timers == 1); settle()")

# "--", empty and non-numeric kills: the field is left out, never a zero.
for text in ("--", "", "n/a"):
    lua = addon(setup="STATS[20][2][1] = %r" % text)
    read(lua)
    row = plain(lua)[0]
    assert "honorableKills" not in row and row["rank"] == 7, row
# A real zero is a fact.
lua = addon(setup="STATS[20][2][1] = '0'")
read(lua)
assert plain(lua)[0]["honorableKills"] == 0
# A plain number (not a string) is fine; a secret value is left out.
lua = addon(setup="STATS[20][2][1] = 77")
read(lua)
assert plain(lua)[0]["honorableKills"] == 77
lua = addon(setup="issecretvalue = function(v) return v == '1,234' end")
read(lua)
assert "honorableKills" not in plain(lua)[0]
# No statistic 588 anywhere: no kills field.
lua = addon(setup="STATS[20][2][3] = 589")
read(lua)
assert "honorableKills" not in plain(lua)[0]
# The statistics calls missing or erroring: rank only.
for setup in ("GetStatisticsCategoryList = nil", "GetStatistic = function() error('boom') end"):
    lua = addon(setup=setup)
    read(lua)
    row = plain(lua)[0]
    assert "honorableKills" not in row and row["rank"] == 7, row

# C_MajorFactions missing, or no table back: a row with the kills only.
for setup in ("C_MajorFactions = nil", "INFO = nil", "C_MajorFactions.GetMajorFactionProgressionInfo = function() error('boom') end"):
    lua = addon(setup=setup)
    read(lua)
    row = plain(lua)[0]
    assert {k: v for k, v in row.items() if k not in META} == {"season": 3, "honorableKills": 1234}, (setup, row)
# A rank field that is not a number is left out, the rest stay.
lua = addon(setup="INFO.maxLevel = 'x'; INFO.renownReputationEarned = -1")
read(lua)
row = plain(lua)[0]
assert "rankMax" not in row and "rankPoints" not in row and row["rank"] == 7, row
# A secret rank is left out.
lua = addon(setup="issecretvalue = function(v) return v == 7 end")
read(lua)
assert "rank" not in plain(lua)[0] and plain(lua)[0]["honorableKills"] == 1234
# No season call: no season.
lua = addon(setup="GetCurrentArenaSeason = nil")
read(lua)
assert "season" not in plain(lua)[0]

# Both rank and kills absent: no row (a season alone is not a fact worth a row).
lua = addon(setup="C_MajorFactions = nil; GetStatisticsCategoryList = nil")
read(lua)
assert plain(lua) == []
# A row written earlier stays when a later read has nothing.
lua = addon()
read(lua)
lua.execute("C_MajorFactions = nil; GetStatisticsCategoryList = nil")
read(lua)
assert len(plain(lua)) == 1

# The walk is bounded: an endless category list and an endless category still finish.
lua = addon(setup="GetStatisticsCategoryList = function() local t = {}; for i = 1, 100000 do t[i] = 10 end; return t end;"
                  "GetCategoryNumAchievements = function() return 1e9 end; n = 0;"
                  "GetStatistic = function() n = n + 1; return '--', false, 1 end")
read(lua)
assert lua.eval("n") < 50000, lua.eval("n")

# Latest state only; a second character keeps its own row and a re-read replaces only its own.
lua = addon()
read(lua)
lua.execute("guid = 'Player-4242-0FEDCBA2'; INFO.renownLevel = 9")
read(lua)
other = lua.eval("(Everloot.Completion.Identity())")
assert other != key
by = {r["characterKey"]: r for r in plain(lua)}
assert set(by) == {key, other} and by[key]["rank"] == 7 and by[other]["rank"] == 9, by
lua.execute("INFO.renownLevel = 10")
read(lua)
by = {r["characterKey"]: r for r in plain(lua)}
assert len(by) == 2 and by[other]["rank"] == 10 and by[key]["rank"] == 7, by

# Local only; /everloot completion off deletes the row and stops reading at once.
counts = check_all(lua)
assert "pvp_owned" not in counts, counts
lua.execute("SlashCmdList.EVERLOOT('completion off')")
assert plain(lua) == []
read(lua)
assert plain(lua) == [], "off stops reading"
# Switched off while a read waits: nothing is written.
lua.execute("SlashCmdList.EVERLOOT('completion on')")
lua.execute("event('PLAYER_ENTERING_WORLD'); EverlootDB.toggles.completion = false; settle()")
assert plain(lua) == []

# No player id yet: no row under an empty key.
lua = addon(setup="UnitGUID = function() return nil end")
read(lua)
assert plain(lua) == []

# The status line names calls that are missing.
lua = addon(setup="C_MajorFactions = nil")
assert "missing C_MajorFactions" in status(lua), status(lua)

# The module changes nothing in the game and reads no name.
source = (root / "modules" / "pvp.lua").read_text(encoding="utf-8")
code = "\n".join(line.split("--")[0] for line in source.splitlines())
for name in ("UnitName", "GetRealmName", "UnitGUID", "SendChatMessage"):
    assert name not in code, f"pvp.lua must not call {name}"

print("PvP rank and honorable kills: keyed like completion, follow its switch, latest state only, missing calls record nothing")
