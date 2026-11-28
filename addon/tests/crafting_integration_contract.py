"""Run with: python addon/tests/crafting_integration_contract.py (needs lupa)

One player's tailoring journey through every crafting surface at once, in one loaded addon: the native schematic
summary and its Details, the window's Crafting costs page and the recipe plan at the auction house. The character has
learned Bolt of Linen Cloth (2963: two Linen Cloth make one bolt) and Linen Bag (3755: three bolts and three Coarse
Thread make one bag). The player selects Linen Bag, changes the destination, the reagent route and the craft count,
previews and saves a plan for three bags, then searches what is still needed after the bags in their pack. The same
copper and the same quantities must appear on every surface, and a reagent without a price stays unpriced on all of
them while its shortfall is still listed and searched.

Prices (Alliance price file): Linen Cloth 100c, Bolt of Linen Cloth 300c, Coarse Thread 10c, Linen Bag 2000c; the
game's vendor sell price for a Linen Bag is 500c. Per craft, buying every reagent costs 3 x 300 + 3 x 10 = 930c:
2000 - 5% cut 100 - 930 = +970c at the AH, 500 - 930 = -430c at a vendor. Making the bolts costs 3 x 2 x 100 + 30 =
630c. For three crafts: buy all 2790c; cheapest 9 bolts from 18 cloth + 9 thread = 1890c, so 6000 - 300 - 1890 = 3810c
at the AH and 1500 - 1890 = -390c at a vendor. The pack holds 5 Linen Cloth, 1 Bolt and 2 Coarse Thread: the cheapest
plan makes 8 bolts from 16 cloth, so it needs 11 cloth (18 without bags) and 7 thread (9), costing 1170c to buy now;
buying all needs 8 bolts (9) and 7 thread (9), 2470c now. Bags never lower the materials' value.
"""
import zlib
from pathlib import Path
from window_world import fresh

root = Path(__file__).parents[1]

ROWS_PRICED = ";".join([
    "2589,100,95,100,400,2026-10-29,5", "2996,300,290,300,90,2026-10-29,5",
    "2320,10,9,10,90,2026-10-29,5", "4238,2000,1900,2000,20,2026-10-29,5",
])
# The same day's file without Coarse Thread: one reagent has no price anywhere.
ROWS_NO_THREAD = ";".join([
    "2589,100,95,100,400,2026-10-29,5", "2996,300,290,300,90,2026-10-29,5", "4238,2000,1900,2000,20,2026-10-29,5",
])


def price_file(rows: str) -> str:
    return (f"EverlootPricesDB = {{ realms = {{ ['forever|alliance'] = {{ data = '{rows}', "
            f"sum = {zlib.adler32(rows.encode())}, dataAsOf = '2026-10-29T06:00:00Z' }} }} }}")


RECORDS = """{
  recipe_observed = {
    { profession = 'Tailoring', recipe = 'Bolt of Linen Cloth', recipeId = 2963, learned = true, productItemId = 2996,
      reagents = { { item = 'Linen Cloth', count = 2 } } },
    { profession = 'Tailoring', recipe = 'Linen Bag', recipeId = 3755, learned = true, productItemId = 4238,
      reagents = { { item = 'Bolt of Linen Cloth', count = 3 }, { item = 'Coarse Thread', count = 3 } } },
  },
  item_seen = {
    { itemId = 2589, name = 'Linen Cloth' }, { itemId = 2996, name = 'Bolt of Linen Cloth' },
    { itemId = 2320, name = 'Coarse Thread' }, { itemId = 4238, name = 'Linen Bag' },
  },
}"""
OUTPUTS = "{ [2963] = { itemId = 2996, minimum = 1, maximum = 1 }, [3755] = { itemId = 4238, minimum = 1, maximum = 1 } }"

