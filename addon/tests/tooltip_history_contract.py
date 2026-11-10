"""Run with: uv run --with lupa --with jsonschema python addon/tests/tooltip_history_contract.py

The item tooltip's "your history" lines, read from the gold ledger's local store: the last sale (UTC day, price per
unit), the average sale and units sold over the ledger's window, sales still waiting for their letter, and the average
paid only where a purchase names its item and count. Characters on this realm only. No history means no line, never a
zero, and every amount says its window. The settings page's three tooltip switches (prices, your history, sources) are
on by default, saved in EverlootDB, and apply at once. The ledger is indexed by item once and again only after it
changes: a hover never walks the store.
"""
import re
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
prices_src = (root / "modules/prices.lua").read_text(encoding="utf-8")
ledger_src = (root / "modules/ledger.lua").read_text(encoding="utf-8")
# Nothing new is recorded or uploaded: the history reads the store and writes neither records nor the store.
history_fn = ledger_src[ledger_src.index("local function buildItems"):ledger_src.index('E:RegisterModule("ledger"')]
assert "E:Store(" not in history_fn and "records" not in history_fn, "the item index reads the ledger store only"
assert not re.search(r"\b(s\.sales|s\.events)\s*\[[^\]]*\]\s*=(?!=)", history_fn), "the item index never writes the store"

