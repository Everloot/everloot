-- Everloot guild collector: snapshots, lockouts, attendance, loot awards.
-- Guild-consented data: rows are stored locally and publish ONLY through an officer upload
-- (claim token, previewed before send — see the intake contract + /upload page).

local E = Everloot

-- Rows are stored on change, not on every event: GUILD_ROSTER_UPDATE fires on each guildmate's login and logout,
-- and a 500-member snapshot is about 50 KB. The throttle changes nothing about what a row holds.
local SNAPSHOT_SECONDS = 6 * 3600   -- at most one roster snapshot per guild in this window
local ATTENDANCE_SECONDS = 6 * 3600 -- the same people in the same instance within it are one raid run
local LOCKOUT_SLACK_SECONDS = 60    -- the client reports seconds left, so a reset time wobbles between reads

local function guildContext()
  local name, _, _, _ = GetGuildInfo and GetGuildInfo("player")
  if not name then return nil end
  local realm = GetRealmName and GetRealmName() or "?"
  local faction = (UnitFactionGroup and UnitFactionGroup("player")) or "?"
  return { guildName = name, realm = realm, faction = faction:lower() }
end

local function snapshotRoster()
  local ctx = guildContext()
  if not ctx then return "not in a guild" end
  if ctx.faction ~= "alliance" and ctx.faction ~= "horde" then return "faction not alliance or horde" end
  local members = {}
  local n = GetNumGuildMembers and GetNumGuildMembers() or 0
  for i = 1, math.min(n, 2000) do
    -- Legacy roster getters are the stable cross-flavor call; C_GuildInfo covers the rest.
    if not GetGuildRosterInfo then return "no roster API" end
    local ok, name, rank, _, level, _, _, _, _, online, _, class = pcall(GetGuildRosterInfo, i)
    if ok and name then
      local lastOnlineDays = nil
      if online then
        lastOnlineDays = 0
      elseif GetGuildRosterLastOnline then
        local years, months, days = GetGuildRosterLastOnline(i)
        if type(years) == "number" or type(months) == "number" or type(days) == "number" then
          lastOnlineDays = math.min(3650, (years or 0) * 365 + (months or 0) * 30 + (days or 0))
        end
      end
      if lastOnlineDays ~= nil and (level or 0) >= 1 then
        members[#members + 1] = {
          name = name:gsub("%-.+", ""), rank = rank or "?", level = level,
          class = class or "?", lastOnlineDays = lastOnlineDays,
        }
      end
    end
  end
  if #members == 0 then return "no readable members" end
  -- One snapshot per guild per window, and none when the roster reads the same as the last one stored.
  EverlootDB.guildSnapshotSeen = EverlootDB.guildSnapshotSeen or {}
  local parts = {}
  for i, m in ipairs(members) do
    parts[i] = m.name .. ":" .. m.rank .. ":" .. m.level .. ":" .. m.class .. ":" .. m.lastOnlineDays
  end
  local key, hash = ctx.realm .. "|" .. ctx.guildName, E.Adler32(table.concat(parts, ","))
  local seen = EverlootDB.guildSnapshotSeen[key]
  if type(seen) == "table" then
    if seen.hash == hash then return "snapshot unchanged" end
    if type(seen.at) == "number" and time() - seen.at < SNAPSHOT_SECONDS then return "snapshot throttled" end
  end
  local stored = E:Store("guild_snapshot", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    guildName = ctx.guildName, realm = ctx.realm, faction = ctx.faction,
    members = members,
  })
  if not stored then return "snapshot not stored" end
  EverlootDB.guildSnapshotSeen[key] = { at = time(), hash = hash }
  return "snapshot stored (" .. #members .. " members)"
end

