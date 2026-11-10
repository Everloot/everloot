"""Run with: python addon/tests/shopping_contract.py (needs lupa)

Shopping lists (modules/shopping.lua): named lists of items with a wanted count and an optional max price per unit,
saved in this install's file only and capped (10 lists of 50 items, names of 24 characters), and trimmed to those caps
when a hand-edited file holds more. The Professions tab's what-to-buy list adds a recipe's reagents for the chosen
count. At the auction house the Everloot panel shows the active list with each item's market value and its age from
the price file, and a Search button that sends at most one browse query per press, only when the house is open, no
price scan or earlier search is waiting and the client's throttle is ready. No other auction house call is made:
nothing is posted, bid on or bought, and nothing is stored as a record or uploaded.
"""
import re
import zlib
from pathlib import Path
from lupa.lua51 import LuaRuntime
from window_world import fresh as window_fresh

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert toc.index("modules\\prices.lua") < toc.index("modules\\shopping.lua") < toc.index("modules\\auctiontab.lua"), \
    "the shopping lists load after the prices they show and before the auction house tab that shows them"

# The only auction house calls the lists make are the ones the price scan's fallback already makes.
ALLOWED = {"SendBrowseQuery", "GetBrowseResults", "IsThrottledMessageSystemReady", "HasFullBrowseResults"}
for name in ["modules/shopping.lua", "modules/auctiontab.lua", "modules/view_professions.lua"]:
    source = (root / name).read_text(encoding="utf-8")
    code = "\n".join(line.split("--")[0] for line in source.splitlines())
    used = set(re.findall(r"C_AuctionHouse\.(\w+)", code))
    assert used <= ALLOWED, f"{name} calls auction house functions beyond the search: {used - ALLOWED}"
    for word in ["E:Store", "EverlootDB.records", "PostItem", "PostCommodity", "PlaceBid", "StartCommoditiesPurchase",
                 "ConfirmCommoditiesPurchase", "CancelAuction", "SendAddonMessage"]:
        assert word not in code, f"{name}: {word} found; shopping lists only read the house and save locally"