API = """
guid = 'Player-1-0000A1FA'
UnitGUID = function(unit) if unit == 'player' then return guid end end
GetBuildInfo = function() return '1.60.1', '71139' end
GetProfessions = function() return 1 end
GetProfessionInfo = function(i)
  if i == 1 then return 'Tailoring', 'Interface\\\\Icons\\\\Trade_Tailoring', 75, 150, 0, 0, 197 end
end
NAMES = { [2589] = 'Linen Cloth', [2996] = 'Bolt of Linen Cloth', [2320] = 'Coarse Thread', [4238] = 'Linen Bag' }
SELLS = { [4238] = 500 }
C_Item = {
  GetItemNameByID = function(id) return NAMES[id] end,
  -- The 11th value is the vendor sell price; 0 means vendors do not buy it.
  GetItemInfo = function(id)
    local name = NAMES[id]
    if name then return name, '|Hitem:' .. id .. '::|h[' .. name .. ']|h', 1, 1, 1, 'Trade Goods', '', 20, '', 0, SELLS[id] or 0 end
  end,
}
GetItemInfo = function(item)
  for id, name in pairs(NAMES) do
    if item == id or item == name then return name, '|cffffffff|Hitem:' .. id .. '::|h[' .. name .. ']|h|r' end
  end
end
-- The pack: fresh counts on every read, never saved.
NUM_BAG_SLOTS = 4
bag = {}
C_Container = {
  GetContainerNumSlots = function(b) if b == 0 then return 16 end return 0 end,
  GetContainerItemInfo = function(b, s)
    local entry = b == 0 and bag[s]
    if entry then return { itemID = entry[1], stackCount = entry[2] } end
  end,
}
function setBags(counts)
  bag = {}
  for id, n in pairs(counts) do bag[#bag + 1] = { id, n } end
end

-- Forever's profession schematic, as native_crafting_contract stubs it.
function hooksecurefunc(object, key, callback)
  if type(object) ~= 'table' then return end
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
    if frame.kind == 'Button' and frame.parent == form and frame.planning then matches[#matches + 1] = frame end
  end
  assert(#matches == 1, 'one estimate inside the native form')
  return matches[1]
end
function slot(id, count)
  return { required = true, dataSlotType = 1, reagentType = 1, quantityRequired = count, reagents = { { itemID = id } } }
end
GameTooltip = { lines = {} }
function GameTooltip:SetOwner(owner) self.owner, self.lines = owner, {} end
function GameTooltip:IsOwned(owner) return self.owner == owner end
function GameTooltip:AddLine(text) table.insert(self.lines, text) end
function GameTooltip:Show() self.shown = true end
function GameTooltip:Hide() self.shown = false; self.owner = nil end
function GameTooltip:ClearLines() self.lines = {} end

-- The auction house on Forever: Search needed opens Blizzard's exact-name Buy search. Every query is kept.
queries, ready = {}, true
local house = {
  SendBrowseQuery = function(q) queries[#queries + 1] = q end,
  GetBrowseResults = function() return {} end,
  IsThrottledMessageSystemReady = function() return ready end,
  HasFullBrowseResults = function() return true end,
  ReplicateItems = function() end,
  GetNumReplicateItems = function() return 0 end,
}
C_AuctionHouse = house
function openHouse()
  -- The auction house panel measures its title; the shared window frames have no text width of their own.
  local frameApi = getmetatable(CreateFrame('Frame'))
  frameApi.GetStringWidth = frameApi.GetStringWidth or function(self) return 6 * #tostring(rawget(self, 'text') or '') end
  AuctionHouseFrame = CreateFrame('Frame', 'AuctionHouseFrame')
  AuctionHouseFrame.Tabs = { CreateFrame('Button', 'Buy') }
  AuctionHouseFrameDisplayMode = { Buy = {} }
  Enum.AuctionHouseFilter = { ExactMatch = 5 }
  function AuctionHouseFrame:GetCategoriesList() return { SetSelectedCategory = function() end } end
  function AuctionHouseFrame:SetDisplayMode(mode) self.displayMode = mode end
  function AuctionHouseFrame:SetSearchText(name) self.searchText = name; return true end
  function AuctionHouseFrame:SendBrowseQuery(name, minLevel, maxLevel, filters)
    queries[#queries + 1] = { searchString = name, filters = filters }
  end
  for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, 'AUCTION_HOUSE_SHOW') end
  local T = Everloot.AuctionTab
  T.panel.width = 784
  T.tab.scripts.OnClick()
end
function click(b) assert(b and b.scripts.OnClick, 'a button') b.scripts.OnClick(b) end
"""

