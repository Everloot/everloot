-- Long profession cooldowns for the characters on this install. The only saved data is
-- their cooldown state and server expiry, keyed like the local roster, outside upload records.
local E = Everloot
local C = {}
E.Cooldowns = C

local TRACKED = {
  { key = "transmute", name = "Transmute", spells = { 11479, 11480, 17187, 17559, 17560, 17561, 17562, 17563, 17564, 17565, 17566, 25146 } },
  { key = "mooncloth", name = "Mooncloth", spells = { 18560 } },
  { key = "saltShaker", name = "Salt Shaker", item = 15846 },
}
local MAX_DURATION = 14 * 24 * 60 * 60
local queued, waiting = false, true
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

-- The first result is capability (true, false or unknown). The second is a reliable duration, if any.
local function sample(group, uptime)
  if group.item then
    local count = read(C_Item and C_Item.GetItemCount, group.item, false)
    if not number(count) then return nil end
    if count == 0 then return false end
    local start, duration, enabled = read(C_Container and C_Container.GetItemCooldown, group.item)
    return true, remaining(start, duration, enabled, uptime)
  end

  local known, uncertain, longest = false, false, 0
  for _, id in ipairs(group.spells) do
    local hasSpell = spellKnown(id)
    if hasSpell == true then
      known = true
      local seconds = spellRemaining(id, uptime)
      if seconds then longest = math.max(longest, seconds) else uncertain = true end
    elseif hasSpell ~= false then
      uncertain = true
    end
  end
  if uncertain then return known and true or nil end
  return known, longest
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
  for _, group in ipairs(TRACKED) do
    local known, seconds = sample(group, uptime)
    if known == false then
      stored[group.key] = nil
    elseif seconds then
      stored[group.key] = { readyAt = now + math.ceil(seconds) }
    elseif known or stored[group.key] then
      local previous = stored[group.key]
      stored[group.key] = { readyAt = previous and previous.readyAt, unknown = true }
    end
  end
  all[key] = next(stored) and stored or nil
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
      for _, group in ipairs(TRACKED) do
        local timer = saved[group.key]
        if timer then
          local seconds
          if not timer.unknown and number(now) and now > 0 and number(timer.readyAt)
            and not (character.key == current and (queued or waiting)) then
            seconds = math.max(0, timer.readyAt - now)
          end
          rows[#rows + 1] = {
            key = character.key, character = name, realm = character.realm, name = group.name, remaining = seconds,
            state = seconds == 0 and "ready" or (seconds and "cooling" or "unknown"),
          }
        end
      end
    end
  end
  table.sort(rows, function(a, b)
    if a.remaining ~= b.remaining then return (a.remaining or math.huge) < (b.remaining or math.huge) end
    if a.character ~= b.character then return a.character < b.character end
    if a.name ~= b.name then return a.name < b.name end
    return a.key < b.key
  end)
  return rows
end

local WIDTH, ROWS, ROW_HEIGHT = 286, 6, 19

local function status(row)
  if row.state == "ready" then return "Ready" end
  if row.state == "unknown" then return "Unknown" end
  local minutes = math.ceil(row.remaining / 60)
  if minutes < 60 then return string.format("%dm", minutes) end
  if minutes < 1440 then return string.format("%dh %02dm", math.floor(minutes / 60), minutes % 60) end
  return string.format("%dd %dh", math.floor(minutes / 1440), math.floor(minutes / 60) % 24)
end

refreshTracker = function()
  local c = C.tracker
  local preference = EverlootDB.professionTrackerShown
  local rows = C.Rows()
  if not E:IsEnabled("roster") or preference == false or (preference == nil and #rows == 0) then
    c.panel:Hide()
    return
  end
  local lastPage = math.max(0, math.ceil(#rows / ROWS) - 1)
  c.offset = math.max(0, math.min(c.offset, lastPage))
  local realms = {}
  for _, row in ipairs(rows) do
    if row.realm then realms[row.realm] = true end
  end
  local firstRealm = next(realms)
  local showRealm = firstRealm and next(realms, firstRealm) ~= nil
  local visible = 0
  local colors = E.Window.COLORS
  for i, line in ipairs(c.rows) do
    local row = rows[c.offset * ROWS + i]
    if row then
      local name = row.character
      if showRealm and row.realm then name = name .. " (" .. row.realm .. ")" end
      line.character:SetText(name:gsub("|", "||"))
      line.name:SetText(row.name)
      line.status:SetText(status(row))
      line.status:SetTextColor(unpack(row.state == "ready" and colors.accent or colors.muted))
      line:Show()
      visible = visible + 1
    else
      line:Hide()
    end
  end
  if visible == 0 then c.empty:Show() else c.empty:Hide() end
  if c.offset > 0 then c.prev:Show() else c.prev:Hide() end
  if c.offset < lastPage then c.next:Show() else c.next:Hide() end
  c.panel:SetHeight(34 + math.max(1, visible) * ROW_HEIGHT + (lastPage > 0 and 24 or 0))
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

  local grip = CreateFrame("Frame", nil, panel)
  grip:SetPoint("TOPLEFT", 0, 0)
  grip:SetSize(WIDTH - 30, 27)
  grip:EnableMouse(true)
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
  local title = U.Text(grip, 12, nil, U.COLORS.gold)
  title:SetPoint("LEFT", 8, 0)
  title:SetText("Profession cooldowns")
  local close = CreateFrame("Button", nil, panel, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", 3, 3)
  close:SetScript("OnClick", C.ToggleTracker)

  local c = { panel = panel, rows = {}, offset = 0 }
  c.empty = U.Text(panel, 12, nil, U.COLORS.muted)
  c.empty:SetPoint("TOPLEFT", 8, -30)
  c.empty:SetText("No tracked cooldowns seen yet.")
  for i = 1, ROWS do
    local line = CreateFrame("Frame", nil, panel)
    line:SetPoint("TOPLEFT", 0, -28 - (i - 1) * ROW_HEIGHT)
    line:SetSize(WIDTH, ROW_HEIGHT)
    line.character = U.Text(line, 12)
    line.character:SetPoint("LEFT", 8, 0)
    line.character:SetWidth(128)
    line.character:SetJustifyH("LEFT")
    if line.character.SetWordWrap then line.character:SetWordWrap(false) end
    line.name = U.Text(line, 12)
    line.name:SetPoint("LEFT", 142, 0)
    line.status = U.Text(line, 12, U.NARROW)
    line.status:SetPoint("RIGHT", -8, 0)
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

E:RegisterModule("cooldowns", function()
  if not (C_Timer and C_Timer.After) then return "unavailable: no timer API" end
  if E.Window and UIParent then buildTracker(E.Window) end
  local f = E.frame
  for event in pairs(EVENTS) do pcall(f.RegisterEvent, f, event) end
  pcall(f.RegisterEvent, f, "PLAYER_REGEN_ENABLED")
  f:HookScript("OnEvent", function(_, event)
    if EVENTS[event] or (event == "PLAYER_REGEN_ENABLED" and waiting) then queue() end
  end)
  return "ready (local profession cooldowns)"
end, "roster")