WORLD = """
now = 1000000
time = function() return now end
today = '2026-10-20'
date = function() return today .. 'T10:00:00Z' end
printed = {}
print = function(msg) printed[#printed + 1] = tostring(msg) end
SlashCmdList = {}
hooks = {}
hooksecurefunc = function(name, f) hooks[name] = f end
ChatEdit_InsertLink = function() end
SECRET = {}
issecretvalue = function(v) return v ~= nil and SECRET[v] == true end

local Frame = {}
Frame.__index = function(self, key)
  local own = rawget(Frame, key)
  if own then return own end
  return function() end
end
function Frame.SetScript(self, script, f) self.scripts[script] = f; if script == 'OnEvent' then self.onEvent = f end end
function Frame.HookScript(self, script, f) self.hooks[#self.hooks + 1] = f; self.hooked[script] = f end
function Frame.SetText(self, t) self.text = t end
function Frame.GetText(self) return self.text end
function Frame.Show(self) self.shown = true end
function Frame.Hide(self) self.shown = false end
function Frame.IsShown(self) return self.shown end
function Frame.HasFocus(self) return self.focus end
function Frame.SetPoint(self, point, ...) self.points = rawget(self, 'points') or {}; self.points[point] = { ... } end
function Frame.SetWidth(self, w) self.width = w end
function Frame.SetSize(self, w, h) self.width, self.height = w, h end
function Frame.GetWidth(self) return rawget(self, 'width') or 0 end
function Frame.GetHeight(self) return rawget(self, 'height') or 0 end
function Frame.GetStringHeight(self) return 12 end
function Frame.GetStringWidth(self) return 6 * #tostring(rawget(self, 'text') or '') end
function Frame.SetTextColor(self, r, g, b, a) self.color = { r, g, b, a } end
function Frame.SetJustifyH(self, j) self.justifyH = j end
function Frame.GetVerticalScroll(self) return 0 end
function Frame.RegisterEvent(self, e) self.events[e] = true end
local function region() return setmetatable({ scripts = {}, hooks = {}, hooked = {}, events = {} }, Frame) end
function Frame.CreateFontString(self) return region() end
function Frame.CreateTexture(self) return region() end
CreateFrame = function(kind, name, parent, template)
  return setmetatable({ kind = kind, name = name, parent = parent, template = template, scripts = {}, hooks = {}, hooked = {}, events = {}, shown = true }, Frame)
end
timers = {}
C_Timer = { After = function(seconds, f) table.insert(timers, f) end }
function drain() while #timers > 0 do table.remove(timers, 1)() end end
function fire(event, arg1) for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, event, arg1) end end
-- The shopping module listens on its own frame.
function shopEvent(event) Everloot.Shopping.frame.onEvent(Everloot.Shopping.frame, event) end

GetRealmName = function() return 'Forever' end
UnitFactionGroup = function() return 'Horde', 'Horde' end
UnitExists = function() return false end
LINEN = '|cffffffff|Hitem:2589::|h[Linen Cloth]|h|r'
NAMES = { [2589] = 'Linen Cloth', [765] = 'Silverleaf', [2770] = 'Copper Ore' }
GetItemInfo = function(item)
  if item == 'Linen Cloth' then item = 2589 end
  local name = NAMES[item]
  if name then return name, '|cffffffff|Hitem:' .. item .. '::|h[' .. name .. ']|h|r' end
end
TooltipDataProcessor = { AddTooltipPostCall = function() end }
Enum = { TooltipDataType = { Item = 0 } }

-- The auction house as the search sees it: every field read is noted, so a test can say no other call was made.
touched, queries = {}, {}
ready = true
browse = {}
full = true
local house = {
  SendBrowseQuery = function(q) queries[#queries + 1] = q end,
  GetBrowseResults = function() return browse end,
  IsThrottledMessageSystemReady = function() return ready end,
  HasFullBrowseResults = function() return full end,
  ReplicateItems = function() end,
  GetNumReplicateItems = function() return 0 end,
}
C_AuctionHouse = setmetatable({}, { __index = function(_, k) touched[#touched + 1] = k; return house[k] end })
function touchedOnly(allowed)
  for _, k in ipairs(touched) do assert(allowed[k], 'an auction house call beyond the search: ' .. k) end
end
ALLOWED = { SendBrowseQuery = true, GetBrowseResults = true, IsThrottledMessageSystemReady = true, HasFullBrowseResults = true }

function openHouse()
  Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
  AuctionHouseFrame = CreateFrame('Frame', 'AuctionHouseFrame')
  AuctionHouseFrame.Tabs = { CreateFrame('Button', 'Buy') }
  fire('AUCTION_HOUSE_SHOW')
  local T = Everloot.AuctionTab
  T.panel.width = 784
  T.tab.scripts.OnClick()
end
function click(b) assert(b.scripts.OnClick, 'a button') b.scripts.OnClick(b) end
"""

FILES = ["core.lua", "modules/auctions.lua", "modules/prices.lua", "modules/shopping.lua", "modules/auctiontab.lua"]
STYLED = FILES + ["modules/window.lua"]


def fresh(files, saved="nil", api=""):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(api)
    lua.execute(f"EverlootDB = {saved}")
    for file in files:
        lua.execute((root / file).read_text(encoding="utf-8"))
    return lua