# Loaded as a player's session: this character's proven recipes, the pack, and Linen Bag selected in the native
# schematic. Lua helpers shared by both sessions below.
SESSION = """
assert(Everloot.CraftingPlan.ReplaceKnown(Everloot.CharacterKey(), 197, {
  { recipeId = 2963, learned = true, itemId = 2996, minimum = 1, maximum = 1, reagents = { { itemId = 2589, count = 2 } },
    cooldownReturned = false, cooldownCheckedAt = time() - 60 },
  { recipeId = 3755, learned = true, itemId = 4238, minimum = 1, maximum = 1,
    reagents = { { itemId = 2996, count = 3 }, { itemId = 2320, count = 3 } },
    cooldownReturned = false, cooldownCheckedAt = time() - 60 },
}, false))
setBags({ [2589] = 5, [2996] = 1, [2320] = 2 })
openProfessions()
fireNative('ADDON_LOADED', 'Blizzard_Professions')
fireNative('TRADE_SKILL_SHOW')
form:Init({ recipeID = 3755, name = 'Linen Bag', learned = true }, { outputItemID = 4238, quantityMin = 1, quantityMax = 1,
  reagentSlotSchematics = { slot(2996, 3), slot(2320, 3) } })
drain()
function details()
  local p = panel()
  p.scripts.OnEnter(p)
  return table.concat(GameTooltip.lines, '\\n')
end
function has(text, wanted) assert(text:find(wanted, 1, true), 'missing "' .. wanted .. '" in:\\n' .. text) end
function lacks(text, unwanted) assert(not text:find(unwanted, 1, true), 'unexpected "' .. unwanted .. '" in:\\n' .. text) end
function craftingPage()
  assert(Everloot.Window.Open('professions') == true)
  local wp = EverlootWindow.professions
  if not wp.craft.page.shown then wp.toggle.scripts.OnClick() end
  return wp.craft
end
function rowNamed(c, name)
  for _, r in ipairs(c.rows) do if r.shown and r.name.text == name then return r end end
end
function shopRow(shop, name)
  for _, r in ipairs(shop.rows) do if r.shown and r.name.text == name then return r end end
end
-- Search needed: one press, one exact Buy search for the next needed row, with that row's shortfall beside it.
function searchNext()
  local T, S = Everloot.AuctionTab, Everloot.Shopping
  T.SetMode('shop')
  local before = #queries
  click(T.panel.shop.needButton)
  assert(#queries == before + 1, 'one search per press: ' .. tostring(S.message))
  return queries[#queries].searchString, T.buyContext.text
end
"""


def session(rows: str):
    lua = fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {RECORDS}, recipeOutput = {OUTPUTS} }}",
                API + price_file(rows),
                extra=("modules/inventory.lua", "modules/recipe_cooldown_data.lua", "modules/crafting_plan.lua",
                       "modules/shopping.lua", "modules/auctiontab.lua"))
    for name in ("native_crafting.lua", "native_recipes.lua"):
        lua.execute((root / "modules" / name).read_text(encoding="utf-8"))
    lua.execute(SESSION)
    return lua


