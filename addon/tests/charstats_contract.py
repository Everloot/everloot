"""Run with: uv run --with lupa --with jsonschema python addon/tests/charstats_contract.py

addon/modules/charstats.lua: this character's character-sheet numbers (stats_owned), under the completion module's key,
with the completion switch, latest state only, read out of combat, and never in an upload. The mock returns what the
mainline PaperDoll calls return (checked against Forever's Camelot UI files, not yet in game).
"""
from pathlib import Path

from lupa.lua51 import LuaRuntime

from protocol_schema import LOCAL_ONLY_KINDS, check_all, to_plain

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\charstats.lua" in toc, "the module must be in the TOC"
assert toc.index("modules\\charstats.lua") > toc.index("modules\\owned.lua"), "it follows owned.lua"
assert "stats_owned" in LOCAL_ONLY_KINDS, "stats_owned never leaves the computer"

NOW = 1794225600  # 2026-11-09T12:00:00Z

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

combat = false
InCombatLockdown = function() return combat end
calls = {}

-- UnitStat: stat, effectiveStat, posBuff, negBuff. 1..5 = strength, agility, stamina, intellect, spirit.
ATTR = { 10.4, 20, 30.6, 400, 55 }
UnitStat = function(unit, i) assert(unit == 'player'); return ATTR[i] - 5, ATTR[i], 5, 0 end
UnitAttackPower = function() return 100, 20, -5 end
UnitRangedAttackPower = function() return 50, 10, 0 end
GetCritChance = function() return 5.456 end
GetRangedCritChance = function() return 6.004 end
GetSpellCritChance = function() return 7.125 end
GetHitModifier = function() return 1.5 end
GetRangedHitModifier = function() return 2 end
GetSpellHitModifier = function() return 3.333 end
CR_HIT_MELEE = 6; CR_HIT_RANGED = 7; CR_HIT_SPELL = 8
RATING = { [6] = 1.25, [7] = 0.5, [8] = 2.2 }
GetCombatRatingBonus = function(cr) return RATING[cr] end
GetMeleeHaste = function() return 4.5 end
GetRangedHaste = function() return 3.999 end
UnitSpellHaste = function(unit) assert(unit == 'player'); return 8.1 end
GetExpertise = function() return 7.6, 3, 2 end
SPELLDMG = { [2] = 310, [3] = 300, [4] = 305, [5] = 320, [6] = 301, [7] = 299 }
GetSpellBonusDamage = function(school) return SPELLDMG[school] end
GetSpellBonusHealing = function() return 450 end
UnitArmor = function() return 900, 1234.6, 1234.6, 0 end
UnitDefenseSkill = function() return 300, 12 end
GetDodgeChance = function() return 4.5 end
GetParryChance = function() return 0 end
GetBlockChance = function() return 8.756 end

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
    for file in ("core.lua", "modules/completion.lua", "modules/owned.lua", "modules/charstats.lua"):
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')")
    return lua


def plain(lua, kind="stats_owned"):
    return to_plain(lua.eval(f"rows('{kind}')"))


def status(lua):
    return lua.eval("Everloot:Status()")


def read(lua, name="PLAYER_ENTERING_WORLD", *args):
    lua.execute(f"event('{name}'{''.join(', ' + a for a in args)}); settle()")


FULL = {
    "strength": 10, "agility": 20, "stamina": 31, "intellect": 400, "spirit": 55,
    "meleeAttackPower": 115, "meleeHit": 2.75, "meleeCrit": 5.46, "meleeHaste": 4.5, "expertise": 8,
    "rangedAttackPower": 60, "rangedHit": 2.5, "rangedCrit": 6.0, "rangedHaste": 4.0,
    "spellPower": 299, "healing": 450, "spellHit": 5.53, "spellCrit": 7.13, "spellHaste": 8.1,
    "armor": 1235, "defense": 312, "dodge": 4.5, "parry": 0, "block": 8.76,
}

# Off by default like the completion tracker: nothing is read, nothing is written.
lua = addon(completion=None)
read(lua)
assert plain(lua) == []
assert "charstats: off by toggle" in status(lua), status(lua)

# On: the full row, exact keys, percents to 2 decimals, the rest whole numbers (rounded, not floored).
lua = addon()
assert "charstats: ready" in status(lua), status(lua)
read(lua)
key = lua.eval("(Everloot.Completion.Identity())")
rows_ = plain(lua)
assert len(rows_) == 1, rows_
row = rows_[0]
assert row["stats"] == FULL, row["stats"]
assert {k: row[k] for k in ("kind", "characterKey", "installId", "capturedAt", "class", "level")} == {
    "kind": "stats_owned", "characterKey": key, "installId": "test-install-1234", "capturedAt": "2026-11-09T12:00:00Z",
    "class": "MAGE", "level": 60}, row
assert set(row) == {"kind", "characterKey", "installId", "capturedAt", "class", "level", "stats", "eventId", "kindLoggedAt"}, sorted(row)
assert not ({"character", "name", "realm", "guid"} & set(row)), row
assert lua.eval("#forbidden") == 0

