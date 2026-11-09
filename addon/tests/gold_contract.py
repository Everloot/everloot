"""Run with: uv run --with lupa --with jsonschema python addon/tests/gold_contract.py"""
from pathlib import Path
from lupa.lua51 import LuaRuntime
from protocol_schema import check_all

STUBS = """
date = function(fmt) if fmt == '!%Y-%m-%d' then return '2026-10-09' end return '2026-10-09T00:00:00Z' end
local clock = 1000
time = function() clock = clock + 1; return clock end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
UnitName = function() return 'Thrall' end
UnitGUID = function() return 'Player-4242-0ABCDEF1' end
UnitClass = function() return 'Shaman', 'SHAMAN', 7 end
UnitLevel = function() return 60 end
GetRealmName = function() return 'Test Realm' end
money = 1000
GetMoney = function() return money end
TakeInboxMoney = function() end
AutoLootMailItem = function() end
SendMail = function() end
PlaceAuctionBid = function() end
sendPrice = 30
GetSendMailPrice = function() return sendPrice end
-- hooksecurefunc(name, after) or hooksecurefunc(table, name, after); the hook runs once the original has run.
hooksecurefunc = function(a, b, c)
 local target, name, after = _G, a, b
 if type(a) == 'table' then target, name, after = a, b, c end
 local original = target[name]
 target[name] = function(...) original(...); after(...) end
end
-- Forever's auction house, with the signatures in the client's API documentation. Owner and bidder fields exist
-- in the data and are never read.
listings = { [901] = { buyoutAmount = 7000, bidAmount = 0, bidder = 'Player-1-AAAA' }, [902] = { buyoutAmount = nil } }
-- The three action functions are recording traps: only the test, standing in for the player's click, may call
-- them (inside click()). Any call from the addon is recorded and fails the test at the end.
forbidden = {}
playerClick = false
function click(f, ...) playerClick = true; f(...); playerClick = false end
local function action(name)
 return function() if not playerClick then forbidden[#forbidden + 1] = 'C_AuctionHouse.' .. name end end
end
C_AuctionHouse = {
 PlaceBid = action('PlaceBid'),
 StartCommoditiesPurchase = action('StartCommoditiesPurchase'),
 ConfirmCommoditiesPurchase = action('ConfirmCommoditiesPurchase'),
 GetAuctionInfoByID = function(auctionID) return listings[auctionID] end,
}
-- Timers run only when the test says so.
timers = {}
C_Timer = { After = function(seconds, f) table.insert(timers, { seconds = seconds, f = f }) end }
function runTimers() local list = timers; timers = {}; for _, t in ipairs(list) do t.f() end end
function event(name, ...)
 for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, name, ...) end
end
"""
root = Path(__file__).parents[1]


def runtime(before_load=""):
    """A fresh client: core, roster, ledger and gold loaded, then ADDON_LOADED. Gold finds the ledger at call time."""
    lua = LuaRuntime()
    lua.execute(STUBS)
    for file in ["core.lua", "modules/roster.lua", "modules/ledger.lua", "modules/gold.lua"]:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute(before_load)
    lua.execute("Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')")
    return lua


