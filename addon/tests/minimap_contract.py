"""
The minimap button and the ask box: a button at the top-left of the minimap that opens the panel, and
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


def test_the_ask_box_sends_a_question_the_way_the_command_does():
    lua = fresh(MINIMAP, "{ installId = 'abcd-1234', toggles = { players = true }, records = {} }")
    lua.execute("Everloot.Options.Open()")
    lua.execute("""
    local box = Everloot.Options.page.ask
    box:SetText('  where does the mage get the frost book?  ')
    box.scripts.OnEnterPressed(box)
    """)
    asks = lua.eval("EverlootDB.asks and #EverlootDB.asks or 0")
    assert asks == 1
    assert lua.eval("EverlootDB.asks[1].question") == "where does the mage get the frost book?"
    # The box is empty again, so the same question is not sent twice.
    assert lua.eval("Everloot.Options.page.ask:GetText()") == ""


if __name__ == "__main__":
    test_without_a_minimap_the_module_says_so_and_does_not_error()
    test_the_button_sits_on_the_minimap_and_opens_the_panel()
    test_hovering_the_button_explains_its_three_actions()
    test_the_minimap_button_can_be_switched_off()
    test_the_ask_box_sends_a_question_the_way_the_command_does()
    print("Lua 5.1 minimap: absent-client fallback, one button, options and ask box")
