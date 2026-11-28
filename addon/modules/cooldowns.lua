-- Long profession cooldowns for the characters on this install. The only saved data is
-- their cooldown state and server expiry, keyed like the local roster, outside upload records.
local E = Everloot
local C = {}
E.Cooldowns = C

-- Client data supplies candidate spell IDs. Every countdown comes from a live read.
local RECIPES = E.RECIPE_COOLDOWNS.limited
local BASIC_CAMPFIRE = 818
local SALT_SHAKER = 15846
local MAX_DURATION = 14 * 24 * 60 * 60
local MAX_RECIPES, CHUNK = 1024, 40
local queued, waiting = false, true
local windowOpen, windowRequested, windowRevision = false, false, 0
local refreshTracker

local function read(fn, ...)
  if type(fn) ~= "function" then return end
  local ok, a, b, c = pcall(fn, ...)
  if ok then return E.Readable(a), E.Readable(b), E.Readable(c) end
end

local function number(value)
  return type(value) == "number" and value == value and value >= 0 and value < math.huge
end

local function remaining(start, duration, enabled, uptime)
  if (enabled ~= true and enabled ~= 1) or not number(start) or not number(duration) then return nil end
  if start == 0 and duration == 0 then return 0 end
  -- A global recovery, a held spell or an implausible timer is an inconclusive read.
  if duration < 60 or duration > MAX_DURATION or start == 0 or start > uptime then return nil end
  return math.max(0, start + duration - uptime)
end

local function spellRemaining(id, uptime)
  local data = read(C_Spell and C_Spell.GetSpellCooldown, id)
  if type(data) ~= "table" then return nil end
  local rate = E.Readable(data.modRate)
  if rate ~= 1 then return nil end
  return remaining(E.Readable(data.startTime), E.Readable(data.duration), E.Readable(data.isEnabled), uptime)
end

local function spellKnown(id)
  local known = read(IsPlayerSpell, id)
  if type(known) == "boolean" then return known end
  return read(C_SpellBook and C_SpellBook.IsSpellKnown, id)
end

local function saveTimer(stored, id, name, seconds, now, fromRecipe)
  local previous = stored[id]
  if seconds == nil and not previous and not name then return end
  stored[id] = {
    name = name or (previous and previous.name),
    readyAt = seconds and (now + math.ceil(seconds)) or (previous and previous.readyAt),
    unknown = seconds == nil or nil,
    fromRecipe = fromRecipe or (previous and previous.fromRecipe),
  }
end

local function spellTimer(stored, id, now, uptime)
  local previous = stored[id]
  local known = spellKnown(id)
  -- The profession window can report a cooldown that the spellbook cannot see.
  if previous and previous.fromRecipe and (known ~= true or (number(previous.readyAt) and previous.readyAt > now)) then return end
  if known == false then stored[id] = nil; return end
  if known == true then
    local name = read(C_Spell and C_Spell.GetSpellName, id)
    if type(name) == "string" and name ~= "" then
      saveTimer(stored, id, name, spellRemaining(id, uptime), now)
      return
    end
  end
  if previous then saveTimer(stored, id, nil, nil, now) end
end

local function recipeCooldown(api, id)
  local ok, seconds = pcall(api.GetRecipeCooldown, id)
  if not ok or (issecretvalue and issecretvalue(seconds)) then return nil end
  if seconds == nil then return 0 end
  if number(seconds) and seconds <= MAX_DURATION then return seconds end
end