# --- Lists: create, rename, choose, delete; caps said in words; a hand-edited file trimmed to the caps ---
lua = fresh(FILES)
lua.execute("""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
local S = Everloot.Shopping
assert(EverlootDB.shopping == nil, 'nothing is written until the player uses a list')
assert(S.Active() == nil and #S.DB().lists == 0)
assert(S.CAPS:find('10 lists of 50 items', 1, true) and S.CAPS:find('saved file only', 1, true), S.CAPS)

local list, why = S.Create('  ')
assert(not list and why == 'Type a name for the list.', why)
local mats = S.Create('Leatherworking mats for the week ahead')
assert(mats.name == 'Leatherworking mats for' and #mats.name <= S.MAX_NAME, 'names are capped: ' .. mats.name)
assert(S.Active() == mats)
local list2, why2 = S.Create('leatherworking MATS FOR ')
assert(not list2 and why2:find('already called', 1, true), 'two lists never share a name: ' .. tostring(why2))
local raid = S.Create('Raid night')
assert(select(2, S.Active()) == 2, 'a new list becomes the active one')
assert(S.Rename('Raid consumables') and raid.name == 'Raid consumables')
assert(not S.Rename('Leatherworking mats for'), 'renaming onto another list is refused')
S.Select(3); assert(S.Active() == mats, 'choosing past the last list wraps to the first')
S.Select(0); assert(S.Active() == raid, 'and before the first to the last')
for i = 3, 10 do assert(S.Create('List ' .. i)) end
local eleventh, full = S.Create('One more')
assert(not eleventh and full:find('10 lists', 1, true) and #S.DB().lists == 10, tostring(full))
S.Select(2)
local ok, said = S.Delete()
assert(ok and said == 'Deleted Raid consumables.' and #S.DB().lists == 9 and S.Active() == mats, said)

-- Items: add, update in place, remove; counts and prices clamped; 50 items a list.
local item = S.Set(2589, 20, 250)
assert(item.itemId == 2589 and item.want == 20 and item.max == 250)
S.Set(2589, 5, nil)
assert(#mats.items == 1 and mats.items[1].want == 5 and mats.items[1].max == nil, 'adding an item again updates it')
assert(S.Set(765, 1e9, -3).want == S.MAX_WANT and mats.items[2].max == nil, 'a huge count is capped, a negative max is none')
assert(not S.Set('nope', 1), 'an item needs an id')
for id = 1000, 1047 do assert(S.Set(id, 1)) end
assert(#mats.items == 50)
local over, why3 = S.Set(99999, 1)
assert(not over and why3:find('50 items', 1, true) and #mats.items == 50, tostring(why3))
assert(S.Set(2589, 7).want == 7, 'an item already on a full list can still be changed')
assert(S.Remove(1000) and #mats.items == 49 and not S.Remove(1000))

-- What the boxes accept as a max price.
local cases = { ['1g 50s'] = 15000, ['75s'] = 7500, ['3c'] = 3, ['2'] = 20000, ['1.5'] = 15000, ['1g2s3c'] = 10203, ['10G 5S'] = 100500 }
for text, copper in pairs(cases) do assert(S.ParseMoney(text) == copper, text .. ' -> ' .. tostring(S.ParseMoney(text))) end
local none, blank = S.ParseMoney('   ')
assert(none == nil and blank == true, 'blank is no max')
for _, bad in ipairs({ 'cheap', '1x', '0', '-2', '5g lots' }) do
  local v, b = S.ParseMoney(bad)
  assert(v == nil and b == false, 'unreadable max refused: ' .. bad)
end
""")

lua = fresh(FILES, saved="""{ installId = 'x', toggles = {}, records = {}, shopping = { active = 99, lists = {
  { name = 'ok', items = { { itemId = 1, want = 0 }, { itemId = 1, want = 3 }, { itemId = 'bad' }, { itemId = 2, want = 2, max = 50, name = 'Two' } } },
  { name = '', items = {} }, 'junk',
  { name = 'big', items = (function() local t = {} for i = 1, 80 do t[i] = { itemId = i, want = 1 } end return t end)() },
  (function() local t = {} return t end)(),
} } }""")
lua.execute("""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
local S = Everloot.Shopping
local more = EverlootDB.shopping.lists
for i = 1, 15 do more[#more + 1] = { name = 'extra ' .. i, items = {} } end
local db = S.DB()
assert(#db.lists == 10, 'a hand-edited file keeps at most 10 lists: ' .. #db.lists)
assert(db.lists[1].name == 'ok' and #db.lists[1].items == 2, 'bad and repeated items are dropped')
assert(db.lists[1].items[1].want == 1 and db.lists[1].items[2].max == 50 and db.lists[1].items[2].name == 'Two')
assert(db.lists[2].name == 'big' and #db.lists[2].items == 50, 'at most 50 items a list')
assert(db.active == 10, 'an active index past the end points at the last list')
assert(EverlootDB.shopping == db, 'the trimmed lists are what is saved')
""")

