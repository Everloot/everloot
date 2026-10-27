-- Everloot auction collector. On in a new install; /everloot auctions off turns it off.
-- Forever (C_AuctionHouse): a full scan the player starts from the Everloot tab at the auction house
-- (modules/auctiontab.lua; an "Everloot scan" button if the tab cannot be added), the
-- "Scan prices for Everloot" prompt (shown once per visit when a scan can run) or /everloot scan while
-- the auction house is open. Each scan records the player's faction and, when the auctioneer can be
-- read, which house it was (Alliance, Horde or a neutral goblin house). Clients with the older API: buyouts from the
-- list the player already opened. No external price feed. Nothing here posts, bids or buys.
-- Copper is per unit: a stack's buyout divided by its size. Bid-only listings have no price.

local E = Everloot

E.SCAN_CHUNK = 1000       -- replicate rows read per frame, so a large house does not stall the client
E.SCAN_COOLDOWN = 900     -- seconds between full scans: Retail's limit; Forever's is unverified
E.SCAN_PART_ITEMS = 1000  -- items per auction_snapshot record, the intake maximum
E.SCANS_KEPT = 3          -- full scans kept per realm in SavedVariables
E.SCAN_WAIT_SECONDS = 30  -- how long a scan waits for REPLICATE_ITEM_LIST_UPDATE before giving up
local RETRY_SECONDS = 2   -- one more read for rows whose item data had not loaded

local function say(msg)
  print("Everloot: " .. msg)
  return msg
end

-- Older clients: the 50 rows of the list the player opened.
local function scanList()
  if not (GetNumAuctionItems and GetAuctionItemLink and GetAuctionItemInfo and GetRealmName) then
    return "auction API unavailable"
  end
  local realm = GetRealmName()
  if type(realm) ~= "string" or #realm < 2 then return "no realm" end
  local n = GetNumAuctionItems("list")
  if type(n) ~= "number" or n < 1 then return "empty list" end
  local stored = 0
  for i = 1, math.min(n, 50) do
    local link = GetAuctionItemLink("list", i)
    local itemId = link and tonumber(link:match("item:(%d+)"))
    local _, _, count, _, _, _, _, _, _, buyout = GetAuctionItemInfo("list", i)
    if itemId and type(count) == "number" and count >= 1 and type(buyout) == "number" and buyout > 0 then
      count = math.floor(count)
      E:Store("auction_scan", {
        installId = EverlootDB.installId,
        capturedAt = date("!%Y-%m-%dT%H:%M:%SZ"),
        realm = realm, itemId = itemId, count = count,
        copper = math.floor(buyout / count), priceBasis = "unit",
      })
      stored = stored + 1
    end
  end
  return "stored " .. stored
end

--- Scan value for one item: the unit-weighted mean price of the cheapest quarter of its units,
--- and never less than the whole cheapest listing. `listings` is { {unitCopper, count}, ... }.
--- Returns auctions, quantity, minUnit, marketUnit.
function E.ScanSummary(listings)
  table.sort(listings, function(a, b) return a[1] < b[1] end)
  local quantity = 0
  for _, l in ipairs(listings) do quantity = quantity + l[2] end
  local target = math.max(listings[1][2], math.ceil(quantity / 4))
  local units, spent = 0, 0
  for _, l in ipairs(listings) do
    if units >= target then break end
    local take = math.min(l[2], target - units)
    units, spent = units + take, spent + take * l[1]
  end
  return #listings, quantity, listings[1][1], math.floor(spent / units + 0.5)
end

local scan -- the full scan in progress, or nil

--- The scanning character's faction, "Alliance" or "Horde"; nil when the client does not say.
local function playerFaction()
  if not UnitFactionGroup then return nil end
  local ok, group = pcall(UnitFactionGroup, "player")
  if ok and (group == "Alliance" or group == "Horde") then return group end
  return nil
end

--- The house the open auctioneer serves: a faction house's auctioneer carries that faction, a goblin
--- (neutral) house's carries none. Nil when the client gives no auctioneer unit.
local function auctioneerHouse()
  if not (UnitExists and UnitFactionGroup) then return nil end
  local okExists, exists = pcall(UnitExists, "npc")
  if not okExists or not exists then return nil end
  local ok, group = pcall(UnitFactionGroup, "npc")
  if not ok then return nil end
  if group == "Alliance" or group == "Horde" then return group end
  return "Neutral"
