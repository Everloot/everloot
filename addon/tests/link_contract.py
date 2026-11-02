"""Run with: uv run --with lupa --with jsonschema python addon/tests/link_contract.py

The link command: `/everloot link <code>` writes one character_link row for the character you are playing, in the
exact shape the link endpoint takes, and nothing else. No row without the command, no event, no other unit read;
a bad code, a missing field or a secret value writes nothing; a new code on the same character replaces its row;
at most 10 rows; `/everloot link clear` deletes them.
"""
import re
from pathlib import Path

from lupa.lua51 import LuaRuntime

from protocol_schema import check_rows, to_plain

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\link.lua" in toc, "the link module must be in the TOC"
assert toc.index("modules\\link.lua") > toc.index("core.lua"), "core loads before the module"
for slot in ("EverlootAnswers", "EverlootPrices", "EverlootBuilds"):
    for path in root.parent.rglob(f"{slot}.toc"):
        assert "link.lua" not in path.read_text(encoding="utf-8"), f"{path} must not load the link module"
source = (root / "modules" / "link.lua").read_text(encoding="utf-8")

# Every game call in the code (comments stripped) is on the module's own list, and the list holds only these.
code = "\n".join(line.split("--")[0] for line in source.splitlines())
called = set(re.findall(r"(?<![\w.:])([A-Z][A-Za-z0-9_]*)\s*\(", code))
ALLOWED = {"UnitGUID", "UnitName", "UnitLevel", "UnitRace", "UnitClass", "UnitFactionGroup", "GetRealmName"}
assert called <= ALLOWED, f"link.lua calls {sorted(called - ALLOWED)}, which are not on its list"
declared = set(re.search(r"L\.API = \{([^}]*)\}", source).group(1).replace('"', "").replace(" ", "").split(","))
assert declared == ALLOWED, f"L.API lists {sorted(declared)}"
# Only your own character: every unit call names "player".
for call in re.findall(r"\bUnit[A-Za-z]+\(([^)]*)\)", code):
    assert call.strip() == '"player"', f"link.lua reads unit {call!r}; only \"player\" is allowed"
# It listens to nothing and stores through nothing shared: the row exists only after the command.
for name in ("RegisterEvent", "HookScript", "SetScript", "RegisterModule", "E:Store"):
    assert name not in code, f"link.lua uses {name}"

WORLD = """
NOW_T = 1792281600 -- 2026-10-18T00:00:00Z
time = function() return NOW_T end
date = function(format, t) return os.date(format, t or NOW_T) end
printed = {}
print = function(...) printed[#printed + 1] = table.concat({ ... }, ' ') end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
SECRET = {}
issecretvalue = function(v) return v ~= nil and SECRET[v] == true end

me = { guid = 'Player-4395-0A1B2C3D', name = 'Thrallina', race = 'Orc', class = 'SHAMAN', level = 24, faction = 'Horde' }
realm = 'Forever Pioneer'
asked = {}
local function note(unit) asked[#asked + 1] = unit end
UnitGUID = function(unit) note(unit); return me.guid end
UnitName = function(unit) note(unit); return me.name end
UnitLevel = function(unit) note(unit); return me.level end
UnitRace = function(unit) note(unit); return 'Display', me.race, 2 end
UnitClass = function(unit) note(unit); return 'Display', me.class, 7 end
UnitFactionGroup = function(unit) note(unit); return me.faction, me.faction end
GetRealmName = function() return realm end
"""


def fresh(saved="{ installId = 'abcd-1234', toggles = {}, records = {}, censusNotice = true }", files=("core.lua", "modules/completion.lua", "modules/link.lua")):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(f"EverlootDB = {saved}")
    for file in files:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("""
Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')
function rows() return EverlootDB.records.character_link or {} end
function link(arg) SlashCmdList.EVERLOOT('link ' .. arg) end
""")
    return lua


def check(lua):
    rows = to_plain(lua.eval("EverlootDB.records.character_link")) or []
    check_rows("character_link", rows, lua.eval("EverlootDB.installId"))
    return rows


# --- Loading writes nothing and reads nothing ---
lua = fresh()
lua.execute("""
assert(#rows() == 0, 'no row without the command')
assert(#asked == 0, 'loading reads nothing about the character')
assert(not string.find(Everloot:LoginLine(), 'link', 1, true), 'the link command is no module: it is not counted at login')
""")

# --- The command: one row, in the endpoint's shape, the code in upper case ---
lua.execute("""
link('el-7k3q-9p')
local r = rows()[1]
assert(#rows() == 1, 'one row')
assert(r.code == 'EL-7K3Q-9P', 'the code in upper case, got ' .. tostring(r.code))
assert(r.name == 'Thrallina' and r.realm == 'Forever Pioneer' and r.race == 'Orc' and r.class == 'SHAMAN' and r.level == 24 and r.faction == 'Horde')
assert(r.guid == me.guid and r.installId == 'abcd-1234' and r.capturedAt == '2026-10-18T00:00:00Z' and r.eventId == 'character_link:1', tostring(r.eventId))
-- The completion module's own key for this character, so its rows can be joined later.
assert(r.completionKey == Everloot.Completion.Identity(), 'completionKey ' .. tostring(r.completionKey) .. ' is not the completion key')
local said = printed[#printed]
assert(string.find(said, 'Thrallina of Forever Pioneer', 1, true) and string.find(said, '/reload', 1, true) and string.find(said, 'Desktop App', 1, true), said)
assert(not string.find(said:lower(), 'verified', 1, true), 'a link is never called verified')
for _, unit in ipairs(asked) do assert(unit == 'player', 'only your own character is read, not ' .. tostring(unit)) end
""")
rows = check(lua)
assert set(rows[0]) == {"installId", "eventId", "capturedAt", "code", "name", "realm", "race", "class", "level", "faction", "guid", "completionKey"}, sorted(rows[0])

