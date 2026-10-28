-- A button at the top-left of the minimap: how every other addon in the game is found, and a way
-- into Everloot's panel without typing a command. A client without a minimap gets nothing.

local E = Everloot
local M = {}
E.Minimap = M

--- The button, once. Returns the frame or nil when the client has no minimap to sit on.
function M.Button()
  if M.button then return M.button end
  if type(Minimap) ~= "table" or type(Minimap) == "userdata" then return nil end
  if type(Minimap) == "table" and type(Minimap.IsObjectType) == "function" and not Minimap:IsObjectType("Frame") then return nil end
  local button = CreateFrame("Button", "EverlootMinimapButton", Minimap)
  if not button then return nil end
  button:SetSize(26, 26)
  button:SetPoint("TOPLEFT", Minimap, "TOPLEFT", 0, 0)
  if button.SetFrameStrata then button:SetFrameStrata("MEDIUM") end
  local icon = button:CreateTexture(nil, "ARTWORK")
  if icon then
    icon:SetSize(20, 20)
    icon:SetPoint("CENTER")
    icon:SetTexture("Interface\\Icons\\INV_Misc_Book_09")
    button.icon = icon
  end
  button:SetScript("OnClick", function(_, mouseButton)
    if mouseButton ~= "RightButton" and E.Planner then E.Planner.Open()
    elseif E.Options and E.Options.Open then E.Options.Open() end
  end)
  if button.RegisterForClicks then button:RegisterForClicks("LeftButtonUp", "RightButtonUp") end
  M.button = button
  return button
end

E:RegisterModule("minimap", function()
  if M.Button() then return "ready (a button at the top-left of the minimap)" end
  return "no minimap on this client; /everloot options still opens the panel"
end)
