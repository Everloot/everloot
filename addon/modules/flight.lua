-- A local flight clock. Only an arrival we can confirm teaches the next trip's estimate; until then a route's time
-- comes from the length of its hops in the game files (flight_data.lua).
local E = Everloot
local F = {}
E.Flight = F
local pending, active, driver
local poll = 0
-- Yards a second on a flight path. Blizzard publishes no figure; InFlight's measured Classic Era and Forever times
-- against these lengths give 30.0 (266 direct flights, median difference half a second; docs/sources/LEDGER.md).
F.SPEED = 30
local FALLBACK = {
  accent = { 0.612, 0.941, 0.227, 1 }, muted = { 0.788, 0.765, 0.69, 1 },
}

local function read(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, value = pcall(fn, ...)
  if not ok then return nil end
  local readable
  ok, value, readable = pcall(function()
    if issecretvalue and issecretvalue(value) then return nil, false end
    return E.Readable(value), true
  end)
  if ok then return value, readable end
end

local function name(value)
  return type(value) == "string" and value ~= "" and value or nil
end

local function clock()
  local value = read(GetTime)
  return type(value) == "number" and value or nil
end

local function tone(key)
  return (E.Window and E.Window.COLORS and E.Window.COLORS[key]) or FALLBACK[key]
end

local function stamp(seconds)
  seconds = math.max(0, math.ceil(seconds))
  return string.format("%d:%02d", math.floor(seconds / 60), seconds % 60)
end

local function samples(route)
  local realms = EverlootDB and EverlootDB.flights
  local realm = type(realms) == "table" and realms[route.realm]
  local values = type(realm) == "table" and realm[route.key]
  return type(values) == "table" and values or {}
end

local function median(route)
  local values = {}
  local saved = samples(route)
  for i = math.max(1, #saved - 2), #saved do
    local value = saved[i]
    if type(value) == "number" and value > 0 then values[#values + 1] = value end
  end
  if #values == 0 then return nil end
  table.sort(values)
  local middle = math.floor(#values / 2) + 1
  if #values == 2 then return (values[1] + values[2]) / 2 end
  return values[middle]
end

-- The row's spacing and sizes, in pixels: a grey diamond ahead, a filled one behind, the start one, the face.
local STEP, AHEAD, DIAMOND, FACE = 8, 4, 6, 28

local function build()
  if F.frame then return F.frame end
  local width = read(function() return UIParent:GetWidth() end)
  width = math.max(320, type(width) == "number" and width * 0.4 or 320)
  local f = CreateFrame("Frame", "EverlootFlight", UIParent)
  f:SetPoint("TOP", UIParent, "TOP", 0, -8)
  f:SetSize(width, 24)
  f:SetFrameStrata("HIGH")
  f:EnableMouse(false)
  f.length = width - 32
  -- The line is a row of small Everloot diamonds, eight pixels apart: a grey one ahead of the player, and a green one
  -- over it that grows as the flight passes, so the row fills like the logo. Plain squares turned a quarter: no
  -- client-specific texture.
  f.diamonds = {}
  local function diamond(layer, size, color, x)
    local d = f:CreateTexture(nil, layer)
    d:SetTexture("Interface\\Buttons\\WHITE8X8")
    if d.SetRotation then pcall(d.SetRotation, d, math.pi / 4) end
    d:SetSize(size, size)
    d:SetPoint("CENTER", f, "TOPLEFT", 16 + x, -12)
    d:SetVertexColor(unpack(tone(color)))
    return d
  end
  diamond("BORDER", DIAMOND, "accent", 0)
  for x = STEP, f.length, STEP do
    diamond("BACKGROUND", AHEAD, "muted", x)
    local fill = diamond("BORDER", 0, "accent", x)
    fill.x = x
    fill:Hide()
    f.diamonds[#f.diamonds + 1] = fill
  end
  local crest = f:CreateTexture(nil, "OVERLAY")
  crest:SetTexture((E.Window and E.Window.CREST) or "Interface\\AddOns\\Everloot\\media\\crest")
  crest:SetSize(20, 20)
  crest:SetPoint("CENTER", f, "TOPLEFT", width - 16, -12)
  f.crest = crest
  -- The player's face alone, ringed in green: the bar already says it is a flight.
  local marker = CreateFrame("Frame", nil, f)
  marker:SetSize(FACE + 4, FACE + 4)
  marker:SetFrameLevel((read(f.GetFrameLevel, f) or 1) + 2)
  f.marker = marker
  local ring = marker:CreateTexture(nil, "BORDER")
  ring:SetTexture("Interface\\CHARACTERFRAME\\TempPortraitAlphaMask")
  ring:SetAllPoints(marker)
  ring:SetVertexColor(unpack(tone("accent")))
  f.ring = ring
  local portrait = marker:CreateTexture(nil, "ARTWORK")
  portrait:SetSize(FACE, FACE)
  portrait:SetPoint("CENTER", marker, "CENTER", 0, 0)
  if type(SetPortraitTexture) == "function" then pcall(SetPortraitTexture, portrait, "player") end
  -- The portrait stays usable on a client without texture masks.
  if portrait.AddMaskTexture and marker.CreateMaskTexture then
    pcall(function()
      local mask = marker:CreateMaskTexture()
      mask:SetAllPoints(portrait)
      mask:SetTexture("Interface\\CHARACTERFRAME\\TempPortraitAlphaMask")
      portrait:AddMaskTexture(mask)
      f.mask = mask
    end)
  end
  f.portrait = portrait
  local label = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  label:SetPoint("TOP", f, "BOTTOM", 0, -2)
  label:SetWidth(width)
  label:SetTextColor(unpack(tone("accent")))
  f.label = label
  f:Hide()
  F.frame = f
  return f
end

local function paint(now)
  local f = build()
  local elapsed = math.max(0, now - active.started)
  local progress = active.duration and math.min(1, elapsed / active.duration) or math.min(0.9, elapsed / 180 * 0.9)
  f.progress = progress
  f.marker:ClearAllPoints()
  f.marker:SetPoint("CENTER", f, "TOPLEFT", 16 + f.length * progress, -12)
  -- A diamond fills while the face's trailing edge crosses the gap before it; those under the face stay grey.
  local edge = f.length * progress - (FACE / 2 + 2)
  for _, fill in ipairs(f.diamonds) do
    local share = math.max(0, math.min(1, (edge - fill.x + STEP) / STEP))
    if share > 0 then
      fill:SetSize(DIAMOND * share, DIAMOND * share)
      fill:Show()
    else
      fill:Hide()
    end
  end
  local text = active.duration and ("about " .. stamp(active.duration - elapsed) .. " left")
    or (active.key and "first flight on this route: timing it" or "timing unknown")
  -- Escape markup in client names before putting them in a font string. A flight whose selection the addon did
  -- not see (a /reload in the air) has no names and teaches nothing.
  local route = active.origin and active.destination
    and (active.origin:gsub("|", "||") .. " → " .. active.destination:gsub("|", "||") .. " · ") or "On a flight path · "
  f.label:SetText(route .. text)
  f:Show()
end

function F.Clear()
  pending, active = nil, nil
  if F.frame then F.frame:Hide() end
  if driver then driver:SetScript("OnUpdate", nil) end
end

-- A flight ends at the node the player chose unless they asked for an early landing (the hook marks the route) or
-- logged out (which clears it). The landing zone's text is not compared with the node's name: a node is named
-- "Town, Zone" and the zone text under it is something else, so that match would almost never confirm a trip.
-- A trip under this many seconds is a dismount at the start, not a flight.
local MIN_FLIGHT = 10
local function arrived(route, elapsed)
  return not route.cancelled and route.key ~= nil and elapsed >= MIN_FLIGHT
end

local function finish(now)
  local elapsed = now - active.started
  if arrived(active, elapsed) then
    local values = samples(active)
    values[#values + 1] = elapsed
    while #values > 3 do table.remove(values, 1) end
    EverlootDB.flights = EverlootDB.flights or {}
    EverlootDB.flights[active.realm] = EverlootDB.flights[active.realm] or {}
    EverlootDB.flights[active.realm][active.key] = values
    if not active.duration then
      print("Everloot: timed: " .. stamp(elapsed) .. ", next time you will see the time left.")
    end
  end
  F.Clear()
end

local function check()
  if not E:IsEnabled("flight") then F.Clear(); return end
  local now = clock()
  if not now then F.Clear(); return end
  local flying, readable = read(UnitOnTaxi, "player")
  if not readable then F.Clear(); return end
  if flying == true or flying == 1 then
    if not active then
      active = pending or {}
      pending = nil
      active.started = now
      active.duration = (active.key and median(active)) or active.estimate
    end
    paint(now)
  elseif flying == false or flying == nil or flying == 0 then
    if active then finish(now)
    elseif not pending or now - pending.selected > 30 then F.Clear() end
  elseif pending and now - pending.selected > 30 then
    F.Clear()
  end
end

local function watch()
  if not driver then driver = CreateFrame("Frame") end
  poll = 0
  driver:SetScript("OnUpdate", function(_, elapsed)
    poll = poll + elapsed
    if poll < 0.5 then return end
    poll = 0
    check()
  end)
end

-- The flight map (Blizzard_FlightMap, which the client's build ships) names its nodes through C_TaxiMap by the
-- map it shows, each with the slot index TakeTaxiNode gets; the older taxi frame names them by that index
-- directly. Both are read, so the route has names whichever frame the client opened.
local function mapNodes()
  if not (type(C_TaxiMap) == "table" and C_TaxiMap.GetAllTaxiNodes and type(FlightMapFrame) == "table") then return {}, {} end
  local mapId = read(FlightMapFrame.GetMapID, FlightMapFrame)
  local list = type(mapId) == "number" and read(C_TaxiMap.GetAllTaxiNodes, mapId)
  if type(list) ~= "table" then return {}, {} end
  local current = type(Enum) == "table" and type(Enum.FlightPathState) == "table" and Enum.FlightPathState.Current
  local bySlot, ids = {}, {}
  for _, node in ipairs(list) do
    if type(node) == "table" and type(node.slotIndex) == "number" then
      local n = name(E.Readable(node.name))
      if n then bySlot[node.slotIndex] = n end
      if n and current ~= nil and node.state == current then bySlot.current = n end
      local id = E.Readable(node.nodeID)
      if type(id) == "number" then ids[node.slotIndex] = id end
    end
  end
  return bySlot, ids
end

-- The game files' node ids for a name: the Alliance and Horde maps each have their own node at a shared place.
local byName
local function idsNamed(n)
  if not byName then
    byName = {}
    for id, text in pairs(type(E.FLIGHT_NODES) == "table" and E.FLIGHT_NODES or {}) do
      byName[text] = byName[text] or {}
      table.insert(byName[text], id)
    end
  end
  return n and byName[n] or {}
end

-- One hop's length: by node id when the flight map gives it, else by name, the pair that has a path.
local function hopYards(from, to)
  local yards = type(E.FLIGHT_YARDS) == "table" and E.FLIGHT_YARDS or {}
  local starts = from.id and { from.id } or idsNamed(from.name)
  local ends = to.id and { to.id } or idsNamed(to.name)
  for _, a in ipairs(starts) do
    for _, b in ipairs(ends) do
      if yards[a .. "-" .. b] then return yards[a .. "-" .. b] end
    end
  end
end

-- Seconds to a node from the game files: the hops the flight map draws for it, summed. Nil when a hop is unknown.
local function estimate(index)
  local hops = read(GetNumRoutes, index)
  if type(hops) ~= "number" or hops < 1 or hops > 50 then return nil end
  local names, ids = mapNodes()
  local function node(slot)
    return { id = ids[slot], name = name(read(TaxiNodeName, slot)) or names[slot] }
  end
  local total = 0
  for hop = 1, hops do
    local from, to = read(TaxiGetNodeSlot, index, hop, true), read(TaxiGetNodeSlot, index, hop, false)
    local yards = type(from) == "number" and type(to) == "number" and hopYards(node(from), node(to))
    if not yards then return nil end
    total = total + yards
  end
  return total / F.SPEED
end

-- The route to a node of the open flight map: its names, the realm, and the key its own timings are kept under.
local function routeTo(index)
  local destination = name(read(TaxiNodeName, index))
  local origin
  local count = read(NumTaxiNodes)
  if type(count) == "number" and count >= 1 and count <= 1000 then
    for i = 1, count do
      if read(TaxiNodeGetType, i) == "CURRENT" then origin = name(read(TaxiNodeName, i)); break end
    end
  end
  if not (origin and destination) then
    local nodes = mapNodes()
    destination = destination or nodes[index]
    origin = origin or nodes.current
  end
  local route = { origin = origin, destination = destination, realm = name(read(GetRealmName)) }
  if origin and destination and route.realm and origin ~= destination then route.key = origin .. "|" .. destination end
  return route
end

-- The time a tooltip shows for a node: this character's own timings of the route first, else the game files.
local function timeTo(index)
  local route = routeTo(index)
  return (route.key and median(route)) or estimate(index)
end

local function selected(index)
  if not E:IsEnabled("flight") or active then return end
  local now = clock()
  if not now then return end
  pending = routeTo(index)
  pending.selected = now
  pending.estimate = estimate(index)
  watch()
end

-- Adds the flight time under the cost in a destination's tooltip, on the flight map and on the older taxi frame.
local function tooltip(index)
  if not (E:IsEnabled("flight") and type(GameTooltip) == "table") then return end
  local seconds = timeTo(index)
  if not seconds then return end
  local r, g, b = unpack(tone("accent"))
  pcall(GameTooltip.AddLine, GameTooltip, "Flight: about " .. stamp(seconds), r, g, b)
  pcall(GameTooltip.Show, GameTooltip)
end

-- Blizzard_FlightMap loads on demand; its pins copy the mixin when they are made, so the hook goes in before the first.
local function hookFlightMap()
  if F.mapHooked or type(FlightMap_FlightPointPinMixin) ~= "table" then return end
  F.mapHooked = true
  pcall(hooksecurefunc, FlightMap_FlightPointPinMixin, "OnMouseEnter", function(pin)
    local data = type(pin) == "table" and pin.taxiNodeData
    local reachable = type(Enum) == "table" and type(Enum.FlightPathState) == "table" and Enum.FlightPathState.Reachable
    if type(data) == "table" and type(data.slotIndex) == "number" and reachable ~= nil and data.state == reachable then tooltip(data.slotIndex) end
  end)
end

E:RegisterModule("flight", function()
  if type(hooksecurefunc) == "function" then
    if type(TakeTaxiNode) == "function" then pcall(hooksecurefunc, "TakeTaxiNode", selected) end
    if type(TaxiRequestEarlyLanding) == "function" then
      pcall(hooksecurefunc, "TaxiRequestEarlyLanding", function()
        if active then active.cancelled = true end
        if pending then pending.cancelled = true end
      end)
    end
    if type(TaxiNodeOnButtonEnter) == "function" then
      pcall(hooksecurefunc, "TaxiNodeOnButtonEnter", function(button)
        local index = type(button) == "table" and read(button.GetID, button)
        if type(index) == "number" and read(TaxiNodeGetType, index) == "REACHABLE" then tooltip(index) end
      end)
    end
    hookFlightMap()
  end
  for _, event in ipairs({ "PLAYER_CONTROL_LOST", "PLAYER_CONTROL_GAINED", "TAXIMAP_CLOSED", "PLAYER_LOGOUT", "ADDON_LOADED" }) do
    pcall(E.frame.RegisterEvent, E.frame, event)
  end
  E.frame:HookScript("OnEvent", function(_, event, arg)
    if event == "ADDON_LOADED" then
      if arg == "Blizzard_FlightMap" and type(hooksecurefunc) == "function" then hookFlightMap() end
    elseif event == "PLAYER_LOGOUT" then F.Clear()
    elseif event == "PLAYER_CONTROL_LOST" then
      if E:IsEnabled("flight") then watch(); check() end
    elseif event == "PLAYER_CONTROL_GAINED" or event == "TAXIMAP_CLOSED" then
      if pending or active then check() end
    end
  end)
  return "ready (local route timing; arrival must be confirmed)"
end)
