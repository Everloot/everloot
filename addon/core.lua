-- Everloot core: event dispatch, module registry, toggles, SavedVariables store.
-- Legal: official Lua API only, own SavedVariables, nothing that plays the character.
-- Every Blizzard call is guarded: on beta, missing systems disable their module, never error.

Everloot = Everloot or {}
local E = Everloot
-- The game passes the folder name as the first argument of each file; a folder extracted as Everloot-0.3.20 is still this addon.
local addonName = ... or "Everloot"

E.VERSION = "0.3.22"
E.MAX_ROWS_PER_KIND = 2000
-- Boss pull timing, dungeon and raid runs, and pull summaries (docs/design/specs/2026-11-02-pull-and-run-records-design.md).
-- Off in every build made from this file, nightlies included: openworld.lua then writes encounter rows as before,
-- pulls.lua does not load, and the saved file, /everloot status and every command read exactly as before
-- (addon/tests/pulls_contract.py compares them with main's). The release that ships them sets this to true
-- (docs/RELEASING.md, "Release gates").
E.RUN_RECORDS = false

-- Same Adler-32 the companion writes into its slot addons; Lua 5.1 arithmetic only.
function E.Adler32(s)
  local a, b = 1, 0
  for i = 1, #s do
    a = (a + s:byte(i)) % 65521
    b = (b + a) % 65521
  end
  return b * 65536 + a
end

--- Forever can hand an addon a value it may hold but not read (a unit's GUID or name, a position, a chat line):
--- parsing or calculating with one raises an error. It reads as missing here, so a caller's missing-field path runs.
function E.Readable(value)
  if issecretvalue and issecretvalue(value) then return nil end
  return value
end

local function hex8(n)
  return string.format("%04x%04x", math.floor(n / 65536) % 65536, n % 65536)
end

--- One guarded call to a global game function: its first two values, or nil on a missing function or an error.
local function playerCall(name)
  local fn = _G[name]
  if type(fn) ~= "function" then return nil end
  local ok, a, b = pcall(fn, "player")
  if not ok then return nil end
  return a, b
end

--- This character's opaque key (8 hex digits, never the name), class token and level, or nil, reason.
--- The one formula every module shares: completion rows, the roster and the gold ledger join on it.
function E.CharacterKey()
  local guid = E.Readable(playerCall("UnitGUID"))
  if type(guid) ~= "string" or guid == "" then return nil, "no player id" end
  local _, token = playerCall("UnitClass")
  token = E.Readable(token)
  if type(token) ~= "string" or not token:find("^%a+$") or #token < 2 or #token > 20 then return nil, "no class" end
  local level = tonumber(E.Readable((playerCall("UnitLevel"))))
  if not level or level < 1 then return nil, "no level" end
  return hex8(E.Adler32((EverlootDB.installId or "") .. ":" .. guid)), token, math.min(100, math.floor(level))
end

--- The NPC id in a creature GUID (Creature-0-server-instance-zone-NPCID-spawn); nil for anything else.
function E.NpcIdFromGuid(guid)
  guid = E.Readable(guid)
  if type(guid) ~= "string" then return nil end
  local parts = {}
  for p in guid:gmatch("[^-]+") do parts[#parts + 1] = p end
  if parts[1] == "Creature" or parts[1] == "Vehicle" then
    return tonumber(parts[6])
  end
  return nil
end

--- Copper as the site writes it: "1g 2s 3c", silver and copper always shown below a gold.
function E.Coins(copper)
  local gold, silver, coins = math.floor(copper / 10000), math.floor(copper % 10000 / 100), copper % 100
  local text = (gold > 0) and (gold .. "g " .. silver .. "s ") or ((silver > 0) and (silver .. "s ") or "")
  return text .. coins .. "c"
end

-- The game's own "N Gold", "N Silver" and "N Copper" strings, as patterns, so coin text reads in any language;
-- English where the client does not define them.
local COIN_UNITS = {
  { "GOLD_AMOUNT", "%d Gold", 10000 },
  { "SILVER_AMOUNT", "%d Silver", 100 },
  { "COPPER_AMOUNT", "%d Copper", 1 },
}

--- The copper a coin text names ("1 Gold, 20 Silver", "1,234 Gold", a money chat line), or nil when it holds no
--- amount. A count may carry any thousands separator. Read each call: the client's globals can arrive late.
function E.CoinText(text)
  text = E.Readable(text)
  if type(text) ~= "string" then return nil end
  local total = 0
  for _, unit in ipairs(COIN_UNITS) do
    local format = type(_G[unit[1]]) == "string" and _G[unit[1]] or unit[2]
    local p = format:gsub("[%^%$%(%)%.%[%]%*%+%-%?]", "%%%0"):gsub("%%d", "([%%d,%%.]+)")
    local digits = text:match(p)
    local amount = digits and tonumber((digits:gsub("%D", "")))
    if amount then total = total + amount * unit[3] end
  end
  return total >= 1 and total or nil
end

local defaults = {
  version = E.VERSION,
  installId = nil,
  toggles = { openworld = true, guild = true, gear = true, auctions = true, gold = true, roster = true, addons = false, talents = true, completion = false, census = true, players = false, professions = true },
  records = {},
}

local function newInstallId()
  local t = {}
  for _ = 1, 4 do t[#t + 1] = string.format("%04x", math.random(0, 0xffff)) end
  return table.concat(t, "-")
end

--- GetBuildInfo's version and build, e.g. 1.60.1.70450. Anything the intake would refuse is left out.
local function clientBuild()
  if not GetBuildInfo then return nil end
  local ok, version, build = pcall(GetBuildInfo)
  if not ok or type(version) ~= "string" or (type(build) ~= "string" and type(build) ~= "number") then return nil end
  local text = version .. "." .. tostring(build)
  if #text > 32 or text:find("[^%d%.]") or text:find("%.%.") or not text:find("^%d") or not text:find("%d$") then return nil end
  return text
end

local frame = CreateFrame("Frame")
E.frame = frame

function E:IsEnabled(module)
  return EverlootDB and EverlootDB.toggles and EverlootDB.toggles[module] ~= false
end

-- Rows per budget, counted from the file the first time a budget is used in a session, then kept up to date.
local budgetCounts = {}

local function budgetCount(kind, store, budget)
  local key = kind .. "/" .. budget.name
  local entry = budgetCounts[key]
  if not entry or entry.store ~= store or entry.n > #store then
    local n = 0
    for _, r in ipairs(store) do if budget.of(r) == budget.name then n = n + 1 end end
    entry = { store = store, n = n }
    budgetCounts[key] = entry
  end
  return entry
end

--- Preserve retained rows. At capacity, pause this kind instead of silently discarding data.
--- A `budget` ({ name, of = function(row) return its budget's name end }) gives one share of a kind its own
--- cap, so a busy share cannot fill the kind for the others; at capacity only that share pauses.
function E:Store(kind, row, cap, budget)
  if type(row) ~= "table" then return false end
  local store = EverlootDB.records[kind]
  if not store then store = {}; EverlootDB.records[kind] = store end
  local share = budget and budgetCount(kind, store, budget)
  local label = budget and (kind .. " (" .. budget.name .. ")") or kind
  -- A module whose rows replace each other may state its own bound; the others keep the file-wide one.
  if (share and share.n or #store) >= (cap or E.MAX_ROWS_PER_KIND) then
    EverlootDB.paused = EverlootDB.paused or {}
    if not EverlootDB.paused[label] then
      print("Everloot: " .. label .. " collection paused at capacity. Keep and upload your SavedVariables file.")
    end
    EverlootDB.paused[label] = true
    return false
  end
  -- Allocate once, not at export. Persist epoch + counter together; never reuse an ID.
  if not EverlootDB.eventEpoch or type(EverlootDB.nextEvent) ~= "number" then
    EverlootDB.eventEpoch = newInstallId() .. "-" .. tostring(time())
    EverlootDB.nextEvent = 0
  end
  if EverlootDB.nextEvent >= 9007199254740990 then return false end
  EverlootDB.nextEvent = EverlootDB.nextEvent + 1
  row.eventId = EverlootDB.eventEpoch .. ":" .. string.format("%.0f", EverlootDB.nextEvent)
  row.kindLoggedAt = date("!%Y-%m-%dT%H:%M:%SZ")
  store[#store + 1] = row
  if share then share.n = share.n + 1 end
  return true
end

function E:Count(kind)
  local store = EverlootDB.records[kind]
  return store and #store or 0
end

--- The rows of one kind as the saved file holds them; an empty list when there are none.
function E:Rows(kind)
  return (EverlootDB and EverlootDB.records and EverlootDB.records[kind]) or {}
end

local modules = {}

--- `toggle`, when given, is another module's switch this one follows (its rows go with that module's).
function E:RegisterModule(name, init, toggle)
  modules[#modules + 1] = { name = name, init = init, ok = false, note = "pending", toggle = toggle }
end

--- A module reports what it found while running (an API this client lacks, what the last window held).
function E:SetNote(name, note)
  for _, m in ipairs(modules) do
    if m.name == name and m.ok then m.note = note end
  end
end

function E:InitModules()
  for _, m in ipairs(modules) do
    if self:IsEnabled(m.toggle or m.name) then
      local ok, note = pcall(m.init, self)
      m.ok = ok
      m.note = ok and (note or "ready") or ("disabled: " .. tostring(note))
    else
      m.note = "off by toggle"
    end
  end
end

-- Counted in /everloot status only in the builds that write them.
local RUN_KINDS = { instance_run = true, pull_summary = true }

function E:Status()
  local lines = { "Everloot " .. E.VERSION .. " (" .. (EverlootDB and EverlootDB.installId or "?") .. ")" }
  for kind in pairs(EverlootDB and EverlootDB.paused or {}) do
    lines[#lines + 1] = "  " .. kind .. ": collection paused; retained rows were not deleted"
  end
  for _, m in ipairs(modules) do
    lines[#lines + 1] = string.format("  %s: %s", m.name, m.note)
  end
  for _, kind in ipairs({ "npc_sighting", "loot", "quest", "vendor", "item_seen", "item_fact",
    "object_sighting", "instance_entrance", "encounter", "instance_run", "guild_snapshot", "raid_lockout", "attendance", "loot_award", "gear_snapshot",
    "collection_catalog", "collection_owned", "auction_scan", "auction_snapshot", "recipe_seen", "recipe_observed", "trainer_seen", "price_seen",
    "gold_snapshot", "money_event", "addon_seen", "map_bounds", "talent_snapshot",
    "achievement_catalog", "reputation_catalog", "title_catalog", "quest_chain_catalog",
    "achievement_owned", "reputation_owned", "title_owned", "quest_owned", "census_self", "census_seen", "player_seen", "character_link", "pull_summary" }) do
    local count = self:Count(kind)
    if count > 0 and (E.RUN_RECORDS or not RUN_KINDS[kind]) then lines[#lines + 1] = string.format("  rows %s: %d", kind, count) end
  end
  -- Any other kind a module wrote (guild_kill, for one) follows, by name.
  local listed = {}
  for _, line in ipairs(lines) do
    local shown = line:match("^  rows (%S+):")
    if shown then listed[shown] = true end
  end
  local extra = {}
  for kind, store in pairs(EverlootDB and EverlootDB.records or {}) do
    if not listed[kind] and (E.RUN_RECORDS or not RUN_KINDS[kind]) and type(store) == "table" and #store > 0 then extra[#extra + 1] = kind end
  end
  table.sort(extra)
  for _, kind in ipairs(extra) do lines[#lines + 1] = string.format("  rows %s: %d", kind, self:Count(kind)) end
  return table.concat(lines, "\n")
end

--- The one line said at login and /reload: how many modules run, any that could not start and any paused
--- collection. The full list stays behind /everloot status, so chat is not filled on every load.
function E:LoginLine()
  local on, off, failed = 0, 0, {}
  for _, m in ipairs(modules) do
    if m.ok then on = on + 1
    elseif self:IsEnabled(m.toggle or m.name) then failed[#failed + 1] = m.name
    else off = off + 1 end
  end
  local text = string.format("Everloot %s: %d modules on, %d off", E.VERSION, on, off)
  if #failed > 0 then text = text .. "; could not start: " .. table.concat(failed, ", ") end
  local paused = 0
  for _ in pairs(EverlootDB and EverlootDB.paused or {}) do paused = paused + 1 end
  if paused > 0 then text = text .. string.format("; %d %s paused at capacity", paused, paused == 1 and "collection" or "collections") end
  return text .. ". /everloot status for details."
end

-- What pull summaries hold and where they go, said once per install and again on /everloot pulls on.
local PULLS_TEXT = "After each boss pull in a dungeon or raid it records your group: each member's name, class and role, and the damage, healing, damage taken and deaths the game's own damage meter shows, with the boss, kill or wipe and how long it took. Never their gear, guild, position or chat. The everloot.app upload page, after its preview, or the Everloot Desktop App sends it; the site keeps it privately for a year, shows it nowhere yet, and anyone can have a character hidden."

frame:RegisterEvent("ADDON_LOADED")
frame:SetScript("OnEvent", function(_, event, arg1)
  if event == "ADDON_LOADED" and arg1 == addonName then
    local upgraded = EverlootDB ~= nil
    EverlootDB = EverlootDB or {}
    for k, v in pairs(defaults) do if EverlootDB[k] == nil then EverlootDB[k] = v end end
    -- The census starts on only for a new install; one from before it keeps it off until the player turns it on.
    if upgraded and EverlootDB.toggles.census == nil then EverlootDB.toggles.census = false end
    -- A toggle added after this file was created takes its default: off-by-default stays off.
    for k, v in pairs(defaults.toggles) do if EverlootDB.toggles[k] == nil then EverlootDB.toggles[k] = v end end
    -- Pull summaries are on by default, in the builds that carry them; the others write no switch for them.
    if E.Pulls and EverlootDB.toggles.pulls == nil then EverlootDB.toggles.pulls = true end
    if not EverlootDB.installId then EverlootDB.installId = newInstallId() end
    EverlootDB.version = E.VERSION
    EverlootDB.clientBuild = clientBuild()
    E:InitModules()
    print(E:LoginLine())
    -- Said once per install, so a player never records other players without having been told.
    if EverlootDB.toggles.census and not EverlootDB.censusNotice then
      print("Everloot: census on. It records the race, class, level and faction of your characters and of players near you: ones you target, mouse over or group with, and ones the game shows a nameplate for (your nameplate settings decide which). Never their names, guilds, gear or where they are. It stays in this file unless the Everloot Desktop App, if you allowed the census there, or the everloot.app upload page sends it. /everloot census off stops it and deletes the rows.")
      EverlootDB.censusNotice = true
    end
    -- Pull summaries name the group, so they are announced once per install too, in the builds that carry them.
    if E.Pulls and EverlootDB.toggles.pulls and not EverlootDB.pullsNotice then
      print("Everloot: boss pulls on. " .. PULLS_TEXT .. " /everloot pulls off stops it and deletes the rows.")
      EverlootDB.pullsNotice = true
    end
  end
end)

SLASH_EVERLOOT1 = "/everloot"
-- This lookup uses retained rows only. Counts are loot windows, never stack sizes or drop rates.
function E.WhereCommand(query)
  local records = type(EverlootDB) == "table" and EverlootDB.records or {}
  records = type(records) == "table" and records or {}
  local function rows(kind) return type(records[kind]) == "table" and records[kind] or {} end
  local function text(value) return (tostring(value):gsub("|", "||")) end
  local MAX_SOURCES, MAX_PLACES = 8, 3
  local mapNames = {}
  local function location(row)
    if not row.mapId then return "location not recorded" end
    local zone = mapNames[row.mapId]
    if not zone then
      -- GetMapInfo is also used by prices.lua; it reads the client's map label, not an observation.
      local name
      if C_Map and C_Map.GetMapInfo then
        local ok, info = pcall(C_Map.GetMapInfo, row.mapId)
        if ok and type(info) == "table" then name = info.name end
      end
      zone = text(name or ("zone " .. row.mapId))
      mapNames[row.mapId] = zone
    end
    if type(row.x) == "number" and type(row.y) == "number" then
      return zone .. string.format(" (%d, %d)", math.floor(row.x + 0.5), math.floor(row.y + 0.5))
    end
    return zone .. " (coordinates not recorded)"
  end
  -- Each sighting kind is read once per command into id -> { name, places }, so a large saved file costs one pass.
  local sightingIndex = {}
  local function sightings(kind, id)
    local index = sightingIndex[kind]
    if not index then
      index = {}
      local field = kind == "npc" and "npcId" or "objectId"
      for _, row in ipairs(rows(kind .. "_sighting")) do
        local key = type(row) == "table" and row[field]
        if key then
          local entry = index[key] or { places = {} }
          entry.name = row.name or entry.name
          entry.places[location(row)] = true
          index[key] = entry
        end
      end
      sightingIndex[kind] = index
    end
    local entry = index[id]
    local places = {}
    if entry then for place in pairs(entry.places) do places[place] = true end end
    return entry and entry.name, places
  end
  local function placesText(places)
    local sorted = {}
    for place in pairs(places) do sorted[#sorted + 1] = place end
    table.sort(sorted)
    if #sorted == 0 then return "location not recorded" end
    local shown = {}
    for i = 1, math.min(#sorted, MAX_PLACES) do shown[i] = sorted[i] end
    local line = table.concat(shown, "; ")
    if #sorted > MAX_PLACES then line = line .. "; " .. (#sorted - MAX_PLACES) .. " more" end
    return line
  end
  local id = tonumber(query:match("^%d+$") or query:match("|Hitem:(%d+):"))
  local found = false
  if id then
    for _, source in ipairs({ { kind = "loot", label = "Drop" }, { kind = "vendor", label = "Vendor" } }) do
      local groups, order = {}, {}
      for _, row in ipairs(rows(source.kind)) do
        local matches = false
        local items = type(row) == "table" and type(row.items) == "table" and row.items or {}
        for _, item in ipairs(items) do
          if type(item) == "table" and item.itemId == id then matches = true; break end
        end
        local kind = row.sourceObjectId and "object" or "npc"
        local sourceId = row.vendorNpcId or row.sourceNpcId or row.sourceObjectId
        if matches and sourceId then
          local key = kind .. ":" .. sourceId
          if not groups[key] then
            local name, places = sightings(kind, sourceId)
            groups[key] = { name = name or row.sourceObjectName or (kind .. " " .. sourceId), places = places, count = 0 }
            order[#order + 1] = key
          end
          local group = groups[key]
          group.count = group.count + 1
          if row.mapId then group.places[location(row)] = true end
        end
      end
      -- Most-seen sources first; chat gets at most MAX_SOURCES lines per kind.
      table.sort(order, function(a, b)
        if groups[a].count ~= groups[b].count then return groups[a].count > groups[b].count end
        return a < b
      end)
      for i = 1, math.min(#order, MAX_SOURCES) do
        local group = groups[order[i]]
        local unit = source.kind == "loot" and " loot window" or " vendor record"
        print("Everloot: " .. source.label .. " - " .. text(group.name) .. ": " .. placesText(group.places)
          .. " - " .. group.count .. unit .. (group.count == 1 and "" or "s"))
        found = true
      end
      if #order > MAX_SOURCES then
        print("Everloot: and " .. (#order - MAX_SOURCES) .. " more " .. string.lower(source.label) .. " sources")
      end
    end
  elseif query ~= "" then
    local places = {}
    for _, row in ipairs(rows("npc_sighting")) do
      if type(row.name) == "string" and row.name:lower() == query:lower() then
        places[location(row)] = true
      end
    end
    if next(places) then
      print("Everloot: " .. text(query) .. ": " .. placesText(places))
      found = true
    end
  else
    print("Everloot: /everloot where <item link, item id, or NPC name>")
    return
  end
  if not found and query ~= "" then print("Everloot: nothing recorded yet") end
  local url = id and ("everloot.app/database/items/" .. string.format("%.0f", id))
    or ("everloot.app/search?q=" .. query:gsub("([^%w%-._~])", function(c) return string.format("%%%02X", c:byte()) end))
  print("Everloot: your own sightings only - " .. url)
end

SlashCmdList["EVERLOOT"] = function(msg)
  -- A question keeps its case, so it is routed before the command is lowercased.
  local question = type(msg) == "string" and msg:match("^%s*[Aa][Ss][Kk]%s+(.+)$")
  if question and E.Ask then return E:Ask(question) end
  -- A share code is case-sensitive, so it is routed before the command is lowercased.
  local plan = type(msg) == "string" and msg:match("^%s*[Pp][Ll][Aa][Nn]%s*(.-)%s*$")
  if plan and E.PlanCommand and msg:lower():match("^%s*plan%f[%s%z]") then return E.PlanCommand(plan) end
  -- An item name or link keeps its case too: the price of an item, from the files already in the game.
  local item = type(msg) == "string" and msg:match("^%s*[Pp][Rr][Ii][Cc][Ee]%s*(.-)%s*$")
  if item and E.PriceCommand and msg:lower():match("^%s*price%f[%s%z]") then return E.PriceCommand(item) end
  local where = type(msg) == "string" and msg:match("^%s*[Ww][Hh][Ee][Rr][Ee]%s*(.-)%s*$")
  if where and msg:lower():match("^%s*where%f[%s%z]") then return E.WhereCommand(where) end
  local workspace = type(msg) == "string" and msg:lower():match("^%s*planner%f[%s%z]%s*(.-)%s*$")
  if workspace and E.Planner then return E.Planner.Open(workspace) end
  msg = msg and msg:lower():gsub("^%s+", "") or ""
  local gph = msg:match("^gph%f[%s%z]%s*(.-)%s*$")
  if gph and E.GphCommand then return E.GphCommand(gph) end
  local link = msg:match("^link%f[%s%z]%s*(.-)%s*$")
  if link and E.Link then return E.Link.Command(link) end
  if msg == "" and E.Planner then
    E.Planner.Open()
  elseif msg == "status" or msg == "" then
    print(E:Status())
  elseif (msg == "options" or msg == "settings" or msg == "config") and E.Options then
    E.Options.Open()
  elseif msg == "window" and E.Window then
    E.Window.Toggle()
  elseif msg == "buttons on" or msg == "buttons off" then
    EverlootDB.toggles.buttons = (msg == "buttons on")
    if EverlootDB.toggles.buttons then
      print("Everloot: other addons' minimap buttons gather into the Everloot minimap button after /reload.")
    else
      -- Simplest correct restore: nothing is moved back in place; without the drawer, LibDBIcon places them again.
      print("Everloot: other addons' minimap buttons stay on the minimap; any in the Everloot button return after /reload.")
    end
  elseif msg == "version" then
    print("Everloot " .. E.VERSION)
  elseif msg == "selftest" and E.SelfTest then
    E.SelfTest()
  elseif msg == "talents" and E.PrintTalents then
    E.PrintTalents()
  elseif (msg == "raid" or msg == "raid code") and E.RaidCommand then
    E.RaidCommand(msg == "raid code" and "code" or nil)
  elseif msg == "auctions on" or msg == "auctions off" then
    EverlootDB.toggles.auctions = (msg == "auctions on")
    print("Everloot: auction scans " .. (EverlootDB.toggles.auctions and "on" or "off") .. ". /reload to apply.")
  elseif msg == "completion on" or msg == "completion off" then
    EverlootDB.toggles.completion = (msg == "completion on")
    if EverlootDB.toggles.completion then
      print("Everloot: completion tracker on. It reads your achievements, reputation, titles and completed quests, and never changes them. It also records your professions, this week's raid lockouts, active talent build, character sheet stats and PvP standing. Achievements, reputation, titles and quests leave this computer from the everloot.app upload page; achievements, reputation and titles also go through the Everloot Desktop App's private sync for a character you linked. Professions, raid lockouts, the talent build, stats and PvP never go in an upload; they leave only through private sync. everloot.app keeps only the categories you switched on there. /reload to apply.")
    else
      -- Turning it off withdraws what it wrote: every completion row is deleted from this file.
      if E.Completion then E.Completion.Withdraw() end
      if E.Owned then E.Owned.Withdraw() end
      if E.CharStats then E.CharStats.Withdraw() end
      if E.Pvp then E.Pvp.Withdraw() end
      print("Everloot: completion tracker off; all recorded completion rows were deleted from this file. /reload to apply.")
    end
  elseif msg == "completion" and E.Completion then
    E.Completion.ReadNow()
  elseif msg == "census on" or msg == "census off" then
    EverlootDB.toggles.census = (msg == "census on")
    if EverlootDB.toggles.census then
      print("Everloot: census on. It records the race, class, level and faction of your characters and of players near you: ones you target, mouse over or group with, and ones the game shows a nameplate for (your nameplate settings decide which). Never their names, guilds, gear or where they are. It stays in this file unless the Everloot Desktop App, if you allowed the census there, or the everloot.app upload page sends it. /reload to apply.")
    else
      -- Turning it off withdraws what it wrote: every census row is deleted from this file.
      if E.Census then E.Census.Withdraw() end
      print("Everloot: census off; all census rows were deleted from this file.")
    end
  elseif msg == "census" and E.Census then
    print(E.Census.StatusLine())
  elseif msg == "players on" or msg == "players off" then
    EverlootDB.toggles.players = (msg == "players on")
    -- A choice made by hand answers the one-time question too (modules/options.lua), so it is never asked after.
    EverlootDB.playersAsked = true
    if EverlootDB.toggles.players then
      print("Everloot: players on. It records the name, realm, race, class, level and guild of your characters and of players you target, mouse over or group with, one row per character and the day you saw it, and the bosses your guild kills (the guild, the boss and the time, no names). Never where they are, their gear or what they do. It is sent only from the everloot.app upload page, after its preview. If the site has player pages on, these characters can appear there, and anyone can have a character hidden. /reload to apply.")
    else
      -- Turning it off withdraws what it wrote: every player row is deleted from this file.
      if E.Players then E.Players.Withdraw() end
      print("Everloot: players off; all player rows were deleted from this file.")
    end
  elseif msg == "players" and E.Players then
    print(E.Players.StatusLine())
  elseif E.Pulls and (msg == "pulls on" or msg == "pulls off") then
    EverlootDB.toggles.pulls = (msg == "pulls on")
    if EverlootDB.toggles.pulls then
      EverlootDB.pullsNotice = true
      print("Everloot: pulls on. " .. PULLS_TEXT .. " /reload to apply.")
    else
      -- Turning it off withdraws what it wrote: every pull summary is deleted from this file.
      E.Pulls.Withdraw()
      print("Everloot: pulls off; all pull summaries were deleted from this file.")
    end
  elseif E.Pulls and msg == "pulls" then
    print(E.Pulls.StatusLine())
  elseif msg == "scanprompt on" or msg == "scanprompt off" then
    EverlootDB.scanPrompt = (msg == "scanprompt on")
    print("Everloot: the scan prompt at the auction house is " .. (EverlootDB.scanPrompt and "on" or "off")
      .. ". The Everloot scan button and /everloot scan still work.")
  elseif msg == "vendor on" or msg == "vendor off" then
    EverlootDB.autoVendor = (msg == "vendor on")
    print("Everloot: at a merchant, " .. (EverlootDB.autoVendor and "sell grey items and repair with your own gold is on. Guild-bank repair is never used." or "selling grey items and repairing is off."))
  elseif msg == "mail on" or msg == "mail off" then
    EverlootDB.mailCollect = (msg == "mail on")
    print("Everloot: the Collect all button at the mailbox is " .. (EverlootDB.mailCollect and "on. It takes money and items from auction letters only, never cash on delivery." or "off."))
  elseif msg == "scan" then
    if E.StartScan then E:StartScan() else print("Everloot: full scans are not available in this client.") end
  elseif msg == "addons on" or msg == "addons off" then
    EverlootDB.toggles.addons = (msg == "addons on")
    if EverlootDB.toggles.addons then
      print("Everloot: installed addon list on. It is sent only from the everloot.app upload page, which lists the addons first; the Everloot Desktop App never sends it. /reload to apply.")
    else
      -- Turning it off withdraws the list: every recorded addon row is deleted from this file.
      EverlootDB.records.addon_seen = nil
      EverlootDB.addonsSeen = nil
      if EverlootDB.paused then EverlootDB.paused.addon_seen = nil end
      print("Everloot: installed addon list off; all recorded addon rows were deleted from this file. /reload to apply.")
    end
  else
    print("Everloot commands: /everloot window, /everloot options, /everloot planner [talents|raid], /everloot buttons on|off, /everloot status, /everloot version, /everloot auctions on|off, /everloot scan, /everloot scanprompt on|off, /everloot vendor on|off, /everloot mail on|off, /everloot price [item], /everloot where [item link|item id|NPC name], /everloot gph [start|pause|stop|reset|show|hide|cut on|off|history], /everloot addons on|off, /everloot completion [on|off], /everloot census [on|off], /everloot players [on|off], " .. (E.Pulls and "/everloot pulls [on|off], " or "") .. "/everloot link [code|clear], /everloot selftest, /everloot talents, /everloot plan [share code|number|hide|clear], /everloot raid [code], /ask <question>")
  end
end
