-- Everloot pull summaries: each group member's numbers for each boss pull. On by default; /everloot pulls off.
--
-- One pull_summary row per boss pull in a dungeon or raid (ENCOUNTER_START to ENCOUNTER_END): the encounter, kill or
-- wipe, its length, and for each member of your group their name, class, role and four totals: damage done, healing
-- done, damage taken and deaths. The design is docs/design/specs/2026-11-02-pull-and-run-records-design.md.
--
-- Where the numbers come from: the game's own damage meter (C_DamageMeter), which the client totals per player for
-- each fight. Forever restricts COMBAT_LOG_EVENT_UNFILTERED, so this module never registers it and never sees a
-- single combat event; it reads the meter's totals once, after the fight, when the client stops hiding them (they are
-- secret during combat). A total the client still hides, or a member the meter has no line for, is left out of the
-- row, never written as zero.
--
-- Role: the group role the game shows (UnitGroupRolesAssigned) as roleSource "assigned"; when the group has none, the
-- larger of healing and damage done as roleSource "inferred" (healer or damage; a tank is never inferred).
--
-- Meter lines are matched to the group by isLocalPlayer, then by GUID. A line whose GUID is readable but not in the
-- group (a pet, a guardian, a creature, a stranger) is never matched by name, so a pet named like a player cannot
-- take the player's totals. The name is used only when the client hides the GUID, and then only for a name one member
-- has and a class that agrees; two lines for one member leave that total out.
--
-- This module reads other players' names, as Warcraft Logs does for whoever uploads: on by default, said once per
-- install, and every character can be hidden on the site, which then drops it at upload and deletes it from storage.
-- It reads nothing else about them: no gear, talents, guild, position or chat. The contract test fails if this file
-- names a call that could, and lists every game call it may make. /everloot pulls off deletes every row it wrote.
--
-- Nothing here loads until E.RUN_RECORDS is true (core.lua): builds made before that release, nightlies included,
-- have no pulls module, no switch and no command.
--
-- Load and size: one meter read per pull, after combat. About 150 bytes a member: a 5-player pull is under 1 KB,
-- a 40-player one about 6 KB. At most 200 rows and 2,000 member entries in the file (about 300 KB); past either,
-- collection pauses, as every kind does, until the file is uploaded.

local E = Everloot
if not E.RUN_RECORDS then return end
local PL = {}
E.Pulls = PL

local MAX_ROWS = 200
local MAX_MEMBERS = 2000
local MAX_ID = 2147483647
local MAX_AMOUNT = 1000000000000
local NAME = "^[%a\128-\255]+$"
local CLASS = "^%u+$"
local REALM = "^[%w\128-\255][%w\128-\255 '%-]*$"
local ROLES = { TANK = "tank", HEALER = "healer", DAMAGER = "damage" }
-- C_DamageMeter's enums, from the Forever UI source (DamageMeterConstantsDocumentation.lua); Enum wins when present.
local SESSION_CURRENT = 1
local TYPES = { damageDone = 0, healingDone = 2, damageTaken = 7, deaths = 9 }
local ENUM_NAMES = { damageDone = "DamageDone", healingDone = "HealingDone", damageTaken = "DamageTaken", deaths = "Deaths" }

-- Every call this module makes to the game, besides C_DamageMeter. A test scans the source against this list.
PL.API = { "UnitGUID", "UnitName", "UnitClass", "UnitGroupRolesAssigned", "GetRealmName", "GetInstanceInfo", "IsInRaid",
  "InCombatLockdown", "UnitAffectingCombat" }

local PARTY = { "player", "party1", "party2", "party3", "party4" }
local RAID = {}
for i = 1, 40 do RAID[i] = "raid" .. i end

local active = false
local start      -- { encounterId, at } from ENCOUNTER_START
local pending    -- a finished pull waiting for combat to end

local function whole(v, lo, hi)
  v = E.Readable(v)
  if type(v) ~= "number" or v ~= v then return nil end
  v = math.floor(v)
  if v < lo or v > hi then return nil end
  return v
end

local function text(v, pattern, min, max)
  v = E.Readable(v)
  if type(v) ~= "string" or #v < min or #v > max or not v:find(pattern) then return nil end
  return v
end

local function iso(t) return date("!%Y-%m-%dT%H:%M:%SZ", t) end

