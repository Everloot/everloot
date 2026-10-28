"""Run with: uv run --with lupa --with jsonschema python addon/tests/census_contract.py

The census module: off by default, one row per player per UTC day with the latest level, 2,000 rows per
kind with the oldest days dropped first, and nothing read about another player beyond race, class,
level and faction. The rows are checked in the exact shape the upload sends.
"""
import json
import re
from pathlib import Path

from jsonschema import Draft202012Validator
from lupa.lua51 import LuaRuntime

from protocol_schema import SCHEMA_DIR, check_rows, to_plain

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\census.lua" in toc, "the census module must be in the TOC"
assert toc.index("modules\\census.lua") > toc.index("core.lua"), "core loads before the module"
source = (root / "modules" / "census.lua").read_text(encoding="utf-8")

# --- Nothing in the file can read another player's name, guild, gear or position ---
# Scanned over the whole file, comments included, so the names cannot creep in anywhere.
FORBIDDEN = [
    # names
    "UnitName", "UnitFullName", "GetUnitName", "UnitPVPName", "GetPlayerInfoByGUID", "C_PlayerInfo", "Ambiguate",
    # guild
    "GetGuildInfo", "IsInGuild", "GetGuildRosterInfo", "C_GuildInfo", "C_Club",
    # gear and inspection
    "GetInventoryItemLink", "GetInventoryItemID", "GetInventoryItemQuality", "GetInventorySlotInfo",
    "GetAverageItemLevel", "C_PaperDollInfo", "NotifyInspect", "CanInspect", "GetInspectSpecialization", "C_Item",
    # position
    "C_Map", "UnitPosition", "GetPlayerMapPosition", "GetBestMapForUnit", "GetZoneText", "GetRealZoneText",
    "GetSubZoneText", "GetMinimapZoneText", "CheckInteractDistance", "UnitDistanceSquared", "UnitInRange",
]
for name in FORBIDDEN:
    assert not re.search(r"\b" + re.escape(name) + r"\b", source), f"census.lua names {name}"

# Every game call in the code (comments stripped) is on the module's own list, and the list holds only these.
code = "\n".join(line.split("--")[0] for line in source.splitlines())
called = set(re.findall(r"(?<![\w.:])([A-Z][A-Za-z0-9_]*)\s*\(", code))
ALLOWED = {"UnitIsPlayer", "UnitGUID", "UnitLevel", "UnitRace", "UnitClass", "UnitFactionGroup", "GetRealmName", "IsInRaid"}
assert called <= ALLOWED, f"census.lua calls {sorted(called - ALLOWED)}, which are not on the census list"
declared = set(re.search(r"C\.API = \{([^}]*)\}", source).group(1).replace('"', "").replace(" ", "").split(","))
assert declared == ALLOWED, f"C.API lists {sorted(declared)}"

WORLD = """
NOW_T = 1792281600 -- 2026-10-18T00:00:00Z
time = function() return NOW_T end
date = function(format, t) return os.date(format, t or NOW_T) end
printed = {}
print = function(...) printed[#printed + 1] = table.concat({ ... }, ' ') end
SlashCmdList = {}
registered = {}
CreateFrame = function() return {
 RegisterEvent=function(_, name) registered[name] = (registered[name] or 0) + 1 end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end

-- Units by token. A forbidden call is counted, never answered.
units = {}
me = { guid = 'Player-4242-00AABBCC', player = true, race = 'Skyborne', raceName = 'Skyborne', raceId = 70, class = 'HUNTER', level = 12, faction = 'Alliance' }
units.player = me
realm = 'Forever Pioneer'
inRaid = false
forbidden = 0
UnitIsPlayer = function(unit) local u = units[unit]; return u ~= nil and u.player == true end
UnitGUID = function(unit) local u = units[unit]; return u and u.guid end
UnitLevel = function(unit) local u = units[unit]; return u and u.level end
UnitRace = function(unit) local u = units[unit]; if u then return u.raceName, u.race, u.raceId end end
UnitClass = function(unit) local u = units[unit]; if u then return 'Display', u.class, 3 end end
UnitFactionGroup = function(unit) local u = units[unit]; if u then return u.faction, u.faction end end
GetRealmName = function() return realm end
IsInRaid = function() return inRaid end
for _, name in ipairs({ 'UnitName', 'GetUnitName', 'UnitFullName', 'GetGuildInfo', 'GetInventoryItemLink', 'UnitPosition', 'GetPlayerInfoByGUID' }) do
 _G[name] = function() forbidden = forbidden + 1 end
end

function player(n, fields)
 local u = { guid = string.format('Player-4242-%08X', n), player = true, race = 'Orc', raceName = 'Orc', class = 'WARRIOR', level = 20, faction = 'Horde' }
 for k, v in pairs(fields or {}) do u[k] = v end
 return u
end
"""


