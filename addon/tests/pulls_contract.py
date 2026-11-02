"""Run with: uv run --with lupa --with jsonschema python addon/tests/pulls_contract.py

Pull timing, instance runs and pull summaries (docs/design/specs/2026-11-02-pull-and-run-records-design.md).

- openworld.lua (anonymous, on by default): ENCOUNTER_START gives the encounter row its start and length; a run is
  zoning in to leaving for 30 minutes, another instance or a reset, and a run with boss pulls is one instance_run row.
- pulls.lua (named, on by default, said once per install): after each boss pull, once combat ends, one pull_summary
  row with each group member's name, class, role and the game damage meter's totals. It never registers a combat log
  event, reads the meter only out of combat, leaves out what the client hides, matches a meter line to a member by
  GUID whenever the GUID is readable, and /everloot pulls off deletes its rows.
- Both wait on E.RUN_RECORDS in core.lua. Off (every build until the release that ships them, nightlies included),
  encounter rows are written as before and nothing new is registered, recorded or offered.

Every row is checked in the shape the upload sends, against the protocol's JSON Schema.
"""
import json
import re
from pathlib import Path

from lupa.lua51 import LuaRuntime

from gate_off_snapshot import snapshot
from protocol_schema import check_all

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\pulls.lua" in toc, "the pulls module must be in the TOC"
assert toc.index("modules\\pulls.lua") > toc.index("modules\\openworld.lua"), "openworld loads first, so its run id is current"
source = (root / "modules" / "pulls.lua").read_text(encoding="utf-8")
core = (root / "core.lua").read_text(encoding="utf-8")
assert re.search(r"^E\.RUN_RECORDS = (true|false)$", core, re.M), "core.lua sets E.RUN_RECORDS to a plain true or false"
openworld = (root / "modules" / "openworld.lua").read_text(encoding="utf-8")

# --- Neither file listens to the combat log: Forever restricts it, and Everloot must not register it ---
for text, name in ((source, "pulls.lua"), (openworld, "openworld.lua")):
    code = "\n".join(line.split("--")[0] for line in text.splitlines())
    for banned in ("COMBAT_LOG_EVENT", "CombatLogGetCurrentEventInfo", "LoggingCombat"):
        assert banned not in code, f"{name} names {banned}"

# --- pulls.lua reads nothing about a player beyond name, realm, class and role ---
FORBIDDEN = [
    "UnitFullName", "GetUnitName", "UnitPVPName", "GetPlayerInfoByGUID", "C_PlayerInfo",
    "GetGuildInfo", "GetGuildRosterInfo", "C_GuildInfo", "C_Club",
    "GetInventoryItemLink", "GetInventoryItemID", "GetAverageItemLevel", "NotifyInspect", "CanInspect", "C_Traits",
    "C_Map", "UnitPosition", "GetPlayerMapPosition", "GetZoneText",
    "SendChatMessage", "C_ChatInfo", "C_FriendList",
]
for name in FORBIDDEN:
    assert not re.search(r"\b" + re.escape(name) + r"\b", source), f"pulls.lua names {name}"
code = "\n".join(line.split("--")[0] for line in source.splitlines())
called = set(re.findall(r"(?<![\w.:])([A-Z][A-Za-z0-9_]*)\s*\(", code))
ALLOWED = {"UnitGUID", "UnitName", "UnitClass", "UnitGroupRolesAssigned", "GetRealmName", "GetInstanceInfo", "IsInRaid",
           "InCombatLockdown", "UnitAffectingCombat"}
assert called <= ALLOWED, f"pulls.lua calls {sorted(called - ALLOWED)}"
declared = set(re.search(r"PL\.API = \{([^}]*)\}", source).group(1).replace('"', "").replace(" ", "").replace("\n", "").split(","))
assert declared == ALLOWED, f"PL.API lists {sorted(declared)}"
tables = set(re.findall(r"\b(C_[A-Za-z]+)\b", code))
assert tables == {"C_DamageMeter"}, f"pulls.lua reads {sorted(tables)}"