local function instanceMap()
  local _, instanceType, _, _, _, _, _, instanceMapId = GetInstanceInfo()
  if instanceType ~= "party" and instanceType ~= "raid" then return nil end
  return whole(instanceMapId, 1, MAX_ID)
end

--- The group as the game shows it now: one member per unit, by GUID and by name.
local function roster(ourRealm)
  local members, byGuid, byName = {}, {}, {}
  local units = (IsInRaid and IsInRaid()) and RAID or PARTY
  for _, unit in ipairs(units) do
    local guid = E.Readable(UnitGUID(unit))
    if type(guid) == "string" and guid:find("^Player%-") and not byGuid[guid] then
      local rawName, rawRealm = UnitName(unit)
      local name = text(rawName, NAME, 2, 48)
      local class = text((select(2, UnitClass(unit))), CLASS, 3, 16)
      if name and class then
        local member = { name = name, class = class }
        local realm = text(rawRealm, REALM, 2, 40)
        if realm and realm ~= ourRealm then member.realm = realm end
        if unit == "player" or E.Readable(UnitGUID("player")) == guid then member.self = true end
        local role = ROLES[E.Readable(UnitGroupRolesAssigned(unit)) or ""]
        if role then member.role, member.roleSource = role, "assigned" end
        members[#members + 1] = member
        byGuid[guid] = member
        byName[name] = byName[name] == nil and member or false   -- two members with one name: match by GUID only
        if #members >= 40 then break end
      end
    end
  end
  return members, byGuid, byName
end

local function meterType(field)
  local enum = Enum and Enum.DamageMeterType
  return enum and type(enum[ENUM_NAMES[field]]) == "number" and enum[ENUM_NAMES[field]] or TYPES[field]
end

--- The meter's totals for the fight that just ended, onto the members. Returns the meter's own length, or nil when
--- the client has no meter or gives nothing readable.
local function readMeter(byGuid, byName, members)
  local meter = C_DamageMeter
  if type(meter) ~= "table" or type(meter.GetCombatSessionFromType) ~= "function" then
    E:SetNote("pulls", "on, but this client has no damage meter: rows hold the group and roles only")
    return nil
  end
  if type(meter.IsDamageMeterAvailable) == "function" then
    local ok, available = pcall(meter.IsDamageMeterAvailable)
    if ok and E.Readable(available) == false then
      E:SetNote("pulls", "on, but the game says its damage meter is not available: rows hold the group and roles only")
      return nil
    end
  end
  local current = Enum and Enum.DamageMeterSessionType and Enum.DamageMeterSessionType.Current or SESSION_CURRENT
  local seconds
  for field in pairs(TYPES) do
    local ok, session = pcall(meter.GetCombatSessionFromType, current, meterType(field))
    if ok and type(session) == "table" and type(session.combatSources) == "table" then
      seconds = seconds or whole(session.durationSeconds, 0, 86400)
      local matched = {}
      for _, source in ipairs(session.combatSources) do
        if type(source) == "table" then
          local member
          if E.Readable(source.isLocalPlayer) == true then
            for _, m in ipairs(members) do if m.self then member = m end end
          end
          local guid = E.Readable(source.sourceGUID)
          if not member and type(guid) == "string" and guid ~= "" then
            member = byGuid[guid]   -- a readable GUID outside the group is never matched by name
          elseif not member then
            member = byName[E.Readable(source.name) or ""] or nil
            local class = E.Readable(source.classFilename)
            if member and type(class) == "string" and class ~= member.class then member = nil end
          end
          local amount = whole(source.totalAmount, 0, field == "deaths" and 1000 or MAX_AMOUNT)
          if member and amount then
            -- Two lines for one member: which one is theirs is unknown, so the total is left out.
            if matched[member] then member[field] = nil else member[field] = amount end
            matched[member] = true
          end
        end
      end
    end
  end
  return seconds
end

local function memberCount()
  local n = 0
  for _, row in ipairs(EverlootDB.records.pull_summary or {}) do n = n + (type(row.members) == "table" and #row.members or 0) end
  return n
end

local function write()
  local p = pending
  pending = nil
  if not p or not active then return end
  local members, byGuid, byName = p.members, p.byGuid, p.byName
  local meterSeconds = readMeter(byGuid, byName, members)
  for _, m in ipairs(members) do
    if not m.role and (m.damageDone or m.healingDone) then
      m.role, m.roleSource = ((m.healingDone or 0) > (m.damageDone or 0)) and "healer" or "damage", "inferred"
    end
  end
  if memberCount() + #members > MAX_MEMBERS then
    EverlootDB.paused = EverlootDB.paused or {}
    if not EverlootDB.paused.pull_summary then
      print("Everloot: pull_summary collection paused at capacity. Keep and upload your SavedVariables file.")
    end
    EverlootDB.paused.pull_summary = true
    return
  end
  E:Store("pull_summary", {
    installId = EverlootDB.installId, capturedAt = iso(p.endedAt),
    encounterId = p.encounterId, name = p.name, instanceMapId = p.instanceMapId,
    difficulty = p.difficulty, size = p.size, success = p.success,
    startedAt = p.startedAt and iso(p.startedAt), durationSeconds = p.startedAt and p.endedAt - p.startedAt,
    runId = p.runId, realm = p.realm,
    meterSeconds = meterSeconds, members = members,
  }, MAX_ROWS)
end

local function inCombat()
  return (InCombatLockdown and InCombatLockdown()) or E.Readable(UnitAffectingCombat("player")) == true
end

local function encounterStart(encounterId)
  encounterId = whole(encounterId, 1, MAX_ID)
  pending = nil   -- a pull that never left combat before the next one began is not read: its totals are mixed
  start = encounterId and instanceMap() and { encounterId = encounterId, at = time() } or nil
end

-- ENCOUNTER_END: encounterID, encounterName, difficultyID, groupSize, success (1 a kill, 0 a wipe).
local function encounterEnd(encounterId, name, difficulty, size, success)
  local begun = start
  start = nil
  encounterId = whole(encounterId, 1, MAX_ID)
  if success == 1 then success = true elseif success == 0 then success = false end
  name = text(name, ".", 1, 120)
  local instanceMapId = instanceMap()
  if not encounterId or not name or type(success) ~= "boolean" or not instanceMapId then return end
  local now = time()
  local realm = text(GetRealmName(), REALM, 2, 40)
  local members, byGuid, byName = roster(realm)
  if #members == 0 then return end
  pending = {
    encounterId = encounterId, name = name, instanceMapId = instanceMapId, success = success,
    difficulty = whole(difficulty, 0, 255), size = whole(size, 1, 40), realm = realm,
    startedAt = begun and begun.encounterId == encounterId and now >= begun.at and now - begun.at <= 86400 and begun.at or nil,
    endedAt = now, runId = E.CurrentRunId and E.CurrentRunId() or nil,
    members = members, byGuid = byGuid, byName = byName,
  }
  if not inCombat() then write() end
end

--- /everloot pulls off: stop and delete every pull summary in this file.
function PL.Withdraw()
  active, start, pending = false, nil, nil
  EverlootDB.records.pull_summary = nil
  if EverlootDB.paused then EverlootDB.paused.pull_summary = nil end
end

--- One line for /everloot pulls.
function PL.StatusLine()
  if not E:IsEnabled("pulls") then return "Everloot pulls: off. /everloot pulls on starts it." end
  return string.format("Everloot pulls: %s. %d boss pulls kept (at most %d). They leave this file only from the everloot.app upload page, after its preview, or the Everloot Desktop App.",
    active and "on" or "on after /reload", E:Count("pull_summary"), MAX_ROWS)
end

E:RegisterModule("pulls", function()
  for _, name in ipairs(PL.API) do
    if type(_G[name]) ~= "function" then error(name .. " unavailable", 0) end
  end
  active = true
  local f = E.frame
  f:RegisterEvent("ENCOUNTER_START")
  f:RegisterEvent("ENCOUNTER_END")
  f:RegisterEvent("PLAYER_REGEN_ENABLED")
  f:HookScript("OnEvent", function(_, event, arg1, arg2, arg3, arg4, arg5)
    if not active then return end
    if event == "ENCOUNTER_START" then pcall(encounterStart, arg1)
    elseif event == "ENCOUNTER_END" then pcall(encounterEnd, arg1, arg2, arg3, arg4, arg5)
    elseif event == "PLAYER_REGEN_ENABLED" and pending then pcall(write) end
  end)
  return "ready (each boss pull: your group's names, classes, roles and damage meter totals; /everloot pulls off deletes the rows)"
end)