end

--- Clears a scan that never got its data and gives the cooldown back.
local function refundWaitingScan()
  EverlootDB.lastScanAt = scan.previousScanAt
  scan = nil
end

--- One replicate row into the scan: "ok", "skip" (no price, bad size) or "incomplete" (data not loaded).
local function readRow(i)
  local _, _, count, _, _, _, _, _, _, buyout, _, _, _, _, _, _, itemId, hasAllInfo = C_AuctionHouse.GetReplicateItemInfo(i)
  if type(itemId) ~= "number" or type(count) ~= "number" or type(buyout) ~= "number" then
    return hasAllInfo == false and "incomplete" or "skip"
  end
  if count < 1 or buyout <= 0 then return "skip" end
  count = math.floor(count)
  -- A buyout below its stack size is under 1 copper a unit: not a price.
  local unitPrice = math.floor(buyout / count)
  if unitPrice < 1 then return "skip" end
  local list = scan.byItem[itemId]
  if not list then list = {}; scan.byItem[itemId] = list end
  list[#list + 1] = { unitPrice, count }
  return "ok"
end

--- Keep the newest E.SCANS_KEPT scans of this realm; older parts leave SavedVariables.
local function pruneScans(realm)
  local rows = EverlootDB.records.auction_snapshot or {}
  local order, seen = {}, {}
  for _, r in ipairs(rows) do
    if r.realm == realm and not seen[r.scanId] then seen[r.scanId] = true; order[#order + 1] = r.scanId end
  end
  if #order <= E.SCANS_KEPT then return end
  local drop = {}
  for i = 1, #order - E.SCANS_KEPT do drop[order[i]] = true end
  local kept = {}
  for _, r in ipairs(rows) do if not drop[r.scanId] then kept[#kept + 1] = r end end
  EverlootDB.records.auction_snapshot = kept
end

local function finish()
  local s = scan
  scan = nil
  local ids = {}
  for id in pairs(s.byItem) do ids[#ids + 1] = id end
  table.sort(ids)
  if #ids == 0 then return say("the scan found no buyouts.") end
  local parts = math.ceil(#ids / E.SCAN_PART_ITEMS)
  local scanId = EverlootDB.installId .. "-" .. string.format("%.0f", s.startedAt)
  for p = 1, parts do
    local items = {}
    for k = (p - 1) * E.SCAN_PART_ITEMS + 1, math.min(#ids, p * E.SCAN_PART_ITEMS) do
      local auctions, quantity, minUnit, marketUnit = E.ScanSummary(s.byItem[ids[k]])
      items[#items + 1] = { ids[k], auctions, quantity, minUnit, marketUnit }
    end
    if not E:Store("auction_snapshot", {
      installId = EverlootDB.installId, capturedAt = s.at, realm = s.realm,
      faction = s.faction, house = s.house,
      scanId = scanId, part = p, parts = parts, items = items,
    }) then
      return say("the scan could not be stored. Upload your file with the companion, then scan again.")
    end
  end
  pruneScans(s.realm)
  EverlootDB.lastScans = EverlootDB.lastScans or {}
  EverlootDB.lastScans[s.realm] = { scanId = scanId, at = s.startedAt }
  E.ownScanCache = nil
  return say(string.format("scanned %d items on %s (%d rows skipped, %d not loaded). Upload with the companion.",
    #ids, s.realm, s.skipped, s.incomplete))
end

--- An unexpected row shape stops the scan with a message instead of a Lua error.
local function guarded(fn)
  return function()
    local ok, err = pcall(fn)
    if not ok then
      scan = nil
      say("the scan stopped on an unexpected row (" .. tostring(err) .. ").")
    end
  end
end

--- The second read of rows whose item data had not loaded, one chunk a frame like the first pass, so a large
--- house with slow item data does not read thousands of rows at once. `from` is the next index into the
--- retry list. A step belongs to the scan that scheduled it: if that scan stopped or another began, it reads nothing.
local function retryFrom(s, from)
  return guarded(function()
    if scan ~= s then return end
    local last = math.min(#s.retry, from + E.SCAN_CHUNK - 1)
    for k = from, last do
      if readRow(s.retry[k]) ~= "ok" then s.incomplete = s.incomplete + 1 end
    end
    if last < #s.retry then C_Timer.After(0, retryFrom(s, last + 1)) else finish() end
  end)
end

--- One chunk of the first pass. Like the retry, a step belongs to the scan that scheduled it: if that scan
--- stopped or another began, it reads and schedules nothing.
local function stepFrom(s)
  local step
  step = guarded(function()
    if scan ~= s then return end
    local last = math.min(s.total, s.next + E.SCAN_CHUNK - 1)
    for i = s.next, last do
      local result = readRow(i)
      if result == "incomplete" then s.retry[#s.retry + 1] = i
      elseif result == "skip" then s.skipped = s.skipped + 1 end
    end
    s.next = last + 1
    if s.next <= s.total then C_Timer.After(0, step)
    elseif #s.retry > 0 then C_Timer.After(RETRY_SECONDS, retryFrom(s, 1))
    else finish() end
  end)
  return step
end

function E:StartScan()
  if not (C_AuctionHouse and C_AuctionHouse.ReplicateItems and C_Timer) then return say("full scans need the auction house API.") end
  if not E:IsEnabled("auctions") then return say("auction scans are off. /everloot auctions on, then /reload.") end
  if not E.auctionHouseOpen then return say("open the auction house first.") end
  if scan then return say("a scan is already running.") end
  local wait = (EverlootDB.lastScanAt or 0) + E.SCAN_COOLDOWN - time()
  if wait > 0 then return say(string.format("next full scan in %d min.", math.ceil(wait / 60))) end
  local realm = GetRealmName and GetRealmName()
  if type(realm) ~= "string" or #realm < 2 then return say("no realm name.") end
  if E.scanPrompt then E.scanPrompt:Hide() end
  local started = {
    realm = realm, startedAt = time(), at = date("!%Y-%m-%dT%H:%M:%SZ"), waiting = true,
    faction = playerFaction(), house = E.auctionHouseKind,
    byItem = {}, retry = {}, skipped = 0, incomplete = 0, next = 1, total = 0,
    previousScanAt = EverlootDB.lastScanAt,
  }
  scan = started
  EverlootDB.lastScanAt = time()
  C_AuctionHouse.ReplicateItems()
  -- If the house never answers, the scan must not stay "running" and the cooldown is not spent.
  C_Timer.After(E.SCAN_WAIT_SECONDS, function()
    if scan == started and started.waiting then
      refundWaitingScan()
      say("the auction house sent no data. Try the scan again.")
    end
  end)
  return say("scanning the auction house. Keep it open until the scan reports.")
end

--- True while a full scan is waiting for or reading the house.
function E:Scanning()
  return scan ~= nil
end

local function addButton()
  if E.scanButton or not AuctionHouseFrame then return end
  if E.AuctionTab and E.AuctionTab.Attach(AuctionHouseFrame) then return end
  local button = CreateFrame("Button", "EverlootScanButton", AuctionHouseFrame, "UIPanelButtonTemplate")
  button:SetSize(120, 22)
  -- Placement still needs checking in the Forever client.
  button:SetPoint("TOPRIGHT", AuctionHouseFrame, "TOPRIGHT", -30, -28)
  button:SetText("Everloot scan")
  button:SetScript("OnClick", function() E:StartScan() end)
  E.scanButton = button
end

--- True when a click could start a full scan now: enabled, the house open, nothing running, cooldown over.
function E:ScanReady()
  return E:IsEnabled("auctions") and E.auctionHouseOpen and not scan
    and (EverlootDB.lastScanAt or 0) + E.SCAN_COOLDOWN <= time()
end

--- A small "Scan prices for Everloot" prompt beside the auction house, at most once per visit, only when
--- a scan can run. It never scans by itself: the scan starts from the player's click.
local function showPrompt()
  if EverlootDB.scanPrompt == false or E.promptShown or not AuctionHouseFrame or not E:ScanReady() then return end
  if not E.scanPrompt then
    local ok, frame = pcall(CreateFrame, "Frame", "EverlootScanPrompt", AuctionHouseFrame, "BackdropTemplate")
    if not ok or not frame then return end
    local built = pcall(function()
      frame:SetSize(230, 74)
      frame:SetPoint("TOPLEFT", AuctionHouseFrame, "TOPRIGHT", 4, 0)
      if frame.SetBackdrop then
        frame:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background", edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
          tile = true, tileSize = 16, edgeSize = 16, insets = { left = 4, right = 4, top = 4, bottom = 4 } })
      end
      local text = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
      text:SetPoint("TOPLEFT", 12, -10)
      text:SetWidth(190)
      text:SetJustifyH("LEFT")
      text:SetText("Share this house's prices with Everloot? One scan, every 15 min at most. /everloot scanprompt off hides this.")
      local button = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
      button:SetSize(180, 22)
      button:SetPoint("BOTTOMLEFT", 10, 8)
      button:SetText("Scan prices for Everloot")
      button:SetScript("OnClick", function() frame:Hide(); E:StartScan() end)
      frame.button = button
      local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
      close:SetPoint("TOPRIGHT", -2, -2)
      close:SetScript("OnClick", function() frame:Hide() end)
    end)
    if not built then return end
    E.scanPrompt = frame
  end
  E.promptShown = true
  E.scanPrompt:Show()
end

local function onFullScanEvent(event, arg1)
  if event == "AUCTION_HOUSE_SHOW" then
    E.auctionHouseOpen = true
    E.auctionHouseKind = auctioneerHouse()
    addButton()
    showPrompt()
  elseif event == "AUCTION_HOUSE_CLOSED" then
    if E.AuctionTab then E.AuctionTab.Hide() end
    E.auctionHouseOpen = false
    E.auctionHouseKind = nil
    E.promptShown = false
    if E.scanPrompt then E.scanPrompt:Hide() end
    if scan then
      if scan.waiting then refundWaitingScan() else scan = nil end
      say("scan stopped: the auction house closed.")
    end
  elseif event == "ADDON_LOADED" and arg1 == "Blizzard_AuctionHouseUI" then
    addButton()
    -- The house's window loads on the first visit, possibly after AUCTION_HOUSE_SHOW reached us.
    if E.auctionHouseOpen then showPrompt() end
  elseif event == "REPLICATE_ITEM_LIST_UPDATE" and scan and scan.waiting then
    scan.waiting = false
    scan.total = C_AuctionHouse.GetNumReplicateItems() or 0
    stepFrom(scan)()
  end
end

-- The first time the player opens an auction house, this listener says once per install what scans do:
-- with scans on, where the Everloot tab is and what a scan reads; with scans off, how to turn them on.
-- It reads nothing from the house.
local hint = CreateFrame("Frame")
E.auctionHintFrame = hint
pcall(hint.RegisterEvent, hint, "AUCTION_HOUSE_SHOW")
hint:SetScript("OnEvent", function()
  if not EverlootDB then return end
  if E:IsEnabled("auctions") then
    if EverlootDB.auctionNoticeShown then return end
    EverlootDB.auctionNoticeShown = true
    say("the Everloot tab at the bottom of the auction house scans this house's prices when you click Scan. "
      .. "It reads item prices and quantities, never sellers, and never posts, bids or buys. /everloot auctions off turns scans off.")
    return
  end
  if EverlootDB.auctionHintShown or EverlootDB.scanPrompt == false then return end
  EverlootDB.auctionHintShown = true
  say("you can share this auction house's prices with Everloot: /everloot auctions on, then /reload. "
    .. "A scan only runs when you click it. /everloot scanprompt off hides this.")
end)

E:RegisterModule("auctions", function()
  local f = E.frame
  if C_AuctionHouse and C_AuctionHouse.ReplicateItems then
    if not E.fullScanHooked then
      for _, event in ipairs({ "AUCTION_HOUSE_SHOW", "AUCTION_HOUSE_CLOSED", "ADDON_LOADED", "REPLICATE_ITEM_LIST_UPDATE" }) do
        f:RegisterEvent(event)
      end
      f:HookScript("OnEvent", function(_, event, arg1) onFullScanEvent(event, arg1) end)
      E.fullScanHooked = true
    end
    addButton()
    return "ready (full scan: the Everloot scan button or /everloot scan at the auction house)"
  end
  if not GetNumAuctionItems then error("auction API unavailable", 0) end
  f:RegisterEvent("AUCTION_ITEM_LIST_UPDATE")
  f:HookScript("OnEvent", function(_, event)
    if event == "AUCTION_ITEM_LIST_UPDATE" then pcall(scanList) end
  end)
  return "ready (buyouts from the list the player opened)"
end)
