"""Run with: uv run --with lupa python addon/tests/crafting_contract.py

The shared crafting calculator (modules/crafting.lua): one quote policy and one profit calculation that the native
profession window and the window's Crafting costs page both read. A missing price stays unknown, never zero.
"""
from pathlib import Path
from window_world import fresh

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\crafting.lua" in toc, "the shared calculator is in the TOC"
assert toc.index("modules\\crafting.lua") < toc.index("modules\\view_professions.lua"), \
    "the calculator loads before the views that read it"

# Raw Brilliant Smallfish (1) at 200c makes two Brilliant Smallfish (4) at 900c each.
RECORDS = """{
  recipe_observed = {
    { profession = 'Cooking', recipe = 'Brilliant Smallfish', recipeId = 7751, learned = true, productItemId = 4,
      reagents = { { item = 'Raw Brilliant Smallfish', count = 1 } } },
  },
  item_seen = { { itemId = 1, name = 'Raw Brilliant Smallfish' } },
  vendor = { { vendorNpcId = 1, items = { { itemId = 5, priceCopper = 300 } } } },
}"""
lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = " + RECORDS
            + ", recipeOutput = { [7751] = { itemId = 4, minimum = 2, maximum = 2 } } }",
            "EverlootPricesDB = {}\n", extra=("modules/sellcheck.lua", "modules/recipe_cooldown_data.lua", "modules/crafting_plan.lua"))
lua.execute("""
prices = { [1] = 200, [4] = 900, [5] = 400 }
priceDay, priceDate = '2026-10-30', '2026-10-30'
function Everloot:CommunityPrice(realm, id)
  if prices[id] then return { market = prices[id], day = priceDay } end
end
function Everloot:PriceFile(realm) return { status = 'ready', house = 'Alliance', asOf = priceDate } end
""")
lua.execute("""
local E, U = Everloot, Everloot.Window
local C = E.Crafting
assert(type(C) == 'table' and type(C.Context) == 'function' and type(C.Evaluate) == 'function',
  'Everloot.Crafting.Context and Evaluate exist')
local fish = { id = 7751, key = 'Cooking|7751', name = 'Brilliant Smallfish', product = 4, live = true,
  output = { itemId = 4, minimum = 2, maximum = 2 },
  reagents = { { id = 1, item = 'Raw Brilliant Smallfish', count = 1 } } }

-- 200c of input, two 900c items: 1,800c sale, 90c (5%) cut, 1,510c net profit per craft.
local ctx = C.Context('Forever', 'Alliance')
local est = C.Evaluate(fish, ctx, 1)
assert(est.cost == 200 and est.value == 900 and est.yield == 2 and est.cut == 5, 'cost, value, yield and cut')
assert(est.profit == 1510, 'net profit after the 5% cut: ' .. tostring(est.profit))
assert(est.crafts == 1 and est.unpriced == 0 and est.output.minimum == 2 and est.source == 'community')
assert(math.abs(est.margin - 1510 / 200) < 1e-9, 'margin is net profit over materials cost')
assert(est.oldQuote == false, 'fresh community quotes are not old')
local part = est.parts[1]
assert(part.id == 1 and part.count == 1 and part.unit == 200 and part.source == 'community' and not part.vendor)

-- A quote is { unit, source, observed, vendor }; a cheaper vendor price wins and says so.
local q = ctx:Quote(1)
assert(q.unit == 200 and q.source == 'community' and q.observed == '2026-10-30' and q.vendor == false)
-- Item 5's public vendor row says 300c, but that is an offer: it names no purchase quantity or extra cost, so it is
-- not a unit price. Only this install's own merchant evidence for one item with no extra cost is.
local v = ctx:Quote(5)
assert(v.unit == 400 and v.vendor == false, 'a raw vendor offer is not a unit quote: ' .. tostring(v.unit))
unitEvidence({ [5] = 300 })
v = C.Context('Forever', 'Alliance'):Quote(5)
assert(v.unit == 300 and v.vendor == true, 'a verified unit price lower than the market is the quote')
unitEvidence({ [5] = 300.5, [1] = 0, [4] = -1 })
v = C.Context('Forever', 'Alliance'):Quote(5)
assert(v.unit == 400 and v.vendor == false, 'only a positive whole copper unit price counts')
-- The evidence is this character's, on this build, from the last 14 days: anything else proves no unit price.
local key = E.CharacterKey()
local function quoteWith(entry, owner)
  EverlootDB.vendorUnitPrices = { [owner or key] = { [5] = entry } }
  return C.Context('Forever', 'Alliance'):Quote(5)
end
local build = EverlootDB.clientBuild
assert(quoteWith({ copper = 300, at = time(), build = build }).vendor == true, 'this character, now, this build')
assert(quoteWith({ copper = 300, at = time(), build = build }, 'ffffffff').vendor == false, "another character's discount")
assert(quoteWith({ copper = 300, at = time() - 14 * 86400, build = build }).vendor == true, 'fourteen days is still recent')
assert(quoteWith({ copper = 300, at = time() - 14 * 86400 - 1, build = build }).vendor == false, 'older than fourteen days')
assert(quoteWith({ copper = 300, at = time() + 60, build = build }).vendor == false, 'an observation in the future')
assert(quoteWith({ copper = 300, at = time(), build = '1.60.0.70000' }).vendor == false, 'another client build')
assert(quoteWith({ copper = 300, at = time() }).vendor == false, 'no build')
assert(quoteWith({ copper = 300, build = build }).vendor == false, 'no observation time')
EverlootDB.vendorUnitPrices = { [5] = 300 }
assert(C.Context('Forever', 'Alliance'):Quote(5).vendor == false, 'an unscoped price (the unreleased global map) proves nothing')
EverlootDB.clientBuild = nil
assert(quoteWith({ copper = 300, at = time(), build = build }).vendor == false, 'a client that gives no build proves nothing')
EverlootDB.clientBuild = build
unitEvidence({ [5] = 300 })
assert(ctx:Quote(999) == nil, 'no price is no quote')

-- Rounding happens once for the requested count: three crafts sell 5,400c, keep 5,130c, less 600c materials.
local three = C.Evaluate(fish, ctx, 3)
assert(three.crafts == 3 and three.profit == 1510, 'profit stays per craft')
local sale, cut, profit = C.Sale(three, 3)
assert(sale == 5400 and cut == 270 and profit == 4530, table.concat({ sale, cut, profit }, ' '))

-- A missing required input leaves cost, profit and margin unknown, never zero.
local missing = { id = 7752, key = 'x', name = 'Missing', product = 4, live = true,
  output = { itemId = 4, minimum = 1, maximum = 1 }, reagents = { { id = 8, item = 'Missing Reagent', count = 1 } } }
local unknown = C.Evaluate(missing, ctx, 1)
assert(unknown.cost == nil and unknown.profit == nil and unknown.margin == nil and unknown.unpriced == 1)
assert(unknown.value == 900 and unknown.parts[1].unit == nil)
-- An ambiguous slot is unpriced too.
local ambiguous = C.Evaluate({ id = 7753, key = 'y', name = 'Any', product = 4, live = true,
  output = { itemId = 4, minimum = 1, maximum = 1 },
  reagents = { { item = 'Slot accepts multiple reagents', count = 1, ambiguous = true } } }, ctx, 1)
assert(ambiguous.cost == nil and ambiguous.profit == nil and ambiguous.unpriced == 1)

-- Zero materials cost: profit is known, margin is unavailable.
local free = C.Evaluate({ id = 7754, key = 'z', name = 'Free', product = 4, live = true,
  output = { itemId = 4, minimum = 1, maximum = 1 }, reagents = {} }, ctx, 1)
assert(free.cost == 0 and free.profit == 855 and free.margin == nil, 'zero-cost margin is unavailable')

-- Stale quotes stay marked: an old item day, or a community quote from an old price file.
priceDay = '2026-10-26'
assert(C.Evaluate(fish, C.Context('Forever', 'Alliance'), 1).oldQuote == true, 'an old community day is old')
priceDay = '2026-10-30'
assert(C.Evaluate(fish, C.Context('Forever', 'Alliance', { oldFile = true }), 1).oldQuote == true,
  'a community quote from an old price file is old')

-- The own-scan policy: a fresh same-house scan beats the community quote; another house or an old scan is ignored.
local today = E.DayNumber('2026-10-30') * 86400
now = today + 3600
local scan = { at = now - 60, house = 'Alliance', items = { [4] = { 4, 6, 24, 380, 400 } } }
function Everloot:OwnScan(realm, house) return scan end
local scanned = C.Evaluate(fish, C.Context('Forever', 'Alliance', { scan = true }), 1)
assert(scanned.value == 400 and scanned.source == 'scan' and scanned.profit == 560, tostring(scanned.profit))
assert(C.Context('Forever', 'Alliance', { scan = true }).own == scan, 'the context keeps the scan it used')
scan.house = 'Horde'
local cross = C.Evaluate(fish, C.Context('Forever', 'Alliance', { scan = true }), 1)
assert(cross.value == 900 and cross.source == 'community' and cross.profit == 1510, 'a cross-house scan is excluded')
scan.house, scan.at = 'Alliance', now - 86401
assert(C.Evaluate(fish, C.Context('Forever', 'Alliance', { scan = true }), 1).source == 'community',
  'a scan older than a day is excluded')
scan.at = today - 60
priceDay = '2026-10-30'
assert(C.Evaluate(fish, C.Context('Forever', 'Alliance', { scan = true }), 1).source == 'community',
  'a scan before the community observation day loses to it')
scan.house, scan.at = 'Alliance', now - 60
assert(C.Evaluate(fish, C.Context('Forever', 'Alliance'), 1).source == 'community', 'no scan without options.scan')
scan = nil

-- A caller may quote another house without mixing it with the active character's community block.
local community = E.CommunityPrice
function E:CommunityPrice(realm, id, house)
  if house == 'Horde' then return { market = id == 4 and 1000 or 200, day = priceDay } end
  return community(self, realm, id)
end
assert(C.Evaluate(fish, C.Context('Forever', 'Horde'), 1).value == 1000,
  'community lookup honors the context house')
E.CommunityPrice = community

-- The native display and the Crafting costs page agree with the calculator on the same fixture.
local native = U.NativeCraftEstimate(fish)
assert(native.profit == 1510 and native.cost == 200 and native.margin == est.margin and native.crafts == 1,
  'native estimate: ' .. tostring(native.profit))
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.toggle.scripts.OnClick()
local row = p.craft.rows[1]
assert(row.shown and row.name.text == 'Brilliant Smallfish', tostring(row.name.text))
assert(row.cost.text == U.MoneyShort(200) and row.value.text == U.MoneyShort(900)
  and row.profit.text == '+' .. U.MoneyShort(1510), row.profit.text)
local b = p.craft.buy
assert(b.math.text == 'Sale: ' .. U.Money(1800) .. ' - 5% AH cut: ' .. U.Money(90)
  .. ' - materials: ' .. U.Money(200) .. ' = ' .. U.Money(1510) .. ' profit', b.math.text)
assert(not U.failed)
""")

