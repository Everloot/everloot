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

local EVENTS = {
  PLAYER_ENTERING_WORLD = true, SPELLS_CHANGED = true, SPELL_UPDATE_COOLDOWN = true,
  BAG_UPDATE_DELAYED = true, BAG_UPDATE_COOLDOWN = true,
}

E:RegisterModule("cooldowns", function()
  if not (C_Timer and C_Timer.After) then return "unavailable: no timer API" end
  local f = E.frame
  for event in pairs(EVENTS) do pcall(f.RegisterEvent, f, event) end
  pcall(f.RegisterEvent, f, "PLAYER_REGEN_ENABLED")
  f:HookScript("OnEvent", function(_, event)
    if EVENTS[event] or (event == "PLAYER_REGEN_ENABLED" and waiting) then queue() end
  end)
  return "ready (local profession cooldowns)"
end, "roster")