WORLD = """
NOW_T = 1793620800 -- 2026-11-02T12:00:00Z
time = function() return NOW_T end
date = function(format, t) return os.date(format, t or NOW_T) end
GetTime = function() return NOW_T end
printed = {}
print = function(...) printed[#printed + 1] = table.concat({ ... }, ' ') end
SlashCmdList = {}
registered = {}
CreateFrame = function() return {
 RegisterEvent=function(_, name) registered[name] = (registered[name] or 0) + 1 end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
UnitLevel = function() return 20 end
UnitIsFriend = function() return true end
UnitCanAttack = function() return false end
UnitCreatureType = function() return 'Humanoid' end
UnitClassification = function() return 'normal' end
C_Map = { GetBestMapForUnit=function() return 1436 end, GetPlayerMapPosition=function() return { x = .4, y = .7 } end }
INSTANCE_RESET_SUCCESS = '%s has been reset.'

OUTSIDE = { 'Westfall', 'none', 0, '', 0, 0, false, 0 }
DEADMINES = { 'The Deadmines', 'party', 1, 'Normal', 5, 0, false, 36 }
SFK = { 'Shadowfang Keep', 'party', 1, 'Normal', 5, 0, false, 33 }
MC = { 'Molten Core', 'raid', 9, '40 Player', 40, 0, false, 409 }
instance = OUTSIDE
GetInstanceInfo = function() return unpack(instance, 1, 10) end

-- The group. A unit is { guid, name, realmName, class, role }.
units = {}
units.player = { guid = 'Player-4242-00000001', name = 'Myself', class = 'HUNTER', role = 'NONE' }
inRaid = false
inCombat = false
secret = {}
issecretvalue = function(v) return v ~= nil and secret[v] == true end
UnitGUID = function(unit) local u = units[unit]; return u and u.guid end
UnitName = function(unit) local u = units[unit]; if u then return u.name, u.realmName end end
UnitClass = function(unit) local u = units[unit]; if u then return 'Display', u.class, 3 end end
UnitGroupRolesAssigned = function(unit) local u = units[unit]; return u and u.role or 'NONE' end
GetRealmName = function() return 'Forever' end
IsInRaid = function() return inRaid end
InCombatLockdown = function() return inCombat end
UnitAffectingCombat = function() return inCombat end

-- The damage meter: sessions[type] = { durationSeconds, combatSources = { ... } }. Reads in combat are counted.
meterReads, meterInCombat = 0, 0
sessions = {}
meterAvailable = true
C_DamageMeter = {
 IsDamageMeterAvailable = function() return meterAvailable, meterAvailable and '' or 'disabled' end,
 GetCombatSessionFromType = function(sessionType, kind)
  meterReads = meterReads + 1
  if inCombat then meterInCombat = meterInCombat + 1 end
  assert(sessionType == 1, 'the current session')
  return sessions[kind] or { combatSources = {}, maxAmount = 0, totalAmount = 0 }
 end,
}
function source(guid, name, amount, extra)
 local s = { sourceGUID = guid, name = name, totalAmount = amount, amountPerSecond = 0, isLocalPlayer = false, classFilename = 'WARRIOR' }
 for k, v in pairs(extra or {}) do s[k] = v end
 return s
end
"""


def fresh(saved="nil", files=("core.lua", "modules/openworld.lua", "modules/pulls.lua"), released=True):
    """`released` is the build the release ships: E.RUN_RECORDS set before the modules load, as core.lua would."""
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(f"EverlootDB = {saved}")
    for file in files:
        lua.execute((root / file).read_text(encoding="utf-8"))
        if file == "core.lua":
            lua.execute(f"Everloot.RUN_RECORDS = {'true' if released else 'false'}")
    lua.execute("""
Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')
function event(name, ...) for _, hook in ipairs(Everloot.frame.hooks or {}) do hook(nil, name, ...) end end
function reload() Everloot.frame.hooks = nil; registered = {}; Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot') end
function rows(kind) return EverlootDB.records[kind] or {} end
function zone(where) event('PLAYER_LEAVING_WORLD'); instance = where; event('PLAYER_ENTERING_WORLD') end
function pull(id, name, seconds, success)
 event('ENCOUNTER_START', id, name, instance[3], instance[5])
 NOW_T = NOW_T + seconds
 event('ENCOUNTER_END', id, name, instance[3], instance[5], success)
end
""")
    return lua


