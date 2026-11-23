-- Read only the realm-scoped public dungeon summary Desktop last wrote.
local E = Everloot
local green = { 0.612, 0.941, 0.227 }
local bar, shown

local function realmKey(realm)
  return realm:lower():gsub("’", "'"):gsub("[%s%-]+", " "):match("^%s*(.-)%s*$")
end

local function realmId(unit)
  local guid = E.Readable(UnitGUID(unit))
  return type(guid) == "string" and guid:match("^Player%-(%d+)%-")
end

local function addProgress(tooltip)
  if tooltip ~= GameTooltip or shown or not E:IsEnabled("completion") then return end
  local _, unit = tooltip:GetUnit()
  unit = E.Readable(unit)
  if type(unit) ~= "string" or not E.Readable(UnitIsPlayer(unit)) then return end
  local here = realmId("player")
  if not here or realmId(unit) ~= here then return end
  -- CurrentRealm may have a previously read realm for this same player GUID.
  local realm = E.CurrentRealm()
  if not realm then return end
  local snapshot = type(EverlootProgressDB) == "table" and EverlootProgressDB[realmKey(realm)]
  local catalog = E.InstanceData
  if type(snapshot) ~= "table" or not catalog or snapshot.catalog ~= catalog.build .. "/" .. catalog.asOf
    or type(snapshot.expiresAt) ~= "number" or snapshot.expiresAt <= time()
    or type(snapshot.total) ~= "number" or snapshot.total < 1 or snapshot.total > 100
    or type(snapshot.players) ~= "table" then return end
  local name, surname = UnitName(unit, true)
  name, surname = E.Readable(name), E.Readable(surname)
  if type(name) ~= "string" or type(surname) ~= "string" then return end
  local count = snapshot.players[name .. " " .. surname]
  if type(count) ~= "number" or count < 0 or count > snapshot.total then return end
  shown = true
  tooltip:AddLine(string.format("Everloot  %d/%d dungeons", count, snapshot.total), unpack(green))
  if bar then
    bar:SetMinMaxValues(0, snapshot.total)
    bar:SetValue(count)
    GameTooltip_InsertFrame(tooltip, bar)
  end
end

E:RegisterModule("player_progress", function()
  if not (GameTooltip and GameTooltip.GetUnit and TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall
    and Enum and Enum.TooltipDataType and Enum.TooltipDataType.Unit) then return "unavailable on this client" end
  if type(GameTooltip_InsertFrame) == "function" then
    bar = CreateFrame("StatusBar", nil, GameTooltip)
    bar:SetSize(76, 3)
    bar:SetStatusBarTexture("Interface\\TargetingFrame\\UI-StatusBar")
    bar:SetStatusBarColor(unpack(green))
    local back = bar:CreateTexture(nil, "BACKGROUND")
    back:SetAllPoints()
    back:SetColorTexture(0.23, 0.24, 0.21, 1)
    bar:Hide()
  end
  local function reset()
    shown = nil
    if bar then bar:Hide() end
  end
  GameTooltip:HookScript("OnTooltipCleared", reset)
  GameTooltip:HookScript("OnHide", reset)
  TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Unit, function(tooltip)
    pcall(addProgress, tooltip)
  end)
  return "ready (public dungeon progress from Everloot Desktop)"
end, "completion")