# Ranked: one order for the native panel and the Crafting costs page. Profit per craft first; unknown profit last
# and never "profitable"; ties by name, then recipe ID. Tags say gain, loss, unknown and old in text, not colour.
lua.execute("""
local E, U = Everloot, Everloot.Window
local C = E.Crafting
assert(type(C.Ranked) == 'function' and type(C.Rank) == 'function' and type(C.Tag) == 'function', 'Ranked, Rank and Tag')
local function recipe(id, name, product, reagent)
  return { id = id, key = 'Cooking|' .. id, name = name, product = product, live = true,
    output = { itemId = product, minimum = 1, maximum = 1 }, reagents = { { id = reagent, item = 'R' .. reagent, count = 1 } } }
end
prices[6], prices[7] = 2000, 100
local list = {
  recipe(30, 'Zesty Stew', 4, 1),        -- 900 - 45 - 200 = 655
  recipe(20, 'Brilliant Stew', 4, 1),    -- 655, ties by name before Zesty
  recipe(10, 'Brilliant Stew', 4, 1),    -- 655, same name: lower recipe ID first
  recipe(40, 'Loss Loaf', 7, 6),         -- 100 - 5 - 2000 = -1905
  recipe(50, 'Aardvark Unknown', 4, 999),-- no reagent price: unknown, last even by its name
}
local ctx = C.Context('Forever', 'Alliance')
local ranked = C.Ranked(list, ctx, { sort = 'profit' })
local ids = {}
for i, r in ipairs(ranked) do ids[i] = r.id end
assert(table.concat(ids, ',') == '10,20,30,40,50', 'profit order, stable ties, unknown last: ' .. table.concat(ids, ','))
local named = C.Ranked(list, ctx, { sort = 'name' })
ids = {}
for i, r in ipairs(named) do ids[i] = r.id end
assert(table.concat(ids, ',') == '50,10,20,40,30', 'name order then recipe ID: ' .. table.concat(ids, ','))
local profitable = C.Ranked(list, ctx, { sort = 'profit', profitableOnly = true })
ids = {}
for i, r in ipairs(profitable) do ids[i] = r.id end
assert(table.concat(ids, ',') == '10,20,30', 'profitable only drops losses and unknown profit: ' .. table.concat(ids, ','))
-- Rank re-sorts estimates already evaluated, without evaluating again.
assert(#C.Rank(ranked, { sort = 'profit', profitableOnly = true }) == 3 and #ranked == 5, 'Rank does not change its input')

-- Tags: money, margin or both; the sign carries gain or loss; unknown and checking are words; old is said.
local gain, loss, unknown = ranked[1], ranked[4], ranked[5]
assert(C.Tag(gain, 'money') == '+' .. U.MoneyShort(655), C.Tag(gain, 'money'))
assert(C.Tag(loss, 'money') == U.MoneyShort(-1905) and C.Tag(loss, 'money'):sub(1, 1) == '-', C.Tag(loss, 'money'))
assert(C.Tag(gain, 'margin') == '+328%', C.Tag(gain, 'margin'))
assert(C.Tag(loss, 'margin') == '-95%', C.Tag(loss, 'margin'))
assert(C.Tag(gain, 'both') == '+' .. U.MoneyShort(655) .. ' +328%', C.Tag(gain, 'both'))
assert(C.Ranked(list, ctx, { tag = 'both' })[1].tag == C.Tag(gain, 'both'), 'Ranked honors its requested tag mode')
assert(C.Tag(unknown, 'money') == 'no price', C.Tag(unknown, 'money'))
assert(C.Tag(unknown, 'money', true) == 'checking', 'a price file still being checked says so')
local free = C.Evaluate({ id = 60, key = 'f', name = 'Free', product = 4, live = true,
  output = { itemId = 4, minimum = 1, maximum = 1 }, reagents = {} }, ctx, 1)
assert(C.Tag(free, 'margin') == '+' .. U.MoneyShort(855), 'no margin for a free craft: the money is shown instead')
priceDay = '2026-10-26'
local stale = C.Evaluate(list[1], C.Context('Forever', 'Alliance'), 1)
assert(C.Tag(stale, 'money') == '+' .. U.MoneyShort(655) .. ' old', 'an old quote is said in the tag: ' .. C.Tag(stale, 'money'))
priceDay = '2026-10-30'
""")