lua = runtime()
lua.execute("""
local function events(category)
 local list = {}
 for _, row in ipairs(EverlootDB.records.money_event or {}) do
  if category == nil or row.category == category then list[#list + 1] = row end
 end
 return list
end
event('PLAYER_ENTERING_WORLD')

-- A sale at an open merchant is vendor income; a purchase there is a vendor purchase, kept in the local ledger only.
event('MERCHANT_SHOW')
money = 1500; event('PLAYER_MONEY')
money = 1200; event('PLAYER_MONEY')
event('MERCHANT_CLOSED')
assert(#events('vendor') == 1 and events('vendor')[1].copper == 500, 'one vendor sale of 500')

-- Money gained with no merchant open is not called a vendor sale.
money = 1300; event('PLAYER_MONEY')
assert(#events() == 1, 'unattributed income stays unrecorded')

-- A flight paid while the taxi map is open.
event('TAXIMAP_OPENED')
money = 1250; event('PLAYER_MONEY')
event('TAXIMAP_CLOSED')
money = 1200; event('PLAYER_MONEY')
assert(#events('flight') == 1 and events('flight')[1].copper == 50, 'one flight of 50, nothing after the map closed')

-- A quest turn-in reports its own money reward; the money change that follows is not counted again.
event('QUEST_TURNED_IN', 123, 450, 250)
money = 1450; event('PLAYER_MONEY')
event('QUEST_TURNED_IN', 124, 450, 0)
assert(#events('quest') == 1 and events('quest')[1].copper == 250, 'one quest reward of 250; none for a zero reward')
assert(#events() == 3, 'no double count, got ' .. #events())
for _, row in ipairs(events()) do
 assert(row.character == 'Thrall' and row.realm == 'Test Realm' and row.eventId, 'own character, stable event id')
end

-- Auction sales arrive by mail. The invoice type says seller; the money change has to match the letter.
-- The letter pays the sale price minus the house cut plus the returned deposit; only the sale is income.
inbox = {
 { invoice = 'seller', copper = 3000, buyer = 'Jaina', bid = 2900, deposit = 250, cut = 150 },
 { invoice = nil, copper = 700 },
 { invoice = 'seller', copper = 900, buyer = 'Jaina', bid = 900, deposit = 45, cut = 45 },
}
GetInboxInvoiceInfo = function(i)
 local m = inbox[i]
 if not m then return nil end
 return m.invoice, 'Silk', m.buyer, m.bid, m.bid, m.deposit, m.cut
end
GetInboxHeaderInfo = function(i) local m = inbox[i]; return 'icon', 'paper', 'Auction House', 'Auction successful', m and m.copper end
TakeInboxMoney(1)
money = money + 3000; event('PLAYER_MONEY')
assert(#events('auction') == 1 and events('auction')[1].copper == 2750, 'one auction sale of 2750 net, deposit not income')
-- A letter that is not an auction invoice stays unrecorded.
TakeInboxMoney(2)
money = money + 700; event('PLAYER_MONEY')
-- A money change that does not match the letter is not attributed, and neither is the next one.
AutoLootMailItem(3)
money = money + 899; event('PLAYER_MONEY')
money = money + 900; event('PLAYER_MONEY')
-- Closing the mailbox drops a letter whose money never arrived.
AutoLootMailItem(3)
event('MAIL_CLOSED')
money = money + 900; event('PLAYER_MONEY')
assert(#events('auction') == 1, 'non-invoice, unmatched or stale mail money unrecorded, got ' .. #events('auction'))
assert(#events() == 4, 'only the auction sale was added, got ' .. #events())

-- Postage is the price the send window quoted, stored once the server confirms the letter left.
SendMail('Jaina', 'Hi', '')
sendPrice = 0
event('MAIL_SEND_SUCCESS')
SendMail('Jaina', 'Again', '')
event('MAIL_FAILED')
event('MAIL_SEND_SUCCESS')
assert(#events('postage') == 1 and events('postage')[1].copper == 30, 'one postage of 30; a failed send costs nothing')
assert(#events() == 5, 'postage added once, got ' .. #events())

-- A buyout is an auction purchase once the money leaves. A plain bid can be refunded, so it is not.
listing = { { buyout = 5000, owner = 'Jaina' }, { buyout = 0, owner = 'Jaina' } }
GetAuctionItemInfo = function(_, i)
 local l = listing[i]
 return 'Silk', 'icon', 1, 1, true, 1, nil, 100, 10, l.buyout, 0, false, nil, l.owner
end
PlaceAuctionBid('list', 1, 5000)
money = money - 5000; event('PLAYER_MONEY')
PlaceAuctionBid('list', 1, 4000)
money = money - 4000; event('PLAYER_MONEY')
PlaceAuctionBid('list', 2, 300)
money = money - 300; event('PLAYER_MONEY')
PlaceAuctionBid('list', 1, 5000)
event('AUCTION_HOUSE_CLOSED')
money = money - 5000; event('PLAYER_MONEY')
assert(#events('auction_spend') == 1 and events('auction_spend')[1].copper == 5000, 'one buyout of 5000; bids and stale buyouts unrecorded')

-- Forever, items: a bid at the listing's buyout is a purchase once the money leaves; a lower bid, a bid on a
-- listing without a buyout, and a listing the house no longer reports are not.
money = money + 50000; event('PLAYER_MONEY')  -- unattributed income, so the purse can pay
click(C_AuctionHouse.PlaceBid, 901, 7000)
money = money - 7000; event('PLAYER_MONEY')
click(C_AuctionHouse.PlaceBid, 901, 6000)
money = money - 6000; event('PLAYER_MONEY')
click(C_AuctionHouse.PlaceBid, 902, 300)
money = money - 300; event('PLAYER_MONEY')
click(C_AuctionHouse.PlaceBid, 999, 7000)
money = money - 7000; event('PLAYER_MONEY')
assert(#events('auction_spend') == 2 and events('auction_spend')[2].copper == 7000, 'one item buyout of 7000; got ' .. #events('auction_spend'))

-- Forever, commodities: the purchase pays the total the house last quoted, and only when the money matches.
click(C_AuctionHouse.StartCommoditiesPurchase, 2589, 200)
event('COMMODITY_PRICE_UPDATED', 10, 1900)
event('COMMODITY_PRICE_UPDATED', 10, 2000)
click(C_AuctionHouse.ConfirmCommoditiesPurchase, 2589, 200)
money = money - 2000; event('PLAYER_MONEY')
assert(#events('auction_spend') == 3 and events('auction_spend')[3].copper == 2000, 'one commodity purchase at the last quote')
-- A new purchase forgets the old quote: with no quote yet the confirm attributes nothing.
click(C_AuctionHouse.StartCommoditiesPurchase, 2589, 200)
click(C_AuctionHouse.ConfirmCommoditiesPurchase, 2589, 200)
money = money - 2000; event('PLAYER_MONEY')
-- A price that moved: the money that left is not the quote, so nothing is recorded.
click(C_AuctionHouse.StartCommoditiesPurchase, 2589, 200)
event('COMMODITY_PRICE_UPDATED', 10, 2000)
click(C_AuctionHouse.ConfirmCommoditiesPurchase, 2589, 200)
money = money - 2100; event('PLAYER_MONEY')
-- A failed purchase and a closed house drop the quote.
click(C_AuctionHouse.StartCommoditiesPurchase, 2589, 200)
event('COMMODITY_PRICE_UPDATED', 10, 2000)
event('COMMODITY_PURCHASE_FAILED')
click(C_AuctionHouse.ConfirmCommoditiesPurchase, 2589, 200)
money = money - 2000; event('PLAYER_MONEY')
event('COMMODITY_PRICE_UPDATED', 10, 2000)
event('AUCTION_HOUSE_CLOSED')
click(C_AuctionHouse.ConfirmCommoditiesPurchase, 2589, 200)
money = money - 2000; event('PLAYER_MONEY')
assert(#events('auction_spend') == 3, 'unquoted, mismatched, failed and stale purchases are unrecorded; got ' .. #events('auction_spend'))

-- A bid the house rejects moves no money: the error clears the pending buyout, and so does a few seconds' wait,
-- so a later change of the same amount (a repair) is not called a purchase.
money = money + 50000; event('PLAYER_MONEY')
click(C_AuctionHouse.PlaceBid, 901, 7000)
event('AUCTION_HOUSE_SHOW_ERROR')
money = money - 7000; event('PLAYER_MONEY')
click(C_AuctionHouse.PlaceBid, 901, 7000)
runTimers()
money = money - 7000; event('PLAYER_MONEY')
PlaceAuctionBid('list', 1, 5000)
runTimers()
money = money - 5000; event('PLAYER_MONEY')
-- A newer purchase is not cleared by the older one's timer.
click(C_AuctionHouse.PlaceBid, 901, 7000)
local older = timers[#timers]
timers = {}
click(C_AuctionHouse.PlaceBid, 901, 7000)
older.f()
money = money - 7000; event('PLAYER_MONEY')
assert(#events('auction_spend') == 4, 'rejected and expired buyouts unrecorded, a fresh one kept; got ' .. #events('auction_spend'))
-- The house cannot price a commodity: the quote is dropped.
click(C_AuctionHouse.StartCommoditiesPurchase, 2589, 200)
event('COMMODITY_PRICE_UPDATED', 10, 2000)
event('COMMODITY_PRICE_UNAVAILABLE')
click(C_AuctionHouse.ConfirmCommoditiesPurchase, 2589, 200)
money = money - 2000; event('PLAYER_MONEY')
assert(#events('auction_spend') == 4, 'an unavailable price leaves no quote')

assert(#forbidden == 0, 'the addon called a buy or bid function: ' .. table.concat(forbidden, ','))
for _, row in ipairs(events()) do
 for _, value in pairs(row) do assert(value ~= 'Jaina' and value ~= 'Player-1-AAAA', 'buyers, sellers and recipients are other players and are never stored') end
end
""")