def lua_literal(value):
    """A plain value as a Lua table constructor, the way the game writes SavedVariables back."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    if isinstance(value, list):
        return "{" + ", ".join(lua_literal(v) for v in value) + "}"
    return "{" + ", ".join(f"[{lua_literal(k)}] = {lua_literal(v)}" for k, v in value.items()) + "}"


def fresh(saved: str = "nil", extra: str = "", files=("core.lua", "modules/census.lua")):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(extra)
    lua.execute(f"EverlootDB = {saved}")
    for file in files:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("""
Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')
function event(name, arg) for _, hook in ipairs(Everloot.frame.hooks or {}) do hook(nil, name, arg) end end
function reload() Everloot.frame.hooks = nil; registered = {}; Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot'); event('PLAYER_LOGIN') end
function rows(kind) return EverlootDB.records[kind] or {} end
""")
    return lua


# --- A new install: on, and it says so once ---
lua = fresh()
lua.execute("""
assert(EverlootDB.toggles.census == true, 'a new install starts with the census on')
local told = 0
for _, line in ipairs(printed) do if string.find(line, 'census on', 1, true) and string.find(line, 'Never their names', 1, true) and string.find(line, 'census off', 1, true) then told = told + 1 end end
assert(told == 1, 'a new install is told once about the census')
assert(EverlootDB.censusNotice == true, 'the notice is remembered')
local before = #printed
reload()
for i = before + 1, #printed do assert(not string.find(printed[i], 'Never their names', 1, true), 'the notice is not repeated') end
""")

# --- Off: nothing registered, nothing recorded ---
lua = fresh("{ installId = 'abcd-1234', toggles = { census = false }, records = {} }")
lua.execute("""
assert(EverlootDB.toggles.census == false, 'the census is off when the player turned it off')
for _, line in ipairs(printed) do assert(not string.find(line, 'Never their names', 1, true), 'off prints no notice') end
for _, name in ipairs({ 'PLAYER_TARGET_CHANGED', 'UPDATE_MOUSEOVER_UNIT', 'GROUP_ROSTER_UPDATE', 'PLAYER_LOGIN', 'PLAYER_LEVEL_UP' }) do
 assert(registered[name] == nil, 'off registers nothing: ' .. name)
