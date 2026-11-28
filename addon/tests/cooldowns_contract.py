"""Profession cooldowns survive character changes and never turn unreadable values into Ready."""
from pathlib import Path
from window_world import fresh

API = """
guid = 'Player-1-0001'
UnitGUID = function() return guid end
GetServerTime = function() return now end
GetTime = function() return 500 end
combat = false
InCombatLockdown = function() return combat end
known = { [17187] = true, [17559] = true }
IsPlayerSpell = function(id) return known[id] == true end
function cooldown(start, duration)
  return { startTime = start, duration = duration, isEnabled = true, modRate = 1 }
end
spells = { [17187] = cooldown(490, 600), [17559] = cooldown(490, 900) }
C_Spell = { GetSpellCooldown = function(id) return spells[id] end }
bagCount = 1
C_Item = { GetItemCount = function() return bagCount end }
C_Container = { GetItemCooldown = function() return 0, 0, 1 end }
"""

MODULE = "modules/cooldowns.lua"
toc = (Path(__file__).parents[1] / "Everloot.toc").read_text(encoding="utf-8")
assert toc.index(MODULE.replace("/", "\\")) < toc.index("modules\\view_professions.lua")

lua = fresh("{ installId = 'cooldown-test' }", API, extra=(MODULE,))
lua.execute("""
local E = Everloot
local me = E.CharacterKey()
local function sample(event)
  fire(event or 'SPELL_UPDATE_COOLDOWN')
  drain()
end
local function entry(label, character)
  for _, row in ipairs(E.Cooldowns.Rows()) do
    if row.name == label and row.key == (character or me) then return row end
  end
end

sample('PLAYER_ENTERING_WORLD')
assert(#E.Cooldowns.Rows() == 2, 'shared transmutes are one row; unknown spells are omitted')
assert(entry('Transmute').remaining == 890, 'longest valid shared timer wins')
assert(entry('Salt Shaker').state == 'ready')
for _, rows in pairs(EverlootDB.records) do
  for _, row in ipairs(rows) do
    assert(not row.readyAt, 'cooldowns never enter upload records')
  end
end
local U = E.Window
assert(U.Open('professions'))
local p = U.frame.professions
assert(p.cooldownNav.text == 'Cooldowns')
p.cooldownNav.scripts.OnClick()
assert(p.cooldowns.page.shown and not p.trainers.page.shown)
assert(p.cooldowns.rows[1].status.text == 'Ready')
assert(8 + p.footer.width <= 604 + p.cooldownNav.point[2] - p.cooldownNav.width, 'all buttons clear the footer')

local secret = {}
SECRET[secret] = true
spells[17187] = cooldown(secret, 600)
sample()
assert(entry('Transmute').state == 'unknown', 'one unreadable known spell prevents Ready for the group')
spells[17187] = cooldown(490, 600)
sample()
assert(entry('Transmute').remaining == 890)
spells[17187] = cooldown(490, 999999999)
sample()
assert(entry('Transmute').state == 'unknown', 'an implausible duration cannot become Ready')
spells[17187] = cooldown(490, 600)

combat = true
spells[17559] = cooldown(500, 2000)
sample()
assert(entry('Transmute').state == 'unknown', 'current reads are deferred in combat')
combat = false
sample('PLAYER_REGEN_ENABLED')
assert(entry('Transmute').remaining == 2000)

bagCount = 0
sample('BAG_UPDATE_DELAYED')
assert(not entry('Salt Shaker'), 'a confirmed missing item cannot remain Ready')
bagCount = 1
sample('BAG_UPDATE_DELAYED')
assert(entry('Salt Shaker').state == 'ready')

-- Capture the actual saved rows for a fresh Lua VM below.
reloadFixture = string.format([[{ installId = 'cooldown-test',
  roster = { ['%s'] = { name = 'Samplechar', realm = 'Forever' } },
  professionCooldowns = { ['%s'] = { transmute = { readyAt = %d } } },
}]], me, me, EverlootDB.professionCooldowns[me].transmute.readyAt)

guid = 'Player-1-0002'
known = { [18560] = true }
spells[18560] = cooldown(0, 0)
sample('PLAYER_ENTERING_WORLD')
assert(entry('Mooncloth', E.CharacterKey()).state == 'ready', 'same name, different character')
assert(entry('Transmute').remaining == 2000, 'the alt never replaces the other character timer')
now = now + 2001
assert(entry('Transmute').state == 'ready', 'the server timestamp elapses while the character is offline')
E.Roster.Forget(me)
assert(not entry('Transmute'), 'forgetting a character removes its timers')

EverlootDB.toggles.roster = false
sample()
assert(#E.Cooldowns.Rows() == 0, 'the roster option also controls cooldown reads and display')
""")

reloaded = fresh(lua.globals().reloadFixture, API, extra=(MODULE,))
reloaded.execute("""
guid = 'Player-1-0002'
known = { [18560] = true }
bagCount = 0
spells[18560] = cooldown(0, 0)
fire('PLAYER_ENTERING_WORLD')
drain()
local rows = Everloot.Cooldowns.Rows()
assert(#rows == 2 and rows[1].name == 'Mooncloth' and rows[2].remaining == 2000)
now = now + 2001
assert(Everloot.Cooldowns.Rows()[2].state == 'ready')
""")

print("Profession cooldown contract PASS")
