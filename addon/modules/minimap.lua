-- A button on the minimap's edge, built and placed like every other addon's (LibDBIcon's), and a way into
-- Everloot's panel without typing a command. A client without a minimap gets nothing.

local E = Everloot
local M = {}
E.Minimap = M

local ANGLE = 135 -- degrees counter-clockwise from the right: the top-left of the ring, the drawer opening beside it
local RADIUS = 5 -- LibDBIcon's: how far past the minimap's edge a button's centre sits

--- Puts the button on the minimap's edge at an angle, with LibDBIcon's sums: around a round minimap, along the edge
--- of a square one (GetMinimapShape "SQUARE"). A minimap without a size (a test stub) leaves it where it is.
function M.Place(button, angle)
  local w = type(Minimap.GetWidth) == "function" and tonumber((Minimap:GetWidth()))
  local h = type(Minimap.GetHeight) == "function" and tonumber((Minimap:GetHeight()))
  if not (w and h) then return end
  w, h = w / 2 + RADIUS, h / 2 + RADIUS
  local a = math.rad(angle)
  local x, y = math.cos(a), math.sin(a)
  if type(GetMinimapShape) == "function" and GetMinimapShape() == "SQUARE" then
    local dw, dh = math.sqrt(2 * w ^ 2) - 10, math.sqrt(2 * h ^ 2) - 10
    x, y = math.max(-w, math.min(x * dw, w)), math.max(-h, math.min(y * dh, h))
  else
    x, y = x * w, y * h
  end
  button:ClearAllPoints()
  button:SetPoint("CENTER", Minimap, "CENTER", x, y)
end

--- The side of the minimap the button is on, "LEFT" or "RIGHT": the drawer and the tooltip open away from the map.
function M.Side()
  local b = M.button
  local bx = b and type(b.GetCenter) == "function" and b:GetCenter()
  local mx = type(Minimap.GetCenter) == "function" and Minimap:GetCenter()
  return (tonumber(bx) and tonumber(mx) and bx > mx) and "RIGHT" or "LEFT"
end

--- Dragging moves the button around the minimap, as with other addons' buttons, and the angle is kept.
local function follow(self)
  local mx, my = Minimap:GetCenter()
  local px, py = GetCursorPosition()
  local scale = Minimap:GetEffectiveScale()
  local angle = math.deg(math.atan2(py / scale - my, px / scale - mx)) % 360
  EverlootDB.minimapAngle = angle
  M.Place(self, angle)
end

--- A click: the Everloot window, or the plan workspace when the window is off or has failed this session.
--- A right click opens the options page.
function M.Click(mouseButton)
  if mouseButton ~= "RightButton" and E.Window and E:IsEnabled("window") and not E.Window.failed and E.Window.Toggle() then return end
  if mouseButton ~= "RightButton" and E.Planner then E.Planner.Open()
  elseif E.Options and E.Options.Open then E.Options.Open() end
end

-- The game's addon compartment (the TOC's AddonCompartmentFunc) reaches players who hide minimap buttons.
-- The one global this file adds; the compartment calls it by name.
function Everloot_OnAddonCompartmentClick(_, buttonName) M.Click(buttonName) end

--- False when the player turned the button off on the settings page (applies at load).
function M.Enabled()
  return not (EverlootDB and EverlootDB.minimapButton == false)
end