# --- A new code on the same character replaces its row; another character adds one; 10 at most ---
lua.execute("""
NOW_T = NOW_T + 60
link('EL-AAAA-02')
assert(#rows() == 1 and rows()[1].code == 'EL-AAAA-02' and rows()[1].eventId == 'character_link:2', 'the newest code replaces the row')
for i = 1, 12 do
 me = { guid = string.format('Player-4395-%08X', i), name = 'Alt' .. string.rep('a', i % 5), race = 'Human', class = 'MAGE', level = i, faction = 'Alliance' }
 link(string.format('EL-AAAA-%02d', i))
end
assert(#rows() == 10, 'at most 10 rows, got ' .. #rows())
assert(rows()[1].guid == 'Player-4395-00000003' and rows()[10].guid == 'Player-4395-0000000C', 'the oldest go first')
local ids = {}
for _, r in ipairs(rows()) do assert(not ids[r.eventId], 'event ids are unique'); ids[r.eventId] = true end
""")
check(lua)

# --- Nothing is written for a bad code, a missing field, a faction-less character or a secret value ---
lua = fresh()
lua.execute("""
local function refused(arg, why)
 local before = #printed
 link(arg)
 assert(#rows() == 0, 'no row for ' .. tostring(arg))
 assert(#printed == before + 1 and string.find(printed[#printed], 'not linked', 1, true), printed[#printed])
 if why then assert(string.find(printed[#printed], why, 1, true), printed[#printed]) end
end
-- Outside the alphabet (I, L, O, U), the wrong shape or no code at all.
for _, bad in ipairs({ 'EL-7K3O-9P', 'EL-7K3I-9P', 'EL-7K3L-9P', 'EL-7K3U-9P', 'EL-7K3Q-9', 'EL-7K3Q9P', 'XX-7K3Q-9P', 'EL-7K3Q-9P-1', 'hello' }) do
 refused(bad, 'not a link code')
end
me.faction = 'Neutral'; refused('EL-7K3Q-9P', 'Alliance or Horde'); me.faction = 'Horde'
me.level = 0; refused('EL-7K3Q-9P', 'level'); me.level = 24
me.guid = 'Creature-0-1-2-3-4-5'; refused('EL-7K3Q-9P', 'id'); me.guid = 'Player-4395-0A1B2C3D'
me.name = 'Thrall1'; refused('EL-7K3Q-9P', 'name'); me.name = 'Thrallina'
realm = ''; refused('EL-7K3Q-9P', 'realm'); realm = 'Forever Pioneer'
-- A value the game hands over but the addon may not read counts as missing.
local secret = 'Player-4395-SECRET00'
SECRET[secret] = true
me.guid = secret; refused('EL-7K3Q-9P', 'id'); me.guid = 'Player-4395-0A1B2C3D'
SECRET[me.name] = true; refused('EL-7K3Q-9P', 'name'); SECRET[me.name] = nil
assert(EverlootDB.linkNext == nil, 'a refusal takes no event id')
""")

# --- /everloot link says how to use it; clear deletes every row ---
lua.execute("""
link('EL-7K3Q-9P')
SlashCmdList.EVERLOOT('link')
local said = printed[#printed]
assert(string.find(said, '/everloot link <code>', 1, true) and string.find(said, '1 link row', 1, true) and string.find(said, 'everloot.app/account', 1, true), said)
SlashCmdList.EVERLOOT('  LINK   clear ')
assert(EverlootDB.records.character_link == nil, 'clear deletes the rows')
assert(string.find(printed[#printed], 'deleted', 1, true), printed[#printed])
SlashCmdList.EVERLOOT('linkx')
assert(string.find(printed[#printed], 'Everloot commands', 1, true), 'a word that only starts with link is not the command')
assert(string.find(printed[#printed], '/everloot link', 1, true), 'the help lists the command')
assert(string.find(Everloot:Status(), 'rows character_link: 0', 1, true), 'status counts link rows')
""")

# --- Without the completion module loaded the key is the same ---
lua = fresh(files=("core.lua", "modules/link.lua"))
lua.execute("link('EL-7K3Q-9P')")
alone = check(lua)[0]["completionKey"]
lua = fresh()
lua.execute("link('EL-7K3Q-9P')")
assert check(lua)[0]["completionKey"] == alone, "the key does not depend on the completion module being loaded"

print("Lua 5.1 link: /everloot link writes one protocol character_link row for your own character, and nothing else")
