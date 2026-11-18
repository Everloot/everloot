"""The vendor check in the auction house's Sell tab: the verdict from plain numbers, the reading of Blizzard's sell
frames through hooksecurefunc, the switch, and that it never posts or changes what Blizzard's frame holds."""
from pathlib import Path
import zlib
import json
from window_world import fresh

root = Path(__file__).parents[1]
api = """
now = 1794873600 + 3600
-- Today is the test's own day, not the machine's, so the price ages below never go stale.
date = function(format, t) return os.date(format, t or now) end
-- Item 100: uncommon armor, item level 10 (a disenchant band), sells to a vendor for 20c each.
-- Item 300: a reagent that sells to a vendor for 1s each. Item 400: no vendor price.
GetItemInfo = function(id)
  if id == 100 then return 'Item 100', 'item:100', 2, 10, 1, '', '', 1, '', 123, 20, 4 end
  if id == 300 then return 'Item 300', 'item:300', 1, 10, 1, '', '', 20, '', 123, 100, 7 end
  if id == 400 then return 'Item 400', 'item:400', 1, 10, 1, '', '', 20, '', 123, 0, 7 end
  return 'Item ' .. id, 'item:' .. id, 1, 10, 1, '', '', 1, '', 123, 5, 7
end
C_Item = { GetItemID = function(location) return location.id end }
hooks = {}
hooksecurefunc = function(target, method, f)
  local original = target[method]
  target[method] = function(...) local r = original(...); f(...); return r end
  hooks[#hooks + 1] = method
end
posted = 0
-- Blizzard's sell frame as the client builds it: the methods the check reads, and a Post that counts.
function sellFrame()
  local f = CreateFrame('Frame')
  f.PostButton = CreateFrame('Button')
  -- The stub frame answers any unknown key with a function, so its own fields are read with rawget.
  f.Deposit = { GetAmount = function() return rawget(f, 'deposit') or 0 end }
  f.GetItem = function(self) return rawget(self, 'item') end
  f.GetQuantity = function(self) return rawget(self, 'quantity') or 1 end
  f.GetTotalPrice = function(self) return (rawget(self, 'quantity') or 1) * (rawget(self, 'unit') or 0) end
  f.UpdatePostState = function(self) self.updated = (rawget(self, 'updated') or 0) + 1 end
  f.PostItem = function() posted = posted + 1 end
  -- The price box, Blizzard's default (a multiple of the vendor price) and the price of a matched listing.
  f.PriceInput = {
    GetAmount = function() return rawget(f, 'unit') or 0 end,
    SetAmount = function(_, v) f.unit = v; f:UpdatePostState() end,
  }
  f.GetDefaultPrice = function(self) return rawget(self, 'default') or 100 end
  f.GetSearchResultPrice = function(self) return rawget(self, 'searchPrice') end
  f.UpdatePriceSelection = function(self) end
  return f
end
function setSell(f, id, unit, quantity, deposit)
  f.item = id and { id = id } or nil
  f.unit, f.quantity, f.deposit = unit, quantity, deposit
  f:UpdatePostState()
end
"""
lua = fresh(api=api, extra=("modules/disenchant_data.lua", "modules/disenchant.lua", "modules/sellcheck.lua"))