--- The button, once. Returns the frame or nil when the client has no minimap to sit on or the button is off.
function M.Button()
  if M.button then return M.button end
  if not M.Enabled() then return nil end
  if type(Minimap) ~= "table" or type(Minimap) == "userdata" then return nil end
  if type(Minimap) == "table" and type(Minimap.IsObjectType) == "function" and not Minimap:IsObjectType("Frame") then return nil end
  local button = CreateFrame("Button", "EverlootMinimapButton", Minimap)
  if not button then return nil end
  -- LibDBIcon's button on this UI (the one with the addon compartment): 31 pixels, MEDIUM strata, level 8, the gold
  -- tracking ring from the top-left corner over the dark round background, an 18-pixel icon in the middle.
  button:SetSize(31, 31)
  if button.SetFrameStrata then button:SetFrameStrata("MEDIUM") end
  if button.SetFrameLevel then button:SetFrameLevel(8) end
  local ring = button:CreateTexture(nil, "OVERLAY")
  if ring then
    ring:SetSize(50, 50)
    ring:SetPoint("TOPLEFT")
    ring:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
    button.ring = ring
  end
  local background = button:CreateTexture(nil, "BACKGROUND")
  if background then
    background:SetSize(24, 24)
    background:SetPoint("CENTER")
    background:SetTexture("Interface\\Minimap\\UI-Minimap-Background")
  end
  -- The face is the crest's diamond alone, cut from media/crest.tga as the tooltip header cuts it: the crest's
  -- own bronze ring would sit inside the gold one.
  local icon = button:CreateTexture(nil, "ARTWORK")
  if icon then
    icon:SetSize(18, 18)
    icon:SetPoint("CENTER")
    icon:SetTexture("Interface\\AddOns\\Everloot\\media\\crest")
    if icon.SetTexCoord then icon:SetTexCoord(36 / 128, 92 / 128, 36 / 128, 92 / 128) end
    button.icon = icon
  end
  -- The game's own round glow for minimap buttons on hover.
  if button.SetHighlightTexture then button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight", "ADD") end
  M.Place(button, tonumber(EverlootDB and EverlootDB.minimapAngle) or ANGLE)
  if button.RegisterForDrag then button:RegisterForDrag("LeftButton") end
  button:SetScript("OnDragStart", function(self)
    if type(GameTooltip) == "table" then GameTooltip:Hide() end
    self:SetScript("OnUpdate", follow)
  end)
  button:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)
  button:SetScript("OnClick", function(_, mouseButton) M.Click(mouseButton) end)
  -- What the three actions do. Hooked, not set: the drawer hooks the same hover to open, and both must run.
  button:HookScript("OnEnter", function(self)
    if type(GameTooltip) ~= "table" then return end
    -- Below the button, on the side away from the drawer.
    GameTooltip:SetOwner(self, M.Side() == "RIGHT" and "ANCHOR_BOTTOMLEFT" or "ANCHOR_BOTTOMRIGHT")
    GameTooltip:AddLine("Everloot")
    -- Each line says what the click does now: the window, or the plan workspace when the window is off or failed.
    local window = E.Window and E:IsEnabled("window") and not E.Window.failed
    GameTooltip:AddLine(window and "Left-click: open the Everloot window" or "Left-click: open the plan workspace")
    GameTooltip:AddLine("Right-click: open the settings")
    if E:IsEnabled("buttons") and E.Drawer and E.Drawer.collected and #E.Drawer.collected > 0 then
      GameTooltip:AddLine("Hover: show other addons' buttons")
    end
    GameTooltip:Show()
  end)
  button:HookScript("OnLeave", function()
    if type(GameTooltip) == "table" then GameTooltip:Hide() end
  end)
  if button.RegisterForClicks then button:RegisterForClicks("LeftButtonUp", "RightButtonUp") end
  -- Placed again at login, as LibDBIcon does, once an addon that reshapes the minimap has loaded.
  if E.frame then
    E.frame:RegisterEvent("PLAYER_LOGIN")
    E.frame:HookScript("OnEvent", function(_, event)
      if event == "PLAYER_LOGIN" then M.Place(button, tonumber(EverlootDB.minimapAngle) or ANGLE) end
    end)
  end
  M.button = button
  return button
end

E:RegisterModule("minimap", function()
  if not M.Enabled() then return "off (the minimap button is switched off; /everloot window opens the window)" end
  if M.Button() then return "ready (a button on the minimap's edge; drag it to move it)" end
  return "no minimap on this client; /everloot options still opens the panel"
end)
