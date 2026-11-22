"""Public player progress uses the exact character and has a short lifetime."""
from window_world import fresh

lua = fresh("{ installId = 'abcd-1234', toggles = { completion = true }, records = {} }", """
date = os.date
clock = 100
time = function() return clock end
realm = 'Forever US1 PvE'
GetRealmName = function() return realm end
guid = 'Player-123-0002'
UnitGUID = function(unit) return unit == 'player' and 'Player-123-0001' or guid end
UnitIsPlayer = function() return true end
first, last = 'Mira', 'Dawn'
UnitName = function() return first, last end
lines = {}
GameTooltip = {
  GetUnit = function() return nil, 'mouseover' end,
  AddLine = function(_, text) table.insert(lines, text) end,
  HookScript = function(self, key, fn) self[key] = fn end,
}
TooltipDataProcessor = { AddTooltipPostCall = function(_, fn) hover = fn end }
Enum = { TooltipDataType = { Unit = 2 } }
GameTooltip_InsertFrame = function(_, frame)
  insertions = (insertions or 0) + 1
  assert(frame:GetHeight() == 3 and frame:GetWidth() <= 80)
  inserted = frame
  frame:Show()
end
""", window=False, extra=("modules/instance_data.lua", "modules/player_progress.lua"))
lua.execute("""
local c = Everloot.InstanceData
EverlootProgressDB = { ['forever us1 pve'] = { expiresAt = 200,
  total = 3, catalog = c.build .. '/' .. c.asOf, players = { ['Mira Dawn'] = 1, ['Mira Vale'] = 0 } } }
hover(GameTooltip)
hover(GameTooltip)
assert(#lines == 1 and lines[1] == 'Everloot  1/3 dungeons')
assert(insertions == 1 and inserted.value == 1 and inserted.hi == 3 and inserted:IsShown())
GameTooltip.OnTooltipCleared()
assert(not inserted:IsShown())
last = 'Vale'
hover(GameTooltip)
assert(#lines == 2 and lines[2] == 'Everloot  0/3 dungeons')
assert(inserted.value == 0)
GameTooltip.OnTooltipCleared()
last = 'Missing'
hover(GameTooltip)
assert(#lines == 2)
last = 'Dawn'
guid = 'Player-456-0002'
hover(GameTooltip)
assert(#lines == 2)
guid = 'Player-123-0002'
realm = ''
hover(GameTooltip)
assert(#lines == 2)
realm = 'Forever US1 PvE'
clock = 200
hover(GameTooltip)
assert(#lines == 2)
""")
print("Player tooltip progress contract passed")