# Destinations: the auction house takes the actual house's cut; a vendor pays the client's verified sell price, never
# the price a vendor asked this install for. A missing sell price is unknown, not zero.
lua.execute("""
local E, U = Everloot, Everloot.Window
local C = E.Crafting
prices[10], prices[11] = 1000, 100
sellPrices, loadRequests = { [10] = 300 }, {}
-- Forever's C_Item.GetItemInfo returns a tuple (sellPrice is the 11th value) and may return nothing until loaded.
C_Item = C_Item or {}
C_Item.GetItemInfo = function(id)
  local sell = sellPrices[id]
  if sell == nil then return end
  return 'Item ' .. id, 'link', 1, 10, 1, 'Trade Goods', 'Cloth', 20, '', 1, sell, 7, 0
end
C_Item.RequestLoadItemDataByID = function(id) loadRequests[#loadRequests + 1] = id end
local recipe = { id = 900, key = 'Tailoring|900', name = 'Sell Test', product = 10, live = true,
  output = { itemId = 10, minimum = 1, maximum = 1 }, reagents = { { id = 11, item = 'R11', count = 1 } } }

assert(type(C.VendorSell) == 'function' and C.VendorSell(10) == 300, 'the verified client sell price')
-- 1,000c output, 100c input: 850c at a 5% house, 750c at a 15% house; 300c at a vendor gives 200c.
local ah = C.Evaluate(recipe, C.Context('Forever', 'Alliance'), 1)
assert(ah.destination == 'ah' and ah.profit == 850 and ah.saleGross == 1000 and ah.cutCopper == 50,
  'AH: ' .. tostring(ah.profit) .. ' ' .. tostring(ah.saleGross) .. ' ' .. tostring(ah.cutCopper))
assert(ah.ahProfit == 850 and ah.vendorProfit == 200 and ah.vendorValue == 300, 'both comparisons are kept')
local neutral = C.Evaluate(recipe, C.Context('Forever', 'Neutral'), 1)
assert(neutral.cut == 15 and neutral.profit == 750 and neutral.cutCopper == 150, 'the neutral house takes 15%')
local vctx = C.Context('Forever', 'Alliance', { destination = 'vendor' })
local vendor = C.Evaluate(recipe, vctx, 1)
assert(vendor.destination == 'vendor' and vendor.profit == 200 and vendor.saleGross == 300 and vendor.cutCopper == 0,
  'vendor: ' .. tostring(vendor.profit))
assert(vendor.ahProfit == 850 and math.abs(vendor.margin - 2) < 1e-9, 'vendor margin is over materials too')
assert(C.Tag(vendor, 'money') == '+' .. U.MoneyShort(200), C.Tag(vendor, 'money'))
local sale, cut, profit = C.Sale(vendor, 3)
assert(sale == 900 and cut == 0 and profit == 600, 'vendor batch: ' .. table.concat({ sale, cut, profit }, ' '))
sale, cut, profit = C.Sale(vendor, 3, 'ah')
assert(sale == 3000 and cut == 150 and profit == 2550, 'the AH comparison for the same count')

-- Batch rounding stays once per count: 301c x 1.5 items is 451c a craft, 1,354c (not 1,353c) for three.
sellPrices[10] = 301
local variable = { id = 901, key = 'Tailoring|901', name = 'Variable', product = 10, live = true,
  output = { itemId = 10, minimum = 1, maximum = 2 }, reagents = { { id = 11, item = 'R11', count = 1 } } }
local v = C.Evaluate(variable, C.Context('Forever', 'Alliance', { destination = 'vendor' }), 1)
assert(v.saleGross == 451 and v.profit == 351, 'vendor per craft: ' .. tostring(v.saleGross))
sale, cut, profit = C.Sale(v, 3)
assert(sale == 1354 and cut == 0 and profit == 1054, 'vendor batch rounds once: ' .. sale)
sellPrices[10] = 300

-- Item 5 has a vendor purchase price (300c) but no verified sell price: vendor profit stays unknown.
local five = { id = 902, key = 'Tailoring|902', name = 'Bought Item', product = 5, live = true,
  output = { itemId = 5, minimum = 1, maximum = 1 }, reagents = { { id = 11, item = 'R11', count = 1 } } }
assert(C.VendorSell(5) == nil and loadRequests[#loadRequests] == 5, 'an unloaded item asks the client to load it')
local unknown = C.Evaluate(five, C.Context('Forever', 'Alliance', { destination = 'vendor' }), 1)
assert(unknown.profit == nil and unknown.vendorProfit == nil and unknown.saleGross == nil and unknown.margin == nil,
  'a vendor purchase price is never a sell price')
assert(unknown.vendorPending == true and C.Tag(unknown, 'money') == 'checking', 'loading item data is retried')
assert(unknown.ahProfit == 400 - 20 - 100, 'the AH comparison still shows: ' .. tostring(unknown.ahProfit))
sellPrices[5] = 0
local none = C.Evaluate(five, C.Context('Forever', 'Alliance', { destination = 'vendor' }), 1)
assert(none.profit == nil and not none.vendorPending and C.Tag(none, 'money') == 'no price', 'no vendor value is unknown')
-- Only the tuple shape counts: a table is not read as a sell price.
local tuple = C_Item.GetItemInfo
C_Item.GetItemInfo = function() return { sellPrice = 300 } end
assert(C.VendorSell(10) == nil, 'a table return is not a sell price')
C_Item.GetItemInfo = nil
assert(C.VendorSell(10) == nil, 'no API, no sell price')
C_Item.GetItemInfo = tuple
-- Ranking follows the selected destination.
local list = { recipe, five }
local order = C.Ranked(list, C.Context('Forever', 'Alliance'), { sort = 'profit' })
assert(order[1].id == 900 and order[2].id == 902, 'AH order')
sellPrices[5] = 5000
order = C.Ranked(list, C.Context('Forever', 'Alliance', { destination = 'vendor' }), { sort = 'profit' })
assert(order[1].id == 902 and order[1].profit == 4900, 'vendor order')
sellPrices[5] = nil

-- One saved destination drives the Crafting costs page and its breakdown; both comparisons are in Cost details.
local O = E.Options
assert(O.CraftDestination() == 'ah', 'AH by default')
local c = EverlootWindow.professions.craft
assert(c.destButton and c.destButton.text == 'Sell: AH', tostring(c.destButton and c.destButton.text))
c.destButton.scripts.OnClick()
assert(O.CraftDestination() == 'vendor' and EverlootDB.craftDestination == 'vendor' and c.destButton.text == 'Sell: vendor')
local fishLine = c.rows[1]
for _, line in ipairs(c.rows) do local r = rawget(line, 'row'); if r and r.name == 'Brilliant Smallfish' then fishLine = line end end
assert(fishLine.row.destination == 'vendor' and fishLine.row.profit == nil and fishLine.profit.text == '-',
  'no verified sell price for the fish: ' .. tostring(fishLine.profit.text))
sellPrices[4] = 120
c.destButton.scripts.OnClick(); c.destButton.scripts.OnClick()
for _, line in ipairs(c.rows) do local r = rawget(line, 'row'); if r and r.name == 'Brilliant Smallfish' then fishLine = line end end
assert(fishLine.row.profit == 40 and fishLine.profit.text == '+' .. U.MoneyShort(40), tostring(fishLine.profit.text))
assert(c.head.value.text == 'Vendor price' and fishLine.value.text == U.MoneyShort(120), c.head.value.text)
fishLine.scripts.OnClick()
local b = c.buy
b.details.scripts.OnClick()
assert(b.math.text == 'Vendor sale: ' .. U.Money(240) .. ' - materials: ' .. U.Money(200) .. ' = ' .. U.Money(40)
  .. ' profit', b.math.text)
assert(b.alt.shown and b.alt.text == 'At the AH: ' .. U.Money(1800) .. ' - 5% cut: ' .. U.Money(90) .. ' - materials: '
  .. U.Money(200) .. ' = ' .. U.Money(1510) .. ' profit for 1 craft', tostring(b.alt.text))
c.destButton.scripts.OnClick()
assert(b.math.text:find('^Sale: ') and b.alt.text == 'To a vendor: ' .. U.Money(240) .. ' - materials: ' .. U.Money(200) .. ' = '
  .. U.Money(40) .. ' profit for 1 craft',
  tostring(b.alt.text))
sellPrices[4] = 0  -- the client says vendors do not buy it
c.destButton.scripts.OnClick()
assert(b.alt.text == 'At the AH: ' .. U.Money(1800) .. ' - 5% cut: ' .. U.Money(90) .. ' - materials: ' .. U.Money(200)
  .. ' = ' .. U.Money(1510) .. ' profit for 1 craft'
  and b.math.text == 'Profit unknown: no verified vendor sell price for the finished item.', b.math.text)
O.SetCraftDestination('ah')

-- Another addon's prices (crafting_sources.lua): the status line names them with their unknown age and market, each
-- buy line names the addon, and a missing addon is said; the Prices button cycles the saved choice.
local prices = { [1] = 250, [4] = 950 }
Auctionator = { API = { v1 = { GetAuctionPriceByItemID = function(caller, id) return prices[id] end } } }
assert(c.sourceButton and c.sourceButton.text == 'Prices: Everloot', tostring(c.sourceButton and c.sourceButton.text))
c.sourceButton.scripts.OnClick()
assert(O.CraftSource() == 'auctionator' and c.sourceButton.text == 'Prices: Auctionator', c.sourceButton.text)
assert(c.age.text:find('Prices: Auctionator, age and market unknown', 1, true) == 1, c.age.text)
for _, line in ipairs(c.rows) do local r = rawget(line, 'row'); if r and r.name == 'Brilliant Smallfish' then fishLine = line end end
assert(fishLine.row.cost == 250 and fishLine.row.value == 950 and fishLine.row.profit == math.floor(1900 * 95 / 100) - 250,
  tostring(fishLine.row.profit))
b.details.scripts.OnClick()
assert(b.lines[1].text == '1 × Raw Brilliant Smallfish · ' .. U.Money(250) .. ' each (Auctionator) · ' .. U.Money(250),
  tostring(b.lines[1].text))
Auctionator = nil
U.RefreshCrafting()
assert(c.age.text:find('Prices: Auctionator unavailable (not loaded)', 1, true) == 1, c.age.text)
assert(b.lines[1].text:find('no price (Auctionator: not loaded)', 1, true), b.lines[1].text)
O.SetCraftSource('everloot')
assert(c.sourceButton.text == 'Prices: Everloot' and not c.age.text:find('Auctionator', 1, true), c.age.text)
assert(not U.failed)
""")

