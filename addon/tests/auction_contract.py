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
