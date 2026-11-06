-- Everloot own-character state for WoW: Forever: this character's professions, this week's raid lockouts and
-- its active talent build.
-- Runs with the completion tracker (/everloot completion on|off) and under its key.
--
--   profession_owned  one row per profession: name, skill line id, rank, max rank.
--   lockout_owned     one row per raid this character is saved to: instance, difficulty, bosses killed of total,
--                     when the lockout resets.
--   talent_owned      one row: the ACTIVE spec group's tree id, spec id, spent points and every spent node with its
--                     ranks and choice. Copied from E.Talents.Snapshot (talents.lua), which also feeds the anonymous
--                     talent_snapshot; that row is written by the talents module exactly as before.
-- All carry the completion module's opaque characterKey (completion.lua, C.Identity), never a name, and hold the
-- latest state only: each read replaces this character's rows, and a lockout past its reset is dropped.
-- A build with no spent points is no row; a build the client cannot read this time leaves the last row alone.
--
-- profession_owned and lockout_owned stay on this computer: no uploader sends them (web/src/lib/upload-batches.ts
-- LOCAL_ONLY_KINDS), the site's intake does not know these kinds, and only the Everloot Desktop App's Characters
-- page reads them. talent_owned is local only too: no upload carries it, it is for the private sync of a character
-- the player linked (its shape is in web/src/lib/private-sync.ts).
--
-- Calls (mainline API; Forever loads the mainline UI). Not yet checked in game:
--   GetProfessions, GetProfessionInfo                      professions
--   GetNumSavedInstances, GetSavedInstanceInfo             lockouts, read on UPDATE_INSTANCE_INFO
--   RequestRaidInfo                                        optional: asks the server for UPDATE_INSTANCE_INFO at login
--   E.Talents.Groups, E.Talents.Snapshot                   talents, read two seconds after the trait events settle
-- A missing call records nothing for its kind, never zeros, and /everloot status says which one.

local E = Everloot
local O = {}
E.Owned = O

O.KINDS = { "profession_owned", "lockout_owned", "talent_owned" }

local API = {
  professions = { "GetProfessions", "GetProfessionInfo" },
  lockouts = { "GetNumSavedInstances", "GetSavedInstanceInfo" },
}
O.API = API

-- The events talents.lua already listens to.
local TALENT_EVENTS = { "PLAYER_ENTERING_WORLD", "TRAIT_CONFIG_UPDATED", "ACTIVE_PLAYER_SPECIALIZATION_CHANGED",
  "PLAYER_TALENT_UPDATE", "PLAYER_LEVEL_UP" }
local TALENT_DEBOUNCE_SECONDS = 2
local MAX_TALENT_NODES = 600
local MAX_TALENT_POINTS = 500

local MAX_PROFESSIONS = 5       -- GetProfessions: two primary, archaeology, fishing, cooking
local MAX_SAVED = 100
local MAX_RANK = 1000
local MAX_BOSSES = 40
local MAX_ID = 2000000000

local ready = { professions = false, lockouts = false, talents = false }
local missing = { professions = {}, lockouts = {}, talents = {} }

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

--- This character's professions from the profession book, or nil when the client has no profession book.
function O.ReadProfessions()
  if not ready.professions then return nil end
  local key, class, level = E.Completion.Identity()
  if not key then return nil end
  local indices = { call("GetProfessions") }
  local rows, at = {}, now()
  for i = 1, MAX_PROFESSIONS do
    local index = indices[i]
    if whole(index, 1, MAX_ID) then
      local name, _, rank, maxRank, _, _, skillLine = call("GetProfessionInfo", index)
      name = text(name, 60)
      if name and whole(rank, 0, MAX_RANK) and whole(maxRank, 0, MAX_RANK) and maxRank > 0 and rank <= maxRank then
        rows[#rows + 1] = {
          characterKey = key, class = class, level = level, capturedAt = at, installId = EverlootDB.installId,
          profession = name, skillLine = whole(skillLine, 1, MAX_ID) and skillLine or nil,
          rank = rank, maxRank = maxRank,
        }
      end
    end
  end
  return replace("profession_owned", key, rows)
end