# The verdict alone, from plain numbers.
lua.execute(r"""
local S = Everloot.SellCheck
local function text(v) local t = {}; for _, l in ipairs(v.lines) do t[#t + 1] = l.text end; return table.concat(t, '\n') end
assert(S.Cut('Alliance') == 0.05 and S.Cut('Horde') == 0.05 and S.Cut('Neutral') == 0.15 and S.Cut(nil) == 0.05)

-- 1s posted, 5% cut: 95c in hand; a vendor pays 1s now. Red, and the deposit is named.
local v = S.Verdict({ quantity = 1, total = 100, deposit = 15, house = 'Alliance', vendorUnit = 100 })
assert(v.level == 'vendor', v.level)
assert(text(v):find('a vendor pays more') and text(v):find('95') and text(v):find('5%% cut') and text(v):find('deposit'))
assert(v.lines[1].color[1] == 1 and v.lines[1].color[2] == 0.4, 'the heading is the tooltip warning red')

-- Exactly the vendor price after the cut is still not worth posting.
assert(S.Verdict({ quantity = 1, total = 106, house = 'Alliance', vendorUnit = 100 }).level == 'vendor', 'floor(106 * 0.95) = 100')

-- The neutral house's 15% turns a sale that beats the vendor at a faction house into a loss.
assert(S.Verdict({ quantity = 1, total = 115, deposit = 0, house = 'Alliance', vendorUnit = 100 }).level == nil)
assert(S.Verdict({ quantity = 1, total = 115, deposit = 0, house = 'Neutral', vendorUnit = 100 }).level == 'vendor')

-- 20 for 30s: 28s 50c after the cut, 8s 50c above the 20s a vendor pays, but the deposit is 10s: amber.
v = S.Verdict({ quantity = 20, total = 3000, deposit = 1000, house = 'Horde', vendorUnit = 100 })
assert(v.level == 'thin', v.level)
assert(text(v):find('barely beats a vendor') and text(v):find('for all 20'))
-- With a deposit smaller than the gain, nothing is said.
assert(#S.Verdict({ quantity = 20, total = 3000, deposit = 500, house = 'Horde', vendorUnit = 100 }).lines == 0)

-- The player's price beats the vendor, but this house's current value after the cut does not.
v = S.Verdict({ quantity = 1, total = 500, deposit = 10, house = 'Alliance', vendorUnit = 100, marketUnit = 104,
  marketSource = 'your scan 2026-11-17' })
assert(v.level == 'market' and text(v):find('your scan 2026%-11%-17') and text(v):find('may not sell'))
assert(#S.Verdict({ quantity = 1, total = 500, deposit = 10, house = 'Alliance', vendorUnit = 100, marketUnit = 300 }).lines == 0)

-- Disenchanting: said when its materials after the cut beat both the sale and the vendor.
v = S.Verdict({ quantity = 1, total = 200, deposit = 5, house = 'Alliance', vendorUnit = 20, disenchantUnit = 400 })
assert(v.level == 'disenchant' and text(v):find('disenchanting looks better') and text(v):find('needs an enchanter'))
v = S.Verdict({ quantity = 1, total = 30, deposit = 5, house = 'Alliance', vendorUnit = 100, disenchantUnit = 400 })
assert(v.level == 'vendor' and text(v):find('Disenchanted, its materials'), 'both said, the vendor first')
assert(#S.Verdict({ quantity = 1, total = 900, deposit = 5, house = 'Alliance', vendorUnit = 20, disenchantUnit = 400 }).lines == 0)

-- Nothing it cannot back: no vendor price, no price typed, no quantity, a secret or odd number.
assert(#S.Verdict({ quantity = 1, total = 50, deposit = 5, house = 'Alliance' }).lines == 0)
assert(#S.Verdict({ quantity = 1, total = 50, deposit = 5, house = 'Alliance', vendorUnit = 0 }).lines == 0)
assert(#S.Verdict({ quantity = 1, total = 0, house = 'Alliance', vendorUnit = 100 }).lines == 0)
assert(#S.Verdict({ quantity = 0, total = 50, house = 'Alliance', vendorUnit = 100 }).lines == 0)
assert(#S.Verdict({ quantity = 1, total = 50.5, house = 'Alliance', vendorUnit = 100 }).lines == 0)
""")

