-- Everloot PvP numbers for WoW: Forever: this character's PvP rank and lifetime honorable kills, as the PvP rank tab
-- and the Statistics tab show them.
-- Runs with the completion tracker (/everloot completion on|off) and under its key.
--
--   pvp_owned  one row per character: { rank?, rankPoints?, rankThreshold?, rankMax?, season?, honorableKills? }, all
--              whole numbers >= 0, latest state only. Each read replaces this character's row; a read that finds
--              neither a rank nor honorable kills leaves the last row alone. A field whose call is missing or
--              unreadable is left out, never a zero. The rank title is game text and is not stored.
-- The row stays on this computer: no uploader sends it (web/src/lib/upload-batches.ts LOCAL_ONLY_KINDS) and the
-- site's intake does not know it. It is for the private sync of a character the player linked.
--
-- Calls, each read from Forever's Camelot UI files (PVPRankFrame.lua, Blizzard_Statistics/Camelot/StatisticsFrame.lua):
--   C_MajorFactions.GetMajorFactionProgressionInfo(2800)   the PvP rank is renown on major faction 2800; used only
--                                      when it returns a table: renownLevel (rank), renownReputationEarned (rankPoints),
--                                      renownLevelThreshold (rankThreshold), maxLevel (rankMax)
--   GetCurrentArenaSeason()            first return (season)
--   GetStatisticsCategoryList()        the category ids
--   GetCategoryNumAchievements(cat)    the number of statistics in a category (first return)
--   GetStatistic(cat, i)               quantity (first return), skip (second), statID (third); statID 588 is Total
--                                      Honorable Kills. The quantity is a string: "1,234" reads as 1234 (every
--                                      non-digit stripped); "--", empty or no digits leaves the field out.
-- The statistics frame calls nothing before these; it only listens for CRITERIA_UPDATE to redraw.
-- Not yet checked in game.

local E = Everloot
local P = {}
E.Pvp = P

P.KINDS = { "pvp_owned" }

local API = { "C_MajorFactions", "GetCurrentArenaSeason", "GetStatisticsCategoryList", "GetCategoryNumAchievements",
  "GetStatistic" }

local EVENTS = { "PLAYER_ENTERING_WORLD", "UPDATE_FACTION", "MAJOR_FACTION_RENOWN_LEVEL_CHANGED",
  "PLAYER_PVP_RANK_CHANGED" }
local DEBOUNCE_SECONDS = 2
local PVP_RANK_FACTION_ID = 2800
local HONORABLE_KILLS_STAT_ID = 588
local MAX_VALUE = 2000000000
-- Walk bounds: a statistics tree is a few dozen categories of a few dozen entries.
local MAX_CATEGORIES = 150
local MAX_PER_CATEGORY = 400
local MAX_WALK = 20000

local missing = {}

--- One guarded call of a function value; an error is a nil. Values the client will not let an addon read are nil too.
local function invoke(fn, ...)
  if type(fn) ~= "function" then return nil end
  local out = { pcall(fn, ...) }
  if not out[1] then return nil end
  for i = 2, 5 do out[i] = E.Readable(out[i]) end
  return unpack(out, 2, 5)
end

--- A whole number from 0 up, or nil.
local function count(n)
  if type(n) == "number" and n == n and n >= 0 and n <= MAX_VALUE then return math.floor(n) end
  return nil
end

--- The quantity a statistic shows: a number, or text such as "1,234"; "--" and empty text have no digits.
local function quantity(value)
  if type(value) == "number" then return count(value) end
  if type(value) ~= "string" then return nil end
  local digits = value:gsub("%D", "")
  if digits == "" or #digits > 10 then return nil end
  return count(tonumber(digits))
end

local function now() return date("!%Y-%m-%dT%H:%M:%SZ") end

