"""
The button drawer (modules/drawer.lua): other addons' LibDBIcon minimap buttons gather into the Everloot
minimap button, and hovering the crest shows them in a small grid. Blizzard frames and unknown buttons are
never touched, a late LibDBIcon button is collected too, the crest's clicks are unchanged, no buttons means no
drawer, the switch and /everloot buttons off leave every button where it is, another addon that gathers minimap
buttons keeps them, a client without LibStub, a minimap or C_Timer gets no error, and the one-time chat notice is
said once per install.
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
reloads = 0
ReloadUI = function() reloads = reloads + 1 end
local Frame = {}
Frame.__index = function(self, key)
  local own = rawget(Frame, key)
  if own then return own end
  return function() end
end
function Frame.SetScript(self, script, f)
  self.scripts[script] = f
  self.setCount[script] = (self.setCount[script] or 0) + 1
  if script == 'OnEvent' then self.onEvent = f end
end
function Frame.GetScript(self, script) return self.scripts[script] end
function Frame.HookScript(self, script, f) self.hooks[script] = self.hooks[script] or {}; table.insert(self.hooks[script], f) end
function Frame.SetParent(self, p)
  local old = rawget(self, 'parent')
  if old then for i, c in ipairs(old.children) do if c == self then table.remove(old.children, i) break end end end
  self.parent = p
  if p then table.insert(p.children, self) end
end
function Frame.GetParent(self) return rawget(self, 'parent') end
function Frame.GetChildren(self) return unpack(self.children) end
function Frame.GetName(self) return rawget(self, 'name') end
function Frame.Show(self) self.shown = true end
function Frame.Hide(self) self.shown = false end
function Frame.IsShown(self) return self.shown end
function Frame.IsMouseOver(self) return rawget(self, 'mouse') == true end
function Frame.SetPoint(self, point, rel, relPoint, x, y) table.insert(self.points, { point, rel, relPoint, x, y }) end
function Frame.ClearAllPoints(self) self.points = {} end
function Frame.SetAlpha(self, a) self.alpha = a end
function Frame.SetFrameLevel(self, l) self.level = l end
function Frame.GetFrameLevel(self) return rawget(self, 'level') or 1 end
function Frame.SetBackdrop(self, b) self.backdrop = b end
function Frame.SetColorTexture(self, r, g, b, a) self.color = { r, g, b, a } end
function Frame.SetWidth(self, w) self.width = w end
function Frame.SetSize(self, w, h) self.width, self.height = w, h end
function Frame.IsObjectType() return true end
function Frame.SetText(self, t) self.text = t end
function Frame.SetChecked(self, v) self.checked = v and true or false end
function Frame.GetChecked(self) return self.checked end
function Frame.SetTexture(self, t) self.path = t end
function Frame.RegisterEvent(self, e) self.events[e] = true end
local function new(kind, name)
  return setmetatable({ kind = kind, name = name, children = {}, shown = true, points = {}, scripts = {},
    setCount = {}, hooks = {}, events = {} }, Frame)
end
function Frame.CreateTexture(self) return new('Texture') end
function Frame.CreateFontString(self) return new('FontString') end
CreateFrame = function(kind, name, parent, template)
  local f = new(kind, name)
  f.template = template
  if parent then f:SetParent(parent) end
  if name then _G[name] = f end
  return f
end
UIParent = CreateFrame('Frame', 'UIParent')

-- Events reach the modules through the hooks on Everloot's frame, as in the game.
function event(name, ...)
  for _, hook in ipairs(Everloot.frame.hooks.OnEvent or {}) do hook(Everloot.frame, name, ...) end
end
-- Every pending C_Timer callback runs once; what they schedule waits for the next tick.
timers = {}
function tick()
  local due = timers
  timers = {}
  for _, t in ipairs(due) do t.f() end
end
function hover(frame) for _, hook in ipairs(frame.hooks.OnEnter or {}) do hook(frame) end end
"""