# --- Before the release: nothing new is registered, recorded or offered, and encounter rows are as before ---
lua = fresh(files=("core.lua", "modules/openworld.lua", "modules/pulls.lua", "modules/options.lua"), released=False)
lua.execute("""
assert(Everloot.RUN_RECORDS == false and Everloot.Pulls == nil, 'no pulls module before the release')
assert(not registered.ENCOUNTER_START and not registered.CHAT_MSG_SYSTEM and not registered.PLAYER_REGEN_ENABLED, 'no new events')
assert(registered.ENCOUNTER_END, 'encounter rows as before')
units.party1 = { guid = 'Player-4242-00000002', name = 'Tankie', class = 'WARRIOR', role = 'TANK' }
sessions[0] = { durationSeconds = 60, combatSources = { source('Player-4242-00000002', 'Tankie', 20000) } }
zone(DEADMINES)
pull(1144, 'Rhahk\\'zor', 60, 1)
zone(OUTSIDE); NOW_T = NOW_T + 4000; zone(OUTSIDE)
local e = rows('encounter')[1]
assert(e and e.encounterId == 1144 and e.startedAt == nil and e.durationSeconds == nil and e.runId == nil, 'the encounter row has no new field')
assert(EverlootDB.run == nil and EverlootDB.pullStart == nil and #rows('instance_run') == 0, 'no run')
assert(#rows('pull_summary') == 0 and meterReads == 0, 'no pull summary and no meter read')
assert(not string.find(Everloot:Status(), '  pulls: ', 1, true), 'no pulls module in the status')
for _, line in ipairs(printed) do assert(not string.find(line, 'boss pulls on', 1, true), 'no notice') end
assert(EverlootDB.toggles.pulls == nil and EverlootDB.pullsNotice == nil, 'no switch and no notice in the file')
assert(not string.find(Everloot:Status(), 'instance_run', 1, true) and not string.find(Everloot:Status(), 'pull_summary', 1, true), 'no new row counts in the status')
SlashCmdList.EVERLOOT('pulls on')
assert(string.find(printed[#printed], 'Everloot commands:', 1, true) and EverlootDB.toggles.pulls == nil, 'the command is unknown, as before')
SlashCmdList.EVERLOOT('help')
assert(not string.find(printed[#printed], '/everloot pulls', 1, true), 'the command list does not offer it')
for _, r in ipairs(Everloot.Options.ROWS) do assert(r.key ~= 'pulls', 'the settings page does not offer it') end
""")
counts = check_all(lua)
assert counts.get("encounter") == 1 and "instance_run" not in counts and "pull_summary" not in counts, counts

# --- Before the release, the same session reads exactly as on main: saved file, chat, status, commands, events ---
main = json.loads((Path(__file__).parent / "fixtures" / "gate_off_main.json").read_text(encoding="utf-8"))
mine = snapshot(root)
for case in main:
    for part in main[case]:
        assert mine[case][part] == main[case][part], f"gate off, {case} install: {part} differs from main's (fixtures/gate_off_main.json)"
assert mine.keys() == main.keys()

