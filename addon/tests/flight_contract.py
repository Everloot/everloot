"""Local flight timing, arrival checks and the route bar (Lua 5.1)."""
from pathlib import Path
from lupa.lua51 import LuaRuntime

ROOT = Path(__file__).parents[1]
WORLD = r'''
now, flying, landing = 0, false, 'Coppercloud Quay'
secret = {}
issecretvalue = function(value) return value == secret end
time = function() return 1000000 end
date = function() return '2026-11-19T10:00:00Z' end
GetTime = function() return now end
GetRealmName = function() return 'Glasswind' end
GetSubZoneText = function() return landing end
GetRealZoneText = function() return 'Cloudmere' end
SlashCmdList, printed, hooks, frames = {}, {}, {}, {}
print = function(text) printed[#printed + 1] = text end
C_Timer = { After = function(_, fn) fn() end }
nodes = { 'Coppercloud Quay', 'Amberwing Rest' }
TakeTaxiNode = function() end
TaxiRequestEarlyLanding = function() end
TaxiNodeName = function(i) return nodes[i] end
TaxiNodeGetType = function(i) return i == 1 and 'CURRENT' or 'REACHABLE' end
NumTaxiNodes = function() return #nodes end
UnitOnTaxi = function() return flying end
SetPortraitTexture = function(texture, unit) texture.unit = unit end
hooksecurefunc = function(a, b, c) if type(a) == 'table' then hooks[b] = c else hooks[a] = b end end
GameTooltip = { lines = {} }
function GameTooltip:AddLine(text, r, g, b) self.lines[#self.lines + 1] = text; self.color = {r, g, b} end
function GameTooltip:Show() self.shown = true end
local Frame = {}
Frame.__index = function(self, key)
  return Frame[key] or function() end
end
function Frame:SetScript(key, fn) self.scripts[key] = fn end
function Frame:HookScript(key, fn)
  self.hooks[key] = self.hooks[key] or {}; table.insert(self.hooks[key], fn)
end
function Frame:SetPoint(...) self.point = {...} end
function Frame:SetSize(w, h) self.w, self.h = w, h end
function Frame:GetWidth() return self.w end
function Frame:GetFrameLevel() return 1 end
function Frame:SetTexture(path) self.path = path end
function Frame:SetRotation(r) self.rotation = r end
function Frame:SetVertexColor(r, g, b) self.color = {r, g, b} end
function Frame:SetValue(value) self.value = value end
function Frame:SetText(text) self.text = text end
function Frame:Show() self.shown = true end
function Frame:IsShown() return self.shown == true end
function Frame:Hide() self.shown = false end
function Frame:CreateTexture() return CreateFrame('Texture') end
function Frame:CreateMaskTexture() return CreateFrame('MaskTexture') end
function Frame:CreateFontString(_, _, font) local f = CreateFrame('FontString'); f.font = font; return f end
function CreateFrame(kind, name, parent)
  local f = setmetatable({kind=kind, name=name, parent=parent, scripts={}, hooks={}}, Frame)
  frames[#frames + 1] = f; return f
end
UIParent = CreateFrame('Frame'); UIParent.w = 1600
function event(name, arg)
  local f = Everloot.frame
  f.scripts.OnEvent(f, name, arg)
  for _, fn in ipairs(f.hooks.OnEvent or {}) do fn(f, name, arg) end
end
function tick(seconds)
  now = now + seconds
  for _, f in ipairs(frames) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f, seconds) end end
end
function depart()
  hooks.TakeTaxiNode(2)
  event('TAXIMAP_CLOSED')
  flying = true; event('PLAYER_CONTROL_LOST')
end
function arrive(seconds)
  tick(seconds); flying = false; landing = 'Amberwing Rest'; event('PLAYER_CONTROL_GAINED')
end
'''


def fresh(extra="", saved="nil"):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(extra)
    lua.execute(f"EverlootDB = {saved}")
    for file in ["core.lua", "modules/options.lua", "modules/flight.lua"]:
        lua.execute((ROOT / file).read_text(encoding="utf-8"))
    lua.execute("event('ADDON_LOADED', 'Everloot'); printed = {}")
    return lua