# Blizzard's sell frames: hooked once, read after each of Blizzard's updates, never posted or changed.
lua.execute(r"""
local S = Everloot.SellCheck
AuctionHouseFrame = { ItemSellFrame = sellFrame(), CommoditiesSellFrame = sellFrame() }
local items, goods = AuctionHouseFrame.ItemSellFrame, AuctionHouseFrame.CommoditiesSellFrame
assert(S.Attach() and S.Attach(), 'attaching twice is harmless')
assert(#hooks == 4, 'the post state and the price selection of each sell frame, hooked once')
local note = S.notes[goods]
assert(note and not note:IsShown())
local own = {}
for key in pairs(goods) do own[key] = true end
for _, key in ipairs({ 'everlootSellNote', 'everlootSellHooked' }) do assert(not own[key], 'nothing written into Blizzard frames') end

-- 20 of the reagent at 1s each: 95c each after the cut, under the 1s a vendor pays.
setSell(goods, 300, 100, 20, 300)
assert(goods.updated == 1, "Blizzard's own update still runs")
assert(note:IsShown() and note.text:find('a vendor pays more') and S.last.level == 'vendor')
assert(goods.unit == 100 and goods.quantity == 20 and goods.deposit == 300, 'the check never changes the price, quantity or deposit')

-- Raised to 5s each: the warning goes away.
setSell(goods, 300, 500, 20, 300)
assert(not note:IsShown() and S.last == nil)

-- An item with no vendor price: nothing to compare.
setSell(goods, 400, 1, 1, 0)
assert(not note:IsShown())

-- The item taken out of the slot clears the note.
setSell(goods, 300, 50, 1, 15)
assert(note:IsShown())
setSell(goods, nil)
assert(not note:IsShown())

-- The switch: off hides it at once, back on shows it again.
setSell(goods, 300, 50, 1, 15)
EverlootDB.sellCheck = false
goods:UpdatePostState()
assert(not note:IsShown())
EverlootDB.sellCheck = nil
goods:UpdatePostState()
assert(note:IsShown())

-- A secret value reads as missing: no note, no error.
local secretTotal = {}
SECRET[secretTotal] = true
goods.GetTotalPrice = function() return secretTotal end
goods:UpdatePostState()
assert(not note:IsShown())

-- A sell frame that errors while being read leaves Blizzard's update intact.
items.GetQuantity = function() error('boom') end
setSell(items, 300, 50, 1, 15)
assert(items.updated == 1 and not S.notes[items]:IsShown())
assert(posted == 0, 'never posts')
""")

# The settings switch: in the auction group, live, on by default, off in the collect-only setup.
lua.execute(r"""
local O = Everloot.Options
local row
for _, r in ipairs(O.ROWS) do if r.key == 'sellCheck' then row = r end end
assert(row and row.group == 'auction' and row.field and row.live and not row.defaultOff)
assert(O.SETUP.everything.fields.sellCheck == true and O.SETUP.collect.fields.sellCheck == false)
""")

# House prices and the disenchant estimate come from the same file the tooltip reads, for this house only.
def block(data):
    lua.execute(f"EverlootPricesDB = {{ disenchant = {{ data = {json.dumps(data)}, sum = {zlib.adler32(data.encode())}, dataAsOf = '2026-11-17T00:00:00Z' }} }}; Everloot:ResetPrices()")

block("4,200,8,10,1600,1,3")
lua.execute(r"""
local E, S = Everloot, Everloot.SellCheck
local function prices(data)
  EverlootPricesDB.realms = { ['forever|alliance'] = { data = data, sum = E.Adler32(data), dataAsOf = '2026-11-17' } }
  E:ResetPrices()
end
local goods = AuctionHouseFrame.CommoditiesSellFrame
local note = S.notes[goods]
goods.GetTotalPrice = function(self) return (rawget(self, 'quantity') or 1) * (rawget(self, 'unit') or 0) end

-- The reagent's market value here is 1s 4c: after the cut, under the vendor's 1s. A 5s price draws the market line.
prices('300,104,100,100,100,2026-11-17,3')
setSell(goods, 300, 500, 1, 15)
assert(note:IsShown() and S.last.level == 'market' and note.text:find('community 2026%-11%-17'))
-- A thin market (5 units or fewer) says nothing.
prices('300,104,100,100,5,2026-11-17,3')
setSell(goods, 300, 500, 1, 15)
assert(not note:IsShown())
-- Another house's prices are never read.
prices('300,104,100,100,100,2026-11-17,3')
UnitFactionGroup = function() return 'Horde', 'Horde' end
setSell(goods, 300, 500, 1, 15)
assert(not note:IsShown())
UnitFactionGroup = function() return 'Alliance', 'Alliance' end

-- Item 100 disenchants into 1.6 of item 200; at 1g each that beats a 2s sale and the 20c vendor price.
prices('200,10000,100,100,100,2026-11-17,3')
setSell(goods, 100, 200, 1, 5)
assert(note:IsShown() and S.last.level == 'disenchant', S.last and S.last.level)
-- A material without a price makes the estimate incomplete: nothing said.
prices('201,10000,100,100,100,2026-11-17,3')
setSell(goods, 100, 200, 1, 5)
assert(not note:IsShown())
""")