# Every listed event reads, once after a burst; UNIT_STATS for another unit does not.
for name in ("PLAYER_ENTERING_WORLD", "PLAYER_EQUIPMENT_CHANGED", "PLAYER_LEVEL_UP"):
    lua.execute("ATTR[1] = ATTR[1] + 1")
    read(lua, name)
    assert len(plain(lua)) == 1
lua.execute("ATTR[1] = 77")
lua.execute("event('UNIT_STATS', \"'party1'\"); settle()")
assert plain(lua)[0]["stats"]["strength"] != 77, "another unit's UNIT_STATS is ignored"
lua.execute("event('UNIT_STATS', 'player'); event('UNIT_STATS', 'player'); assert(#timers == 1); settle()")
assert plain(lua)[0]["stats"]["strength"] == 77 and len(plain(lua)) == 1

# A hit rating global missing: the modifier alone, never a guess. A missing GetCombatRatingBonus does the same.
lua = addon(setup="CR_HIT_MELEE = nil; GetCombatRatingBonus = nil")
read(lua)
st = plain(lua)[0]["stats"]
assert st["meleeHit"] == 1.5 and st["rangedHit"] == 2 and st["spellHit"] == 3.33, st

# A missing call omits its keys, never a zero; the others stay.
lua = addon(setup="GetParryChance = nil; UnitSpellHaste = nil; GetExpertise = nil")
read(lua)
st = plain(lua)[0]["stats"]
assert not ({"parry", "spellHaste", "expertise"} & set(st)), st
assert st["dodge"] == 4.5 and st["strength"] == 10 and len(st) == len(FULL) - 3, st
lua = addon(setup="GetSpellBonusDamage = nil")
read(lua)
assert "spellPower" not in plain(lua)[0]["stats"]
# One school unreadable: no spell power rather than a wrong minimum.
lua = addon(setup="SPELLDMG[4] = nil")
read(lua)
assert "spellPower" not in plain(lua)[0]["stats"]
# A secret value reads as nil: that key goes, the rest stay.
lua = addon(setup="issecretvalue = function(v) return v == 450 end")
read(lua)
st = plain(lua)[0]["stats"]
assert "healing" not in st and st["spellPower"] == 299, st

# In combat: no read, an earlier row is kept.
lua = addon()
read(lua)
lua.execute("combat = true; ATTR[1] = 99")
read(lua)
assert plain(lua)[0]["stats"]["strength"] == 10
lua.execute("combat = false")
read(lua)
assert plain(lua)[0]["stats"]["strength"] == 99

# Attributes unreadable (secret or not there yet): no row at all, not a row of zeros; fewer than five is none.
lua = addon(setup="issecretvalue = function(v) return v == 400 end")
read(lua)
assert plain(lua) == [], "intellect unreadable: no row"
lua = addon(setup="UnitStat = function() return nil end")
read(lua)
assert plain(lua) == []
lua = addon(setup="UnitStat = function(u, i) if i == 5 then return nil end; return 1, 2, 0, 0 end")
read(lua)
assert plain(lua) == [], "four attributes are not enough"
# A row written earlier stays when a later read is empty.
lua = addon()
read(lua)
lua.execute("UnitStat = function() return nil end")
read(lua)
assert len(plain(lua)) == 1

# Latest state only; a second character keeps its own row and a re-read replaces only its own.
lua = addon()
read(lua)
lua.execute("guid = 'Player-4242-0FEDCBA2'; ATTR[4] = 410")
read(lua)
other = lua.eval("(Everloot.Completion.Identity())")
assert other != key
by = {r["characterKey"]: r for r in plain(lua)}
assert set(by) == {key, other} and by[key]["stats"]["intellect"] == 400 and by[other]["stats"]["intellect"] == 410, by
lua.execute("ATTR[4] = 420")
read(lua)
by = {r["characterKey"]: r for r in plain(lua)}
assert len(by) == 2 and by[other]["stats"]["intellect"] == 420 and by[key]["stats"]["intellect"] == 400, by

# Local only; /everloot completion off deletes the row and stops reading at once.
counts = check_all(lua)
assert "stats_owned" not in counts, counts
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

# No UnitStat at all: the module cannot start, and says so.
lua = addon(setup="UnitStat = nil")
assert "charstats: disabled:" in status(lua) and "UnitStat" in status(lua), status(lua)
read(lua)
assert plain(lua) == []

# The status line names calls that are missing.
lua = addon(setup="GetBlockChance = nil")
assert "missing GetBlockChance" in status(lua), status(lua)

# The module changes nothing in the game and reads no name.
source = (root / "modules" / "charstats.lua").read_text(encoding="utf-8")
code = "\n".join(line.split("--")[0] for line in source.splitlines())
for name in ("UnitName", "GetRealmName", "UnitGUID", "SendChatMessage"):
    assert name not in code, f"charstats.lua must not call {name}"

print("Character sheet stats: keyed like completion, follow its switch, read out of combat, latest state only, missing calls record nothing")
