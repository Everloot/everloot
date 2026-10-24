-- Everloot core: event dispatch, module registry, toggles, SavedVariables store.
-- Legal: official Lua API only, own SavedVariables, nothing that plays the character.
-- Every Blizzard call is guarded: on beta, missing systems disable their module, never error.

Everloot = Everloot or {}
local E = Everloot

E.VERSION = "0.3.11"
E.MAX_ROWS_PER_KIND = 2000

-- Same Adler-32 the companion writes into its slot addons; Lua 5.1 arithmetic only.
function E.Adler32(s)
  local a, b = 1, 0
  for i = 1, #s do
    a = (a + s:byte(i)) % 65521
    b = (b + a) % 65521
  end
  return b * 65536 + a
end

--- The NPC id in a creature GUID (Creature-0-server-instance-zone-NPCID-spawn); nil for anything else.
function E.NpcIdFromGuid(guid)
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

local defaults = {
  version = E.VERSION,
  installId = nil,
  toggles = { openworld = true, guild = true, gear = true, auctions = true, gold = true, addons = false, talents = true, completion = false, census = true, players = false },
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

local modules = {}

function E:RegisterModule(name, init)
  modules[#modules + 1] = { name = name, init = init, ok = false, note = "pending" }
end

--- A module reports what it found while running (an API this client lacks, what the last window held).
function E:SetNote(name, note)
  for _, m in ipairs(modules) do
    if m.name == name and m.ok then m.note = note end
  end
end

function E:InitModules()
  for _, m in ipairs(modules) do
    if self:IsEnabled(m.name) then
      local ok, note = pcall(m.init, self)
      m.ok = ok
      m.note = ok and (note or "ready") or ("disabled: " .. tostring(note))
    else
      m.note = "off by toggle"
    end
  end
end

function E:Status()
  local lines = { "Everloot " .. E.VERSION .. " (" .. (EverlootDB and EverlootDB.installId or "?") .. ")" }
  for kind in pairs(EverlootDB and EverlootDB.paused or {}) do
    lines[#lines + 1] = "  " .. kind .. ": collection paused; retained rows were not deleted"
  end
  for _, m in ipairs(modules) do
    lines[#lines + 1] = string.format("  %s: %s", m.name, m.note)
  end
  for _, kind in ipairs({ "npc_sighting", "loot", "quest", "vendor", "item_seen", "item_fact",
    "object_sighting", "instance_entrance", "encounter", "guild_snapshot", "raid_lockout", "attendance", "loot_award", "gear_snapshot",
    "collection_catalog", "collection_owned", "auction_scan", "auction_snapshot", "recipe_seen", "recipe_observed", "trainer_seen", "price_seen",
    "gold_snapshot", "money_event", "addon_seen", "map_bounds", "talent_snapshot",
    "achievement_catalog", "reputation_catalog", "title_catalog", "quest_chain_catalog",
    "achievement_owned", "reputation_owned", "title_owned", "quest_owned", "census_self", "census_seen", "player_seen" }) do
    lines[#lines + 1] = string.format("  rows %s: %d", kind, self:Count(kind))
  end
  return table.concat(lines, "\n")
end

frame:RegisterEvent("ADDON_LOADED")
frame:SetScript("OnEvent", function(_, event, arg1)
  if event == "ADDON_LOADED" and arg1 == "Everloot" then
    local upgraded = EverlootDB ~= nil
    EverlootDB = EverlootDB or {}
    for k, v in pairs(defaults) do if EverlootDB[k] == nil then EverlootDB[k] = v end end
    -- The census starts on only for a new install; one from before it keeps it off until the player turns it on.
    if upgraded and EverlootDB.toggles.census == nil then EverlootDB.toggles.census = false end
    -- A toggle added after this file was created takes its default: off-by-default stays off.
    for k, v in pairs(defaults.toggles) do if EverlootDB.toggles[k] == nil then EverlootDB.toggles[k] = v end end
    if not EverlootDB.installId then EverlootDB.installId = newInstallId() end
    EverlootDB.version = E.VERSION
    EverlootDB.clientBuild = clientBuild()
    E:InitModules()
    print(E:Status())
    -- Said once per install, so a player never records other players without having been told.
    if EverlootDB.toggles.census and not EverlootDB.censusNotice then
      print("Everloot: census on. It records the race, class, level and faction of your characters and of players you target, mouse over or group with. Never their names, guilds, gear or where they are. It stays in this file unless the Everloot Desktop App, if you allowed the census there, or the everloot.app upload page sends it. /everloot census off stops it and deletes the rows.")
      EverlootDB.censusNotice = true
    end
  end
end)

SLASH_EVERLOOT1 = "/everloot"
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
  local workspace = type(msg) == "string" and msg:lower():match("^%s*planner%f[%s%z]%s*(.-)%s*$")
  if workspace and E.Planner then return E.Planner.Open(workspace) end
  msg = msg and msg:lower():gsub("^%s+", "") or ""
  local gph = msg:match("^gph%f[%s%z]%s*(.-)%s*$")
  if gph and E.GphCommand then return E.GphCommand(gph) end
  if msg == "" and E.Planner then
    E.Planner.Open()
  elseif msg == "status" or msg == "" then
    print(E:Status())
  elseif (msg == "options" or msg == "settings" or msg == "config") and E.Options then
    E.Options.Open()
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
      print("Everloot: completion tracker on. It reads your achievements, reputation, titles and completed quests, and never changes them. Your own progress is sent only from the everloot.app upload page, with the collection choice ticked. /reload to apply.")
    else
      -- Turning it off withdraws what it wrote: every completion row is deleted from this file.
      if E.Completion then E.Completion.Withdraw() end
      print("Everloot: completion tracker off; all recorded completion rows were deleted from this file. /reload to apply.")
    end
  elseif msg == "completion" and E.Completion then
    E.Completion.ReadNow()
  elseif msg == "census on" or msg == "census off" then
    EverlootDB.toggles.census = (msg == "census on")
    if EverlootDB.toggles.census then
      print("Everloot: census on. It records the race, class, level and faction of your characters and of players you target, mouse over or group with. Never their names, guilds, gear or where they are. It stays in this file unless the Everloot Desktop App, if you allowed the census there, or the everloot.app upload page sends it. /reload to apply.")
    else
      -- Turning it off withdraws what it wrote: every census row is deleted from this file.
      if E.Census then E.Census.Withdraw() end
      print("Everloot: census off; all census rows were deleted from this file.")
    end
  elseif msg == "census" and E.Census then
    print(E.Census.StatusLine())
  elseif msg == "players on" or msg == "players off" then
    EverlootDB.toggles.players = (msg == "players on")
    if EverlootDB.toggles.players then
      print("Everloot: players on. It records the name, realm, race, class, level and guild of your characters and of players you target, mouse over or group with, one row per character and the day you saw it. Never where they are, their gear or what they do. It is sent only from the everloot.app upload page, after its preview. If the site has player pages on, these characters can appear there, and anyone can have a character hidden. /reload to apply.")
    else
      -- Turning it off withdraws what it wrote: every player row is deleted from this file.
      if E.Players then E.Players.Withdraw() end
      print("Everloot: players off; all player rows were deleted from this file.")
    end
  elseif msg == "players" and E.Players then
    print(E.Players.StatusLine())
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
      print("Everloot: installed addon list on. It is sent only from the everloot.app upload page, which lists the addons first; the companion never sends it. /reload to apply.")
    else
      -- Turning it off withdraws the list: every recorded addon row is deleted from this file.
      EverlootDB.records.addon_seen = nil
      EverlootDB.addonsSeen = nil
      if EverlootDB.paused then EverlootDB.paused.addon_seen = nil end
      print("Everloot: installed addon list off; all recorded addon rows were deleted from this file. /reload to apply.")
    end
  else
    print("Everloot commands: /everloot options, /everloot status, /everloot auctions on|off, /everloot scan, /everloot scanprompt on|off, /everloot vendor on|off, /everloot mail on|off, /everloot price [item], /everloot gph [start|pause|stop|reset|show|history], /everloot addons on|off, /everloot completion [on|off], /everloot census [on|off], /everloot players [on|off], /everloot selftest, /everloot talents, /everloot plan [share code|number], /everloot raid [code], /ask <question>")
  end
end
