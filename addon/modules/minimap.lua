-- A button at the top-left of the minimap: how every other addon in the game is found, and a way
-- into Everloot's panel without typing a command. A client without a minimap gets nothing.

local E = Everloot
local M = {}
E.Minimap = M

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
  button:SetSize(26, 26)
  button:SetPoint("TOPLEFT", Minimap, "TOPLEFT", 0, 0)
  if button.SetFrameStrata then button:SetFrameStrata("MEDIUM") end
  -- The face is Everloot's crest: already a round badge (ring, dark face, the diamond), so it fills the button.
  local icon = button:CreateTexture(nil, "ARTWORK")
  if icon then
    icon:SetSize(26, 26)
    icon:SetPoint("CENTER")
    icon:SetTexture("Interface\\AddOns\\Everloot\\media\\crest")
    button.icon = icon
  end
  -- The game's own round glow for minimap buttons on hover.
  if button.SetHighlightTexture then button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight", "ADD") end
  button:SetScript("OnClick", function(_, mouseButton)
    -- Left: the Everloot window, or the plan workspace when the window is off or has failed this session.
    if mouseButton ~= "RightButton" and E.Window and E:IsEnabled("window") and not E.Window.failed and E.Window.Toggle() then return end
    if mouseButton ~= "RightButton" and E.Planner then E.Planner.Open()
    elseif E.Options and E.Options.Open then E.Options.Open() end
  end)
  -- What the three actions do. Hooked, not set: the drawer hooks the same hover to open, and both must run.
  button:HookScript("OnEnter", function(self)
    if type(GameTooltip) ~= "table" then return end
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("Everloot")
    GameTooltip:AddLine("Left-click: open the Everloot window")
    GameTooltip:AddLine("Right-click: open the settings")
    GameTooltip:AddLine("Hover: use other addons' buttons gathered here")
    GameTooltip:Show()
  end)
  button:HookScript("OnLeave", function()
    if type(GameTooltip) == "table" then GameTooltip:Hide() end
  end)
  if button.RegisterForClicks then button:RegisterForClicks("LeftButtonUp", "RightButtonUp") end
  M.button = button
  return button
end

E:RegisterModule("minimap", function()
  if not M.Enabled() then return "off (the minimap button is switched off; /everloot window opens the window)" end
  if M.Button() then return "ready (a button at the top-left of the minimap)" end
  return "no minimap on this client; /everloot options still opens the panel"
end)