# Plans: the shared calculator hands one recipe to CraftingPlan.Resolve by item IDs and values the selected count with
# the plan's material cost, rounded once like Sale. A character's recipe is a route only with capacity evidence.
lua.execute("""
local E = Everloot
local C = E.Crafting
assert(type(C.Plan) == 'function' and type(C.PlanSale) == 'function' and type(C.PlanRecipe) == 'function')
-- The clock moved with the scan tests above: this character's merchant evidence for item 5 is seen again, now.
unitEvidence({ [5] = 300 })
local fish = { id = 7751, key = 'Cooking|7751', name = 'Brilliant Smallfish', product = 4, live = true,
  output = { itemId = 4, minimum = 2, maximum = 2 },
  reagents = { { id = 1, item = 'Raw Brilliant Smallfish', count = 1 } } }
local ctx = C.Context('Forever', 'Alliance')
local est = C.Evaluate(fish, ctx, 1)
-- Recipe 9001 makes two raw fish (1, 200c each) from one item 5 (300c at a vendor).
local known = { [9001] = { recipeId = 9001, professionId = 185, learned = true, itemId = 1, minimum = 2, maximum = 2,
  reagents = { { itemId = 5, count = 1 } } } }
local free = { [9001] = true }
local buy = C.Plan(fish, ctx, 2, { known = known, noCooldown = free })
assert(buy.strategy == 'buy' and buy.cost == 400 and #buy.steps == 1 and buy.steps[1].recipeId == 7751
  and buy.steps[1].crafts == 2, 'buy plan')
local cheap = C.Plan(fish, ctx, 2, { strategy = 'cheapest', known = known, noCooldown = free })
assert(cheap.cost == 300 and cheap.buyCost == 400 and #cheap.steps == 2 and cheap.steps[1].recipeId == 9001
  and cheap.steps[1].crafts == 1 and cheap.purchases[1].id == 5 and cheap.purchases[1].count == 1, 'cheapest plan')
-- One craft needs one fish: a craft making two for 300c loses to buying one for 200c.
assert(C.Plan(fish, ctx, 1, { strategy = 'cheapest', known = known, noCooldown = free }).cost == 200)
-- Selected-count valuation: two crafts sell 3,600c, keep 3,420c after the 5% cut.
local sale, cut, profit = C.PlanSale(est, 2, cheap.cost)
assert(sale == 3600 and cut == 180 and profit == 3120, table.concat({ sale, cut, profit }, ' '))
local s2, c2, p2 = C.Sale(est, 2)
local _, _, buyProfit = C.PlanSale(est, 2, buy.cost)
assert(s2 == sale and c2 == cut and p2 == buyProfit and buyProfit == 3020, 'the buy plan agrees with Sale')
local unknownSale, _, unknownProfit = C.PlanSale(est, 2, nil)
assert(unknownSale == 3600 and unknownProfit == nil, 'no plan cost, no profit')
assert(C.PlanSale(est, 2, cheap.cost, 'vendor') == nil, 'no verified vendor price, no vendor sale')
-- Without a no-cooldown source the recipe is excluded, by name of its reason, and the buy route is kept.
local unproven = C.Plan(fish, ctx, 2, { strategy = 'cheapest', known = known })
assert(unproven.cost == 400 and unproven.exclusions[1].recipeId == 9001 and unproven.exclusions[1].reason == 'capacity')
-- Public rows reach the planner by item ID through this install's item names; an ambiguous slot stays unknown.
local row = C.Recipes()['Cooking|7751']
local def = C.PlanRecipe(row, ctx)
assert(def.reagents and def.reagents[1].itemId == 1 and def.itemId == 4 and def.minimum == 2, 'public row by item ID')
local any = { id = 7753, key = 'y', name = 'Any', product = 4, live = true, output = { itemId = 4, minimum = 1, maximum = 1 },
  reagents = { { item = 'Slot accepts multiple reagents', count = 1, ambiguous = true } } }
assert(C.PlanRecipe(any, ctx).reagents == nil)
local blocked = C.Plan(any, ctx, 1, { strategy = 'cheapest', known = known, noCooldown = free })
assert(blocked.cost == nil and blocked.complete == false and blocked.exclusions[1].reason == 'reagents')
-- No character identity: no proven recipes, so only the buy route.
assert(C.Plan(fish, ctx, 2, { strategy = 'cheapest', noCooldown = free }).cost == 400)
""")

