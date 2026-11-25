"""Crafting estimates follow the selected recipe in Forever's native schematic form."""
from pathlib import Path
from window_world import fresh

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert toc.index("modules\\view_professions.lua") < toc.index("modules\\native_crafting.lua")
lua = fresh("{ installId = 'abcd-1234', records = {} }", """
function hooksecurefunc(object, key, callback)
  local original = object[key]
  object[key] = function(self, ...) original(self, ...); callback(self, ...) end
end
function fireNative(event, name)
  for _, frame in ipairs(created) do
    if frame.events[event] and frame.onEvent then frame:onEvent(event, name) end
  end
end
function openProfessions()
  form = CreateFrame('Frame')
  form.GetBottom = function() return 100 end
  form.GetLeft = function() return 0 end
  form.IsVisible = function(self) return self.shown end
  form.isInspection, form.transaction = false, false
  form.Reagents = { IsShown = function() return true end, GetBottom = function() return 270 end }
  form.OptionalReagents, form.FinishingReagents, form.Concentrate, form.AllocateBestQualityCheckbox = false, false, false, false
  form.TrackRecipeCheckbox = { IsShown = function() return true end, GetLeft = function() return 222 end }
  function form:GetRecipeInfo() return self.selected end
  function form:Init(recipe, schematic) self.selected, self.recipeSchematic = recipe, schematic end
  ProfessionsFrame = { CraftingPage = { SchematicForm = form } }
end
function panel()
  local matches = {}
  for _, frame in ipairs(created) do
    if frame.kind == 'Button' and frame.parent == form then matches[#matches + 1] = frame end
  end
  assert(#matches == 1, 'one estimate inside the native form')
  return matches[1]
end
EverlootPricesDB = {}
priceStatus = 'ready'
priceDate = '2026-10-30'
C_Item = { GetItemNameByID = function(id) return ({ 'Raw Brilliant Smallfish', 'Thorium Bar', 'Arcane Crystal' })[id] end }
GameTooltip = { lines = {} }
function GameTooltip:SetOwner(owner) self.owner, self.lines = owner, {} end
function GameTooltip:IsOwned(owner) return self.owner == owner end
function GameTooltip:AddLine(text) table.insert(self.lines, text) end
function GameTooltip:Show() self.shown = true end
function GameTooltip:Hide() self.shown = false; self.owner = nil end
function slot(id, count)
  return { required = true, dataSlotType = 1, reagentType = 1, quantityRequired = count, reagents = { { itemID = id } } }
end
""")
lua.execute("""
local prices = { [1] = 200, [2] = 500, [3] = 700, [4] = 900 }
function Everloot:CommunityPrice(realm, id)
  if priceStatus == 'ready' and prices[id] then return { market = prices[id] } end
end
function Everloot:PriceFile(realm) return { status = priceStatus, house = 'Alliance', asOf = priceDate } end
""")
lua.execute((root / "modules" / "native_crafting.lua").read_text(encoding="utf-8"))
lua.execute("""
local money = Everloot.Window.Money
local function hover()
  panel().scripts.OnEnter(panel())
  return table.concat(GameTooltip.lines, '\\n')
end
local function rendered(text)
  for _, field in pairs(panel()) do
    if type(field) == 'table' and type(rawget(field, 'text')) == 'string'
      and field.text:find(text, 1, true) then return true end
  end
  return false
end
openProfessions()
fireNative('ADDON_LOADED', 'Blizzard_Professions')
fireNative('TRADE_SKILL_SHOW')
local fish = { recipeID = 7751, name = 'Brilliant Smallfish', learned = true }
local fishSchematic = { outputItemID = 4, quantityMin = 2, quantityMax = 2, reagentSlotSchematics = { slot(1, 1) } }
form:Init(fish, fishSchematic)
drain()
assert(panel().shown and rendered(money(200)) and rendered('+' .. money(1510)),
  'visible cost and two-item profit after AH cut: ' .. tostring(panel().shown)
  .. ' / ' .. tostring(panel().cost.text) .. ' / ' .. tostring(panel().profit.text))
assert(panel().point[2] == form.Reagents, 'the summary anchors below the reagent list when there is room')
local details = hover()
assert(details:find('Raw Brilliant Smallfish', 1, true) and details:find('Alliance', 1, true), details)
assert(details:find('5%', 1, true), details)

form:Init({ recipeID = 17187, name = 'Transmute: Arcanite', learned = true },
  { outputItemID = 4, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(2, 1), slot(3, 1) } })
drain()
assert(panel().cost.text == 'Cost per craft: ' .. money(1200) and rendered(money(-345)), 'recipe change replaces estimates')
details = hover()
assert(details:find('Thorium Bar', 1, true) and details:find('Arcane Crystal', 1, true), details)
assert(not details:find('Raw Brilliant Smallfish', 1, true), details)

local missing = slot(8, 1)
C_Item.GetItemNameByID = function(id) if id == 8 then return 'Missing Reagent' end end
form:Init(fish, { outputItemID = 4, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { missing } })
drain()
assert(rendered('Unavailable') and not rendered(money(-345)), 'missing price clears old value')
details = hover()
assert(details:find('Missing Reagent', 1, true) and details:find('No price', 1, true), details)

local alternative = slot(2, 1)
alternative.reagents[2] = { itemID = 3 }
form:Init(fish, { outputItemID = 4, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { alternative } })
drain()
assert(rendered('Unavailable') and hover():find('multiple reagents', 1, true), 'no assumed price for alternative reagents')
form:Init(nil)
drain()
assert(not panel().shown and not GameTooltip.shown, 'clearing the selection hides the estimate and tooltip')

form:Init(fish, fishSchematic)
fireNative('TRADE_SKILL_SHOW')
drain()
assert(panel().shown and rendered('+' .. money(1510)), 'reopening reuses the same estimate')

priceStatus = 'verifying'
form:Init(fish, fishSchematic)
table.remove(timers, 1)()
assert(rendered('Checking prices...'), 'price file is still being verified')
priceStatus = 'ready'
drain()
assert(rendered('+' .. money(1510)), 'the open window refreshes after price verification')

priceDate = '2026-10-25'
form:Init(fish, fishSchematic)
drain()
assert(rendered('Old prices') and hover():find('2026-10-25', 1, true), 'stale estimates are labelled in the window')
form.Reagents.GetBottom = function() return 155 end
form:Init(fish, fishSchematic)
drain()
assert(panel().shown and panel().point[1] == 'BOTTOMLEFT' and panel().point[2] == form
  and panel().point[4] + panel().width < form.TrackRecipeCheckbox:GetLeft(),
  'a longer reagent list puts the estimate in the footer beside Track Recipe')
form.Reagents.GetBottom = function() return 125 end
form:Init(fish, fishSchematic)
drain()
assert(not panel().shown, 'a crowded form keeps Blizzard controls clear')
""")
print("native crafting contract PASS")