MINIMAP = """
Minimap = CreateFrame('Frame', 'Minimap', UIParent)
GameTooltip = { lines = {}, shown = false }
function GameTooltip:SetOwner(owner) self.owner, self.lines = owner, {} end
function GameTooltip:AddLine(text) self.lines[#self.lines + 1] = text end
function GameTooltip:Show() self.shown = true end
function GameTooltip:Hide() self.shown = false end
function leave(frame) for _, hook in ipairs(frame.hooks.OnLeave or {}) do hook(frame) end end
"""
TIMER = """
C_Timer = { After = function(seconds, f) timers[#timers + 1] = { seconds = seconds, f = f } end }
"""
# LibDBIcon as other addons embed it: buttons named LibDBIcon10_<name> on the minimap, put back around the
# minimap on its own updates, dragged around it, and announced to LibDBIcon_IconCreated listeners.
LIBDBICON = """
local listeners = {}
libdbicon = { objects = {} }
function libdbicon.RegisterCallback(target, eventName, method)
  listeners[eventName] = listeners[eventName] or {}
  table.insert(listeners[eventName], method)
end
function libdbicon.CreateIcon(name)
  local b = CreateFrame('Button', 'LibDBIcon10_' .. name, Minimap)
  b:SetScript('OnDragStart', function() end)
  b:SetScript('OnDragStop', function() end)
  b:SetPoint('CENTER', Minimap, 'CENTER', 80, 0)
  libdbicon.objects[name] = b
  libdbicon.fire(b, name)
  return b
end
function libdbicon.fire(b, name)
  for _, m in ipairs(listeners.LibDBIcon_IconCreated or {}) do m('LibDBIcon_IconCreated', b, name) end
end
function libdbicon.Refresh(name)
  local b = libdbicon.objects[name]
  b:ClearAllPoints()
  b:SetPoint('CENTER', Minimap, 'CENTER', 0, 80)
end
LibStub = setmetatable({}, { __call = function(_, major, silent)
  if major == 'LibDBIcon-1.0' then return libdbicon end
  if not silent then error('Cannot find a library instance of ' .. major) end
end })
"""
# Buttons that were on the minimap before Everloot loaded: two addons', and the frames it must leave alone.
CHILDREN = """
alpha = libdbicon.CreateIcon('Alpha')
beta = libdbicon.CreateIcon('Beta')
zoom = CreateFrame('Button', 'MinimapZoomIn', Minimap)
zoom:SetPoint('BOTTOMRIGHT', Minimap, 'BOTTOMRIGHT', 0, 0)
unnamed = CreateFrame('Button', nil, Minimap)
bare = CreateFrame('Button', 'LibDBIcon10_', Minimap)
elsewhere = CreateFrame('Button', 'LibDBIcon10_Elsewhere', UIParent)
"""


def fresh(api: str = MINIMAP + TIMER + LIBDBICON + CHILDREN, saved: str = "nil", login: bool = True, window: str = ""):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(api)
    lua.execute(f"EverlootDB = {saved}")
    for file in ["core.lua", "modules/options.lua", "modules/minimap.lua", "modules/drawer.lua"]:
        lua.execute((root / file).read_text(encoding="utf-8"))
        if file == "core.lua" and window:
            lua.execute(window)
    lua.execute("planned = 0; Everloot.Planner = { Open = function() planned = planned + 1 end }")
    lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')")
    if login:
        lua.execute("event('PLAYER_LOGIN'); event('PLAYER_ENTERING_WORLD'); tick()")
    return lua


def notices(lua) -> int:
    return lua.eval("(function() local n = 0; for _, l in ipairs(printed) do if l:find('/everloot buttons off', 1, true) and l:find('hover', 1, true) then n = n + 1 end end; return n end)()")


def test_the_toc_loads_the_drawer_after_the_minimap_button():
    toc = (root / "Everloot.toc").read_text(encoding="utf-8")
    assert "modules\\drawer.lua" in toc
    assert toc.index("modules\\minimap.lua") < toc.index("modules\\drawer.lua")


