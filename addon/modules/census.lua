-- Everloot census: who plays what. On for a new install, which says so once in chat; an install from
-- before the census keeps it off until /everloot census on. /everloot census off deletes the rows.
--
-- Two kinds of rows, written in the shape the upload sends:
--   census_self  your own character, at login and level-up: guid, race, class, level, faction, realm
--   census_seen  a player you target, mouse over or group with: guid, race, class, level, faction, via
-- Race and class are the game's tokens (UnitRace and UnitClass second return), not display names.
--
-- Nothing else is read about another player: no name, guild, gear or position. The contract test
-- fails if this file names a call that could read them, and lists every game call it may make.
-- The guid leaves this file from the upload page, or from the Desktop App when the player allowed the census
-- there; the server swaps it for a keyed hash before
-- anything is stored (docs/design/specs/2026-10-18-census-design.md, section 5).
--
-- One row per guid per UTC day and kind. A row keeps the first way you saw the player that day; only a
-- new level changes it (level, capturedAt and a new event id, so the upload sends the row again and the
-- server, which keys a row by character and day, takes the new level). At most 2,000 rows per kind; the
-- oldest days go first.
-- Mouseover fires constantly, so a player already recorded today at the same level costs a few table
-- reads and no new strings or tables.

local E = Everloot
local C = {}
E.Census = C

local MAX_ROWS = 2000
local MAX_LEVEL = 60
local DAY_SECONDS = 86400
local KINDS = { "census_self", "census_seen" }
local GUID = "^Player%-%d+%-[%dA-F]+$"   -- upper-case hex only, as the intake requires
local RACE = "^%a+$"                       -- 2 to 24 letters, e.g. Scourge, Skyborne
local CLASS = "^%u+$"                      -- 3 to 16 capitals, e.g. HUNTER

-- Every call this module makes to the game. A test scans the source against this list.
C.API = { "UnitIsPlayer", "UnitGUID", "UnitLevel", "UnitRace", "UnitClass", "UnitFactionGroup", "GetRealmName", "IsInRaid" }

local PARTY, RAID = {}, {}
for i = 1, 4 do PARTY[i] = "party" .. i end
for i = 1, 40 do RAID[i] = "raid" .. i end

local active = false
local selfGuid
local day, dayEnds = nil, 0
local today = { census_self = {}, census_seen = {} }   -- guid -> today's row, for the current UTC day

local function rows(kind)
  local list = EverlootDB.records[kind]
  if not list then list = {}; EverlootDB.records[kind] = list end
  return list
end

--- Today's UTC date. Worked out again only when the day changes, so the busy path makes no string.
local function currentDay()
  local now = time()
  if now >= dayEnds or now < dayEnds - DAY_SECONDS then
    day = date("!%Y-%m-%d", now)
    dayEnds = now - now % DAY_SECONDS + DAY_SECONDS
    -- Rows already kept for this day (after a reload) are found again, so a reload adds no duplicates.
    for _, kind in ipairs(KINDS) do
      local index = {}
      for _, row in ipairs(rows(kind)) do
        if type(row.capturedAt) == "string" and row.capturedAt:sub(1, 10) == day and row.guid then index[row.guid] = row end
      end
      today[kind] = index
    end
  end
  return day
end

local function stamp()
  return date("!%Y-%m-%dT%H:%M:%SZ")
end

--- "<kind>:<YYYY-MM-DD>:<n>". The number only goes up, and holds nothing about the player.
local function eventId(kind, on)
  EverlootDB.censusNext = EverlootDB.censusNext or {}
  local n = (tonumber(EverlootDB.censusNext[kind]) or 0) + 1
  EverlootDB.censusNext[kind] = n
  return kind .. ":" .. on .. ":" .. string.format("%.0f", n)
end