local function scanRecipeWindow(key, stored)
  local api = C_TradeSkillUI
  if not (windowOpen and api and type(api.GetRecipeCooldown) == "function")
    or read(api.IsTradeSkillLinked) or read(api.IsTradeSkillGuild) or read(api.IsNPCCrafting)
    or read(api.IsDataSourceChanging) then return end
  local ids = read(api.GetAllRecipeIDs)
  if type(ids) ~= "table" then ids = read(api.GetFilteredRecipeIDs) end
  if type(ids) ~= "table" then return end
  local revision, last, index = windowRevision, math.min(#ids, MAX_RECIPES), 1
  local function step()
    if not windowOpen or revision ~= windowRevision or key ~= E.CharacterKey()
      or not E:IsEnabled("roster") or read(api.IsDataSourceChanging) then return end
    if read(InCombatLockdown) then windowRequested, waiting = true, true; return end
    local now = read(GetServerTime)
    if not number(now) or now == 0 then return end
    local stop = math.min(last, index + CHUNK - 1)
    for i = index, stop do
      local id = E.Readable(ids[i])
      local info = number(id) and read(api.GetRecipeInfo, id)
      if type(info) == "table" and not E.Readable(info.isDummyRecipe) then
        local learned = E.Readable(info.learned)
        if learned == false then
          stored[id] = nil
        elseif learned == true then
          local name = E.Readable(info.name)
          local seconds = recipeCooldown(api, id)
          if type(name) == "string" and name ~= "" and ((seconds and seconds > 0) or stored[id]) then
            saveTimer(stored, id, name, seconds, now, true)
            EverlootDB.professionCooldowns[key] = stored
          end
        end
      end
    end
    index = stop + 1
    if index <= last then C_Timer.After(0, step)
    elseif C.tracker then refreshTracker() end
  end
  step()
end

local function scan()
  if not E:IsEnabled("roster") then return end
  if read(InCombatLockdown) then waiting = true; return end
  waiting = false
  local key = E.CharacterKey()
  local now, uptime = read(GetServerTime), read(GetTime)
  if not key or not number(now) or now == 0 or not number(uptime) then
    waiting = true
    return
  end

  EverlootDB.professionCooldowns = EverlootDB.professionCooldowns or {}
  local all = EverlootDB.professionCooldowns
  local stored = all[key] or {}
  for id in pairs(RECIPES) do
    spellTimer(stored, id, now, uptime)
  end
  spellTimer(stored, BASIC_CAMPFIRE, now, uptime)
  for id in pairs(stored) do
    if type(id) == "number" and id ~= BASIC_CAMPFIRE and not RECIPES[id] then spellTimer(stored, id, now, uptime) end
  end
  local count = read(C_Item and C_Item.GetItemCount, SALT_SHAKER, false)
  if count == 0 then
    stored.saltShaker = nil
  elseif number(count) or stored.saltShaker then
    local start, duration, enabled = read(C_Container and C_Container.GetItemCooldown, SALT_SHAKER)
    saveTimer(stored, "saltShaker", "Salt Shaker", number(count) and remaining(start, duration, enabled, uptime), now)
  end
  all[key] = next(stored) and stored or nil
  if windowRequested then
    windowRequested = false
    scanRecipeWindow(key, stored)
  end
end

local function queue()
  if queued or not E:IsEnabled("roster") then return end
  queued = true
  C_Timer.After(0.25, function()
    queued = false
    scan()
    if C.tracker then refreshTracker() end
  end)
end

function C.Forget(key)
  if EverlootDB and EverlootDB.professionCooldowns then EverlootDB.professionCooldowns[key] = nil end
end

function C.Rows()
  local rows = {}
  local all = EverlootDB and EverlootDB.professionCooldowns
  if not all or not E:IsEnabled("roster") then return rows end
  local now, current = read(GetServerTime), E.CharacterKey()
  for _, character in ipairs(E.Roster.Rows()) do
    local saved = all[character.key]
    if saved then
      local name = character.name or "Unknown character"
      if character.surname then name = name .. " " .. character.surname end
      for id, timer in pairs(saved) do
        if type(timer) == "table" and (timer.name or id == "saltShaker") then
          local seconds
          if not timer.unknown and number(now) and now > 0 and number(timer.readyAt)
            and not (character.key == current and (queued or waiting)) then
            seconds = math.max(0, timer.readyAt - now)
          end
          rows[#rows + 1] = {
            key = character.key, character = name, realm = character.realm, class = character.class,
            current = character.key == current, name = timer.name or "Salt Shaker", remaining = seconds,
            state = seconds == 0 and "ready" or (seconds and "cooling" or "unknown"),
          }
        end
      end
    end
  end
  table.sort(rows, function(a, b)
    if a.state == "cooling" and b.state ~= "cooling" then return true end
    if b.state == "cooling" and a.state ~= "cooling" then return false end
    if a.remaining ~= b.remaining then return (a.remaining or math.huge) < (b.remaining or math.huge) end
    if a.character ~= b.character then return a.character < b.character end
    if a.name ~= b.name then return a.name < b.name end
    return a.key < b.key
  end)
  return rows
end

local WIDTH, ROWS, ROW_HEIGHT, SUMMARY_HEIGHT = 284, 6, 21, 23
local DEFAULT_ICON = "Interface\\Icons\\INV_Misc_QuestionMark"
local CLASS_ICONS = "Interface\\Glues\\CharacterCreate\\UI-CharacterCreate-Classes"

local function status(row)
  if row.state == "ready" then return "Ready" end
  if row.state == "unknown" then return "Unknown" end
  local minutes = math.ceil(row.remaining / 60)
  if minutes < 60 then return string.format("%dm", minutes) end
  if minutes < 1440 then return string.format("%dh %02dm", math.floor(minutes / 60), minutes % 60) end
  return string.format("%dd %dh", math.floor(minutes / 1440), math.floor(minutes / 60) % 24)
end

local function paintRow(line, row, showRealm)
  local colors = E.Window.COLORS
  local name = row.character
  if showRealm and row.realm then name = name .. " (" .. row.realm .. ")" end
  line.character:SetText(name:gsub("|", "||"))
  local color = RAID_CLASS_COLORS and RAID_CLASS_COLORS[row.class]
  if color then line.character:SetTextColor(color.r, color.g, color.b)
  else line.character:SetTextColor(unpack(colors.text)) end
  line.name:SetText((row.name:gsub("^Transmute:%s*", "")):gsub("|", "||"))
  line.tooltip = row.name:gsub("|", "||")
  line.status:SetText(status(row))
  line.status:SetTextColor(unpack(row.state == "ready" and colors.accent or colors.muted))
  local class = CLASS_ICON_TCOORDS and CLASS_ICON_TCOORDS[row.class]
  line.icon:SetTexCoord(0, 1, 0, 1)
  if not (row.current and SetPortraitTexture and pcall(SetPortraitTexture, line.icon, "player")) then
    line.icon:SetTexture(class and CLASS_ICONS or DEFAULT_ICON)
    if class then line.icon:SetTexCoord(unpack(class)) end
  end
end

refreshTracker = function()
  local c = C.tracker
  local preference = EverlootDB.professionTrackerShown
  local rows = C.Rows()
  if not E:IsEnabled("roster") or preference == false or (preference == nil and #rows == 0) then
    c.panel:Hide()
    return
  end
  local currentIndex, coolingIndex
  for i, row in ipairs(rows) do
    if row.current then
      currentIndex = currentIndex or i
      if row.state == "cooling" then coolingIndex = i; break end
    end
  end
  local preview = #rows > 0 and table.remove(rows, coolingIndex or currentIndex or 1)
  local expanded = EverlootDB.professionTrackerExpanded == true and #rows > 0
  local lastPage = math.max(0, math.ceil(#rows / ROWS) - 1)
  c.offset = math.max(0, math.min(c.offset, lastPage))
  local firstRealm = preview and preview.realm
  local showRealm
  for _, row in ipairs(rows) do
    if row.realm then
      firstRealm = firstRealm or row.realm
      if row.realm ~= firstRealm then showRealm = true; break end
    end
  end
  if preview then
    paintRow(c.summary, preview, showRealm)
    c.summary.icon:Show(); c.summary.character:Show(); c.summary.name:Show(); c.summary.status:Show()
    c.empty:Hide()
  else
    c.summary.icon:Hide(); c.summary.character:Hide(); c.summary.name:Hide(); c.summary.status:Hide()
    c.summary.tooltip = nil
    c.empty:Show()
  end
  c.hasMore = #rows > 0
  if c.hasMore then
    c.arrow:SetText(expanded and "-" or "+")
    c.arrow:Show()
  else
    c.arrow:Hide()
  end
  local visible = 0
  for i, line in ipairs(c.rows) do
    local row = expanded and rows[c.offset * ROWS + i]
    if row then
      paintRow(line, row, showRealm)
      line:Show()
      visible = visible + 1
    else
      line:Hide()
    end
  end
  if expanded and c.offset > 0 then c.prev:Show() else c.prev:Hide() end
  if expanded and c.offset < lastPage then c.next:Show() else c.next:Hide() end
  c.panel:SetHeight(SUMMARY_HEIGHT + visible * ROW_HEIGHT + (expanded and lastPage > 0 and 24 or 0))
  c.panel:Show()
end

function C.ToggleTracker()
  if not C.tracker or not E:IsEnabled("roster") then return end
  EverlootDB.professionTrackerShown = not C.tracker.panel:IsShown()
  refreshTracker()
end

local function pager(panel, label, side, move)
  local b = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
  b:SetSize(78, 22)
  b:SetPoint(side, side == "BOTTOMLEFT" and 6 or -6, 4)
  b:SetText(label)
  b:SetScript("OnClick", function()
    C.tracker.offset = C.tracker.offset + move
    refreshTracker()
  end)
  return b
end

local function addRowContent(U, line)
  line.icon = line:CreateTexture(nil, "ARTWORK")
  line.icon:SetSize(16, 16)
  line.icon:SetPoint("LEFT", 5, 0)
  line.character = U.Text(line, 11)
  line.character:SetPoint("LEFT", 26, 0)
  line.character:SetWidth(130)
  line.character:SetJustifyH("LEFT")
  if line.character.SetWordWrap then line.character:SetWordWrap(false) end
  line.name = U.Text(line, 11)
  line.name:SetPoint("LEFT", 159, 0)
  line.name:SetWidth(64)
  line.name:SetJustifyH("LEFT")
  if line.name.SetWordWrap then line.name:SetWordWrap(false) end
  line.status = U.Text(line, 11, U.NARROW)
  line.status:SetPoint("RIGHT", -21, 0)
  line:EnableMouse(true)
  line:SetScript("OnEnter", function(self)
    if not (self.tooltip and GameTooltip) then return end
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:SetText(self.tooltip)
    GameTooltip:Show()
  end)
  line:SetScript("OnLeave", function()
    if GameTooltip and GameTooltip:IsOwned(line) then GameTooltip:Hide() end
  end)
end

local function buildTracker(U)
  local panel = CreateFrame("Frame", nil, UIParent)
  panel:SetWidth(WIDTH)
  panel:SetClampedToScreen(true)
  panel:SetMovable(true)
  U.Surface(panel)
  local pos = EverlootDB.professionTrackerPosition
  local map = MinimapCluster or Minimap
  if type(pos) == "table" and type(pos.x) == "number" and type(pos.y) == "number" then
    panel:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", pos.x, pos.y)
  elseif map then
    panel:SetPoint("TOPRIGHT", map, "BOTTOMRIGHT", -4, -8)
  else
    panel:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -24, -170)
  end

  local grip = CreateFrame("Button", nil, panel)
  grip:SetPoint("TOPLEFT", 0, 0)
  grip:SetSize(WIDTH, SUMMARY_HEIGHT)
  grip:EnableMouse(true)
  grip:SetScript("OnClick", function()
    if not C.tracker.hasMore then return end
    EverlootDB.professionTrackerExpanded = not EverlootDB.professionTrackerExpanded
    refreshTracker()
  end)
  grip:RegisterForDrag("LeftButton")
  grip:SetScript("OnDragStart", function() panel:StartMoving() end)
  grip:SetScript("OnDragStop", function()
    panel:StopMovingOrSizing()
    local right, top = panel:GetRight(), panel:GetTop()
    if not (right and top) then return end
    local x, y = right - UIParent:GetWidth(), top - UIParent:GetHeight()
    panel:ClearAllPoints()
    panel:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", x, y)
    EverlootDB.professionTrackerPosition = { x = x, y = y }
  end)
  addRowContent(U, grip)
  local c = { panel = panel, summary = grip, rows = {}, offset = 0 }
  c.arrow = U.Text(grip, 12, nil, U.COLORS.gold)
  c.arrow:SetPoint("RIGHT", -6, 0)
  c.empty = U.Text(grip, 11, nil, U.COLORS.muted)
  c.empty:SetPoint("LEFT", 8, 0)
  c.empty:SetText("No tracked cooldowns seen yet.")
  for i = 1, ROWS do
    local line = CreateFrame("Frame", nil, panel)
    line:SetPoint("TOPLEFT", 0, -SUMMARY_HEIGHT - (i - 1) * ROW_HEIGHT)
    line:SetSize(WIDTH, ROW_HEIGHT)
    addRowContent(U, line)
    c.rows[i] = line
  end
  c.prev = pager(panel, "Previous", "BOTTOMLEFT", -1)
  c.next = pager(panel, "Next", "BOTTOMRIGHT", 1)
  local elapsed = 0
  panel:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + dt
    if elapsed >= 1 then
      elapsed = 0
      refreshTracker()
    end
  end)
  C.tracker = c
  refreshTracker()
end

local EVENTS = {
  PLAYER_ENTERING_WORLD = true, SPELLS_CHANGED = true, SPELL_UPDATE_COOLDOWN = true,
  BAG_UPDATE_DELAYED = true, BAG_UPDATE_COOLDOWN = true,
}
local WINDOW_EVENTS = {
  TRADE_SKILL_SHOW = true, TRADE_SKILL_LIST_UPDATE = true, TRADE_SKILL_DATA_SOURCE_CHANGED = true,
  NEW_RECIPE_LEARNED = true, UNIT_SPELLCAST_SUCCEEDED = true,
}

E:RegisterModule("cooldowns", function()
  if not (C_Timer and C_Timer.After) then return "unavailable: no timer API" end
  for _, saved in pairs(EverlootDB.professionCooldowns or {}) do
    if saved.mooncloth and not saved[18560] then
      saved.mooncloth.name = "Mooncloth"
      saved[18560] = saved.mooncloth
    end
    -- The old aggregate cannot say which recipe was cooling down.
    saved.transmute, saved.mooncloth = nil, nil
  end
  if E.Window and UIParent then buildTracker(E.Window) end
  local f = E.frame
  for event in pairs(EVENTS) do pcall(f.RegisterEvent, f, event) end
  for event in pairs(WINDOW_EVENTS) do
    if event ~= "UNIT_SPELLCAST_SUCCEEDED" then pcall(f.RegisterEvent, f, event) end
  end
  pcall(f.RegisterUnitEvent, f, "UNIT_SPELLCAST_SUCCEEDED", "player")
  pcall(f.RegisterEvent, f, "TRADE_SKILL_CLOSE")
  pcall(f.RegisterEvent, f, "PLAYER_REGEN_ENABLED")
  f:HookScript("OnEvent", function(_, event)
    if event == "TRADE_SKILL_CLOSE" then
      windowOpen, windowRequested, windowRevision = false, false, windowRevision + 1
    elseif WINDOW_EVENTS[event] then
      if event == "TRADE_SKILL_SHOW" then windowOpen = true end
      if windowOpen then
        windowRequested, windowRevision = true, windowRevision + 1
        queue()
      end
    elseif EVENTS[event] or (event == "PLAYER_REGEN_ENABLED" and waiting) then queue() end
  end)
  return "ready (local profession cooldowns)"
end, "roster")