# --- Add from a recipe: reagents for the chosen count, merged into the active list, unknown ids skipped ---
lua = fresh(FILES)
lua.execute("""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
local S = Everloot.Shopping
local parts = { { item = 'Copper Ore', id = 2770, count = 2 }, { item = 'Mystery Herb', count = 1, ambiguous = true },
  { item = 'Linen Cloth', id = 2589, count = 1 } }
local added, skipped, full, said = S.AddReagents(parts, 3)
assert(added == 2 and skipped == 1 and not full, said)
assert(said == 'Added 2 reagents to Shopping. 1 without a known item id was not added.', said)
local list = S.Active()
assert(list.name == 'Shopping' and list.items[1].itemId == 2770 and list.items[1].want == 6 and list.items[1].name == 'Copper Ore')
list.items[1].max = 30
S.AddReagents(parts, 1)
assert(list.items[1].want == 8 and list.items[1].max == 30, 'an item already listed wants more and keeps its max')
for id = 3000, 3047 do S.Set(id, 1) end
assert(#list.items == 50)
local a2, s2, f2, said2 = S.AddReagents({ { item = 'New', id = 4000, count = 1 }, { item = 'Linen Cloth', id = 2589, count = 1 } }, 1)
assert(a2 == 1 and s2 == 1 and f2 and said2:find('The list is full (50 items)', 1, true), said2)
""")

# --- Search: one browse query per press, only when the house is open, ready and not busy ---
lua = fresh(FILES)
lua.execute("""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
local S = Everloot.Shopping
touched = {}
assert(S.Search(2589) == false and S.message == 'Open the auction house first.' and #queries == 0, S.message)
openHouse()
touched = {}
ready = false
assert(S.Search(2589) == false and #queries == 0, 'the client throttle is respected')
assert(S.message:find('still answering an earlier search', 1, true), S.message)
ready = true
assert(S.Search(2589) == true and #queries == 1, 'one press, one query')
assert(queries[1].searchString == 'Linen Cloth' and type(queries[1].sorts) == 'table', 'searched by the item name')
assert(S.Pending() and S.message == 'Searching for Linen Cloth...', S.message)
assert(S.Search(2589) == false and S.Search(765) == false and #queries == 1, 'no second query while one waits')
assert(S.message == 'Still waiting for the last search.')
-- Results: the lowest buyout across the item's variants and how many are listed; other items that matched are not it.
browse = {
  { itemKey = { itemID = 2589, itemLevel = 5, itemSuffix = 0, battlePetSpeciesID = 0 }, minPrice = 180, totalQuantity = 30 },
  { itemKey = { itemID = 2589, itemLevel = 5, itemSuffix = 7, battlePetSpeciesID = 0 }, minPrice = 150, totalQuantity = 4 },
  { itemKey = { itemID = 2996, itemLevel = 5, itemSuffix = 0, battlePetSpeciesID = 0 }, minPrice = 1, totalQuantity = 99 },
}
shopEvent('AUCTION_HOUSE_BROWSE_RESULTS_UPDATED')
local f = S.Found(2589)
assert(f.min == 150 and f.quantity == 34 and not S.Pending(), 'lowest across variants, every unit counted')
assert(S.message == 'Linen Cloth: lowest 1s 50c each, 34 listed.', S.message)
shopEvent('AUCTION_HOUSE_BROWSE_RESULTS_UPDATED')
assert(#queries == 1, 'results never send another query')
-- An item not in the first page says where the rest are; none listed says so.
assert(S.Search(765) and #queries == 2)
full = false
shopEvent('AUCTION_HOUSE_BROWSE_RESULTS_UPDATED')
assert(S.Found(765).none and S.message:find('not in the first page', 1, true), S.message)
full = true
assert(S.Search(765) and #queries == 3)
browse = {}
shopEvent('AUCTION_HOUSE_BROWSE_RESULTS_UPDATED')
assert(S.message == 'Silverleaf: none listed with a buyout.', S.message)
-- A refused search, an unanswered one and a closed house each free the next press; none retries by itself.
assert(S.Search(2589) and #queries == 4)
shopEvent('AUCTION_HOUSE_BROWSE_FAILURE')
assert(not S.Pending() and S.message:find('refused', 1, true) and #queries == 4)
assert(S.Search(2589) and #queries == 5)
now = now + 9; assert(not S.Tick() and S.Pending())
now = now + 1; assert(S.Tick() and not S.Pending() and S.message:find('No answer', 1, true))
drain()
assert(#queries == 5, 'a timed-out search is not sent again')
assert(S.Search(2589) and #queries == 6)
fire('AUCTION_HOUSE_CLOSED'); shopEvent('AUCTION_HOUSE_CLOSED')
assert(not S.Pending())
assert(S.Search(2589) == false and #queries == 6, 'closed again')
fire('AUCTION_HOUSE_SHOW')
-- An item the client has not loaded, and a price scan in progress, are said and send nothing.
assert(S.Search(55555) == false and S.message:find('not loaded', 1, true) and #queries == 6)
assert(S.Search(55555, 'Saved Name') and queries[7].searchString == 'Saved Name', 'the saved name stands in for an unloaded item')
now = now + 20; S.Tick()
local scanning = Everloot.Scanning
Everloot.Scanning = function() return true end
assert(S.Search(2589) == false and S.message:find('price scan is running', 1, true) and #queries == 7)
Everloot.Scanning = scanning
touchedOnly(ALLOWED)
""")