--- Rank fields from the PvP rank faction; nothing when the call is missing or does not return a table.
local function readRank()
  local api = _G.C_MajorFactions
  if type(api) ~= "table" then return {} end
  local info = invoke(api.GetMajorFactionProgressionInfo, PVP_RANK_FACTION_ID)
  if type(info) ~= "table" then return {} end
  local function field(name) return count(E.Readable(info[name])) end
  return { rank = field("renownLevel"), rankPoints = field("renownReputationEarned"),
    rankThreshold = field("renownLevelThreshold"), rankMax = field("maxLevel") }
end

--- Lifetime honorable kills: the statistic whose id is 588, found by walking the categories. Nil when not found.
local function readHonorableKills()
  local categories = invoke(_G.GetStatisticsCategoryList)
  if type(categories) ~= "table" then return nil end
  local walked = 0
  for c = 1, math.min(#categories, MAX_CATEGORIES) do
    local category = E.Readable(categories[c])
    local total = category ~= nil and count((invoke(_G.GetCategoryNumAchievements, category))) or 0
    for i = 1, math.min(total, MAX_PER_CATEGORY) do
      walked = walked + 1
      if walked > MAX_WALK then return nil end
      local value, _, statId = invoke(_G.GetStatistic, category, i)
      if statId == HONORABLE_KILLS_STAT_ID then return quantity(value) end
    end
  end
  return nil
end

--- The row fields, or nil when there is neither a rank nor honorable kills.
function P.Collect()
  local fields = readRank()
  fields.honorableKills = readHonorableKills()
  if fields.rank == nil and fields.honorableKills == nil then return nil end
  fields.season = count((invoke(_G.GetCurrentArenaSeason)))
  return fields
end

--- Replace this character's row with what the PvP tab and statistics show now. A read with nothing in it leaves the
--- last row alone. Returns true when a row was written.
function P.Read()
  -- The completion module can still be missing at load, so its key is read here, at event time.
  local identity = E.Completion and E.Completion.Identity
  local key, class, level
  if identity then key, class, level = identity() end
  if not key then return false end
  local fields = P.Collect()
  if not fields then return false end
  local kept = {}
  for _, row in ipairs(EverlootDB.records.pvp_owned or {}) do
    if type(row) == "table" and row.characterKey ~= key then kept[#kept + 1] = row end
  end
  EverlootDB.records.pvp_owned = kept
  local row = { kind = "pvp_owned", characterKey = key, installId = EverlootDB.installId, capturedAt = now(),
    class = class, level = level }
  for name, value in pairs(fields) do row[name] = value end
  return E:Store("pvp_owned", row)
end

--- /everloot completion off: delete every row this module wrote.
function P.Withdraw()
  for _, kind in ipairs(P.KINDS) do
    EverlootDB.records[kind] = nil
    if EverlootDB.paused then EverlootDB.paused[kind] = nil end
  end
end

local function describe()
  if #missing == 0 then return "pvp ready" end
  return "pvp missing " .. table.concat(missing, ", ") .. " (those fields are left out)"
end

E:RegisterModule("pvp", function()
  if not (E.Completion and E.Completion.Identity) then error("needs the completion module's character key", 0) end
  missing = {}
  for _, name in ipairs(API) do
    if _G[name] == nil then missing[#missing + 1] = name end
  end
  local f = E.frame
  local watched = {}
  for _, event in ipairs(EVENTS) do
    if pcall(function() f:RegisterEvent(event) end) then watched[event] = true end
  end
  -- Faction events come in bursts; read once after they settle.
  local pending = false
  local function schedule()
    if C_Timer and type(C_Timer.After) == "function" then
      if pending then return end
      pending = true
      C_Timer.After(DEBOUNCE_SECONDS, function()
        pending = false
        -- Switched off while waiting: write nothing.
        if E:IsEnabled("completion") then pcall(P.Read) end
      end)
    else
      pcall(P.Read)
    end
  end
  f:HookScript("OnEvent", function(_, event)
    if not watched[event] or not E:IsEnabled("completion") then return end
    schedule()
  end)
  return "ready: " .. describe() .. "; kept on this computer; never in an upload; the Everloot Desktop App sends a linked character's row and everloot.app keeps only the categories you switched on"
end, "completion")
