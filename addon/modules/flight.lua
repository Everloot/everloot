-- A local flight clock. Only an arrival we can confirm teaches the next trip's estimate.
local E = Everloot
local F = {}
E.Flight = F
local pending, active, driver
local poll = 0
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
  -- Separate squares need no client-specific tiling texture and stay eight pixels apart.
  for x = 0, f.length, 8 do
    local dot = f:CreateTexture(nil, "BACKGROUND")
    dot:SetTexture("Interface\\Buttons\\WHITE8X8")
    dot:SetSize(x == 0 and 6 or 3, x == 0 and 6 or 3)
    dot:SetPoint("CENTER", f, "TOPLEFT", 16 + x, -12)
    dot:SetVertexColor(unpack(tone("muted")))
  end
  local bar = CreateFrame("StatusBar", nil, f)
  bar:SetPoint("TOPLEFT", f, "TOPLEFT", 16, -10)
  bar:SetSize(f.length, 4)
  bar:SetStatusBarTexture("Interface\\TargetingFrame\\UI-StatusBar")
  bar:SetStatusBarColor(unpack(tone("accent")))
  bar:SetMinMaxValues(0, 1)
  f.bar = bar
  local crest = f:CreateTexture(nil, "OVERLAY")
  crest:SetTexture((E.Window and E.Window.CREST) or "Interface\\AddOns\\Everloot\\media\\crest")
  crest:SetSize(20, 20)
  crest:SetPoint("CENTER", f, "TOPLEFT", width - 16, -12)
  f.crest = crest
  local marker = CreateFrame("Frame", nil, f)
  marker:SetSize(24, 24)
  marker:SetFrameLevel(bar:GetFrameLevel() + 1)
  f.marker = marker
  local portrait = marker:CreateTexture(nil, "ARTWORK")
  portrait:SetAllPoints(marker)
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
  local mount = marker:CreateTexture(nil, "OVERLAY")
  mount:SetSize(16, 16)
  mount:SetPoint("LEFT", marker, "RIGHT", 1, 0)
  local faction = read(UnitFactionGroup, "player")
  local icon = faction == "Horde" and "Interface\\Icons\\Ability_Mount_Wyvern_01"
    or faction == "Alliance" and "Interface\\Icons\\Ability_Mount_Gryphon_01"
  local ok, loaded
  if icon then ok, loaded = pcall(mount.SetTexture, mount, icon) end
  if not ok or loaded == false then mount:SetTexture("Interface\\GossipFrame\\TaxiGossipIcon") end
  f.mount = mount
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
  f.bar:SetValue(progress)
  f.marker:ClearAllPoints()
  f.marker:SetPoint("CENTER", f, "TOPLEFT", 16 + f.length * progress, -12)
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
      active.duration = active.key and median(active)
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
  if not (type(C_TaxiMap) == "table" and C_TaxiMap.GetAllTaxiNodes and type(FlightMapFrame) == "table") then return {} end
  local mapId = read(FlightMapFrame.GetMapID, FlightMapFrame)
  local list = type(mapId) == "number" and read(C_TaxiMap.GetAllTaxiNodes, mapId)
  if type(list) ~= "table" then return {} end
  local current = type(Enum) == "table" and type(Enum.FlightPathState) == "table" and Enum.FlightPathState.Current
  local bySlot = {}
  for _, node in ipairs(list) do
    if type(node) == "table" then
      local n = name(E.Readable(node.name))
      if n and type(node.slotIndex) == "number" then bySlot[node.slotIndex] = n end
      if n and current ~= nil and node.state == current then bySlot.current = n end
    end
  end
  return bySlot
end

local function selected(index)
  if not E:IsEnabled("flight") or active then return end
  local now = clock()
  if not now then return end
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
  local realm = name(read(GetRealmName))
  pending = { origin = origin, destination = destination, realm = realm, selected = now }
  if origin and destination and realm and origin ~= destination then pending.key = origin .. "|" .. destination end
  watch()
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
  end
  for _, event in ipairs({ "PLAYER_CONTROL_LOST", "PLAYER_CONTROL_GAINED", "TAXIMAP_CLOSED", "PLAYER_LOGOUT" }) do
    pcall(E.frame.RegisterEvent, E.frame, event)
  end
  E.frame:HookScript("OnEvent", function(_, event)
    if event == "PLAYER_LOGOUT" then F.Clear()
    elseif event == "PLAYER_CONTROL_LOST" then
      if E:IsEnabled("flight") then watch(); check() end
    elseif event == "PLAYER_CONTROL_GAINED" or event == "TAXIMAP_CLOSED" then
      if pending or active then check() end
    end
  end)
  return "ready (local route timing; arrival must be confirmed)"
end)
