"""Disenchant block, eligibility, tooltip switches, local history and native view contracts."""
from pathlib import Path
import json
import zlib
from window_world import fresh

root = Path(__file__).parents[1]
api = """
UnitGUID = function() return 'Player-1-0001' end
date = os.date
now = 1794873600 + 3600
GetItemInfo = function(id)
  if id == 999 then return nil end
  return 'Item ' .. id, 'item:' .. id, id == 100 and 2 or 1, 10, 1, '', '', 1, '', 123, 20, id == 100 and 4 or 7
end
"""
lua = fresh(api=api, extra=("modules/disenchant_data.lua", "modules/disenchant.lua"))
lua.execute((root / "modules/view_disenchanting.lua").read_text(encoding="utf-8"))

def block(data, checksum=None):
    checksum = zlib.adler32(data.encode()) if checksum is None else checksum
    lua.execute(f"EverlootPricesDB = {{ disenchant = {{ data = {json.dumps(data)}, sum = {checksum}, dataAsOf = '2026-11-17T00:00:00Z' }} }}; Everloot:ResetPrices()")

lua.execute(r"""
local D, U = Everloot.Disenchant, Everloot.Window
assert(D.Band(100) == 4 and D.Band(101) == nil and D.Band(999) == nil)
Everloot.NO_DISENCHANT[100] = true
assert(D.Band(100) == nil)
Everloot.NO_DISENCHANT[100] = nil
local info = GetItemInfo
GetItemInfo = function(id)
  if id == 100 then return 'Item 100', 'item:100', 2, 4, 1, '', '', 1, '', 123, 20, 4 end
  return info(id)
end
assert(D.Band(100) == nil, 'Forever bands start at level 5')
GetItemInfo = info
assert(#D.Lines('Forever', 100) == 0, 'no disenchant block in the file: the tooltip says nothing')
assert(U.Open('disenchanting'))
assert(EverlootWindow.disenchanting.lines[1].text:find('Disenchant an item'))
assert(not U.failed)
""")
block("4,200,8,10,1600,1,3;broken;4,201,11,10,1000,1,1;4,202,2,10,200,2,1;4,203,1,10,100,1,1")
lua.execute(r"""
local E, D = Everloot, Everloot.Disenchant
local rows = D.Yields(4)
-- A band the file has no rows for (uncommon armor, item level 16 to 20): one quiet line.
local info = GetItemInfo
GetItemInfo = function(id)
  if id == 105 then return 'Item 105', 'item:105', 2, 18, 1, '', '', 1, '', 123, 20, 4 end
  return info(id)
end
assert(D.Band(105) == 5 and D.Lines('Forever', 105)[1].text == 'Disenchant: not enough data yet')
GetItemInfo = info
assert(#rows == 2 and rows[1].mean == 1.6 and rows[2].id == 203, 'bad rows ignored; zeros included in mean')
local key = E.CharacterKey()
EverlootDB.roster = { [key] = { name = 'Samplechar', realm = 'Forever' } }
local function prices(materialPrice, itemPrice)
  local data = '100,' .. itemPrice .. ',10,10,100,2026-11-17,3;200,' .. materialPrice .. ',10,10,100,2026-11-17,3;203,50,50,50,100,2026-11-17,3'
  EverlootPricesDB.realms = { ['forever|alliance'] = { data = data, sum = E.Adler32(data), dataAsOf = '2026-11-17' } }
  E:ResetPrices()
end
prices(100, 70)
assert(D.Value('Forever', { [200] = 1.6, [203] = 0.1 }) == 165)
assert(D.Value('Another realm', { [200] = 1.6 }) == 0, 'never use another realm')
local originalHouse = UnitFactionGroup
UnitFactionGroup = function() return 'Horde' end
local value, missing = D.Value('Forever', { [200] = 1.6 })
assert(value == 0 and missing, 'never use another house')
UnitFactionGroup = originalHouse
value, missing = D.Value('Forever', { [200] = 1.6, [998] = 1 })
assert(value == 160 and missing, 'an unpriced material makes the known value a floor')
local lines = D.Lines('Forever', 100)
local function joined(lines) local t = {}; for _, l in ipairs(lines) do t[#t + 1] = l.text end; return table.concat(t, '\n') end
assert(joined(lines):find('80.0%%') and joined(lines):find('1%-3 units'))
assert(joined(lines):find('Disenchant estimate is higher'))
assert(joined(lines):find('10 disenchants, at least 3 installs'))
prices(10, 70)
assert(joined(D.Lines('Forever', 100)):find('Auction estimate is higher'))
prices(1, 2)
assert(joined(D.Lines('Forever', 100)):find('Vendor value is higher'))
EverlootPricesDB.realms = nil; E:ResetPrices()
assert(joined(D.Lines('Forever', 100)):find('at least'))
assert(joined(D.Lines('Forever', 100)):find('Not enough data to compare'))
prices(100, 70)
local data = EverlootPricesDB.realms['forever|alliance'].data
EverlootPricesDB.realms['forever|alliance'].data = data:gsub('2026%-11%-17', '2026-11-01')
EverlootPricesDB.realms['forever|alliance'].sum = E.Adler32(EverlootPricesDB.realms['forever|alliance'].data)
E:ResetPrices()
assert(joined(D.Lines('Forever', 100)):find('Not enough data to compare'))
prices(100, 70)
E:InitModules()
local function hover()
  local tip = { lines = {} }
  tip.AddLine = function(self, t) self.lines[#self.lines + 1] = t end
  tip.AddDoubleLine = function(self, l, r) self.lines[#self.lines + 1] = l .. ': ' .. r end
  for _, f in ipairs(tooltipCalls) do f(tip, { id = 100 }) end
  return table.concat(tip.lines, '\n')
end
assert(hover():find('Disenchant estimate %(gross%)'))
EverlootDB.tooltipDisenchant = false
assert(not hover():find('Disenchant'))
EverlootDB.tooltipDisenchant = true; EverlootDB.tooltip = 'off'
assert(hover() == '')
EverlootDB.tooltip = 'compact'
assert(hover():find('Disenchant estimate') and not hover():find('80.0%%'))
EverlootDB.tooltip = 'full'
E.Ledger.Record(key, 'auction_spend', 60, { itemName = 'Item 100', count = 3 })
local records = #E:Rows('loot')
D.Record(100, { { itemId = 200, count = 2 }, { itemId = 200, count = 1 } }, 'source-1')
D.Record(100, { { itemId = 200, count = 3 } }, 'source-1')
assert(#D.History() == 1 and D.History()[1].mats[200] == 3 and D.History()[1].cost == 20)
assert(#E:Rows('loot') == records and EverlootDB.records.disenchantLog == nil)
E.Ledger.Record(key, 'auction_spend', 1000, { itemName = 'Item 100', count = 1 })
assert(D.History()[1].cost == 20, 'cost saved at the time, not repriced')
local summary = D.Summary(now - 86400)
assert(summary.count == 1 and summary.known == 1 and summary.cost == 20 and summary.value == 300)
Everloot.Window.Views.disenchanting.refresh(EverlootWindow)
local all = {}; for _, l in ipairs(EverlootWindow.disenchanting.lines) do all[#all + 1] = l.text end
all = table.concat(all, '\n')
assert(all:find('Today %(UTC%): 1 disenchant ·') and all:find('Last 7 days: 1 disenchant ·'))
assert(all:find('estimated difference') and all:find('Item 200'))
for i = 2, 502 do D.Record(100, { { itemId = 200, count = 1 } }, 'source-' .. i) end
assert(#D.History() == 500 and D.History()[1].source == 'source-3')
local oldKey = E.CharacterKey
E.CharacterKey = function() return 'another-character' end
assert(#D.History() == 0, 'each character has its own log')
D.Record(999, { { itemId = 998, count = 1 } })
assert(D.History()[1].cost == nil)
Everloot.Window.Views.disenchanting.refresh(EverlootWindow)
all = {}; for _, l in ipairs(EverlootWindow.disenchanting.lines) do all[#all + 1] = l.text end
all = table.concat(all, '\n')
assert(all:find('at least') and all:find('difference unknown'))
E.CharacterKey = oldKey
assert(not Everloot.Window.failed)
""")
block("4,200,1,1,1000,1,1", 1)
lua.execute("assert(Everloot.Disenchant.Yields(4) == nil); assert(Everloot.Disenchant.Lines('Forever', 100)[1].text:find('checksum'))")
print("Disenchant contracts: PASS")