# The real default: no injected evidence. The generated client cooldown data counts only on an exact build match;
# a recipe it does not cover, another build or an unknown build stays unknown and says why. Recipe 2963 is covered with
# no cooldown recorded; 18560 has one recorded. Both make raw fish (1, 200c) from item 5 (300c at a vendor) here.
lua.execute("""
local E = Everloot
local C = E.Crafting
-- The clock moved with the scan tests above: this character's thread evidence is seen again, now.
unitEvidence({ [5] = 300 })
local fish = { id = 7751, key = 'Cooking|7751', name = 'Brilliant Smallfish', product = 4, live = true,
  output = { itemId = 4, minimum = 2, maximum = 2 },
  reagents = { { id = 1, item = 'Raw Brilliant Smallfish', count = 1 } } }
local ctx = C.Context('Forever', 'Alliance')
local function maker(id) return { [id] = { recipeId = id, professionId = 185, learned = true, itemId = 1, minimum = 2,
  maximum = 2, reagents = { { itemId = 5, count = 1 } } } } end
local function reason(p, id)
  for _, x in ipairs(p.exclusions) do if x.recipeId == id then return x.reason, x.detail end end
end
local build = { '1.60.1', '71139' }
GetBuildInfo = function() return build[1], build[2], 'Nov 1 2026', 16001 end
local ev = C.CooldownEvidence()
assert(ev.status == 'match' and ev.build == '1.60.1.71139' and ev.running == '1.60.1.71139', tostring(ev.status))
assert(ev.noCooldown[2963] and not ev.noCooldown[18560] and ev.limited[18560] and ev.limited[17187].category == 310)
assert(ev.basis == 'No cooldown recorded in client data, build 1.60.1.71139', ev.basis)
assert(ev.disclosure:find('9 SpellCooldowns and 12 SpellCategories blocks could not be read', 1, true)
  and ev.disclosure:find('server changes', 1, true) and not ev.disclosure:lower():find('unlimited'), ev.disclosure)
local p = C.Plan(fish, ctx, 2, { strategy = 'cheapest', known = maker(2963) })
assert(p.cost == 300 and p.steps[1].recipeId == 2963 and p.assumed[1] == 2963 and p.basis == ev.basis,
  'a covered recipe with no recorded cooldown is a route: ' .. tostring(p.cost))
-- Covered with a recorded cooldown: needs a current read in its own open window; none here.
p = C.Plan(fish, ctx, 2, { strategy = 'cheapest', known = maker(18560) })
assert(p.cost == 400 and reason(p, 18560) == 'cooldown', 'recorded cooldown, no current read')
-- The default reader asks professions.lua for this character, profession and recipe; a ready read allows one craft.
local asked
E.CurrentRecipeCooldown = function(key, profession, recipe) asked = { key, profession, recipe }; return { returned = false } end
p = C.Plan(fish, ctx, 4, { strategy = 'cheapest', known = maker(18560) })
assert(asked[2] == 185 and asked[3] == 18560 and asked[1] == E.CharacterKey(), 'reads this character, its profession and recipe')
assert(p.cost == 700 and p.steps[1].recipeId == 18560 and p.steps[1].crafts == 1, 'one ready craft, the rest bought: ' .. tostring(p.cost))
E.CurrentRecipeCooldown = function() return { cooldown = 3600, returned = true } end
assert(C.Plan(fish, ctx, 2, { strategy = 'cheapest', known = maker(18560) }).cost == 400, 'cooling now')
E.CurrentRecipeCooldown = nil
-- Not covered by the data.
p = C.Plan(fish, ctx, 2, { strategy = 'cheapest', known = maker(9001) })
local why, detail = reason(p, 9001)
assert(p.cost == 400 and why == 'capacity' and detail == 'not in client cooldown data', tostring(detail))
-- Another build, then an unknown one: fail closed and say why.
build = { '1.60.2', '72000' }
p = C.Plan(fish, ctx, 2, { strategy = 'cheapest', known = maker(2963) })
why, detail = reason(p, 2963)
assert(p.cost == 400 and C.CooldownEvidence().status == 'mismatch' and detail == 'data for another build', tostring(detail))
assert(C.Plan(fish, ctx, 2, { strategy = 'cheapest', known = maker(18560) }).cost == 400, 'a recorded cooldown still holds')
GetBuildInfo = nil
p = C.Plan(fish, ctx, 2, { strategy = 'cheapest', known = maker(2963) })
why, detail = reason(p, 2963)
assert(p.cost == 400 and detail == 'client build unknown', tostring(detail))
-- Missing data.
local data = E.RECIPE_COOLDOWNS
E.RECIPE_COOLDOWNS = nil
GetBuildInfo = function() return '1.60.1', '71139' end
why, detail = reason(C.Plan(fish, ctx, 2, { strategy = 'cheapest', known = maker(2963) }), 2963)
assert(detail == 'no cooldown data', tostring(detail))
E.RECIPE_COOLDOWNS = data
-- Buy all never uses the evidence.
assert(C.Plan(fish, ctx, 2, { known = maker(2963) }).cost == 400)
GetBuildInfo = nil
""")

# Break-even: the highest whole unit price for one bought material that keeps the selected count's profit at or
# above zero, every other material at its quote, through the calculator's own Sale rounding, cut and destination.
# Items: 10 is the material solved for, 11 another material, 12 the product. Hand-checked cases E1-E5 are
# market-context-qa-cases.md section 6.
be = fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }", "EverlootPricesDB = {}\n",
           extra=("modules/sellcheck.lua", "modules/recipe_cooldown_data.lua", "modules/crafting_plan.lua"))