local function raidLockouts()
  local ctx = guildContext()
  if not ctx then return end
  if ctx.faction ~= "alliance" and ctx.faction ~= "horde" then return end
  if not (GetNumSavedInstances and GetSavedInstanceInfo) then return end
  -- One row per instance and difficulty until a boss goes down or the lockout resets, not one per loading screen.
  -- A lockout past its reset is forgotten, so the next week's is stored as new.
  EverlootDB.lockoutSeen = EverlootDB.lockoutSeen or {}
  local now = time()
  for key, seen in pairs(EverlootDB.lockoutSeen) do
    if type(seen) ~= "table" or type(seen.resetAt) ~= "number" or seen.resetAt < now then
      EverlootDB.lockoutSeen[key] = nil
    end
  end
  local n = GetNumSavedInstances()
  if type(n) ~= "number" or n < 1 then return end
  for i = 1, n do
    local name, _, reset, difficulty, _, _, _, _, _, _, numEncounters = GetSavedInstanceInfo(i)
    if type(name) == "string" and name ~= "" then
      local bosses = {}
      local encounters = type(numEncounters) == "number" and numEncounters or 0
      if GetSavedInstanceEncounterInfo then
        for encounter = 1, encounters do
          local boss, _, killed = GetSavedInstanceEncounterInfo(i, encounter)
          if killed and type(boss) == "string" and boss ~= "" then bosses[#bosses + 1] = boss end
        end
      end
      local resetSeconds = type(reset) == "number" and reset or 0
      local resetAt = now + resetSeconds
      difficulty = tostring(difficulty or "unknown")
      local key = ctx.realm .. "|" .. ctx.guildName .. "|" .. name .. "|" .. difficulty
      local killed = table.concat(bosses, "|")
      local seen = EverlootDB.lockoutSeen[key]
      local same = type(seen) == "table" and seen.bosses == killed
        and type(seen.resetAt) == "number" and math.abs(seen.resetAt - resetAt) <= LOCKOUT_SLACK_SECONDS
      if not same then
        local stored = E:Store("raid_lockout", {
          installId = EverlootDB.installId,
          capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
          guildName = ctx.guildName, realm = ctx.realm,
          instance = name, difficulty = difficulty,
          bossesKilled = bosses,
          resetAt = date("!%Y-%m-%dT%H:%M:%SZ", resetAt),
        })
        if stored then EverlootDB.lockoutSeen[key] = { resetAt = resetAt, bosses = killed } end
      end
    end
  end
end

local function raidAttendance()
  local ctx = guildContext()
  if not ctx then return end
  if not (IsInRaid and IsInRaid()) then return end
  local present = {}
  for i = 1, math.min(GetNumGroupMembers(), 40) do
    local name = GetRaidRosterInfo and E.Readable((select(1, GetRaidRosterInfo(i))))
    if name then present[#present + 1] = name:gsub("%-.+", "") end
  end
  if #present == 0 then return end
  local instance = (GetInstanceInfo and select(1, GetInstanceInfo())) or "?"
  -- One row per raid run: the same people in the same instance within the window add nothing. The hash is of
  -- the names sorted, so the raid's order does not matter; the row keeps the roster's order.
  EverlootDB.attendanceSeen = EverlootDB.attendanceSeen or {}
  local sorted = {}
  for i, name in ipairs(present) do sorted[i] = name end
  table.sort(sorted)
  local key, hash = ctx.realm .. "|" .. ctx.guildName .. "|" .. instance, E.Adler32(table.concat(sorted, ","))
  local seen = EverlootDB.attendanceSeen[key]
  if type(seen) == "table" and seen.hash == hash and type(seen.at) == "number"
    and time() - seen.at < ATTENDANCE_SECONDS then return end
  local stored = E:Store("attendance", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    guildName = ctx.guildName, realm = ctx.realm, instance = instance, present = present,
  })
  if stored then EverlootDB.attendanceSeen[key] = { at = time(), hash = hash } end
end

E:RegisterModule("guild", function()
  if not (GetGuildInfo and C_GuildInfo) then
    error("guild API unavailable in beta", 0)
  end
  if C_GuildInfo and C_GuildInfo.GuildRoster then
    -- Modern roster request path; legacy getters read the results.
    local ok = pcall(C_GuildInfo.GuildRoster)
    if not ok then return "C_GuildInfo.GuildRoster unavailable in beta" end
  elseif not GetGuildRosterInfo then
    return "no roster API in beta"
  end
  local f = E.frame
  f:RegisterEvent("GUILD_ROSTER_UPDATE")
  f:RegisterEvent("PLAYER_ENTERING_WORLD")
  f:RegisterEvent("UPDATE_INSTANCE_INFO")
  f:HookScript("OnEvent", function(_, event)
    if event == "GUILD_ROSTER_UPDATE" then pcall(snapshotRoster) end
    if event == "GUILD_ROSTER_UPDATE" or event == "PLAYER_ENTERING_WORLD" then
      pcall(raidAttendance)
    end
    if event == "UPDATE_INSTANCE_INFO" or event == "PLAYER_ENTERING_WORLD" then
      pcall(raidLockouts)
    end
  end)
  return "ready (roster, attendance, lockouts; loot awards still wait on a raid test)"
end)
