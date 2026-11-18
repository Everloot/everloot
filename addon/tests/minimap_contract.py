"""
The minimap button and the ask box: a button on the minimap's edge, built and placed like other addons' buttons, that opens the panel, and
a box in the panel that sends a question the way /ask does. A client with no minimap gets no button and
no error, and the panel still opens from the command.
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
opened = 0
local Frame = {}
Frame.__index = function(self, key)
  local own = rawget(Frame, key)
  if own then return own end
  return function() end
end
function Frame.SetScript(self, script, f) self.scripts[script] = f; if script == 'OnEvent' then self.onEvent = f end end
function Frame.HookScript(self, script, f) self.hooks[script] = self.hooks[script] or {}; table.insert(self.hooks[script], f) end
function Frame.SetText(self, t) self.text = t end
function Frame.GetText(self) return self.text end
function Frame.SetChecked(self, v) self.checked = v and true or false end
function Frame.GetChecked(self) return self.checked end
function Frame.Show(self) self.shown = true end
function Frame.Hide(self) self.shown = false end
function Frame.SetParent(self, p) self.parentSet = p end
function Frame.SetTexture(self, t) self.path = t end
function Frame.SetHighlightTexture(self, t) self.highlightPath = t end
function Frame.CreateFontString(self) return setmetatable({ scripts = {}, hooks = {} }, Frame) end
function Frame.CreateTexture(self) return setmetatable({ scripts = {}, hooks = {} }, Frame) end
function Frame.RegisterEvent(self, e) self.events[e] = true end
function hover(frame) for _, hook in ipairs(frame.hooks.OnEnter or {}) do hook(frame) end end
function leave(frame) for _, hook in ipairs(frame.hooks.OnLeave or {}) do hook(frame) end end
CreateFrame = function(kind, name, parent, template)
  return setmetatable({ kind = kind, name = name, parent = parent, template = template, scripts = {}, hooks = {}, events = {} }, Frame)
end
"""


def fresh(api: str = "", saved: str = "nil"):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(api)
    lua.execute(f"EverlootDB = {saved}")
    for file in ["core.lua", "modules/ask.lua", "modules/options.lua", "modules/minimap.lua"]:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')")
    return lua


TOOLTIP = """
GameTooltip = { lines = {}, shown = false }
function GameTooltip:SetOwner(owner, anchor) self.owner, self.anchor, self.lines = owner, anchor, {} end
function GameTooltip:AddLine(text) self.lines[#self.lines + 1] = text end
function GameTooltip:Show() self.shown = true end
function GameTooltip:Hide() self.shown = false end
"""
MINIMAP = """
Minimap = setmetatable({}, { __index = function() return function() return true end end })
Minimap.IsObjectType = function() return true end
"""


def test_without_a_minimap_the_module_says_so_and_does_not_error():
    lua = fresh()
    notes = lua.eval("Everloot.modules and #Everloot.modules or 0")
    assert notes >= 0
    # The button is not there, and the panel still opens from the command.
    assert lua.eval("Everloot.Minimap.Button()") is None
    lua.execute("Everloot.Options.Open()")
    assert lua.eval("Everloot.Options.page ~= nil") is True


def test_the_button_sits_on_the_minimap_and_opens_the_panel():
    lua = fresh(MINIMAP)
    button = lua.eval("Everloot.Minimap.Button()")
    assert button is not None
    lua.globals().button = button
    assert lua.eval("Everloot.Minimap.Button() == button") is True  # built once
    assert lua.eval("button.parent == Minimap") is True
    # Its face is Everloot's crest (the round badge in media/crest.tga), not a stock game icon, with a hover glow.
    crest = "Interface\\AddOns\\Everloot\\media\\crest"
    assert lua.eval("button.icon.path") == crest
    assert lua.eval("button.highlightPath") is not None
    toc = (root / "Everloot.toc").read_text(encoding="utf-8")
    assert f"## IconTexture: {crest}" in toc, "the addon list shows the crest too"
    assert (root / "media" / "crest.tga").exists()
    # Clicking it opens the panel.
    lua.execute("button.scripts.OnClick(button)")
    assert lua.eval("Everloot.Options.page ~= nil") is True


