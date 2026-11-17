-- Everloot selftest: /everloot selftest
-- One run on the beta client checks each talent API the addon relies on, whether it returns sane
-- data, and whether the loadout export and import functions exist. Pass, fail and info lines go to
-- chat and to EverlootDB.selftest, so one session settles the open items. It also prints your race
-- token, the value the census stores.
-- Read only. The import and view functions are checked for existence and never called.

local E = Everloot
local T = E.Talents

local results

local function add(status, name, detail)
  results[#results + 1] = { status = status, text = status .. " " .. name .. (detail and (": " .. detail) or "") }
end

local function check(ok, name, detail, failDetail)
  add(ok and "PASS" or "FAIL", name, ok and detail or (failDetail or detail))
  return ok
end

local function has(tbl, name)
  return type(tbl) == "table" and type(tbl[name]) == "function"
end

local function checkApi()
  if not check(type(C_Traits) == "table", "C_Traits exists", "present", "no C_Traits table: talents cannot be read") then return false end
  local needed = {
    { "GetConfigInfo", "config and tree ids" }, { "GetTreeNodes", "node list" }, { "GetNodeInfo", "ranks and choices" },
    { "GetEntryInfo", "talent names in the plan panel" }, { "GetDefinitionInfo", "talent names in the plan panel" },
    { "GenerateImportString", "Blizzard loadout export" }, { "GetLoadoutSerializationVersion", "loadout string version" },
    { "GetTreeHash", "loadout string tree check" },
  }
  local core = true
  for _, item in ipairs(needed) do
    local ok = check(has(C_Traits, item[1]), "C_Traits." .. item[1], "present", "missing, needed for " .. item[2])
    if not ok and (item[1] == "GetConfigInfo" or item[1] == "GetTreeNodes" or item[1] == "GetNodeInfo") then core = false end
  end
  check(type(C_ClassTalents) == "table", "C_ClassTalents exists", "present", "no C_ClassTalents table")
  check(has(C_ClassTalents, "GetActiveConfigID"), "C_ClassTalents.GetActiveConfigID", "present", "missing, the active config falls back to the spec group lookup")
  check(has(C_ClassTalents, "ImportLoadout"), "C_ClassTalents.ImportLoadout exists", "present (not called: the addon never imports for you)", "missing: a build cannot be loaded by string")
  check(has(C_ClassTalents, "ViewLoadout"), "C_ClassTalents.ViewLoadout exists", "present (not called)", "missing: a talentbuild link cannot open a view")
  return core
end

local function checkGroups()
  local count = tonumber(T.Call(C_SpecializationInfo and C_SpecializationInfo.GetNumSpecGroups or _G.GetNumSpecGroups))
  local active = tonumber(T.Call(C_SpecializationInfo and C_SpecializationInfo.GetActiveSpecGroup or _G.GetActiveSpecGroup))
  local combat = (C_SpecializationInfo and C_SpecializationInfo.GetCombatConfigIDForSpecGroup) or _G.GetCombatConfigIDForSpecGroup
  check(type(count) == "number", "spec group count", count and (count .. " group(s); the second unlocks at level 40") or nil, "no GetNumSpecGroups: only the active config is read")
  check(type(active) == "number", "active spec group", active and tostring(active) or nil, "no GetActiveSpecGroup")
  check(type(combat) == "function", "GetCombatConfigIDForSpecGroup", "present", "missing: the second spec's config cannot be found")
  local class, level = T.Player()
  check(class ~= nil, "player class and level", class and (class .. " level " .. level) or nil, "UnitClass/UnitLevel gave nothing")
  local spec = T.SpecId()
  add(spec and "INFO" or "FAIL", "spec id", spec and (tostring(spec) .. " (the loadout string header should carry the same id)") or "PlayerUtil.GetCurrentSpecID and GetSpecialization both gave nothing")
end

local function checkGroup(entry)
  local label = "group " .. entry.group .. (entry.active and " (active)" or "")
  local state, reason = T.State(entry.configID)
  if not check(state ~= nil, label .. " reads", state and ("config " .. entry.configID .. ", tree " .. state.treeID .. ", " .. #state.order .. " nodes") or nil, reason) then return end
  local ascending, sane, spent = true, true, 0
  for i, nodeId in ipairs(state.order) do
    if i > 1 and nodeId <= state.order[i - 1] then ascending = false end
    local node = state.nodes[nodeId]
    if type(node.max) ~= "number" or node.max < 1 then sane = false end
    spent = spent + node.ranks
  end
  check(ascending, label .. " node order", "GetTreeNodes returns ascending node ids", "GetTreeNodes is not ascending: sort before writing a loadout string")
  check(sane, label .. " node data", "every node has maxRanks", "some nodes have no maxRanks")
  add("INFO", label .. " points", spent .. " spent")
  local text, status = T.Export(entry.configID)
  local version = T.SerializationVersion()
  if not check(text ~= nil, label .. " loadout export", text and ("string of " .. #text .. " characters") or nil, "GenerateImportString: " .. status) then return end
  local headerVersion, headerSpec = T.DecodeHeader(text)
  check(headerVersion ~= nil, label .. " export header", "version " .. tostring(headerVersion) .. ", spec " .. tostring(headerSpec), "the string is too short or not base64")
  if headerVersion then
    check(version == nil or headerVersion == version, label .. " export version", "header " .. headerVersion .. ", GetLoadoutSerializationVersion " .. tostring(version), "header " .. headerVersion .. " but GetLoadoutSerializationVersion " .. tostring(version))
    local spec = T.SpecId()
    if entry.active and spec then
      check(headerSpec == spec, label .. " export spec id", "header and client agree on " .. spec, "header says " .. headerSpec .. ", client says " .. spec)
    end
  end
end

local function checkWindow()
  local frame = PlayerSpellsFrame
  if type(frame) ~= "table" then
    add("SKIP", "talent window", "PlayerSpellsFrame is not loaded yet: open the talent window (N) and run this again")
    return
  end
  add("INFO", "talent window", "PlayerSpellsFrame exists" .. ((type(frame.IsShown) == "function" and frame:IsShown()) and ", open" or ", closed"))
  local talents = frame.TalentsFrame
  check(type(talents) == "table", "PlayerSpellsFrame.TalentsFrame", "present", "missing: the plan panel cannot highlight talents")
  if type(talents) == "table" then
    check(type(talents.GetTalentButtonByNodeID) == "function", "TalentsFrame.GetTalentButtonByNodeID", "present", "missing: the plan panel lists talents but cannot highlight them")
  end
end

--- The census stores the race token, the second value of UnitRace. A beta login confirms Skyborne's.
local function checkRace()
  local ok, name, raceToken, raceId = pcall(UnitRace or error, "player")
  local factionOk, faction = pcall(UnitFactionGroup or error, "player")
  if not ok or type(raceToken) ~= "string" then
    add("INFO", "player race", "UnitRace gave nothing: the census cannot record your character")
    return
  end
  add("INFO", "player race", string.format("token %s, name %s, id %s, faction %s", raceToken, tostring(name), tostring(raceId), factionOk and tostring(faction) or "?"))
end

local function run()
  results = {}
  local core = checkApi()
  checkGroups()
  if core then
    local groups = T.Groups()
    check(#groups > 0, "config ids", #groups .. " spec group(s) readable", "no spec group gave a config id")
    for _, entry in ipairs(groups) do checkGroup(entry) end
    add("INFO", "serialization version", tostring(T.SerializationVersion()))
  end
  checkWindow()
  checkRace()
  local passed, failed = 0, 0
  local text = {}
  for _, r in ipairs(results) do
    if r.status == "PASS" then passed = passed + 1 elseif r.status == "FAIL" then failed = failed + 1 end
    text[#text + 1] = r.text
  end
  EverlootDB.selftest = {
    at = date("!%Y-%m-%dT%H:%M:%SZ"),
    addonVersion = E.VERSION,
    clientBuild = EverlootDB.clientBuild,
    passed = passed,
    failed = failed,
    results = text,
  }
  print("Everloot selftest, addon " .. E.VERSION .. ", build " .. tostring(EverlootDB.clientBuild))
  for _, line in ipairs(text) do print("  " .. line) end
  print(string.format("Everloot selftest: %d passed, %d failed. Saved in your SavedVariables; log out to write the file.", passed, failed))
  return passed, failed
end

E.SelfTest = run

--- /everloot talents: print the active build, its share code, and the Blizzard string when available.
function E.PrintTalents()
  local P = E.Plan
  local shown = 0
  for _, entry in ipairs(T.Groups()) do
    local row = T.Snapshot(entry)
    if row then
      shown = shown + 1
      print(string.format("Everloot talents, spec group %d%s: %d points, export %s", row.group, row.active and " (active)" or "", row.points, row.exportStatus))
      if P and row.clientBuild then
        local entries = {}
        for _, node in ipairs(row.nodes) do entries[#entries + 1] = { nodeId = node.nodeId, rank = node.ranks, choice = node.choice } end
        if #entries > 0 then
          print("  share code: " .. P.Encode({ class = row.class, spec = row.specId or 0, build = row.clientBuild, entries = entries }))
        end
      end
    end
  end
  if shown == 0 then print("Everloot: no talents could be read (run /everloot selftest).") end
end
