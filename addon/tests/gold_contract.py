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

-- A sale at an open merchant is vendor income; a purchase there is not recorded.
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
print("Lua 5.1 gold: vendor sales, flights, quest rewards, net auction sales, postage and buyouts (legacy and C_AuctionHouse, items and commodities) attributed; auction sales by item and daily closes in the local ledger; other purchases and unknown income unrecorded")
