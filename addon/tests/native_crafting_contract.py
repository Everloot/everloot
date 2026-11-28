"""Crafting estimates follow the selected recipe in Forever's native schematic form."""
from pathlib import Path
from window_world import fresh

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert toc.index("modules\\view_professions.lua") < toc.index("modules\\native_crafting.lua")
NATIVE_API = """
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
"""
PRICES = """
local prices = { [1] = 200, [2] = 500, [3] = 700, [4] = 900 }
function Everloot:CommunityPrice(realm, id)
  if priceStatus == 'ready' and prices[id] then return { market = prices[id], day = priceDay } end
end
function Everloot:PriceFile(realm) return { status = priceStatus, house = 'Alliance', asOf = priceDate } end
"""


def native_world():
    world = fresh("{ installId = 'abcd-1234', records = {} }", NATIVE_API)
    world.execute(PRICES)
    for name in ("native_crafting.lua", "native_recipes.lua"):
        world.execute((root / "modules" / name).read_text(encoding="utf-8"))
    return world


assert toc.index("modules\\native_crafting.lua") < toc.index("modules\\native_recipes.lua"), \
    "the recipe list helper loads after the schematic estimate it shares a reader with"
lua = native_world()
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
-- Reagent detail: unit and line totals with the quote's source; both destinations, the selected one named.
assert(details:find('1 x Raw Brilliant Smallfish: ' .. money(200) .. ' each, ' .. money(200) .. ' (community)', 1, true),
  details)
assert(details:find('At the AH: ' .. money(1800) .. ' - 5% cut: ' .. money(90) .. ' - materials: ' .. money(200)
  .. ' = ' .. money(1510) .. ' profit', 1, true), details)
assert(details:find('To a vendor: no verified sell price for the finished item.', 1, true), details)
assert(details:find('Tags and sorting: AH', 1, true), details)

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
assert(details:find('Missing Reagent', 1, true) and details:find('No price', 1, true)
  and details:find('Finished item: ' .. money(900), 1, true), details)

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

local today = Everloot.DayNumber('2026-10-30') * 86400
time = function() return today + 3600 end
local recentScan = { at = time() - 60, house = 'Alliance', items = { [4] = { 4, 6, 24, 380, 400 } } }
function Everloot:OwnScan(realm, house) return recentScan end
Everloot.RefreshNativeCrafting()
drain()
assert(rendered('+' .. money(560)) and panel().cost.text == 'Cost per craft: ' .. money(200),
  'fresh scan updates the open recipe and community quote fills missing reagent')
details = hover()
assert(details:find('24 units listed', 1, true) and details:find(money(380), 1, true)
  and details:find('Alliance scan', 1, true) and details:find('Community', 1, true), details)
recentScan.house = 'Horde'
Everloot.RefreshNativeCrafting()
drain()
assert(rendered('+' .. money(1510)), 'a different house does not set the margin')
recentScan.house, recentScan.at = 'Alliance', time() - 86401
Everloot.RefreshNativeCrafting()
drain()
assert(rendered('+' .. money(1510)), 'an older scan does not replace the community quote')
priceDay, recentScan.at = '2026-10-30', today - 60
Everloot.RefreshNativeCrafting()
drain()
assert(rendered('+' .. money(1510)), 'a fresh scan from before the item observation day keeps the newer community quote')
recentScan = nil

priceDay = '2026-10-26'
form:Init(fish, fishSchematic)
drain()
assert(rendered('Old prices') and hover():find('community Oct 26, 4 days ago', 1, true), 'an individual quote can be old in a recent file')
priceDay = nil

priceDate = '2026-10-25'
form:Init(fish, fishSchematic)
drain()
assert(rendered('Old prices') and hover():find('2026-10-25', 1, true), 'stale estimates are labelled in the window')
recentScan = { at = time() - 60, house = 'Alliance', items = { [1] = { 1, 3, 9, 160, 200 }, [4] = { 4, 6, 24, 380, 400 } } }
Everloot.RefreshNativeCrafting()
drain()
assert(rendered('+' .. money(560)) and not rendered('Old prices'), 'an unused old fallback does not mark fresh scan prices old')
recentScan = nil
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