--- This character's raid lockouts as the server last reported them, or nil when the client cannot list them.
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
    if name and locked == true and isRaid == true and whole(reset, 1, 31 * 24 * 3600)
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

--- The active spec group's build as the talents module reads it, or nil when the client has no talents to read.
--- A build with no spent points removes this character's row; a build that cannot be read leaves it alone.
function O.ReadTalents()
  if not ready.talents then return nil end
  -- The completion module can still be missing at load, so its key is read here, at event time.
  local identity = E.Completion and E.Completion.Identity
  local key, class, level
  if identity then key, class, level = identity() end
  if not key then return nil end
  local active
  for _, entry in ipairs(E.Talents.Groups()) do
    if entry.active then active = entry end
  end
  if not active then return nil end
  local snapshot = E.Talents.Snapshot(active)
  if type(snapshot) ~= "table" or type(snapshot.nodes) ~= "table" then return nil end
  local points = snapshot.points
  if not (whole(points, 0, MAX_TALENT_POINTS) and whole(snapshot.treeId, 1, MAX_ID) and #snapshot.nodes <= MAX_TALENT_NODES) then
    return nil
  end
  if points == 0 then return replace("talent_owned", key, {}) end
  local nodes = {}
  for i, node in ipairs(snapshot.nodes) do
    nodes[i] = { nodeId = node.nodeId, ranks = node.ranks, choice = node.choice }
  end
  return replace("talent_owned", key, { {
    kind = "talent_owned", characterKey = key, installId = EverlootDB.installId, capturedAt = now(), class = class, level = level,
    treeId = snapshot.treeId, specId = whole(snapshot.specId, 1, MAX_ID) and snapshot.specId or nil,
    points = points, nodes = nodes,
  } })
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
  for _, name in ipairs({ "professions", "lockouts", "talents" }) do
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
  -- Talents come from the talents module (loaded before this one), which reads the trait API.
  local talents = E.Talents
  if type(talents) ~= "table" then missing.talents = { "Everloot.Talents" }
  elseif type(talents.Groups) ~= "function" or type(talents.Snapshot) ~= "function" then missing.talents = { "Everloot.Talents.Snapshot" }
  elseif not (type(talents.HasTraitApi) == "function" and talents.HasTraitApi()) then missing.talents = { "C_Traits" } end
  ready.talents = #missing.talents == 0
  if not (ready.professions or ready.lockouts or ready.talents) then error(describe(), 0) end
  local f = E.frame
  local watched = {}
  local events = { "SKILL_LINES_CHANGED", "UPDATE_INSTANCE_INFO" }
  for _, event in ipairs(TALENT_EVENTS) do events[#events + 1] = event end
  for _, event in ipairs(events) do
    if pcall(function() f:RegisterEvent(event) end) then watched[event] = true end
  end
  local talentEvent = {}
  for _, event in ipairs(TALENT_EVENTS) do talentEvent[event] = true end
  -- Trait events come in bursts; read once after they settle (the way talents.lua does).
  local pending = false
  local function scheduleTalents()
    if not ready.talents then return end
    if C_Timer and type(C_Timer.After) == "function" then
      if pending then return end
      pending = true
      C_Timer.After(TALENT_DEBOUNCE_SECONDS, function()
        pending = false
        -- Switched off while waiting: write nothing.
        if E:IsEnabled("completion") then pcall(O.ReadTalents) end
      end)
    else
      pcall(O.ReadTalents)
    end
  end
  f:HookScript("OnEvent", function(_, event)
    if not watched[event] or not E:IsEnabled("completion") then return end
    if talentEvent[event] then scheduleTalents() end
    if event == "PLAYER_ENTERING_WORLD" then
      pcall(O.ReadProfessions)
      -- The lockout list is read when the server's answer arrives, not before: an empty list at login means nothing yet.
      if ready.lockouts then call("RequestRaidInfo") end
    elseif event == "SKILL_LINES_CHANGED" then
      pcall(O.ReadProfessions)
    elseif event == "UPDATE_INSTANCE_INFO" then
      pcall(O.ReadLockouts)
    end
  end)
  return "ready: " .. describe() .. "; kept on this computer; the Everloot Desktop App sends them only for characters you linked, under the switches you set on everloot.app"
end, "completion")
