"""Paid auction cycles and observed sale hours, as shown by the local ledger."""
from pathlib import Path

from lupa.lua51 import LuaRuntime

lua = LuaRuntime()
lua.execute("""
Everloot = { Readable = function(v) return v end, RegisterModule = function() end }
EverlootDB = {}
date = os.date
clock = 1795867200
time = function() return clock end
""")
lua.execute((Path(__file__).parents[1] / "modules/ledger.lua").read_text(encoding="utf-8"))
lua.execute("""
local L = Everloot.Ledger
local now = time()
local key = "main"
local function receipt(name)
  assert(L.RecordSale(key, { itemName = name, count = 20, total = 50 }))
end
local reset = now - 3 * 86400
C_DateAndTime = {
  GetWeeklyResetStartTime = function() return reset end,
  GetSecondsUntilWeeklyReset = function() return reset + 7 * 86400 - clock end,
}
clock = now - 8 * 86400
receipt("Ore")
clock = now - 4 * 86400
assert(L.RecordPending(key, "Cloth"))
clock = now - 2 * 86400
assert(L.RecordPending(key, "Cloth"))
clock = now - 86400
assert(L.RecordPending(key, "Cloth"))
receipt("Cloth")
clock = now
receipt("Cloth")
assert(L.RecordPending("alt", "Other"))
local report = L.SaleCycles({key})
assert(report.start.week == reset)
assert(report.rank.day[1].sales == 2 and report.rank.day[1].total == 100)
assert(report.rank.week[1].sales == 2 and #report.rank.week == 1)
assert(report.rank.month[2].itemName == "Ore")
assert(report.peak.hour == 12 and report.peak.notices == 3 and report.peak.days == 3)
assert(report.items.Cloth.sales.month == 2)
assert(report.items.Cloth.peak.hour == 12)
assert(not report.items.Other)
assert(EverlootDB.ledger.auctionReset.start == reset)
assert(not EverlootDB.records)
C_DateAndTime = nil
assert(L.SaleCycles({key}).start.week == reset)
clock = now + 5 * 86400
assert(L.SaleCycles({key}).start.week == nil)
""")
print("auction sales cycles: period boundaries, paid receipts, notice history and scope")
