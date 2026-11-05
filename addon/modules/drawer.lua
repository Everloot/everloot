-- The button drawer: other addons' minimap buttons gather into the Everloot minimap button, and hovering the
-- crest shows them in a small grid beside it. Only LibDBIcon buttons (frames named LibDBIcon10_<name> on the
-- minimap) are taken; Blizzard frames and any other button are never touched. The crest's clicks stay as
-- they are. Off (/everloot buttons off or the settings page) collects nothing, and the buttons already taken
-- go back to the minimap with the next /reload. Records nothing.

local E = Everloot
local D = { collected = {} }
E.Drawer = D

local PREFIX = "LibDBIcon10_"
local COLUMNS = 6
local CELL = 32 -- a LibDBIcon button is 31 pixels square
local PAD = 6
local POLL_SECONDS = 0.25 -- how often an open drawer checks whether the mouse has left
local NOTICE_SECONDS = 5 -- the notice waits for the other addons' buttons to settle, so the count is right
local RESCANS = { 3, 10 } -- seconds after entering the world: buttons some addons make late

local collectedSet = {}
local original = {} -- per button: the frame type's own SetPoint and ClearAllPoints, for our layout
local polling, noticeScheduled, hooked = false, false, false
local function noop() end

local function after(seconds, f)
  if C_Timer and C_Timer.After then pcall(C_Timer.After, seconds, f) end
end

local function count()
  local n = #D.collected
  E:SetNote("buttons", n == 0 and "ready (no addon buttons to gather yet)"
    or string.format("ready (%d addon %s in the Everloot minimap button; hover it)", n, n == 1 and "button" or "buttons"))
  return n
end

--- A LibDBIcon button on the minimap: a named frame, LibDBIcon10_ plus the addon's name, parented to Minimap.
local function isAddonButton(frame)
  if type(frame) ~= "table" or collectedSet[frame] then return false end
  if type(frame.GetName) ~= "function" or type(frame.GetParent) ~= "function" then return false end
  local ok, name = pcall(frame.GetName, frame)
  if not ok or type(name) ~= "string" or #name <= #PREFIX or name:sub(1, #PREFIX) ~= PREFIX then return false end
  local okParent, parent = pcall(frame.GetParent, frame)
  return okParent and parent == Minimap
end

local function drawer()
  if D.frame then return D.frame end
  local template = BackdropTemplateMixin and "BackdropTemplate" or nil
  local f = CreateFrame("Frame", "EverlootButtonDrawer", UIParent or D.crest, template)
  f:SetFrameStrata("DIALOG")
  -- Opens to the left of the crest, which sits at the minimap's top-left corner.
  f:SetPoint("TOPRIGHT", D.crest, "TOPLEFT", -2, 0)
  if f.SetBackdrop then
    f:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = true, tileSize = 16, edgeSize = 12, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    if f.SetBackdropColor then f:SetBackdropColor(0.05, 0.05, 0.07, 0.95) end
  end
  f:Hide()
  D.frame = f
  return f
end

--- Places the shown buttons in rows of COLUMNS and sizes the drawer to fit. Returns how many are shown.
local function layout()
  local f, shown = drawer(), 0
  for _, b in ipairs(D.collected) do
    local own = original[b]
    own.ClearAllPoints(b)
    if b:IsShown() then
      local column, row = shown % COLUMNS, math.floor(shown / COLUMNS)
      own.SetPoint(b, "TOPLEFT", f, "TOPLEFT", PAD + column * CELL, -(PAD + row * CELL))
      b:SetAlpha(1)
      shown = shown + 1
    end
  end
  local columns, rows = math.min(math.max(shown, 1), COLUMNS), math.max(1, math.ceil(shown / COLUMNS))
  f:SetSize(PAD * 2 + columns * CELL, PAD * 2 + rows * CELL)
  return shown
end