def test_first_and_known_flights():
    lua = fresh()
    lua.execute("depart()")
    assert lua.eval("Everloot.Flight.frame.shown")
    text = lua.eval("Everloot.Flight.frame.label.text")
    assert "Coppercloud Quay → Amberwing Rest" in text
    assert "first flight on this route: timing it" in text and "left" not in text
    lua.execute("tick(60)")
    start = lua.eval("Everloot.Flight.frame.marker.point[4]")
    assert 0 < lua.eval("Everloot.Flight.frame.progress") < .9
    lua.execute("arrive(60)")
    assert not lua.eval("Everloot.Flight.frame.shown")
    assert lua.eval("EverlootDB.flights.Glasswind['Coppercloud Quay|Amberwing Rest'][1]") == 120
    assert lua.eval("#printed") == 1
    assert "timed: 2:00" in lua.eval("printed[1]")
    lua.execute("depart(); tick(40)")
    assert "about 1:20 left" in lua.eval("Everloot.Flight.frame.label.text")
    assert abs(lua.eval("Everloot.Flight.frame.progress") - 1 / 3) < .001
    assert lua.eval("Everloot.Flight.frame.marker.point[4]") > start
    lua.execute("tick(200)")
    assert lua.eval("Everloot.Flight.frame.progress") == 1
    assert "about 0:00 left" in lua.eval("Everloot.Flight.frame.label.text")


def test_early_stops_and_dismounts_never_teach_a_duration():
    for action in ["hooks.TaxiRequestEarlyLanding()", "tick(-15)"]:
        lua = fresh()
        lua.execute("depart(); tick(20); " + action + "; flying = false; event('PLAYER_CONTROL_GAINED')")
        assert lua.eval("EverlootDB.flights == nil")
        assert not lua.eval("Everloot.Flight.frame.shown")
    # The landing zone's text is not the node's name ("Town, Zone"): an uncancelled flight long enough to be one
    # is an arrival whatever the zone says, a secret value included.
    for action in ["landing = 'Somewhere Else'", "landing = secret"]:
        lua = fresh()
        lua.execute("depart(); tick(20); " + action + "; flying = false; event('PLAYER_CONTROL_GAINED')")
        assert lua.eval("EverlootDB.flights.Glasswind['Coppercloud Quay|Amberwing Rest'][1]") == 20


def test_flight_map_names_when_the_taxi_frame_globals_are_missing():
    # Forever's flight map names its nodes through C_TaxiMap by slot index; the current node carries that state.
    lua = fresh('''
TaxiNodeName, NumTaxiNodes, TaxiNodeGetType = nil, nil, nil
Enum = { FlightPathState = { Current = 0, Reachable = 1, Unreachable = 2 } }
FlightMapFrame = { GetMapID = function() return 1414 end }
C_TaxiMap = { GetAllTaxiNodes = function(mapId)
  if mapId ~= 1414 then return {} end
  return { { name = 'Coppercloud Quay', slotIndex = 1, state = 0 }, { name = 'Amberwing Rest', slotIndex = 2, state = 1 },
    { name = secret, slotIndex = 3, state = 1 } }
end }
''')
    lua.execute("depart(); tick(20)")
    assert "Coppercloud Quay → Amberwing Rest" in lua.eval("Everloot.Flight.frame.label.text")
    lua.execute("arrive(40)")
    assert lua.eval("EverlootDB.flights.Glasswind['Coppercloud Quay|Amberwing Rest'][1]") == 60


def test_a_flight_seen_without_its_selection_names_nothing_and_teaches_nothing():
    lua = fresh()
    lua.execute("flying = true; event('PLAYER_CONTROL_LOST'); tick(20)")
    assert lua.eval("Everloot.Flight.frame.label.text") == "On a flight path · timing unknown"
    lua.execute("arrive(60)")
    assert lua.eval("EverlootDB.flights == nil")
    assert not lua.eval("Everloot.Flight.frame.shown")


def test_median_last_three_and_realm_separation():
    lua = fresh()
    for duration in [100, 120, 110, 140]:
        lua.execute(f"depart(); arrive({duration})")
    assert lua.eval("#EverlootDB.flights.Glasswind['Coppercloud Quay|Amberwing Rest']") == 3
    lua.execute("depart(); tick(20)")
    assert "about 1:40 left" in lua.eval("Everloot.Flight.frame.label.text")
    lua.execute("arrive(100); GetRealmName = function() return 'Mistglass' end; depart()")
    assert "first flight" in lua.eval("Everloot.Flight.frame.label.text")