def test_libdbicon_buttons_are_collected_and_laid_out_and_nothing_else_is():
    lua = fresh()
    lua.execute("""
    local D, crest = Everloot.Drawer, Everloot.Minimap.button
    assert(D.frame and alpha.parent == D.frame and beta.parent == D.frame, 'both addon buttons are in the drawer')
    assert(#D.collected == 2 and D.collected[1] == alpha and D.collected[2] == beta, 'in name order')
    -- Blizzard frames, unnamed buttons, a bare prefix and a LibDBIcon button some other addon moved off the
    -- minimap are left exactly where they were.
    assert(zoom.parent == Minimap and #zoom.points == 1 and zoom.points[1][1] == 'BOTTOMRIGHT')
    assert(unnamed.parent == Minimap and bare.parent == Minimap and elsewhere.parent == UIParent)
    assert(crest.parent == Minimap, 'the crest stays on the minimap')
    -- Hover lays them out in the drawer's grid, at full alpha.
    alpha.alpha = 0
    crest.mouse = true
    hover(crest)
    assert(D.frame.shown, 'hover opens the drawer')
    assert(#alpha.points == 1 and alpha.points[1][2] == D.frame and alpha.alpha == 1)
    assert(#beta.points == 1 and beta.points[1][2] == D.frame and beta.points[1][4] > alpha.points[1][4], 'side by side')
    -- A LibDBIcon ring is drawn wider than its 31-pixel button, from the top-left: cells leave room for it, and
    -- each button draws above the one before it so no ring shadow dims the icon beside or below it.
    assert(beta.points[1][4] - alpha.points[1][4] >= 36, 'cells wider than a ring')
    assert(alpha.level > D.frame:GetFrameLevel() and beta.level == alpha.level + 1, 'later buttons draw above earlier ones')
    assert(rawget(D.frame, 'backdrop') and D.frame.backdrop.edgeFile, 'the drawer has a panel without the window loaded')
    -- The accent bar: two pixels wide, the window's green, down the edge that faces the crest (the drawer opens to
    -- the crest's left, so its right edge).
    local bar = D.frame.accent
    assert(bar and bar.width == 2 and bar.color[2] > 0.9 and bar.color[1] < 0.7 and bar.color[3] < 0.3, 'a green bar')
    assert(bar.points[1][1] == 'TOPRIGHT' and bar.points[2][1] == 'BOTTOMRIGHT' and bar.points[1][2] == D.frame, 'down the right edge')
    -- LibDBIcon putting a button back around the minimap no longer moves it, and it cannot be dragged off.
    libdbicon.Refresh('Alpha')
    assert(#alpha.points == 1 and alpha.points[1][2] == D.frame, 'LibDBIcon repositioning is ignored')
    assert(alpha.scripts.OnDragStart == nil and alpha.scripts.OnDragStop == nil, 'no drag-to-move')
    """)
    assert "buttons: ready (2 addon buttons" in lua.eval("Everloot:Status()")


def test_the_drawer_borrows_the_window_panel_when_the_window_is_loaded():
    # window.lua loads before drawer.lua and exposes its backdrop; the drawer then looks like the rest of Everloot.
    lua = fresh(window="styled = {}; Everloot.Window = { Backdrop = function(f) styled[#styled + 1] = f end, COLORS = { accent = { 0.1, 0.95, 0.2, 1 } } }")
    lua.execute("""
    local D = Everloot.Drawer
    assert(#styled == 1 and styled[1] == D.frame, 'the window styles the drawer panel')
    assert(rawget(D.frame, 'backdrop') == nil, 'and the drawer sets no panel of its own')
    assert(D.frame.accent.color[1] == 0.1 and D.frame.accent.color[2] == 0.95, 'the bar takes the window accent')
    """)
    toc = (root / "Everloot.toc").read_text(encoding="utf-8")
    assert toc.index("modules\\window.lua") < toc.index("modules\\drawer.lua")


