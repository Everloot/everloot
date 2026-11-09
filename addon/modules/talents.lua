-- Everloot talents: the player's own talent build, read through the game's trait API.
-- Reads the active spec group and, once dual spec is unlocked (level 40), the second one: config id,
-- tree id, and every spent node with its ranks and choice. Also asks the game for its own loadout
-- string (C_Traits.GenerateImportString) and stores it with a status saying whether that worked.
-- Read only: nothing here spends a point, imports a loadout or touches the talent window.
-- Every call is guarded, because Forever's trait API may differ from retail's.

local E = Everloot
local T = {}
E.Talents = T

local DEBOUNCE_SECONDS = 2

--- Value of a guarded call, or nil. Only the first return value is kept.
local function call(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, value = pcall(fn, ...)
  if ok then return value end
  return nil
end

T.Call = call

--- A spec-group function from C_SpecializationInfo, or the older global of the same name.
local function specFunction(name)
  if C_SpecializationInfo and type(C_SpecializationInfo[name]) == "function" then return C_SpecializationInfo[name] end
  if type(_G[name]) == "function" then return _G[name] end
  return nil
end

function T.HasTraitApi()
  return type(C_Traits) == "table" and type(C_Traits.GetConfigInfo) == "function"
    and type(C_Traits.GetTreeNodes) == "function" and type(C_Traits.GetNodeInfo) == "function"
end

--- The player's class token (MAGE) and level, or nil before the player exists.
function T.Player()
  if not UnitClass then return nil end
  local ok, _, token = pcall(UnitClass, "player")
  if not ok or type(token) ~= "string" or not token:find("^%a+$") then return nil end
  local level = tonumber(call(UnitLevel, "player"))
  if not level or level < 1 then return nil end
  return token, math.floor(level)
end

--- The client's per-class spec id (Forever has one per class), or nil.
function T.SpecId()
  local id
  if PlayerUtil and PlayerUtil.GetCurrentSpecID then id = call(PlayerUtil.GetCurrentSpecID) end
  if type(id) ~= "number" and GetSpecialization and GetSpecializationInfo then
    local index = call(GetSpecialization)
    if index then id = call(GetSpecializationInfo, index) end
  end
  if type(id) == "number" and id > 0 and id == math.floor(id) then return id end
  return nil
end

--- Spec groups with a readable config: { { group = 1, configID = n, active = bool }, ... }.
--- The second group appears only when the client reports it (dual spec unlocks at level 40).
function T.Groups()
  local count = tonumber(call(specFunction("GetNumSpecGroups"))) or 1
  count = math.max(1, math.min(2, math.floor(count)))
  local active = tonumber(call(specFunction("GetActiveSpecGroup"))) or 1
  local activeConfig = C_ClassTalents and call(C_ClassTalents.GetActiveConfigID)
  local combat = specFunction("GetCombatConfigIDForSpecGroup")
  local groups = {}
  for group = 1, count do
    local configID = combat and call(combat, group)
    if type(configID) ~= "number" and group == active then configID = activeConfig end
    if type(configID) == "number" then groups[#groups + 1] = { group = group, configID = configID, active = (group == active) } end
  end
  return groups
end

--- Index of an entry id among a node's entries, zero-based, only for a node that is a real choice.
local function choiceIndex(node)
  if type(node.entryIDs) ~= "table" or #node.entryIDs < 2 then return nil end
  local entry = type(node.activeEntry) == "table" and node.activeEntry.entryID
  if type(entry) ~= "number" then return nil end
  for i, id in ipairs(node.entryIDs) do
    if id == entry then return i - 1 end
  end
  return nil
end

--- Every node of the config's tree as the client reports it right now.
--- Returns { treeID, order = { nodeId... }, nodes = { [nodeId] = { ranks, max, choice, canBuy, entryIDs } } } or nil, reason.
function T.State(configID)
  if not T.HasTraitApi() then return nil, "trait API unavailable" end
  local info = call(C_Traits.GetConfigInfo, configID)
  if type(info) ~= "table" then return nil, "no config info" end
  local treeID = type(info.treeIDs) == "table" and info.treeIDs[1]
  if type(treeID) ~= "number" then return nil, "no tree id" end
  local ids = call(C_Traits.GetTreeNodes, treeID)
  if type(ids) ~= "table" or #ids == 0 then return nil, "no tree nodes" end
  local state = { treeID = treeID, order = {}, nodes = {} }
  for _, nodeId in ipairs(ids) do
    local node = call(C_Traits.GetNodeInfo, configID, nodeId)
    if type(node) == "table" and type(nodeId) == "number" then
      -- Spent ranks, not granted ones: a free node has activeRank without ranksPurchased.
      local ranks = node.ranksPurchased
      if type(ranks) ~= "number" then ranks = node.currentRank end
      if type(ranks) ~= "number" then ranks = node.activeRank end
      state.order[#state.order + 1] = nodeId
      state.nodes[nodeId] = {
        ranks = math.max(0, math.floor(tonumber(ranks) or 0)),
        max = tonumber(node.maxRanks),
        choice = choiceIndex(node),
        canBuy = node.canPurchaseRank,
        entryIDs = node.entryIDs,
      }
    end
  end
  if #state.order == 0 then return nil, "no node info" end
  return state
end

--- Blizzard's own loadout string for a config: string, status.
function T.Export(configID)
  if not (C_Traits and type(C_Traits.GenerateImportString) == "function") then return nil, "unavailable" end
  local ok, text = pcall(C_Traits.GenerateImportString, configID)
  if not ok then return nil, "failed" end
  if type(text) ~= "string" or text == "" then return nil, "empty" end
  if #text > 2000 or text:find("[^%w%+/]") then return nil, "unexpected" end
  return text, "ok"
end

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64_VALUE = {}
for i = 1, #B64 do B64_VALUE[B64:sub(i, i)] = i - 1 end

--- The version (8 bits) and spec id (16 bits) at the head of a loadout string. Values are packed
--- least-significant bit first, 6 bits per character. Returns nil for anything too short or not base64.
function T.DecodeHeader(text)
  if type(text) ~= "string" or #text < 4 then return nil end
  local position = 0
  local function bits(width)
    local value = 0
    for k = 0, width - 1 do
      local char = text:sub(math.floor(position / 6) + 1, math.floor(position / 6) + 1)
      local six = B64_VALUE[char]
      if not six then return nil end
      value = value + (math.floor(six / 2 ^ (position % 6)) % 2) * 2 ^ k
      position = position + 1
    end
    return value
  end
  local version = bits(8)
  local specId = version and bits(16)
  if not version or not specId then return nil end
  return version, specId
end

function T.SerializationVersion()
  local version = C_Traits and call(C_Traits.GetLoadoutSerializationVersion)
  if type(version) == "number" and version >= 0 and version <= 255 and version == math.floor(version) then return version end
  return nil
end

--- One snapshot row (without event fields) for a spec group, or nil, reason.
function T.Snapshot(entry)
  local class, level = T.Player()
  if not class then return nil, "no player yet" end
  local state, reason = T.State(entry.configID)
  if not state then return nil, reason end
  local nodes, points = {}, 0
  for _, nodeId in ipairs(state.order) do
    local node = state.nodes[nodeId]
    if node.ranks > 0 then
      -- Points are the sum of the stored ranks, which the intake checks.
      local ranks = math.min(node.ranks, 50)
      nodes[#nodes + 1] = { nodeId = nodeId, ranks = ranks, choice = node.choice }
      points = points + ranks
    end
  end
  local loadout, status = T.Export(entry.configID)
  local specId = entry.active and T.SpecId() or nil
  return {
    class = class,
    level = level,
    group = entry.group,
    active = entry.active,
    configId = entry.configID,
    treeId = state.treeID,
    specId = specId,
    clientBuild = EverlootDB.clientBuild,
    serializationVersion = T.SerializationVersion(),
    loadoutString = loadout,
    exportStatus = status,
    points = points,
    nodes = nodes,
  }
end

local function signature(row)
  local parts = { tostring(row.clientBuild), row.class, tostring(row.group), tostring(row.treeId), tostring(row.loadoutString) }
  for _, node in ipairs(row.nodes) do parts[#parts + 1] = node.nodeId .. ":" .. node.ranks .. ":" .. tostring(node.choice) end
  return table.concat(parts, "|")
end

--- Store a row for each spec group whose build changed since the last stored one.
local function record()
  if not E:IsEnabled("talents") then return "off" end
  if not T.HasTraitApi() then return "trait API unavailable" end
  EverlootDB.talentsSeen = type(EverlootDB.talentsSeen) == "table" and EverlootDB.talentsSeen or {}
  local stored = 0
  for _, entry in ipairs(T.Groups()) do
    local row = T.Snapshot(entry)
    -- A build with no spent points is not a build worth recording.
    if row and row.points > 0 then
      -- One seen-signature per character and group, so a second character's login does not store both again.
      local charKey = E.CharacterKey and E.CharacterKey()
      local key = (charKey and (charKey .. ":") or "") .. tostring(entry.group)
      local sig = signature(row)
      if EverlootDB.talentsSeen[key] ~= sig then
        row.installId = EverlootDB.installId
        row.capturedAt = date("!%Y-%m-%dT%H:%M:%SZ")
        if E:Store("talent_snapshot", row) then EverlootDB.talentsSeen[key] = sig; stored = stored + 1 end
      end
    end
  end
  return "stored " .. stored
end
T.Record = record

local pending = false
--- Trait events come in bursts; read once after they settle.
local function schedule()
  if C_Timer and type(C_Timer.After) == "function" then
    if pending then return end
    pending = true
    C_Timer.After(DEBOUNCE_SECONDS, function() pending = false; pcall(record) end)
  else
    pcall(record)
  end
end

E:RegisterModule("talents", function()
  if not T.HasTraitApi() then error("trait API unavailable", 0) end
  local f = E.frame
  local events = { "PLAYER_ENTERING_WORLD", "TRAIT_CONFIG_UPDATED", "ACTIVE_PLAYER_SPECIALIZATION_CHANGED",
    "PLAYER_TALENT_UPDATE", "PLAYER_LEVEL_UP" }
  local watched = {}
  for _, name in ipairs(events) do
    if pcall(function() f:RegisterEvent(name) end) then watched[name] = true end
  end
  f:HookScript("OnEvent", function(_, event)
    if watched[event] then schedule() end
  end)
  return "ready (your talent build when it changes; /everloot talents to print it)"
end)
