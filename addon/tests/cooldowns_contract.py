"""Profession cooldowns survive character changes and never turn unreadable values into Ready."""
from pathlib import Path
from window_world import fresh

API = """
MinimapCluster = CreateFrame('Frame', nil, UIParent)
UnitName = function() return 'Balbic', 'Morning Star' end
SetPortraitTexture = function(texture, unit) texture.portraitUnit = unit end
CLASS_ICON_TCOORDS = { SHAMAN = { 0.5, 0.75, 0.25, 0.5 } }
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
names = { [17187] = 'Transmute: Arcanite', [17559] = 'Transmute: Fire to Earth', [18560] = 'Mooncloth' }
C_Spell = { GetSpellCooldown = function(id) return spells[id] end, GetSpellName = function(id) return names[id] end }
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

local tracker = E.Cooldowns.tracker
function tracker.panel:SetHeight(height) self.height = height end
sample('PLAYER_ENTERING_WORLD')
assert(#E.Cooldowns.Rows() == 3, 'each learned transmute has a separate row')
assert(entry('Transmute: Arcanite').remaining == 590)
assert(entry('Transmute: Fire to Earth').remaining == 890)
assert(entry('Salt Shaker').state == 'ready')
for _, rows in pairs(EverlootDB.records) do
  for _, row in ipairs(rows) do
    assert(not row.readyAt, 'cooldowns never enter upload records')
  end
end
local U = E.Window
assert(tracker and tracker.panel.shown and tracker.panel.parent == UIParent, 'tracker lives outside Everloot')
assert(tracker.panel.point[2] == MinimapCluster, 'tracker starts below the minimap')
assert(tracker.panel.height == 23 and not tracker.rows[1].shown, 'the tracker starts as one line')
assert(tracker.summary.character.text == 'Balbic Morning Star', 'use the full character name')
assert(tracker.summary.name.text == 'Arcanite' and tracker.summary.status.text == '10m')
assert(tracker.summary.character.color[2] == RAID_CLASS_COLORS.SHAMAN.g)
assert(tracker.summary.icon.portraitUnit == 'player')
tracker.summary.scripts.OnClick()
assert(tracker.rows[1].shown and tracker.rows[1].name.text == 'Fire to Earth', 'the line expands to reveal more timers')
tracker.summary.scripts.OnClick()
assert(tracker.panel.height == 23 and not tracker.rows[1].shown, 'the line collapses again')
assert(U.Open('professions'))
local p = U.frame.professions
assert(p.cooldownNav.text == 'Tracker')
p.cooldownNav.scripts.OnClick()
assert(not tracker.panel.shown and EverlootDB.professionTrackerShown == false, 'toggle hides the tracker')
assert(p.mode == 'list' and p.cooldowns == nil, 'there is no duplicate page')
p.cooldownNav.scripts.OnClick()
assert(tracker.panel.shown and EverlootDB.professionTrackerShown == true, 'toggle reopens the tracker')
U.frame:Hide()
assert(tracker.panel.shown, 'closing the main window leaves the tracker visible')
tracker.panel.GetRight = function() return 1800 end
tracker.panel.GetTop = function() return 800 end
for _, frame in ipairs(created) do
  if frame.parent == tracker.panel and frame.scripts.OnDragStop then frame.scripts.OnDragStop() end
end
assert(EverlootDB.professionTrackerPosition.x == -120 and EverlootDB.professionTrackerPosition.y == -280)
assert(tracker.panel.point[2] == UIParent, 'a manual position overrides the minimap anchor')
assert(8 + p.footer.width <= 604 + p.cooldownNav.point[2] - p.cooldownNav.width, 'all buttons clear the footer')

local secret = {}
SECRET[secret] = true
spells[17187] = cooldown(secret, 600)
sample()
assert(entry('Transmute: Arcanite').state == 'unknown', 'unreadable only affects that recipe')
assert(entry('Transmute: Fire to Earth').remaining == 890)
spells[17187] = cooldown(490, 600)
sample()
assert(entry('Transmute: Arcanite').remaining == 590)
spells[17187] = cooldown(490, 999999999)
sample()
assert(entry('Transmute: Arcanite').state == 'unknown', 'an implausible duration cannot become Ready')
spells[17187] = cooldown(490, 600)

combat = true
spells[17559] = cooldown(500, 2000)
sample()
assert(entry('Transmute: Fire to Earth').state == 'unknown', 'current reads are deferred in combat')
combat = false
sample('PLAYER_REGEN_ENABLED')
assert(entry('Transmute: Fire to Earth').remaining == 2000)

bagCount = 0
sample('BAG_UPDATE_DELAYED')
assert(not entry('Salt Shaker'), 'a confirmed missing item cannot remain Ready')
bagCount = 1
sample('BAG_UPDATE_DELAYED')
assert(entry('Salt Shaker').state == 'ready')

-- The trade skill list is authoritative and can discover a third recipe without spellbook support.
local newRecipe = 987654
local recipeSeconds = { [17187] = 1200, [17559] = 2000, [newRecipe] = 3000 }
local recipeNames = { [17187] = names[17187], [17559] = names[17559], [newRecipe] = 'Another learned craft' }
C_TradeSkillUI = {
  GetAllRecipeIDs = function() return {17187, 17559, newRecipe, 42} end,
  GetRecipeInfo = function(id) return { name = recipeNames[id] or 'Unlearned', learned = id ~= 42 } end,
  GetRecipeCooldown = function(id) return recipeSeconds[id] or 5000 end,
}
sample('TRADE_SKILL_SHOW')
assert(entry(names[17187]).remaining == 1200 and entry(names[17559]).remaining == 2000)
assert(entry('Another learned craft').remaining == 3000 and not entry('Unlearned'))
assert(#E.Cooldowns.Rows() == 4, 'spell and profession reads for one recipe do not duplicate it')
sample('TRADE_SKILL_CLOSE')
sample()
assert(entry(names[17187]).remaining == 1200, 'a conflicting spell read does not erase a live recipe timer')
assert(entry('Another learned craft').remaining == 3000, 'recipes outside the built-in list survive a spell scan')

-- Capture the actual saved rows for a fresh Lua VM below.
reloadFixture = string.format([[{ installId = 'cooldown-test',
  roster = { ['%s'] = { name = 'Samplechar', realm = 'Forever' } },
  professionCooldowns = { ['%s'] = {
    [17559] = { readyAt = %d, name = 'Transmute: Fire to Earth' },
    [987654] = { readyAt = %d, name = 'Another learned craft', fromRecipe = true },
    transmute = { readyAt = 99999999 }
  } },
  professionTrackerPosition = { x = %d, y = %d }, professionTrackerShown = false,
}]], me, me, EverlootDB.professionCooldowns[me][17559].readyAt,
  EverlootDB.professionCooldowns[me][newRecipe].readyAt,
  EverlootDB.professionTrackerPosition.x, EverlootDB.professionTrackerPosition.y)

guid = 'Player-1-0002'
known = { [18560] = true }
spells[18560] = cooldown(0, 0)
sample('PLAYER_ENTERING_WORLD')
assert(entry('Mooncloth', E.CharacterKey()).state == 'ready', 'same name, different character')
assert(entry('Transmute: Fire to Earth').remaining == 2000, 'the alt never replaces the other character timer')
assert(tracker.summary.name.text == 'Mooncloth', 'collapsed view prioritizes the current character')
tracker.summary.scripts.OnClick()
assert(tracker.rows[1].icon.path:find('CharacterCreate%-Classes'), 'offline alts use class icons')
assert(entry('Another learned craft').remaining == 3000, 'the third recipe is visible from another character')
tracker.summary.scripts.OnClick()
now = now + 2001
assert(entry('Transmute: Fire to Earth').state == 'ready', 'the server timestamp elapses while the character is offline')
E.Roster.Forget(me)
assert(not entry('Transmute: Fire to Earth'), 'forgetting a character removes its timers')

EverlootDB.toggles.roster = false
sample()
tracker.panel.scripts.OnUpdate(tracker.panel, 1)
assert(#E.Cooldowns.Rows() == 0, 'the roster option also controls cooldown reads and display')
assert(not tracker.panel.shown)
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
assert(#rows == 3 and rows[1].name == 'Transmute: Fire to Earth' and rows[1].remaining == 2000)
assert(rows[2].name == 'Another learned craft' and rows[2].remaining == 3000)
assert(rows[3].name == 'Mooncloth', 'old aggregate does not display a phantom timer')
local panel = Everloot.Cooldowns.tracker.panel
assert(not panel.shown and panel.point[4] == -120 and panel.point[5] == -280, 'visibility and position survive reload')
now = now + 2001
assert(Everloot.Cooldowns.Rows()[3].state == 'ready')
""")

print("Profession cooldown contract PASS")