def test_a_late_libdbicon_button_is_collected():
    lua = fresh()
    lua.execute("""
    late = libdbicon.CreateIcon('Late')
    assert(late.parent == Everloot.Drawer.frame and #Everloot.Drawer.collected == 3, 'the IconCreated callback collects it')
    -- One an addon has put somewhere other than the minimap stays there.
    libdbicon.fire(elsewhere, 'Elsewhere')
    assert(elsewhere.parent == UIParent and #Everloot.Drawer.collected == 3)
    """)
    # A library that only loads with a later addon is hooked at login.
    lua = fresh(MINIMAP + TIMER, login=False)
    lua.execute(LIBDBICON)
    lua.execute("event('PLAYER_LOGIN'); event('PLAYER_ENTERING_WORLD'); tick()")
    lua.execute("""
    late = libdbicon.CreateIcon('Late')
    assert(late.parent == Everloot.Drawer.frame, 'hooked once LibStub and the library exist')
    """)
    # A button created after login without the callback reaching us is picked up by a delayed rescan.
    lua = fresh(MINIMAP + TIMER + LIBDBICON, login=False)
    lua.execute("event('PLAYER_LOGIN'); event('PLAYER_ENTERING_WORLD')")
    lua.execute("""
    quiet = CreateFrame('Button', 'LibDBIcon10_Quiet', Minimap)
    tick()
    assert(quiet.parent == Everloot.Drawer.frame, 'a rescan after entering the world collects it')
    """)


def test_hover_shows_the_drawer_until_the_mouse_leaves_and_clicks_are_unchanged():
    lua = fresh()
    lua.execute("""
    local D, crest = Everloot.Drawer, Everloot.Minimap.button
    assert(not D.frame.shown, 'closed until hovered')
    crest.mouse = true
    hover(crest)
    assert(D.frame.shown)
    assert(GameTooltip.shown and GameTooltip.owner == crest and #GameTooltip.lines == 4, 'the tooltip, with the hover line, shows beside the drawer')
    leave(crest)
    assert(not GameTooltip.shown and D.frame.shown, 'leaving hides the tooltip; the drawer closes on its own poll')
    tick()
    assert(D.frame.shown, 'stays open while the mouse is on the crest')
    crest.mouse = false; D.frame.mouse = true
    tick()
    assert(D.frame.shown, 'stays open while the mouse is on the drawer')
    D.frame.mouse = false
    tick()
    assert(not D.frame.shown, 'hides shortly after the mouse leaves both')
    assert(#timers == 0, 'and stops polling')
    -- Hovering again reopens it, with one poll at a time.
    crest.mouse = true
    hover(crest); hover(crest)
    assert(D.frame.shown and #timers == 1)
    -- The crest's click handler is the minimap module's own, set once: left opens the planner, right the options.
    assert(crest.setCount.OnClick == 1 and crest.scripts.OnEnter == nil, 'the drawer hooks, it does not replace')
    local options = 0
    Everloot.Options.Open = function() options = options + 1 end
    crest.scripts.OnClick(crest, 'LeftButton')
    assert(planned == 1 and options == 0)
    crest.scripts.OnClick(crest, 'RightButton')
    assert(planned == 1 and options == 1, 'right-click opens the options')
    """)


def test_with_the_minimap_button_off_the_addon_buttons_stay_on_the_minimap():
    lua = fresh(saved="{ installId = 'abcd-1234', toggles = {}, records = {}, minimapButton = false }")
    lua.execute("""
    assert(Everloot.Minimap.button == nil and Everloot.Drawer.crest == nil)
    assert(alpha.parent == Minimap and beta.parent == Minimap, 'nothing gathered into a button that is not there')
    """)
    assert "buttons: off" in lua.eval("Everloot:Status()")


def test_no_buttons_no_drawer():
    lua = fresh(MINIMAP + TIMER + LIBDBICON)
    lua.execute("""
    local D, crest = Everloot.Drawer, Everloot.Minimap.button
    crest.mouse = true
    hover(crest)
    assert(D.frame == nil or not D.frame.shown, 'no empty panel')
    assert(#timers == 0)
    """)
    assert notices(lua) == 0
    assert "buttons: ready (no addon buttons" in lua.eval("Everloot:Status()")
    lua = fresh()
    lua.execute("""
    alpha:Hide(); beta:Hide()
    local crest = Everloot.Minimap.button
    crest.mouse = true
    hover(crest)
    assert(not Everloot.Drawer.frame.shown, 'only shown buttons open the drawer')
    beta:Show()
    hover(crest)
    assert(Everloot.Drawer.frame.shown and #beta.points == 1 and #alpha.points == 0)
    """)


