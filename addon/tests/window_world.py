"""The stub game world the window contracts share: a frame API that keeps what the window sets, the player's
own character, and fresh(), which loads the addon files in TOC order around the window. Imported by the tests,
not a test itself.
"""
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]

WORLD = """
now = 1000000
time = function() return now end
date = function() return '2026-10-30T10:00:00Z' end
printed = {}
print = function(msg) printed[#printed + 1] = tostring(msg) end
function said(pattern) for _, p in ipairs(printed) do if string.find(p, pattern) then return true end end return false end
SlashCmdList = {}
UIParent = { GetWidth = function() return 1920 end, GetHeight = function() return 1080 end }
UISpecialFrames = {}
SECRET = {}
issecretvalue = function(v) return SECRET[v] == true end

-- A frame API that accepts every call and keeps what the window sets, so a test can read it back. As in the game,
-- a named frame becomes a global and a new frame is shown until something hides it.
created = {}
failOn = nil
local Frame = {}
Frame.__index = function(self, key)
  local own = rawget(Frame, key)
  if own then return own end
  return function() end
end
local function new(kind, name, parent, template)
  local f = setmetatable({ kind = kind, frameName = name, parent = parent, template = template, scripts = {}, hooks = {}, events = {}, shown = true }, Frame)
  created[#created + 1] = f
  if name then _G[name] = f end
  return f
end
function Frame.SetScript(self, script, f) self.scripts[script] = f; if script == 'OnEvent' then self.onEvent = f end end
function Frame.HookScript(self, _, f) table.insert(self.hooks, f) end
function Frame.SetText(self, t) self.text = t end
function Frame.GetText(self) return self.text end
function Frame.Show(self) self.shown = true end
function Frame.Hide(self) self.shown = false end
function Frame.IsShown(self) return self.shown == true end
function Frame.SetTexture(self, path) self.path = path end
function Frame.SetBackdrop(self, b) self.backdrop = b end
function Frame.SetBackdropBorderColor(self, r, g, b) self.border = { r, g, b } end
function Frame.SetFont(self, path, size) self.font = path; return true end
function Frame.SetTextColor(self, r, g, b, a) self.color = { r, g, b, a } end
function Frame.SetMinMaxValues(self, lo, hi) self.lo, self.hi = lo, hi end
function Frame.SetValue(self, v) self.value = v end
function Frame.SetChecked(self, v) self.checked = v and true or false end
function Frame.GetChecked(self) return self.checked end
function Frame.RegisterEvent(self, e) self.events[e] = true end
function Frame.CreateFontString(self) return new('FontString') end
function Frame.CreateTexture(self) return new('Texture') end
CreateFrame = function(kind, name, parent, template)
  if failOn == kind then error('forced failure creating a ' .. kind) end
  return new(kind, name, parent, template)
end

-- The core frame dispatches to its OnEvent script, then to every module's hook, as the game does.
function fire(event, ...)
  local f = Everloot.frame
  f.onEvent(f, event, ...)
  for _, hook in ipairs(f.hooks) do hook(f, event, ...) end
end

money = 381240
GetMoney = function() return money end
UnitName = function() return 'Samplechar' end
UnitClass = function() return 'Shaman', 'SHAMAN' end
UnitRace = function() return 'Orc' end
UnitLevel = function() return 24 end
GetRealmName = function() return 'Forever' end
RAID_CLASS_COLORS = { SHAMAN = { r = 0, g = 0.44, b = 0.87 } }
GetProfessions = function() return 1, nil, nil, 4, 5 end
GetProfessionInfo = function(i)
  if i == 1 then return 'Mining', 'Interface\\\\Icons\\\\Trade_Mining', 112, 150 end
  if i == 4 then return 'Fishing', 'Interface\\\\Icons\\\\Trade_Fishing', 20, 75 end
  if i == 5 then return 'Cooking', 'Interface\\\\Icons\\\\INV_Misc_Food_15', 1, 75 end
end
timers = {}
C_Timer = { After = function(seconds, f) table.insert(timers, f) end }
function drain() while #timers > 0 do table.remove(timers, 1)() end end
tooltipCalls = {}
Enum = { TooltipDataType = { Item = 0 } }
TooltipDataProcessor = { AddTooltipPostCall = function(kind, f) table.insert(tooltipCalls, f) end }
function tooltipFor(itemId)
  local tip = { lines = {} }
  tip.AddLine = function(self, text, r, g, b) table.insert(self.lines, { text = text, r = r, g = g, b = b }) end
  for _, f in ipairs(tooltipCalls) do f(tip, { id = itemId }) end
  return tip.lines
end
"""

BEFORE = ["core.lua", "modules/auctions.lua", "modules/gold.lua", "modules/roster.lua", "modules/ledger.lua",
          "modules/prices.lua", "modules/drops.lua", "modules/gph.lua", "modules/options.lua"]
AFTER = ["modules/view_gold.lua", "modules/minimap.lua"]


def fresh(saved: str = "nil", api: str = "", window: bool = True):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(api)
    lua.execute(f"EverlootDB = {saved}")
    for file in BEFORE:
        lua.execute((root / file).read_text(encoding="utf-8"))
    # Every global that exists before the window's file runs; the window may add its own frame name only.
    lua.execute("globalsBefore = {}; for k in pairs(_G) do globalsBefore[k] = true end")
    if window:
        lua.execute((root / "modules" / "window.lua").read_text(encoding="utf-8"))
    for file in AFTER:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')")
    return lua