# The recipe list: tags on recycled rows and the docked Everloot profit list beside the window.
lua = native_world()
lua.execute("""
guid = 'Player-1-0000AAAA'
UnitGUID = function() return guid end
recipesInfo = {
  [7751] = { recipeID = 7751, name = 'Brilliant Smallfish', learned = true },
  [7752] = { recipeID = 7752, name = 'Brilliant Smallfish', learned = true },
  [17187] = { recipeID = 17187, name = 'Transmute: Arcanite', learned = true },
  [9001] = { recipeID = 9001, name = 'Aardvark Unknown', learned = true },
  -- Two ranks: the list's node is rank 1, the schematic and the row label use the highest learned rank.
  [8001] = { recipeID = 8001, name = 'Bolt of Fine Thread', learned = true, nextRecipeID = 8002 },
  [8002] = { recipeID = 8002, name = 'Bolt of Fine Thread', learned = true, previousRecipeID = 8001 },
}
Professions = { GetHighestLearnedRecipe = function(info) if info.recipeID == 8001 then return recipesInfo[8002] end end }
schematics = {
  [7751] = { outputItemID = 4, quantityMin = 2, quantityMax = 2, reagentSlotSchematics = { slot(1, 1) } },
  [7752] = { outputItemID = 4, quantityMin = 2, quantityMax = 2, reagentSlotSchematics = { slot(1, 1) } },
  [17187] = { outputItemID = 4, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(2, 1), slot(3, 1) } },
  [9001] = { outputItemID = 4, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(8, 1) } },
  [8002] = { outputItemID = 4, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(1, 1) } },
}
-- The game opens a recipe only when its own search and filters show it, then answers either way.
opened, nativeHides, schematicReads = {}, {}, 0
C_TradeSkillUI = {
  GetRecipeSchematic = function(id, recraft) schematicReads = schematicReads + 1; assert(recraft == false); return schematics[id] end,
  OpenRecipe = function(id)
    opened[#opened + 1] = id
    local found
    provider:ForEach(function(n)
      local info = n.data.recipeInfo
      if info and info.recipeID == id then found = info end
    end, false)
    if found and not nativeHides[id] then
      local high = Professions.GetHighestLearnedRecipe(found) or found
      form:Init(high, schematics[high.recipeID])
    end
    fireNative('OPEN_RECIPE_RESPONSE', id)
  end,
}
-- The recipe list's ScrollBox: recycled row frames, a tree data provider, ScrollUtil's frame callbacks.
box = CreateFrame('Frame')
box.inits, box.releases, box.frames = {}, {}, {}
provider = { nodes = {} }
function provider:ForEach(fn, excludeCollapsed)
  for _, n in ipairs(self.nodes) do if not (excludeCollapsed and n.collapsed) then fn(n) end end
end
function box:GetDataProvider() return provider end
function box:ForEachFrame(fn) for _, f in ipairs(self.frames) do if f.node then fn(f, f.node) end end end
ScrollUtil = {
  AddInitializedFrameCallback = function(scroll, cb, owner, iterateExisting)
    table.insert(scroll.inits, { cb, owner })
    scroll.iterateExisting = iterateExisting
    if iterateExisting then scroll:ForEachFrame(cb) end
  end,
  AddReleasedFrameCallback = function(scroll, cb, owner) table.insert(scroll.releases, { cb, owner }) end,
}
function node(data) return { data = data, GetData = function(self) return self.data end } end
function rowFrame()
  local f = CreateFrame('Button')
  f.GetElementData = function(self) return self.node end
  table.insert(box.frames, f)
  return f
end
function bind(f, n) f.node = n; for _, c in ipairs(box.inits) do c[1](c[2], f, n) end end
function release(f) local old = f.node; f.node = nil; for _, c in ipairs(box.releases) do c[1](c[2], f, old) end end
openProfessions()
ProfessionsFrame = CreateFrame('Frame')
ProfessionsFrame.CraftingPage = { SchematicForm = form, RecipeList = { ScrollBox = box } }
form.shown = true
fishNode, fish2Node = node({ recipeInfo = recipesInfo[7751] }), node({ recipeInfo = recipesInfo[7752] })
arcNode, unknownNode = node({ recipeInfo = recipesInfo[17187] }), node({ recipeInfo = recipesInfo[9001] })
unknownNode.collapsed = true
fishCategory = node({ categoryInfo = { name = 'Fish' } })
provider.nodes = { node({ recipeInfo = recipesInfo[7751], favoritesInstance = true }), fishCategory, fishNode, fish2Node,
  arcNode, node({ categoryInfo = { name = 'Odd' } }), unknownNode, node({ isDivider = true }) }
""")
lua.execute("""
local N = Everloot.NativeRecipes
local U = Everloot.Window
local short = U.MoneyShort
local function frames()
  local list = {}
  for _, f in ipairs(created) do
    if f.parent == ProfessionsFrame and f.template == 'BackdropTemplate' then list[#list + 1] = f end
  end
  return list
end
local function listed(p)
  local ids = {}
  for _, line in ipairs(p.rows) do if line.shown and line.estimate then ids[#ids + 1] = line.estimate.id end end
  return table.concat(ids, ',')
end
local function rowOf(p, id)
  for _, line in ipairs(p.rows) do if line.shown and line.estimate and line.estimate.id == id then return line end end
end
local r0 = rowFrame()
r0.node = fishNode
fireNative('ADDON_LOADED', 'Blizzard_Professions')
fireNative('TRADE_SKILL_SHOW')
drain()
-- A row bound before the hook gets its tag from its own element data; the iterate pass is not relied on, since the
-- client calls it as (frame, elementData) without the owner the live callback receives.
assert(N.TagOf(r0) and N.TagOf(r0).shown and N.TagOf(r0).text == '+' .. short(1510), 'a row bound before the hook')
assert(not box.iterateExisting, 'existing rows are tagged by the refresh, not by the differently called iterate pass')
release(r0)
-- Opening the window again adds no second list or second set of callbacks.
fireNative('TRADE_SKILL_SHOW')
fireNative('ADDON_LOADED', 'Blizzard_Professions')
drain()
assert(#box.inits == 1 and #box.releases == 1, 'one set of ScrollBox callbacks')
assert(#frames() == 2, 'one docked list and one notice, however often the window opens: ' .. #frames())
local p, notice = N.Frames()
assert(p.shown and not notice.shown and p.title.text:find('Everloot', 1, true), 'the docked list says it is Everloot')

-- Profit order; the favourite copy once; a recipe in a collapsed category still listed; unknown profit last.
assert(listed(p) == '7751,7752,17187,9001', listed(p))
assert(rowOf(p, 7751).tag.text == '+' .. short(1510), rowOf(p, 7751).tag.text)
assert(rowOf(p, 17187).tag.text == short(-345) and rowOf(p, 17187).tag.text:sub(1, 1) == '-', 'a loss is signed')
assert(rowOf(p, 9001).tag.text == 'no price', 'a missing reagent price is said, never zero')

-- A recycled row: each bind shows its own recipe; a category, divider or release clears it.
local r1 = rowFrame()
bind(r1, fishNode)
assert(N.TagOf(r1).shown and N.TagOf(r1).text == '+' .. short(1510), tostring(N.TagOf(r1).text))
bind(r1, fishCategory)
assert(not N.TagOf(r1).shown, 'a row rebound to a category loses the recipe tag')
bind(r1, arcNode)
assert(N.TagOf(r1).shown and N.TagOf(r1).text == short(-345), 'the same frame shows the new recipe')
bind(r1, provider.nodes[8])
assert(not N.TagOf(r1).shown, 'a divider has no tag')
bind(r1, arcNode)
release(r1)
assert(not N.TagOf(r1).shown, 'a released row keeps no tag')
-- Collapsing a category releases its rows; the next category bound to that frame stays clear.
bind(r1, fishNode)
release(r1)
bind(r1, fishCategory)
assert(not N.TagOf(r1).shown, 'collapsed category')
bind(r1, fishNode)

-- Gold/margin/both are selectable in Everloot's list. Native rows retain one compact figure in both mode.
local tagWidth = rawget(N.TagOf(r1), 'width')
assert(type(tagWidth) == 'number' and tagWidth <= 100, 'a row tag has a bounded width: ' .. tostring(tagWidth))
p.tagMode.scripts.OnClick()
assert(p.tagMode.text == 'Tags: margin' and N.TagOf(r1).text == '+755%', tostring(N.TagOf(r1).text))
p.tagMode.scripts.OnClick()
assert(p.tagMode.text == 'Tags: both', 'both figures are selectable in the docked list')
assert(rowOf(p, 7751).tag.text == '+' .. short(1510) .. ' +755%', 'both figures are visible without hovering')
assert(N.TagOf(r1).text == '+' .. short(1510), 'native rows keep a compact money figure in both mode')
p.tagMode.scripts.OnClick()
assert(p.tagMode.text == 'Tags: gold' and N.TagOf(r1).text == '+' .. short(1510), tostring(N.TagOf(r1).text))
rowOf(p, 7751).scripts.OnEnter(rowOf(p, 7751))
assert(table.concat(GameTooltip.lines, '|'):find('+' .. short(1510) .. ' +755%', 1, true), 'both figures in the hover')

-- Name sort, then profitable only (losses and unknown profit dropped).
p.sort.scripts.OnClick()
assert(p.sort.text == 'Sort: name' and listed(p) == '9001,7751,7752,17187', listed(p))
p.sort.scripts.OnClick()
p.filter.scripts.OnClick()
assert(p.filter.text == 'Show all' and listed(p) == '7751,7752', listed(p))

-- The native selection survives Everloot's filter: the list hides the loss, the schematic keeps it.
form:Init(recipesInfo[17187], schematics[17187])
drain()
assert(form.selected.recipeID == 17187 and #opened == 0, 'filtering never changes the native selection')
assert(p.status.text:find('hidden by Profitable only', 1, true), p.status.text)
p.filter.scripts.OnClick()
drain()
assert(listed(p) == '7751,7752,17187,9001' and rowOf(p, 17187).selection.shown and not rowOf(p, 7751).selection.shown,
  'the selected recipe is highlighted again')

-- Clicking a row opens it through the game's recipe API.
local first = rowOf(p, 7751)
first.scripts.OnClick(first)
drain()
assert(opened[1] == 7751 and form.selected.recipeID == 7751 and p.status.text == 'Showing Brilliant Smallfish.', p.status.text)
-- A recipe the window's own filters hide: asked for, not opened, and said.
nativeHides[7752] = true
local second = rowOf(p, 7752)
second.scripts.OnClick(second)
drain()
assert(opened[2] == 7752 and form.selected.recipeID == 7751, 'the native selection is unchanged')
assert(p.status.text:find("hidden by the profession window's search or filters", 1, true), p.status.text)
-- A recipe gone from the window's list since the list was drawn is not asked for.
local gone = rowOf(p, 9001)
provider.nodes[7] = node({ categoryInfo = { name = 'Empty' } })
gone.scripts.OnClick(gone)
drain()
assert(#opened == 2 and p.status.text:find('Aardvark Unknown is hidden', 1, true), p.status.text)
assert(listed(p) == '7751,7752,17187', listed(p))
provider.nodes[7] = unknownNode

-- The player picks another recipe in Blizzard's own list: the last open message no longer applies.
first.scripts.OnClick(first)
drain()
assert(p.status.text == 'Showing Brilliant Smallfish.', p.status.text)
form:Init(recipesInfo[17187], schematics[17187])
drain()
assert(not p.status.text:find('Showing', 1, true), 'a native selection clears the stale message: ' .. p.status.text)
-- The same recipe drawn again keeps it.
first.scripts.OnClick(first)
drain()
form:Init(recipesInfo[7751], schematics[7751])
drain()
assert(p.status.text == 'Showing Brilliant Smallfish.', p.status.text)
-- Another profession in the same window: nothing from the last one is said.
fireNative('TRADE_SKILL_DATA_SOURCE_CHANGED')
drain()
assert(p.status.text == '', 'a profession switch clears the message: ' .. p.status.text)

-- A recipe with two ranks: priced and shown at the highest learned rank, opened by the list's own (first-rank) ID,
-- which is the one the game finds.
provider.nodes[#provider.nodes + 1] = node({ recipeInfo = recipesInfo[8001] })
Everloot.RefreshNativeCrafting()
drain()
local ranked = rowOf(p, 8002)
assert(ranked and not rowOf(p, 8001), 'the list prices the highest learned rank')
ranked.scripts.OnClick(ranked)
drain()
assert(opened[#opened] == 8001 and form.selected.recipeID == 8002 and p.status.text == 'Showing Bolt of Fine Thread.',
  tostring(opened[#opened]) .. ' / ' .. p.status.text)
provider.nodes[#provider.nodes] = nil
form:Init(recipesInfo[7751], schematics[7751])
Everloot.RefreshNativeCrafting()
drain()

-- The price file is still being checked: tags and the list say so, then fill in.
priceStatus = 'verifying'
Everloot.RefreshNativeCrafting()
assert(N.TagOf(r1).text == 'checking' and p.prices.text == 'Checking the price file...', tostring(N.TagOf(r1).text))
priceStatus = 'ready'
drain()
assert(N.TagOf(r1).text == '+' .. short(1510) and p.prices.text ~= 'Checking the price file...', N.TagOf(r1).text)

-- A large file on a slow machine: the check takes over ten seconds and the tags still fill in afterwards.
local after, waited = C_Timer.After, 0
local readsBeforeCheck = schematicReads
C_Timer.After = function(seconds, f) waited = waited + seconds; after(seconds, f) end
priceStatus = 'verifying'
Everloot.RefreshNativeCrafting()
while waited < 30 and #timers > 0 do table.remove(timers, 1)() end
assert(waited >= 30 and N.TagOf(r1).text == 'checking', 'still asking after ' .. waited .. ' s')
assert(schematicReads - readsBeforeCheck <= 4, 'price verification must not repeatedly reread unchanged schematics')
priceStatus = 'ready'
drain()
C_Timer.After = after
assert(N.TagOf(r1).text == '+' .. short(1510) and p.prices.text ~= 'Checking the price file...',
  'a long check still ends in prices: ' .. tostring(N.TagOf(r1).text))

-- A check still pending when the window closes draws nothing afterwards.
priceStatus = 'verifying'
Everloot.RefreshNativeCrafting()
assert(#timers > 0, 'a check is pending')
ProfessionsFrame:Hide()
fireNative('TRADE_SKILL_CLOSE')
priceStatus = 'ready'
drain()
assert(not N.TagOf(r1).shown and not p.shown, 'a late check after closing leaves the closed window alone')
ProfessionsFrame:Show()
fireNative('TRADE_SKILL_SHOW')
drain()
assert(N.TagOf(r1).shown and p.shown and N.TagOf(r1).text == '+' .. short(1510), 'reopening draws fresh tags')

-- Near the right edge of the screen the list docks on the window's left side instead of going off screen.
assert(p.point[1] == 'TOPLEFT' and p.point[3] == 'TOPRIGHT', 'docked on the right by default')
ProfessionsFrame.GetRight = function() return 1800 end
Everloot.RefreshNativeCrafting()
drain()
assert(p.point[1] == 'TOPRIGHT' and p.point[2] == ProfessionsFrame and p.point[3] == 'TOPLEFT',
  'no room on the right: docked on the left')
ProfessionsFrame.GetRight = nil
Everloot.RefreshNativeCrafting()
drain()
assert(p.point[1] == 'TOPLEFT', 'back on the right')

-- Old prices are said in words on the row tag and in the list.
priceDay = '2026-10-26'
Everloot.RefreshNativeCrafting()
drain()
assert(N.TagOf(r1).text == 'old +' .. short(1510) and rowOf(p, 7751).tag.text:find('^old '), N.TagOf(r1).text)
priceDay = nil
Everloot.RefreshNativeCrafting()
drain()

-- Decorations belong to the crafting page, not another tab in the profession window.
ProfessionsFrame.CraftingPage.IsShown = function() return false end
N.Refresh()
assert(not p.shown and not N.TagOf(r1).shown, 'non-crafting pages hide Everloot crafting decorations')
ProfessionsFrame.CraftingPage.IsShown = nil
N.Refresh()
assert(p.shown and N.TagOf(r1).shown, 'returning to crafting restores the decorations')

-- One destination for the list, the row tags, the order and the schematic's Details. Switching it reprices the
-- estimates without reading the schematics again; the vendor value is the client's sell price, never a guess.
sellPrices = { [4] = 1000 }
C_Item.GetItemInfo = function(id)
  local sell = sellPrices[id]
  if sell == nil then return end
  return 'Item ' .. id, 'link', 1, 10, 1, 'Trade Goods', 'Cloth', 20, '', 1, sell, 7, 0
end
local money = U.Money
local function hover()
  panel().scripts.OnEnter(panel())
  return table.concat(GameTooltip.lines, '\\n')
end
local reads = schematicReads
assert(p.destination and p.destination.text == 'Sell: AH', tostring(p.destination and p.destination.text))
p.destination.scripts.OnClick()
drain()
assert(p.destination.text == 'Sell: vendor' and Everloot.Options.CraftDestination() == 'vendor', p.destination.text)
assert(N.TagOf(r1).text == '+' .. short(1800), 'vendor tag: ' .. tostring(N.TagOf(r1).text))
assert(rowOf(p, 17187).tag.text == short(-200) and rowOf(p, 9001).tag.text == 'no price', rowOf(p, 17187).tag.text)
assert(listed(p) == '7751,7752,17187,9001', listed(p))
assert(schematicReads == reads, 'a destination change reprices without reading schematics again')
form:Init(recipesInfo[7751], schematics[7751])
drain()
assert(panel().profit.text:find(money(1800), 1, true), 'the schematic summary follows the destination: ' .. panel().profit.text)
local tip = hover()
assert(tip:find('To a vendor: ' .. money(2000) .. ' - materials: ' .. money(200) .. ' = ' .. money(1800) .. ' profit', 1, true)
  and tip:find('At the AH: ' .. money(1800), 1, true) and tip:find('Tags and sorting: vendor', 1, true), tip)
-- An item the client has not loaded yet: checking, then the price once it loads.
sellPrices[4] = nil
Everloot.RefreshNativeCrafting()
assert(N.TagOf(r1).text == 'checking', 'an unloaded sell price is checked again: ' .. tostring(N.TagOf(r1).text))
sellPrices[4] = 1000
drain()
assert(N.TagOf(r1).text == '+' .. short(1800), 'the loaded sell price fills in: ' .. tostring(N.TagOf(r1).text))
-- Slow item data must also recover in the selected schematic after its initial fast retries.
local after, waited = C_Timer.After, 0
C_Timer.After = function(seconds, f) waited = waited + seconds; after(seconds, f) end
sellPrices[4] = nil
Everloot.RefreshNativeCrafting()
while waited < 10 and #timers > 0 do table.remove(timers, 1)() end
local waitingAfter, nextTick = C_Timer.After, {}
C_Timer.After = function(delay, callback)
  if delay == 0 then nextTick[#nextTick + 1] = callback end
  waitingAfter(delay, callback)
end
form:Init(recipesInfo[17187], schematics[17187])
for _, callback in ipairs(nextTick) do callback() end
assert(panel().estimate.id == 17187, 'a new selection refreshes before the previous slow retry')
C_Timer.After = waitingAfter
form:Init(recipesInfo[7751], schematics[7751])
sellPrices[4] = 1000
drain()
C_Timer.After = after
assert(panel().profit.text:find(money(1800), 1, true), 'slow-loaded sell price refreshes the schematic summary')
p.destination.scripts.OnClick()
drain()
assert(p.destination.text == 'Sell: AH' and N.TagOf(r1).text == '+' .. short(1510), tostring(N.TagOf(r1).text))
C_Item.GetItemInfo = nil

-- Another addon's prices (crafting_sources.lua): the list names TSM with its unknown age and market and reprices
-- with it; TSM gone is said, never Everloot's prices under TSM's name; the Prices button moves to the fallback.
TSM_API = { IsCustomPriceValid = function() return true end,
  ToItemString = function(item) return 'i:' .. item:match('%d+') end,
  GetCustomPriceValue = function(_, s) return ({ ['i:1'] = 300, ['i:4'] = 1000 })[s] end }
Everloot.Options.SetCraftSource('tsm', false)
drain()
assert(p.prices.text == 'Prices: TSM AHDBMedianBuyout, age and market unknown', p.prices.text)
assert(N.TagOf(r1).text == '+' .. short(1600), 'TSM-priced tag: ' .. tostring(N.TagOf(r1).text))
TSM_API = nil
Everloot.RefreshNativeCrafting()
drain()
assert(p.prices.text == 'Prices: TSM unavailable (not loaded)', p.prices.text)
assert(N.TagOf(r1).text == 'no price', 'no TSM, no fallback: unknown, not ' .. tostring(N.TagOf(r1).text))
assert(p.source and p.source.text == 'Prices', 'a Prices button in the list')
p.source.scripts.OnClick()
drain()
assert(Everloot.Options.CraftSource() == 'tsm' and select(2, Everloot.Options.CraftSource()) == true)
assert(p.prices.text == 'Prices: TSM unavailable (not loaded), else Everloot', p.prices.text)
assert(N.TagOf(r1).text == '+' .. short(1510), 'the fallback prices with Everloot: ' .. tostring(N.TagOf(r1).text))
p.source.scripts.OnClick()
drain()
assert(Everloot.Options.CraftSource() == 'everloot' and not p.prices.text:find('TSM', 1, true), p.prices.text)

-- Collect data only (the Everloot window off) wins over everything, a character's own choice included.
Everloot.Options.SetNativeCrafting(true)
EverlootDB.toggles.window = false
Everloot.RefreshNativeCrafting()
drain()
assert(not p.shown and not notice.shown and not N.TagOf(r1).shown and not panel().shown, 'recorder-only shows nothing')
assert(select(2, Everloot.Crafting.NativeEnabled()) == 'recorder')
EverlootDB.toggles.window = nil
EverlootDB.nativeCrafting = nil
Everloot.RefreshNativeCrafting()
drain()
assert(p.shown and panel().shown and N.TagOf(r1).shown)

-- CraftProfit loaded: off by default, says why, and offers this character an override.
loadedAddons = { CraftProfit = true }
C_AddOns = { IsAddOnLoaded = function(name) return loadedAddons[name] == true end }
Everloot.RefreshNativeCrafting()
drain()
assert(not p.shown and not N.TagOf(r1).shown and not panel().shown, 'CraftProfit keeps its own display')
assert(notice.shown and notice.text.text:find('CraftProfit is loaded', 1, true), tostring(notice.text.text))
assert(select(2, Everloot.Crafting.NativeEnabled()) == 'craftprofit')
notice.show.scripts.OnClick()
drain()
local key = Everloot.CharacterKey()
assert(EverlootDB.nativeCrafting[key] == true and p.shown and not notice.shown and N.TagOf(r1).shown and panel().shown,
  'the explicit choice wins over the detection default')
guid = 'Player-1-0000BBBB'
Everloot.RefreshNativeCrafting()
drain()
assert(not p.shown and notice.shown, 'another character has not chosen')
guid = 'Player-1-0000AAAA'
loadedAddons = {}
Everloot.RefreshNativeCrafting()
drain()
assert(p.shown)
p.off.scripts.OnClick()
drain()
assert(EverlootDB.nativeCrafting[key] == false and not p.shown and notice.shown
  and notice.text.text:find('off for this character', 1, true), 'turned off here stays off, with a way back')
assert(not U.failed)
""")

