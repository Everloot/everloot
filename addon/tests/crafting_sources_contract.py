"""Run with: uv run --with lupa python addon/tests/crafting_sources_contract.py

Optional price sources for crafting estimates (modules/crafting_sources.lua): Everloot's own prices by default, or a
price another installed addon gives through its documented public call: Auctionator.API.v1.GetAuctionPriceByItemID
(Auctionator's API README) or TSM_API.GetCustomPriceValue with the AHDBMedianBuyout price source (the TSM_API
reference and TSM's Forever release notes). Neither call says how old a price is or which realm and faction it is
for, so both stay "unknown". A selected source that is missing, fails or has no price leaves the price unknown unless
the player turned on the Everloot fallback, and a fallback price says so. Only the choice is saved: no other addon's
price reaches the saved file, the upload records, the own-scan caches or the crafting history.
"""
import re
from pathlib import Path

from window_world import fresh

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\crafting_sources.lua" in toc, "the price sources module is in the TOC"
assert toc.index("modules\\crafting_sources.lua") < toc.index("modules\\crafting.lua"), \
    "price sources load before the calculator that reads them"

# Read-only adapters: only the documented calls of each addon are named, nothing is written, no scan or search starts.
code = (root / "modules" / "crafting_sources.lua").read_text(encoding="utf-8")
lua_code = "\n".join(line.split("--")[0] for line in code.splitlines())
for word in ["E:Store", "EverlootDB.records", "craftingHistory", "houseScans", "lastScans", "C_AuctionHouse",
             "StartScan", "SendBrowseQuery", "GetAuctionAgeByItemID", "SavedVariables", "SendAddonMessage"]:
    assert word not in lua_code, f"crafting_sources.lua must not use {word}"
assert set(re.findall(r"api\.(\w+)", lua_code)) <= {"GetAuctionPriceByItemID"}, "Auctionator: the documented price call only"
assert set(re.findall(r"\bT\.(\w+)", lua_code)) <= {"GetCustomPriceValue", "IsCustomPriceValid", "ToItemString"}, \
    "TSM: documented TSM_API functions only"

API = """
GetServerTime = function() return serverNow or now end
UnitGUID = function() return 'Player-1-00000001' end
UnitExists = function() return true end
UnitFactionGroup = function(unit) return 'Alliance', 'Alliance' end
scanStarts, replicateCalls, browseCalls = 0, 0, 0
replicate = {}
C_AuctionHouse = {
  ReplicateItems = function() replicateCalls = replicateCalls + 1 end,
  SendBrowseQuery = function() browseCalls = browseCalls + 1 end,
  GetNumReplicateItems = function() return #replicate end,
  GetReplicateItemInfo = function(i)
    local r = replicate[i]
    return 'Item', nil, r[2], nil, nil, nil, nil, nil, nil, r[3], nil, nil, nil, nil, nil, nil, r[1], true
  end,
}
function fullScan(rows, at)
  now = at
  EverlootDB.lastScanAt = nil
  replicate = rows
  fire('AUCTION_HOUSE_SHOW')
  Everloot:StartScan()
  fire('REPLICATE_ITEM_LIST_UPDATE')
  drain()
end
function hooksecurefunc(object, key, callback)
  local original = object[key]
  object[key] = function(self, ...) original(self, ...); callback(self, ...) end
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
  for _, frame in ipairs(created) do
    if frame.kind == 'Button' and frame.parent == form then return frame end
  end
end
function hover()
  panel().scripts.OnEnter(panel())
  return table.concat(GameTooltip.lines, '\\n')
end
GameTooltip = { lines = {} }
function GameTooltip:SetOwner(owner) self.owner, self.lines = owner, {} end
function GameTooltip:IsOwned(owner) return self.owner == owner end
function GameTooltip:AddLine(text) table.insert(self.lines, text) end
function GameTooltip:Show() self.shown = true end
function GameTooltip:Hide() self.shown = false; self.owner = nil end
C_Item = { GetItemNameByID = function(id) return ({ 'Raw Brilliant Smallfish', 'Thorium Bar', 'Arcane Crystal', 'Brilliant Smallfish' })[id] end }
function slot(id, count)
  return { required = true, dataSlotType = 1, reagentType = 1, quantityRequired = count, reagents = { { itemID = id } } }
end
EverlootPricesDB = {}

-- Stand-ins for the two addons' documented calls; every call is counted and every argument kept.
auctionatorCalls, tsmCalls = {}, {}
auctionatorPrices, tsmPrices = {}, {}
function installAuctionator()
  Auctionator = { API = { v1 = { GetAuctionPriceByItemID = function(caller, itemId)
    auctionatorCalls[#auctionatorCalls + 1] = { caller, itemId }
    if auctionatorFail then error('Auctionator internal failure') end
    return auctionatorPrices[itemId]
  end } } }
end
tsmKeyValid = true
function installTSM()
  TSM_API = {
    IsCustomPriceValid = function(s)
      if tsmValidFail then error('TSM validation failure') end
      if s == 'AHDBMedianBuyout' and tsmKeyValid then return true end
      return false, 'Invalid price source'
    end,
    ToItemString = function(item)
      local id = tostring(item):match('^item:(%d+)$')
      if id and not tsmUnknownItem then return 'i:' .. id end
    end,
    GetCustomPriceValue = function(s, itemString)
      tsmCalls[#tsmCalls + 1] = { s, itemString }
      if tsmFail then error('TSM internal failure') end
      if tsmBadString then return nil, 'Invalid price source' end
      return tsmPrices[tonumber(itemString:match('^i:(%d+)$'))]
    end,
  }
end
"""
PRICES = """
local prices = { [1] = 200, [2] = 500, [3] = 700, [4] = 900, [5] = 400 }
priceDay = '2026-10-30'
function Everloot:CommunityPrice(realm, id)
  if prices[id] then return { market = prices[id], day = priceDay } end
end
function Everloot:PriceFile(realm) return { status = 'ready', house = 'Alliance', asOf = '2026-10-30' } end
"""
EXTRA = ("modules/sellcheck.lua", "modules/recipe_cooldown_data.lua", "modules/crafting_plan.lua",
         "modules/crafting_history.lua")
