-- Own kill history stays on this computer. Public encounters are recorded separately by openworld.lua.
local E = Everloot
local world = {}
for _, instance in ipairs(E.InstanceData.instances) do
  if instance.group == "World bosses" then
    for _, boss in ipairs(instance.bosses) do world[boss.id] = instance.id end
  end
end

local function note()
  local count = 0
  for _, row in ipairs(E:Rows("boss_kill_owned")) do
    if world[row.encounterId] == row.instanceMapId then count = count + row.killCount end
  end
  E:SetNote("boss_kills", "World boss kills seen: " .. count .. "; open-world ENCOUNTER_END is unconfirmed")
  return "World boss kills seen: " .. count .. "; open-world ENCOUNTER_END is unconfirmed; kept on this computer"
end

local function whole(n) return type(n) == "number" and n > 0 and n == math.floor(n) end

E:RegisterModule("boss_kills", function()
  E.frame:RegisterEvent("ENCOUNTER_END")
  E.frame:HookScript("OnEvent", function(_, event, encounterId, _, difficulty, _, success)
    if event ~= "ENCOUNTER_END" or not E:IsEnabled("completion") then return end
    encounterId, difficulty, success = E.Readable(encounterId), E.Readable(difficulty), E.Readable(success)
    if success ~= 1 or not whole(encounterId) or type(difficulty) ~= "number"
      or difficulty < 0 or difficulty ~= math.floor(difficulty) then return end
    local ok, inside, kind = pcall(IsInInstance)
    if not ok then return end
    inside, kind = E.Readable(inside), E.Readable(kind)
    local mapId
    if inside and (kind == "party" or kind == "raid") then
      local read, _, _, _, _, _, _, _, id = pcall(GetInstanceInfo)
      if read then mapId = E.Readable(id) end
    elseif inside == false then
      -- The encounter id, rather than the outdoor zone, identifies a shipped world boss.
      mapId = world[encounterId]
    end
    if not whole(mapId) then return end
    local key = E.Completion.Identity()
    if not key then return end
    local at = date("!%Y-%m-%dT%H:%M:%SZ", time())
    for _, row in ipairs(E:Rows("boss_kill_owned")) do
      if row.characterKey == key and row.encounterId == encounterId and row.instanceMapId == mapId and row.difficulty == difficulty then
        row.lastKillAt, row.killCount = at, row.killCount + 1
        note()
        return
      end
    end
    E:Store("boss_kill_owned", { characterKey = key, encounterId = encounterId, instanceMapId = mapId,
      difficulty = difficulty, firstKillAt = at, lastKillAt = at, killCount = 1 })
    note()
  end)
  return note()
end, "completion")
