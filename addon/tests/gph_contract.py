"""Run with: uv run --with lupa --with jsonschema python addon/tests/gph_contract.py

Gold per hour: a session counts the player's own looted items and money, quest money and vendor sales
while it runs (pauses and logouts left out), values items from the Everloot market value, else the
player's own scan, else the vendor price (saying which), takes the 5% auction cut from market and scan
values when asked, and keeps the last 50 finished sessions outside the uploaded records.
"""
from pathlib import Path
from lupa.lua51 import LuaRuntime

lua = LuaRuntime()
lua.execute("""
now = 1000000
time = function() return now end
date = function() return '2026-10-20T10:00:00Z' end
printed = {}
print = function(msg) printed[#printed + 1] = tostring(msg) end
function said(pattern) for _, p in ipairs(printed) do if string.find(p, pattern) then return true end end return false end
SlashCmdList = {}

local Frame = {}
Frame.__index = function(self, key) return rawget(Frame, key) or function() end end
function Frame.SetScript(self, script, f) self.scripts[script] = f; if script == 'OnEvent' then self.onEvent = f end end
function Frame.HookScript(self, _, f) table.insert(self.hooks, f) end
function Frame.SetText(self, t) self.text = t end
function Frame.Show(self) self.shown = true end
function Frame.Hide(self) self.shown = false end
function Frame.IsShown(self) return self.shown end
function Frame.CreateFontString(self) return setmetatable({ scripts = {}, hooks = {} }, Frame) end
CreateFrame = function(kind, name, parent)
  return setmetatable({ kind = kind, name = name, parent = parent, scripts = {}, hooks = {}, shown = false }, Frame)
end
UIParent = CreateFrame('Frame', 'UIParent')
function fire(event, ...) for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, event, ...) end end
C_Timer = { After = function(_, f) f() end }

-- The game's own strings (enUS) the tracker reads its lines with.
LOOT_ITEM_SELF = 'You receive loot: %s.'
LOOT_ITEM_SELF_MULTIPLE = 'You receive loot: %sx%d.'
LOOT_ITEM_PUSHED_SELF = 'You receive item: %s.'
GOLD_AMOUNT = '%d Gold'; SILVER_AMOUNT = '%d Silver'; COPPER_AMOUNT = '%d Copper'

money = 50000
GetMoney = function() return money end
GetRealmName = function() return 'Forever' end
UnitName = function() return 'Farmer' end
zone = 'Elwynn Forest'
GetRealZoneText = function() return zone end
function link(id, name) return '|cffffffff|Hitem:' .. id .. '::::::::60:::::|h[' .. name .. ']|h|r' end
-- name, link, quality, level, required level, type, subtype, stack, slot, icon, sell price
local sell = { [2589] = 13, [765] = 4, [2592] = 25 }
GetItemInfo = function(id)
  if not sell[id] then return nil end
  return 'Item ' .. id, link(id, 'Item ' .. id), 1, 1, 1, 'Trade Goods', 'Cloth', 20, '', 0, sell[id]
end
""")
root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\gph.lua" in toc and toc.index("modules\\prices.lua") < toc.index("modules\\gph.lua"), "gph loads after prices"
for file in ["core.lua", "modules/auctions.lua", "modules/prices.lua", "modules/gph.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute((Path(__file__).parent / "fixtures" / "EverlootPrices.lua").read_text(encoding="utf-8"))

lua.execute("""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
local G = Everloot.Gph
-- The player's own last scan: item 765 (thin on the community market) at 40 copper.
EverlootDB.records.auction_snapshot = { { scanId = 'own-1', realm = 'Forever', capturedAt = '2026-10-20T09:00:00Z', part = 1, parts = 1, items = { { 765, 1, 3, 30, 40 } } } }
EverlootDB.lastScans = { Forever = { scanId = 'own-1', at = now } }

-- Nothing counts before a session starts.
fire('CHAT_MSG_LOOT', 'You receive loot: ' .. link(2589, 'Linen Cloth') .. 'x5.')
assert(EverlootDB.gph == nil or EverlootDB.gph.current == nil)

SlashCmdList.EVERLOOT('gph start')
local s = EverlootDB.gph.current
assert(s and s.runningSince == now and s.character == 'Farmer' and s.realm == 'Forever' and s.zone == 'Elwynn Forest', 'a session starts')
assert(said('gold per hour started'))

-- Own loot only: other players' loot and items pushed into the bags are not counted.
fire('CHAT_MSG_LOOT', 'You receive loot: ' .. link(2589, 'Linen Cloth') .. 'x20.')
fire('CHAT_MSG_LOOT', 'You receive loot: ' .. link(765, 'Silverleaf') .. '.')
fire('CHAT_MSG_LOOT', 'You receive loot: ' .. link(2592, 'Wool Cloth') .. 'x2.')
fire('CHAT_MSG_LOOT', 'You receive loot: ' .. link(999, 'Unknown Thing') .. '.')
fire('CHAT_MSG_LOOT', 'Bob receives loot: ' .. link(2589, 'Linen Cloth') .. 'x5.')
fire('CHAT_MSG_LOOT', 'You receive item: ' .. link(2589, 'Linen Cloth') .. 'x3.')
assert(s.counts[2589] == 20 and s.counts[765] == 1 and s.counts[2592] == 2 and s.counts[999] == 1, 'own loot counted')

-- Money: looted (alone or shared), quests, and vendor sales apart; other income is not counted.
fire('CHAT_MSG_MONEY', 'You loot 1 Gold, 2 Silver, 3 Copper')
fire('CHAT_MSG_MONEY', 'Your share of the loot is 5 Silver.')
fire('QUEST_TURNED_IN', 123, 100, 750)
fire('MERCHANT_SHOW'); money = money + 300; fire('PLAYER_MONEY'); fire('MERCHANT_CLOSED')
money = money + 9999; fire('PLAYER_MONEY')  -- a letter, a trade: not farming income
assert(s.money.loot == 10703 and s.money.quest == 750 and s.money.vendor == 300, 'money split by source')
-- A thousands separator belongs to the number, and a Spanish client's own coin words read too.
local before = s.money.loot
fire('CHAT_MSG_MONEY', 'You loot 1,234 Gold')
assert(s.money.loot == before + 12340000, 'a thousands separator is part of the count, got ' .. (s.money.loot - before))
GOLD_AMOUNT = '%d de oro'; SILVER_AMOUNT = '%d de plata'; COPPER_AMOUNT = '%d de cobre'
fire('CHAT_MSG_MONEY', 'Recibes botin: 1.234 de oro, 5 de plata')
assert(s.money.loot == before + 12340000 + 12340500, 'Spanish words and separator, got ' .. (s.money.loot - before))
GOLD_AMOUNT = '%d Gold'; SILVER_AMOUNT = '%d Silver'; COPPER_AMOUNT = '%d Copper'
s.money.loot = before

-- Values: market (2589), the player's own scan (765, thin on the market), vendor (2592), none (999).
assert(select(2, G.Value(2589)) == 'market' and G.Value(2589) == 205)
assert(select(2, G.Value(765)) == 'scan' and G.Value(765) == 40)
assert(select(2, G.Value(2592)) == 'vendor' and G.Value(2592) == 25)
assert(select(2, G.Value(999)) == 'none' and G.Value(999) == 0)
assert(G.Value(2589, true) == 194 and G.Value(765, true) == 38 and G.Value(2592, true) == 25, 'the 5% cut is taken from market and scan values only')

now = now + 1800
local sum = G.Summary(s)
local items = 20 * 194 + 38 + 2 * 25
assert(sum.itemValue == items, 'items valued with the cut on by default: ' .. sum.itemValue)
assert(sum.total == items + 10703 + 750, 'vendor sales are not added again: ' .. sum.total)
assert(sum.seconds == 1800 and sum.perHour == sum.total * 2, 'gold per hour over the time run')
assert(sum.items[1][1] == 2589 and sum.items[1][4] == 'market', 'top items first, with their source')
assert(sum.sources.market == 1 and sum.sources.scan == 1 and sum.sources.vendor == 1 and sum.sources.none == 1)

-- The window shows the totals, the zone and the source of each top item.
SlashCmdList.EVERLOOT('gph show')
local text = table.concat(Everloot.Gph.Lines(), '\\n')
assert(text:find('Running') and text:find('0:30:00') and text:find('Elwynn Forest'), text)
assert(text:find('/ hour') and text:find('market') and text:find('your scan') and text:find('vendor'), text)
assert(text:find('Sold to vendors 3s 0c'), text)

-- Pause: time and loot stop counting; start resumes.
SlashCmdList.EVERLOOT('gph pause')
now = now + 600
fire('CHAT_MSG_LOOT', 'You receive loot: ' .. link(2589, 'Linen Cloth') .. 'x5.')
fire('CHAT_MSG_MONEY', 'You loot 7 Copper')
assert(G.Elapsed(s) == 1800 and s.counts[2589] == 20 and s.money.loot == 10703, 'nothing counts while paused')
assert(table.concat(G.Lines(), ' '):find('Paused'))
SlashCmdList.EVERLOOT('gph start')
assert(said('resumed') and s.runningSince == now)
now = now + 60

-- A reload pauses the clock and resumes the session; the time away is not counted.
fire('PLAYER_LOGOUT')
now = now + 3600
Everloot:InitModules()
assert(EverlootDB.gph.current.runningSince == now and G.Elapsed(EverlootDB.gph.current) == 1860, 'logout time is not counted')
-- A crash (no logout) leaves the session paused, never counting unknown time.
EverlootDB.gph.current.runningSince = now - 999
EverlootDB.gph.current.elapsed = 1860
Everloot:InitModules()
assert(EverlootDB.gph.current.runningSince == nil and said('paused when the game closed'))
SlashCmdList.EVERLOOT('gph start')

-- Without the coin words, money looted from an open loot window counts from the change in money.
GOLD_AMOUNT = nil
fire('LOOT_OPENED'); money = money + 77; fire('PLAYER_MONEY'); fire('LOOT_CLOSED')
assert(EverlootDB.gph.current.money.loot == 10703 + 77, 'loot-window money fallback')
GOLD_AMOUNT = '%d Gold'

-- The cut can be turned off; values then are the full prices.
SlashCmdList.EVERLOOT('gph cut off')
assert(EverlootDB.gph.cut == false and G.Value(2589, EverlootDB.gph.cut) == 205)
assert(G.Summary(EverlootDB.gph.current, EverlootDB.gph.cut).itemValue == 20 * 205 + 40 + 50)
SlashCmdList.EVERLOOT('gph cut on')

-- Stop: the session is saved with each item's value and source frozen, and the current one ends.
zone = 'Westfall'
fire('ZONE_CHANGED_NEW_AREA')
printed = {}
SlashCmdList.EVERLOOT('gph stop')
assert(EverlootDB.gph.current == nil and said('session saved') and said('nothing is uploaded'))
local saved = EverlootDB.gph.sessions[1]
assert(saved.v == 1 and saved.character == 'Farmer' and saved.realm == 'Forever' and saved.zone == 'Elwynn Forest')
assert(saved.zones[1] == 'Elwynn Forest' and saved.zones[2] == 'Westfall', 'zones visited, in order')
assert(saved.startedAt == '2026-10-20T10:00:00Z' and saved.endedAt and saved.seconds == 1860 and saved.cut == 0.05)
assert(saved.items[1].itemId == 2589 and saved.items[1].count == 20 and saved.items[1].unit == 194 and saved.items[1].source == 'market')
assert(saved.total == items + 10703 + 77 + 750 and saved.perHour == math.floor(saved.total * 3600 / 1860))
assert(saved.money.vendor == 300)

-- Reset discards; stop with no session says so.
SlashCmdList.EVERLOOT('gph start')
SlashCmdList.EVERLOOT('gph reset')
assert(EverlootDB.gph.current == nil and #EverlootDB.gph.sessions == 1, 'reset saves nothing')
printed = {}
SlashCmdList.EVERLOOT('gph stop')
assert(said('no session to stop'))

-- At most 50 sessions are kept, the newest.
for i = 1, 55 do SlashCmdList.EVERLOOT('gph start'); now = now + 10; SlashCmdList.EVERLOOT('gph stop') end
assert(#EverlootDB.gph.sessions == 50, 'history is bounded: ' .. #EverlootDB.gph.sessions)
assert(EverlootDB.gph.sessions[1].seconds == 10, 'the oldest sessions leave first')
printed = {}
SlashCmdList.EVERLOOT('gph history')
assert(#printed == 5, 'history prints the last five')

-- A session holds at most G.MAX_ITEMS distinct items.
SlashCmdList.EVERLOOT('gph start')
for id = 1, G.MAX_ITEMS + 20 do fire('CHAT_MSG_LOOT', 'You receive loot: ' .. link(id + 50000, 'X') .. '.') end
assert(EverlootDB.gph.current.distinct == G.MAX_ITEMS)
SlashCmdList.EVERLOOT('gph reset')

-- Sessions are personal: they are not records, so no uploader reads them.
assert(EverlootDB.records.gph == nil and EverlootDB.records.gph_session == nil)
""")

from protocol_schema import check_all  # noqa: E402
check_all(lua)
# Nothing in the module talks to the network or acts for the player.
source = (root / "modules" / "gph.lua").read_text(encoding="utf-8")
for forbidden in ["SendAddonMessage", "SendChatMessage", "C_ChatInfo", "UseContainerItem", "PickupContainerItem", "records"]:
    code = "\n".join(line.split("--")[0] for line in source.splitlines())
    assert forbidden not in code, f"gph.lua uses {forbidden}"
print("Lua 5.1 gold per hour: own loot and money by source, pauses and logouts left out, market > own scan > vendor values with the 5% cut, 50 sessions kept, never a record")
