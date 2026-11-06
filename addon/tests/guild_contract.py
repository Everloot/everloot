"""Run with: uv run --with lupa --with jsonschema python addon/tests/guild_contract.py

Guild rows are stored on change, not on every event. GUILD_ROSTER_UPDATE fires on each guildmate's login and
logout: a roster snapshot is stored at most once per guild every six hours, and not at all when the roster reads
the same as the last one stored. A raid lockout is stored once per instance and difficulty until a boss goes
down or the lockout resets, not on every loading screen. Attendance is one row per raid run: the same people in
the same instance within six hours add nothing. What the rows hold, and that the module is on, do not change here.
"""
from pathlib import Path
from lupa.lua51 import LuaRuntime

lua = LuaRuntime()
lua.execute("""
now = 1000000
time = function() return now end
date = function() return '2026-10-08T00:00:00Z' end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
GetGuildInfo = function() return 'Test Guild' end
GetRealmName = function() return 'Test Realm' end
UnitFactionGroup = function() return 'Alliance' end
C_GuildInfo = {GuildRoster=function() end}
-- name, rank, rankIndex, level, _, _, _, _, online, _, class
roster = {
 {'Alpha-Realm', 'Guild Master', 0, 60, nil, nil, nil, nil, true, nil, 'MAGE'},
 {'Bravo-Realm', 'Officer', 1, 58, nil, nil, nil, nil, false, nil, 'WARRIOR'},
}
GetNumGuildMembers = function() return #roster end
GetGuildRosterInfo = function(i) local r = roster[i]; if r then return unpack(r, 1, 11) end end
GetGuildRosterLastOnline = function() return 0, 0, 3 end
-- Saved instances: name, _, reset seconds, difficulty, _, _, _, _, _, _, encounters.
saved = {}
GetNumSavedInstances = function() return #saved end
GetSavedInstanceInfo = function(i)
 local s = saved[i]
 if s then return s.name, i, s.reset, s.difficulty, true, false, 0, true, 10, 'Raid', #s.bosses end
end
GetSavedInstanceEncounterInfo = function(i, e) local b = saved[i].bosses[e]; return b[1], nil, b[2] end
inRaid = false
IsInRaid = function() return inRaid end
raid = {}
GetNumGroupMembers = function() return #raid end
GetRaidRosterInfo = function(i) return raid[i] end
GetInstanceInfo = function() return 'Molten Core' end
""")
root = Path(__file__).parents[1]
for file in ["core.lua", "modules/guild.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute("""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
local function event(name) for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, name) end end
local function count(kind) return #(EverlootDB.records[kind] or {}) end
local HOUR = 3600