# --- Pull timing: start and length on the anonymous encounter row ---
lua = fresh(files=("core.lua", "modules/openworld.lua"))
lua.execute("""
assert(registered.ENCOUNTER_START and registered.ENCOUNTER_END and registered.CHAT_MSG_SYSTEM, 'openworld listens to the pull and the reset line')
assert(not registered.COMBAT_LOG_EVENT_UNFILTERED, 'no combat log')
zone(DEADMINES)
local run = EverlootDB.run
assert(run and run.instanceMapId == 36 and run.name == 'The Deadmines' and run.pulls == 0, 'zoning in opens a run')
NOW_T = NOW_T + 600
pull(1144, 'Rhahk\\'zor', 75, 1)
local e = rows('encounter')[1]
assert(e.startedAt == '2026-11-02T12:10:00Z' and e.durationSeconds == 75 and e.runId == run.id, 'the kill has its start, length and run')
assert(e.capturedAt == '2026-11-02T12:11:15Z')

-- A START survives a /reload: it is in the file.
event('ENCOUNTER_START', 1145, 'Sneed', 1, 5)
reload()
event('PLAYER_ENTERING_WORLD', false, true)
NOW_T = NOW_T + 40
event('ENCOUNTER_END', 1145, 'Sneed', 1, 5, 0)
e = rows('encounter')[2]
assert(e.durationSeconds == 40 and e.success == false and e.runId == run.id, 'a reload keeps the start and the run')

-- An END without its START, or for another boss, has no start and no length; nothing is guessed.
event('ENCOUNTER_END', 1146, 'Gilnid', 1, 5, 1)
event('ENCOUNTER_START', 1147, "Mr. Smite", 1, 5)
NOW_T = NOW_T + 30
event('ENCOUNTER_END', 1148, 'Cookie', 1, 5, 1)
assert(rows('encounter')[3].startedAt == nil and rows('encounter')[3].durationSeconds == nil)
assert(rows('encounter')[4].startedAt == nil and rows('encounter')[4].durationSeconds == nil)
""")

# --- Runs: corpse runs and reloads continue it; leaving for 30 minutes ends it; empty runs write nothing ---
lua.execute("""
local id = EverlootDB.run.id
NOW_T = NOW_T + 120
zone(OUTSIDE)                      -- released: the corpse run is outside
assert(EverlootDB.run.leftAt == NOW_T and Everloot.CurrentRunId() == nil, 'outside, the run waits')
NOW_T = NOW_T + 300
zone(DEADMINES)
assert(EverlootDB.run.id == id and EverlootDB.run.leftAt == nil and Everloot.CurrentRunId() == id, 'back within 30 minutes: the same run')
pull(1149, 'Edwin VanCleef', 100, 1)
NOW_T = NOW_T + 60
zone(OUTSIDE)
local left = NOW_T
assert(#rows('instance_run') == 0, 'the run is not written until it ends')
NOW_T = NOW_T + 1801
zone(OUTSIDE)
local r = rows('instance_run')[1]
assert(#rows('instance_run') == 1 and EverlootDB.run == nil, 'gone 30 minutes: the run is written')
assert(r.runId == id and r.instanceMapId == 36 and r.instanceType == 'party' and r.difficulty == 1 and r.name == 'The Deadmines')
assert(r.enteredAt == '2026-11-02T12:00:00Z' and r.firstPullAt == '2026-11-02T12:10:00Z', r.firstPullAt)
assert(r.leftAt == date('!%Y-%m-%dT%H:%M:%SZ', left) and r.endReason == 'left')
assert(r.pulls == 5 and r.kills == 4 and r.wipes == 1 and r.size == 5, 'pulls, kills and wipes')
assert(#r.killedEncounterIds == 4 and r.killedEncounterIds[1] == 1144 and r.killedEncounterIds[4] == 1149)
assert(r.lastKillAt == date('!%Y-%m-%dT%H:%M:%SZ', left - 60), 'the last kill')

-- In and out with no boss pull: nothing.
zone(SFK); NOW_T = NOW_T + 600; zone(OUTSIDE); NOW_T = NOW_T + 4000; zone(OUTSIDE)
assert(#rows('instance_run') == 1, 'a run without a pull writes nothing')
""")