# Item 5's public vendor row is an offer; this install's merchant window proved 300c for one item with no extra cost.
RECORDS = """{
  vendor = { { vendorNpcId = 1, items = { { itemId = 5, priceCopper = 300 } } } },
}"""


def world():
    lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = " + RECORDS
                + ", recipeOutput = { [7751] = { itemId = 4, minimum = 2, maximum = 2 } } }", API, extra=EXTRA)
    lua.execute(PRICES)
    lua.execute("unitEvidence({ [5] = 300 })")
    for name in ("native_crafting.lua", "native_recipes.lua"):
        lua.execute((root / "modules" / name).read_text(encoding="utf-8"))
    return lua


# 1. The adapters: absent addons, a partial API, errors, prices that are not whole copper, and unknown age and scope.
lua = world()
lua.execute("""
local CS = Everloot.CraftingSources
assert(type(CS) == 'table' and type(CS.Available) == 'function' and type(CS.Quote) == 'function', 'interface')
assert(table.concat(CS.NAMES, ',') == 'everloot,auctionator,tsm', 'three sources, Everloot first')
assert(CS.TSM_PRICE == 'AHDBMedianBuyout' and CS.CALLER == 'Everloot')

local function why(...) local _, reason = ...; return reason end
assert(CS.Available('everloot') == true, 'Everloot is always available')
local ok, reason = CS.Available('auctionator')
assert(ok == false and reason == 'not loaded', 'no Auctionator: ' .. tostring(reason))
ok, reason = CS.Available('tsm')
assert(ok == false and reason == 'not loaded', 'no TSM: ' .. tostring(reason))
assert(CS.Quote('auctionator', 1, 'Forever', 'Alliance') == nil and why(CS.Quote('auctionator', 1, 'Forever', 'Alliance')) == 'not loaded')
assert(CS.Quote('tsm', 1, 'Forever', 'Alliance') == nil and why(CS.Quote('tsm', 1, 'Forever', 'Alliance')) == 'not loaded')
assert(CS.Available('craftprofit') == false and why(CS.Available('craftprofit')) == 'unknown source')

-- An addon present without the documented call: unavailable, said, never guessed.
Auctionator = {}
assert(why(CS.Available('auctionator')) == 'documented price call missing')
Auctionator = { API = { v1 = { GetAuctionPriceByItemID = 'not a function' } } }
assert(why(CS.Available('auctionator')) == 'documented price call missing')
TSM_API = { GetCustomPriceValue = function() return 1 end }
assert(why(CS.Available('tsm')) == 'documented price call missing', 'TSM without ToItemString and IsCustomPriceValid')

-- Auctionator: the documented call with Everloot's caller ID; age and scope are unknown, never the requested ones.
installAuctionator()
auctionatorPrices = { [1] = 7771, [6] = 0, [7] = -5, [8] = 1.5, [9] = 'cheap', [10] = 0/0, [11] = math.huge, [12] = SECRET }
SECRET[auctionatorPrices[12]] = true
assert(CS.Available('auctionator') == true)
local q, r = CS.Quote('auctionator', 1, 'Forever', 'Alliance')
assert(q and q.unit == 7771 and q.source == 'auctionator', 'Auctionator quote: ' .. tostring(r))
assert(q.observed == 'unknown' and q.scope == 'unknown', 'age and realm/faction are unknown')
assert(auctionatorCalls[1][1] == 'Everloot' and auctionatorCalls[1][2] == 1, 'caller ID and item ID')
for k, v in pairs(q) do
  assert(v ~= 'Forever' and v ~= 'Alliance', 'the requested realm or house is not reported as the scope: ' .. k)
end
assert(why(CS.Quote('auctionator', 2, 'Forever', 'Alliance')) == 'no price', 'nil is no price')
for _, id in ipairs({ 6, 7, 8, 9, 10, 11, 12 }) do
  local bad, badWhy = CS.Quote('auctionator', id, 'Forever', 'Alliance')
  assert(bad == nil and badWhy == 'invalid price', 'item ' .. id .. ' is not whole copper: ' .. tostring(badWhy))
end
for _, id in ipairs({ 0, -1, 1.5, 'x' }) do
  assert(why(CS.Quote('auctionator', id, 'Forever', 'Alliance')) == 'bad item', 'bad item ID ' .. tostring(id))
end
auctionatorFail = true
q, r = CS.Quote('auctionator', 1, 'Forever', 'Alliance')
assert(q == nil and r == 'API error', 'a raised error is caught and said: ' .. tostring(r))
auctionatorFail = nil

-- TSM: the AHDBMedianBuyout source must be valid in this TSM; then the documented price call on TSM's item string.
installTSM()
tsmKeyValid = false
ok, reason = CS.Available('tsm')
assert(ok == false and reason == 'price source AHDBMedianBuyout not available', tostring(reason))
tsmKeyValid = true
tsmValidFail = true
assert(why(CS.Available('tsm')) == 'API error')
tsmValidFail = nil
assert(CS.Available('tsm') == true)
tsmPrices = { [1] = 8881, [6] = 2.25 }
q = CS.Quote('tsm', 1, 'Forever', 'Alliance')
assert(q and q.unit == 8881 and q.source == 'tsm' and q.observed == 'unknown' and q.scope == 'unknown')
assert(tsmCalls[1][1] == 'AHDBMedianBuyout' and tsmCalls[1][2] == 'i:1', tsmCalls[1][1] .. ' ' .. tsmCalls[1][2])
assert(why(CS.Quote('tsm', 2, 'Forever', 'Alliance')) == 'no price')
assert(why(CS.Quote('tsm', 6, 'Forever', 'Alliance')) == 'invalid price')
tsmUnknownItem = true
assert(why(CS.Quote('tsm', 1, 'Forever', 'Alliance')) == 'item not recognised')
tsmUnknownItem = nil
tsmBadString = true
assert(why(CS.Quote('tsm', 1, 'Forever', 'Alliance')) == 'API error', 'an error string from TSM is an error')
tsmBadString = nil
tsmFail = true
assert(why(CS.Quote('tsm', 1, 'Forever', 'Alliance')) == 'API error')
tsmFail = nil

-- Everloot's own quote keeps its real source, date and the realm and house it was read for.
local own = CS.Quote('everloot', 1, 'Forever', 'Alliance')
assert(own.unit == 200 and own.source == 'community' and own.observed == '2026-10-30', tostring(own.source))
assert(type(own.scope) == 'table' and own.scope.realm == 'Forever' and own.scope.house == 'Alliance')
assert(why(CS.Quote('everloot', 999, 'Forever', 'Alliance')) == 'no price')
Auctionator, TSM_API = nil, nil
""")
print("Lua 5.1 price sources: absent addons, partial APIs, errors, invalid prices, unknown age and scope")

