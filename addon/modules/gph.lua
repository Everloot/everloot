-- Everloot gold per hour: a session tracker for the player's own farming. It counts the items the player
-- loots, the money they loot or get from quests and what they sell to vendors, while a session runs
-- (pauses excluded). Items are valued from the Everloot market value (the file the Desktop App or companion
-- writes), else the player's own last scan, else the vendor price, and every value says which it used.
-- Finished sessions stay in EverlootDB.gph.sessions (the last 50) for the Desktop App. They are not
-- records: no uploader reads them and nothing here is sent anywhere. Display only: nothing here acts.

local E = Everloot
local G = {}
E.Gph = G

G.HISTORY = 50     -- finished sessions kept
G.MAX_ITEMS = 200  -- distinct items one session counts
G.MAX_ZONES = 10   -- zones one session names
G.AH_CUT = 0.05    -- the faction houses' cut, as the site's calculator took it
G.TOP = 5          -- items the window lists

local panel
local merchantOpen, lootOpen = false, false
local lastMoney = nil

local function say(msg) print("Everloot: " .. msg) end

local function data()
  local db = EverlootDB.gph
  if type(db) ~= "table" then db = {}; EverlootDB.gph = db end
  if type(db.sessions) ~= "table" then db.sessions = {} end
  if db.cut == nil then db.cut = true end
  return db
end

local function current() return data().current end

local function playerMoney()
  if not GetMoney then return nil end
  local ok, copper = pcall(GetMoney)
  if ok and type(copper) == "number" and copper >= 0 then return copper end
  return nil
end

local function zoneName()
  for _, fn in ipairs({ GetRealZoneText, GetZoneText }) do
    if fn then
      local ok, zone = pcall(fn)
      zone = E.Readable(zone)
      if ok and type(zone) == "string" and zone ~= "" then return zone end
    end
  end
  return nil
end

--- Seconds the session has run, pauses left out.
function G.Elapsed(s)
  return (s.elapsed or 0) + (s.runningSince and math.max(0, time() - s.runningSince) or 0)
end

-- A game format string ("You receive loot: %sx%d.") as an anchored Lua pattern, or nil.
local function pattern(format)
  if type(format) ~= "string" or format == "" then return nil end
  local p = format:gsub("([%(%)%.%%%+%-%*%?%[%]%^%$])", "%%%1")
  p = p:gsub("%%%%s", "(.+)"):gsub("%%%%d", "(%%d+)")
  return "^" .. p .. "$"
end

