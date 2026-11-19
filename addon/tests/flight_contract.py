"""Local flight timing, arrival checks and the route bar (Lua 5.1)."""
from pathlib import Path
from lupa.lua51 import LuaRuntime

ROOT = Path(__file__).parents[1]
WORLD = r'''
now, flying, landing, faction = 0, false, 'Coppercloud Quay', 'Horde'
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
UnitFactionGroup = function() return faction end
SetPortraitTexture = function(texture, unit) texture.unit = unit end
hooksecurefunc = function(name, fn) hooks[name] = fn end
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
function Frame:SetTexture(path) self.path = path; return path ~= rejectedTexture end
function Frame:SetStatusBarTexture(path) self.path = path end
function Frame:SetValue(value) self.value = value end
function Frame:SetText(text) self.text = text end
function Frame:Show() self.shown = true end
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
    assert 0 < lua.eval("Everloot.Flight.frame.bar.value") < .9
    lua.execute("arrive(60)")
    assert not lua.eval("Everloot.Flight.frame.shown")
    assert lua.eval("EverlootDB.flights.Glasswind['Coppercloud Quay|Amberwing Rest'][1]") == 120
    assert lua.eval("#printed") == 1
    assert "timed: 2:00" in lua.eval("printed[1]")
    lua.execute("depart(); tick(40)")
    assert "about 1:20 left" in lua.eval("Everloot.Flight.frame.label.text")
    assert abs(lua.eval("Everloot.Flight.frame.bar.value") - 1 / 3) < .001
    assert lua.eval("Everloot.Flight.frame.marker.point[4]") > start
    lua.execute("tick(200)")
    assert lua.eval("Everloot.Flight.frame.bar.value") == 1
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
    assert lua.eval("Everloot.Flight.frame.bar.value") == .9
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
    lua = fresh("UIParent.w = 600; faction = secret; SetPortraitTexture = function() error('unavailable') end")
    lua.execute("depart()")
    assert lua.eval("Everloot.Flight.frame.w") == 320
    assert lua.eval("Everloot.Flight.frame.mount.path").endswith("TaxiGossipIcon")


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
    assert lua.eval("Everloot.Flight.frame.mount.path").endswith("Ability_Mount_Wyvern_01")
    lua.execute("SlashCmdList.EVERLOOT('flight off')")
    assert not lua.eval("Everloot.Flight.frame.shown")
    lua.execute("arrive(60)")
    assert lua.eval("EverlootDB.flights == nil")
    for faction, icon in [("Alliance", "Ability_Mount_Gryphon_01"), ("Other", "TaxiGossipIcon")]:
        lua = fresh(f"faction = '{faction}'")
        lua.execute("depart()")
        assert lua.eval("Everloot.Flight.frame.mount.path").endswith(icon)
    lua = fresh(r"rejectedTexture = 'Interface\\Icons\\Ability_Mount_Wyvern_01'")
    lua.execute("depart()")
    assert lua.eval("Everloot.Flight.frame.mount.path").endswith("TaxiGossipIcon")


if __name__ == "__main__":
    for name, test in list(globals().items()):
        if name.startswith("test_"):
            test()
            print(f"PASS {name}")
    print("Flight contract: PASS")