# Hooked when Blizzard's auction house UI loads, through the listener's events.
lua.execute(r"""
local S = Everloot.SellCheck
S.hooked, S.notes = {}, {}
AuctionHouseFrame = { ItemSellFrame = sellFrame(), CommoditiesSellFrame = sellFrame() }
assert(S.frame.events.ADDON_LOADED and S.frame.events.AUCTION_HOUSE_SHOW)
S.frame.onEvent(S.frame, 'ADDON_LOADED', 'SomeOtherAddon')
assert(next(S.hooked) == nil)
S.frame.onEvent(S.frame, 'ADDON_LOADED', 'Blizzard_AuctionHouseUI')
assert(S.hooked[AuctionHouseFrame.ItemSellFrame] and S.hooked[AuctionHouseFrame.CommoditiesSellFrame])
""")

# The bag list: which stacks this house pays less for than a vendor, and the page that shows them.
for file in ("modules/shopping.lua", "modules/auctiontab.lua"):
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute(r"""
local E, S, T = Everloot, Everloot.SellCheck, Everloot.AuctionTab
local function prices(data)
  EverlootPricesDB.realms = { ['forever|alliance'] = { data = data, sum = E.Adler32(data), dataAsOf = '2026-11-17' } }
  E:ResetPrices()
end
-- 300 vendor pays more (market 1s 4c, 95% of it under the 1s vendor price); 301 beats the vendor by less than the
-- deposit; 302 sells well here; 303 has no price here; 304 is soulbound; 305 is grey; 306 the house will not take;
-- 400 a vendor will not buy.
prices('300,104,100,100,100,2026-11-17,3;301,110,100,100,100,2026-11-17,3;302,300,100,100,100,2026-11-17,3;'
  .. '304,1,1,1,100,2026-11-17,3;305,1,1,1,100,2026-11-17,3;306,1,1,1,100,2026-11-17,3;400,1,1,1,100,2026-11-17,3')
GetItemInfo = function(id)
  local sell = id == 400 and 0 or 100
  return 'Item ' .. id, 'item:' .. id, 1, 10, 1, '', '', 20, '', 123, sell, 7
end
local bag = {
  { itemID = 300, stackCount = 20, quality = 1 }, { itemID = 301, stackCount = 10, quality = 1 },
  { itemID = 302, stackCount = 5, quality = 1 }, { itemID = 303, stackCount = 5, quality = 1 },
  { itemID = 304, stackCount = 1, quality = 2, isBound = true }, { itemID = 305, stackCount = 3, quality = 0 },
  { itemID = 306, stackCount = 2, quality = 1 }, { itemID = 400, stackCount = 2, quality = 1 },
  { itemID = 300, stackCount = 5, quality = 1 }, nil,
}
NUM_BAG_SLOTS = 0
C_Container = {
  GetContainerNumSlots = function(b) return b == 0 and 10 or 0 end,
  GetContainerItemInfo = function(b, slot) return bag[slot] end,
}
ItemLocation = { CreateFromBagAndSlot = function(_, b, slot) return { bag = b, slot = slot } end }
C_AuctionHouse = {
  -- 5c a unit for the shortest auction.
  CalculateItemDeposit = function(location, duration, count) assert(duration == 1); return 5 * count end,
  IsSellItemValid = function(location) return bag[location.slot].itemID ~= 306 end,
}
E.auctionHouseOpen = true

local found = S.BagCandidates()
assert(#found.rows == 2, #found.rows)
local first, second = found.rows[1], found.rows[2]
assert(first.itemId == 300 and first.count == 25 and first.vendor == 2500 and first.auction == 2470 and first.reason == 'vendor',
  'both stacks of 300 in one row, 95% of 25 x 104c against 25 x 1s')
assert(second.itemId == 301 and second.vendor == 1000 and second.auction == 1045 and second.deposit == 50 and second.reason == 'deposit',
  '45c over the vendor, 50c deposit')
assert(found.vendor == 3500 and found.auction == 3515 and found.unpriced == 1)
-- At the neutral house the 15% cut puts 301 under the vendor price too.
E.auctionHouseKind = 'Neutral'
EverlootPricesDB.realms['forever|neutral'] = EverlootPricesDB.realms['forever|alliance']
E:ResetPrices()
found = S.BagCandidates()
assert(#found.rows == 2 and found.rows[1].itemId == 300 and found.rows[2].itemId == 301 and found.rows[2].reason == 'vendor')
E.auctionHouseKind = nil
-- Without the house's deposit the "barely" case is not guessed.
C_AuctionHouse.CalculateItemDeposit = nil
found = S.BagCandidates()
assert(#found.rows == 1 and found.rows[1].itemId == 300)
C_AuctionHouse.CalculateItemDeposit = function(location, duration, count) return 5 * count end

-- The page in the Everloot auction house tab.
AuctionHouseFrame = CreateFrame('Frame', 'AuctionHouseFrame')
AuctionHouseFrame.Tabs = { CreateFrame('Button', 'Buy') }
assert(T.Attach(AuctionHouseFrame))
T.Show()
local p = T.panel
local function click(b) b.scripts.OnClick(b) end
assert(p.vendorButton.text == 'Vendor these' and not p.vendor.page.shown and p.lookup.shown)
click(p.vendorButton)
local v = p.vendor
assert(p.mode == 'vendor' and v.page.shown and not p.lookup.shown and not p.scanButton.shown and not p.shop.page.shown)
assert(p.vendorButton.text == 'Price lookup' and p.modeButton.text == 'Shopping list')
assert(v.rows[1].shown and v.rows[1].name.text == 'item:300' and v.rows[1].count.text == '25')
assert(v.rows[1].why.text == 'vendor pays more' and v.rows[2].why.text == 'gain under deposit' and not v.rows[3].shown)
assert(v.total.text:find('Vendoring these brings') and v.unpriced.text == '1 other item has no current price here.')
assert(not v.empty.shown and v.caps.text:find('nothing is sold or posted'))
-- Selling the stacks empties the list.
for i = 1, 9 do if bag[i] and (bag[i].itemID == 300 or bag[i].itemID == 301) then bag[i] = nil end end
T.Refresh()
assert(v.empty.shown and not v.rows[1].shown and v.total.text == '')
click(p.modeButton)
assert(p.mode == 'shop' and p.shop.page.shown and not v.page.shown and p.vendorButton.text == 'Vendor these')
click(p.vendorButton); click(p.vendorButton)
assert(p.mode == 'lookup' and p.lookup.shown and not v.page.shown)
""")