# 2. The calculator: the selected source prices materials and the finished item; a source that disappears, fails or
# has no price gives unknown, never a silent Everloot price; the player's fallback is explicit and marked.
lua = world()
lua.execute("""
local E, C, CS = Everloot, Everloot.Crafting, Everloot.CraftingSources
local fish = { id = 7751, key = 'Cooking|7751', name = 'Brilliant Smallfish', product = 4, live = true,
  output = { itemId = 4, minimum = 2, maximum = 2 }, reagents = { { id = 1, item = 'Raw Brilliant Smallfish', count = 1 } } }

-- Default: Everloot, unchanged.
assert(CS.Choice() == 'everloot' and select(2, CS.Choice()) == false, 'Everloot by default, no fallback')
local base = C.Evaluate(fish, C.Context('Forever', 'Alliance'), 1)
assert(base.profit == 1510 and base.source == 'community' and base.priceSource.name == 'everloot', tostring(base.profit))
assert(not base.external and not base.unknownAge)

-- TSM selected and present: 300c material, two 1,000c items, 5% cut: 2,000 - 100 - 300 = 1,600c.
installTSM()
tsmPrices = { [1] = 300, [4] = 1000, [5] = 450 }
CS.SetChoice('tsm', false)
local ctx = C.Context('Forever', 'Alliance')
assert(ctx.priceSource.name == 'tsm' and ctx.priceSource.available == true and ctx.priceSource.fallback == false)
local est = C.Evaluate(fish, ctx, 1)
assert(est.cost == 300 and est.value == 1000 and est.profit == 1600, 'TSM-priced profit: ' .. tostring(est.profit))
assert(est.source == 'tsm' and est.parts[1].source == 'tsm' and est.observed == nil, 'external source kept')
assert(est.external == true and est.unknownAge == true and est.oldQuote == false, 'unknown age is not called fresh or old')
-- A vendor price this install saw stays the purchase price when it is lower: it is a merchant's price, labelled vendor.
local v = ctx:Quote(5)
assert(v.unit == 300 and v.vendor == true, 'vendor 300c beats TSM 450c')

-- The finished item has no TSM price: its value is unknown, not the Everloot community 900c.
tsmPrices[4] = nil
est = C.Evaluate(fish, C.Context('Forever', 'Alliance'), 1)
assert(est.value == nil and est.profit == nil and est.missing == 'no price', 'no silent fallback: ' .. tostring(est.value))
assert(est.cost == 300)

-- TSM fails mid-session: the call error leaves the material unknown.
tsmPrices[4] = 1000
tsmFail = true
est = C.Evaluate(fish, C.Context('Forever', 'Alliance'), 1)
assert(est.cost == nil and est.profit == nil and est.parts[1].missing == 'API error', tostring(est.parts[1].missing))
tsmFail = nil

-- TSM disappears: unavailable and said; the saved choice is still TSM.
TSM_API = nil
ctx = C.Context('Forever', 'Alliance')
assert(ctx.priceSource.available == false and ctx.priceSource.reason == 'not loaded')
est = C.Evaluate(fish, ctx, 1)
assert(est.cost == nil and est.value == nil and est.profit == nil, 'a missing source prices nothing')
assert(est.parts[1].missing == 'not loaded' and est.missing == 'not loaded')
assert(EverlootDB.craftSource.name == 'tsm' and CS.Choice() == 'tsm', 'the choice never changes by itself')

-- The player's fallback: Everloot prices, each marked with why the selected source gave none.
CS.SetChoice('tsm', true)
est = C.Evaluate(fish, C.Context('Forever', 'Alliance'), 1)
assert(est.profit == 1510 and est.source == 'community' and est.fallback == 'not loaded', tostring(est.profit))
assert(est.parts[1].fallback == 'not loaded' and est.usedFallback == true and not est.external)
-- Per item: TSM's price where it has one, Everloot's where it has none.
installTSM()
tsmPrices = { [1] = 300 }
est = C.Evaluate(fish, C.Context('Forever', 'Alliance'), 1)
assert(est.parts[1].source == 'tsm' and est.parts[1].fallback == nil and est.cost == 300)
assert(est.source == 'community' and est.value == 900 and est.fallback == 'no price' and est.external == true)
assert(est.profit == math.floor(1800 * 95 / 100) - 300, tostring(est.profit))

-- A caller may still ask for Everloot explicitly, whatever the choice.
est = C.Evaluate(fish, C.Context('Forever', 'Alliance', { source = 'everloot' }), 1)
assert(est.profit == 1510 and est.priceSource.name == 'everloot')

-- Auctionator the same way, through the same context.
installAuctionator()
auctionatorPrices = { [1] = 250, [4] = 950 }
CS.SetChoice('auctionator', false)
est = C.Evaluate(fish, C.Context('Forever', 'Alliance'), 1)
assert(est.cost == 250 and est.value == 950 and est.source == 'auctionator', tostring(est.source))
assert(est.profit == math.floor(1900 * 95 / 100) - 250, tostring(est.profit))

-- The selected source never decides the own-scan context: depth and history stay this install's full scans.
local scan = { at = now - 60, house = 'Alliance', items = { [4] = { 4, 6, 24, 380, 400 } } }
function E:OwnScan(realm, house) return scan end
ctx = C.Context('Forever', 'Alliance', { scan = true })
assert(ctx.own == scan, 'the scan is still read for its depth')
est = C.Evaluate(fish, ctx, 1)
assert(est.value == 950 and est.source == 'auctionator', 'the selected source prices the item, not the own scan')
E.OwnScan = nil
CS.SetChoice('everloot')
""")
print("Lua 5.1 price sources: calculator, missing and failing sources, disappearance, explicit fallback")