# --- The panel: the list beside its prices, one search per press, no other house call ---
def panel_world(files, prices: str | None):
    lua = fresh(files)
    if prices:
        lua.execute(prices)
    lua.execute("openHouse()")
    return lua


PRICE_ROWS = "2589,205,200,190,40,2026-10-20,3;765,,30,33,900,2026-10-05,4;2770,30,25,35,80,2026-10-16,5"


def price_file(as_of: str) -> str:
    return (f"EverlootPricesDB = {{ realms = {{ forever = {{ data = '{PRICE_ROWS}', sum = {zlib.adler32(PRICE_ROWS.encode())}, "
            f"dataAsOf = '{as_of}' }} }} }}\n")


for files in (STYLED, FILES):
    lua = panel_world(files, price_file("2026-10-19T06:00:00Z"))
    lua.execute("""
local T, S = Everloot.AuctionTab, Everloot.Shopping
local p = T.panel
local shop = p.shop
assert(p.modeButton.text == 'Shopping list' and not shop.page.shown and p.lookup.shown, 'the lookup shows first')
click(p.modeButton)
assert(shop.page.shown and not p.lookup.shown and not p.results.shown and not p.scanButton.shown and not p.status.shown,
  'the shopping page covers the scan controls and the lookup')
assert(p.modeButton.text == 'Price lookup')
assert(shop.listName.text == 'No list yet' and shop.empty.shown and not shop.rows[1].shown, 'an empty start says how to begin')
assert(shop.caps.text:find('10 lists of 50 items', 1, true) and shop.caps.text:find('Nothing is uploaded, bought or posted', 1, true))
assert(shop.file.text == 'Market: price file built 2026-10-19 (1 day ago), all houses; each value\\'s age beside it.', shop.file.text)

-- Add through the boxes: an id, a count and a max price.
shop.itemBox:SetText('2589'); shop.wantBox:SetText('20'); shop.maxBox:SetText('2s 50c')
click(shop.addButton)
assert(shop.message.text == 'Saved Linen Cloth: want 20, max 2s 50c each.', shop.message.text)
assert(shop.itemBox.text == '' and shop.listName.text:find('Shopping', 1, true), 'the first item makes a list')
local r = shop.rows[1]
assert(r.shown and r.name.text == 'Linen Cloth' and r.want.text == '20', tostring(r.name.text))
assert(r.max.text == S.Money(250) and r.market.text == S.Money(205) .. ' · today', r.market.text)
assert(r.found.text == '-', 'nothing searched yet')
-- A shift-clicked item goes into the Item box while it has focus; an unpriced, stale item says so.
shop.itemBox.focus = true
hooks.ChatEdit_InsertLink('|cffffffff|Hitem:765::|h[Silverleaf]|h|r')
shop.itemBox.focus = false
assert(shop.itemBox.text == '|cffffffff|Hitem:765::|h[Silverleaf]|h|r')
click(shop.addButton)
assert(shop.rows[2].name.text == 'Silverleaf' and shop.rows[2].max.text == 'no limit' and shop.rows[2].market.text == 'no price')
shop.itemBox:SetText('2770'); click(shop.addButton)
assert(shop.rows[3].market.text == S.Money(30) .. ' · 4 d' and shop.rows[3].market.color[1] == 1 and shop.rows[3].market.color[2] == 0.4,
  'a value older than two days is in warning red: ' .. shop.rows[3].market.text)
-- Bad input is refused in words.
shop.itemBox:SetText('2589'); shop.wantBox:SetText('lots'); click(shop.addButton)
assert(shop.message.text == 'Want is a whole number of at least 1.', shop.message.text)
shop.wantBox:SetText('3'); shop.maxBox:SetText('cheap'); click(shop.addButton)
assert(shop.message.text:find('Max each reads like', 1, true), shop.message.text)
-- A row click puts the item in the boxes to change it.
click(shop.rows[1])
assert(shop.itemBox.text == 'Linen Cloth' and shop.wantBox.text == '20' and shop.maxBox.text == '2s 50c', shop.maxBox.text)

-- Search: one query per press; the result lands in the row, lit when it is within the max.
touched = {}
click(shop.rows[1].search)
assert(#queries == 1 and queries[1].searchString == 'Linen Cloth' and shop.message.text == 'Searching for Linen Cloth...')
click(shop.rows[1].search); click(shop.rows[2].search)
assert(#queries == 1, 'one search waits at a time')
browse = { { itemKey = { itemID = 2589, itemLevel = 1, itemSuffix = 0, battlePetSpeciesID = 0 }, minPrice = 240, totalQuantity = 12 } }
shopEvent('AUCTION_HOUSE_BROWSE_RESULTS_UPDATED')
assert(shop.rows[1].found.text == S.Money(240) .. ' ×12', shop.rows[1].found.text)
local accent = (Everloot.Window and Everloot.Window.COLORS.accent) or { 0.612, 0.941, 0.227, 1 }
assert(shop.rows[1].found.color[2] == accent[2], 'under the max is lit')
assert(shop.message.text == 'Linen Cloth: lowest 2s 40c each, 12 listed.', shop.message.text)
click(shop.rows[2].search)
assert(#queries == 2 and queries[2].searchString == 'Silverleaf')
now = now + 10; T.Refresh()
assert(shop.message.text:find('No answer from the auction house for Silverleaf', 1, true), 'the panel lets a silent search go')
touchedOnly(ALLOWED)

-- Remove, lists, two-press delete.
click(shop.rows[3].remove)
assert(not shop.rows[3].shown and shop.message.text == 'Removed Copper Ore.')
shop.nameBox:SetText('Alchemy'); click(shop.newButton)
assert(shop.listName.text:find('Alchemy', 1, true) and shop.listName.text:find('2 of 2', 1, true) and shop.empty.shown)
click(shop.deleteButton)
assert(shop.deleteButton.text == 'Confirm' and #S.DB().lists == 2 and shop.message.text:find('Press Confirm to delete Alchemy', 1, true))
click(shop.addButton)
assert(shop.deleteButton.text == 'Delete', 'any other button cancels the delete')
click(shop.deleteButton); click(shop.deleteButton)
assert(#S.DB().lists == 1 and shop.listName.text:find('Shopping', 1, true) and shop.rows[1].shown, shop.listName.text)
click(p.modeButton)
assert(not shop.page.shown and p.lookup.shown and p.scanButton.shown and p.modeButton.text == 'Shopping list')
""")

