"""Run with: uv run --with lupa --with jsonschema python addon/tests/auction_tab_contract.py

The Everloot tab at the auction house: a new install has scans on and is told once what they read; the
tab sits after Blizzard's tabs without joining their tab system; its panel scans only on a click, shows
the cooldown and whether the last scan is saved for the Desktop App, shares with a /reload, and hides when
a Blizzard tab is clicked or the house closes. With the window's file loaded it wears that window's dark
panel, bronze edge and a small crest heading; without it, the game's own dialog look.

The price lookup shows the tooltip's own lines, never text re-read for numbers: a label and its value on one
row where a line has both, the line's text otherwise, each in the line's colour. Every row stays inside a
scrolling area above the footer, at the panel's full width or a narrow one, so a long label or warning
wraps instead of running into a value. A price that is missing, still being checked or behind a failed
checksum is said in words, never shown as a number.
"""
from pathlib import Path
from lupa.lua51 import LuaRuntime

WORLD = """
now = 1000000
time = function() return now end
date = function() return '2026-10-20T10:00:00Z' end
printed = {}
print = function(msg) printed[#printed + 1] = tostring(msg) end
function said(pattern) for _, p in ipairs(printed) do if string.find(p, pattern, 1, true) then return true end end return false end
SlashCmdList = {}
reloads = 0
ReloadUI = function() reloads = reloads + 1 end
hooks = {}
hooksecurefunc = function(name, f) hooks[name] = f end
ChatEdit_InsertLink = function() end
SECRET = {}
issecretvalue = function(v) return v ~= nil and SECRET[v] == true end

-- What a font string measures: six pixels a character and twelve a line, a texture two characters, colour codes
-- and link wrappers nothing; it wraps at its width when it has one.
local function visible(t)
  t = tostring(t or '')
  t = t:gsub('|T.-|t', 'XX')
  t = t:gsub('|c%x%x%x%x%x%x%x%x', ''):gsub('|r', ''):gsub('|H.-|h', ''):gsub('|h', '')
  return t
end

frames = {}
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
function Frame.SetHeight(self, h) self.height = h end
function Frame.SetSize(self, w, h) self.width, self.height = w, h end
function Frame.GetWidth(self) return rawget(self, 'width') or 0 end
function Frame.GetHeight(self) return rawget(self, 'height') or 0 end
function Frame.GetUnboundedStringWidth(self) return 6 * #visible(rawget(self, 'text')) end
function Frame.GetStringWidth(self)
  local n, w = 6 * #visible(rawget(self, 'text')), rawget(self, 'width')
  return (w and w > 0) and math.min(n, w) or n
end
function Frame.GetStringHeight(self)
  local n, w = 6 * #visible(rawget(self, 'text')), rawget(self, 'width')
  return 12 * ((w and w > 0) and math.max(1, math.ceil(n / w)) or 1)
end
function Frame.SetFont(self, path, size) self.font, self.size = path, size; return true end
function Frame.SetTextColor(self, r, g, b, a) self.color = { r, g, b, a } end
function Frame.SetJustifyH(self, j) self.justifyH = j end
function Frame.SetTexture(self, path) self.path = path end
function Frame.SetColorTexture(self, r, g, b, a) self.colorTexture = { r, g, b, a } end
function Frame.SetBackdrop(self, b) self.backdrop = b end
function Frame.SetBackdropColor(self, r, g, b, a) self.bg = { r, g, b, a } end
function Frame.SetBackdropBorderColor(self, r, g, b, a) self.border = { r, g, b, a } end
function Frame.SetScrollChild(self, child) self.child = child end
function Frame.GetVerticalScroll(self) return rawget(self, 'offset') or 0 end
function Frame.SetVerticalScroll(self, v) self.offset = v end
local function region() return setmetatable({ scripts = {}, hooks = {}, hooked = {} }, Frame) end
function Frame.CreateFontString(self, _, _, template) local s = region(); s.template = template; return s end
function Frame.CreateTexture(self) local t = region(); self.textures = rawget(self, 'textures') or {}; table.insert(self.textures, t); return t end
function Frame.RegisterEvent(self, e) self.events[e] = true end
rejected = { PanelTabButtonTemplate = true }
CreateFrame = function(kind, name, parent, template)
  if template and rejected[template] then error('unknown template ' .. template) end
  local f = setmetatable({ kind = kind, name = name, parent = parent, template = template, scripts = {}, hooks = {}, hooked = {}, events = {}, shown = true }, Frame)
  table.insert(frames, f)
  return f
end
timers = {}
C_Timer = { After = function(seconds, f) table.insert(timers, { seconds = seconds, f = f }) end }
function drain() while #timers > 0 do table.remove(timers, 1).f() end end
function fire(event, arg1) for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, event, arg1) end end

GetRealmName = function() return 'Forever' end
UnitFactionGroup = function() return 'Horde', 'Horde' end
UnitExists = function() return false end
LINEN = '|cffffffff|Hitem:2589::|h[Linen Cloth]|h|r'
GetItemInfo = function(item) if item == 2589 or item == 'Linen Cloth' then return 'Linen Cloth', LINEN end end
TooltipDataProcessor = { AddTooltipPostCall = function() end }
Enum = { TooltipDataType = { Item = 0 } }

rows = { { 2589, 20, 2000 }, { 765, 5, 500 } }
replicateCalls = 0
C_AuctionHouse = {
  ReplicateItems = function() replicateCalls = replicateCalls + 1 end,
  GetNumReplicateItems = function() return #rows end,
  GetReplicateItemInfo = function(i)
    local r = rows[i]
    return nil, 1, r[2], 1, true, 1, 0, 0, 0, r[3], 0, false, nil, nil, nil, 0, r[1], true
  end,
}

-- The house opens on a loaded addon; the panel's anchors on the house make it 784 wide, its results 200 high.
function openHouse()
  Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
  blizzardTabs = { CreateFrame('Button', 'Buy'), CreateFrame('Button', 'Sell'), CreateFrame('Button', 'Auctions') }
  AuctionHouseFrame = CreateFrame('Frame', 'AuctionHouseFrame')
  AuctionHouseFrame.Tabs = blizzardTabs
  fire('AUCTION_HOUSE_SHOW')
end
function showPanel()
  local T = Everloot.AuctionTab
  T.panel.width = 784
  T.tab.scripts.OnClick()
  T.panel.results.height = 200
end

function lookup(text)
  local box = Everloot.AuctionTab.panel.lookup
  box:SetText(text)
  box.scripts.OnEnterPressed(box)
end

local function pair(line)
  return type(line.left) == 'string' and line.left ~= '' and type(line.right) == 'string' and line.right ~= ''
end

-- The rows on screen now: { pair = true, label, value } or { text }, each with its colour. Rows a longer earlier
-- result needed stay hidden.
function shown()
  local p = Everloot.AuctionTab.panel
  local out = {}
  for i = 1, p.used do
    local row = p.rows[i]
    assert(row.label.shown == row.value.shown and row.note.shown ~= row.value.shown, 'a row is a label and value or one line of text')
    if row.value.shown then
      out[i] = { pair = true, label = row.label.text, value = row.value.text, color = row.label.color, valueColor = row.value.color }
    else
      out[i] = { text = row.note.text, color = row.note.color }
    end
  end
  for i = p.used + 1, #p.rows do
    local row = p.rows[i]
    assert(not row.label.shown and not row.value.shown and not row.note.shown, 'a row from an earlier, longer result is hidden')
  end
  return out
end

-- Everything the rows say, as one string, for scope and warning words wherever a line keeps them.
function shownText()
  local parts = {}
  for _, row in ipairs(shown()) do parts[#parts + 1] = row.pair and (row.label .. ' ' .. row.value) or row.text end
  return table.concat(parts, '\\n')
end

-- The rows say exactly what the price lines say, in order, in each line's colour; `skip` rows come first.
function sameAsLines(lines, skip)
  skip = skip or 0
  local rows = shown()
  assert(#rows == #lines + skip, 'one row per price line: ' .. #rows .. ' rows for ' .. #lines .. ' lines')
  for i, line in ipairs(lines) do
    local row = rows[i + skip]
    if pair(line) then
      assert(row.pair and row.label == line.left and row.value == line.right, 'a label and its value: ' .. tostring(line.text))
      assert(row.valueColor[1] == 1 and row.valueColor[2] == 1 and row.valueColor[3] == 1, 'amounts in white, as the tooltip writes them')
    else
      assert(not row.pair and row.text == line.text, 'a line without both parts shows its text: ' .. tostring(line.text))
    end
    assert(row.color[1] == line.r and row.color[2] == line.g and row.color[3] == line.b, 'each row keeps its line colour')
  end
end

-- Nothing in the results overlaps: the item or message, then each row below the one before; a label and its value
-- share a row and never touch; all of it inside the results column and the scrolling content.
function checkLayout()
  local p = Everloot.AuctionTab.panel
  local content, column = p.results.child, p.results.width
  assert(column and column > 0 and content.width == column, 'the content is as wide as the results column')
  local bottom = 0
  local function below(fs)
    local at = fs.points.TOPLEFT
    assert(at[1] == content, 'rows live in the scrolling content')
    local top = -at[4]
    assert(top >= bottom, 'rows never overlap: ' .. tostring(fs.text))
    assert(at[3] >= 0 and at[3] + fs.width <= column, 'text stays inside the results column: ' .. tostring(fs.text))
    return top
  end
  local head = p.message.shown and p.message or p.item
  assert(head.shown and not (p.message.shown and p.item.shown), 'an item heading or a message, not both')
  local top = below(head)
  bottom = top + head:GetStringHeight()
  if p.unit.shown then
    local right = p.unit.points.TOPRIGHT
    assert(p.item.shown and right[1] == content and -right[4] == top, 'per unit shares the heading row')
    assert(p.item.points.TOPLEFT[3] + p.item.width < right[3] - p.unit.width, 'the heading never runs into per unit')
    bottom = math.max(bottom, top + p.unit:GetStringHeight())
  end
  for i = 1, p.used do
    local row = p.rows[i]
    if row.value.shown then
      local top = below(row.label)
      local right = row.value.points.TOPRIGHT
      assert(right[1] == content and -right[4] == top, 'a label and its value share one row')
      assert(row.label.points.TOPLEFT[3] + row.label.width < right[3] - row.value.width, 'a label never runs into its value')
      assert(right[3] <= column and row.value.justifyH == 'RIGHT', 'values line up on the right edge of the column')
      bottom = top + math.max(row.label:GetStringHeight(), row.value:GetStringHeight())
    else
      bottom = below(row.note) + row.note:GetStringHeight()
    end
  end
  assert(content.height >= bottom, 'the last row is inside the scrolling content')
end

function checkScroll()
  local p = Everloot.AuctionTab.panel
  local scroll, content = p.results, p.results.child
  scroll.scripts.OnMouseWheel(scroll, -1000)
  assert(scroll.offset == math.max(0, content.height - scroll.height), 'scrolling down reaches the last row')
  scroll.scripts.OnMouseWheel(scroll, 1000)
  assert(scroll.offset == 0, 'scrolling back reaches the first row')
end

-- Price lines as the tooltip may give them: aligned pairs, plain lines, a long warning, a long localised label,
-- native coin textures and a line with a label but no value.
LONG = 'Precio de mercado de la comunidad en todas las casas de subastas del reino, por unidad'
STALE = '  STALE: newest public day 2026-10-01 is 19 days old; the Everloot Desktop App refreshes it, then /reload'
STUB = {
  { text = 'Everloot market 2s 5c · per unit · Alliance house', left = 'Everloot market · per unit · Alliance house',
    right = '2|TInterface\\\\MoneyFrame\\\\UI-SilverIcon:0:0:2:0|t 5|TInterface\\\\MoneyFrame\\\\UI-CopperIcon:0:0:2:0|t', r = 0.9, g = 0.8, b = 0.5 },
  { text = '  min 2s 0c', left = '  min', right = '2s 0c', r = 0.9, g = 0.8, b = 0.5 },
  { text = '  40 up · 3 reporters · 2026-10-20', r = 0.6, g = 0.6, b = 0.6 },
  { text = STALE, r = 1, g = 0.4, b = 0.4 },
  { text = LONG .. ' 12g 34s 56c', left = LONG, right = '12g 34s 56c', r = 0.9, g = 0.8, b = 0.5 },
  { text = 'Your scan: min 1s 0c', left = 'Your scan: min', right = '1s 0c', r = 0.6, g = 0.8, b = 1 },
  { text = 'A label without a value', left = 'A label without a value', r = 1, g = 1, b = 1 },
}
"""