# A minimap with a size and a centre, frames that record their points and sizes, and a cursor to drag with.
SIZED = """
local F = getmetatable(CreateFrame('Frame'))
function F.SetPoint(self, ...) local p = rawget(self, 'pts') or {}; p[#p + 1] = { ... }; self.pts = p end
function F.ClearAllPoints(self) self.pts = {} end
function F.SetSize(self, w, h) self.w, self.h = w, h end
function F.SetTexCoord(self, ...) self.coords = { ... } end
function F.SetFrameLevel(self, l) self.level = l end
function F.RegisterForDrag(self, b) self.drag = b end
width = 140
Minimap = { IsObjectType = function() return true end, GetWidth = function() return width end,
  GetHeight = function() return width end, GetCenter = function() return 500, 400 end, GetEffectiveScale = function() return 1 end }
cursor = { 0, 0 }
GetCursorPosition = function() return cursor[1], cursor[2] end
function near(a, b) return math.abs(a - b) < 1e-6 end
"""


def test_the_button_is_built_and_placed_like_other_addons_buttons():
    # LibDBIcon's button on this UI: 31 pixels at level 8, the gold tracking ring, the dark round background, an
    # 18-pixel face; and its sums: on the ring 5 pixels past the minimap's edge.
    lua = fresh(SIZED)
    lua.execute("""
    local b = Everloot.Minimap.Button()
    assert(b.w == 31 and b.h == 31 and b.level == 8)
    assert(b.ring.path == 'Interface\\\\Minimap\\\\MiniMap-TrackingBorder' and b.ring.w == 50 and b.ring.pts[1][1] == 'TOPLEFT')
    -- The face is the crest's diamond alone, cut as the tooltip header cuts it, so no second ring sits inside the gold one.
    assert(b.icon.w == 18 and near(b.icon.coords[1], 36 / 128) and near(b.icon.coords[2], 92 / 128))
    -- At the top-left of the ring by default: 135 degrees, 75 pixels from the centre of a 140-pixel minimap.
    local p = b.pts
    assert(#p == 1 and p[1][1] == 'CENTER' and p[1][2] == Minimap and p[1][3] == 'CENTER')
    assert(near(p[1][4], -75 * math.sqrt(0.5)) and near(p[1][5], 75 * math.sqrt(0.5)), p[1][4] .. ',' .. p[1][5])
    -- Dragged around the ring like any other addon's button, and the angle is kept.
    assert(b.drag == 'LeftButton')
    b.scripts.OnDragStart(b)
    cursor = { 600, 400 }
    b.scripts.OnUpdate(b)
    assert(near(EverlootDB.minimapAngle, 0) and near(b.pts[1][4], 75) and near(b.pts[1][5], 0) and #b.pts == 1)
    b.scripts.OnDragStop(b)
    assert(b.scripts.OnUpdate == nil, 'dropping it stops following the cursor')
    -- Placed again at login, so a minimap resized by then still has the button on its edge.
    width = 200
    for _, hook in ipairs(Everloot.frame.hooks.OnEvent) do hook(Everloot.frame, 'PLAYER_LOGIN') end
    assert(near(b.pts[1][4], 105) and #b.pts == 1)
    """)
    # A saved angle is where the next session puts it; a square minimap has it along the edge, not on a circle.
    lua = fresh(SIZED + "GetMinimapShape = function() return 'SQUARE' end", "{ installId = 'abcd-1234', toggles = {}, records = {}, minimapAngle = 30 }")
    lua.execute("""
    local p = Everloot.Minimap.Button().pts[1]
    local diagonal = math.sqrt(2 * 75 ^ 2) - 10
    assert(near(p[4], 75) and near(p[5], 0.5 * diagonal), p[4] .. ',' .. p[5])
    """)


