"""Run with: uv run --with lupa --with jsonschema python addon/tests/scan_prompt_contract.py

The auction house side of a scan: each scan records the player's faction and the house it read
(Alliance, Horde, or Neutral for a goblin house, from the auctioneer's faction); a one-click prompt
appears once per visit when a scan can run, never scans by itself and can be turned off; with scans
off, one hint says how to opt in.
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

-- Frames: any method a frame does not define is a no-op, so UI code runs; scripts and visibility are kept.
frames = {}
local Frame = {}
Frame.__index = function(self, key)
  local own = rawget(Frame, key)
  if own then return own end
  return function() end
end
function Frame.SetScript(self, script, f) self.scripts[script] = f; if script == 'OnEvent' then self.onEvent = f end end
function Frame.HookScript(self, _, f) table.insert(self.hooks, f) end
function Frame.SetText(self, t) self.text = t end
function Frame.SetSize(self, w, h) self.width = w; self.height = h end
function Frame.SetWidth(self, w) self.width = w end
function Frame.SetHeight(self, h) self.height = h end
function Frame.GetStringHeight(self) return 12 * math.max(1, math.ceil(#self.text * 6 / self.width)) end
function Frame.SetPoint(self, point, ...) self.points = rawget(self, 'points') or {}; self.points[point] = { ... } end
function Frame.Show(self) self.shown = true end
function Frame.Hide(self) self.shown = false end
function Frame.IsShown(self) return self.shown end
function Frame.CreateFontString(self)
  local text = setmetatable({ scripts = {}, hooks = {} }, Frame)
  self.fonts = rawget(self, 'fonts') or {}; table.insert(self.fonts, text)
  return text
end
function Frame.RegisterEvent(self, e) self.events[e] = true end
CreateFrame = function(kind, name, parent, template)
  local f = setmetatable({ kind = kind, name = name, parent = parent, template = template, scripts = {}, hooks = {}, events = {}, shown = true }, Frame)
  table.insert(frames, f)
  return f
end
function fire(event, arg1) for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, event, arg1) end end
timers = {}
C_Timer = { After = function(seconds, f) table.insert(timers, { seconds = seconds, f = f }) end }
function drain() while #timers > 0 do table.remove(timers, 1).f() end end

GetRealmName = function() return 'Forever' end
playerFaction = 'Horde'
npc = { exists = true, faction = 'Horde' }
UnitFactionGroup = function(unit)
  if unit == 'player' then return playerFaction, playerFaction end
  if unit == 'npc' then return npc.faction, npc.faction end
end
UnitExists = function(unit) return unit == 'npc' and npc.exists end

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
for file in ["core.lua", "modules/auctions.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))

# Scans off (turned off by the player): the module does not start, and the first visit says once how to opt in.
# This file loads no tab module, so the house gets the fallback Everloot scan button.
lua.execute("""
EverlootDB = { installId = 'abcd-1234', toggles = { auctions = false }, records = {} }
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
assert(EverlootDB.toggles.auctions == false, 'auction scans stay off when the player turned them off')
local hint = Everloot.auctionHintFrame
assert(hint and hint.events.AUCTION_HOUSE_SHOW, 'the hint listens for the auction house even with scans off')
printed = {}
hint.onEvent(hint, 'AUCTION_HOUSE_SHOW')
assert(said('/everloot auctions on') and said('only runs when you click'), 'the hint says how to opt in: ' .. table.concat(printed, ' | '))
printed = {}
hint.onEvent(hint, 'AUCTION_HOUSE_SHOW')
assert(#printed == 0, 'the hint is shown once per install, not every visit')
assert(replicateCalls == 0, 'the hint never scans')
""")

lua.execute("""
EverlootDB.toggles.auctions = true
Everloot:InitModules()
AuctionHouseFrame = CreateFrame('Frame', 'AuctionHouseFrame')
printed = {}
Everloot.auctionHintFrame.onEvent(nil, 'AUCTION_HOUSE_SHOW')
assert(#printed == 1 and said('Everloot tab') and said('never sellers') and said('auctions off'), 'with scans on, the first visit says once what a scan reads: ' .. table.concat(printed, ' | '))
assert(not said('/everloot auctions on'), 'with scans on there is no opt-in hint')
printed = {}
Everloot.auctionHintFrame.onEvent(nil, 'AUCTION_HOUSE_SHOW')
assert(#printed == 0, 'the notice is said once per install')

-- Opening the house: a prompt with one button, and nothing scanned until it is clicked.
fire('AUCTION_HOUSE_SHOW')
local prompt = Everloot.scanPrompt
assert(prompt and prompt.shown and prompt.parent == AuctionHouseFrame, 'the prompt shows beside the auction house')
assert(prompt.button and prompt.button.text == 'Scan prices for Everloot', 'one button says what it does')
local description = prompt.fonts[1]
assert(prompt.height >= description:GetStringHeight() + prompt.button.height + 36,
  'the prompt must fit its wrapped text, button and spacing without clipping or overlap')
assert(Everloot.scanButton.points.TOPRIGHT[2] == 'BOTTOMRIGHT',
  'the fallback scan action must stay below the house, away from Search and Filter')
assert(replicateCalls == 0, 'the prompt never scans by itself')

prompt.button.scripts.OnClick()
assert(replicateCalls == 1 and not prompt.shown, 'one click starts one scan and closes the prompt')
fire('REPLICATE_ITEM_LIST_UPDATE')
drain()
local part = EverlootDB.records.auction_snapshot[1]
assert(part.faction == 'Horde' and part.house == 'Horde', 'a scan records the faction and the house')

-- The same visit, or a new one inside the cooldown: no prompt.
fire('AUCTION_HOUSE_SHOW')
assert(not prompt.shown, 'no prompt while the cooldown runs')
fire('AUCTION_HOUSE_CLOSED')
fire('AUCTION_HOUSE_SHOW')
assert(not prompt.shown, 'no prompt on a new visit inside the cooldown')
fire('AUCTION_HOUSE_CLOSED')

-- A goblin house, after the cooldown: the auctioneer has no faction, so the house is Neutral.
now = now + 901
npc.faction = nil
fire('AUCTION_HOUSE_SHOW')
assert(prompt.shown, 'once the cooldown is over the prompt is back')
fire('AUCTION_HOUSE_SHOW')
prompt:Hide()
fire('AUCTION_HOUSE_SHOW')
assert(not prompt.shown, 'closed by the player, it stays closed for the rest of the visit')
SlashCmdList.EVERLOOT('scan')
fire('REPLICATE_ITEM_LIST_UPDATE')
drain()
local last = EverlootDB.records.auction_snapshot[#EverlootDB.records.auction_snapshot]
assert(last.house == 'Neutral' and last.faction == 'Horde', 'a goblin house is Neutral; the faction is still the player\\'s')
fire('AUCTION_HOUSE_CLOSED')

-- No auctioneer unit: the house is left out rather than guessed.
now = now + 901
npc.exists = false
playerFaction = 'Alliance'
fire('AUCTION_HOUSE_SHOW')
SlashCmdList.EVERLOOT('scan')
fire('REPLICATE_ITEM_LIST_UPDATE')
drain()
last = EverlootDB.records.auction_snapshot[#EverlootDB.records.auction_snapshot]
assert(last.house == nil and last.faction == 'Alliance', 'an unreadable house is omitted')
fire('AUCTION_HOUSE_CLOSED')

-- The prompt can be turned off; the button and the command still work.
now = now + 901
SlashCmdList.EVERLOOT('scanprompt off')
assert(EverlootDB.scanPrompt == false)
fire('AUCTION_HOUSE_SHOW')
assert(not prompt.shown, 'scanprompt off: no prompt')
local calls = replicateCalls
Everloot.scanButton.scripts.OnClick()
assert(replicateCalls == calls + 1, 'the Everloot scan button still scans on click')
fire('AUCTION_HOUSE_CLOSED')
SlashCmdList.EVERLOOT('scanprompt on')
assert(EverlootDB.scanPrompt == true)
""")

from protocol_schema import check_all  # noqa: E402
counts = check_all(lua)
assert counts.get("auction_snapshot") == 3, counts  # four scans, the newest three kept
print("Lua 5.1 scan prompt: faction and house on every scan (Neutral for a goblin house, omitted when unreadable), one prompt per visit only when a scan can run, click to scan, scanprompt off, one opt-in hint")