lua = session(ROWS_PRICED)
lua.execute("""
local E, U = Everloot, Everloot.Window
local money, short = U.Money, U.MoneyShort
local CP, S, T = E.CraftingPlan, E.Shopping, E.AuctionTab
local ME = E.CharacterKey()
local p = panel()

-- Surface 1: the native schematic for Linen Bag.
assert(p.shown and p.cost.text == 'Cost per craft: ' .. money(930), tostring(p.cost.text))
has(p.profit.text, '+' .. money(970))
local said = details()
has(said, 'At the AH: ' .. money(2000) .. ' - 5% cut: ' .. money(100) .. ' - materials: ' .. money(930) .. ' = '
  .. money(970) .. ' profit')
has(said, 'To a vendor: ' .. money(500) .. ' - materials: ' .. money(930) .. ' = ' .. money(-430) .. ' profit')
-- The cheapest route is a comparison beside the buy-all summary, with the same per-craft materials as the page.
has(said, 'Cheapest route: ' .. money(630) .. ' (buying all: ' .. money(930) .. ')')
has(said, 'make Bolt of Linen Cloth: 3 crafts')

-- Surface 2: the Crafting costs page, the same recipe, the same per-craft figures.
local c = craftingPage()
local bagRow = rowNamed(c, 'Linen Bag')
assert(bagRow, 'Linen Bag is listed')
assert(bagRow.cost.text == short(930) and bagRow.value.text == short(2000) and bagRow.profit.text == '+' .. short(970),
  bagRow.cost.text .. ' / ' .. bagRow.value.text .. ' / ' .. bagRow.profit.text)
bagRow.scripts.OnClick()
local b = c.buy
assert(b.title.text == 'What to buy: 1 × Linen Bag', b.title.text)
assert(b.total.text == 'Total: ' .. money(930), b.total.text)

-- The player chooses the cheapest route and three crafts on the page.
click(b.route)
for _ = 1, 2 do b.steps[2].scripts.OnClick() end
assert(b.title.text == 'What to buy: 3 × Linen Bag', b.title.text)
assert(b.total.text == 'Total: ' .. money(1890) .. ' · buying all: ' .. money(2790), b.total.text)
b.details.scripts.OnClick()
assert(b.math.text == 'Sale: ' .. money(6000) .. ' - 5% AH cut: ' .. money(300) .. ' - materials: ' .. money(1890)
  .. ' = ' .. money(3810) .. ' profit for 3 crafts', b.math.text)
b.details.scripts.OnClick()

-- Back in the profession window: three crafts, and the plan saved for this character uses the cheapest route.
assert(CP.SetStrategy(ME, 'cheapest') ~= false)
click(p.plus); click(p.plus)
assert(p.countText.text == '3 crafts', p.countText.text)
assert(p.cost.text == 'Cost per craft: ' .. money(930), 'the summary stays per craft: ' .. p.cost.text)
click(p.add)
said = details()
assert(EverlootDB.craftingPlans == nil or EverlootDB.craftingPlans[ME].recipes[3755] == nil, 'a preview saves nothing')
has(said, 'Plan preview: 3 crafts of Linen Bag (new plan)')
has(said, 'route: cheapest')
-- The pack's bolt is used before making more; its cloth before buying more.
has(said, 'Need 11 × Linen Cloth (18 without bags)')
has(said, 'Need 7 × Coarse Thread (9 without bags)')
lacks(said, 'Need 8 × Bolt of Linen Cloth')
has(said, 'Materials for 3 crafts: ' .. money(1890) .. ' (bags never lower this) · to buy now: ' .. money(1170))
click(p.add)
assert(EverlootDB.craftingPlans[ME].recipes[3755].crafts == 3, 'saved after the preview')
assert(EverlootDB.inventory == nil, 'no bag counts saved')

-- Surface 3: the plan at the auction house, its shortfall and Search needed.
openHouse()
T.SetMode('shop')
local shop = T.panel.shop
click(shop.sourceButton)
assert(S.source == 'plan', 'the recipe plans are the search source')
assert(shop.routeButton.text == 'Route: cheapest', shop.routeButton.text)
local cloth, thread = shopRow(shop, 'Linen Cloth'), shopRow(shop, 'Coarse Thread')
assert(cloth and cloth.want.text == '11' and cloth.max.text == '18' and cloth.decision.text == '5',
  'cloth: ' .. tostring(cloth and cloth.want.text))
assert(thread and thread.want.text == '7' and thread.max.text == '9' and thread.decision.text == '2',
  'thread: ' .. tostring(thread and thread.want.text))
assert(not shopRow(shop, 'Bolt of Linen Cloth'), 'the cheapest route makes the bolts instead of buying them')
local searched = {}
for _ = 1, 2 do
  local name, context = searchNext()
  searched[name] = context
end
has(searched['Linen Cloth'], 'Need 11')
has(searched['Coarse Thread'], 'Need 7')
has(searched['Linen Cloth'], 'bags counted')

-- The player switches the saved route to buy all: the bolts become the purchase and the search follows.
T.SetMode('shop')
click(shop.routeButton)
assert(EverlootDB.craftingPlans[ME].strategy == 'buy' and shop.routeButton.text == 'Route: buy all', shop.routeButton.text)
local bolt = shopRow(shop, 'Bolt of Linen Cloth')
assert(bolt and bolt.want.text == '8' and bolt.max.text == '9' and bolt.decision.text == '1',
  'bolts: ' .. tostring(bolt and bolt.want.text))
assert(not shopRow(shop, 'Linen Cloth'), 'buying all buys no cloth')
assert(shopRow(shop, 'Coarse Thread').want.text == '7')
-- A route change is a plan change: the search sequence starts over on the new needs.
searched = {}
for _ = 1, 2 do
  local name, context = searchNext()
  searched[name] = context
end
has(searched['Bolt of Linen Cloth'], 'Need 8')
has(searched['Coarse Thread'], 'Need 7')
assert(not searched['Linen Cloth'])
-- The native preview agrees with the shop at the saved route.
click(p.add)
said = details()
has(said, 'route: buy all')
has(said, 'Need 8 × Bolt of Linen Cloth (9 without bags)')
has(said, 'Materials for 3 crafts: ' .. money(2790) .. ' (bags never lower this) · to buy now: ' .. money(2470))
p.planning.confirm = nil

-- Destination: a vendor everywhere at once (one install-wide choice).
E.Options.SetCraftDestination('vendor')
E.RefreshNativeCrafting()
drain()
assert(p.profit.text:find('Est. profit (vendor): ', 1, true) and p.profit.text:find(money(-430), 1, true), p.profit.text)
U.Refresh()
bagRow = rowNamed(c, 'Linen Bag')
assert(bagRow.value.text == short(500) and bagRow.profit.text == short(-430), bagRow.value.text .. ' / ' .. bagRow.profit.text)
bagRow.scripts.OnClick()
b.details.scripts.OnClick()
assert(b.title.text == 'What to buy: 3 × Linen Bag', b.title.text)
assert(b.math.text == 'Vendor sale: ' .. money(1500) .. ' - materials: ' .. money(1890) .. ' = ' .. money(-390)
  .. ' profit for 3 crafts', b.math.text)
b.details.scripts.OnClick()
E.Options.SetCraftDestination('ah')

assert(not U.failed)
""")