# The local ledger: an auction sale is kept by item once the money change confirms the letter. Forever's invoice
# returns invoiceType, itemName, playerName, bid, buyout, deposit, consignmentFee, moneyDelay, etaDay, etaHour,
# count, commerceAuction. The buyer's name is never kept anywhere in the saved file.
ledger = runtime()
ledger.execute("""
local function events(category)
 local list = {}
 for _, row in ipairs(EverlootDB.records.money_event or {}) do
  if category == nil or row.category == category then list[#list + 1] = row end
 end
 return list
end
event('PLAYER_ENTERING_WORLD')
local key = Everloot.CharacterKey()
assert(key, 'the test character has a key')
assert(EverlootDB.ledger.daily[key]['2026-10-09'] == 1000, 'entering the world writes the daily close')
invoiceCount = 20
GetInboxInvoiceInfo = function()
 return 'seller', 'Linen Cloth', 'Buyerperson', 4000, 4000, 100, 200, 0, 0, 0, invoiceCount, true
end
GetInboxHeaderInfo = function() return 'icon', 'paper', 'Auction House', 'Auction successful', 3900 end
TakeInboxMoney(1)
money = money + 3900; event('PLAYER_MONEY')
assert(#events() == 1 and events('auction')[1].copper == 3800, 'one money_event, auction 3800')
assert(events()[1].itemName == nil and events()[1].count == nil, 'the uploaded money_event keeps its shape')
local sale = EverlootDB.ledger.sales[1]
assert(#EverlootDB.ledger.sales == 1 and sale.key == key, 'one sale under the character key')
assert(sale.itemName == 'Linen Cloth' and sale.count == 20 and sale.total == 3800 and sale.unit == 190
 and sale.deposit == 100 and sale.cut == 200 and sale.status == 'paid', 'the sale by item')
local row = EverlootDB.ledger.events[1]
assert(#EverlootDB.ledger.events == 1 and row.key == key and row.category == 'auction' and row.copper == 3800
 and row.itemName == 'Linen Cloth' and row.count == 20, 'the ledger event names the item')
assert(EverlootDB.ledger.daily[key]['2026-10-09'] == 4900, 'PLAYER_MONEY writes the daily close')

-- A money change that does not match the letter: no sale, no event; the close still follows the purse.
TakeInboxMoney(1)
money = money + 3901; event('PLAYER_MONEY')
assert(#EverlootDB.ledger.sales == 1 and #EverlootDB.ledger.events == 1 and #events() == 1, 'a mismatched delta records nothing')
assert(EverlootDB.ledger.daily[key]['2026-10-09'] == 8801, 'the close follows the purse')

-- An invoice without a count is one item.
invoiceCount = nil
TakeInboxMoney(1)
money = money + 3900; event('PLAYER_MONEY')
local single = EverlootDB.ledger.sales[2]
assert(single and single.count == 1 and single.unit == 3800 and EverlootDB.ledger.events[2].count == 1, 'no count is count 1')

-- Every stored money event reaches the ledger, not only sales.
event('QUEST_TURNED_IN', 123, 450, 250)
local quest = EverlootDB.ledger.events[3]
assert(quest and quest.key == key and quest.category == 'quest' and quest.copper == 250, 'a quest reward in the ledger')

local function walk(value, path)
 if type(value) == 'string' then
  assert(not value:find('Buyerperson', 1, true), 'a buyer name was saved at ' .. path)
 elseif type(value) == 'table' then
  for k, v in pairs(value) do walk(k, path .. '[key]'); walk(v, path .. '.' .. tostring(k)) end
 end
end
walk(EverlootDB, 'EverlootDB')
""")
check_all(ledger)