-- Own loot only: the "You receive loot" lines. Items pushed into the bags (quest rewards, purchases,
-- crafts) and other players' loot use other strings and are not counted.
local lootPatterns
local function ownLoot(text)
  if not lootPatterns then
    lootPatterns = {}
    for _, entry in ipairs({ { LOOT_ITEM_SELF_MULTIPLE, true }, { LOOT_ITEM_SELF, false } }) do
      local p = pattern(entry[1])
      if p then lootPatterns[#lootPatterns + 1] = { p, entry[2] } end
    end
  end
  for _, entry in ipairs(lootPatterns) do
    local link, count = text:match(entry[1])
    if link then
      local id = tonumber(link:match("item:(%d+)"))
      if id then return id, entry[2] and tonumber(count) or 1 end
    end
  end
  return nil
end

-- Copper in a money line ("You loot 1 Gold, 2 Silver, 3 Copper"), from the game's own coin words.
local coinPatterns
local function copperIn(text)
  if not coinPatterns then
    coinPatterns = {}
    for _, coin in ipairs({ { GOLD_AMOUNT, 10000 }, { SILVER_AMOUNT, 100 }, { COPPER_AMOUNT, 1 } }) do
      local p = pattern(coin[1])
      if p then coinPatterns[#coinPatterns + 1] = { p:sub(2, -2), coin[2] } end
    end
  end
  local copper = 0
  for _, coin in ipairs(coinPatterns) do
    local n = tonumber(text:match(coin[1]))
    if n then copper = copper + n * coin[2] end
  end
  return copper
end

--- Money lines can be read when the client has its coin words; otherwise money looted while a loot
--- window is open is counted from the change in the player's money.
local function moneyFromChat()
  return type(GOLD_AMOUNT) == "string" and type(SILVER_AMOUNT) == "string" and type(COPPER_AMOUNT) == "string"
end

local function vendorPrice(itemId)
  local info = (type(C_Item) == "table" and C_Item.GetItemInfo) or GetItemInfo
  if not info then return nil end
  local result = { pcall(info, itemId) }
  -- name, link, quality, level, required level, type, subtype, stack, slot, icon, sell price
  local sell = result[1] and result[12]
  return type(sell) == "number" and sell > 0 and sell or nil
end

local function itemName(itemId)
  local info = (type(C_Item) == "table" and C_Item.GetItemInfo) or GetItemInfo
  local ok, name, link = false, nil, nil
  if info then ok, name, link = pcall(info, itemId) end
  return ok and (link or name) or ("item " .. itemId)
end

--- One unit's value and where it came from: "market" (the Everloot market value on this realm), "scan"
--- (the player's own last full scan), "vendor" (the game's sell price) or "none". `cut` takes the auction
--- house's 5% from market and scan values: they are prices someone pays, not what the seller keeps.
function G.Value(itemId, cut)
  local realm = GetRealmName and GetRealmName()
  local unit, source = 0, "none"
  if type(realm) == "string" and realm ~= "" then
    local row = E.CommunityPrice and E:CommunityPrice(realm, itemId)
    local own = E.OwnScan and E:OwnScan(realm)
    local scanned = own and own.items[itemId]
    if row and row.market and row.market > 0 then unit, source = row.market, "market"
    elseif scanned and scanned[5] and scanned[5] > 0 then unit, source = scanned[5], "scan" end
  end
  if source == "none" then
    local sell = vendorPrice(itemId)
    if sell then unit, source = sell, "vendor" end
  end
  if cut and (source == "market" or source == "scan") then unit = math.floor(unit * (1 - G.AH_CUT)) end
  return unit, source
end

--- The session's numbers now: items valued and sorted by value, totals and gold per hour. `cut`
--- defaults to the player's setting (/everloot gph cut on|off).
function G.Summary(s, cut)
  if cut == nil then cut = data().cut end
  local items, itemValue, sources = {}, 0, { market = 0, scan = 0, vendor = 0, none = 0 }
  for id, count in pairs(s.counts or {}) do
    local unit, source = G.Value(id, cut)
    items[#items + 1] = { id, count, unit, source }
    itemValue = itemValue + unit * count
    sources[source] = sources[source] + 1
  end
  table.sort(items, function(a, b)
    local va, vb = a[2] * a[3], b[2] * b[3]
    if va ~= vb then return va > vb end
    return a[1] < b[1]
  end)
  local money = s.money or {}
  local total = itemValue + (money.loot or 0) + (money.quest or 0)
  local seconds = G.Elapsed(s)
  return {
    items = items, itemValue = itemValue, sources = sources, total = total, seconds = seconds,
    perHour = seconds > 0 and math.floor(total * 3600 / seconds) or 0,
  }
end

local function addZone(s)
  local zone = zoneName()
  if not zone then return end
  s.zone = s.zone or zone
  for _, z in ipairs(s.zones) do if z == zone then return end end
  if #s.zones < G.MAX_ZONES then s.zones[#s.zones + 1] = zone end
end

local function newSession()
  local name = UnitName and E.Readable(UnitName("player"))
  local realm = GetRealmName and E.Readable(GetRealmName())
  local s = {
    v = 1,
    character = type(name) == "string" and name or nil,
    realm = type(realm) == "string" and realm or nil,
    startedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
    elapsed = 0, runningSince = time(),
    counts = {}, distinct = 0,
    money = { loot = 0, quest = 0, vendor = 0 },
    zones = {},
  }
  addZone(s)
  return s
end

local function running()
  local s = current()
  return s and s.runningSince and s or nil
end

local function addItem(itemId, count)
  local s = running()
  if not s or count < 1 then return end
  if not s.counts[itemId] then
    if s.distinct >= G.MAX_ITEMS then return end
    s.distinct = s.distinct + 1
    s.counts[itemId] = 0
  end
  s.counts[itemId] = s.counts[itemId] + count
end

local function addMoney(kind, copper)
  local s = running()
  if s and type(copper) == "number" and copper >= 1 and copper == math.floor(copper) then
    s.money[kind] = s.money[kind] + copper
  end
end

local function pause(s)
  s.elapsed = G.Elapsed(s)
  s.runningSince = nil
end

local function resume(s)
  s.runningSince = time()
  lastMoney = playerMoney()
end

--- Close the session into the saved history: items frozen with the value and source they had now.
local function finish()
  local db = data()
  local s = db.current
  if not s then return nil end
  local sum = G.Summary(s, db.cut)
  local items = {}
  for _, item in ipairs(sum.items) do
    items[#items + 1] = { itemId = item[1], count = item[2], unit = item[3], source = item[4] }
  end
  local saved = {
    v = 1, character = s.character, realm = s.realm, zone = s.zone, zones = s.zones,
    startedAt = s.startedAt, endedAt = date("!%Y-%m-%dT%H:%M:%SZ"), seconds = sum.seconds,
    money = s.money, items = items, itemValue = sum.itemValue, total = sum.total, perHour = sum.perHour,
    cut = db.cut and G.AH_CUT or 0,
  }
  db.sessions[#db.sessions + 1] = saved
  while #db.sessions > G.HISTORY do table.remove(db.sessions, 1) end
  db.current = nil
  return saved
end

local function clock(seconds)
  return string.format("%d:%02d:%02d", math.floor(seconds / 3600), math.floor(seconds % 3600 / 60), seconds % 60)
end

local SOURCE_LABEL = { market = "market", scan = "your scan", vendor = "vendor", none = "no price" }

--- What the window shows (and /everloot gph show prints without a window).
function G.Lines()
  local db = data()
  local s = db.current
  if not s then
    local last = db.sessions[#db.sessions]
    local lines = { "No session running. /everloot gph start begins one." }
    if last then
      lines[#lines + 1] = string.format("Last: %s in %s, %s/hour over %s.", E.Coins(last.total), last.zone or "?",
        E.Coins(last.perHour), clock(last.seconds))
    end
    return lines
  end
  local sum = G.Summary(s, db.cut)
  local lines = {
    string.format("%s  %s  %s", s.runningSince and "Running" or "Paused", clock(sum.seconds), zoneName() or s.zone or ""),
    string.format("Total %s  |  %s / hour", E.Coins(sum.total), E.Coins(sum.perHour)),
    string.format("Items %s (market %d, your scan %d, vendor %d, no price %d)", E.Coins(sum.itemValue),
      sum.sources.market, sum.sources.scan, sum.sources.vendor, sum.sources.none),
    string.format("Money looted %s, quests %s", E.Coins(s.money.loot), E.Coins(s.money.quest)),
  }
  if s.money.vendor > 0 then
    lines[#lines + 1] = "Sold to vendors " .. E.Coins(s.money.vendor) .. " (already in the item values)"
  end
  for i = 1, math.min(G.TOP, #sum.items) do
    local item = sum.items[i]
    lines[#lines + 1] = string.format("  %s x%d  %s  %s", itemName(item[1]), item[2], E.Coins(item[2] * item[3]), SOURCE_LABEL[item[4]])
  end
  lines[#lines + 1] = "Auction cut 5%: " .. (db.cut and "taken from market and scan values" or "off")
  return lines
end

local function refresh()
  if panel and panel:IsShown() then
    panel.body:SetText(table.concat(G.Lines(), "\n"))
    local s = current()
    panel.toggle:SetText((s and s.runningSince) and "Pause" or (s and "Resume" or "Start"))
  end
end

local function buildPanel()
  if panel then return panel end
  if not CreateFrame then return nil end
  local ok, frame = pcall(CreateFrame, "Frame", "EverlootGphFrame", UIParent, "BackdropTemplate")
  if not ok or not frame then ok, frame = pcall(CreateFrame, "Frame", "EverlootGphFrame", UIParent) end
  if not ok or not frame then return nil end
  local built = pcall(function()
    frame:SetSize(320, 230)
    frame:SetPoint("CENTER")
    frame:SetMovable(true)
    frame:EnableMouse(true)
    frame:SetClampedToScreen(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    if frame.SetBackdrop then
      frame:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background", edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
        tile = true, tileSize = 16, edgeSize = 16, insets = { left = 4, right = 4, top = 4, bottom = 4 } })
    end
    local title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    title:SetPoint("TOPLEFT", 14, -12)
    title:SetText("Everloot gold per hour")
    frame.body = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    frame.body:SetPoint("TOPLEFT", 14, -34)
    frame.body:SetWidth(292)
    frame.body:SetJustifyH("LEFT")
    frame.body:SetJustifyV("TOP")
    local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", -2, -2)
    local toggle = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
    toggle:SetSize(90, 22)
    toggle:SetPoint("BOTTOMLEFT", 14, 12)
    toggle:SetScript("OnClick", function()
      local s = current()
      E.GphCommand((s and s.runningSince) and "pause" or "start")
    end)
    frame.toggle = toggle
    local stop = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
    stop:SetSize(90, 22)
    stop:SetPoint("LEFT", toggle, "RIGHT", 6, 0)
    stop:SetText("Stop")
    stop:SetScript("OnClick", function() E.GphCommand("stop") end)
    -- Once a second while shown: the clock and gold per hour move even when nothing drops.
    local wait = 0
    frame:SetScript("OnUpdate", function(_, dt)
      wait = wait + (dt or 0)
      if wait >= 1 then wait = 0; refresh() end
    end)
  end)
  if not built then return nil end
  panel = frame
  return panel
end

local function show()
  local frame = buildPanel()
  if not frame then
    for _, line in ipairs(G.Lines()) do print(line) end
    return
  end
  frame:Show()
  refresh()
end

--- /everloot gph [start | pause | stop | reset | show | hide | cut on|off | history]
function E.GphCommand(arg)
  local word = (arg or ""):lower():gsub("^%s+", ""):gsub("%s+$", "")
  local db = data()
  local s = db.current
  if word == "" or word == "show" then return show() end
  if word == "hide" then if panel then panel:Hide() end return end
  if word == "start" or word == "resume" then
    if s and s.runningSince then say("gold per hour is already running.")
    elseif s then resume(s); say("gold per hour resumed.")
    else
      db.current = newSession()
      lastMoney = playerMoney()
      say("gold per hour started. /everloot gph pause, stop or reset.")
    end
    show()
  elseif word == "pause" then
    if s and s.runningSince then pause(s); say("gold per hour paused. /everloot gph start resumes.")
    else say("no running session to pause.") end
    refresh()
  elseif word == "stop" then
    local saved = finish()
    if saved then
      say(string.format("session saved: %s in %s, %s/hour over %s. Your sessions stay in this file; nothing is uploaded.",
        E.Coins(saved.total), saved.zone or "?", E.Coins(saved.perHour), clock(saved.seconds)))
    else say("no session to stop.") end
    refresh()
  elseif word == "reset" then
    db.current = nil
    say("session discarded, nothing saved.")
    refresh()
  elseif word == "cut on" or word == "cut off" then
    db.cut = (word == "cut on")
    say("auction cut " .. (db.cut and "on: 5% is taken from market and scan values." or "off."))
    refresh()
  elseif word == "history" then
    if #db.sessions == 0 then return say("no saved sessions yet.") end
    for i = #db.sessions, math.max(1, #db.sessions - 4), -1 do
      local h = db.sessions[i]
      print(string.format("  %s  %s  %s  %s/hour  %s", h.startedAt:sub(1, 10), h.zone or "?", clock(h.seconds), E.Coins(h.perHour), E.Coins(h.total)))
    end
  else
    say("gold per hour: /everloot gph start | pause | stop | reset | show | hide | cut on|off | history")
  end
end

local function onEvent(event, ...)
  if event == "PLAYER_LOGOUT" then
    -- A reload or logout pauses the clock; the session resumes when the player is back.
    local s = current()
    if s and s.runningSince then pause(s); s.resumeOnLogin = true end
    return
  end
  if event == "MERCHANT_SHOW" then merchantOpen = true; return end
  if event == "MERCHANT_CLOSED" then merchantOpen = false; return end
  if event == "LOOT_OPENED" then lootOpen = true; return end
  if event == "LOOT_CLOSED" then lootOpen = false; return end
  if event == "PLAYER_MONEY" then
    local copper = playerMoney()
    if copper and lastMoney then
      local delta = copper - lastMoney
      if delta > 0 and merchantOpen then addMoney("vendor", delta)
      elseif delta > 0 and lootOpen and not moneyFromChat() then addMoney("loot", delta) end
    end
    lastMoney = copper
    return
  end
  local s = running()
  if not s then return end
  local text = E.Readable((...))
  if event == "CHAT_MSG_LOOT" and type(text) == "string" then
    local id, count = ownLoot(text)
    if id then addItem(id, count) end
  elseif event == "CHAT_MSG_MONEY" and type(text) == "string" and moneyFromChat() then
    addMoney("loot", copperIn(text))
  elseif event == "QUEST_TURNED_IN" then
    -- questID, xpReward, moneyReward
    local _, _, reward = ...
    addMoney("quest", reward)
  elseif event == "ZONE_CHANGED_NEW_AREA" then
    addZone(s)
  end
end

E:RegisterModule("gph", function()
  local s = current()
  if s then
    if s.resumeOnLogin then
      s.resumeOnLogin = nil
      s.runningSince = time()
    elseif s.runningSince then
      -- The game closed without a logout: the time since is unknown, so the session waits, paused.
      s.runningSince = nil
      say("your gold per hour session was paused when the game closed. /everloot gph start resumes it.")
    end
  end
  lastMoney = playerMoney()
  if not E.gphHooked then
    local f = E.frame
    for _, name in ipairs({ "CHAT_MSG_LOOT", "CHAT_MSG_MONEY", "QUEST_TURNED_IN", "PLAYER_MONEY", "MERCHANT_SHOW", "MERCHANT_CLOSED",
      "LOOT_OPENED", "LOOT_CLOSED", "ZONE_CHANGED_NEW_AREA", "PLAYER_LOGOUT" }) do
      pcall(f.RegisterEvent, f, name)
    end
    f:HookScript("OnEvent", function(_, event, ...)
      local ok, err = pcall(onEvent, event, ...)
      if not ok then E:SetNote("gph", "error: " .. tostring(err)) end
    end)
    E.gphHooked = true
  end
  return "ready (gold per hour: /everloot gph start; sessions stay in this file)"
end)