# The cheapest route for one craft, as a comparison in Details: the summary, tags and sorting keep buying every reagent.
# The real default: the generated client cooldown data at a matching build, no injected evidence. Recipe 2963 (covered,
# no cooldown recorded) makes one Raw Brilliant Smallfish from item 5, which a vendor this install visited sells for 50c:
# one item for money alone, so this install keeps it as a unit price beside its public vendor row.
lua = fresh("{ installId = 'abcd-1234', records = { vendor = { { vendorNpcId = 1, items = { { itemId = 5, priceCopper = 50 } } } } } }",
            NATIVE_API + "UnitGUID = function() return 'Player-1-0001' end\n"
            + "GetBuildInfo = function() return '1.60.1', '71139' end\n",
            extra=("modules/recipe_cooldown_data.lua", "modules/crafting_plan.lua"))
lua.execute(PRICES)
lua.execute("unitEvidence({ [5] = 50 })")
for name in ("native_crafting.lua", "native_recipes.lua"):
    lua.execute((root / "modules" / name).read_text(encoding="utf-8"))
lua.execute("""
local E, money = Everloot, Everloot.Window.Money
local function known(recipeId)
  EverlootDB.craftingKnown = { [E.CharacterKey()] = { [185] = { complete = false, recipes = { [recipeId] = {
    recipeId = recipeId, learned = true, itemId = 1, minimum = 1, maximum = 1, reagents = { { itemId = 5, count = 1 } },
    cooldownReturned = false, cooldownCheckedAt = time() - 60 } } } } }
end
local function details()
  panel().scripts.OnEnter(panel())
  return table.concat(GameTooltip.lines, '\\n')
end
known(2963)
openProfessions()
fireNative('ADDON_LOADED', 'Blizzard_Professions')
fireNative('TRADE_SKILL_SHOW')
local fish = { recipeID = 7751, name = 'Brilliant Smallfish', learned = true }
form:Init(fish, { outputItemID = 4, quantityMin = 2, quantityMax = 2, reagentSlotSchematics = { slot(1, 1) } })
drain()
assert(panel().cost.text == 'Cost per craft: ' .. money(200), 'the summary still buys every reagent: ' .. panel().cost.text)
local said = details()
assert(said:find('Cheapest route: ' .. money(50) .. ' (buying all: ' .. money(200) .. '), make Raw Brilliant Smallfish: 1 craft',
  1, true), said)
assert(said:find('Assumes: no cooldown recorded in client data, build 1.60.1.71139', 1, true), said)
assert(said:find('could not be read', 1, true) and said:find('server changes', 1, true) and not said:lower():find('unlimited'), said)
-- Another build: fail closed, and say why.
GetBuildInfo = function() return '1.60.2', '72000' end
Everloot.RefreshNativeCrafting()
drain()
said = details()
assert(said:find('Cheapest route: buy every reagent (' .. money(200) .. ')', 1, true), said)
assert(said:find('Recipes not used: no cooldown evidence (data for another build)', 1, true), said)
assert(not said:find('Assumes:', 1, true), said)
-- A recorded cooldown with no current own-window read is not a route.
GetBuildInfo = function() return '1.60.1', '71139' end
known(18560)
Everloot.RefreshNativeCrafting()
drain()
said = details()
assert(said:find('Cheapest route: buy every reagent', 1, true) and said:find('cooldown not ready now', 1, true), said)
assert(not Everloot.Window.failed)
""")
# Task 6: a recipe plan from the schematic. The player picks a craft count, Add materials previews the combined plan
# for this character (this recipe at that count replacing any saved count), and a second press saves it. The summary,
# tags and sorting stay per one craft; the preview is labelled with its count.
lua = fresh("{ installId = 'abcd-1234', records = {} }",
            NATIVE_API + "UnitGUID = function() return 'Player-1-0001' end\n"
            + "GetBuildInfo = function() return '1.60.1', '71139' end\n"
            + "NUM_BAG_SLOTS = 4\nbag = { { 1, 1 } }\n"
            + "C_Container = { GetContainerNumSlots = function(b) if b == 0 then return 16 end return 0 end,\n"
            + "  GetContainerItemInfo = function(b, s) local e = b == 0 and bag[s]; if e then return { itemID = e[1], stackCount = e[2] } end end }\n",
            extra=("modules/inventory.lua", "modules/recipe_cooldown_data.lua", "modules/crafting_plan.lua"))