# --- Another instance ends the run; a reset line ends it; a killed boss pulled again starts a new run ---
lua.execute("""
zone(DEADMINES); pull(1144, 'Rhahk\\'zor', 50, 1)
zone(SFK)
local r = rows('instance_run')[2]
assert(r.endReason == 'new_instance' and r.instanceMapId == 36 and EverlootDB.run.instanceMapId == 33)
pull(1069, 'Rethilgore', 30, 1)
zone(OUTSIDE)
event('CHAT_MSG_SYSTEM', 'Some other place has been reset.')
assert(EverlootDB.run ~= nil, 'another instance reset leaves the run')
event('CHAT_MSG_SYSTEM', 'Shadowfang Keep has been reset.')
assert(EverlootDB.run == nil and rows('instance_run')[3].endReason == 'reset', 'the reset line ends it')

-- A reset the addon could not read: the same boss killed twice in one run means a new run.
zone(DEADMINES); pull(1144, 'Rhahk\\'zor', 50, 1)
local first = EverlootDB.run.id
zone(OUTSIDE); zone(DEADMINES)
pull(1144, 'Rhahk\\'zor', 45, 1)
assert(rows('instance_run')[4].endReason == 'reset' and rows('instance_run')[4].runId == first)
assert(EverlootDB.run.id ~= first and EverlootDB.run.kills == 1, 'a second kill of the same boss opens a new run')
local e = rows('encounter')[#rows('encounter')]
assert(e.runId == EverlootDB.run.id and e.durationSeconds == 45, 'the pull belongs to the new run')

-- Odd input never errors and writes no run.
local before = #rows('instance_run')
event('ENCOUNTER_START'); event('ENCOUNTER_END'); event('CHAT_MSG_SYSTEM'); event('CHAT_MSG_SYSTEM', secret)
local saved = GetInstanceInfo
GetInstanceInfo = function() error('broken') end
event('PLAYER_ENTERING_WORLD'); event('ENCOUNTER_START', 1, 'X', 1, 5)
GetInstanceInfo = saved
assert(#rows('instance_run') == before)
""")
counts = check_all(lua)
assert counts.get("instance_run") == 4 and "pull_summary" not in counts, counts

# --- A long stay inside is not time away: a reload or relog there keeps the run; leaving starts the 30 minutes ---
lua = fresh(files=("core.lua", "modules/openworld.lua"))
lua.execute("""
zone(DEADMINES)
local id = EverlootDB.run.id
pull(1144, 'Rhahk\\'zor', 60, 1)
NOW_T = NOW_T + 1900                -- 31 minutes inside after the kill
reload(); event('PLAYER_ENTERING_WORLD', false, true)
assert(EverlootDB.run.id == id and #rows('instance_run') == 0, 'a reload after a long stay inside keeps the run')
NOW_T = NOW_T + 7200
event('PLAYER_LEAVING_WORLD'); reload(); event('PLAYER_ENTERING_WORLD', true, false)
assert(EverlootDB.run.id == id and EverlootDB.run.leftAt == nil, 'a relog inside keeps it too')
pull(1145, 'Sneed', 40, 1)
NOW_T = NOW_T + 1900
zone(OUTSIDE)
local left = NOW_T
assert(EverlootDB.run.leftAt == left and #rows('instance_run') == 0, 'leaving after a long stay starts the wait, it does not end the run')
NOW_T = NOW_T + 1000
zone(DEADMINES)
assert(EverlootDB.run.id == id and EverlootDB.run.leftAt == nil, 'back within 30 minutes of leaving: the same run')
NOW_T = NOW_T + 1900
zone(OUTSIDE); left = NOW_T
NOW_T = NOW_T + 1801
zone(OUTSIDE)
local r = rows('instance_run')[1]
assert(r and r.runId == id and r.endReason == 'left' and r.kills == 2 and #rows('instance_run') == 1, 'gone 30 minutes after leaving: the run ends')
assert(r.leftAt == date('!%Y-%m-%dT%H:%M:%SZ', left), 'it left when you zoned out, not at the last kill')
""")
check_all(lua)