def test_unknown_progress_polling_and_cleanup():
    lua = fresh()
    lua.execute("hooks.TakeTaxiNode(2); flying = true; tick(.5); tick(400)")
    assert lua.eval("Everloot.Flight.frame.shown")
    assert lua.eval("Everloot.Flight.frame.progress") == .9
    assert "left" not in lua.eval("Everloot.Flight.frame.label.text")
    lua.execute("event('PLAYER_LOGOUT')")
    assert not lua.eval("Everloot.Flight.frame.shown")
    assert lua.eval("EverlootDB.flights == nil")
    lua = fresh()
    lua.execute("hooks.TakeTaxiNode(2); event('TAXIMAP_CLOSED'); tick(31); flying = true; tick(1)")
    assert lua.eval("Everloot.Flight.frame == nil")


def test_missing_and_secret_apis_do_not_raise():
    for extra in ["nodes[2] = secret", "nodes[1] = secret", "TaxiNodeName = nil",
                  "NumTaxiNodes = function() error('unavailable') end",
                  "NumTaxiNodes = function() return secret end", "GetRealmName = function() return secret end",
                  "UnitOnTaxi = function() return secret end", "GetTime = function() return secret end"]:
        lua = fresh(extra)
        lua.execute("depart(); tick(20); arrive(20)")
        assert lua.eval("EverlootDB.flights == nil")
    lua = fresh("TakeTaxiNode = nil; hooksecurefunc = nil")
    lua.execute("event('PLAYER_CONTROL_LOST'); tick(1)")
    lua = fresh()
    lua.execute("depart(); UnitOnTaxi = function() return secret end; tick(2)")
    assert lua.eval("EverlootDB.flights == nil")
    assert not lua.eval("Everloot.Flight.frame.shown")
    lua.execute("event('PLAYER_LOGOUT')")


def test_legacy_taxi_values_and_destination_labels():
    lua = fresh("nodes[2] = 'Amberwing Rest, Cloudmere'")
    lua.execute("depart(); tick(90); flying = nil; landing = 'Amberwing Rest'; event('PLAYER_CONTROL_GAINED')")
    assert lua.eval("EverlootDB.flights.Glasswind['Coppercloud Quay|Amberwing Rest, Cloudmere'][1]") == 90
    assert not lua.eval("Everloot.Flight.frame.shown")
    lua = fresh("UIParent.w = 600; SetPortraitTexture = function() error('unavailable') end")
    lua.execute("depart()")
    assert lua.eval("Everloot.Flight.frame.w") == 320


def test_toggle_and_native_art():
    lua = fresh(saved="{toggles={flight=false}, records={}}")
    lua.execute("TakeTaxiNode(2); flying = true; event('PLAYER_CONTROL_LOST'); tick(20)")
    assert lua.eval("Everloot.Flight.frame == nil")
    lua = fresh()
    lua.execute("depart()")
    assert lua.eval("EverlootDB.toggles.flight")
    assert lua.eval("Everloot.Flight.frame.w") == 640
    assert lua.eval("Everloot.Flight.frame.label.font") == "GameFontHighlightSmall"
    assert lua.eval("Everloot.Flight.frame.portrait.unit") == "player"
    # The face alone, ringed in the accent green: no mount icon beside it.
    assert lua.eval("rawget(Everloot.Flight.frame, 'mount') == nil")
    assert lua.eval("Everloot.Flight.frame.portrait.w") == 28
    assert lua.eval("Everloot.Flight.frame.marker.w") == 32
    assert lua.eval("Everloot.Flight.frame.ring.path").endswith("TempPortraitAlphaMask")
    lua.execute("SlashCmdList.EVERLOOT('flight off')")
    assert not lua.eval("Everloot.Flight.frame.shown")
    lua.execute("arrive(60)")
    assert lua.eval("EverlootDB.flights == nil")