lua.execute(PRICES)
for name in ("native_crafting.lua", "native_recipes.lua"):
    lua.execute((root / "modules" / name).read_text(encoding="utf-8"))
lua.execute("""
local E, money = Everloot, Everloot.Window.Money
local CP = E.CraftingPlan
local ME = E.CharacterKey()
EverlootDB.craftingKnown = { [ME] = { [185] = { complete = false, recipes = { [7751] = { recipeId = 7751, learned = true,
  itemId = 4, minimum = 2, maximum = 2, reagents = { { itemId = 1, count = 1 } } } } } } }
local function click(b) b.scripts.OnClick(b) end
local function said()
  return table.concat(GameTooltip.lines, '\\n')
end
openProfessions()
fireNative('ADDON_LOADED', 'Blizzard_Professions')
fireNative('TRADE_SKILL_SHOW')
local fish = { recipeID = 7751, name = 'Brilliant Smallfish', learned = true }
local schematic = { outputItemID = 4, quantityMin = 2, quantityMax = 2, reagentSlotSchematics = { slot(1, 1) } }
form:Init(fish, schematic)
drain()
local p = panel()
assert(p.add and p.add.text == 'Add materials' and p.countText.text == '1 craft', 'count and Add materials controls')
click(p.plus); click(p.plus)
assert(p.countText.text == '3 crafts', p.countText.text)
assert(p.cost.text == 'Cost per craft: ' .. money(200), 'the summary stays per one craft: ' .. p.cost.text)
click(p.add)
local text = said()
assert(EverlootDB.craftingPlans == nil, 'a preview saves nothing')
assert(p.add.text == 'Save plan', 'the second press saves')
assert(text:find('Plan preview: 3 crafts of Brilliant Smallfish (new plan)', 1, true), text)
assert(text:find('Need 2 × Raw Brilliant Smallfish (3 without bags)', 1, true), text)
assert(text:find('Bags counted now', 1, true) and text:find('bank, mail and other characters', 1, true), text)
assert(text:find('Materials for 3 crafts: ' .. money(600), 1, true) and text:find('to buy now: ' .. money(400), 1, true), text)
click(p.add)
text = said()
assert(EverlootDB.craftingPlans[ME].recipes[7751].crafts == 3, 'saved after the preview')
assert(text:find('Saved: 3 crafts of Brilliant Smallfish.', 1, true) and p.add.text == 'Add materials', text)
-- Another count replaces the saved one, again only after its preview.
click(p.minus)
click(p.add)
text = said()
assert(text:find('Plan preview: 2 crafts of Brilliant Smallfish (replaces 3)', 1, true), text)
click(p.minus)
assert(p.add.text == 'Add materials', 'changing the count asks for a new preview')
click(p.plus)
click(p.add); click(p.add)
assert(EverlootDB.craftingPlans[ME].recipes[7751].crafts == 2, 'replaced, not added: 2')
assert(said():find('Saved: 2 crafts of Brilliant Smallfish (was 3).', 1, true), said())
p.scripts.OnEnter(p)
assert(said():find('In your plan: 2 crafts', 1, true), said())
-- Zero removes the recipe from the plan, after its preview.
click(p.minus); click(p.minus)
assert(p.countText.text == 'Remove', p.countText.text)
click(p.add)
assert(said():find('Removes Brilliant Smallfish from your plan', 1, true), said())
click(p.add)
assert(EverlootDB.craftingPlans[ME].recipes[7751] == nil, 'removed')
-- A recipe this character has not proven: refused with the reason, nothing saved.
form:Init({ recipeID = 17187, name = 'Transmute: Arcanite', learned = true },
  { outputItemID = 4, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(2, 1), slot(3, 1) } })
drain()
assert(p.countText.text == '1 craft', 'another recipe starts at one craft')
click(p.add)
text = said()
assert(text:find('not proven', 1, true) and p.add.text == 'Add materials', text)
click(p.add)
assert(EverlootDB.craftingPlans[ME].recipes[17187] == nil, 'nothing saved for an unproven recipe')
assert(EverlootDB.inventory == nil, 'previews never save bag counts')
assert(not Everloot.Window.failed)
""")

