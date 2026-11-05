"""Run with: uv run --with lupa --with jsonschema python addon/tests/options_contract.py

The settings page: registered with the Settings API when the client has it, else the older interface
options, else shown as a window by /everloot options. One switch per module and the scan prompt; a switch
with a /everloot command runs it (so off deletes rows exactly as in chat), the others set the toggle; the
boxes show the saved state; Reload now reloads.
"""
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
WORLD = """
time = function() return 1000000 end
date = function() return '2026-10-20T10:00:00Z' end
printed = {}
print = function(msg) printed[#printed + 1] = tostring(msg) end
SlashCmdList = {}
UIParent = {}
reloads = 0
ReloadUI = function() reloads = reloads + 1 end
local Frame = {}
Frame.__index = function(self, key)
  local own = rawget(Frame, key)
  if own then return own end
  return function() end
end
function Frame.SetScript(self, script, f) self.scripts[script] = f; if script == 'OnEvent' then self.onEvent = f end end
function Frame.HookScript(self, script, f) table.insert(self.hooks, f); self.hooks[script] = f end
function Frame.SetSize(self, w, h) self.width = w; self.height = h end
function Frame.SetWidth(self, w) self.width = w end
function Frame.SetHeight(self, h) self.height = h end
function Frame.GetWidth(self) return rawget(self, 'width') or 560 end
function Frame.GetHeight(self) return rawget(self, 'height') or 220 end
function Frame.SetPoint(self, point, ...) self.points = rawget(self, 'points') or {}; self.points[point] = { ... } end
function Frame.GetStringHeight(self) return 12 * math.max(1, math.ceil(#(rawget(self, 'text') or '') * 6 / (rawget(self, 'width') or 560))) end
function Frame.SetScrollChild(self, child) self.child = child end
function Frame.GetVerticalScroll(self) return rawget(self, 'offset') or 0 end
function Frame.SetVerticalScroll(self, value) self.offset = value end
function Frame.SetText(self, t) self.text = t end
function Frame.SetChecked(self, v) self.checked = v and true or false end
function Frame.GetChecked(self) return self.checked end
function Frame.Show(self) self.shown = true end
function Frame.Hide(self) self.shown = false end
function Frame.SetParent(self, p) self.parentSet = p end
function Frame.CreateFontString(self) return setmetatable({ scripts = {}, hooks = {} }, Frame) end
function Frame.RegisterEvent(self, e) self.events[e] = true end
CreateFrame = function(kind, name, parent, template)
  return setmetatable({ kind = kind, name = name, parent = parent, template = template, scripts = {}, hooks = {}, events = {} }, Frame)
end
"""


def fresh(api: str, saved: str = "nil"):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(api)
    lua.execute(f"EverlootDB = {saved}")
    for file in ["core.lua", "modules/census.lua", "modules/options.lua"]:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')")
    return lua


SETTINGS = """
registered = {}
opened = nil
Settings = {
  RegisterCanvasLayoutCategory = function(frame, name) local c = { frame = frame, name = name, ID = 42 }; function c:GetID() return self.ID end; return c end,
  RegisterAddOnCategory = function(c) registered[#registered + 1] = c end,
  OpenToCategory = function(id) opened = id end,
}
"""