--- Add a new row. Over the cap, the oldest rows go: rows are kept in the order they were added, so
--- that is the oldest day first.
local function append(kind, row)
  local list = rows(kind)
  list[#list + 1] = row
  local index = today[kind]
  index[row.guid] = row
  while #list > MAX_ROWS do
    local old = table.remove(list, 1)
    if index[old.guid] == old then index[old.guid] = nil end
  end
end

local function token(value, pattern, min, max)
  return type(value) == "string" and #value >= min and #value <= max and value:find(pattern) ~= nil
end

local function factionOf(value)
  if value == "Alliance" or value == "Horde" then return value end
  return nil
end

--- Same rule as the protocol's validRealm, in bytes: letters, digits, spaces, apostrophes, hyphens.
local function realmOf(value)
  if type(value) ~= "string" then return nil end
  value = value:gsub("^%s+", ""):gsub("%s+$", "")
  if #value < 2 or #value > 40 or not value:find("^[%w\128-\255][%w\128-\255 '%-]*$") then return nil end
  return value
end

--- A player unit you see. Skips yourself, hidden levels ("??") and anything with a missing field.
local function seen(unit, via)
  if not active or not E.Readable(UnitIsPlayer(unit)) then return end
  local guid = E.Readable(UnitGUID(unit))
  if not guid then return end
  if not selfGuid then selfGuid = E.Readable(UnitGUID("player")) end
  if guid == selfGuid then return end
  local level = E.Readable(UnitLevel(unit))
  if type(level) ~= "number" or level < 1 or level > MAX_LEVEL then return end
  local on = currentDay()
  local row = today.census_seen[guid]
  if row then
    if row.level ~= level then row.level = level; row.capturedAt = stamp(); row.eventId = eventId("census_seen", on) end
    return
  end
  if type(guid) ~= "string" or not guid:find(GUID) then return end
  local race = E.Readable((select(2, UnitRace(unit))))
  local class = E.Readable((select(2, UnitClass(unit))))
  local faction = factionOf(E.Readable((UnitFactionGroup(unit))))
  if not token(race, RACE, 2, 24) or not token(class, CLASS, 3, 16) or not faction then return end
  append("census_seen", {
    installId = EverlootDB.installId,
    eventId = eventId("census_seen", on),
    capturedAt = stamp(),
    guid = guid, race = race, class = class, level = math.floor(level), faction = faction, via = via,
  })
end

local function group()
  local units = (IsInRaid and IsInRaid()) and RAID or PARTY
  for i = 1, #units do seen(units[i], "group") end
end

--- Your own character. PLAYER_LEVEL_UP passes the new level before UnitLevel has it.
local function recordSelf(newLevel)
  if not active then return end
  local guid = E.Readable(UnitGUID("player"))
  if type(guid) ~= "string" or not guid:find(GUID) then return end
  selfGuid = guid
  local level = tonumber(E.Readable(newLevel)) or E.Readable(UnitLevel("player"))
  local race = E.Readable((select(2, UnitRace("player"))))
  local class = E.Readable((select(2, UnitClass("player"))))
  local faction = factionOf(E.Readable((UnitFactionGroup("player"))))
  local realm = realmOf(E.Readable(GetRealmName()))
  if type(level) ~= "number" or level < 1 or level > MAX_LEVEL then return end
  if not token(race, RACE, 2, 24) or not token(class, CLASS, 3, 16) or not faction or not realm then return end
  local on = currentDay()
  local row = today.census_self[guid]
  if row then
    if row.level ~= math.floor(level) then
      row.level = math.floor(level); row.capturedAt = stamp(); row.eventId = eventId("census_self", on)
    end
    return
  end
  append("census_self", {
    installId = EverlootDB.installId,
    eventId = eventId("census_self", on),
    capturedAt = stamp(),
    guid = guid, race = race, class = class, level = math.floor(level), faction = faction, realm = realm,
  })
end

--- /everloot census off: stop reading and delete every census row in this file.
function C.Withdraw()
  active = false
  EverlootDB.records.census_self = nil
  EverlootDB.records.census_seen = nil
  if EverlootDB.paused then EverlootDB.paused.census_self, EverlootDB.paused.census_seen = nil, nil end
  today.census_self, today.census_seen = {}, {}
  dayEnds = 0
end

--- One line for /everloot census.
function C.StatusLine()
  if not E:IsEnabled("census") then
    return "Everloot census: off. /everloot census on starts it."
  end
  return string.format("Everloot census: %s. %d rows of players you saw, %d of your own characters. Nothing leaves this file unless the Everloot Desktop App, with the census allowed, or everloot.app/upload sends it.",
    active and "on" or "on after /reload", E:Count("census_seen"), E:Count("census_self"))
end

E:RegisterModule("census", function()
  for _, name in ipairs(C.API) do
    if type(_G[name]) ~= "function" then error(name .. " unavailable", 0) end
  end
  active = true
  local f = E.frame
  f:RegisterEvent("PLAYER_LOGIN")
  f:RegisterEvent("PLAYER_LEVEL_UP")
  f:RegisterEvent("PLAYER_TARGET_CHANGED")
  f:RegisterEvent("UPDATE_MOUSEOVER_UNIT")
  f:RegisterEvent("GROUP_ROSTER_UPDATE")
  f:HookScript("OnEvent", function(_, event, arg1)
    if not active then return end
    if event == "UPDATE_MOUSEOVER_UNIT" then pcall(seen, "mouseover", "mouseover")
    elseif event == "PLAYER_TARGET_CHANGED" then pcall(seen, "target", "target")
    elseif event == "GROUP_ROSTER_UPDATE" then pcall(group)
    elseif event == "PLAYER_LOGIN" then pcall(recordSelf); pcall(group)
    elseif event == "PLAYER_LEVEL_UP" then pcall(recordSelf, arg1) end
  end)
  return "ready (your characters, and players you target, mouse over or group with; /everloot census off deletes the rows)"
end)