# The suggested price: only when nothing is listed and the box still holds Blizzard's default; never below the vendor.
lua.execute(r"""
local E, S = Everloot, Everloot.SellCheck
local goods = AuctionHouseFrame.CommoditiesSellFrame
S.hooked, S.notes, S.priced = {}, {}, {}
AuctionHouseFrame = { ItemSellFrame = sellFrame(), CommoditiesSellFrame = sellFrame() }
goods = AuctionHouseFrame.CommoditiesSellFrame
assert(S.Attach())
local note = S.notes[goods]
C_AuctionHouse.SupportsCopperValues = function() return false end
-- Item 302: vendor 1s, market 3s here. Nothing listed, Blizzard's default 1s 50c in the box: Everloot puts 3s there.
setSell(goods, 302, 150, 5, 25)
goods.default = 150
goods:UpdatePriceSelection()
assert(goods.unit == 300, goods.unit)
assert(note:IsShown() and note.text:find('Everloot set this price from this house') and note.text:find('community 2026%-11%-17'))
-- A price the player types afterwards is theirs; the line goes.
goods.PriceInput:SetAmount(275)
assert(goods.unit == 275 and not (note.text or ''):find('Everloot set this price'))
goods:UpdatePriceSelection()
assert(goods.unit == 275, 'a typed price is never replaced')
-- A matched listing is Blizzard's: left alone.
setSell(goods, 302, 150, 5, 25)
goods.searchPrice = 140
goods:UpdatePriceSelection()
assert(goods.unit == 150)
goods.searchPrice = nil
-- Item 300's market (1s 4c) after the cut is under its 1s vendor price: Blizzard's default stays and the warning says why.
setSell(goods, 300, 150, 5, 25)
goods:UpdatePriceSelection()
assert(goods.unit == 150 and note.text:find('vendor'))
-- Where the house takes no copper, rounded down to whole silver: item 301's 1s 10c becomes 1s, under the vendor after
-- the cut, so Blizzard's default stays.
setSell(goods, 301, 150, 5, 5)
goods:UpdatePriceSelection()
assert(goods.unit == 150, goods.unit)
-- With copper prices allowed, the market value itself: 5 x 1s 10c after the cut is 5s 22c, 22c over the vendor, more
-- than the 5c deposit: set.
C_AuctionHouse.SupportsCopperValues = function() return true end
setSell(goods, 301, 150, 5, 5)
goods:UpdatePriceSelection()
assert(goods.unit == 110, goods.unit)
-- The same with a 25c deposit is barely worth posting: left alone.
setSell(goods, 301, 150, 5, 25)
goods:UpdatePriceSelection()
assert(goods.unit == 150, goods.unit)
-- Switched off: Blizzard's default stays.
EverlootDB.sellPrice = false
setSell(goods, 302, 150, 5, 25)
goods:UpdatePriceSelection()
assert(goods.unit == 150)
EverlootDB.sellPrice = nil
-- The safety net: a block that blames Everloot while its price is in the box switches the fill off, once.
setSell(goods, 302, 150, 5, 25)
goods:UpdatePriceSelection()
assert(goods.unit == 300 and next(S.priced))
assert(S.frame.events.ADDON_ACTION_BLOCKED and S.frame.events.ADDON_ACTION_FORBIDDEN)
S.frame.onEvent(S.frame, 'ADDON_ACTION_BLOCKED', 'SomeOtherAddon', 'PostItem()')
assert(EverlootDB.sellPrice ~= false, 'another addon blamed: nothing changes')
S.frame.onEvent(S.frame, 'ADDON_ACTION_FORBIDDEN', 'Everloot', 'C_AuctionHouse.PostCommodity()')
assert(EverlootDB.sellPrice == false and next(S.priced) == nil and said('no longer fills in prices'))
assert(goods.unit == 300, 'the price stays for the player')
setSell(goods, 302, 150, 5, 25)
goods:UpdatePriceSelection()
assert(goods.unit == 150, 'off now')
assert(not S.Blocked('Everloot', 'x'), 'nothing of Everloot in the box: not blamed again')
EverlootDB.sellPrice = nil
assert(posted == 0, 'still never posts')
""")