# --- pulls.lua: on by default for a new install and an upgraded one, said once ---
lua = fresh()
lua.execute("""
assert(EverlootDB.toggles.pulls == true, 'pulls is on by default')
assert(string.find(Everloot:Status(), 'pulls: ready', 1, true), Everloot:Status())
local notices, said = 0, nil
for _, line in ipairs(printed) do if string.find(line, 'boss pulls on', 1, true) then notices = notices + 1; said = line end end
assert(notices == 1 and string.find(said, 'name, class and role', 1, true) and string.find(said, 'Desktop App', 1, true)
  and string.find(said, 'hidden', 1, true) and string.find(said, '/everloot pulls off', 1, true), tostring(said))
reload()
notices = 0
for _, line in ipairs(printed) do if string.find(line, 'boss pulls on', 1, true) then notices = notices + 1 end end
assert(notices == 1, 'said once per install, not on every reload')
units.party1 = { guid = 'Player-4242-00000002', name = 'Tankie', class = 'WARRIOR', role = 'TANK' }
zone(DEADMINES); pull(1144, 'Rhahk\\'zor', 60, 1)
assert(#rows('pull_summary') == 1, 'on: a row')
SlashCmdList.EVERLOOT('pulls off')
assert(EverlootDB.toggles.pulls == false and #rows('pull_summary') == 0)
reload()
assert(string.find(Everloot:Status(), 'pulls: off by toggle', 1, true))
local reads = meterReads
pull(1145, 'Sneed', 60, 1)
assert(#rows('pull_summary') == 0 and meterReads == reads, 'off: no row and no meter read')
SlashCmdList.EVERLOOT('pulls')
assert(string.find(printed[#printed], 'pulls: off', 1, true))
""")
# An install from before this module gets it on too, and is told.
lua = fresh("{ installId = 'abcd-1234', toggles = { openworld = true, census = true, players = true }, records = {} }")
lua.execute("""
assert(EverlootDB.toggles.pulls == true and EverlootDB.pullsNotice == true, 'an upgraded install starts with pulls on, and is told')
""")