def test_the_line_of_diamonds_fills_behind_the_face():
    lua = fresh(saved="{flights={Glasswind={['Coppercloud Quay|Amberwing Rest']={100}}}}")
    lua.execute("depart()")
    fills = lambda: [(f.x, f.w, f.shown) for f in lua.eval("Everloot.Flight.frame.diamonds").values()]
    # 640 wide: a row of 76 diamonds, 8 px apart, each turned a quarter, none filled at takeoff.
    assert len(fills()) == 76
    assert all(not shown for _, _, shown in fills())
    first = lua.eval("Everloot.Flight.frame.diamonds[1]")
    assert abs(first.rotation - 3.14159265 / 4) < 1e-6 and first.w == 0
    lua.execute("tick(50)")
    # Halfway: the face's centre is at 304 px and its trailing edge at 288; the diamonds before it are whole, the one
    # it is crossing part filled, the rest grey.
    rows = fills()
    full = [x for x, w, shown in rows if shown and w == 6]
    assert full and max(full) <= 288
    assert all(not shown for x, _, shown in rows if x > 296)
    assert any(shown and 0 < w < 6 for _, w, shown in rows) or 288 in full
    lua.execute("tick(100)")
    assert sum(1 for _, w, shown in fills() if shown and w == 6) >= 70


# Three nodes: the Alliance and Horde maps each have a node named Amberwing Rest (20 and 21); the path runs from 10 to 21.
ROUTES = '''
nodes[3] = 'Duskhollow'
routes = { [2] = { {1, 2} }, [3] = { {1, 2}, {2, 3} } }
GetNumRoutes = function(i) return routes[i] and #routes[i] or 0 end
TaxiGetNodeSlot = function(i, hop, source) local h = routes[i][hop]; return source and h[1] or h[2] end
'''
DATA = """
Everloot.FLIGHT_NODES = { [10] = 'Coppercloud Quay', [20] = 'Amberwing Rest', [21] = 'Amberwing Rest', [30] = 'Duskhollow' }
Everloot.FLIGHT_YARDS = { ['10-21'] = 3000, ['21-30'] = 1500 }
"""


def routed(extra=""):
    lua = fresh(ROUTES + extra)
    lua.execute(DATA)
    return lua


def test_the_game_files_time_a_route_before_its_first_flight():
    lua = routed()
    lua.execute("depart()")
    # 3000 yards at 30 a second: 100 seconds.
    assert "Coppercloud Quay → Amberwing Rest · about 1:40 left" in lua.eval("Everloot.Flight.frame.label.text")
    lua.execute("tick(40)")
    assert "about 1:00 left" in lua.eval("Everloot.Flight.frame.label.text")
    assert abs(lua.eval("Everloot.Flight.frame.progress") - .4) < .001
    # The arrival still teaches this character's own time, which then wins over the estimate.
    lua.execute("arrive(80)")
    assert lua.eval("EverlootDB.flights.Glasswind['Coppercloud Quay|Amberwing Rest'][1]") == 120
    assert lua.eval("#printed") == 0
    lua.execute("depart()")
    assert "about 2:00 left" in lua.eval("Everloot.Flight.frame.label.text")


def test_a_route_with_stops_sums_its_hops_and_an_unknown_hop_gives_no_estimate():
    lua = routed()
    lua.execute("hooks.TakeTaxiNode(3); flying = true; event('PLAYER_CONTROL_LOST')")
    assert "about 2:30 left" in lua.eval("Everloot.Flight.frame.label.text")
    lua = routed()
    lua.execute("Everloot.FLIGHT_YARDS['21-30'] = nil; hooks.TakeTaxiNode(3); flying = true; event('PLAYER_CONTROL_LOST')")
    assert "first flight on this route: timing it" in lua.eval("Everloot.Flight.frame.label.text")
    for extra in ["GetNumRoutes = nil", "GetNumRoutes = function() return secret end", "TaxiGetNodeSlot = function() error('unavailable') end"]:
        lua = routed(extra)
        lua.execute("depart()")
        assert "first flight on this route: timing it" in lua.eval("Everloot.Flight.frame.label.text")
    lua = routed()
    lua.execute("Everloot.FLIGHT_YARDS = nil; depart()")
    assert "first flight" in lua.eval("Everloot.Flight.frame.label.text")