def test_off_collects_nothing_and_the_switch_and_command_work():
    lua = fresh(saved="{ installId = 'abcd-1234', toggles = { buttons = false }, records = {} }")
    lua.execute("""
    assert(alpha.parent == Minimap and beta.parent == Minimap and #alpha.points == 1, 'off leaves every button')
    late = libdbicon.CreateIcon('Late')
    assert(late.parent == Minimap)
    local crest = Everloot.Minimap.button
    crest.mouse = true
    hover(crest)
    assert(Everloot.Drawer.frame == nil and #timers == 0)
    """)
    assert "buttons: off by toggle" in lua.eval("Everloot:Status()")
    assert notices(lua) == 0
    # On by default, for a new install and an upgrade alike, without writing a new key into the file.
    for saved in ("nil", "{ installId = 'abcd-1234', toggles = { openworld = true }, records = {} }"):
        lua = fresh(saved=saved)
        assert lua.eval("Everloot:IsEnabled('buttons')") is True
        assert lua.eval("alpha.parent == Everloot.Drawer.frame") is True
    lua.execute("""
    SlashCmdList.EVERLOOT('buttons off')
    assert(EverlootDB.toggles.buttons == false)
    assert(printed[#printed]:find('/reload', 1, true), printed[#printed])
    assert(alpha.parent == Everloot.Drawer.frame, 'nothing is restored in place')
    SlashCmdList.EVERLOOT('buttons on')
    assert(EverlootDB.toggles.buttons == true and printed[#printed]:find('/reload', 1, true))
    SlashCmdList.EVERLOOT('help')
    assert(printed[#printed]:find('/everloot buttons on|off', 1, true), 'listed in the help line')
    -- The settings page has the switch, on by default, and it runs the command.
    EverlootDB.toggles.buttons = nil
    local row
    for _, r in ipairs(Everloot.Options.ROWS) do if r.key == 'buttons' then row = r end end
    assert(row and row.command == 'buttons' and Everloot.Options.IsOn(row))
    Everloot.Options.Set(row, false)
    assert(EverlootDB.toggles.buttons == false and not Everloot.Options.IsOn(row))
    assert(printed[#printed]:find('/reload', 1, true))
    """)


def test_another_button_collector_keeps_the_buttons():
    # MinimapButtonButton loaded: nothing is gathered, the crest opens no panel, and the status says why. The check
    # runs at login, since that addon loads after Everloot and the module's init cannot see it yet.
    lua = fresh(MINIMAP + TIMER + LIBDBICON + CHILDREN + "C_AddOns = { IsAddOnLoaded = function(n) return n == 'MinimapButtonButton' end }")
    lua.execute("""
    local D, crest = Everloot.Drawer, Everloot.Minimap.button
    assert(#D.collected == 0 and alpha.parent == Minimap and beta.parent == Minimap, 'left to the other collector')
    assert(rawget(alpha, 'SetPoint') == nil, 'and not stubbed')
    crest.mouse = true
    hover(crest)
    assert(D.frame == nil or not D.frame.shown, 'no empty panel over the other panel')
    """)
    assert notices(lua) == 0
    assert "buttons: off (MinimapButtonButton gathers the addon buttons already" in lua.eval("Everloot:Status()")
    # A collector the list does not know takes a button after us: that button is left where it went, the rest stay.
    lua = fresh()
    lua.execute("""
    local D, crest = Everloot.Drawer, Everloot.Minimap.button
    local container = CreateFrame('Frame', 'OtherCollectorContainer', UIParent)
    alpha:SetParent(container)
    local before = #alpha.points
    crest.mouse = true
    hover(crest)
    assert(#D.collected == 1 and D.collected[1] == beta, 'alpha is theirs now')
    assert(#alpha.points == before and alpha.parent == container, 'and is not moved into the drawer')
    assert(D.frame.shown and #beta.points == 1 and D.frame.width == 8 * 2 + 38, 'the drawer holds the one it still has')
    """)