# --- On: a dungeon pull, read after combat, roles assigned and inferred, hidden values left out ---
lua = fresh()
lua.execute("""
SlashCmdList.EVERLOOT('pulls on')
local said = printed[#printed]
assert(string.find(said, 'name, class and role', 1, true) and string.find(said, 'upload page', 1, true)
  and string.find(said, 'Never their gear, guild, position or chat', 1, true) and string.find(said, '/reload', 1, true), said)
reload()
assert(registered.ENCOUNTER_START and registered.PLAYER_REGEN_ENABLED and not registered.COMBAT_LOG_EVENT_UNFILTERED)
assert(string.find(Everloot:Status(), 'pulls: ready', 1, true), Everloot:Status())

units.party1 = { guid = 'Player-4242-00000002', name = 'Tankie', class = 'WARRIOR', role = 'TANK' }
units.party2 = { guid = 'Player-4242-00000003', name = 'Healz', class = 'PRIEST', role = 'NONE' }
units.party3 = { guid = 'Player-4242-00000004', name = 'Grom', realmName = 'Elsewhere', class = 'ROGUE', role = 'NONE' }
units.party4 = { guid = 'Player-4242-00000005', name = 'Quiet', class = 'MAGE', role = 'NONE' }
local hidden = 777
secret[hidden] = true
sessions[0] = { durationSeconds = 82, combatSources = {
  source('Player-4242-00000002', 'Tankie', 20000),
  source(nil, 'Myself', 30000.6, { isLocalPlayer = true }),
  source('Player-4242-00000003', 'Healz', 1500),
  source('Player-4242-00000004', 'Grom', 41000),
  source('Player-4242-00000005', 'Quiet', hidden),
  source('Creature-0-1-2-3-299-0000000001', 'Wolf', 99999),     -- not in the group
  source('Player-4242-00000099', 'Stranger', 5000),              -- not in the group
} }
sessions[2] = { durationSeconds = 82, combatSources = { source('Player-4242-00000003', 'Healz', 25000), source('Player-4242-00000002', 'Tankie', 300) } }
sessions[7] = { durationSeconds = 82, combatSources = { source('Player-4242-00000002', 'Tankie', 50000), source('Player-4242-00000004', 'Grom', 4000) } }
sessions[9] = { durationSeconds = 82, combatSources = { source('Player-4242-00000004', 'Grom', 1) } }

zone(DEADMINES)
event('ENCOUNTER_START', 1144, 'Rhahk\\'zor', 1, 5)
NOW_T = NOW_T + 80
inCombat = true
event('ENCOUNTER_END', 1144, 'Rhahk\\'zor', 1, 5, 1)
assert(#rows('pull_summary') == 0 and meterReads == 0, 'in combat: nothing read yet')
inCombat = false
event('PLAYER_REGEN_ENABLED')
assert(meterInCombat == 0, 'the meter is never read in combat')
local r = rows('pull_summary')[1]
assert(r and r.encounterId == 1144 and r.success == true and r.durationSeconds == 80 and r.meterSeconds == 82 and r.realm == 'Forever')
assert(r.instanceMapId == 36 and r.difficulty == 1 and r.size == 5 and r.runId == EverlootDB.run.id and r.startedAt == '2026-11-02T12:00:00Z')
assert(#r.members == 5, 'you and four party members; strangers and creatures are not members')
local by = {}
for _, m in ipairs(r.members) do by[m.name] = m end
assert(by.Myself.self == true and by.Myself.damageDone == 30000 and by.Myself.role == 'damage' and by.Myself.roleSource == 'inferred', 'you, matched by isLocalPlayer')
assert(by.Tankie.role == 'tank' and by.Tankie.roleSource == 'assigned' and by.Tankie.damageTaken == 50000 and by.Tankie.healingDone == 300)
assert(by.Healz.role == 'healer' and by.Healz.roleSource == 'inferred' and by.Healz.healingDone == 25000)
assert(by.Grom.realm == 'Elsewhere' and by.Grom.deaths == 1 and by.Grom.damageDone == 41000)
assert(by.Quiet.damageDone == nil and by.Quiet.role == nil, 'a hidden total is left out, and no role is guessed from nothing')
assert(by.Tankie.realm == nil and by.Myself.realm == nil, 'same realm: no realm on the member')
pendingAfter = meterReads
event('PLAYER_REGEN_ENABLED')
assert(meterReads == pendingAfter and #rows('pull_summary') == 1, 'one read per pull')

-- Out of combat at the end (everyone dead on a wipe): read at once.
pull(1145, 'Sneed', 30, 0)
assert(#rows('pull_summary') == 2 and rows('pull_summary')[2].success == false)

-- A new pull before combat ended: the old totals are mixed, so that pull is not written.
event('ENCOUNTER_START', 1146, 'Gilnid', 1, 5)
inCombat = true
event('ENCOUNTER_END', 1146, 'Gilnid', 1, 5, 1)
event('ENCOUNTER_START', 1147, 'Mr. Smite', 1, 5)
inCombat = false
event('PLAYER_REGEN_ENABLED')
assert(#rows('pull_summary') == 2, 'a pull overtaken in combat is dropped')

-- Outdoors, odd arguments, a broken meter: nothing, and no error.
instance = OUTSIDE
event('ENCOUNTER_END', 1144, 'Rhahk\\'zor', 1, 5, 1)
instance = DEADMINES
event('ENCOUNTER_END', 0, 'X', 1, 5, 1); event('ENCOUNTER_END'); event('ENCOUNTER_END', 1144, '', 1, 5, 1)
assert(#rows('pull_summary') == 2)
C_DamageMeter.GetCombatSessionFromType = function() error('broken') end
pull(1148, 'Cookie', 20, 1)
local bare = rows('pull_summary')[3]
assert(bare and bare.meterSeconds == nil and #bare.members == 5 and bare.members[1].damageDone == nil, 'a broken meter: the group and assigned roles only')
""")
counts = check_all(lua)
assert counts["pull_summary"] == 3, counts

# --- A client without a meter, a raid, the caps, and /everloot pulls off ---
lua = fresh("{ installId = 'abcd-1234', toggles = { pulls = true }, records = {} }")
lua.execute("""
C_DamageMeter = nil
inRaid = true
units.raid1 = units.player
for i = 2, 40 do units['raid' .. i] = { guid = string.format('Player-4242-%08X', i), name = 'Raider' .. string.char(96 + (i % 26) + 1) .. string.char(96 + math.floor(i / 26) + 1), class = 'PALADIN', role = 'NONE' } end
zone(MC)
pull(663, 'Lucifron', 120, 1)
local r = rows('pull_summary')[1]
assert(#r.members == 40 and r.members[1].self == true, 'a raid reads raid1..raid40 once each')
assert(string.find(Everloot:Status(), 'no damage meter', 1, true), 'status says the meter is missing')
for i = 2, 60 do pull(663 + i, 'Boss', 60, 0) end
assert(#rows('pull_summary') == 50, '2,000 member entries at most: got ' .. #rows('pull_summary'))
assert(EverlootDB.paused.pull_summary == true and string.find(printed[#printed], 'pull_summary collection paused', 1, true))
SlashCmdList.EVERLOOT('pulls off')
assert(EverlootDB.records.pull_summary == nil and EverlootDB.paused.pull_summary == nil and EverlootDB.toggles.pulls == false, 'off deletes every row')
assert(rows('encounter')[1] ~= nil, 'the anonymous encounter rows stay')
pull(700, 'Boss', 10, 1)
assert(#rows('pull_summary') == 0, 'off at once, before the reload')
""")
check_all(lua)