lua = LuaRuntime()
lua.execute("""
date = os.date
NOW = 1793750400 + 12 * 3600   -- 2026-11-03 12:00 UTC
clock = NOW
time = function() return clock end
DAY = 86400
printed = {}
print = function(msg) printed[#printed + 1] = tostring(msg) end
SlashCmdList = {}
CreateFrame = function() return {
  RegisterEvent = function() end, UnregisterEvent = function() end,
  SetScript = function(self, _, f) self.onEvent = f end, HookScript = function() end,
} end
GetRealmName = function() return 'Forever' end
UnitGUID = function() return 'Player-1-0000000A' end
UnitClass = function() return 'Mage', 'MAGE' end
UnitLevel = function() return 60 end
UnitName = function() return 'Anna' end
itemInfoCalls = 0
ITEMS = { [2589] = 'Linen Cloth', [4306] = 'Silk Cloth', [2592] = 'Wool Cloth', [2770] = 'Copper Ore', [818] = 'Tigerseye' }
GetItemInfo = function(id)
  itemInfoCalls = itemInfoCalls + 1
  local name = ITEMS[id]
  if not name then return nil end
  return name, '|Hitem:' .. id .. '|h[' .. name .. ']|h', 1, 1, 1, 'Trade Goods', 'Cloth', 20, '', 0, 13
end
tooltipCalls = {}
Enum = { TooltipDataType = { Item = 0 } }
TooltipDataProcessor = { AddTooltipPostCall = function(kind, f) table.insert(tooltipCalls, f) end }
function hover(itemId, name)
  local tip = { lines = {}, rows = {} }
  tip.GetName = function() return name or 'GameTooltip' end
  tip.AddLine = function(self, text) table.insert(self.lines, text) end
  tip.AddDoubleLine = function(self, l, r) table.insert(self.lines, l .. ' | ' .. r); table.insert(self.rows, { l, r }) end
  for _, f in ipairs(tooltipCalls) do f(tip, { id = itemId }) end
  return table.concat(tip.lines, '\\n'), tip
end
""")
for file in ["core.lua", "modules/roster.lua", "modules/ledger.lua", "modules/prices.lua", "modules/drops.lua", "modules/options.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))

lua.execute("""
EverlootDB = nil
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
local E, L = Everloot, Everloot.Ledger
assert(E.Ledger and E.Ledger.ItemHistory and E.Ledger.WINDOW_DAYS == 90)
E:InitModules()
assert(#tooltipCalls == 1, 'the tooltip is hooked once')
local me = E.CharacterKey()
assert(me, 'this character has a key')

-- An empty ledger, no price file, no rows: the tooltip carries no Everloot line at all.
local text = hover(2589)
assert(text == '', 'nothing to say says nothing; got ' .. text)

-- The roster: this character and an alt on Forever, another on a different realm.
EverlootDB.roster = {
  [me] = { name = 'Anna', realm = 'Forever' },
  alt0001 = { name = 'Bert', realm = 'Forever' },
  far0001 = { name = 'Cara', realm = 'Elsewhere' },
}
local function sale(at, key, name, count, total, status)
  local s = EverlootDB.ledger.sales
  s[#s + 1] = { at = at, key = key, itemName = name, count = count, total = total,
    unit = count and math.floor(total / count), status = status or 'paid' }
end
local function event(at, key, category, copper, itemName, count, ownAlt)
  local e = EverlootDB.ledger.events
  e[#e + 1] = { at = at, key = key, category = category, copper = copper, itemName = itemName, count = count, ownAlt = ownAlt }
end
EverlootDB.ledger = { events = {}, sales = {}, daily = {} }
-- Linen: 20 units for 2g (10s each) and 10 for 1g 50s (15s each, the newest), by this character and its alt.
sale(NOW - 3 * DAY, me, 'Linen Cloth', 20, 20000)
sale(NOW - DAY, 'alt0001', 'Linen Cloth', 10, 15000)
sale(NOW - 100 * DAY, me, 'Linen Cloth', 5, 500000)               -- outside the window
sale(NOW - 2 * 3600, 'far0001', 'Linen Cloth', 1, 990000)        -- another realm
sale(NOW - 3600, me, 'Linen Cloth', nil, nil, 'pending')           -- sold, letter not taken
sale(NOW - 3 * DAY, me, 'Linen Cloth', nil, nil, 'pending')        -- past 48 hours: no longer waiting
sale(NOW - 5 * DAY, me, 'Linen Cloth', nil, nil, 'unmatched')
-- Silk: only a sale waiting for its letter.
sale(NOW - 600, me, 'Silk Cloth', nil, nil, 'pending')
-- Wool: a buyout that names the item and its count, one that does not, and an alt transfer.
event(NOW - 2 * DAY, me, 'auction_spend', 12000, 'Wool Cloth', 4)
event(NOW - DAY, me, 'auction_spend', 9999)
event(NOW - DAY, me, 'auction_spend', 5000, 'Wool Cloth', 1, true)
event(NOW - DAY, me, 'vendor', 300, 'Wool Cloth', 1)
-- Copper Ore: only rows that say nothing (unmatched, out of window, another realm).
sale(NOW - DAY, me, 'Copper Ore', nil, nil, 'unmatched')
sale(NOW - 95 * DAY, me, 'Copper Ore', 2, 200)
sale(NOW - DAY, 'far0001', 'Copper Ore', 2, 200)

-- Linen: the last sale, the average and the units, each with its window; the waiting sale on its own line.
L.indexBuilds = 0
local text, tip = hover(2589)
assert(L.indexBuilds == 1, 'the first hover builds the index')
local day = date('!%Y-%m-%d', NOW - DAY)
assert(text:find('Your last sale · ' .. day .. ' | 15|TInterface\\\\MoneyFrame\\\\UI-SilverIcon', 1, true), text)
-- 35000 copper for 30 units: 11s 66c each, in the price lines' own coin icons.
assert(text:find('  Average sale · last 90 days | 11|TInterface\\\\MoneyFrame\\\\UI-SilverIcon:0:0:2:0|t 66|TInterface\\\\MoneyFrame\\\\UI-CopperIcon:0:0:2:0|t', 1, true), text)
assert(text:find('  30 units sold in 2 sales, last 90 days', 1, true), text)
assert(text:find('  and 1 more sale in the last 2 days, paid when you take the mailbox letter', 1, true), text)
assert(not text:find('990000', 1, true) and not text:find('99g', 1, true) and not text:find('50g', 1, true), 'other realms and old sales stay out')
assert(not text:find('Average paid', 1, true) and not text:find('bought', 1, true), 'no purchase line without a purchase')
assert(text:find('Forever', 1, true) and text:find('per unit', 1, true), 'the header names the realm and the unit')

-- The same amounts in chat, in the addon's money formatter (E.Coins), from the same lines.
printed = {}
E.PriceCommand('2589')
local chat = table.concat(printed, '\\n')
assert(chat:find('Your last sale 15s 0c · per unit · ' .. day, 1, true), chat)
assert(chat:find('average sale ' .. E.Coins(11 * 100 + 66) .. ' · last 90 days', 1, true), chat)

-- Silk: only a waiting sale. It says so, with no price, no average and no zero.
text = hover(4306)
assert(text:find('Your sales: 1 sale in the last 2 days, paid when you take the mailbox letter', 1, true), text)
assert(not text:find('Average', 1, true) and not text:find('last sale', 1, true) and not text:find(' 0 ', 1, true), text)
-- Past its 48 hours the waiting sale says nothing, though nothing was written: the index knows when it expires.
-- (The first hover is on the day it expires, a minute before, so the day's own rebuild is not what drops it.)
clock = NOW - 600 + 48 * 3600 - 60
assert(hover(4306):find('Your sales: 1 sale', 1, true), 'still waiting a minute before')
local before = L.indexBuilds
clock = clock + 61
assert(hover(4306) == '' and L.indexBuilds == before + 1, 'an expired waiting sale drops out')
clock = NOW

-- Wool: the average paid from the one purchase that names its item and count; the alt transfer, the purchase
-- without an item and the vendor sale do not count.
text = hover(2592)
assert(text:find('Your average paid · last 90 days | 30|TInterface\\\\MoneyFrame\\\\UI-SilverIcon', 1, true), text)
assert(text:find('  4 units bought in 1 purchase, last 90 days', 1, true), text)
assert(not text:find('sale', 1, true), 'no sale lines without a sale: ' .. text)

-- Copper Ore and an item never seen: nothing at all, never a zero.
assert(hover(2770) == '', 'rows that say nothing give no line: ' .. hover(2770))
assert(hover(818) == '', 'an item with no history has no line')
assert(L.ItemHistory('Forever', 'Copper Ore') == nil and L.ItemHistory('Forever', 'Tigerseye') == nil)

-- Per-hover cost: the index is built once; many hovers read it and never walk the ledger again.
hover(2589)
local walked, built = 0, L.indexBuilds
local sales, events = L.Sales, L.SalesByItem
L.Sales = function(...) walked = walked + 1; return sales(...) end
L.SalesByItem = function(...) walked = walked + 1; return events(...) end
for _ = 1, 50 do hover(2589); hover(4306); hover(818) end
assert(L.indexBuilds == built and walked == 0, 'hovers reuse the index; builds ' .. L.indexBuilds - built .. ', walks ' .. walked)
L.Sales, L.SalesByItem = sales, events

-- A ledger change rebuilds once: a new paid sale shows on the next hover.
clock = NOW + 60
assert(L.RecordSale(me, { itemName = 'Linen Cloth', count = 10, total = 5000 }))
text = hover(2589)
assert(L.indexBuilds == built + 1, 'a write rebuilds the index once; got ' .. L.indexBuilds - built)
-- RecordSale fills the oldest waiting or unmatched Linen sale; the newest sale is now 5s each.
assert(text:find('Your last sale · ' .. date('!%Y-%m-%d', clock) .. ' | 5|TInterface\\\\MoneyFrame\\\\UI-SilverIcon', 1, true), text)
assert(text:find('  40 units sold in 3 sales, last 90 days', 1, true), text)
hover(2589); hover(2589)
assert(L.indexBuilds == built + 1, 'and only once')
-- Rows added outside the writers (a fresh store) are seen too.
EverlootDB.ledger = { events = {}, sales = {}, daily = {} }
assert(hover(2589) == '' and L.indexBuilds == built + 2, 'an emptied ledger empties the history')
-- A new UTC day moves the window: the index is built again, so an aged row drops out.
EverlootDB.ledger.sales = { { at = NOW - 89 * DAY + 3600, key = me, itemName = 'Linen Cloth', count = 1, total = 100, unit = 100, status = 'paid' } }
assert(hover(2589):find('1 unit sold in 1 sale, last 90 days', 1, true))
local builds = L.indexBuilds
clock = NOW + 2 * DAY
assert(hover(2589) == '' and L.indexBuilds == builds + 1, 'a new day rebuilds the index and the window moves')
""")

# Toggles: market, history and sources, on by default, saved in EverlootDB, applied at once.
lua.execute("""
local E, L, O = Everloot, Everloot.Ledger, Everloot.Options
clock = NOW
local me = E.CharacterKey()
EverlootDB.ledger = { events = {}, sales = { { at = NOW - DAY, key = me, itemName = 'Linen Cloth', count = 2, total = 400, unit = 200, status = 'paid' } }, daily = {} }
-- The player's own scan (market block) and a vendor sighting (sources) for the same item.
EverlootDB.lastScans = { Forever = { scanId = 's1', at = NOW - 3600 } }
EverlootDB.records.auction_snapshot = { { scanId = 's1', items = { { 2589, 3, 30, 120, 130 } } } }
EverlootDB.records.vendor = { { vendorNpcId = 1234, items = { { itemId = 2589 } } } }
-- A price file without this realm: a missing price and missing drop sources are each said.
EverlootPricesDB = { realms = {} }
E:ResetPrices()

local rows = {}
for _, row in ipairs(O.ROWS) do rows[row.key] = row end
for _, key in ipairs({ 'tooltipMarket', 'tooltipHistory', 'tooltipSources' }) do
  local row = rows[key]
  assert(row and row.field and row.live and not row.defaultOff and not row.command, key .. ' is a live field switch, on by default')
  assert(O.IsOn(row) and E.TooltipShows(key) and EverlootDB[key] == nil, key .. ' is on for a new install')
  assert(row.text:find('Records nothing', 1, true), key .. ' says it records nothing')
end

local all = hover(2589)
assert(all:find('Your scan · min buyout', 1, true) and all:find('Vendor', 1, true), all)
assert(all:find('Your last sale', 1, true) and all:find('Sold by NPC 1234', 1, true), all)
assert(all:find('Drop sources not in the price file yet', 1, true), all)
-- The order: prices, then your history, then sources.
assert(all:find('Vendor', 1, true) < all:find('Your last sale', 1, true) and all:find('Your last sale', 1, true) < all:find('Sold by', 1, true), all)

O.changed = nil
O.Set(rows.tooltipHistory, false)
assert(EverlootDB.tooltipHistory == false and not O.IsOn(rows.tooltipHistory), 'off is saved in EverlootDB')
assert(not O.changed, 'a tooltip switch needs no reload')
local text = hover(2589)
assert(not text:find('Your last sale', 1, true) and not text:find('units sold', 1, true), 'history off hides it at once: ' .. text)
assert(text:find('Your scan', 1, true) and text:find('Sold by', 1, true), 'the other parts stay: ' .. text)
O.Set(rows.tooltipHistory, true)

O.Set(rows.tooltipMarket, false)
text = hover(2589)
assert(not text:find('Your scan', 1, true) and not text:find('Vendor', 1, true) and not text:find('No price', 1, true), 'market off hides prices and their note: ' .. text)
assert(text:find('Your last sale', 1, true) and text:find('Sold by', 1, true) and text:find('per unit', 1, true), 'history keeps its amounts and the unit: ' .. text)
O.Set(rows.tooltipMarket, true)

O.Set(rows.tooltipSources, false)
text = hover(2589)
assert(not text:find('Sold by', 1, true) and not text:find('Drop sources', 1, true), 'sources off hides drops, vendors and their note: ' .. text)
assert(text:find('Your scan', 1, true) and text:find('Your last sale', 1, true), text)
-- An item with no price, no history and sources off: only the missing price is said.
text = hover(818)
assert(text:find('No price on Forever yet', 1, true) and not text:find('drop source', 1, true), text)

O.Set(rows.tooltipMarket, false); O.Set(rows.tooltipHistory, false)
assert(hover(2589) == '', 'everything off: no Everloot block at all')
for _, key in ipairs({ 'tooltipMarket', 'tooltipHistory', 'tooltipSources' }) do O.Set(rows[key], true) end
assert(EverlootDB.tooltipMarket == true and E.TooltipShows('tooltipMarket'))

-- One block per hover: the comparison tooltips beside the main one get none, history included.
assert(hover(2589, 'ShoppingTooltip1') == '' and hover(2589, 'ItemRefShoppingTooltip2') == '', 'comparison tooltips stay clean')
local main = hover(2589)
local _, headers = main:gsub('crest:14:14', '')
assert(headers == 1, 'one Everloot header per hover; got ' .. headers)
""")
print("tooltip history contract: PASS")
