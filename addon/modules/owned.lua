-- Everloot own-character state for WoW: Forever: this week's raid lockouts of this character.
-- Runs with the completion tracker (/everloot completion on|off) and under its key.
--
--   lockout_owned     one row per saved instance this character is saved to: instance, difficulty, bosses killed of total,
--                     when the lockout resets.
-- Rows carry the completion module's opaque characterKey (completion.lua, C.Identity), never a name, and hold the
-- latest state only: each read replaces this character's rows, and a lockout past its reset is dropped.
--
-- Professions and the active talent build (profession_owned, talent_owned) are no longer recorded: Blizzard's character
-- API supplies them (docs/design/specs/2026-11-17-blizzard-api-first.md). core.lua deletes old rows of both.
--
-- lockout_owned is never in an upload: no uploader sends it (web/src/lib/upload-batches.ts LOCAL_ONLY_KINDS) and the
-- site's intake does not know the kind. The window's Collection and Home read it, and the Everloot Desktop App sends a
-- linked character's rows through private sync, where everloot.app keeps them only if the player switched raids on.
--
-- Calls (mainline API; Forever loads the mainline UI). Not yet checked in game:
--   GetNumSavedInstances, GetSavedInstanceInfo             lockouts, read on UPDATE_INSTANCE_INFO
--   RequestRaidInfo                                        optional: asks the server for UPDATE_INSTANCE_INFO at login
-- A missing call records nothing, never zeros, and /everloot status says which one.

local E = Everloot
local O = {}
E.Owned = O

O.KINDS = { "lockout_owned" }

local API = {
  lockouts = { "GetNumSavedInstances", "GetSavedInstanceInfo" },
}
O.API = API

local MAX_SAVED = 100
local MAX_BOSSES = 40
local MAX_ID = 2000000000

local ready = { lockouts = false }
local missing = { lockouts = {} }

local function absent(paths)
  local out = {}
  for _, name in ipairs(paths) do
    if type(_G[name]) ~= "function" then out[#out + 1] = name end
  end
  return out
end

--- One guarded call; an error is a nil. Values the client will not let an addon read are nil too.
local function call(name, ...)
  local fn = _G[name]
  if type(fn) ~= "function" then return nil end
  local out = { pcall(fn, ...) }
  if not out[1] then return nil end
  for i = 2, 15 do out[i] = E.Readable(out[i]) end
  return unpack(out, 2, 15)
end

local function whole(n, min, max)
  return type(n) == "number" and n == math.floor(n) and n >= min and n <= max
end

local function text(value, limit)
  if type(value) ~= "string" then return nil end
  value = value:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("%c", " "):gsub("^%s+", ""):gsub("%s+$", "")
  if value == "" or #value > limit then return nil end
  return value
end

local function now() return date("!%Y-%m-%dT%H:%M:%SZ") end

--- Replace one character's rows of a kind with `rows`. `keep(row)`, when given, decides for every other row.
local function replace(kind, key, rows, keep)
  local old = EverlootDB.records[kind] or {}
  local kept = {}
  for _, row in ipairs(old) do
    if type(row) == "table" and row.characterKey ~= key and (not keep or keep(row)) then kept[#kept + 1] = row end
  end
  EverlootDB.records[kind] = kept
  local stored = 0
  for _, row in ipairs(rows) do
    if E:Store(kind, row) then stored = stored + 1 end
  end
  return stored
end

--- This character's instance lockouts as the server last reported them, or nil when the client cannot list them.
function O.ReadLockouts()
  if not ready.lockouts then return nil end
  local key, class, level = E.Completion.Identity()
  if not key then return nil end
  local n = call("GetNumSavedInstances")
  if not whole(n, 0, MAX_SAVED) then return nil end
  local t, at = time(), now()
  local rows = {}
  for i = 1, n do
    local name, _, reset, difficultyId, locked, _, _, isRaid, _, difficultyName, numEncounters, encounterProgress, _, instanceId = call("GetSavedInstanceInfo", i)
    name = text(name, 80)
    reset = type(reset) == "number" and math.floor(reset) or nil
    -- An expired lockout is still listed, unlocked with no time left: it is left out.
    if name and locked == true and (isRaid == true or isRaid == false) and whole(reset, 1, 31 * 24 * 3600)
      and whole(numEncounters, 1, MAX_BOSSES) and whole(encounterProgress, 0, numEncounters) then
      rows[#rows + 1] = {
        characterKey = key, class = class, level = level, capturedAt = at, installId = EverlootDB.installId,
        instance = name, instanceId = whole(instanceId, 1, MAX_ID) and instanceId or nil,
        difficultyId = whole(difficultyId, 1, 1000) and difficultyId or nil,
        difficulty = text(difficultyName, 40) or (whole(difficultyId, 1, 1000) and tostring(difficultyId)) or nil,
        bossesKilledCount = encounterProgress, bossesTotal = numEncounters,
        resetAt = date("!%Y-%m-%dT%H:%M:%SZ", t + reset),
      }
    end
  end
  -- Another character's lockout that has reset since is gone in the game too.
  return replace("lockout_owned", key, rows, function(row) return type(row.resetAt) == "string" and row.resetAt > at end)
end

--- /everloot completion off: delete every row this module wrote.
function O.Withdraw()
  for _, kind in ipairs(O.KINDS) do
    EverlootDB.records[kind] = nil
    if EverlootDB.paused then EverlootDB.paused[kind] = nil end
  end
end

local function describe()
  local parts = {}
  for _, name in ipairs({ "lockouts" }) do
    if ready[name] then parts[#parts + 1] = name .. " ready"
    else parts[#parts + 1] = name .. " unavailable, missing " .. table.concat(missing[name], ", ") .. " (records nothing)" end
  end
  return table.concat(parts, "; ")
end

E:RegisterModule("owned", function()
  if not (E.Completion and E.Completion.Identity) then error("needs the completion module's character key", 0) end
  for name, paths in pairs(API) do
    missing[name] = absent(paths)
    ready[name] = #missing[name] == 0
  end
  if not ready.lockouts then error(describe(), 0) end
  local f = E.frame
  local watched = {}
  local events = { "PLAYER_ENTERING_WORLD", "UPDATE_INSTANCE_INFO" }
  for _, event in ipairs(events) do
    if pcall(function() f:RegisterEvent(event) end) then watched[event] = true end
  end
  f:HookScript("OnEvent", function(_, event)
    if not watched[event] or not E:IsEnabled("completion") then return end
    if event == "PLAYER_ENTERING_WORLD" then
      -- The lockout list is read when the server's answer arrives, not before: an empty list at login means nothing yet.
      call("RequestRaidInfo")
    elseif event == "UPDATE_INSTANCE_INFO" then
      pcall(O.ReadLockouts)
    end
  end)
  return "ready: " .. describe() .. "; kept on this computer; never in an upload; the Everloot Desktop App sends a linked character's rows and everloot.app keeps only the categories you switched on"
end, "completion")