# 3. The choice: saved as the source name and the fallback switch only; nothing else, and choosing starts no scan.
lua = world()
lua.execute("""
local E, O, CS = Everloot, Everloot.Options, Everloot.CraftingSources
assert(O.CraftSource() == 'everloot' and select(2, O.CraftSource()) == false)
local refreshed = 0
E.RefreshNativeCrafting = function() refreshed = refreshed + 1 end
local start = E.StartScan
E.StartScan = function(...) scanStarts = scanStarts + 1; return start(...) end
O.SetCraftSource('auctionator', true)
assert(O.CraftSource() == 'auctionator' and select(2, O.CraftSource()) == true and refreshed == 1)
local keys = {}
for k, v in pairs(EverlootDB.craftSource) do keys[#keys + 1] = k .. '=' .. tostring(v) end
table.sort(keys)
assert(table.concat(keys, ',') == 'fallback=true,name=auctionator', table.concat(keys, ','))
O.SetCraftSource('bogus', true)
assert(O.CraftSource() == 'everloot' and select(2, O.CraftSource()) == false, 'an unknown source is Everloot')
O.SetCraftSource('everloot', true)
assert(select(2, O.CraftSource()) == false, 'Everloot has nothing to fall back from')
local seen = {}
for i = 1, 5 do
  local name, fallback = O.NextCraftSource()
  seen[i] = name .. (fallback and '+' or '')
end
assert(table.concat(seen, ',') == 'auctionator,auctionator+,tsm,tsm+,everloot', table.concat(seen, ','))
for _, garbage in ipairs({ 'tsm', 5, { name = 5 }, { name = 'tsm', fallback = 'yes' } }) do
  EverlootDB.craftSource = garbage
  local name, fallback = O.CraftSource()
  assert(name == (type(garbage) == 'table' and garbage.name == 'tsm' and 'tsm' or 'everloot') and fallback == false,
    'a hand-edited choice is read safely: ' .. tostring(name))
end
assert(scanStarts == 0 and replicateCalls == 0 and browseCalls == 0, 'choosing a source starts no scan or search')
""")
print("Lua 5.1 price sources: only the choice and fallback are saved; no scan starts")