# The sold notice: a system line with the client's own text and only the item. It adds a pending sale; the invoice
# flow fills the same row. A secret line, another system line, and a client without the global record nothing.
SOLD = "ERR_AUCTION_SOLD_S = 'A buyer has been found for your auction of %s.'"
pending = runtime(SOLD + "\n" + "issecretvalue = function(v) return v == 'SECRET LINE' end")
pending.execute("""
event('PLAYER_ENTERING_WORLD')
local key = Everloot.CharacterKey()
local sales = EverlootDB.ledger.sales
event('CHAT_MSG_SYSTEM', 'SECRET LINE')
event('CHAT_MSG_SYSTEM', 'Your auction of Linen Cloth has expired.')
event('CHAT_MSG_SYSTEM', 42)
assert(#sales == 0, 'a secret, unrelated or non-string line records nothing')
event('CHAT_MSG_SYSTEM', string.format(ERR_AUCTION_SOLD_S, 'Linen Cloth'))
assert(#sales == 1 and sales[1].key == key and sales[1].itemName == 'Linen Cloth' and sales[1].status == 'pending', 'one pending sale')
assert(sales[1].total == nil and sales[1].count == nil and sales[1].unit == nil, 'no gold is known yet')
assert(#(EverlootDB.records.money_event or {}) == 0 and #EverlootDB.ledger.events == 0, 'the notice moves no money and uploads nothing')
GetInboxInvoiceInfo = function() return 'seller', 'Linen Cloth', 'Buyerperson', 4000, 4000, 100, 200, 0, 0, 0, 20, true end
GetInboxHeaderInfo = function() return 'icon', 'paper', 'Auction House', 'Auction successful', 3900 end
TakeInboxMoney(1)
money = money + 3900; event('PLAYER_MONEY')
assert(#sales == 1, 'the invoice fills the pending row, it does not add one')
local sale = sales[1]
assert(sale.status == 'paid' and sale.count == 20 and sale.unit == 190 and sale.total == 3800 and sale.deposit == 100 and sale.cut == 200, 'the same row, paid')
-- With nothing pending, a sale still appends as before.
TakeInboxMoney(1)
money = money + 3900; event('PLAYER_MONEY')
assert(#sales == 2 and sales[2].status == 'paid', 'a sale without a notice appends')
""")
check_all(pending)