# Paging past ten rows, and the price file's states.
lua = panel_world(STYLED, None)
lua.execute("""
local T, S = Everloot.AuctionTab, Everloot.Shopping
local shop = T.panel.shop
for id = 1, 23 do S.Set(id, id) end
T.SetMode('shop')
assert(shop.file.text == 'Market: no price file in the game yet. The Everloot Desktop App writes it, then /reload.', shop.file.text)
assert(shop.rows[1].market.text == 'no price' and shop.rows[10].shown and not shop.up.shown and shop.down.shown)
click(shop.down); click(shop.down)
assert(shop.rows[1].want.text == '21' and shop.rows[3].shown and not shop.rows[4].shown and shop.up.shown and not shop.down.shown)
click(shop.up)
assert(shop.rows[1].want.text == '11')
""")
lua = panel_world(STYLED, price_file("2026-10-10T06:00:00Z"))
lua.execute("""
local T = Everloot.AuctionTab
T.SetMode('shop')
local file = T.panel.shop.file
assert(file.text:find('OLD FILE', 1, true) and file.text:find('10 days ago', 1, true) and file.color[2] == 0.4, file.text)
""")
# A house-keyed price file (prices.lua names the house in E:PriceFile): the line names the house, not all houses.
lua = panel_world(STYLED, price_file("2026-10-20T06:00:00Z"))
lua.execute("""
local T = Everloot.AuctionTab
local real = Everloot.PriceFile
Everloot.PriceFile = function(self, realm) local f = real(self, realm); f.house = 'Horde'; return f end
T.SetMode('shop')
assert(T.panel.shop.file.text:find('(today), Horde auction house;', 1, true), T.panel.shop.file.text)
""")

