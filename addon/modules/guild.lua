-- Everloot guild collector: snapshots, lockouts, attendance, loot awards.
-- Guild-consented data: rows are stored locally and publish ONLY through an officer upload
-- (claim token, previewed before send — see the intake contract + /upload page).

local E = Everloot

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
  E:Store("guild_snapshot", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    guildName = ctx.guildName, realm = ctx.realm, faction = ctx.faction,
    members = members,
  })
  return "snapshot stored (" .. #members .. " members)"
end

local function raidLockouts()
  local ctx = guildContext()
  if not ctx then return end
  if ctx.faction ~= "alliance" and ctx.faction ~= "horde" then return end
  if not (GetNumSavedInstances and GetSavedInstanceInfo) then return end
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
      E:Store("raid_lockout", {
        installId = EverlootDB.installId,
        capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
        guildName = ctx.guildName, realm = ctx.realm,
        instance = name, difficulty = tostring(difficulty or "unknown"),
        bossesKilled = bosses,
        resetAt = date("!%Y-%m-%dT%H:%M:%SZ", time() + resetSeconds),
      })
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
  E:Store("attendance", {
    installId = EverlootDB.installId,
    capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    guildName = ctx.guildName, realm = ctx.realm, instance = instance, present = present,
  })
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