# Task 7: training payback. Crafting.TrainerEstimate takes a service with an exact recipe spell ID and the training cost,
# reads that spell's schematic, prices it like every other estimate, and repays the training only with a complete,
# positive profit: ceil(cost / profit). Item IDs and names never stand in for the spell ID.
TRAINER_PRICES = """
local prices = { [11] = 450, [12] = 1000, [13] = 950, [14] = 1200 }
function Everloot:CommunityPrice(realm, id)
  if prices[id] then return { market = prices[id], day = '2026-10-30' } end
end
function Everloot:PriceFile(realm) return { status = 'ready', house = 'Alliance', asOf = '2026-10-30' } end
"""
lua = fresh("{ installId = 'abcd-1234', records = {} }",
            NATIVE_API + "UnitGUID = function() return 'Player-1-0001' end\n",
            extra=("modules/crafting_plan.lua", "modules/professions.lua"))
lua.execute(TRAINER_PRICES)
for name in ("native_crafting.lua", "native_recipes.lua"):
    lua.execute((root / "modules" / name).read_text(encoding="utf-8"))
lua.execute("""
local E, U = Everloot, Everloot.Window
local C = E.Crafting
local money = U.Money
-- 3001: 450c of item 11 makes item 12 (1000c): 950c after the 5% cut, 500c profit. 3002: break even. 3003: a loss.
-- 3004: item 15 has no price. 3005: the client answers with another recipe's schematic.
schematics = {
  [3001] = { recipeID = 3001, outputItemID = 12, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(11, 1) } },
  [3002] = { recipeID = 3002, outputItemID = 12, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(13, 1) } },
  [3003] = { recipeID = 3003, outputItemID = 12, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(14, 1) } },
  [3004] = { recipeID = 3004, outputItemID = 12, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(15, 1) } },
  [3005] = { recipeID = 9999, outputItemID = 12, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(11, 1) } },
}
C_TradeSkillUI = { GetRecipeSchematic = function(id, recraft) assert(recraft == false); return schematics[id] end }
assert(type(C.TrainerEstimate) == 'function', 'Crafting.TrainerEstimate exists')
local ctx = U.CraftContext(E.CurrentRealm(), E:MarketHouse())
local te, why = C.TrainerEstimate({ spellId = 3001, trainingCostCopper = 1001 }, ctx)
assert(te and te.profit == 500 and te.payback == 3 and why == nil, '1,001c at 500c a craft takes three crafts')
assert(te.row.cut == 5 and te.row.destination == 'ah' and te.row.source == 'community', 'labels: cut, destination, source')
te = C.TrainerEstimate({ spellId = 3001, trainingCostCopper = 1000 }, ctx)
assert(te.payback == 2, 'an exact multiple needs no extra craft')
te, why = C.TrainerEstimate({ spellId = 3001 }, ctx)
assert(te and te.profit == 500 and te.payback == nil and why == 'no cost', 'unknown training cost: no payback')
te, why = C.TrainerEstimate({ spellId = 3002, trainingCostCopper = 1001 }, ctx)
assert(te and te.profit == 0 and te.payback == nil and why == 'zero', 'break even never repays')
te, why = C.TrainerEstimate({ spellId = 3003, trainingCostCopper = 1001 }, ctx)
assert(te and te.profit < 0 and te.payback == nil and why == 'loss', 'a loss never repays')
te, why = C.TrainerEstimate({ spellId = 3004, trainingCostCopper = 1001 }, ctx)
assert(te and te.profit == nil and te.payback == nil and why == 'unpriced', 'a missing price is never zero')
te, why = C.TrainerEstimate({ spellId = 3006, trainingCostCopper = 1001 }, ctx)
assert(te == nil and why == 'no schematic', 'no schematic, no estimate')
te, why = C.TrainerEstimate({ spellId = 3005, trainingCostCopper = 1001 }, ctx)
assert(te == nil and why == 'other recipe', 'a schematic for another recipe is not this one')
local schematicFor = C_TradeSkillUI.GetRecipeSchematic
C_TradeSkillUI.GetRecipeSchematic = function(id, ...)
 if id == 3007 then return { recipeID=3007, outputItemID=2996, quantityMin=1, quantityMax=1, reagentSlotSchematics={} } end
 return schematicFor(id, ...)
end
te, why = C.TrainerEstimate({ spellId=3007, trainingCostCopper=1001 }, ctx)
assert(te == nil and why == 'no materials', 'empty trainer inputs are not a verified free craft')
C_TradeSkillUI.GetRecipeSchematic = schematicFor
te = C.TrainerEstimate({ spellId=3001, trainingCostCopper=0 }, ctx)
assert(te.payback == 0 and te.profit == 500, 'a verified free training cost needs no profitable crafts to repay')
for _, cost in ipairs({ -1, 1.5 }) do
 te, why = C.TrainerEstimate({ spellId=3001, trainingCostCopper=cost }, ctx)
 assert(te.payback == nil and why == 'no cost', 'invalid training costs never produce payback')
end
-- An item ID with the same number, or a recipe name, never stands in for the spell ID.
te, why = C.TrainerEstimate({ itemId = 3001, name = 'Same Name', trainingCostCopper = 1001 }, ctx)
assert(te == nil and why == 'no spell ID', tostring(why))
-- The words: count, source, cut and destination.
local lines = table.concat(U.TrainerLines(C.TrainerEstimate({ spellId = 3001, trainingCostCopper = 1001 }, ctx)), '\\n')
assert(lines:find('Est. profit per craft: +' .. money(500) .. ' (sold at the AH after its 5% cut, community prices)', 1, true), lines)
assert(lines:find('Repays ' .. money(1001) .. ' training after 3 profitable crafts', 1, true), lines)
lines = table.concat(U.TrainerLines(C.TrainerEstimate({ spellId = 3003, trainingCostCopper = 1001 }, ctx)), '\\n')
assert(lines:find('No payback: each craft loses', 1, true) and not lines:find('Repays', 1, true), lines)
lines = table.concat(U.TrainerLines(nil, 'no schematic'), '\\n')
assert(lines:find('No payback estimate', 1, true) and lines:find('profession window', 1, true), lines)

-- The native trainer window: rows from ClassTrainerFrame.ScrollBox, recycled, decorated only through ScrollUtil's
-- callbacks and the row's own hover. The payback goes in the hover; a row has no room for it.
Enum = { TooltipDataType = { Item = 0, Spell = 1 } }
services = {
  [2] = { 'Profitable Potion', 'Alchemy', 50, 1001, { type = 1, id = 3001 } },
  [3] = { 'Item Look-alike', 'Alchemy', 50, 1001, { type = 0, id = 3001 } },
  [4] = { 'Unread Recipe', 'Alchemy', 50, 1001, { type = 1, id = 3006 } },
  [5] = { 'Fireball', nil, nil, 100, { type = 1, id = 3001 } },
}
GetTrainerServiceInfo = function(i) return services[i][1], 'available' end
GetTrainerServiceSkillReq = function(i) if services[i][2] then return services[i][2], services[i][3], true end end
GetTrainerServiceCost = function(i) return services[i][4], services[i][2] ~= nil end
C_TooltipInfo = { GetTrainerService = function(i) return services[i] and services[i][5] end }
tbox = CreateFrame('Frame')
tbox.inits, tbox.releases, tbox.frames = {}, {}, {}
function tbox:ForEachFrame(fn) for _, f in ipairs(self.frames) do if f.node then fn(f, f.node) end end end
ScrollUtil = {
  AddInitializedFrameCallback = function(scroll, cb, owner) table.insert(scroll.inits, { cb, owner }) end,
  AddReleasedFrameCallback = function(scroll, cb, owner) table.insert(scroll.releases, { cb, owner }) end,
}
local function node(data) return { data = data, GetData = function(self) return self.data end } end
local function row()
  local f = CreateFrame('Button')
  f.GetElementData = function(self) return self.node end
  -- Blizzard's template: owner, its service's tooltip, show.
  f:SetScript('OnEnter', function(self) GameTooltip:SetOwner(self); GameTooltip:AddLine('Blizzard service'); GameTooltip:Show() end)
  table.insert(tbox.frames, f)
  return f
end
local function bind(f, n) f.node = n; for _, c in ipairs(tbox.inits) do c[1](c[2], f, n) end end
local function release(f) local old = f.node; f.node = nil; for _, c in ipairs(tbox.releases) do c[1](c[2], f, old) end end
local function hover(f)
  f.scripts.OnEnter(f)
  for _, h in ipairs(f.hooks) do h(f) end
  return table.concat(GameTooltip.lines, '\\n')
end
ClassTrainerFrame = CreateFrame('Frame')
ClassTrainerFrame.ScrollBox = tbox
local early = row()
early.node = node({ skillIndex = 2 })
fireNative('ADDON_LOADED', 'Blizzard_TrainerUI')
fireNative('TRAINER_SHOW')
fireNative('TRAINER_SHOW')
assert(#tbox.inits == 1, 'one trainer ScrollBox callback, however often the trainer opens')
local said = hover(early)
assert(said:find('Repays ' .. money(1001) .. ' training after 3 profitable crafts', 1, true), 'a row bound before the hook: ' .. said)
local f = row()
bind(f, node({ skillIndex = 2 }))
said = hover(f)
assert(said:find('Blizzard service', 1, true) and said:find('after 3 profitable crafts', 1, true), said)
-- The same frame rebound: a category, an item identity, a recipe whose schematic is unreadable, a class spell.
bind(f, node({ categoryInfo = { name = 'Potions' } }))
said = hover(f)
assert(not said:find('Everloot', 1, true), 'a category row has no Everloot lines: ' .. said)
bind(f, node({ skillIndex = 3 }))
said = hover(f)
assert(not said:find('Repays', 1, true) and said:find('No payback estimate', 1, true), 'an item is never the recipe spell: ' .. said)
bind(f, node({ skillIndex = 4 }))
said = hover(f)
assert(not said:find('Repays', 1, true) and said:find('profession window', 1, true), said)
bind(f, node({ skillIndex = 5 }))
said = hover(f)
assert(not said:find('Everloot', 1, true), 'a class spell is not a recipe: ' .. said)
bind(f, node({ skillIndex = 2 }))
release(f)
said = hover(f)
assert(not said:find('Everloot', 1, true), 'a released row keeps nothing: ' .. said)
assert(#f.hooks == 1, 'one hover hook per frame, however often it is rebound: ' .. #f.hooks)
-- Recorder-only and CraftProfit follow the profession window's rules; this character's choice wins.
bind(f, node({ skillIndex = 2 }))
EverlootDB.toggles.window = false
assert(not hover(f):find('Everloot', 1, true), 'recorder-only adds nothing to the trainer')
EverlootDB.toggles.window = nil
C_AddOns = { IsAddOnLoaded = function(name) return name == 'CraftProfit' end }
assert(not hover(f):find('Everloot', 1, true), 'CraftProfit keeps the trainer to itself by default')
E.Options.SetNativeCrafting(true)
assert(hover(f):find('after 3 profitable crafts', 1, true), 'the character override shows it again')
-- Reading a trainer never makes its offerings this character's learned recipes, and nothing trains.
assert(EverlootDB.craftingKnown == nil, 'no learned capture from trainer offerings')
assert(not U.failed)
""")