# 4. Every surface names the external source with unknown age and market, never "community" or "your scan".
lua = world()
lua.execute("""
local E, U, O, CS = Everloot, Everloot.Window, Everloot.Options, Everloot.CraftingSources
local money = U.Money
installTSM()
tsmPrices = { [1] = 300, [4] = 1000 }
O.SetCraftSource('tsm', false)
openProfessions()
fire('ADDON_LOADED', 'Blizzard_Professions')
for _, frame in ipairs(created) do
  if frame.events.ADDON_LOADED and frame.onEvent then frame:onEvent('ADDON_LOADED', 'Blizzard_Professions') end
end
local fish = { recipeID = 7751, name = 'Brilliant Smallfish', learned = true }
local fishSchematic = { outputItemID = 4, quantityMin = 2, quantityMax = 2, reagentSlotSchematics = { slot(1, 1) } }
form:Init(fish, fishSchematic)
drain()
assert(panel() and panel().shown, 'the native estimate is shown')
assert(panel().cost.text == 'Cost per craft: ' .. money(300), panel().cost.text)
assert(panel().details.text:find('TSM prices', 1, true), 'the Details button names TSM: ' .. panel().details.text)
local tip = hover()
local label = 'TSM AHDBMedianBuyout, age and market unknown'
assert(tip:find('1 x Raw Brilliant Smallfish: ' .. money(300) .. ' each, ' .. money(300) .. ' (' .. label .. ')', 1, true), tip)
assert(tip:find('Finished item: ' .. money(1000) .. ' each (' .. label .. ')', 1, true), tip)
assert(not tip:find('(community', 1, true) and not tip:find('(your scan', 1, true), 'never called community: ' .. tip)
assert(tip:find('Prices: TSM', 1, true) and tip:find('No Everloot fallback', 1, true), tip)
assert(tip:find('At the AH:', 1, true) and tip:find('To a vendor:', 1, true), 'both destinations still shown')

-- TSM goes away: unknown, said, with the reason; the choice stays.
TSM_API = nil
E.RefreshNativeCrafting()
form:Init(fish, fishSchematic)
drain()
assert(panel().cost.text == 'Cost per craft: Unavailable', panel().cost.text)
assert(panel().details.text:find('TSM unavailable', 1, true), panel().details.text)
tip = hover()
assert(tip:find('No price (TSM: not loaded)', 1, true), tip)
assert(tip:find('TSM unavailable (not loaded)', 1, true), tip)
assert(O.CraftSource() == 'tsm')

-- With the fallback on, Everloot's prices are shown as the fallback they are.
O.SetCraftSource('tsm', true)
form:Init(fish, fishSchematic)
drain()
assert(panel().cost.text == 'Cost per craft: ' .. money(200), panel().cost.text)
tip = hover()
assert(tip:find('(Everloot fallback, TSM not loaded: community', 1, true), tip)

-- Trainer payback and the Crafting costs page lines.
installTSM()
O.SetCraftSource('tsm', false)
local ctx = U.CraftContext('Forever', 'Alliance')
local row = E.Crafting.Evaluate({ id = 7751, key = 'Cooking|7751', name = 'Brilliant Smallfish', product = 4, live = true,
  output = { itemId = 4, minimum = 2, maximum = 2 }, reagents = { { id = 1, item = 'Raw Brilliant Smallfish', count = 1 } } }, ctx, 1)
local lines = U.TrainerLines({ spellId = 7751, trainingCost = 100, row = row, profit = row.profit, payback = 1 })
assert(lines[1]:find(label, 1, true) and not lines[1]:find('community', 1, true), lines[1])
assert(U.CraftValueLine(row, ctx) == 'Item value: ' .. money(1000) .. ' each (' .. label .. ')', U.CraftValueLine(row, ctx))
assert(U.CraftSourceLine(ctx):find('Prices: TSM', 1, true))
assert(U.CraftSourceLine(U.CraftContext('Forever', 'Alliance')) ~= nil)
O.SetCraftSource('everloot')
assert(U.CraftSourceLine(U.CraftContext('Forever', 'Alliance')) == nil, 'Everloot keeps its existing lines')
""")
print("Lua 5.1 price sources: native Details, trainer and page lines name the source and its unknown age and market")