be.execute("""
prices = {}
function Everloot:CommunityPrice(realm, id)
  if prices[id] then return { market = prices[id], day = '2026-10-30' } end
end
sells = {}
C_Item = { GetItemInfo = function(id)
  return 'Item ' .. id, nil, nil, nil, nil, nil, nil, nil, nil, nil, sells[id]
end }
""")
be.execute("""
local E = Everloot
local C = E.Crafting
assert(type(C.BreakEven) == 'function', 'Crafting.BreakEven exists')
local function recipe(out, perCraft, slots)
  local reagents = {}
  for _, s in ipairs(slots) do reagents[#reagents + 1] = { id = s[1], item = 'Item ' .. s[1], count = s[2] } end
  return { id = 9000, key = 'k', name = 'Case', product = 12, live = true,
    output = out and { itemId = 12, minimum = perCraft, maximum = perCraft } or nil, reagents = reagents }
end
-- The profit for `crafts` crafts with material 10 bought at `u`, through Evaluate and Sale as every view computes it.
local function profitAt(r, house, destination, crafts, u)
  local saved = prices[10]
  prices[10] = u
  local est = C.Evaluate(r, C.Context('Forever', house, { destination = destination }), crafts)
  prices[10] = saved
  local _, _, profit = C.Sale(est, crafts)
  return profit
end
local function case(name, r, house, destination, crafts, want)
  local ctx = C.Context('Forever', house, { destination = destination })
  local u, why = C.BreakEven(r, 10, ctx, crafts)
  assert(u == want, name .. ': ' .. tostring(u) .. ' ' .. tostring(why))
  local at, above = profitAt(r, house, destination, crafts, u), profitAt(r, house, destination, crafts, u + 1)
  assert(at >= 0 and above < 0, name .. ': profit ' .. at .. ' at the break-even, ' .. above .. ' one copper above')
  return at, above
end
assert(C.Context('Forever', 'Neutral').cut == 15, 'the neutral house cut')
-- E1: one craft, one 1,000c item, 15% cut: 850 - 100 - 2u.
prices = { [11] = 100, [12] = 1000 }
local at, above = case('E1', recipe(true, 1, { { 10, 2 }, { 11, 1 } }), 'Neutral', 'ah', 1, 375)
assert(at == 0 and above == -2)
-- E2: four crafts of two 300c items, rounded once: 2,040 - 200 - 12u.
prices = { [11] = 50, [12] = 300 }
at, above = case('E2', recipe(true, 2, { { 10, 3 }, { 11, 1 } }), 'Neutral', 'ah', 4, 153)
assert(at == 4 and above == -8, at .. ' ' .. above)
-- E3: sold to a vendor at 500c, no cut: 500 - 120 - u.
prices = { [11] = 120 }
sells = { [12] = 500 }
at, above = case('E3', recipe(true, 1, { { 10, 1 }, { 11, 1 } }), 'Neutral', 'vendor', 1, 380)
assert(at == 0 and above == -1)
sells = {}
-- E4: the material in two slots varies together: 850 - 100 - 3u.
prices = { [11] = 100, [12] = 1000, [10] = 200 }
at, above = case('E4', recipe(true, 1, { { 10, 2 }, { 11, 1 }, { 10, 1 } }), 'Neutral', 'ah', 1, 250)
assert(at == 0 and above == -3)
-- The Alliance house's 5% cut comes from the context, not a fixed 15%: 950 - 100 - 2u.
prices = { [11] = 100, [12] = 1000 }
case('Alliance', recipe(true, 1, { { 10, 2 }, { 11, 1 } }), 'Alliance', 'ah', 1, 425)

-- No break-even, and why.
-- A context caches its quotes: each case reads the prices it sets.
local function neutral() return C.Context('Forever', 'Neutral') end
local u, why
prices = { [11] = 900, [12] = 1000 }
u, why = C.BreakEven(recipe(true, 1, { { 10, 1 }, { 11, 1 } }), 10, neutral(), 1)
assert(u == nil and why == 'loss', 'E5: the other materials already cost more than the sale: ' .. tostring(why))
prices = { [11] = 100, [12] = 1000 }
u, why = C.BreakEven(recipe(true, 1, { { 10, 1 }, { 11, 1 } }), 13, neutral(), 1)
assert(u == nil and why == 'not an input', tostring(why))
u, why = C.BreakEven(recipe(true, 1, { { 10, 1 }, { 11, 1 } }), 12, neutral(), 1)
assert(u == nil and why == 'not an input', 'the recipe makes that item: ' .. tostring(why))
local ambiguous = recipe(true, 1, { { 10, 1 } })
ambiguous.reagents[2] = { item = 'Slot accepts multiple reagents', count = 1, ambiguous = true }
u, why = C.BreakEven(ambiguous, 10, neutral(), 1)
assert(u == nil and why == 'unpriced', 'an ambiguous other slot is an unknown cost: ' .. tostring(why))
prices = { [12] = 1000 }
u, why = C.BreakEven(recipe(true, 1, { { 10, 1 }, { 11, 1 } }), 10, neutral(), 1)
assert(u == nil and why == 'unpriced', 'an unpriced other material is never 0: ' .. tostring(why))
prices = { [11] = 100 }
u, why = C.BreakEven(recipe(true, 1, { { 10, 1 }, { 11, 1 } }), 10, neutral(), 1)
assert(u == nil and why == 'no sale price', tostring(why))
prices = { [11] = 100, [12] = 1000 }
u, why = C.BreakEven(recipe(false, 1, { { 10, 1 }, { 11, 1 } }), 10, neutral(), 1)
assert(u == nil and why == 'no yield', 'a live recipe without its output: ' .. tostring(why))
-- A stored row whose output this install never recorded: no yield either, never one item.
local stored = recipe(false, 1, { { 10, 1 }, { 11, 1 } })
stored.live = nil
EverlootDB.recipeOutput = {}
u, why = C.BreakEven(stored, 10, neutral(), 1)
assert(u == nil and why == 'no yield', 'a stored row without its output: ' .. tostring(why))
prices[10] = 100
local est = C.Evaluate(stored, neutral(), 1)
prices[10] = nil
assert(est.yieldUnknown == true and est.cost == 200 and est.profit == nil and est.ahProfit == nil and C.PlanSale(est, 1, 200) == nil,
  'a stored row keeps its cost and has no sale: ' .. tostring(est.profit))
assert(C.PlanRecipe(stored, neutral()).minimum == nil, 'no output assumed for the planner either')
u, why = C.BreakEven(recipe(true, 1, { { 10, 1 }, { 11, 1 } }), 10, neutral(), 0)
assert(u == nil and why == 'no count', tostring(why))
-- A material the cheapest route makes from a learned recipe is not bought: no buy-price break-even.
prices = { [11] = 100, [12] = 1000, [10] = 500, [13] = 1 }
local known = { [5000] = { recipeId = 5000, professionId = 171, learned = true, itemId = 10, minimum = 1, maximum = 1,
  reagents = { { itemId = 13, count = 1 } } } }
u, why = C.BreakEven(recipe(true, 1, { { 10, 1 }, { 11, 1 } }), 10, neutral(), 1,
  { known = known, noCooldown = { [5000] = true } })
assert(u == nil and why == 'made', 'a subcrafted material: ' .. tostring(why))
u = C.BreakEven(recipe(true, 1, { { 10, 1 }, { 11, 1 } }), 10, neutral(), 1, { known = {} })
assert(u == 750, 'bought when nothing makes it: ' .. tostring(u))
""")

# Shared parity fixture (addon/tests/fixtures/crafting-parity.json): the website's calculator and planner
# (web/src/lib/crafting-profit.parity.test.ts) are held to the same cases. Here they run through the real Context,
# Evaluate, PlanSale, Rank and CraftingPlan.Resolve: market quotes as community rows, verified merchant unit evidence
# as this install's local vendorUnitPrices, raw vendor offers as public vendor rows, sell prices from the client.
import json


def to_lua(value):
    if value is None:
        return "nil"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, list):
        return "{" + ", ".join(to_lua(v) for v in value) + "}"
    return "{" + ", ".join(f"[{to_lua(int(k) if k.isdigit() else k)}] = {to_lua(v)}" for k, v in value.items()) + "}"


parity = json.loads((root / "tests" / "fixtures" / "crafting-parity.json").read_text(encoding="utf-8"))
lua_parity = json.loads(json.dumps(parity))
for plan_case in lua_parity["plans"]["cases"]:
    plan_case["market"] = {k: (False if v is None else v) for k, v in plan_case.get("market", {}).items()}
pa =fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }", "EverlootPricesDB = {}\n",
           extra=("modules/sellcheck.lua", "modules/recipe_cooldown_data.lua", "modules/crafting_plan.lua"))