# Details adds this house's own-scan context for the selected count: how deep each material's listings are, its
# seven-day median and today's change, and the break-even price of the material with the largest cost. It is
# context beside the estimate: the cost and profit lines above stay the calculator's.
lua = native_world()
lua.execute((root / "modules" / "crafting_history.lua").read_text(encoding="utf-8"))
lua.execute("""
local money = Everloot.Window.Money
local H = Everloot.CraftingHistory
local function hover()
  panel().scripts.OnEnter(panel())
  return table.concat(GameTooltip.lines, '\\n')
end
local function has(text, needle) assert(text:find(needle, 1, true), 'missing: ' .. needle .. '\\n' .. text) end
-- now = 1,000,000 s is UTC day 11. Days 8, 9 and 10 seed a 200c median; today's scan lists 1 at 150c and 5 at 210c.
local want = { [1] = true, [4] = true }
for d, v in pairs({ [8] = 180, [9] = 200, [10] = 220 }) do
  assert(H.Observe('Forever', 'Alliance', d * 86400 + 3600, { [1] = { { v, 1 } } }, want))
end
assert(H.Observe('Forever', 'Alliance', now - 90, { [1] = { { 210, 5 }, { 150, 1 } } }, want))
openProfessions()
fireNative('ADDON_LOADED', 'Blizzard_Professions')
local fish = { recipeID = 7751, name = 'Brilliant Smallfish', learned = true }
form:Init(fish, { outputItemID = 4, quantityMin = 2, quantityMax = 2, reagentSlotSchematics = { slot(1, 1) } })
drain()
assert(panel().cost.text == 'Cost per craft: ' .. money(200), 'the estimate itself is unchanged: ' .. panel().cost.text)
local details = hover()
has(details, 'Your Alliance scans, for 1 craft:')
has(details, 'Raw Brilliant Smallfish: buying 1 of 6 listed costs ' .. money(150) .. ' (newest scan 1 min ago)')
has(details, 'Raw Brilliant Smallfish: 7-day median ' .. money(200) .. ' (3 of 7 days scanned, 4 missing); today '
  .. money(180) .. ', ' .. money(-20) .. ' (-10.0%)')
has(details, 'Break-even for 1 craft: Raw Brilliant Smallfish up to ' .. money(1710) .. ' each (now ' .. money(200)
  .. '), other materials as above, at the AH after its 5% cut')
assert(not details:find('Finished item: no 7-day', 1, true), 'a product with no day values adds no line')
-- Three crafts: the ladder walks past the cheap single listing; the sale is rounded once for the count.
panel().plus.scripts.OnClick()
panel().plus.scripts.OnClick()
details = hover()
has(details, 'Your Alliance scans, for 3 crafts:')
has(details, 'Raw Brilliant Smallfish: buying 3 of 6 listed costs ' .. money(570))
has(details, 'Break-even for 3 crafts: Raw Brilliant Smallfish up to ' .. money(1710) .. ' each')
-- Seven crafts: not enough listed, said with what is missing.
panel().planning.count = 7
details = hover()
has(details, 'Raw Brilliant Smallfish: insufficient depth: 6 of 7 listed, costing ' .. money(1200) .. '; 1 short')
-- A newer scan with more price levels than are kept: never a complete claim.
local levels = {}
for k = 1, 201 do levels[k] = { k, 1 } end
assert(H.Observe('Forever', 'Alliance', now - 30, { [1] = levels }, want))
details = hover()
has(details, 'Raw Brilliant Smallfish: buying 7 of at least 200 listed costs ' .. money(28)
  .. ' (cheapest 200 prices kept; newest scan just now)')
panel().planning.count = 201
details = hover()
has(details, 'Raw Brilliant Smallfish: the cheapest 200 prices kept hold 200 of 201, costing ' .. money(20100)
  .. '; listings past them are unknown')
-- A recipe with nothing scanned says where depth and history come from; its break-even uses the costliest material.
panel().planning.count = 1
form:Init({ recipeID = 17187, name = 'Transmute: Arcanite', learned = true },
  { outputItemID = 4, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(2, 1), slot(3, 1) } })
drain()
details = hover()
has(details, 'No depth or 7-day history: only your completed full scans of this house count, for recipes this character has learned.')
has(details, 'Break-even for 1 craft: Arcane Crystal up to ' .. money(355) .. ' each (now ' .. money(700) .. ')')
-- No break-even when the other materials already cost more than the sale.
form:Init({ recipeID = 17188, name = 'Expensive', learned = true },
  { outputItemID = 4, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { slot(2, 2), slot(3, 2) } })
drain()
has(hover(), 'No break-even for Arcane Crystal: the other materials already cost more than the sale')
-- Nothing here writes history: hovering only reads it.
assert(EverlootDB.records.auction_snapshot == nil, 'no upload record from Details')
assert(not Everloot.Window.failed)
""")
print("native crafting contract PASS")
