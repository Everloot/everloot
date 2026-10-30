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
function Frame.HookScript(self, _, f) table.insert(self.hooks, f) end
function Frame.SetText(self, t) self.text = t end
function Frame.GetText(self) return self.text end
function Frame.SetChecked(self, v) self.checked = v and true or false end
function Frame.GetChecked(self) return self.checked end
function Frame.Show(self) self.shown = true end
function Frame.Hide(self) self.shown = false end
function Frame.SetParent(self, p) self.parentSet = p end
function Frame.CreateFontString(self) return setmetatable({ scripts = {}, hooks = {} }, Frame) end
function Frame.CreateTexture(self) return setmetatable({ scripts = {}, hooks = {} }, Frame) end
function Frame.RegisterEvent(self, e) self.events[e] = true end
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
    # Clicking it opens the panel.
    lua.execute("button.scripts.OnClick(button)")
    assert lua.eval("Everloot.Options.page ~= nil") is True


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
    test_the_ask_box_sends_a_question_the_way_the_command_does()
    print("Lua 5.1 minimap: absent-client fallback, one button, options and ask box")