missing = runtime("ERR_AUCTION_SOLD_S = nil")
missing.execute("""
event('PLAYER_ENTERING_WORLD')
event('CHAT_MSG_SYSTEM', 'A buyer has been found for your auction of Linen Cloth.')
assert(#EverlootDB.ledger.sales == 0, 'no global, no pending sale')
assert(Everloot:Status():find('sold notice: no ERR_AUCTION_SOLD_S', 1, true), Everloot:Status())
""")
check_all(missing)

# Without the ledger file, gold records its money_event as before.
plain = runtime("Everloot.Ledger = nil")
plain.execute("""
event('PLAYER_ENTERING_WORLD')
GetInboxInvoiceInfo = function() return 'seller', 'Linen Cloth', 'Buyerperson', 4000, 4000, 100, 200, 0, 0, 0, 20, true end
GetInboxHeaderInfo = function() return 'icon', 'paper', 'Auction House', 'Auction successful', 3900 end
TakeInboxMoney(1)
money = money + 3900; event('PLAYER_MONEY')
local rows = EverlootDB.records.money_event
assert(#rows == 1 and rows[1].category == 'auction' and rows[1].copper == 3800, 'money_event without the ledger')
local store = EverlootDB.ledger or {}
assert(#(store.events or {}) == 0 and #(store.sales or {}) == 0 and next(store.daily or {}) == nil, 'gold writes no ledger rows without E.Ledger')
""")
check_all(plain)

# Slice two: repairs, vendor purchases, trades and mail. These categories go to the local ledger only; the uploaded
# money_event keeps the schema's nine. An own alt is a roster name on the player's realm; no other name is kept.
# The repair hooks are installed at init, so the repair functions exist before the module starts.
two = runtime("RepairAllItems = function() end\nRepairItem = function() end\n"
              "GetPlayerTradeMoney = function() return tradeOut end\nGetTargetTradeMoney = function() return tradeIn end\n"
              "sendMoney = 0\nGetSendMailMoney = function() return sendMoney end\n"
              "SendMailNameEditBox = { GetText = function() return recipient end }\n"
              "UnitName = function(unit) if unit == 'NPC' then return partner, partnerRealm end return 'Thrall' end\n")