def test_the_flight_maps_node_ids_win_over_names():
    lua = routed('''
Enum = { FlightPathState = { Current = 0, Reachable = 1, Unreachable = 2 } }
FlightMapFrame = { GetMapID = function() return 1414 end }
C_TaxiMap = { GetAllTaxiNodes = function()
  return { { name = 'Coppercloud Quay', slotIndex = 1, state = 0, nodeID = 10 }, { name = 'Amberwing Rest', slotIndex = 2, state = 1, nodeID = 20 } }
end }
''')
    lua.execute("Everloot.FLIGHT_YARDS['10-20'] = 6000; depart()")
    assert "about 3:20 left" in lua.eval("Everloot.Flight.frame.label.text")


MAP = '''
Enum = { FlightPathState = { Current = 0, Reachable = 1, Unreachable = 2 } }
TaxiNodeOnButtonEnter = function() end
'''


def test_destination_tooltips_show_the_flight_time_on_both_flight_maps():
    lua = routed(MAP)
    # Blizzard_FlightMap loads on demand: its pin mixin is hooked when it arrives.
    lua.execute("FlightMap_FlightPointPinMixin = { OnMouseEnter = function() end }; event('ADDON_LOADED', 'Blizzard_FlightMap')")
    lua.execute("hooks.OnMouseEnter({ taxiNodeData = { slotIndex = 3, state = 1 } })")
    assert list(lua.eval("GameTooltip.lines").values()) == ["Flight: about 2:30"]
    assert lua.eval("GameTooltip.shown")
    lua.execute("GameTooltip.lines = {}; hooks.OnMouseEnter({ taxiNodeData = { slotIndex = 1, state = 0 } }); hooks.OnMouseEnter({})")
    assert len(lua.eval("GameTooltip.lines")) == 0
    lua.execute("hooks.TaxiNodeOnButtonEnter({ GetID = function() return 2 end })")
    assert list(lua.eval("GameTooltip.lines").values()) == ["Flight: about 1:40"]
    # The older frame's tooltip skips the node the player stands at.
    lua.execute("GameTooltip.lines = {}; hooks.TaxiNodeOnButtonEnter({ GetID = function() return 1 end })")
    assert len(lua.eval("GameTooltip.lines")) == 0
    # After a timed trip the tooltip shows this character's own time.
    lua.execute("depart(); arrive(130); GameTooltip.lines = {}; hooks.TaxiNodeOnButtonEnter({ GetID = function() return 2 end })")
    assert list(lua.eval("GameTooltip.lines").values()) == ["Flight: about 2:10"]
    lua.execute("SlashCmdList.EVERLOOT('flight off'); GameTooltip.lines = {}; hooks.TaxiNodeOnButtonEnter({ GetID = function() return 2 end })")
    assert len(lua.eval("GameTooltip.lines")) == 0


def test_a_flight_map_loaded_first_is_hooked_at_once_and_only_once():
    lua = routed(MAP + "FlightMap_FlightPointPinMixin = { OnMouseEnter = function() end }")
    assert lua.eval("hooks.OnMouseEnter ~= nil")
    lua.execute("first = hooks.OnMouseEnter; event('ADDON_LOADED', 'Blizzard_FlightMap')")
    assert lua.eval("first == hooks.OnMouseEnter")
    lua = routed(MAP)
    lua.execute("event('ADDON_LOADED', 'Blizzard_FlightMap')")
    assert lua.eval("hooks.OnMouseEnter == nil")


