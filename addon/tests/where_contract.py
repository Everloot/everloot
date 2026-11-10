"""Local /everloot where answers: real slash routing, saved rows, no writes or fetches."""
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
lua = LuaRuntime()
lua.execute("""
printed = {}
print = function(line) printed[#printed + 1] = line end
SlashCmdList = {}
CreateFrame = function() return { RegisterEvent = function() end, SetScript = function() end } end
C_Map = { GetMapInfo = function(id) return id == 37 and {name = 'Elwynn Forest'} or nil end }
function forbidden() error('lookup must not write or fetch') end
C_ChatInfo = { SendAddonMessage = forbidden }
SendAddonMessage = forbidden
C_Item = { GetItemInfo = forbidden, RequestLoadItemDataByID = forbidden }
function serialize(v)
  if type(v) ~= 'table' then return tostring(v) end
  local out = {}
  for k, value in pairs(v) do out[#out + 1] = tostring(k) .. '=' .. serialize(value) end
  table.sort(out)
  return '{' .. table.concat(out, ',') .. '}'
end
EverlootDB = { records = {
  npc_sighting = {
    {npcId=448, name='Hogger', mapId=37, x=26.6, y=81.4},
    {npcId=448, name='Hogger', mapId=52, x=1.1, y=2.8},
    {npcId=9, name='Seller', mapId=37, x=40, y=50},
    {npcId=10, name='Hogger Jr', mapId=99, x=1, y=1},
  },
  object_sighting = {{objectId=12, name='Old Chest', mapId=37, x=10, y=20}},
  loot = {
    {sourceNpcId=448, items={{itemId=2589, count=20}, {itemId=2589, count=1}}},
    {sourceNpcId=448, items={{itemId=2589, count=2}}},
    {sourceObjectId=12, mapId=37, x=11, y=21, items={{itemId=2589, count=1}}},
    {sourceNpcId=99, items={{itemId=2589, count=1}}},
    {sourceItemId=100, items={{itemId=2589, count=1}}},
    {sourceNpcId=10, items={{itemId=100, count=1}}},
  },
  vendor = {{vendorNpcId=9, items={{itemId=2589, priceCopper=50}}}},
}, sentinel = 'unchanged' }
before = serialize(EverlootDB)
""")
lua.execute((root / "core.lua").read_text(encoding="utf-8"))
lua.execute("""
Everloot.Store = forbidden
function run(query, url)
  printed = {}
  SlashCmdList.EVERLOOT(query)
  assert(serialize(EverlootDB) == before, 'saved file changed')
  assert(printed[#printed] == 'Everloot: your own sightings only - everloot.app/' .. url, table.concat(printed, '\\n'))
  return table.concat(printed, '\\n')
end
local link = '|cffffffff|Hitem:2589::::::::|h[Linen Cloth]|h|r'
local result = run('  WhErE ' .. link .. '  ', 'database/items/2589')
assert(result:find('Drop - Hogger: Elwynn Forest (27, 81); zone 52 (1, 3) - 2 loot windows', 1, true), result)
assert(result:find('Drop - Old Chest: Elwynn Forest (10, 20); Elwynn Forest (11, 21) - 1 loot windows', 1, true), result)
assert(result:find('Drop - npc 99: location not recorded', 1, true), result)
assert(result:find('Vendor - Seller: Elwynn Forest (40, 50) - 1 vendor records', 1, true), result)
assert(result:find('Vendor', 1, true) > result:find('Drop - Old Chest', 1, true))
assert(not result:find('Hogger Jr', 1, true))
assert(run('where 2589', 'database/items/2589') == result)
result = run('where hOgGeR', 'search?q=hOgGeR')
assert(result:find('Elwynn Forest (27, 81); zone 52 (1, 3)', 1, true), result)
assert(not result:find('zone 99', 1, true))
assert(run('where 99999', 'database/items/99999'):find('nothing recorded yet', 1, true))
assert(run('where 100', 'database/items/100'):find('Hogger Jr', 1, true))
assert(run("where Nobody & Me", 'search?q=Nobody%20%26%20Me'):find('nothing recorded yet', 1, true))
assert(run('where', 'search?q='):find('/everloot where <', 1, true))
C_Map = nil
assert(run('where Hogger', 'search?q=Hogger'):find('zone 37 (27, 81)', 1, true))
EverlootDB.records.npc_sighting[1].name = 'Hog|cffff0000ger'
before = serialize(EverlootDB)
assert(run('where Hog|cffff0000ger', 'search?q=Hog%7Ccffff0000ger'):find('Hog||cffff0000ger', 1, true))
EverlootDB = nil
before = serialize(EverlootDB)
assert(run('where Hogger', 'search?q=Hogger'):find('nothing recorded yet', 1, true))
""")
print("where contract: local drops, vendors, NPC sightings, empty answers and read-only lookup PASS")
