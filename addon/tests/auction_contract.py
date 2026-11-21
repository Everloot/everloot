"""Run with: uv run --with lupa --with jsonschema python addon/tests/auction_contract.py"""
from pathlib import Path
from lupa.lua51 import LuaRuntime

lua = LuaRuntime()
lua.execute("""
date = function() return '2026-10-09T00:00:00Z' end
time = function() return 123456 end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
GetRealmName = function() return 'Test Realm' end
-- name, texture, count, quality, canUse, level, levelColHeader, minBid, minIncrement, buyoutPrice
local listings = {
 {'item:2589', 'Linen Cloth', 20, 2000},  -- stack of 20, 2000c buyout -> 100c each
 {'item:2592', 'Wool Cloth', 5, 0},       -- bid-only: no buyout price
 {'item:765', 'Silverleaf', 3, 100},      -- 100c / 3 -> 33c each, floored
 {'item:118', 'Minor Healing Potion', 0, 50}, -- bad stack size from the client
}
GetNumAuctionItems = function() return #listings end
GetAuctionItemLink = function(_, i) return listings[i][1] end
GetAuctionItemInfo = function(_, i)
 local l = listings[i]
 return l[2], 'icon', l[3], 1, true, 1, nil, 10, 1, l[4]
end
""")
root = Path(__file__).parents[1]
for file in ["core.lua", "modules/auctions.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute("""
Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')
assert(EverlootDB.toggles.auctions == true, 'a new install starts with auction scans on')
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil,'AUCTION_ITEM_LIST_UPDATE') end
local rows = EverlootDB.records.auction_scan
assert(rows and #rows == 2, 'bid-only and zero-count listings must be skipped, got ' .. tostring(rows and #rows))
assert(rows[1].itemId == 2589 and rows[1].copper == 100 and rows[1].count == 20 and rows[1].priceBasis == 'unit',
 'stack buyout must become a per-unit price')
assert(rows[2].itemId == 765 and rows[2].copper == 33 and rows[2].count == 3, 'per-unit price floors to whole copper')
""")
lua.execute("""
EverlootDB.toggles.auctions = false
SlashCmdList.EVERLOOT('auctions on')
assert(EverlootDB.toggles.auctions == true, '/everloot auctions on must enable the toggle')
SlashCmdList.EVERLOOT('auctions off')
assert(EverlootDB.toggles.auctions == false, '/everloot auctions off must disable the toggle')
""")
# Every row the addon wrote is a record the site would accept (packages/protocol/schema).
from protocol_schema import check_all  # noqa: E402
check_all(lua)
print("Lua 5.1 auctions: bid-only skipped, per-unit price, stack size kept")

# A player-triggered full scan reports both ways to send the saved file.
lua = LuaRuntime()
lua.execute("""
date = function() return '2026-11-15T00:00:00Z' end
time = function() return 1000000 end
printed = {}
print = function(message) printed[#printed + 1] = tostring(message) end
SlashCmdList = {}
GetRealmName = function() return 'Forever' end
CreateFrame = function() return {
 RegisterEvent=function() end, SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
C_Timer = { After = function() end }
C_AuctionHouse = {
 ReplicateItems = function() end,
 GetNumReplicateItems = function() return 1 end,
 GetReplicateItemInfo = function() return 'Item', nil, 1, nil, nil, nil, nil, nil, nil, 100, nil, nil, nil, nil, nil, nil, 2589, true end
}
""")
for file in ["core.lua", "modules/auctions.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute("""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, 'AUCTION_HOUSE_SHOW') end
Everloot:StartScan()
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, 'REPLICATE_ITEM_LIST_UPDATE') end
assert(not Everloot:Scanning(), 'the scan finished')
local message = printed[#printed]
assert(string.find(message, 'Desktop App', 1, true) and string.find(message, 'everloot.app/upload', 1, true), 'scan completion names both upload routes')
""")
print("Lua 5.1 auctions: a full scan reports both upload routes")

for file in ["modules/prices.lua", "modules/auctiontab.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute("""
-- Build 71037 gives no realm on both existing and fresh installs.
local E = Everloot
GetRealmName = function() return '' end
GetRealmID = function() return 0 end
UnitGUID = function() return 'Player-123-1234' end
UnitClass = function() return 'Mage', 'MAGE' end
UnitLevel = function() return 40 end
UnitExists = function() return true end
UnitFactionGroup = function() return 'Horde' end
EverlootDB.lastScanAt = nil
for _, hook in ipairs(E.frame.hooks) do hook(nil, 'AUCTION_HOUSE_SHOW') end
local before = #E:Rows('auction_snapshot')
E:StartScan()
assert(E:Scanning(), 'a character without a realm can still start a scan')
for _, hook in ipairs(E.frame.hooks) do hook(nil, 'REPLICATE_ITEM_LIST_UPDATE') end
assert(not E:Scanning(), 'the local scan finished')
assert(#E:Rows('auction_snapshot') == before, 'unidentified prices never go into the outbox')
assert(E:OwnScan(nil).items[2589][4] == 100, 'the price is readable on its own character')
assert(E.AuctionTab.Lookup('2589'):find('Your scan', 1, true), 'the auction lookup displays the local price')
assert(E.ItemIdFrom('Item') == 2589, 'the local scan can be searched by item name')
assert(not E:OwnScan(nil, 'Alliance'), 'the scan is isolated to its auction house')
local player = E.CharacterKey()
EverlootDB.roster = { [player] = { realm = 'Forever' } }
assert(E.CurrentRealm() == 'Forever', 'an existing character can still look up their historical realm')
assert(not E.LiveRealm(), 'the historical value is separate from the live identity used for uploads')
UnitGUID = function() return 'Player-123-5678' end
assert(not E:OwnScan(nil), 'an alt cannot read another character’s unidentified market')
assert(not E.CurrentRealm(), 'an alt does not inherit another character’s historical realm')
GetRealmName = function() return 'New Realm' end
assert(E.CurrentRealm() == 'New Realm', 'a readable live realm wins')
""")
print("Lua 5.1 auctions: blank realm scans stay local and are isolated by character and house")

# The scan's progress, for the tab's bar: words and a fraction through the wait, the read and the second read; nothing
# between scans. Three rows read one a frame; the second row's item has not loaded until the second read.
lua = LuaRuntime()
lua.execute("""
date = function() return '2026-11-19T00:00:00Z' end
now = 1000000
time = function() return now end
print = function() end
SlashCmdList = {}
GetRealmName = function() return 'Forever' end
CreateFrame = function() return {
 RegisterEvent=function() end, SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
timers = {}
C_Timer = { After = function(seconds, f) table.insert(timers, { seconds = seconds, f = f }) end }
function step() table.remove(timers, 1).f() end
loaded = { true, false, true }
C_AuctionHouse = {
 ReplicateItems = function() end,
 GetNumReplicateItems = function() return 3 end,
 GetReplicateItemInfo = function(i)
  local ready = loaded[i]
  loaded[i] = true
  -- A row whose item has not loaded yet has no item id, and says so in its last value.
  return 'Item', nil, 1, nil, nil, nil, nil, nil, nil, 100, nil, nil, nil, nil, nil, nil, ready and 2588 + i or nil, ready
 end
}
""")
for file in ["core.lua", "modules/auctions.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute("""
Everloot.SCAN_CHUNK = 1
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, 'AUCTION_HOUSE_SHOW') end
assert(Everloot:ScanProgress() == nil, 'no progress between scans')
Everloot:StartScan()
now = now + 4
local words, fraction = Everloot:ScanProgress()
assert(words == "Waiting for the house's listings: 4 s, up to 30 s" and math.abs(fraction - 4 / 30) < 0.001, tostring(words) .. ' ' .. tostring(fraction))
timers = {}
for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, 'REPLICATE_ITEM_LIST_UPDATE') end
words, fraction = Everloot:ScanProgress()
assert(words == 'Reading 1 of 3 listings' and math.abs(fraction - 1 / 3) < 0.001, tostring(words) .. ' ' .. tostring(fraction))
step(); step()
words, fraction = Everloot:ScanProgress()
assert(words == 'Reading again 0 of 1 listings whose items had not loaded' and fraction == 0, tostring(words))
assert(timers[1].seconds == 2, 'the second read waits for the item data')
step()
assert(Everloot:ScanProgress() == nil and not Everloot:Scanning(), 'the scan reported and the progress is gone')
assert(#EverlootDB.records.auction_snapshot[1].items == 3, 'the second read got the row whose item had not loaded')
assert(EverlootDB.scanNames.Forever[2589] == 'Item' and EverlootDB.scanNames.Forever[2590] == 'Item' and EverlootDB.scanNames.Forever[2591] == 'Item', 'the names the rows carried are kept by realm, the second read included')
assert(#EverlootDB.records.auction_snapshot[1].items[1] == 5, 'a stored row keeps its five numbers: names are not uploaded')
""")
print("Lua 5.1 auctions: scan progress through the wait, the read and the second read")
