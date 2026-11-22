"""Run with: uv run --with lupa --with jsonschema python addon/tests/wealth_contract.py

addon/modules/wealth.lua: the logged-in character's lifetime gold statistics (GetStatistic for fifteen Wealth and
auction statistics), one wealth_owned row per character key, latest state only, under the gold switch, and never in an
upload. An unreadable statistic (nil, "--", text it cannot parse, an error, a secret value, anything in combat) is left
out, never written as 0. The money format mocked here is what Blizzard's AchievementUI shows (coin textures); it is not
yet checked in game.
"""
from pathlib import Path

from lupa.lua51 import LuaRuntime

from protocol_schema import LOCAL_ONLY_KINDS, SCHEMA_DIR, check_all, to_plain

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\wealth.lua" in toc, "the module must be in the TOC"
assert toc.index("modules\\wealth.lua") > toc.index("modules\\gold.lua"), "it follows the gold switch, so it loads after gold.lua"

IDS = [328, 333, 326, 921, 919, 334, 331, 332, 1146, 1147, 1148, 1150, 329, 330, 1149]

# Raw string: in the Lua below, \\ is one backslash, as in the game's texture paths.
WORLD = r"""
NOW_T = 1794225600 -- 2026-11-09T12:00:00Z
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

-- Timers run when the test moves the clock.
timers = {}
C_Timer = { After = function(seconds, f) timers[#timers + 1] = { at = NOW_T + seconds, f = f } end }
function advance(seconds)
 NOW_T = NOW_T + seconds
 local ran = true
 while ran do
  ran = false
  for i, t in ipairs(timers) do
   if t.at <= NOW_T then table.remove(timers, i); t.f(); ran = true; break end
  end
 end
end

forbidden = {}
UnitName = function() forbidden[#forbidden + 1] = 'UnitName' end
GetRealmName = function() forbidden[#forbidden + 1] = 'GetRealmName' end
guid = 'Player-4242-0ABCDEF1'
UnitGUID = function(unit) assert(unit == 'player'); return guid end
UnitClass = function() return 'Mage', 'MAGE', 8 end
UnitLevel = function() return 60 end
lockdown = false
InCombatLockdown = function() return lockdown end
SECRET = 'a secret 1150905'
issecretvalue = function(v) return v == SECRET end

MONEY = '115|TInterface\\MoneyFrame\\UI-GoldIcon:0:0:2:0|t 9|TInterface\\MoneyFrame\\UI-SilverIcon:0:0:2:0|t 5|TInterface\\MoneyFrame\\UI-CopperIcon:0:0:2:0|t'
STATS = {
 [328] = MONEY,
 [329] = '1,077',
 [1147] = '--',
 [1150] = function() error('no such statistic') end,
}
asked = {}
GetStatistic = function(id)
 asked[#asked + 1] = id
 local v = STATS[id]
 if type(v) == 'function' then return v() end
 return v
end

function event(name, ...)
 for _, hook in ipairs(Everloot.frame.hooks or {}) do hook(nil, name, ...) end
end
function rows() return EverlootDB.records.wealth_owned or {} end
"""


def addon(gold=True, setup="", options=False):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(setup)
    lua.execute("EverlootDB = { installId = 'test-install-1234', toggles = { gold = %s }, records = {} }" % ("true" if gold else "false"))
    files = ["core.lua", "modules/wealth.lua"] + (["modules/options.lua"] if options else [])
    for file in files:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')")
    return lua


def plain(lua):
    return to_plain(lua.eval("rows()"))


def status(lua):
    return lua.eval("Everloot:Status()")