local function notice()
  local n = #D.collected
  if n == 0 or EverlootDB.buttonsNotice then return end
  EverlootDB.buttonsNotice = true
  print(string.format("Everloot: %d addon %s now in the Everloot minimap button; hover over it to use %s. /everloot buttons off puts %s back.",
    n, n == 1 and "button is" or "buttons are", n == 1 and "it" or "them", n == 1 and "it" or "them"))
end

--- Takes one button into the drawer. LibDBIcon moves its buttons around the minimap whenever it updates
--- them, so this button's own SetPoint and ClearAllPoints become no-ops; the drawer places it with the frame
--- type's methods saved first. Its drag scripts go too: it has no place on the minimap to be dragged to.
local function collect(b)
  if not isAddonButton(b) then return end
  local f = drawer()
  original[b] = { SetPoint = b.SetPoint, ClearAllPoints = b.ClearAllPoints }
  b:SetParent(f)
  b.SetPoint, b.ClearAllPoints = noop, noop
  b:SetScript("OnDragStart", nil)
  b:SetScript("OnDragStop", nil)
  -- LibDBIcon sets its own strata and level; above the drawer's background, or the panel would cover them.
  if b.SetFrameStrata then b:SetFrameStrata("DIALOG") end
  if b.SetFrameLevel then b:SetFrameLevel((tonumber(f.GetFrameLevel and f:GetFrameLevel()) or 1) + 5) end
  collectedSet[b] = true
  D.collected[#D.collected + 1] = b
  table.sort(D.collected, function(x, y) return x:GetName() < y:GetName() end)
  layout()
  if not EverlootDB.buttonsNotice and not noticeScheduled then
    noticeScheduled = true
    after(NOTICE_SECONDS, notice)
  end
end

local function scan()
  if type(Minimap) ~= "table" or type(Minimap.GetChildren) ~= "function" then return end
  local ok, children = pcall(function() return { Minimap:GetChildren() } end)
  if not ok then return end
  for _, child in ipairs(children) do pcall(collect, child) end
  count()
end

--- Buttons an addon makes after login arrive through LibDBIcon's own callback, once LibStub and the library exist.
local function hook()
  if hooked or LibStub == nil then return end
  local ok, lib = pcall(LibStub, "LibDBIcon-1.0", true)
  if not ok or type(lib) ~= "table" or type(lib.RegisterCallback) ~= "function" then return end
  hooked = pcall(lib.RegisterCallback, D, "LibDBIcon_IconCreated", function(_, button)
    pcall(collect, button)
    count()
  end)
end

local function poll()
  local f = D.frame
  -- A little slack around the drawer, so crossing the gap from the crest does not close it.
  if D.crest:IsMouseOver() or (f:IsShown() and f:IsMouseOver(4, -4, -4, 4)) then
    after(POLL_SECONDS, poll)
  else
    f:Hide()
    polling = false
  end
end

--- Hovering the crest: the drawer, when there is at least one shown button to put in it.
local function open()
  if not D.frame or #D.collected == 0 or layout() == 0 then return end
  D.frame:Show()
  if not polling then
    polling = true
    after(POLL_SECONDS, poll)
  end
end

E:RegisterModule("buttons", function()
  if not (C_Timer and C_Timer.After) then error("C_Timer.After unavailable (the drawer could not close), buttons left in place", 0) end
  D.crest = E.Minimap and E.Minimap.Button()
  if not D.crest or type(D.crest.HookScript) ~= "function" then error("no minimap button to gather into", 0) end
  D.crest:HookScript("OnEnter", open)
  hook()
  local f = E.frame
  f:RegisterEvent("PLAYER_LOGIN")
  f:RegisterEvent("PLAYER_ENTERING_WORLD")
  f:HookScript("OnEvent", function(_, event)
    if event ~= "PLAYER_LOGIN" and event ~= "PLAYER_ENTERING_WORLD" then return end
    hook()
    scan()
    if event == "PLAYER_LOGIN" then return end
    for _, seconds in ipairs(RESCANS) do after(seconds, function() hook(); scan() end) end
  end)
  return "ready (no addon buttons to gather yet)"
end)