def test_a_client_without_libstub_minimap_or_timers_gets_no_error():
    # No LibStub: the scans still collect the buttons already on the minimap.
    lua = fresh(MINIMAP + TIMER + "libdbicon = { CreateIcon = function(name) return CreateFrame('Button', 'LibDBIcon10_' .. name, Minimap) end }\n"
                + "alpha = libdbicon.CreateIcon('Alpha')")
    assert lua.eval("alpha.parent == Everloot.Drawer.frame") is True
    # No minimap: no crest, no drawer, the module says why.
    lua = fresh(TIMER)
    lua.execute("event('PLAYER_LOGIN'); tick()")
    assert lua.eval("Everloot.Drawer.frame") is None
    assert "buttons: disabled" in lua.eval("Everloot:Status()")
    # No C_Timer: the drawer could not close, so nothing is collected.
    lua = fresh(MINIMAP + LIBDBICON + CHILDREN)
    lua.execute("""
    assert(alpha.parent == Minimap and #alpha.points == 1)
    local crest = Everloot.Minimap.button
    crest.mouse = true
    hover(crest)
    libdbicon.CreateIcon('Late')
    """)
    assert "buttons: disabled" in lua.eval("Everloot:Status()")
    # A LibStub that errors, a library without callbacks, and a minimap whose children cannot be listed.
    lua = fresh(MINIMAP + TIMER + "LibStub = function() error('broken') end\nMinimap.GetChildren = function() error('nope') end")
    lua.execute("event('PLAYER_ENTERING_WORLD'); tick()")
    lua = fresh(MINIMAP + TIMER + "LibStub = function() return {} end")


def test_the_one_time_notice_is_printed_once():
    lua = fresh(login=False)
    lua.execute("event('PLAYER_LOGIN'); event('PLAYER_ENTERING_WORLD')")
    assert notices(lua) == 0, "said once the buttons have settled, not at load"
    lua.execute("tick()")
    assert notices(lua) == 1
    line = lua.eval("printed[#printed]")
    assert line.startswith("Everloot: 2 addon buttons are now in the Everloot minimap button"), line
    assert lua.eval("EverlootDB.buttonsNotice") is True
    lua.execute("libdbicon.CreateIcon('Late'); event('PLAYER_ENTERING_WORLD'); tick(); tick()")
    assert notices(lua) == 1
    # The next session (the flag is in the saved file) says nothing.
    lua = fresh(saved="{ installId = 'abcd-1234', toggles = {}, records = {}, buttonsNotice = true }")
    assert notices(lua) == 0
    # One button reads as one.
    lua = fresh(MINIMAP + TIMER + LIBDBICON + "libdbicon.CreateIcon('Solo')")
    assert lua.eval("printed[#printed]").startswith("Everloot: 1 addon button is now in the Everloot minimap button")
    # An install with no addon buttons is told nothing until one arrives.
    lua = fresh(MINIMAP + TIMER + LIBDBICON)
    assert notices(lua) == 0
    lua.execute("libdbicon.CreateIcon('Late')")
    assert notices(lua) == 0
    lua.execute("tick()")
    assert notices(lua) == 1


if __name__ == "__main__":
    test_the_toc_loads_the_drawer_after_the_minimap_button()
    test_libdbicon_buttons_are_collected_and_laid_out_and_nothing_else_is()
    test_the_drawer_borrows_the_window_panel_when_the_window_is_loaded()
    test_a_late_libdbicon_button_is_collected()
    test_hover_shows_the_drawer_until_the_mouse_leaves_and_clicks_are_unchanged()
    test_with_the_minimap_button_off_the_addon_buttons_stay_on_the_minimap()
    test_no_buttons_no_drawer()
    test_off_collects_nothing_and_the_switch_and_command_work()
    test_another_button_collector_keeps_the_buttons()
    test_a_client_without_libstub_minimap_or_timers_gets_no_error()
    test_the_one_time_notice_is_printed_once()
    print("Lua 5.1 drawer: LibDBIcon buttons only, window panel, late buttons, hover and leave, clicks unchanged, off, another collector, missing APIs, one notice")