two.execute("""
local function uploaded() return #(EverlootDB.records.money_event or {}) end
local function last() local rows = EverlootDB.ledger.events; return rows[#rows] end
money = 100000
event('PLAYER_ENTERING_WORLD')
EverlootDB.roster.alt00001 = { name = 'Altperson', realm = 'Test Realm' }
EverlootDB.roster.alt00002 = { name = 'Farperson', realm = 'Other Realm' }
local key = Everloot.CharacterKey()
local events = EverlootDB.ledger.events

-- A repair at an open merchant, one item repaired, a purchase, an expired repair. A sale there stays vendor income.
event('MERCHANT_SHOW')
RepairAllItems(false)
money = money - 1200; event('PLAYER_MONEY')
assert(#events == 1 and last().category == 'repair' and last().copper == 1200 and last().key == key, 'repair 1200')
assert(uploaded() == 0, 'a repair adds no money_event row')
money = money - 500; event('PLAYER_MONEY')
assert(#events == 2 and last().category == 'vendor_spend' and last().copper == 500, 'purchase 500 is a vendor purchase')
RepairItem()
money = money - 80; event('PLAYER_MONEY')
assert(#events == 3 and last().category == 'repair' and last().copper == 80, 'one item repaired')
RepairAllItems(false)
runTimers()
money = money - 90; event('PLAYER_MONEY')
assert(#events == 4 and last().category == 'vendor_spend', 'an expired repair is a purchase')
money = money + 300; event('PLAYER_MONEY')
assert(#events == 5 and last().category == 'vendor' and uploaded() == 1, 'a sale at a merchant stays vendor income')
event('MERCHANT_CLOSED')
money = money - 40; event('PLAYER_MONEY')
assert(#events == 5, 'no merchant, nothing recorded')

-- A trade with an own alt: both sides accepted, then the money matches.
money = money + 100000; event('PLAYER_MONEY')
partner, partnerRealm, tradeOut, tradeIn = 'Altperson', nil, 0, 2500
event('TRADE_SHOW')
event('TRADE_ACCEPT_UPDATE', 1, 0)
event('TRADE_ACCEPT_UPDATE', 1, 1)
event('TRADE_CLOSED')
money = money + 2500; event('PLAYER_MONEY')
assert(#events == 6 and last().category == 'trade_in' and last().copper == 2500 and last().ownAlt == true, 'trade in from an alt')
-- A trade with another player, money both ways.
partner, tradeOut, tradeIn = 'Partnerperson', 1000, 300
event('TRADE_SHOW')
event('TRADE_ACCEPT_UPDATE', 1, 1)
event('TRADE_CLOSED')
money = money - 700; event('PLAYER_MONEY')
assert(#events == 8 and events[7].category == 'trade_in' and events[7].copper == 300 and events[8].category == 'trade_out'
 and events[8].copper == 1000 and events[7].ownAlt == nil and events[8].ownAlt == nil, 'trade both ways, not an alt')
-- The money change can come before the window closes.
partner, tradeOut, tradeIn = 'Partnerperson', 0, 120
event('TRADE_SHOW')
event('TRADE_ACCEPT_UPDATE', 1, 1)
money = money + 120; event('PLAYER_MONEY')
event('TRADE_CLOSED')
assert(#events == 9 and last().category == 'trade_in' and last().copper == 120, 'money before TRADE_CLOSED')
-- A roster name on another realm is not the alt.
partner, partnerRealm, tradeOut, tradeIn = 'Farperson', 'Other Realm', 50, 0
event('TRADE_SHOW')
event('TRADE_ACCEPT_UPDATE', 1, 1)
event('TRADE_CLOSED')
money = money - 50; event('PLAYER_MONEY')
assert(#events == 10 and last().category == 'trade_out' and last().ownAlt == nil, 'a cross-realm partner is not an own alt')
-- A money change that does not match records nothing, and the trade is gone after it.
partner, partnerRealm, tradeOut, tradeIn = 'Altperson', nil, 400, 0
event('TRADE_SHOW')
event('TRADE_ACCEPT_UPDATE', 1, 1)
event('TRADE_CLOSED')
money = money - 399; event('PLAYER_MONEY')
money = money - 400; event('PLAYER_MONEY')
assert(#events == 10, 'a mismatched delta records nothing')
-- A trade the partner never accepted, with no money change seen, moves nothing.
event('TRADE_SHOW')
event('TRADE_ACCEPT_UPDATE', 1, 0)
event('TRADE_CLOSED')
money = money - 400; event('PLAYER_MONEY')
assert(#events == 10, 'an unaccepted trade records nothing')
-- The player accepts second: only (0, 1) is seen, and the matching money still records the trade.
event('TRADE_SHOW')
event('TRADE_ACCEPT_UPDATE', 0, 1)
event('TRADE_CLOSED')
money = money - 400; event('PLAYER_MONEY')
assert(#events == 11 and last().category == 'trade_out' and last().copper == 400 and last().ownAlt == true, 'partner accepted first')
-- A money change in the trade window is snapshotted too.
partner, tradeOut, tradeIn = 'Partnerperson', 0, 250
event('TRADE_SHOW')
event('TRADE_MONEY_CHANGED')
event('TRADE_CLOSED')
money = money + 250; event('PLAYER_MONEY')
assert(#events == 12 and last().category == 'trade_in' and last().copper == 250 and last().ownAlt == nil, 'TRADE_MONEY_CHANGED snapshot')
-- A closed trade waits a few seconds for its money: within the window it is recorded; once the timer has run (a
-- cancelled trade), loot of the same amount is not a trade.
timers = {}
event('TRADE_SHOW')
event('TRADE_MONEY_CHANGED')
event('TRADE_CLOSED')
assert(#timers == 1 and timers[1].seconds == 3, 'closing starts a 3 second expiry')
money = money + 250; event('PLAYER_MONEY')
runTimers()
assert(#events == 13 and last().category == 'trade_in' and last().copper == 250, 'money within the window is the trade')
event('TRADE_SHOW')
event('TRADE_MONEY_CHANGED')
event('TRADE_CLOSED')
runTimers()
money = money + 250; event('PLAYER_MONEY')
assert(#events == 13, 'a cancelled trade expires: later money of the same amount records nothing')
-- An older close's timer does not clear a newer trade.
event('TRADE_SHOW')
event('TRADE_MONEY_CHANGED')
event('TRADE_CLOSED')
local older = timers[#timers]
timers = {}
event('TRADE_SHOW')
event('TRADE_MONEY_CHANGED')
event('TRADE_CLOSED')
older.f()
money = money + 250; event('PLAYER_MONEY')
assert(#events == 14 and last().category == 'trade_in', 'a stale timer leaves the newer trade armed')
timers = {}

-- Mail out: to a non-alt, and to an alt whatever the case.
sendPrice, sendMoney, recipient = 30, 5000, 'Strangerperson'
SendMail('Strangerperson', 'Hi', '')
event('MAIL_SEND_SUCCESS')
assert(#events == 16 and events[15].category == 'postage' and events[16].category == 'mail_out' and events[16].copper == 5000
 and events[16].ownAlt == nil, 'mail out to a non-alt')
recipient = 'altperson'
SendMail('altperson', 'Hi', '')
event('MAIL_SEND_SUCCESS')
assert(#events == 18 and last().category == 'mail_out' and last().ownAlt == true, 'mail out to an alt')
sendMoney = 0
SendMail('Strangerperson', 'Hi', '')
event('MAIL_SEND_SUCCESS')
assert(#events == 19 and last().category == 'postage', 'a letter without money is postage only')
sendMoney = 700
SendMail('Strangerperson', 'Hi', '')
event('MAIL_FAILED')
event('MAIL_SEND_SUCCESS')
assert(#events == 19, 'a failed send moves nothing')

-- Mail in: only a letter from one of the player's own characters is recorded. Another player's gold, an outbid
-- refund or a system letter stays unrecorded; an auction sale is still a sale.
mailFrom, mailMoney = 'Altperson', 900
GetInboxInvoiceInfo = function() return nil end
GetInboxHeaderInfo = function() return 'icon', 'paper', mailFrom, 'Hi', mailMoney end
TakeInboxMoney(1)
money = money + 900; event('PLAYER_MONEY')
assert(#events == 20 and last().category == 'mail_in' and last().copper == 900 and last().ownAlt == true, 'mail in from an alt')
mailFrom, mailMoney = 'Partnerperson', 600
TakeInboxMoney(1)
money = money + 600; event('PLAYER_MONEY')
assert(#events == 20, 'mail from another player stays unrecorded')
mailFrom, mailMoney = 'Auction House', 5000
TakeInboxMoney(1)
money = money + 5000; event('PLAYER_MONEY')
assert(#events == 20, 'an outbid refund stays unrecorded')
mailFrom, mailMoney = 'Altperson', 600
TakeInboxMoney(1)
money = money + 599; event('PLAYER_MONEY')
assert(#events == 20, 'a mismatched letter records nothing')
GetInboxInvoiceInfo = function() return 'seller', 'Linen Cloth', 'Partnerperson', 4000, 4000, 100, 200, 0, 0, 0, 20, true end
mailFrom, mailMoney = 'Auction House', 3900
TakeInboxMoney(1)
money = money + 3900; event('PLAYER_MONEY')
assert(#events == 21 and last().category == 'auction', 'a sale letter is not plain mail')
-- A COD payment at the open mailbox stays unrecorded.
money = money - 1000; event('PLAYER_MONEY')
assert(#events == 21, 'a COD payment is unrecorded')

-- A guild-bank repair takes none of the player's gold: the next drop at the merchant is a purchase.
event('MERCHANT_SHOW')
RepairAllItems(true)
money = money - 600; event('PLAYER_MONEY')
assert(#events == 22 and last().category == 'vendor_spend' and last().copper == 600, 'a guild repair is not pending')
event('MERCHANT_CLOSED')

-- money_event never carries a new category.
local known = { loot = true, quest = true, vendor = true, auction = true, flight = true, postage = true, barber = true, respec = true, auction_spend = true }
for _, row in ipairs(EverlootDB.records.money_event) do assert(known[row.category], 'money_event carries ' .. tostring(row.category)) end
assert(uploaded() == 5, 'vendor, postage three times and the auction sale uploaded; got ' .. uploaded())

-- No partner, recipient or sender name is saved; the alts' names live only in the roster.
local function walk(value, path, name)
 if type(value) == 'string' then
  assert(not value:lower():find(name:lower(), 1, true), name .. ' was saved at ' .. path)
 elseif type(value) == 'table' then
  for k, v in pairs(value) do
   if not (path == 'EverlootDB' and k == 'roster') then walk(k, path .. '[key]', name); walk(v, path .. '.' .. tostring(k), name) end
  end
 end
end
for _, name in ipairs({ 'Partnerperson', 'Strangerperson', 'Altperson', 'Farperson' }) do walk(EverlootDB, 'EverlootDB', name) end
""")
check_all(two)