# The merchant button: what a vendor pays more for, minus shopping-list items, 12 stacks a press, only at a merchant.
lua.execute(r"""
local E, S = Everloot, Everloot.SellCheck
local function stacks(id, n) local t = {}; for i = 1, n do t[i] = { itemID = id, stackCount = 1, quality = 1 } end; return t end
-- 14 single stacks of 300 (vendor pays more), 2 of 301 (gain under deposit: kept), 1 of 302 (sells well here).
bag = {}
for _, part in ipairs({ stacks(300, 14), stacks(301, 2), stacks(302, 1) }) do
  for _, info in ipairs(part) do bag[#bag + 1] = info end
end
-- The earlier bag was a local of its own block; this one is read from here on.
C_Container.GetContainerNumSlots = function(b) return b == 0 and 20 or 0 end
C_Container.GetContainerItemInfo = function(b, slot) return bag[slot] end
used = {}
C_Container.UseContainerItem = function(b, slot) used[#used + 1] = slot; bag[slot] = nil end
E.auctionHouseOpen = false
GameTooltip = CreateFrame('GameTooltip', 'GameTooltip')
MerchantFrame = CreateFrame('Frame', 'MerchantFrame')
MerchantFrame.shown = false

-- Away from a merchant nothing is sold.
assert(S.SellToMerchant() == 0 and #used == 0)
MerchantFrame.shown = true
S.frame.onEvent(S.frame, 'MERCHANT_SHOW')
local button = S.merchantButton
assert(button and button.shown and button.text == 'Everloot: sell 12 low-value stacks', button and button.text)
assert(button.point[2] == MerchantFrame and button.point[3] == 'BOTTOMLEFT', 'below the merchant window')
button.scripts.OnEnter(button)
local list = S.MerchantList()
assert(#list.rows == 1 and list.rows[1].itemId == 300 and list.stacks == 14)
-- A press sells 12, the buyback tab's worth; the next sells the other 2.
button.scripts.OnClick(button)
assert(#used == 12 and said('sold 12 stacks a vendor pays more for'))
S.frame.onEvent(S.frame, 'BAG_UPDATE_DELAYED')
assert(button.shown and button.text == 'Everloot: sell 2 low-value stacks')
button.scripts.OnClick(button)
assert(#used == 14)
S.frame.onEvent(S.frame, 'BAG_UPDATE_DELAYED')
assert(not button.shown, 'nothing left to sell')

-- Items on a shopping list are kept.
bag = stacks(300, 3)
EverlootDB.shopping = nil
local list, why = E.Shopping.Create('Crafting')
assert(E.Shopping.Set(300, 10, nil, 'Item 300'))
assert(#S.MerchantList().rows == 0)
E.Shopping.Remove(300)
assert(#S.MerchantList().rows == 1)
-- A slot that changed since the list was read is not sold.
local real = C_Container.GetContainerItemInfo
local reads = 0
C_Container.GetContainerItemInfo = function(b, slot)
  reads = reads + 1
  if reads > 3 and slot == 1 then return { itemID = 999, stackCount = 1, quality = 1 } end
  return real(b, slot)
end
used = {}
S.SellToMerchant()
assert(#used == 2 and used[1] == 2, 'the changed slot was skipped')
C_Container.GetContainerItemInfo = real
-- Switched off: no button, nothing sold.
bag = stacks(300, 2)
EverlootDB.merchantSell = false
S.frame.onEvent(S.frame, 'MERCHANT_SHOW')
assert(not button.shown and S.SellToMerchant() == 0)
EverlootDB.merchantSell = nil
S.frame.onEvent(S.frame, 'MERCHANT_CLOSED')
assert(not button.shown)
""")

source = (root / "modules/sellcheck.lua").read_text(encoding="utf-8")
code = "\n".join(line.split("--")[0] for line in source.splitlines())
for call in ("PostItem", "PostCommodity", "CancelAuction", "PlaceBid", "SetQuantity", "ConfirmPost", "PickupContainerItem",
             "StartCommoditiesPurchase", "ConfirmCommoditiesPurchase", "SellAllJunkItems"):
    assert call not in code, f"the check must never call {call}"
# One place sets a price (S.Suggest) and one place sells (S.SellToMerchant).
assert code.count("SetAmount") == 1 and code.count("UseContainerItem") == 1
assert "modules\\sellcheck.lua" in (root / "Everloot.toc").read_text(encoding="utf-8")
print("Sell check contract: PASS")