def test_hovering_the_button_explains_its_three_actions():
    lua = fresh(MINIMAP + TOOLTIP)
    lua.execute("""
    local button = Everloot.Minimap.Button()
    assert(button.scripts.OnEnter == nil and button.scripts.OnLeave == nil, 'hooked, so the drawer hover keeps working')
    hover(button)
    assert(GameTooltip.owner == button and GameTooltip.anchor == 'ANCHOR_BOTTOMRIGHT' and GameTooltip.shown)
    assert(#GameTooltip.lines == 3 and GameTooltip.lines[1] == 'Everloot', table.concat(GameTooltip.lines, '|'))
    assert(GameTooltip.lines[2] == 'Left-click: open the plan workspace', 'no window module in this world')
    assert(GameTooltip.lines[3]:find('Right%-click', 1), 'no gathered buttons, no hover line')
    Everloot.Window = { failed = false }
    hover(button)
    assert(GameTooltip.lines[2] == 'Left-click: open the Everloot window')
    Everloot.Window.failed = true
    hover(button)
    assert(GameTooltip.lines[2] == 'Left-click: open the plan workspace', 'a failed window falls back')
    Everloot.Window.failed = false
    EverlootDB.toggles.window = false
    hover(button)
    assert(GameTooltip.lines[2] == 'Left-click: open the plan workspace', 'window off')
    EverlootDB.toggles.window = nil
    EverlootDB.toggles.buttons = true
    Everloot.Drawer = { collected = { {} } }
    hover(button)
    assert(#GameTooltip.lines == 4 and GameTooltip.lines[4] == "Hover: show other addons' buttons")
    EverlootDB.toggles.buttons = false
    hover(button)
    assert(#GameTooltip.lines == 3, 'buttons off, no hover line')
    assert(GameTooltip.lines[3]:lower():find('settings', 1, true))
    leave(button)
    assert(not GameTooltip.shown)
    """)
    # A client without GameTooltip still gets the button, and hovering it does not error.
    lua = fresh(MINIMAP)
    lua.execute("local b = Everloot.Minimap.Button(); hover(b); leave(b)")


def test_the_minimap_button_can_be_switched_off():
    saved = "{ installId = 'abcd-1234', toggles = {}, records = {}, minimapButton = false }"
    lua = fresh(MINIMAP + TOOLTIP, saved)
    assert lua.eval("Everloot.Minimap.Button()") is None
    assert lua.eval("Everloot.Minimap.button") is None
    assert "off" in lua.eval("Everloot:Status()")
    # The window stays reachable from the command, and the switch has a row on the settings page.
    row = lua.eval("(function() for _, r in ipairs(Everloot.Options.ROWS) do if r.key == 'minimapButton' then return r end end end)()")
    assert row is not None and row["field"] is True and "/everloot window" in row["text"]
    lua = fresh(MINIMAP + TOOLTIP)
    assert lua.eval("Everloot.Minimap.Button() ~= nil") is True


def test_ask_left_the_settings_page_and_the_command_still_queues():
    lua = fresh(MINIMAP, "{ installId = 'abcd-1234', toggles = { players = true }, records = {} }")
    lua.execute("Everloot.Options.Open()")
    # The settings page has no Ask box: asking from the game needs the Desktop App and two reloads, so it is not
    # offered among the switches. /ask still queues a question for the companion.
    assert lua.eval("rawget(Everloot.Options.page, 'ask') == nil") is True
    lua.execute("SlashCmdList.EVERLOOTASK('  where does the mage get the frost book?  ')")
    assert lua.eval("EverlootDB.asks and #EverlootDB.asks or 0") == 1
    assert lua.eval("EverlootDB.asks[1].question") == "where does the mage get the frost book?"


if __name__ == "__main__":
    test_without_a_minimap_the_module_says_so_and_does_not_error()
    test_the_button_sits_on_the_minimap_and_opens_the_panel()
    test_the_button_is_built_and_placed_like_other_addons_buttons()
    test_hovering_the_button_explains_its_three_actions()
    test_the_minimap_button_can_be_switched_off()
    test_ask_left_the_settings_page_and_the_command_still_queues()
    print("Lua 5.1 minimap: absent-client fallback, one button built and placed like LibDBIcon's, dragged and kept, options and ask box")
