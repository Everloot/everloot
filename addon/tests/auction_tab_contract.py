"""Run with: uv run --with lupa --with jsonschema python addon/tests/auction_tab_contract.py

The Everloot tab at the auction house: a new install has scans on and is told once what they read; the
tab sits after Blizzard's tabs without joining their tab system; its panel scans only on a click, shows
the cooldown and whether the last scan is saved for the Desktop App, shares with a /reload, looks up a
price with the tooltip's lines, and hides when a Blizzard tab is clicked or the house closes.
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
function said(pattern) for _, p in ipairs(printed) do if string.find(p, pattern, 1, true) then return true end end return false end
SlashCmdList = {}
reloads = 0
ReloadUI = function() reloads = reloads + 1 end
hooks = {}
hooksecurefunc = function(name, f) hooks[name] = f end
ChatEdit_InsertLink = function() end

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
function Frame.CreateFontString(self) return setmetatable({ scripts = {}, hooks = {}, hooked = {} }, Frame) end
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
GetItemInfo = function() return nil end
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
""")
root = Path(__file__).parents[1]
for file in ["core.lua", "modules/auctions.lua", "modules/prices.lua", "modules/auctiontab.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))

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

-- The panel: status, a scan on click, the cooldown, and the saved state.
T.tab.scripts.OnClick()
assert(T.panel.shown, 'the tab shows the panel')
assert(string.find(T.panel.status.text, 'Ready to scan.', 1, true) and string.find(T.panel.status.text, 'No scan on this realm yet.', 1, true), T.panel.status.text)
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

-- Lookup: the tooltip's lines for an id, a link, or a shift-click while the box has focus.
local box = T.panel.lookup
box:SetText('2589')
box.scripts.OnEnterPressed(box)
assert(string.find(T.panel.result.text, 'Your scan: min', 1, true), T.panel.result.text)
box:SetText('99999')
box.scripts.OnEnterPressed(box)
assert(T.panel.result.text == 'No Everloot price for that item on this realm yet.', T.panel.result.text)
box.focus = true
hooks.ChatEdit_InsertLink('|cffffffff|Hitem:765::|h[Silverleaf]|h|r')
assert(box.text == '|cffffffff|Hitem:765::|h[Silverleaf]|h|r', 'a shift-clicked item goes into the focused box')
box.focus = false

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

print("Lua 5.1 auction tab: scans on for a new install with a one-time notice, tab after Blizzard's tabs with a template fallback, click-only scan, cooldown and saved state, Share now reload, price lookup and shift-click, hidden by Blizzard tabs and on close")