root = Path(__file__).parents[1]
BASE = ["core.lua", "modules/auctions.lua", "modules/prices.lua", "modules/auctiontab.lua"]
STYLED = BASE + ["modules/window.lua"]  # the TOC loads the window's file after the tab's


def fresh(files, api: str = ""):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(api)
    for file in files:
        lua.execute((root / file).read_text(encoding="utf-8"))
    return lua


lua = fresh(STYLED)
lua.execute("""
-- A new install: scans on, and the first visit says once what they read.
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
assert(EverlootDB.toggles.auctions == true, 'a new install starts with auction scans on')
blizzardTabs = { CreateFrame('Button', 'Buy'), CreateFrame('Button', 'Sell'), CreateFrame('Button', 'Auctions') }
AuctionHouseFrame = CreateFrame('Frame', 'AuctionHouseFrame')
AuctionHouseFrame.Tabs = blizzardTabs
printed = {}
Everloot.auctionHintFrame.onEvent(nil, 'AUCTION_HOUSE_SHOW')
assert(said('Everloot tab') and said('never sellers') and said('/everloot auctions off'), table.concat(printed, ' | '))
fire('AUCTION_HOUSE_SHOW')

-- The tab: after Blizzard's tabs, a fallback template when theirs is missing, no fallback button.
local T = Everloot.AuctionTab
assert(T.tab and T.tab.text == 'Everloot' and T.tab.parent == AuctionHouseFrame, 'the Everloot tab is on the house')
assert(T.tab.template == 'CharacterFrameTabButtonTemplate', 'a missing tab template falls back to the next one')
assert(Everloot.scanButton == nil, 'with the tab there is no separate scan button')
for _, tab in ipairs(blizzardTabs) do assert(tab.hooked.OnClick, 'each Blizzard tab hides the panel') end
assert(T.panel and not T.panel.shown, 'the panel starts hidden')
assert(replicateCalls == 0, 'opening the house never scans')

-- The look: the Everloot window's flat dark panel and bronze tooltip edge, a small crest and Everloot in fel green.
local p = T.panel
assert(p.backdrop and p.backdrop.bgFile == 'Interface\\\\Buttons\\\\WHITE8X8' and p.backdrop.edgeFile == 'Interface\\\\Tooltips\\\\UI-Tooltip-Border', 'the window backdrop')
assert(p.bg[1] < 0.1 and p.border[1] > p.border[3], 'dark inside a bronze edge')
assert(p.crest and p.crest.path == 'Interface\\\\AddOns\\\\Everloot\\\\media\\\\crest' and p.crest.width <= 32, 'a modest crest heads the panel')
assert(p.title.text == 'Everloot' and p.title.color[2] > 0.9 and p.title.color[1] < 0.7 and p.title.color[3] < 0.3, 'Everloot in fel green')
assert(Everloot.Window.frame == nil, 'the panel borrows the look without building the Everloot window')
assert(p.results.textures and p.results.textures[1].colorTexture[1] < 0.1, 'the results sit on a surface panel')

-- The panel: status, a scan on click, the cooldown, and the saved state.
showPanel()
assert(T.panel.shown, 'the tab shows the panel')
assert(string.find(T.panel.status.text, 'Ready to scan.', 1, true) and string.find(T.panel.status.text, 'No scan on this realm yet.', 1, true), T.panel.status.text)
assert(p.message.shown and p.message.text == "Type an item's name or id, or shift-click an item here." and p.used == 0, 'the lookup starts with how to use it')
T.panel.scanButton.scripts.OnClick()
assert(replicateCalls == 1, 'Scan this house starts one scan')
assert(string.find(T.panel.status.text, 'Scanning', 1, true), T.panel.status.text)
fire('REPLICATE_ITEM_LIST_UPDATE')
drain()
now = now + 125
T.Refresh()
local status = T.panel.status.text
assert(string.find(status, 'Next scan in 12:55.', 1, true), status)
assert(string.find(status, 'Last scan on this realm: 2 items, 2 min ago.', 1, true), status)
assert(string.find(status, 'Not saved yet', 1, true), 'a scan from this session is not in the saved file yet')
T.panel.scanButton.scripts.OnClick()
assert(replicateCalls == 1, 'no second scan inside the cooldown')

-- Lookup by id: the tooltip's own lines, one row each, under the item and the realm they are for.
lookup('2589')
local lines = Everloot.PriceLines('Forever', 2589)
assert(#lines >= 1, 'the player scanned this item')
sameAsLines(lines)
assert(p.item.shown and p.item.text:find(LINEN, 1, true) and p.item.text:find('Forever', 1, true), 'the result names the item and the realm: ' .. p.item.text)
assert(p.unit.shown and p.unit.text == 'per unit', 'every amount is per unit, said once beside the heading as in the tooltip')
assert(p.item.template == 'GameFontNormal' and rawget(p.item, 'font') == nil,
  "the client's own item and realm names keep the game's font object, which draws every alphabet it shows")
assert(shownText():find('Your scan', 1, true), 'the player\\'s own scan is shown: ' .. shownText())
checkLayout()
local plain = {}
for i, line in ipairs(lines) do plain[i] = line.text end
assert(T.Lookup('2589') == table.concat(plain, '\\n'), 'T.Lookup still gives the plain lines: ' .. T.Lookup('2589'))
-- A loaded item's name works; an item nobody priced, or nothing typed, says so.
lookup('Linen Cloth')
sameAsLines(lines)
lookup('99999')
assert(p.message.shown and p.message.text:find('No Everloot price file in the game yet:', 1, true) and p.used == 0 and not p.item.shown, p.message.text)
assert(not p.unit.shown, 'no amounts, no unit')
assert(T.Lookup('99999'):find('No Everloot price file in the game yet:', 1, true))
lookup('')
assert(p.message.text == "Type an item's name or id, or shift-click an item here.", p.message.text)

-- A shift-clicked item goes into the box while it has focus.
local box = T.panel.lookup
box.focus = true
hooks.ChatEdit_InsertLink('|cffffffff|Hitem:765::|h[Silverleaf]|h|r')
assert(box.text == '|cffffffff|Hitem:765::|h[Silverleaf]|h|r', 'a shift-clicked item goes into the focused box')
box.focus = false

-- The companion's community prices: the same rows as the tooltip, with their scope and their age.
""")
lua.execute((root / "tests" / "fixtures" / "EverlootPrices.lua").read_text(encoding="utf-8"))
lua.execute("""
local T, p = Everloot.AuctionTab, Everloot.AuctionTab.panel
Everloot:ResetPrices()
lookup('2589')
sameAsLines((Everloot.PriceLines('Forever', 2589)))
-- A Horde character at a Horde auctioneer: the Horde house's price, named; never the Alliance price of the same realm.
assert(shownText():find('Horde house', 1, true) and not shownText():find('Alliance', 1, true), 'a community price names its house: ' .. shownText())
assert(shownText():find('Your scan', 1, true), 'the player\\'s own scan is still there: ' .. shownText())
checkLayout()
lookup('765')
sameAsLines((Everloot.PriceLines('Forever', 765)))
assert(shownText():find('unrecorded', 1, true) and shownText():find('STALE', 1, true), 'an unrecorded, stale price says both: ' .. shownText())
checkLayout()

-- Aligned rows from the shared lines: label left, value right, the fallback text, each line's colour, the window's fonts.
local real = Everloot.PriceLines
Everloot.PriceLines = function() return STUB, { status = 'ready' } end
lookup('2589')
sameAsLines(STUB)
checkLayout()
for i = 1, p.used do
  local row = p.rows[i]
  if row.value.shown then assert(row.label.font:find('FRIZQT', 1, true) and row.value.font:find('ARIALN', 1, true), 'Friz labels, Arial Narrow values') end
end
assert(p.rows[5].label:GetStringHeight() > 12 and p.rows[5].value:GetStringHeight() == 12, 'a long label wraps beside its value, which stays on one line')
assert(p.rows[4].note:GetStringHeight() > 12, 'a long warning wraps inside the column')

-- A narrow panel: the column narrows, labels wrap, values keep their edge, nothing collides.
p.hooked.OnSizeChanged(p, 280, 450)
assert(p.results.width <= 280 - 32, 'the results fit a narrow panel: ' .. p.results.width)
assert(p.scanButton.width + 8 + p.shareButton.width <= p.results.width,
  'both scan controls fit the same narrow column as the price rows')
assert(p.status.width == p.results.width and p.intro.width == p.results.width, 'status and introduction wrap to the same column')
sameAsLines(STUB)
checkLayout()
p.hooked.OnSizeChanged(p, 784, 450)
checkLayout()

-- Long results scroll inside their area above the footer; a new lookup starts at the top.
local bottom = p.results.points.BOTTOMLEFT
assert(bottom[1] == p.footer and bottom[2] == 'TOPLEFT' and bottom[4] >= 4, 'the results end above the footer, however many lines it wraps to')
assert(p.footer.points.BOTTOMLEFT[1] == p and p.footer.width == p.width - 32, 'the footer spans the panel')
p.results.height = 60
checkScroll()
p.results.scripts.OnMouseWheel(p.results, -1000)
assert(p.results.offset > 0)
lookup('2589')
assert(p.results.offset == 0, 'a new result starts at its top')
local many = {}
for i = 1, 40 do many[i] = { text = 'line ' .. i, left = 'Label ' .. i, right = i .. 'c', r = 1, g = 1, b = 1 } end
Everloot.PriceLines = function() return many, { status = 'ready' } end
lookup('2589')
assert(p.used == 40)
sameAsLines(many)
checkLayout()
checkScroll()
Everloot.PriceLines = function() return { many[1] }, { status = 'ready' } end
lookup('2589')
sameAsLines({ many[1] })
p.results.height = 200
-- Lines with no amount (an older reader's plain lines) show as text, and the heading claims no unit.
local plainLines = { { text = 'Everloot market 2s 5c · per unit · Alliance house', r = 0.9, g = 0.8, b = 0.5 } }
Everloot.PriceLines = function() return plainLines, { status = 'ready' } end
lookup('2589')
sameAsLines(plainLines)
assert(p.item.shown and not p.unit.shown, 'plain lines carry their own words')
checkLayout()

-- Missing prices are said, never shown as numbers: still checking, a failed checksum, a full file, none yet.
local function says(lines, entry, words)
  Everloot.PriceLines = function() return lines, entry end
  lookup('2589')
  return p.message.shown and p.used == 0 and not p.item.shown and p.message.text:find(words, 1, true) ~= nil
end
assert(says({}, { status = 'verifying' }, 'still being checked'), p.message.text)
assert(says({}, { status = 'bad' }, 'failed their checksum'), p.message.text)
assert(says({}, { status = 'bad', silent = true }, 'has no data for Forever yet:'), p.message.text)
local file = EverlootPricesDB
EverlootPricesDB = nil
assert(says({}, { status = 'bad', silent = true }, 'No Everloot price file in the game yet:'), p.message.text)
EverlootPricesDB = file
assert(says({}, { status = 'ready', full = true }, '2,000 items'), p.message.text)
assert(says({}, { status = 'ready' }, 'no public day (3 reporters) and no scan of your own'), p.message.text)
-- The player's own scan still shows behind a failed checksum, which is said first.
local own = { { text = 'Your scan: min 1s 0c', left = 'Your scan: min', right = '1s 0c', r = 0.6, g = 0.8, b = 1 } }
Everloot.PriceLines = function() return own, { status = 'bad' } end
lookup('2589')
local first = shown()[1]
assert(not first.pair and first.text:find('failed their checksum', 1, true), 'the failed checksum comes first: ' .. tostring(first.text))
sameAsLines(own, 1)
checkLayout()
assert(T.Lookup('2589'):find('failed their checksum', 1, true) and T.Lookup('2589'):find('Your scan: min 1s 0c', 1, true), T.Lookup('2589'))
Everloot.PriceLines = function() return own, { status = 'verifying' } end
lookup('2589')
assert(shown()[1].text:find('still being checked', 1, true), 'community prices still being checked are said beside an own scan')
sameAsLines(own, 1)
Everloot.PriceLines = real

-- A realm name or item link the client will not let the addon read is missing, never an error.
SECRET.Forever = true
lookup('2589')
assert(p.message.text == 'No Everloot price for that item on this realm yet.', p.message.text)
assert(T.StatusLines()[2] == 'No scan on this realm yet.')
SECRET.Forever = nil
SECRET[LINEN] = true
lookup('2589')
assert(p.item.text:find('Item 2589', 1, true) and not p.item.text:find('Linen', 1, true), p.item.text)
SECRET[LINEN] = nil

-- Share now is a /reload; a Blizzard tab and closing the house hide the panel.
T.panel.shareButton.scripts.OnClick()
assert(reloads == 1, 'Share now reloads the UI so the file is written')
blizzardTabs[2].hooked.OnClick()
assert(not T.panel.shown, 'a Blizzard tab hides the panel')
T.tab.scripts.OnClick()
fire('AUCTION_HOUSE_CLOSED')
assert(not T.panel.shown, 'closing the house hides the panel')
local before = #frames
fire('AUCTION_HOUSE_SHOW')
assert(#frames == before, 'reopening the house builds nothing new')

-- A scan from before this load is in the saved file, so the Desktop App can send it.
EverlootDB.lastScans.Forever.at = 999000
Everloot.ownScanCache = nil
T.Refresh()
assert(string.find(T.panel.status.text, 'Saved in your file', 1, true), T.panel.status.text)
""")

