"""Own boss kills are local completion state; failed pulls and unrelated outdoor encounters are ignored."""
from pathlib import Path
from window_world import fresh

root = Path(__file__).parents[1]
lua = fresh("{ installId = 'abcd-1234', toggles = { completion = true }, records = {} }", """
date = os.date
UnitGUID = function() return 'Player-1-0001' end
GetInstanceInfo = function() return 'Dungeon', 'party', 1, nil, nil, nil, nil, 48 end
IsInInstance = function() return true, 'party' end
""", extra=("modules/instance_data.lua", "modules/completion.lua", "modules/boss_kills.lua"))
lua.execute("""
assert(Everloot:Status():find('World boss kills seen: 0', 1, true))
local function kill(id, success)
  for _, hook in ipairs(Everloot.frame.hooks or {}) do hook(nil, 'ENCOUNTER_END', id, 'Boss', 1, 5, success) end
end
kill(2916, 0)
assert(Everloot:Count('boss_kill_owned') == 0)
kill(2916, 1); kill(2916, 1)
local r = Everloot:Rows('boss_kill_owned')[1]
assert(r.encounterId == 2916 and r.instanceMapId == 48 and r.difficulty == 1 and r.killCount == 2)
assert(r.firstKillAt == r.lastKillAt and r.characterKey == Everloot.CharacterKey())
IsInInstance = function() return false, 'none' end
kill(2916, 1)
assert(r.killCount == 2, 'an unrelated outdoor encounter is ignored')
local world = Everloot.InstanceData.instances
local boss
for _, instance in ipairs(world) do if instance.group == 'World bosses' then boss = instance.bosses[1].id; break end end
assert(boss)
for _, hook in ipairs(Everloot.frame.hooks or {}) do hook(nil, 'ENCOUNTER_END', boss, 'Boss', 0, 40, 1) end
assert(Everloot:Count('boss_kill_owned') == 2)
assert(Everloot:Status():find('World boss kills seen: 1', 1, true))
SlashCmdList.EVERLOOT('completion off')
assert(Everloot:Count('boss_kill_owned') == 0)
kill(boss, 1)
assert(Everloot:Count('boss_kill_owned') == 0)
""")
print("Lua 5.1 instances: local kills, success only, outdoor allowlist, status and completion withdrawal PASS")

lua.execute("""
EverlootDB.toggles.completion = true
Everloot.InstanceData = { asOf = '2026-11-10', instances = {
  { id = 48, name = 'Blackfathom Deeps', group = 'Dungeons', bosses = { { id = 2916, name = 'Ghamoo-ra' } } },
  { id = 409, name = 'Molten Core', group = 'Raids', bosses = { { id = 1, name = 'Boss' } } },
  { id = 2789, name = 'Lord Kazzak', group = 'World bosses', unconfirmed = true, bosses = { { id = 3026, name = 'Lord Kazzak' } } }
} }
Everloot.Roster.Rows = function() return { { key = 'alt', name = 'Velda' } } end
EverlootDB.records.boss_kill_owned = {
  { characterKey = 'alt', encounterId = 2916, instanceMapId = 48, lastKillAt = '2026-11-10T12:00:00Z' },
  { characterKey = 'stranger', encounterId = 1, instanceMapId = 409, lastKillAt = '2026-11-10T12:00:00Z' }
}
EverlootDB.records.lockout_owned = {
  { characterKey = 'alt', instanceId = 48, resetAt = '2030-01-01T00:00:00Z', bossesKilledCount = 1, bossesTotal = 6 },
  { characterKey = 'alt', instanceId = 409, resetAt = '1970-01-01T00:00:00Z', bossesKilledCount = 1, bossesTotal = 10 },
  { characterKey = 'alt', instanceId = 2720, instance = 'Testwerk', resetAt = '2030-01-01T00:00:00Z' }
}
local U = Everloot.Window
assert(U.Open('collection'))
local c = EverlootWindow.collection
local function click(b) b.scripts.OnClick(b) end
click(c.sections.raids)
assert(c.sections.raids.text == 'Dungeons & raids')
assert(c.rows[3].detail.text == 'No kill recorded')
click(c.scopes.account)
assert(c.rows[3].detail.text:find('1 of 6', 1, true) and c.rows[3].detail.text:find('Velda', 1, true))
assert(c.rows[4].done.text == 'done' and c.rows[4].detail.text:find('2026-11-10T12:00:00Z', 1, true) and c.rows[4].detail.text:find('Velda', 1, true))
assert(c.rows[7].detail.text == 'No kill recorded', 'a key outside the roster does not count')
assert(c.rows[8].detail.text == 'Found in game files, unconfirmed')
for _, row in ipairs(c.rows) do
  if row.shown then
    assert(not row.name.text:find('Testwerk', 1, true))
    assert(not row.detail.text:find('1970', 1, true), 'expired lockout is hidden')
  end
end
click(c.scopes.character)
assert(c.rows[3].detail.text == 'No kill recorded')
""")
print("Lua 5.1 instance Collection: groups, dates, Account holders, expired lockout and unreported instance PASS")
