"""Run with: uv run --with lupa --with jsonschema python addon/tests/options_contract.py

The settings page: registered with the Settings API when the client has it, else the older interface
options, else shown as a window by /everloot options. One switch per module and the scan prompt; a switch
with a /everloot command runs it (so off deletes rows exactly as in chat), the others set the toggle; the
boxes show the saved state; Reload now reloads. Every switch stays reachable in a scrolling list above the
footer at any width. With the window's file loaded the page wears that window's look (a small crest heading,
its fonts, the switches on a surface panel, its dark window when shown on its own) without building the
window; without that file it keeps the game's own fonts and dialog.
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
function Frame.GetText(self) return rawget(self, 'text') end
function Frame.SetChecked(self, v) self.checked = v and true or false end
function Frame.GetChecked(self) return self.checked end
function Frame.Show(self) self.shown = true end
function Frame.Hide(self) self.shown = false end
function Frame.SetParent(self, p) self.parentSet = p end
function Frame.SetFont(self, path, size) self.font, self.size = path, size; return true end
function Frame.SetTextColor(self, r, g, b, a) self.color = { r, g, b, a } end
function Frame.SetTexture(self, path) self.path = path end
function Frame.SetColorTexture(self, r, g, b, a) self.colorTexture = { r, g, b, a } end
function Frame.SetBackdrop(self, b) self.backdrop = b end
function Frame.SetBackdropColor(self, r, g, b, a) self.bg = { r, g, b, a } end
function Frame.SetBackdropBorderColor(self, r, g, b, a) self.border = { r, g, b, a } end
function Frame.CreateFontString(self) return setmetatable({ scripts = {}, hooks = {} }, Frame) end
function Frame.CreateTexture(self)
  local t = setmetatable({ scripts = {}, hooks = {} }, Frame)
  self.textures = rawget(self, 'textures') or {}
  table.insert(self.textures, t)
  return t
end
function Frame.RegisterEvent(self, e) self.events[e] = true end
CreateFrame = function(kind, name, parent, template)
  return setmetatable({ kind = kind, name = name, parent = parent, template = template, scripts = {}, hooks = {}, events = {} }, Frame)
end

-- Every switch stays reachable in a bounded viewport, including small panels and long descriptions.
function checkRows(page)
  local scroll = rawget(page, 'scroll')
  assert(scroll and scroll.child, 'settings need a scrolling viewport, not controls spilling off the page')
  for _, width in ipairs({ 560, 320 }) do
    scroll.width, scroll.height = width, 220
    scroll.hooks.OnSizeChanged(scroll, width, 220)
    local child = scroll.child
    local previousBottom = 0
    for _, box in ipairs(page.boxes) do
      local at = box.points.TOPLEFT
      local top = -at[4]
      assert(top >= previousBottom, 'wrapped row descriptions must not overlap the next control')
      assert(at[3] >= 0 and at[3] + 38 + box.label.width <= width and at[3] + 38 + box.description.width <= width,
        'labels and descriptions stay inside the list')
      previousBottom = top + math.max(32, 4 + box.label:GetStringHeight() + 2 + box.description:GetStringHeight())
    end
    assert(child.height >= previousBottom, 'the last description must be inside scrollable content')
    scroll.scripts.OnMouseWheel(scroll, -1000)
    assert(scroll.offset == child.height - scroll.height, 'scrolling down reaches the last settings')
    scroll.scripts.OnMouseWheel(scroll, 1000)
    assert(scroll.offset == 0, 'scrolling back reaches the first settings')
  end
  assert(page.reload.parent == page and page.reload.points.BOTTOMLEFT, 'Reload remains at the fixed panel footer')
end
"""


def fresh(api: str, saved: str = "nil", window: bool = False):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(api)
    lua.execute(f"EverlootDB = {saved}")
    # The TOC loads the window's file after this one; the page is built at ADDON_LOADED, once both are in.
    for file in ["core.lua", "modules/census.lua", "modules/options.lua"] + (["modules/window.lua"] if window else []):
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
checkRows(O.page)
assert(O.page.title.text == 'Everloot' and rawget(O.page, 'crest') == nil, "without the window file: the game's own heading")

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
assert(O.page.backdrop.bgFile == 'Interface\\\\DialogFrame\\\\UI-DialogBox-Background', "without the window file: the game's dialog")
SlashCmdList.EVERLOOT('options')
assert(O.page.shown, 'opening again shows the same window')
""")

# --- With the window's file: the Everloot look, and the window itself still built only when opened ---
lua = fresh(SETTINGS, window=True)
lua.execute("""
local O = Everloot.Options
local page = O.page
assert(O.how == 'settings' and registered[1].frame == page, 'still an AddOns category')
assert(page.crest and page.crest.path == 'Interface\\\\AddOns\\\\Everloot\\\\media\\\\crest' and page.crest.width <= 32, 'a modest crest heads the page')
assert(page.title.text == 'Everloot' and page.title.color[2] > 0.9 and page.title.color[1] < 0.7 and page.title.color[3] < 0.3, 'Everloot in fel green')
assert(Everloot.Window.frame == nil and EverlootWindow == nil, 'the page borrows the look without building the window')
assert(page.scroll.textures and page.scroll.textures[1].colorTexture[1] < 0.1, 'the switches sit on a surface panel')
for _, box in ipairs(page.boxes) do
  assert(box.label.font:find('FRIZQT', 1, true) and box.description.font:find('FRIZQT', 1, true), "the window's fonts")
  assert(box.label.size > box.description.size and box.label.color[1] > box.description.color[1], 'a label reads above its description')
end
assert(page.intro.font:find('FRIZQT', 1, true) and page.note.font:find('FRIZQT', 1, true), 'the introduction and the footer note too')
page.scripts.OnShow()
checkRows(page)
-- The controls behave as before: a switch, the ask box, Reload now.
local census
for _, box in ipairs(page.boxes) do if box.row.key == 'census' then census = box end end
census.checked = false
census.scripts.OnClick(census)
assert(EverlootDB.toggles.census == false and not census.checked, 'a switch still sets its module')
local asked
Everloot.Ask = function(_, question) asked = question end
page.ask:SetText('  where is the frost book?  ')
page.ask.scripts.OnEnterPressed(page.ask)
assert(asked == 'where is the frost book?' and page.ask.text == '', 'the ask box sends the question and clears')
page.reload.scripts.OnClick()
assert(reloads == 1, 'Reload now reloads')
""")

# The same page on its own: the window's flat dark panel and bronze edge.
lua = fresh("", window=True)
lua.execute("""
local O = Everloot.Options
assert(O.how == 'window')
SlashCmdList.EVERLOOT('options')
local page = O.page
assert(page.shown and O.close, 'a window with a close button')
assert(page.backdrop and page.backdrop.bgFile == 'Interface\\\\Buttons\\\\WHITE8X8' and page.backdrop.edgeFile == 'Interface\\\\Tooltips\\\\UI-Tooltip-Border', 'the window backdrop')
assert(page.bg[1] < 0.1 and page.border[1] > page.border[3], 'dark inside a bronze edge')
""")

print("Lua 5.1 options: Settings API, interface options or a window; one switch per module; command rows run their command; every switch inside a scrolling list at any width; the window's crest heading, fonts, surface and dark window, or the game's own without its file; Reload now")