# --- Without the window's file (an older install): the game's dialog look, the same rows ---
lua = fresh(BASE)
lua.execute("""
openHouse()
local T = Everloot.AuctionTab
assert(T.tab and T.panel and not T.failed, 'the tab builds without the window file')
local p = T.panel
assert(p.backdrop.bgFile == 'Interface\\\\DialogFrame\\\\UI-DialogBox-Background', 'the game\\'s own dialog background')
assert(p.title.text == 'Everloot' and rawget(p, 'crest') == nil, "the game's own heading")
showPanel()
Everloot.PriceLines = function() return STUB, { status = 'ready' } end
lookup('2589')
sameAsLines(STUB)
checkLayout()
checkScroll()
""")

# --- A client without the scroll frame template: a plain scroll frame, still scrolled by the wheel ---
lua = fresh(STYLED, "rejected.UIPanelScrollFrameTemplate = true")
lua.execute("""
openHouse()
local T = Everloot.AuctionTab
assert(T.tab and not T.failed and T.panel.results.kind == 'ScrollFrame' and rawget(T.panel.results, 'template') == nil, 'a plain scroll frame')
showPanel()
Everloot.PriceLines = function() return STUB, { status = 'ready' } end
lookup('2589')
sameAsLines(STUB)
T.panel.results.height = 40
checkLayout()
checkScroll()
""")

print("Lua 5.1 auction tab: scans on for a new install with a one-time notice, tab after Blizzard's tabs with a template fallback, click-only scan, cooldown and saved state, Share now reload; the window's look or the game's; price lookup rows from the tooltip's lines aligned label to value, fallback text, scope and stale words, missing, checking and checksum states, narrow and long results scrolled above the footer; shift-click; hidden by Blizzard tabs and on close")