pa.execute("parity = " + to_lua(lua_parity))
pa.execute("""
local E = Everloot
local C, CP = E.Crafting, E.CraftingPlan
assert(E.DayNumber(date('!%Y-%m-%d')) == E.DayNumber(parity.today), 'the fixture day is the harness day')
local market, sells = {}, {}
function Everloot:CommunityPrice(realm, id, house)
  local q = market[id]
  if q then return { market = q.unit, min = q.min, day = q.day } end
end
C_Item = { GetItemInfo = function(id) return 'Item ' .. id, nil, nil, nil, nil, nil, nil, nil, nil, nil, sells[id] or 0 end }
local function setWorld(m, unit, raw, sell)
  market, sells = m or {}, sell or {}
  unitEvidence(unit or {})
  local items = {}
  for id, price in pairs(raw or {}) do items[#items + 1] = { itemId = id, priceCopper = price } end
  EverlootDB.records.vendor = #items > 0 and { { vendorNpcId = 1, items = items } } or {}
end
local function same(a, b) return a == b or (type(a) == 'number' and type(b) == 'number' and math.abs(a - b) < 1e-9) end
local function check(name, field, got, want)
  assert(same(got, want), name .. ' ' .. field .. ': got ' .. tostring(got) .. ', want ' .. tostring(want))
end

for _, case in ipairs(parity.evaluate) do
  setWorld(case.market, case.vendorUnit, case.rawVendorOffer, case.vendorSell)
  local r = case.recipe
  local reagents = {}
  for _, g in ipairs(r.reagents) do reagents[#reagents + 1] = { id = g.itemId, item = 'Item ' .. g.itemId, count = g.count } end
  local output = r.output and { itemId = r.product, minimum = r.output.minimum, maximum = r.output.maximum } or nil
  local recipe = { id = r.id, key = 'k' .. r.id, name = r.name, product = r.product, live = true, reagents = reagents, output = output }
  -- A stored row (a recipe this install recorded, not the open window) has only the output this install recorded.
  EverlootDB.recipeOutput = EverlootDB.recipeOutput or {}
  EverlootDB.recipeOutput[r.id] = nil
  if case.stored then
    recipe.live, recipe.output = nil, nil
    EverlootDB.recipeOutput[r.id] = output
  end
  local ctx = C.Context('Forever', case.house, { destination = case.destination })
  local est = C.Evaluate(recipe, ctx, case.crafts)
  local x = case.expected
  check(case.name, 'cost', est.cost, x.cost)
  check(case.name, 'profit', est.profit, x.profit)
  check(case.name, 'margin', est.margin, x.margin)
  check(case.name, 'unpriced', est.unpriced, x.unpriced)
  check(case.name, 'stale', est.oldQuote and true or false, x.stale)
  check(case.name, 'cut percent', est.cut, parity.cut[case.house])
  local gross, cut, batch = C.PlanSale(est, case.crafts, est.cost and est.cost * case.crafts)
  check(case.name, 'gross', gross, x.gross)
  check(case.name, 'cut', cut, x.cut)
  check(case.name, 'batchProfit', batch, x.batchProfit)
  for id, source in pairs(x.sources or {}) do
    for _, part in ipairs(est.parts) do
      if part.id == id then check(case.name, 'source ' .. id, part.vendor and 'vendor' or 'ah', source) end
    end
  end
end

local rows = {}
for _, row in ipairs(parity.rank.rows) do
  rows[#rows + 1] = { id = row.id, key = 'k' .. row.id, name = row.name, profit = row.profit, cost = row.cost }
end
local function ids(list) local out = {} for i, r in ipairs(list) do out[i] = r.id end return table.concat(out, ',') end
check('rank', 'profit order', ids(C.Rank(rows, { sort = 'profit' })), table.concat(parity.rank.expected.profit, ','))
check('rank', 'name order', ids(C.Rank(rows, { sort = 'name' })), table.concat(parity.rank.expected.name, ','))
check('rank', 'profitable only', ids(C.Rank(rows, { sort = 'profit', profitableOnly = true })),
  table.concat(parity.rank.expected.profitable, ','))

local P = parity.plans
local function pairsText(list)
  local out = {}
  for i, p in ipairs(list) do out[i] = table.concat(p, 'x') end
  return table.concat(out, ',')
end
local function mapText(map)
  local keys = {}
  for k in pairs(map or {}) do keys[#keys + 1] = k end
  table.sort(keys)
  for i, k in ipairs(keys) do keys[i] = k .. ':' .. map[k] end
  return table.concat(keys, ',')
end
for _, case in ipairs(P.cases) do
  local m = {}
  for id, unit in pairs(P.market) do m[id] = { unit = unit, day = parity.today } end
  -- A null in the case's market removes that quote (it arrives here as false).
  for id, unit in pairs(case.market or {}) do m[id] = unit and { unit = unit, day = parity.today } or nil end
  setWorld(m, case.vendorUnit or P.vendorUnit, case.rawVendorOffer, {})
  local cooling = {}
  for _, id in ipairs(case.cooldown or {}) do cooling[id] = { ms = 1 } end
  local known, noCooldown = {}, {}
  for _, id in ipairs(case.allowed) do
    local def = P.recipes[id]
    local reagents = {}
    for _, g in ipairs(def.reagents) do reagents[#reagents + 1] = { itemId = g[1], count = g[2] } end
    known[id] = { recipeId = id, professionId = 1, learned = true, itemId = def.itemId, minimum = def.minimum,
      maximum = def.maximum, reagents = reagents }
    if not cooling[id] then noCooldown[id] = true end
  end
  local requests = {}
  for _, req in ipairs(case.requests) do
    local def = P.recipes[req[1]]
    local reagents = {}
    for _, g in ipairs(def.reagents) do reagents[#reagents + 1] = { itemId = g[1], count = g[2] } end
    requests[#requests + 1] = { recipeId = req[1], crafts = req[2],
      recipe = { itemId = def.itemId, minimum = def.minimum, maximum = def.maximum, reagents = reagents } }
  end
  local ctx = C.Context('Forever', 'Alliance')
  local plan = CP.Resolve(requests, ctx, known, case.owned or {}, { strategy = case.strategy, noCooldown = noCooldown,
    limited = cooling })
  local x = case.expected
  check(case.name, 'cost', plan.cost, x.cost)
  check(case.name, 'cashCost', plan.cashCost, x.cashCost)
  check(case.name, 'buyCost', plan.buyCost, x.buyCost)
  check(case.name, 'complete', plan.complete, x.complete)
  local steps, purchases, unpriced = {}, {}, {}
  for i, s in ipairs(plan.steps) do steps[i] = { s.recipeId, s.crafts } end
  for i, p in ipairs(plan.purchases) do purchases[i] = { p.id, p.count } end
  for i, u in ipairs(plan.unpriced) do unpriced[i] = { u.id, u.count } end
  check(case.name, 'steps', pairsText(steps), pairsText(x.steps))
  check(case.name, 'purchases', pairsText(purchases), pairsText(x.purchases))
  check(case.name, 'unpriced', pairsText(unpriced), pairsText(x.unpriced))
  check(case.name, 'leftovers', mapText(plan.leftovers), mapText(x.leftovers))
  check(case.name, 'possibleLeftovers', mapText(plan.possibleLeftovers), mapText(x.possibleLeftovers))
  check(case.name, 'used', mapText(plan.used), mapText(x.used))
  local exclusions = {}
  for i, e in ipairs(plan.exclusions) do exclusions[i] = { e.recipeId, e.itemId, e.reason } end
  check(case.name, 'exclusions', pairsText(exclusions), pairsText(x.exclusions))
end
""")
# Merchant unit evidence (modules/openworld.lua): Forever's merchant window reads C_MerchantFrame.GetItemInfo, whose
# MerchantItemInfo has price, stackCount and hasExtendedCost (Blizzard_APIDocumentationGenerated/
# MerchantFrameDocumentation.lua at 1.60.1.71139; Mainline/MerchantFrame.lua divides price by stackCount). Only an
# offer of exactly one item for money alone is a unit price. It is kept on this computer beside the records, never in
# them: the public vendor row stays exactly as it was.
from lupa.lua51 import LuaRuntime
mw = LuaRuntime()
mw.execute("""
date = function() return '2026-10-30T10:00:00Z' end
time = function() return 123456 end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
playerGuid = 'Player-1-0000000A'
UnitGUID = function(unit) if unit == 'player' then return playerGuid end return 'Creature-0-1-2-3-999-0000001' end
UnitClass = function() return 'Mage', 'MAGE' end
UnitLevel = function() return 60 end
UnitName = function() return 'Supplier' end
build = { '1.60.1', '71139' }
GetBuildInfo = function() return build[1], build[2], 'Nov 1 2026', 16001 end
C_Map = { GetBestMapForUnit = function() return 1429 end, GetPlayerMapPosition = function() return { x = .4, y = .6 } end }
GetNumLootItems = function() return 0 end
""")
for file in ["core.lua", "modules/openworld.lua"]:
    mw.execute((root / file).read_text(encoding="utf-8"))