# --- Parsing: plain counts with any thousands separator, and money as coin textures. ---
lua = addon()
parse = lua.eval("Everloot.Wealth.ParseStatistic")
G = r"|TInterface\\MoneyFrame\\UI-GoldIcon:0:0:2:0|t"
S = r"|TInterface\\MoneyFrame\\UI-SilverIcon:0:0:2:0|t"
C = r"|TInterface\\MoneyFrame\\UI-CopperIcon:0:0:2:0|t"
CASES = [
    ("'791'", 791),
    ("'1,077'", 1077),
    ("'1.077'", 1077),               # a European client
    (r"'1\194\160077'", 1077),       # a no-break space, as French clients print it
    ("'1 077'", 1077),
    ("'1.234.567'", 1234567),
    ("'--'", None),
    ("nil", None),
    ("'abc'", None),
    ("''", None),
    ("791", None),                   # not a string
    ("'-5'", None),
    ("'1.5'", None),                 # a separator splits groups of three, never a fraction
    ("'1,0770'", None),
    ("'12abc'", None),
    (r"'1\194077'", None),           # half a no-break space
    ("'9007199254740991'", 9007199254740991),
    ("'9007199254740992'", None),
    (f"'115{G} 9{S} 5{C}'", 1150905),
    (f"'1,234{G}'", 12340000),
    (f"'50{C}'", 50),
    (f"'1.234{G} 0{S} 7{C}'", 12340007),
    (f"'5{G} 5{G}'", None),          # a unit twice
    (f"'5{G} gold'", None),
    (f"'{G}'", None),
    ("'1 Gold, 20 Silver'", None),
]
for literal, expected in CASES:
    got = lua.eval(f"Everloot.Wealth.ParseStatistic({literal})")
    assert got == expected, f"ParseStatistic({literal}) = {got!r}, expected {expected!r}"
assert lua.eval("Everloot.Wealth.ParseStatistic(SECRET)") is None, "a secret value is unreadable"
assert list(lua.eval("Everloot.Wealth.KINDS").values()) == ["wealth_owned"]

# --- A read: readable statistics only; "--", an error and the unknown ones are left out, never 0. ---
assert "wealth: ready" in status(lua), status(lua)
assert lua.eval("Everloot.Wealth.Read()") is True
got = plain(lua)
key = lua.eval("(Everloot.CharacterKey())")
assert isinstance(key, str) and len(key) == 8, key
assert len(got) == 1, got
row = got[0]
assert row["stats"] == {"328": 1150905, "329": 1077}, row["stats"]
assert {k: row[k] for k in ("characterKey", "class", "level", "installId")} == {
    "characterKey": key, "class": "MAGE", "level": 60, "installId": "test-install-1234"}, row
assert row["capturedAt"] == "2026-11-09T12:00:00Z", row
assert set(row) == {"characterKey", "class", "level", "capturedAt", "installId", "stats", "eventId", "kindLoggedAt"}, sorted(row)
asked = sorted(lua.eval("asked").values())
assert asked == sorted(IDS), f"reads exactly the fifteen statistics: {asked}"

# Only the logged-in character: no name or realm is read, and none is in the row.
assert lua.eval("#forbidden") == 0, list(lua.eval("forbidden").values())
assert not ({"character", "name", "realm", "guid"} & set(row)), row

# A secret value or a number is left out too.
lua.execute("STATS[334] = SECRET; STATS[330] = 12; STATS[333] = '42'")
assert lua.eval("Everloot.Wealth.Read()") is True
assert plain(lua)[0]["stats"] == {"328": 1150905, "329": 1077, "333": 42}, plain(lua)

# Latest state, not history: reads replace this character's row.
lua.execute("Everloot.Wealth.Read(); Everloot.Wealth.Read()")
assert len(plain(lua)) == 1, plain(lua)

# A second character on this install keeps its own row beside the first one's.
lua.execute("guid = 'Player-4242-0FEDCBA2'; STATS = { [328] = '50|TInterface\\\\MoneyFrame\\\\UI-CopperIcon:0:0:2:0|t' }")
assert lua.eval("Everloot.Wealth.Read()") is True
other = lua.eval("(Everloot.CharacterKey())")
assert other != key
got = plain(lua)
assert sorted((r["characterKey"], r["stats"].get("328")) for r in got) == sorted([(key, 1150905), (other, 50)]), got

# Every statistic unreadable: no row, and the character's last row is not replaced by an empty one.
lua.execute("STATS = { [328] = '--', [329] = function() error('x') end }")
assert lua.eval("Everloot.Wealth.Read()") is False
assert len(plain(lua)) == 2 and all(r["stats"] for r in plain(lua)), plain(lua)

lua = addon(setup="STATS = {}")
assert lua.eval("Everloot.Wealth.Read()") is False
assert plain(lua) == [], "nothing readable writes nothing"

# No player id yet: nothing under an empty key.
lua = addon(setup="UnitGUID = function() return nil end")
assert lua.eval("Everloot.Wealth.Read()") is False
assert plain(lua) == []