# --- Professions: Add to shopping list adds the chosen recipe's reagents for the chosen count ---
RECORDS = """{
  recipe_observed = {
    { profession = 'Mining', recipe = 'Smelt Copper', recipeId = 10, learned = true, productItemId = 2840,
      reagents = { { item = 'Copper Ore', count = 2 }, { item = 'Mystery Flux', count = 1 } } },
  },
  item_seen = { { itemId = 2770, name = 'Copper Ore' } },
}"""
API = "UnitGUID = function() return 'Player-1-0001' end\n"
lua = window_fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {RECORDS} }}", API, extra=("modules/shopping.lua",))
lua.execute("""
local U = Everloot.Window
assert(U.Open('professions') == true)
local p = EverlootWindow.professions
p.toggle.scripts.OnClick()
local c = p.craft
local b = c.buy
assert(b.add.shown and b.add.text == 'Add to shopping list', 'the what-to-buy list has the button')
b.steps[3].scripts.OnClick(); b.steps[3].scripts.OnClick()
assert(c.count == 3)
b.add.scripts.OnClick()
assert(c.note.text == 'Added 1 reagent to Shopping. 1 without a known item id was not added.', c.note.text)
assert(c.note.color[2] == U.COLORS.accent[2], 'the outcome is lit where the note was')
local list = Everloot.Shopping.Active()
assert(#list.items == 1 and list.items[1].itemId == 2770 and list.items[1].want == 6 and list.items[1].name == 'Copper Ore')
assert(not U.failed)
c.rows[1].scripts.OnClick()
assert(c.note.text:find('Value is per item', 1, true), 'choosing a recipe again brings the note back')
""")
# Without the shopping file (an older load order), the button stays hidden.
lua = window_fresh(f"{{ installId = 'abcd-1234', toggles = {{}}, records = {RECORDS} }}", API)
lua.execute("""
assert(Everloot.Window.Open('professions') == true)
local p = EverlootWindow.professions
p.toggle.scripts.OnClick()
assert(not p.craft.buy.add.shown and not Everloot.Window.failed)
""")

print("Lua 5.1 shopping lists: create, rename, choose, two-press delete; caps of 10 lists, 50 items and 24-character "
      "names, said in the UI and enforced on a hand-edited file; max price parsing; reagents added from the Professions "
      "tab for the chosen count; one browse query per press, throttle, pending, timeout, failure, scan and closed house "
      "respected, no other auction house call; market value with its age from the price file, stale and house wording")