-- Roster snapshots: the event fires on every guildmate's login and logout.
for _ = 1, 3 do event('GUILD_ROSTER_UPDATE') end
assert(count('guild_snapshot') == 1, 'three roster events with the same roster store one snapshot')
local first = EverlootDB.records.guild_snapshot[1]
assert(#first.members == 2 and first.members[2].lastOnlineDays == 3, 'the snapshot holds the roster as read')
roster[2][9] = true  -- Bravo logs in
now = now + HOUR
event('GUILD_ROSTER_UPDATE')
assert(count('guild_snapshot') == 1, 'a change inside the six-hour window waits')
now = now + 6 * HOUR
event('GUILD_ROSTER_UPDATE')
assert(count('guild_snapshot') == 2, 'after six hours a changed roster is stored')
assert(EverlootDB.records.guild_snapshot[2].members[2].lastOnlineDays == 0, 'the new snapshot has the change')
now = now + 7 * HOUR
for _ = 1, 3 do event('GUILD_ROSTER_UPDATE') end
assert(count('guild_snapshot') == 2, 'after six hours an unchanged roster adds nothing')

-- Lockouts: one row per instance and difficulty until a boss goes down or the week resets.
local DAY = 24 * HOUR
saved = { { name = 'Molten Core', reset = 5 * DAY, difficulty = 9, bosses = { { 'Lucifron', true }, { 'Magmadar', false } } } }
for _ = 1, 3 do event('PLAYER_ENTERING_WORLD') end
event('UPDATE_INSTANCE_INFO')
assert(count('raid_lockout') == 1, 'four loading screens with the same lockout store one row')
local lock = EverlootDB.records.raid_lockout[1]
assert(lock.instance == 'Molten Core' and lock.difficulty == '9' and #lock.bossesKilled == 1 and lock.bossesKilled[1] == 'Lucifron')
now = now + 10 * 60
saved[1].reset = saved[1].reset - 10 * 60 + 2  -- ten minutes on, the client's seconds-left wobbles by a couple
event('PLAYER_ENTERING_WORLD')
assert(count('raid_lockout') == 1, 'time passing is not a new lockout')
saved[1].bosses[2][2] = true
event('UPDATE_INSTANCE_INFO')
assert(count('raid_lockout') == 2 and #EverlootDB.records.raid_lockout[2].bossesKilled == 2, 'a boss kill is a new row')
event('PLAYER_ENTERING_WORLD')
assert(count('raid_lockout') == 2, 'the kill is stored once')
saved[1].reset = 7 * DAY
saved[1].bosses = { { 'Lucifron', false }, { 'Magmadar', false } }
event('UPDATE_INSTANCE_INFO')
assert(count('raid_lockout') == 3 and #EverlootDB.records.raid_lockout[3].bossesKilled == 0, 'next week is a new lockout')
now = now + 8 * DAY
saved = {}
event('PLAYER_ENTERING_WORLD')
assert(count('raid_lockout') == 3 and next(EverlootDB.lockoutSeen) == nil, 'an expired lockout is forgotten, not stored')

-- Attendance: one row per raid run.
inRaid = true
raid = { 'Alpha-Realm', 'Bravo-Realm', 'Charlie-Realm' }
for _ = 1, 3 do event('GUILD_ROSTER_UPDATE') end
event('PLAYER_ENTERING_WORLD')
assert(count('attendance') == 1, 'four events in the same raid store one attendance row')
local present = EverlootDB.records.attendance[1].present
assert(#present == 3 and present[1] == 'Alpha' and present[3] == 'Charlie', 'the row names the people present, realm stripped')
raid = { 'Charlie-Realm', 'Alpha-Realm', 'Bravo-Realm' }
event('GUILD_ROSTER_UPDATE')
assert(count('attendance') == 1, 'the same people in another order are the same run')
raid = { 'Alpha-Realm', 'Bravo-Realm', 'Charlie-Realm', 'Delta-Realm' }
event('GUILD_ROSTER_UPDATE')
assert(count('attendance') == 2 and #EverlootDB.records.attendance[2].present == 4, 'someone joining is a new row')
event('GUILD_ROSTER_UPDATE')
assert(count('attendance') == 2, 'and that row is stored once')
now = now + 7 * HOUR
event('PLAYER_ENTERING_WORLD')
assert(count('attendance') == 3, 'the same people seven hours later are a new run')
inRaid = false
event('GUILD_ROSTER_UPDATE')
assert(count('attendance') == 3, 'no raid, no row')
""")
# A reload reads the stored state back: the same roster and the same raid add nothing.
lua.execute((root / "modules/guild.lua").read_text(encoding="utf-8"))
lua.execute("""
Everloot:InitModules()
local function event(name) for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, name) end end
local function count(kind) return #(EverlootDB.records[kind] or {}) end
inRaid = true
local before = { count('guild_snapshot'), count('raid_lockout'), count('attendance') }
event('GUILD_ROSTER_UPDATE')
event('PLAYER_ENTERING_WORLD')
assert(count('guild_snapshot') == before[1], 'a reload does not snapshot the roster again')
assert(count('attendance') == before[3], 'a reload does not record the raid again')
""")
# Every row the addon wrote is a record the site would accept (packages/protocol/schema).
from protocol_schema import check_all  # noqa: E402
check_all(lua)
print("Lua 5.1 guild: roster snapshots throttled and deduplicated, lockouts stored on change, attendance once per run, reload keeps state passed")