# Looted gold: Forever's money slot carries its amount in the slot text, not in the quantity field.
loot = runtime("GOLD_AMOUNT = '%d Gold'; SILVER_AMOUNT = '%d Silver'; COPPER_AMOUNT = '%d Copper'\n"
               "slot = { type = 2, name = '1 Gold\\n20 Silver', quantity = 0 }\n"
               "GetNumLootItems = function() return 1 end\n"
               "GetLootSlotType = function() return slot.type end\n"
               "GetLootSlotInfo = function() return 'icon', slot.name, slot.quantity end\n")
loot.execute("""
event('PLAYER_ENTERING_WORLD')
local rows = EverlootDB.records.money_event
local before = #(rows or {})
event('LOOT_OPENED')
rows = EverlootDB.records.money_event
assert(#rows == before + 1 and rows[#rows].category == 'loot' and rows[#rows].copper == 12000, 'text-only money slot is 12000')
local ledger = EverlootDB.ledger.events
assert(ledger[#ledger].category == 'loot' and ledger[#ledger].copper == 12000, 'the ledger has the loot event')
-- A thousands separator belongs to the number.
slot.name = '1,234 Gold'
event('LOOT_OPENED')
rows = EverlootDB.records.money_event
assert(rows[#rows].copper == 12340000, '1,234 Gold is 12340000, got ' .. tostring(rows[#rows].copper))
-- A Spanish client's own coin words.
GOLD_AMOUNT = '%d de oro'; SILVER_AMOUNT = '%d de plata'; COPPER_AMOUNT = '%d de cobre'
slot.name = '1.234 de oro\\n5 de plata'
event('LOOT_OPENED')
rows = EverlootDB.records.money_event
assert(rows[#rows].copper == 12340500, 'Spanish words and separator, got ' .. tostring(rows[#rows].copper))
-- A name with no amount falls back to the numeric field; an item slot is not income.
slot.name, slot.quantity = nil, 77
event('LOOT_OPENED')
rows = EverlootDB.records.money_event
assert(rows[#rows].copper == 77, 'the numeric field is the fallback')
local n = #rows
slot.type, slot.name = 1, '5 Gold'
event('LOOT_OPENED')
assert(#EverlootDB.records.money_event == n, 'an item slot is not income')
""")
check_all(loot)