# 5. Privacy: after refreshing every surface with external prices, scanning and saving, no external price is in the
# saved file, the upload records, the own-scan caches or the crafting history, and the uploads are byte-identical.
SENTINELS = [7771001, 8881002, 7771003, 8881004]


def saved_after(source):
    w = world()
    w.execute(f"""
local E, U, O, CS = Everloot, Everloot.Window, Everloot.Options, Everloot.CraftingSources
installAuctionator(); installTSM()
auctionatorPrices = {{ [2589] = {SENTINELS[0]}, [4] = {SENTINELS[1]} }}
tsmPrices = {{ [2589] = {SENTINELS[2]}, [4] = {SENTINELS[3]} }}
O.SetCraftSource('{source}', false)
E.CraftingPlan.ReplaceKnown(E.CharacterKey(), 185, {{ {{ recipeId = 7751, learned = true, itemId = 4, minimum = 1,
  maximum = 1, reagents = {{ {{ itemId = 2589, count = 2 }} }} }} }}, true)
-- Every surface refreshed with the selected source.
openProfessions()
for _, frame in ipairs(created) do
  if frame.events.ADDON_LOADED and frame.onEvent then frame:onEvent('ADDON_LOADED', 'Blizzard_Professions') end
end
form:Init({{ recipeID = 7751, name = 'Brilliant Smallfish', learned = true }},
  {{ outputItemID = 4, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = {{ slot(2589, 2) }} }})
drain()
hover()
if E.RefreshNativeCrafting then E.RefreshNativeCrafting() end
if U.RefreshCrafting then pcall(U.RefreshCrafting) end
local ctx = U.CraftContext('Forever', 'Alliance')
E.Crafting.Plan({{ id = 7751, product = 4, live = true, output = {{ itemId = 4, minimum = 1, maximum = 1 }},
  reagents = {{ {{ id = 2589, item = 'Linen Cloth', count = 2 }} }} }}, ctx, 3, {{ strategy = 'cheapest' }})
-- A full scan of this house after the external prices were read, then the logout save.
fullScan({{ {{ 2589, 10, 400 }}, {{ 2589, 5, 150 }}, {{ 4, 1, 900 }} }}, 1764320000)
drain()
fire('PLAYER_LOGOUT')
assert(scanStarts == 0, 'nothing but the test started a scan')
-- The upload records as the uploader reads them, and the own-scan and history caches.
local out = {{}}
for _, r in ipairs(EverlootDB.records.auction_snapshot or {{}}) do
  out[#out + 1] = table.concat({{ r.installId, r.capturedAt, r.realm, tostring(r.house), r.scanId, r.part, r.parts }}, '|')
  for _, it in ipairs(r.items) do out[#out + 1] = table.concat(it, ',') end
end
local keys = {{}}
for k in pairs(EverlootDB.records) do keys[#keys + 1] = k end
table.sort(keys)
uploads = table.concat(out, ';') .. '#' .. table.concat(keys, ',')
-- Every number anywhere in the saved variables and the runtime own-scan cache.
found = {{}}
local seen = {{}}
local function walk(v, path)
  if type(v) == 'number' then found[#found + 1] = path .. '=' .. string.format('%.0f', v)
  elseif type(v) == 'string' then for n in v:gmatch('%d+') do found[#found + 1] = path .. '~' .. n end
  elseif type(v) == 'table' and not seen[v] then
    seen[v] = true
    for k, x in pairs(v) do walk(k, path .. '.key'); walk(x, path .. '.' .. tostring(k)) end
  end
end
walk(EverlootDB, 'EverlootDB')
walk(EverlootPricesDB, 'EverlootPricesDB')
walk(E.ownScanCache, 'ownScanCache')
walk(E:OwnScan('Forever', 'Alliance'), 'OwnScan')
history = EverlootDB.craftingHistory ~= nil
choice = EverlootDB.craftSource and (EverlootDB.craftSource.name .. '|' .. tostring(EverlootDB.craftSource.fallback))
""")
    return w.eval("uploads"), list(w.eval("found").values()), w.eval("history"), w.eval("choice")


base_uploads, base_found, _, _ = saved_after("everloot")
for source in ("auctionator", "tsm"):
    uploads, found, history, choice = saved_after(source)
    assert history, "the full scan still kept own history"
    assert choice == f"{source}|false", choice
    assert uploads == base_uploads, f"{source}: upload records are byte-identical to an Everloot-priced session"
    leaked = [f for f in found if any(str(s) in f for s in SENTINELS)]
    assert not leaked, f"{source}: external prices reached the saved file or caches: {leaked}"
    # Event identifiers are random per session; every other saved number is the same as in an Everloot session.
    def stable(numbers):
        return sorted(f for f in numbers if "eventEpoch" not in f and ".eventId" not in f)
    assert stable(found) == stable(base_found), \
        f"{source}: the saved numbers equal an Everloot-priced session: {sorted(set(stable(found)) ^ set(stable(base_found)))}"
print("Lua 5.1 price sources: external prices stay out of saved variables, uploads, own scans and history")
print("crafting_sources_contract: PASS")