def test_a_measured_route_time_wins_over_the_hops_and_a_characters_own_time_wins_over_both():
    lua = routed()
    # By name: the origin has one node, the destination two (10 and 21); the measured pair is 10-21.
    lua.execute("Everloot.FLIGHT_TIMES = { ['10-21'] = 90, ['10-30'] = 140 }; depart()")
    assert "about 1:30 left" in lua.eval("Everloot.Flight.frame.label.text")
    lua.execute("arrive(95); depart()")
    assert "about 1:35 left" in lua.eval("Everloot.Flight.frame.label.text")
    # A route with stops takes the whole route's measured time, not the sum of its hops (150 seconds).
    lua = routed()
    lua.execute("Everloot.FLIGHT_TIMES = { ['10-30'] = 140 }; hooks.TakeTaxiNode(3); flying = true; event('PLAYER_CONTROL_LOST')")
    assert "about 2:20 left" in lua.eval("Everloot.Flight.frame.label.text")
    # By the flight map's ids, origin included.
    lua = routed('''
Enum = { FlightPathState = { Current = 0, Reachable = 1, Unreachable = 2 } }
FlightMapFrame = { GetMapID = function() return 1414 end }
C_TaxiMap = { GetAllTaxiNodes = function()
  return { { name = 'Coppercloud Quay', slotIndex = 1, state = 0, nodeID = 10 }, { name = 'Amberwing Rest', slotIndex = 2, state = 1, nodeID = 20 } }
end }
''')
    lua.execute("Everloot.FLIGHT_TIMES = { ['10-21'] = 90, ['10-20'] = 70 }; depart()")
    assert "about 1:10 left" in lua.eval("Everloot.Flight.frame.label.text")


LATER = "C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }; timers = {}"


def test_a_confirmed_landing_fills_the_crest_for_a_moment():
    lua = routed(LATER)
    lua.execute("depart(); tick(30); arrive(70)")
    f = "Everloot.Flight.frame"
    assert lua.eval(f + ".shown")
    assert lua.eval(f + ".label.text") == "Landed at Amberwing Rest · 1:40"
    assert lua.eval(f + ".landed.shown") and not lua.eval(f + ".marker.shown")
    assert all(d.shown and d.w == 6 for d in lua.eval(f + ".diamonds").values())
    lua.execute("for _, fn in ipairs(timers) do fn() end")
    assert not lua.eval(f + ".shown") and not lua.eval(f + ".landed.shown")
    # A new flight inside the moment keeps its bar when the old timer fires.
    lua = routed(LATER)
    lua.execute("depart(); arrive(100); depart(); tick(10)")
    assert not lua.eval("Everloot.Flight.frame.landed.shown")
    lua.execute("for _, fn in ipairs(timers) do fn() end")
    assert lua.eval("Everloot.Flight.frame.shown") and "about" in lua.eval("Everloot.Flight.frame.label.text")
    # An early landing is no arrival: the bar goes at once, with no landing moment.
    lua = routed(LATER)
    lua.execute("depart(); tick(30); hooks.TaxiRequestEarlyLanding(); flying = false; event('PLAYER_CONTROL_GAINED')")
    assert not lua.eval("Everloot.Flight.frame.shown") and len(lua.eval("timers")) == 0


def test_the_shipped_measured_times_carry_infights_notice():
    lua = fresh()
    text = (ROOT / "modules/flight_times.lua").read_text(encoding="utf-8")
    assert "LudiusMaximus" in text and "MIT License" in text and "Permission is hereby granted" in text
    lua.execute(text)
    times = dict(lua.eval("Everloot.FLIGHT_TIMES").items())
    assert len(times) > 800
    for key, seconds in times.items():
        a, b = (int(x) for x in key.split("-"))
        assert a != b and 10 < seconds < 1800
    toc = (ROOT / "Everloot.toc").read_text(encoding="utf-8").splitlines()
    assert toc.index("modules\\flight_times.lua") < toc.index("modules\\flight.lua")


def test_the_shipped_table_loads_and_reads_one_way_per_key():
    lua = fresh()
    lua.execute((ROOT / "modules/flight_data.lua").read_text(encoding="utf-8"))
    nodes = dict(lua.eval("Everloot.FLIGHT_NODES").items())
    yards = dict(lua.eval("Everloot.FLIGHT_YARDS").items())
    assert len(nodes) > 50 and len(yards) > 200
    for key, value in yards.items():
        a, b = (int(x) for x in key.split("-"))
        assert a in nodes and b in nodes and a != b
        assert 500 < value < 30000
    toc = (ROOT / "Everloot.toc").read_text(encoding="utf-8").splitlines()
    assert toc.index("modules\\flight_data.lua") < toc.index("modules\\flight.lua")


if __name__ == "__main__":
    for name, test in list(globals().items()):
        if name.startswith("test_"):
            test()
            print(f"PASS {name}")
    print("Flight contract: PASS")