end
assert(Everloot.frame.hooks == nil, 'off adds no event handler')
units.target = player(1); units.mouseover = player(2); units.party1 = player(3)
event('PLAYER_LOGIN'); event('PLAYER_TARGET_CHANGED'); event('UPDATE_MOUSEOVER_UNIT'); event('GROUP_ROSTER_UPDATE')
assert(#rows('census_self') == 0 and #rows('census_seen') == 0, 'nothing is recorded while the census is off')
assert(string.find(Everloot:Status(), 'census: off by toggle', 1, true), 'status shows the census is off')
SlashCmdList.EVERLOOT('census')
assert(string.find(printed[#printed], 'census: off', 1, true), 'the status line says off')
""")

# An install from before the census keeps it off.
lua = fresh("{ installId = 'abcd-1234', toggles = { openworld = true, completion = true }, records = {} }")
lua.execute("assert(EverlootDB.toggles.census == false and EverlootDB.toggles.completion == true, 'an upgraded install starts with the census off')")

# --- On: your own character and the players you see ---
lua = fresh("{ installId = 'abcd-1234', toggles = { census = false }, records = {} }")
lua.execute("""
SlashCmdList.EVERLOOT('census on')
assert(EverlootDB.toggles.census == true, '/everloot census on turns it on')
local said = printed[#printed]
assert(string.find(said, 'race, class, level and faction', 1, true) and string.find(said, 'upload page', 1, true) and string.find(said, 'Never their names', 1, true), said)
reload()
assert(registered.PLAYER_TARGET_CHANGED and registered.UPDATE_MOUSEOVER_UNIT and registered.GROUP_ROSTER_UPDATE and registered.PLAYER_LEVEL_UP)
assert(string.find(Everloot:Status(), 'census: ready', 1, true), Everloot:Status())

local own = rows('census_self')
assert(#own == 1, 'login records your character')
local r = own[1]
assert(r.guid == me.guid and r.race == 'Skyborne' and r.class == 'HUNTER' and r.level == 12 and r.faction == 'Alliance' and r.realm == 'Forever Pioneer', 'self row')
assert(r.installId == EverlootDB.installId and r.capturedAt == '2026-10-18T00:00:00Z' and r.eventId == 'census_self:2026-10-18:1', tostring(r.eventId))

-- Level-up passes the new level before UnitLevel has it; the same row takes it.
NOW_T = NOW_T + 60
event('PLAYER_LEVEL_UP', 13)
assert(#own == 1 and own[1].level == 13 and own[1].capturedAt == '2026-10-18T00:01:00Z', 'level-up updates today\\'s row')
-- A new level is a new revision of that day's row: the uploader skips every event id it already confirmed, so
-- the row needs an id of its own or the new level would never be sent. The server keys the row by character
-- and day, so the new id replaces the day's row and does not add one.
assert(own[1].eventId == 'census_self:2026-10-18:2', 'a level-up takes the next event id, got ' .. tostring(own[1].eventId))
event('PLAYER_LEVEL_UP', 13)
assert(own[1].eventId == 'census_self:2026-10-18:2', 'the same level keeps the revision')

units.target = player(1, { level = 30 })
event('PLAYER_TARGET_CHANGED')
units.mouseover = player(2, { race = 'Scourge', class = 'PRIEST' })
event('UPDATE_MOUSEOVER_UNIT')
units.party1 = player(3, { faction = 'Alliance', race = 'Human' }); units.party2 = player(4)
event('GROUP_ROSTER_UPDATE')
local seen = rows('census_seen')
assert(#seen == 4, 'target, mouseover and two party members; got ' .. #seen)
assert(seen[1].via == 'target' and seen[1].level == 30 and seen[1].eventId == 'census_seen:2026-10-18:1')
assert(seen[2].via == 'mouseover' and seen[2].race == 'Scourge' and seen[2].class == 'PRIEST')
assert(seen[3].via == 'group' and seen[3].faction == 'Alliance' and seen[4].via == 'group')

-- A raid reads raid1..raid40, and you are in it: you are not "seen".
inRaid = true
units.raid1 = me; units.raid2 = player(5)
event('GROUP_ROSTER_UPDATE')
assert(#seen == 5 and seen[5].guid == player(5).guid, 'raid members are seen, you are not')

-- Skipped: creatures, yourself, hidden levels, past the cap, missing fields, a non-Player GUID.
local before = #seen
for _, u in ipairs({
 { guid = 'Creature-0-4242-0-1-299-00000ABCDE', player = false, race = 'Orc', class = 'WARRIOR', level = 5, faction = 'Horde' },
 player(9, { player = false }),
 me,
 player(10, { level = -1 }), player(11, { level = 0 }), player(12, { level = 61 }),
 player(13, { race = false }), player(14, { class = '' }), player(15, { faction = 'Neutral' }), player(16, { faction = false }),
 player(17, { guid = 'Pet-0-4242-0-1-1-0102030405' }), player(18, { guid = 'Player-4242-00abcdef' }),
 player(19, { class = 'Warrior' }), player(20, { class = 'XY' }), player(21, { class = 'ABCDEFGHIJKLMNOPQ' }),
 player(22, { race = 'X' }), player(23, { race = 'Night Elf' }),
}) do
 units.mouseover = u
 event('UPDATE_MOUSEOVER_UNIT')
end
assert(#seen == before, 'none of those is a row; got ' .. (#seen - before))
assert(forbidden == 0, 'no name, guild, gear or position call was made')
""")

# --- One row per player per UTC day, with the latest level and way seen ---
lua.execute("""
local seen = rows('census_seen')
local count = #seen
units.mouseover = player(1, { level = 30 })
for _ = 1, 500 do NOW_T = NOW_T + 1; event('UPDATE_MOUSEOVER_UNIT') end
assert(#seen == count, 'the same player all day is one row')
assert(seen[1].via == 'target' and seen[1].level == 30 and seen[1].capturedAt == '2026-10-18T00:01:00Z', 'same level: the row keeps its first way seen and time')
-- Seen again another way at the same level: the row is exactly as it was.
local snapshot = {}
for k, v in pairs(seen[1]) do snapshot[k] = v end
units.party1 = player(1, { level = 30 }); inRaid = false
event('GROUP_ROSTER_UPDATE')
for k, v in pairs(seen[1]) do assert(snapshot[k] == v, 'a different via changed ' .. k) end
for k in pairs(snapshot) do assert(seen[1][k] ~= nil, 'a different via removed ' .. k) end
assert(#seen == count, 'and adds no row')

NOW_T = 1792281600 + 3660
units.target = player(1, { level = 31 })
event('PLAYER_TARGET_CHANGED')
assert(#seen == count and seen[1].level == 31 and seen[1].via == 'target' and seen[1].capturedAt == '2026-10-18T01:01:00Z', 'a new level updates level and time only')
assert(seen[1].eventId == 'census_seen:2026-10-18:6', 'a new level is a new revision (five rows came before it), got ' .. tostring(seen[1].eventId))
units.target = player(1, { level = 31 })
event('PLAYER_TARGET_CHANGED')
assert(seen[1].eventId == 'census_seen:2026-10-18:6', 'the same level keeps the revision')
""")

# A reload the same day (a new Lua state from the saved file) finds today's rows again.
count = len(to_plain(lua.globals().EverlootDB.records.census_seen))
lua = fresh(lua_literal(to_plain(lua.globals().EverlootDB)), f"NOW_T = {1792281600 + 3660}; me.level = 13")
lua.execute(f"""
local count = {count}
units.mouseover = player(1, {{ level = 31 }})
event('UPDATE_MOUSEOVER_UNIT')
units.target = player(2, {{ race = 'Scourge', class = 'PRIEST', level = 25 }})
event('PLAYER_TARGET_CHANGED')
assert(#rows('census_seen') == count and #rows('census_self') == 1, 'a reload adds no duplicates')
assert(rows('census_self')[1].capturedAt == '2026-10-18T00:01:00Z' and rows('census_self')[1].level == 13, 'logging in again at the same level leaves your row as it was')
assert(rows('census_seen')[2].level == 25 and rows('census_seen')[2].via == 'mouseover', 'and still takes a new level, keeping the first via')
assert(rows('census_self')[1].eventId == 'census_self:2026-10-18:2', 'and an unchanged row keeps its revision after a reload')
assert(rows('census_seen')[2].eventId == 'census_seen:2026-10-18:7', 'a new level after a reload takes the next id from the saved counter, got ' .. tostring(rows('census_seen')[2].eventId))

-- The next UTC day is a new row, with a new id.
NOW_T = 1792281600 + 86400 + 5
event('UPDATE_MOUSEOVER_UNIT')
event('PLAYER_LOGIN')
local seen = rows('census_seen')
assert(#seen == count + 1 and seen[#seen].capturedAt == '2026-10-19T00:00:05Z', 'a new day, a new row')
assert(seen[#seen].eventId == 'census_seen:2026-10-19:8', seen[#seen].eventId)
assert(#rows('census_self') == 2 and rows('census_self')[2].eventId == 'census_self:2026-10-19:3', rows('census_self')[2].eventId)
""")

# --- The busy path allocates nothing when the player is already recorded at that level ---
lua.execute("""
units.mouseover = player(1, { level = 31 })
event('UPDATE_MOUSEOVER_UNIT')
local hooks = Everloot.frame.hooks
collectgarbage('collect'); collectgarbage('stop')
local before = collectgarbage('count')
for _ = 1, 20000 do NOW_T = NOW_T + 1; hooks[1](nil, 'UPDATE_MOUSEOVER_UNIT') end
local grew = collectgarbage('count') - before
collectgarbage('restart')
assert(grew < 1, 'mouseover over a recorded player allocated ' .. grew .. ' KB over 20000 events')
""")

# --- Field sets and the record each row becomes on upload ---
lua.execute("""
NOW_T = 1792281600 + 86400 + 5
units.target = player(40, { level = 60, race = 'NightElf', class = 'DRUID', faction = 'Alliance' })
event('PLAYER_TARGET_CHANGED')
""")
SELF_FIELDS = {"installId", "eventId", "capturedAt", "guid", "race", "class", "level", "faction", "realm"}
SEEN_FIELDS = {"installId", "eventId", "capturedAt", "guid", "race", "class", "level", "faction", "via"}
db = lua.globals().EverlootDB
install_id = db.installId


def wire(kind, extra):
    """The census wire shape the intake is built to, field for field."""
    common = {
        "installId": {"type": "string", "minLength": 8, "maxLength": 64},
        "eventId": {"type": "string", "pattern": f"^{kind}:[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}:[0-9]+$", "maxLength": 96},
        "capturedAt": {"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"},
        "kind": {"const": kind},
        "guid": {"type": "string", "pattern": r"^Player-\d+-[0-9A-F]+$"},
        "race": {"type": "string", "pattern": "^[A-Za-z]{2,24}$"},
        "class": {"type": "string", "pattern": "^[A-Z]{3,16}$"},
        "level": {"type": "integer", "minimum": 1, "maximum": 60},
        "faction": {"enum": ["Alliance", "Horde"]},
    }
    props = {**common, **extra}
    return Draft202012Validator({"type": "object", "properties": props, "required": sorted(props), "additionalProperties": False})


SELF_WIRE = wire("census_self", {"realm": {"type": "string", "minLength": 2, "maxLength": 40}})
SEEN_WIRE = wire("census_seen", {"via": {"enum": ["target", "mouseover", "group"]}})


def uploaded(kind):
    """Rows as web/src/lib/sv-parse.ts turns them into records: `{kind, installId, ...row}`."""
    return [{"kind": kind, "installId": install_id, **row} for row in to_plain(db.records[kind])]


self_records, seen_records = uploaded("census_self"), uploaded("census_seen")
assert len(self_records) == 2 and len(seen_records) >= 6
for record in self_records:
    assert set(record) - {"kind"} == SELF_FIELDS, f"self fields: {sorted(record)}"
    SELF_WIRE.validate(record)
for record in seen_records:
    assert set(record) - {"kind"} == SEEN_FIELDS, f"seen fields: {sorted(record)}"
    SEEN_WIRE.validate(record)
ids = [r["eventId"] for r in self_records + seen_records]
assert len(ids) == len(set(ids)), "event ids are unique"
for record in self_records + seen_records:
    assert re.fullmatch(r"[A-Za-z0-9:_-]+", record["eventId"]), record["eventId"]
    hex_part = record["guid"].rsplit("-", 1)[1]
    assert hex_part not in record["eventId"] and "Player" not in record["eventId"], "no GUID material in the event id"
assert seen_records[-1] == {
    "kind": "census_seen", "installId": install_id, "eventId": seen_records[-1]["eventId"], "capturedAt": "2026-10-19T00:00:05Z",
    "guid": "Player-4242-00000028", "race": "NightElf", "class": "DRUID", "level": 60, "faction": "Alliance", "via": "target",
}, seen_records[-1]
assert json.loads(json.dumps(self_records[0])) == self_records[0], "plain JSON values only"
# Once the protocol has the census kinds (the intake pull request), the rows are checked against them too.
for kind, records in (("census_self", self_records), ("census_seen", seen_records)):
    if (SCHEMA_DIR / "records" / f"{kind}.json").exists():
        check_rows(kind, [{k: v for k, v in r.items() if k not in ("kind", "installId")} for r in records], install_id)

# --- Off deletes every census row and stops reading at once ---
lua.execute("""
EverlootDB.paused = { census_seen = true, loot = true }
SlashCmdList.EVERLOOT('census off')
assert(EverlootDB.toggles.census == false and #rows('census_seen') == 0 and #rows('census_self') == 0, 'off deletes the census rows')
assert(EverlootDB.paused.census_seen == nil and EverlootDB.paused.loot == true, 'off clears the census pause only')
assert(string.find(printed[#printed], 'deleted', 1, true))
units.mouseover = player(50)
event('UPDATE_MOUSEOVER_UNIT'); event('PLAYER_LOGIN')
assert(#rows('census_seen') == 0 and #rows('census_self') == 0, 'nothing is read after off, before any reload')
SlashCmdList.EVERLOOT('census on')
SlashCmdList.EVERLOOT('census')
assert(string.find(printed[#printed], 'on after /reload', 1, true), printed[#printed])
reload()
SlashCmdList.EVERLOOT('census')
assert(string.find(printed[#printed], 'census: on. 0 rows of players you saw, 1 of your own', 1, true), printed[#printed])
assert(EverlootDB.records.census_self[1].eventId ~= 'census_self:2026-10-19:2', 'ids are not reused after off')
""")

# --- 2,000 rows per kind: over the cap, the oldest days go first ---
lua = fresh("{ installId = 'abcd-1234', toggles = { census = true }, records = {} }")
lua.execute("""
event('PLAYER_LOGIN')
local function sweep(from, to)
 for i = from, to do units.mouseover = player(i); event('UPDATE_MOUSEOVER_UNIT') end
end
sweep(1, 1200)
NOW_T = NOW_T + 86400
sweep(1, 1200)
local seen = rows('census_seen')
assert(#seen == 2000, 'capped at 2000; got ' .. #seen)
local day1, day2 = 0, 0
for _, r in ipairs(seen) do
 if r.capturedAt:sub(1, 10) == '2026-10-18' then day1 = day1 + 1 else day2 = day2 + 1 end
end
assert(day2 == 1200 and day1 == 800, 'the newest day is whole, the oldest gave way: ' .. day1 .. ' / ' .. day2)
assert(seen[1].guid == player(401).guid, 'the first rows of the oldest day went first')
-- The rows that remain are still found: no duplicates for today's players.
sweep(1, 1200)
assert(#rows('census_seen') == 2000)
-- Today alone past the cap: today's earliest rows give way, the file stays at 2000.
NOW_T = NOW_T + 86400
sweep(1, 2100)
seen = rows('census_seen')
assert(#seen == 2000 and seen[1].guid == player(101).guid and seen[2000].guid == player(2100).guid)
-- A player whose row gave way today is a new row when seen again.
sweep(1, 1)
assert(#seen == 2000 and seen[2000].guid == player(1).guid and seen[1].guid == player(102).guid)
assert(EverlootDB.paused == nil or EverlootDB.paused.census_seen == nil, 'the census rotates instead of pausing')
""")

# --- A client without one of the calls disables the module instead of raising ---
lua = fresh("{ installId = 'abcd-1234', toggles = { census = true }, records = {} }", "UnitRace = nil")
lua.execute("""
event('PLAYER_LOGIN')
assert(#rows('census_self') == 0)
assert(string.find(Everloot:Status(), 'census: disabled: UnitRace unavailable', 1, true), Everloot:Status())
""")

# --- /everloot selftest prints your race token, which the census stores ---
lua = fresh(files=("core.lua", "modules/talents.lua", "modules/selftest.lua", "modules/census.lua"))
lua.execute("""
SlashCmdList.EVERLOOT('selftest')
local text = table.concat(EverlootDB.selftest.results, '\\n')
assert(string.find(text, 'INFO player race: token Skyborne, name Skyborne, id 70, faction Alliance', 1, true), text)
assert(string.find(table.concat(printed, '\\n'), 'token Skyborne', 1, true), 'the line is printed to chat')
""")
lua = fresh(files=("core.lua", "modules/talents.lua", "modules/selftest.lua"), extra="UnitRace = nil")
lua.execute("""
SlashCmdList.EVERLOOT('selftest')
assert(string.find(table.concat(EverlootDB.selftest.results, '\\n'), 'INFO player race: UnitRace gave nothing', 1, true))
""")

print("Lua 5.1 census: off by default, no name/guild/gear/position calls, self and seen rows in the upload shape, "
      "one row per player per UTC day with the latest level, no allocation on a repeat mouseover, 2000 cap drops the oldest days, off deletes")