# --- Combat: nothing is read, and the read waits for the fight to end. ---
lua = addon()
lua.execute("lockdown = true")
assert lua.eval("Everloot.Wealth.Read()") is False
assert plain(lua) == [] and lua.eval("#asked") == 0, "no statistic is read in combat"
lua.execute("lockdown = false; event('PLAYER_REGEN_DISABLED')")
assert lua.eval("Everloot.Wealth.Read()") is False, "between PLAYER_REGEN_DISABLED and ENABLED is combat too"
lua.execute("event('PLAYER_ENTERING_WORLD'); advance(10)")
assert plain(lua) == [], "the login read waits out combat"
lua.execute("advance(15)")
assert plain(lua) == [] and lua.eval("#asked") == 0, "the retry finds the fight still on"
lua.execute("event('PLAYER_REGEN_ENABLED'); advance(15)")
assert len(plain(lua)) == 1, "after the fight and the retry it writes"

# --- Events: login after 10 s, money after 30 s, logout at once. ---
lua = addon()
for name in ("PLAYER_ENTERING_WORLD", "PLAYER_MONEY", "PLAYER_LOGOUT", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED"):
    assert lua.eval(f"registered.{name}") is True, name
lua.execute("event('PLAYER_ENTERING_WORLD'); advance(9)")
assert plain(lua) == []
lua.execute("advance(1)")
assert len(plain(lua)) == 1
lua.execute("asked = {}; event('PLAYER_MONEY'); event('PLAYER_MONEY'); advance(29)")
assert lua.eval("#asked") == 0, "money changes wait 30 s"
lua.execute("advance(1)")
assert lua.eval("#asked") == len(IDS), "and read once"
lua.execute("asked = {}; event('PLAYER_LOGOUT')")
assert lua.eval("#asked") == len(IDS), "logout reads at once"

# --- Gold switch off: no events, no reads, and turning it off deletes the rows. ---
lua = addon(gold=False)
assert "wealth: off by toggle" in status(lua), status(lua)
for name in ("PLAYER_ENTERING_WORLD", "PLAYER_MONEY", "PLAYER_LOGOUT"):
    assert lua.eval(f"registered.{name}") is None, f"{name} is not registered with gold off"
lua.execute("event('PLAYER_ENTERING_WORLD'); event('PLAYER_LOGOUT'); advance(60)")
assert plain(lua) == [] and lua.eval("#asked") == 0

lua = addon(options=True)
lua.execute("Everloot.Wealth.Read(); guid = 'Player-4242-0FEDCBA2'; Everloot.Wealth.Read()")
assert len(plain(lua)) == 2
assert lua.eval("Everloot.Options.ADDED.wealth_owned") == "Your lifetime gold"
lua.execute("for _, r in ipairs(Everloot.Options.ROWS) do if r.key == 'gold' then goldRow = r end end")
assert lua.eval("Everloot.Options.RowsToDelete(goldRow)") == 2, "the gold switch's question counts these rows"
lua.execute("Everloot.Options.Set(goldRow, false)")
assert lua.eval("EverlootDB.toggles.gold") is False
assert lua.eval("EverlootDB.records.wealth_owned") is None, "the gold delete path removes wealth_owned rows"
lua.execute("asked = {}; event('PLAYER_MONEY'); event('PLAYER_LOGOUT'); advance(60)")
assert plain(lua) == [] and lua.eval("#asked") == 0, "off stops reading at once"

# A client without GetStatistic records nothing, and status says why.
lua = addon(setup="GetStatistic = nil")
assert "wealth: disabled: missing GetStatistic" in status(lua), status(lua)
lua.execute("event('PLAYER_LOGOUT')")
assert plain(lua) == []

# --- Local only: no intake schema, and the protocol check leaves the rows to this test. ---
lua = addon()
lua.execute("Everloot.Wealth.Read()")
assert "wealth_owned" in LOCAL_ONLY_KINDS
assert not (SCHEMA_DIR / "records" / "wealth_owned.json").exists(), "wealth_owned stays on the computer; the intake has no schema"
counts = check_all(lua)
assert "wealth_owned" not in counts, counts
assert "rows wealth_owned: 1" in status(lua), status(lua)

# The module reads no name and changes nothing in the game.
source = (root / "modules" / "wealth.lua").read_text(encoding="utf-8")
code = "\n".join(line.split("--")[0] for line in source.splitlines())
for name in ("UnitName", "GetRealmName", "SendChatMessage", "GetMoney", "UnitGUID"):
    assert name not in code, f"wealth.lua must not call {name}"

print("Lifetime gold: fifteen statistics of this character only, unreadable ones left out, separators parsed, "
      "no reads in combat, follows the gold switch, local only")