# One gold_snapshot a minute, kept in the saved file: a loading screen inside the minute with the same balance writes
# nothing, on a /reload too; a changed balance still writes at once.
snap = runtime()
snap.execute("""
event('PLAYER_ENTERING_WORLD')
assert(Everloot:Count('gold_snapshot') == 1, 'login writes a snapshot')
event('PLAYER_ENTERING_WORLD')
assert(Everloot:Count('gold_snapshot') == 1, 'a loading screen inside the minute with the same balance writes nothing')
money = 1600; event('PLAYER_ENTERING_WORLD')
assert(Everloot:Count('gold_snapshot') == 2, 'a changed balance inside the minute still writes')
function dump(v)
 local t = type(v)
 if t == 'number' then return string.format('%.17g', v) end
 if t == 'string' then return string.format('%q', v) end
 if t == 'boolean' then return tostring(v) end
 if t == 'table' then
  local parts = {}
  for k, x in pairs(v) do parts[#parts + 1] = '[' .. dump(k) .. ']=' .. dump(x) end
  return '{' .. table.concat(parts, ',') .. '}'
 end
 return 'nil'
end
""")
reloaded = runtime("money = 1600\nEverlootDB = " + snap.eval("dump(EverlootDB)"))
reloaded.execute("""
event('PLAYER_ENTERING_WORLD')
assert(Everloot:Count('gold_snapshot') == 2, 'a /reload inside the minute with the same balance writes nothing')
money = 1700; event('PLAYER_MONEY')
assert(Everloot:Count('gold_snapshot') == 2, 'a money change inside the minute waits for the minute')
""")
check_all(reloaded)

# No addon source may call, index by string, or alias a buy, bid, post or craft function.
import re
names = (r"PostItem|PostCommodity|PlaceBid|PlaceAuctionBid|StartAuction|PostAuction|StartCommoditiesPurchase|"
         r"ConfirmCommoditiesPurchase|BuyoutItem|CancelAuction|CancelCommoditiesPurchase|ClickAuctionSellItemButton|"
         r"CraftRecipe|CraftEnchant|CraftSalvage|RecraftRecipe|BuyTrainerService|LearnTalent")
for source in sorted(root.rglob("*.lua")):
    if "tests" in source.parts:
        continue
    code = "\n".join(line.split("--")[0] for line in source.read_text(encoding="utf-8").splitlines())
    checks = {
        "a call": rf"\b({names})\s*\(|pcall\(\s*(?:[A-Za-z_]+\.)?({names})\b",
        "a string index": rf"\[\s*[\"']({names})[\"']\s*\]",
        "indexing C_AuctionHouse or C_TradeSkillUI by a name": r"\bC_(?:AuctionHouse|TradeSkillUI)\s*\[",
        # C_TradeSkillUI is aliased on purpose in professions.lua; recipes_contract.py limits what that alias may name.
        "an alias of the auction namespace": r"=\s*C_AuctionHouse\b(?!\s*[.\[])",
        "an alias of an action": rf"=\s*(?:[A-Za-z_]+\.)?({names})\b(?!\s*[(=])",
    }
    for what, pattern in checks.items():
        found = re.search(pattern, code)
        assert not found, f"{source.name} has {what} of a buy, bid, post or craft API: {found.group(0)}"
# Every row the addon wrote is a record the site would accept (packages/protocol/schema).
check_all(lua)
print("Lua 5.1 gold: vendor sales, flights, quest rewards, net auction sales, postage and buyouts (legacy and C_AuctionHouse, items and commodities) attributed; auction sales by item and daily closes in the local ledger; repairs, vendor purchases, trades and mail money in the ledger only, own-alt transfers marked; unknown income unrecorded")