# --- Meter lines and the group: a readable GUID outside the group never takes a member's totals by name ---
lua = fresh()
lua.execute("""
units.party1 = { guid = 'Player-4242-00000002', name = 'Tankie', class = 'WARRIOR', role = 'TANK' }
units.party2 = { guid = 'Player-4242-00000003', name = 'Healz', class = 'PRIEST', role = 'HEALER' }
units.party3 = { guid = 'Player-4242-00000004', name = 'Grom', class = 'ROGUE', role = 'DAMAGER' }
units.party4 = { guid = 'Player-4242-00000005', name = 'Wolfie', class = 'HUNTER', role = 'DAMAGER' }
local hiddenGuid = 'meter-secret'                               -- the meter hides this line's GUID; the roster's is readable
secret[hiddenGuid] = true
sessions[0] = { durationSeconds = 60, combatSources = {
  source('Player-4242-00000002', 'Tankie', 20000),
  source('Pet-0-4242-0-0-299-0100000001', 'Tankie', 999999),            -- a pet named like the tank: its own GUID
  source('Creature-0-4242-0-0-299-0000000001', 'Grom', 888888),         -- a creature named like a member
  source('Player-4242-00000099', 'Grom', 777777),                       -- a stranger with a member's name
  source('Player-4242-00000004', 'Grom', 41000),
  source(hiddenGuid, 'Healz', 3000, { classFilename = 'PRIEST' }),      -- the GUID is hidden: matched by name and class
  source(nil, 'Wolfie', 12000, { classFilename = 'HUNTER' }),
  source(nil, 'Wolfie', 500, { classFilename = 'HUNTER' }),             -- two lines for one name: neither is trusted
} }
sessions[2] = { durationSeconds = 60, combatSources = {
  source(nil, 'Healz', 25000, { classFilename = 'WARRIOR' }),           -- no GUID and the wrong class: not Healz
} }
zone(DEADMINES); pull(1144, 'Rhahk\\'zor', 60, 1)
local by = {}
for _, m in ipairs(rows('pull_summary')[1].members) do by[m.name] = m end
assert(by.Tankie.damageDone == 20000, 'the pet line does not overwrite the tank: ' .. tostring(by.Tankie.damageDone))
assert(by.Grom.damageDone == 41000, 'neither the creature nor the stranger takes the member total: ' .. tostring(by.Grom.damageDone))
assert(by.Healz.damageDone == 3000, 'a hidden GUID falls back to the name')
assert(by.Healz.healingDone == nil, 'a line whose class disagrees is not the member')
assert(by.Wolfie.damageDone == nil, 'two unidentified lines for one member leave the total out')
""")
check_all(lua)

# The settings page lists the switch, on for a new install.
lua = fresh(files=("core.lua", "modules/openworld.lua", "modules/pulls.lua", "modules/options.lua"))
lua.execute("""
local row
for _, r in ipairs(Everloot.Options.ROWS) do if r.key == 'pulls' then row = r end end
assert(row and row.command == 'pulls' and Everloot.Options.IsOn(row), 'the settings page has the pulls switch, on')
""")

print("Lua 5.1 pulls: nothing new before the release gate; encounter rows carry start and length; runs survive corpse "
      "runs, reloads and long stays inside and end 30 minutes after leaving, in another instance or at a reset; pull "
      "summaries are on by default and said once, read the damage meter only after combat, match by GUID first, leave "
      "hidden or ambiguous totals out, cap at 200 rows and 2,000 members, and off deletes them")