# --- Modern client: the Settings API ---
lua = fresh(SETTINGS)
lua.execute("""
local O = Everloot.Options
assert(O.how == 'settings' and #registered == 1 and registered[1].name == 'Everloot' and registered[1].frame == O.page, 'the page is an AddOns category')
assert(string.find(Everloot:Status(), 'options: ready (settings', 1, true), Everloot:Status())
SlashCmdList.EVERLOOT('options')
assert(opened == 42, '/everloot options opens the category')

-- The boxes show the saved state: a new install has auctions and the census on, players off.
O.page.scripts.OnShow()
local byKey = {}
for _, box in ipairs(O.page.boxes) do byKey[box.row.key] = box end
assert(#O.page.boxes == #O.ROWS and byKey.auctions.checked and byKey.census.checked and byKey.scanPrompt.checked and not byKey.players.checked)
assert(string.find(O.page.note.text, 'Everloot ' .. Everloot.VERSION, 1, true))

-- Every switch stays reachable in a bounded viewport, including small panels and long descriptions.
local scroll = rawget(O.page, 'scroll')
assert(scroll and scroll.child, 'settings need a scrolling viewport, not controls spilling off the page')
for _, width in ipairs({ 560, 320 }) do
  scroll.width, scroll.height = width, 220
  scroll.hooks.OnSizeChanged(scroll, width, 220)
  local child = scroll.child
  local previousBottom = 0
  for _, box in ipairs(O.page.boxes) do
    local top = -box.points.TOPLEFT[4]
    assert(top >= previousBottom, 'wrapped row descriptions must not overlap the next control')
    previousBottom = top + math.max(32, 4 + box.label:GetStringHeight() + 2 + box.description:GetStringHeight())
  end
  assert(child.height >= previousBottom, 'the last description must be inside scrollable content')
  scroll.scripts.OnMouseWheel(scroll, -1000)
  assert(scroll.offset == child.height - scroll.height, 'scrolling down reaches the last settings')
  scroll.scripts.OnMouseWheel(scroll, 1000)
  assert(scroll.offset == 0, 'scrolling back reaches the first settings')
end
assert(O.page.reload.parent == O.page and O.page.reload.points.BOTTOMLEFT, 'Reload remains at the fixed panel footer')

-- A command row runs its command: census off deletes the census rows, as in chat.
EverlootDB.records.census_seen = { { guid = 'Player-1-0000000A' } }
byKey.census.checked = false
byKey.census.scripts.OnClick(byKey.census)
assert(EverlootDB.toggles.census == false and EverlootDB.records.census_seen == nil or #EverlootDB.records.census_seen == 0, 'census off from the page deletes its rows')
local said = false
for _, line in ipairs(printed) do if string.find(line, 'census off', 1, true) then said = true end end
assert(said, 'the page says what changed, like the command')
assert(string.find(O.page.note.text, 'Changes apply after a reload.', 1, true))

-- The scan prompt is a top-level setting; a module without a command sets its toggle.
byKey.scanPrompt.checked = false
byKey.scanPrompt.scripts.OnClick(byKey.scanPrompt)
assert(EverlootDB.scanPrompt == false and not byKey.scanPrompt.checked)
byKey.gold.checked = false
byKey.gold.scripts.OnClick(byKey.gold)
assert(EverlootDB.toggles.gold == false and not byKey.gold.checked)
byKey.gold.checked = true
byKey.gold.scripts.OnClick(byKey.gold)
assert(EverlootDB.toggles.gold == true)

O.page.reload.scripts.OnClick()
assert(reloads == 1, 'Reload now reloads')
""")

# --- Older client: interface options ---
lua = fresh("""
added = nil; openCalls = 0
InterfaceOptions_AddCategory = function(frame) added = frame end
InterfaceOptionsFrame_OpenToCategory = function(frame) openCalls = openCalls + 1 end
""")
lua.execute("""
local O = Everloot.Options
assert(O.how == 'interface' and added == O.page and O.page.name == 'Everloot')
SlashCmdList.EVERLOOT('options')
assert(openCalls == 2, 'the older frame is asked twice, as it needs on a first open')
""")

# --- Neither: /everloot options shows the page as a window ---
lua = fresh("")
lua.execute("""
local O = Everloot.Options
assert(O.how == 'window')
SlashCmdList.EVERLOOT('settings')
assert(O.page.shown and O.windowed and O.page.parentSet == UIParent and O.close, 'a window with a close button')
SlashCmdList.EVERLOOT('options')
assert(O.page.shown, 'opening again shows the same window')
""")

print("Lua 5.1 options: Settings API, interface options or a window; one switch per module; command rows run their command; Reload now")