# The next price file has no Coarse Thread price. The game reads a price file once per load, so this is the next
# session (/reload) with the same saved plan: three Linen Bags, buying every reagent.
lua = session(ROWS_NO_THREAD)
lua.execute("""
local E, U = Everloot, Everloot.Window
local CP, S, T = E.CraftingPlan, E.Shopping, E.AuctionTab
local ME = E.CharacterKey()
assert(CP.Put(ME, 197, 3755, 3).ok)
local p = panel()
-- Unpriced on every surface, never zero; its shortfall is still listed and searched.
assert(p.cost.text == 'Cost per craft: Unavailable' and p.profit.text == 'Est. profit: Unavailable',
  p.cost.text .. ' / ' .. p.profit.text)
local said = details()
has(said, 'Coarse Thread')
has(said, 'No price')
local c = craftingPage()
local bagRow = rowNamed(c, 'Linen Bag')
assert(bagRow.cost.text == '1 unpriced' and bagRow.profit.text == '-', bagRow.cost.text .. ' / ' .. bagRow.profit.text)
bagRow.scripts.OnClick()
local b = c.buy
assert(b.total.text:find('Total unknown: 1 reagent unpriced', 1, true), b.total.text)
b.details.scripts.OnClick()
assert(b.math.text == 'Profit unknown: missing material prices.', b.math.text)
b.details.scripts.OnClick()
click(p.plus); click(p.plus)
click(p.add)
said = details()
has(said, 'Plan preview: 3 crafts of Linen Bag (replaces 3)')
has(said, 'Need 8 × Bolt of Linen Cloth (9 without bags)')
has(said, 'Need 7 × Coarse Thread (9 without bags)')
has(said, 'Materials for 3 crafts: unknown (bags never lower this) · to buy now: unknown')
openHouse()
T.SetMode('shop')
local shop = T.panel.shop
click(shop.sourceButton)
local thread = shopRow(shop, 'Coarse Thread')
assert(thread and thread.want.text == '7' and thread.max.text == '9' and thread.market.text == 'no price',
  'thread: ' .. tostring(thread and thread.market.text))
local searched = {}
for _ = 1, 2 do
  local name, context = searchNext()
  searched[name] = context
end
assert(searched['Coarse Thread'], 'the unpriced reagent is still searched')
has(searched['Coarse Thread'], 'Need 7')
has(searched['Bolt of Linen Cloth'], 'Need 8')

assert(not U.failed)
""")

print("Lua 5.1 crafting integration: one learned tailoring chain across the native summary and Details, the Crafting "
      "costs page and the auction house plan; destination, route and craft count changed; per-craft, three-craft and "
      "to-buy copper and quantities agree on every surface; bags lower only the shortfall; Search needed opens the "
      "item still needed with its count; a reagent without a price stays unpriced everywhere and is still searched")