mw.execute("""
-- An unscoped price from the unreleased global map: nobody knows whose it was, so it is dropped, never adopted.
EverlootDB = { vendorUnitPrices = { [2320] = 1 } }
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
local E = Everloot
local function open() for _, hook in ipairs(E.frame.hooks) do hook(nil, 'MERCHANT_SHOW') end end
local links = { 2320, 2321, 2324, 2325, 2604, 2605, 4291, 159 }
offers = {
  { price = 10, stackCount = 1, hasExtendedCost = false, numAvailable = -1 },   -- 2320: one thread for money
  { price = 100, stackCount = 5, hasExtendedCost = false, numAvailable = -1 },  -- 2321: a bundle of five
  { price = 50, stackCount = 1, hasExtendedCost = true, numAvailable = -1 },    -- 2324: money plus a token
  { price = 30, hasExtendedCost = false, numAvailable = -1 },                   -- 2325: no stack size
  { price = 0, stackCount = 1, hasExtendedCost = true, numAvailable = -1 },     -- 2604: tokens only
  { price = 40, stackCount = 1, numAvailable = 3 },                             -- 2605: no extended-cost flag
  { price = 12.5, stackCount = 1, hasExtendedCost = false, numAvailable = -1 }, -- 4291: not whole copper
  { price = 25, stackCount = 1, hasExtendedCost = false, numAvailable = 2 },    -- 159: one item, limited stock
}
GetMerchantNumItems = function() return #links end
GetMerchantItemLink = function(i) return 'item:' .. links[i] end
GetMerchantItemInfo = nil
C_MerchantFrame = { GetItemInfo = function(i) return offers[i] end }
open()
local row = EverlootDB.records.vendor[1]
assert(row and row.vendorNpcId == 999 and #row.items == 7, 'the public vendor row is recorded as before')
-- The public row keeps exactly its old fields: an item, its offer price and any limited stock.
for _, item in ipairs(row.items) do
  for k in pairs(item) do assert(k == 'itemId' or k == 'priceCopper' or k == 'limitedStock', 'no new public field: ' .. k) end
end
for k in pairs(row) do
  assert(not (k:lower():find('unit') or k:lower():find('stack') or k:lower():find('extended')), 'no new public row field: ' .. k)
end
assert(row.items[2].itemId == 2321 and row.items[2].priceCopper == 100, 'a bundle keeps its offer price in public')
local units = EverlootDB.vendorUnitPrices
assert(type(units) == 'table' and units[2320] == nil, 'local unit evidence is kept; the unscoped price is gone')
local alice = E.CharacterKey()
assert(type(alice) == 'string' and type(units[alice]) == 'table', "evidence is kept under this character's key")
local thread = units[alice][2320]
assert(thread.copper == 10 and thread.at == 123456 and thread.build == '1.60.1.71139', 'price, observation time and build')
assert(units[alice][159].copper == 25, 'one item for money alone is a unit price')
for _, id in ipairs({ 2321, 2324, 2325, 2604, 2605, 4291 }) do
  assert(units[alice][id] == nil, 'no unit price without proof of one item and no extra cost: ' .. id)
end
for kind, rows in pairs(EverlootDB.records) do
  for _, r in ipairs(rows) do assert(r.vendorUnitPrices == nil and r.unitPrice == nil and r.copper == nil, 'nothing new in ' .. kind) end
end
-- The latest observation is kept, higher or lower, with its time.
time = function() return 223456 end
offers[1].price = 12
open()
assert(units[alice][2320].copper == 12 and units[alice][2320].at == 223456, 'a later, higher price replaces a lower one')
-- Another character with a reputation discount: its own evidence, never this character's.
playerGuid = 'Player-1-0000000B'
local bob = E.CharacterKey()
assert(bob ~= alice)
offers[1].price = 9
open()
assert(units[bob][2320].copper == 9 and units[alice][2320].copper == 12, "one character's discount stays its own")
-- Revisiting the item as a bundle or a token offer proves nothing new and leaves the evidence as it was.
offers[1] = { price = 40, stackCount = 5, hasExtendedCost = false, numAvailable = -1 }
open()
offers[1] = { price = 9, stackCount = 1, hasExtendedCost = true, numAvailable = -1 }
open()
assert(units[bob][2320].copper == 9, 'a bundle or token revisit writes nothing')
-- A new client build: the old build's evidence is dropped when this character next records.
EverlootDB.clientBuild = '1.60.2.72000'
offers[1] = { price = 11, stackCount = 1, hasExtendedCost = false, numAvailable = -1 }
links = { 2320 }
open()
assert(units[bob][2320].build == '1.60.2.72000' and units[bob][159] == nil, 'evidence from another build is dropped')
-- No client build or no character: nothing is recorded.
EverlootDB.clientBuild = nil
links = { 2322 }
offers[1] = { price = 5, stackCount = 1, hasExtendedCost = false, numAvailable = -1 }
open()
assert(units[bob][2322] == nil, 'no build, no evidence')
EverlootDB.clientBuild = '1.60.2.72000'
UnitClass = function() return nil end
open()
for k, mine in pairs(units) do assert(mine[2322] == nil, 'no character, no evidence') end
UnitClass = function() return 'Mage', 'MAGE' end
-- Older clients' GetMerchantItemInfo is not read for unit evidence.
C_MerchantFrame = nil
GetMerchantItemInfo = function() return 'Thread', 'icon', 1, 1, -1, true, true, false end
links = { 2930 }
open()
assert(units[bob][2930] == nil, 'the legacy reader proves no unit price')
""")
# The upload boundary: the companion reads the records, never this local evidence.
for source in (root.parent / "companion" / "src").rglob("*.ts"):
    assert "vendorUnitPrices" not in source.read_text(encoding="utf-8"), f"{source} must not read local unit evidence"
print("merchant unit evidence PASS")
print("crafting parity fixture PASS (" + str(len(parity["evaluate"])) + " valuations, 1 ranking, "
      + str(len(parity["plans"]["cases"])) + " plans)")
print("crafting contract PASS")
