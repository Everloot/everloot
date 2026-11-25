-- Everloot auction collector. On in a new install; /everloot auctions off turns it off.
-- Forever (C_AuctionHouse): a full scan the player starts from the Everloot tab at the auction house
-- (modules/auctiontab.lua; an "Everloot scan" button if the tab cannot be added) or /everloot scan while
-- the auction house is open. Each scan records the player's faction and, when the auctioneer can be
-- read, which house it was (Alliance, Horde or a neutral goblin house). Clients with the older API: buyouts from the
-- list the player already opened. No external price feed. Nothing here posts, bids or buys.
-- Copper is per unit: a stack's buyout divided by its size. Bid-only listings have no price.

local E = Everloot

E.SCAN_CHUNK = 1000       -- replicate rows read per frame, so a large house does not stall the client
E.SCAN_COOLDOWN = 900     -- seconds between full scans: Retail's limit; Forever's is unverified
E.SCAN_PART_ITEMS = 1000  -- items per auction_snapshot record, the intake maximum
E.SCANS_KEPT = 3          -- full scans kept per realm in SavedVariables
E.SAMPLES_KEPT = 2        -- partial price samples kept per realm: the newest earlier one beside the one being taken
E.SCAN_WAIT_SECONDS = 30  -- how long a scan waits for REPLICATE_ITEM_LIST_UPDATE before giving up
local RETRY_SECONDS = 2   -- one more read for rows whose item data had not loaded
local FALLBACK_REQUESTS = 40  -- search requests the sample sends at most

local function say(msg)
  print("Everloot: " .. msg)
  return msg
end

-- Older clients: the 50 rows of the list the player opened.
local function scanList()
  if not (GetNumAuctionItems and GetAuctionItemLink and GetAuctionItemInfo) then
    return "auction API unavailable"
  end
  local realm = E.LiveRealm()
  if not realm then return "no realm" end
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

--- Unidentified markets stay in SavedVariables outside the upload records, scoped to this character and house.
local function saveLocalScan(s, partial)
  local items = {}
  for id, listings in pairs(s.byItem) do items[id] = { id, E.ScanSummary(listings) } end
  EverlootDB.localAuctionScans = EverlootDB.localAuctionScans or {}
  local houses = EverlootDB.localAuctionScans[s.character] or {}
  EverlootDB.localAuctionScans[s.character] = houses
  local house = s.house or "unknown"
  local scans = houses[house] or {}
  houses[house] = scans
  scans[partial and "sample" or "full"] = {
    at = s.startedAt, house = s.house, items = items, names = s.names, partial = partial,
  }
end

function E:LocalAuctionScan(house, forDisplay)
  local scans = EverlootDB and EverlootDB.localAuctionScans
  if not scans then return nil end
  local key = E.CharacterKey()
  local houses = key and scans[key]
  local saved = houses and (houses[house or "unknown"] or (forDisplay and houses.unknown))
  if not saved then return nil end
  if forDisplay and saved.sample and (not saved.full or saved.sample.at > saved.full.at) then return saved.sample end
  return saved.full
end

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

-- Blizzard's Forever SendSearchQuery docs explicitly prohibit querying the entire house.
-- This fallback samples at most 20 browse keys, 40 requests, three pages per query and 90 seconds.
-- Search results are partial auction_scan observations, never a full auction_snapshot: browse
-- minPrice/totalQuantity are not a listing distribution, and commodity rows can group sellers.
local function readable(value)
  if issecretvalue and issecretvalue(value) then return nil end
  return value
end

local function number(value)
  value = readable(value)
  if type(value) == "number" and value == value and value >= 0 and value < math.huge then return value end
end

local function itemKey(value)
  if type(readable(value)) ~= "table" then return nil end
  local key = {}
  for _, field in ipairs({ "itemID", "itemLevel", "itemSuffix", "battlePetSpeciesID" }) do
    key[field] = number(value[field])
    if not key[field] then return nil end
  end
  if key.itemID < 1 then return nil end
  return key
end

local function sameKey(a, b)
  b = itemKey(b)
  return b and a.itemID == b.itemID and a.itemLevel == b.itemLevel
    and a.itemSuffix == b.itemSuffix and a.battlePetSpeciesID == b.battlePetSpeciesID
end

local function finishFallback(s)
  if scan ~= s then return end
  scan = nil
  if s.stored == 0 then EverlootDB.lastScanAt = s.previousScanAt end
  if s.character and s.stored > 0 then
    saveLocalScan(s, true)
    return say(string.format("sampled %d search rows. This partial sample stays on this character.", s.stored))
  end
  say(string.format("partial price sample: stored %d search rows; this is not a full market scan. %s",
    s.stored, s.stored > 0 and "Upload with the Everloot Desktop App or at everloot.app/upload." or "The auction house sent no data with usable buyouts. Try again."))
end

local function nextFallbackItem(s)
  s.index = s.index + 1
  s.pages, s.awaiting, s.pending = 0, false, "search"
  if s.index > #s.keys then finishFallback(s) end
end

--- Just before a partial sample stores its first row (a sample that finds nothing prunes nothing): keep the newest E.SAMPLES_KEPT - 1 earlier samples of this realm
--- (a sample is the rows sharing one capturedAt), so up to 1,000 new rows fit under the per-kind cap. Without this,
--- two samples filled the cap and every later one reported "stored 0". Another realm's rows are not touched.
local function pruneSamples(realm)
  local rows = EverlootDB.records.auction_scan or {}
  local order, seen = {}, {}
  for _, r in ipairs(rows) do
    if r.realm == realm and not seen[r.capturedAt] then seen[r.capturedAt] = true; order[#order + 1] = r.capturedAt end
  end
  table.sort(order)
  local keep = E.SAMPLES_KEPT - 1
  if #order <= keep then return end
  local drop = {}
  for i = 1, #order - keep do drop[order[i]] = true end
  local kept = {}
  for _, r in ipairs(rows) do if r.realm ~= realm or not drop[r.capturedAt] then kept[#kept + 1] = r end end
  EverlootDB.records.auction_scan = kept
  if EverlootDB.paused then EverlootDB.paused.auction_scan = nil end
end

local function storeFallbackItem(s)
  local key = s.keys[s.index]
  local n = s.commodity and C_AuctionHouse.GetNumCommoditySearchResults(key.itemID) or C_AuctionHouse.GetNumItemSearchResults(key)
  n = number(n) or 0
  local seen = {}
  for i = 1, math.min(n, 200, 1000 - s.stored) do
    -- One malformed/secret row must not discard another item's observations.
    pcall(function()
      local row = s.commodity and C_AuctionHouse.GetCommoditySearchResultInfo(key.itemID, i) or C_AuctionHouse.GetItemSearchResultInfo(key, i)
      if type(readable(row)) ~= "table" then return end
      if s.commodity then
        if number(row.itemID) ~= key.itemID then return end
      elseif not sameKey(key, row.itemKey) then return end
      local count, id = number(row.quantity), number(row.auctionID)
      local price = number(s.commodity and row.unitPrice or row.buyoutAmount)
      if not count or count < 1 or count ~= math.floor(count) or not id or seen[id] or not price then return end
      price = math.floor(s.commodity and price or price / count)
      if price < 1 then return end
      seen[id] = true
      if s.character then
        local id = key.itemID
        local listings = s.byItem[id] or {}
        s.byItem[id] = listings
        listings[#listings + 1] = { price, count }
        s.stored = s.stored + 1
        return
      end
      if not s.pruned then s.pruned = true; pruneSamples(s.realm) end
      if E:Store("auction_scan", { installId = EverlootDB.installId, capturedAt = s.at,
        realm = s.realm, itemId = key.itemID, count = count, copper = price, priceBasis = "unit" }) then
        s.stored = s.stored + 1
      end
    end)
  end
end

local function fallbackResult(s, event, arg)
  if not s.awaiting then return end
  if s.phase == "browse" then
    if event == "AUCTION_HOUSE_BROWSE_FAILURE" then finishFallback(s); return end
    if event ~= "AUCTION_HOUSE_BROWSE_RESULTS_UPDATED" and event ~= "AUCTION_HOUSE_BROWSE_RESULTS_ADDED" then return end
    local results = C_AuctionHouse.GetBrowseResults()
    for i = 1, math.min(#results, 1000) do
      local key = itemKey(results[i].itemKey)
      if key then
        local identity = string.format("%d:%d:%d:%d", key.itemID, key.itemLevel, key.itemSuffix, key.battlePetSpeciesID)
        if not s.seen[identity] and #s.keys < 20 then
          s.seen[identity] = true; s.keys[#s.keys + 1] = key
        end
      end
    end
    s.awaiting = false
    if readable(C_AuctionHouse.HasFullBrowseResults()) == false and #s.keys < 20 and s.pages < 3 then
      s.pending = "moreBrowse"
    else
      s.phase, s.index = "search", 0
      nextFallbackItem(s)
    end
  else
    local key = s.keys[s.index]
    if s.commodity then
      if event ~= "COMMODITY_SEARCH_RESULTS_UPDATED" and event ~= "COMMODITY_SEARCH_RESULTS_ADDED" then return end
      if number(arg) ~= key.itemID then return end
    else
      if event ~= "ITEM_SEARCH_RESULTS_UPDATED" and event ~= "ITEM_SEARCH_RESULTS_ADDED" then return end
      if not sameKey(key, arg) then return end
    end
    s.awaiting = false
    local full
    if s.commodity then full = readable(C_AuctionHouse.HasFullCommoditySearchResults(key.itemID))
    else full = readable(C_AuctionHouse.HasFullItemSearchResults(key)) end
    if full == false and s.pages < 3 and s.requests < FALLBACK_REQUESTS then
      s.pending = "moreSearch"
    else
      storeFallbackItem(s)
      nextFallbackItem(s)
    end
  end
end

local function startFallback(s)
  s.waiting = false -- a late REPLICATE_ITEM_LIST_UPDATE cannot take over this scan
  if not (type(C_AuctionHouse.SendBrowseQuery) == "function" and type(C_AuctionHouse.GetBrowseResults) == "function"
    and type(C_AuctionHouse.HasFullBrowseResults) == "function" and type(C_AuctionHouse.RequestMoreBrowseResults) == "function"
    and type(C_AuctionHouse.SendSearchQuery) == "function" and type(C_AuctionHouse.GetItemKeyInfo) == "function"
    and type(C_AuctionHouse.IsThrottledMessageSystemReady) == "function" and type(C_AuctionHouse.GetNumItemSearchResults) == "function"
    and type(C_AuctionHouse.GetItemSearchResultInfo) == "function" and type(C_AuctionHouse.HasFullItemSearchResults) == "function"
    and type(C_AuctionHouse.RequestMoreItemSearchResults) == "function" and type(C_AuctionHouse.GetNumCommoditySearchResults) == "function"
    and type(C_AuctionHouse.GetCommoditySearchResultInfo) == "function" and type(C_AuctionHouse.HasFullCommoditySearchResults) == "function"
    and type(C_AuctionHouse.RequestMoreCommoditySearchResults) == "function") then
    refundWaitingScan()
    return say("the auction house sent no data; price search is unavailable. Try the scan again.")
  end
  s.fallback, s.stored, s.requests, s.keys, s.seen = true, 0, 0, {}, {}
  s.phase, s.pending, s.pages = "browse", "browse", 0
  local elapsed = 0
  local function poll()
    if scan ~= s then return end
    elapsed = math.max(elapsed + 1, time() - s.startedAt)
    if not E.auctionHouseOpen or not E:IsEnabled("auctions") or elapsed >= 90 or s.stored >= 1000 then
      finishFallback(s); return
    end
    local ok = pcall(function()
      if s.awaiting and elapsed - s.sentAt >= 10 then
        if s.phase == "browse" then finishFallback(s) else nextFallbackItem(s) end
      end
      if scan ~= s or not s.pending then return end
      if s.requests >= FALLBACK_REQUESTS then finishFallback(s); return end
      if readable(C_AuctionHouse.IsThrottledMessageSystemReady()) ~= true then return end
      local pending = s.pending
      s.pending, s.awaiting, s.sentAt = nil, true, elapsed
      s.requests, s.pages = s.requests + 1, s.pages + 1
      if pending == "browse" then C_AuctionHouse.SendBrowseQuery({ searchString = "", sorts = {} })
      elseif pending == "moreBrowse" then C_AuctionHouse.RequestMoreBrowseResults()
      else
        local key = s.keys[s.index]
        if pending == "search" then
          local info = C_AuctionHouse.GetItemKeyInfo(key)
          if type(readable(info)) ~= "table" or type(readable(info.isCommodity)) ~= "boolean" then
            nextFallbackItem(s); return
          end
          s.commodity = info.isCommodity
          C_AuctionHouse.SendSearchQuery(key, {}, false)
        else
          local full
          if s.commodity then full = C_AuctionHouse.RequestMoreCommoditySearchResults(key.itemID)
          else full = C_AuctionHouse.RequestMoreItemSearchResults(key) end
          -- These APIs return true when already complete, without needing another result event.
          if readable(full) == true then
            fallbackResult(s, s.commodity and "COMMODITY_SEARCH_RESULTS_UPDATED" or "ITEM_SEARCH_RESULTS_UPDATED",
              s.commodity and key.itemID or key)
          end
        end
      end
    end)
    if not ok and scan == s then
      if s.phase == "browse" then finishFallback(s) else nextFallbackItem(s) end
    end
    if scan == s then C_Timer.After(1, poll) end
  end
  C_Timer.After(1, poll)
  return say("full scan unavailable; sampling a limited set of search prices. Keep the auction house open.")
end

--- One replicate row into the scan: "ok", "skip" (no price, bad size) or "incomplete" (data not loaded).
local function readRow(i)
  local name, _, count, _, _, _, _, _, _, buyout, _, _, _, _, _, _, itemId, hasAllInfo = C_AuctionHouse.GetReplicateItemInfo(i)
  if type(itemId) ~= "number" or type(count) ~= "number" or type(buyout) ~= "number" then
    return hasAllInfo == false and "incomplete" or "skip"
  end
  -- The name the house gave with the row, for the tab's lookup by name: the client names only items it has loaded.
  name = readable(name)
  if type(name) == "string" and name ~= "" then scan.names[itemId] = name end
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
  -- Each house's latest scan stays, so the tooltip still has this player's own scan of every house they use.
  local latest = {}
  for _, last in pairs(EverlootDB.houseScans and EverlootDB.houseScans[realm] or {}) do latest[last.scanId] = true end
  local drop = {}
  for i = 1, #order - E.SCANS_KEPT do if not latest[order[i]] then drop[order[i]] = true end end
  local kept = {}
  for _, r in ipairs(rows) do if not drop[r.scanId] then kept[#kept + 1] = r end end
  EverlootDB.records.auction_snapshot = kept
end

local function finish()
  local s = scan
  scan = nil
  local ids = {}
  for id in pairs(s.byItem) do ids[#ids + 1] = id end
  if #ids == 0 then
    EverlootDB.lastScanAt = s.previousScanAt
    return say("the scan found no buyouts.")
  end
  if s.character then
    saveLocalScan(s)
    if E.RefreshNativeCrafting then pcall(E.RefreshNativeCrafting) end
    return say(string.format("scanned %d items. The game did not identify the realm, so this scan stays on this character.", #ids))
  end
  table.sort(ids)
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
      return say("the scan could not be stored. Upload your file with the Everloot Desktop App or at everloot.app/upload, then scan again.")
    end
  end
  -- Own scans are indexed by realm and house: each house is its own market. A scan whose auctioneer could not be read
  -- has no house and is found only through the realm's latest scan, labelled as such.
  if s.house then
    EverlootDB.houseScans = EverlootDB.houseScans or {}
    EverlootDB.houseScans[s.realm] = EverlootDB.houseScans[s.realm] or {}
    EverlootDB.houseScans[s.realm][s.house] = { scanId = scanId, at = s.startedAt }
  end
  pruneScans(s.realm)
  -- The names the rows carried, by realm, so the tab finds an item the client has not loaded by its name. Not a
  -- record: nothing uploads them, and a later scan adds to them.
  local names = EverlootDB.scanNames and EverlootDB.scanNames[s.realm] or {}
  for id, name in pairs(s.names) do names[id] = name end
  EverlootDB.scanNames = EverlootDB.scanNames or {}
  EverlootDB.scanNames[s.realm] = names
  EverlootDB.lastScans = EverlootDB.lastScans or {}
  EverlootDB.lastScans[s.realm] = { scanId = scanId, at = s.startedAt }
  E.ownScanCache = nil
  if E.RefreshNativeCrafting then pcall(E.RefreshNativeCrafting) end
  return say(string.format("scanned %d items on %s (%d rows skipped, %d not loaded). Upload with the Everloot Desktop App or at everloot.app/upload.",
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
    s.retryNext = from
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
  if not (C_AuctionHouse and C_Timer and C_Timer.After) then return say("full scans need the auction house API.") end
  if not E:IsEnabled("auctions") then return say("auction scans are off. /everloot auctions on, then /reload.") end
  if not E.auctionHouseOpen then return say("open the auction house first.") end
  if scan then return say("a scan is already running.") end
  local wait = (EverlootDB.lastScanAt or 0) + E.SCAN_COOLDOWN - time()
  if wait > 0 then return say(string.format("next full scan in %d min.", math.ceil(wait / 60))) end
  local realm = E.LiveRealm()
  local character = not realm and E.CharacterKey() or nil
  if not (realm or character) then return say("the game did not identify this character. Try again after entering the world.") end
  local started = {
    realm = realm, character = character, startedAt = time(), at = date("!%Y-%m-%dT%H:%M:%SZ"), waiting = true,
    faction = playerFaction(), house = E.auctionHouseKind,
    byItem = {}, names = {}, retry = {}, skipped = 0, incomplete = 0, next = 1, total = 0, retryNext = 1,
    previousScanAt = EverlootDB.lastScanAt,
  }
  scan = started
  EverlootDB.lastScanAt = time()
  if not C_AuctionHouse.ReplicateItems or not pcall(C_AuctionHouse.ReplicateItems) then
    return startFallback(started)
  end
  -- If replication never answers, try the bounded partial sample; no usable prices refunds cooldown.
  C_Timer.After(E.SCAN_WAIT_SECONDS, function()
    if scan == started and started.waiting then
      startFallback(started)
    end
  end)
  return say("scanning the auction house. Keep it open until the scan reports.")
end

--- True while a full scan is waiting for or reading the house.
function E:Scanning()
  return scan ~= nil
end

--- What the running scan is doing, for a progress bar: a line of words and how far along it is, 0 to 1; nothing
--- between scans. The house answers the replicate request in one piece, after a wait of its own, so the wait says
--- its seconds and the most the scan allows before it falls back to a sample, and fills toward them. The read and
--- the second read fill it by rows; the sample counts requests.
function E:ScanProgress()
  local s = scan
  if not s then return nil end
  if s.fallback then
    return string.format("Sampling search prices: %d of %d requests, %d items", s.requests, FALLBACK_REQUESTS, s.stored),
      math.min(1, s.requests / FALLBACK_REQUESTS)
  end
  if s.waiting then
    local seconds = math.max(0, time() - s.startedAt)
    return string.format("Waiting for the house's listings: %d s, up to %d s", seconds, E.SCAN_WAIT_SECONDS),
      math.min(1, seconds / E.SCAN_WAIT_SECONDS)
  end
  if s.total > 0 and s.next <= s.total then
    return string.format("Reading %d of %d listings", s.next - 1, s.total), (s.next - 1) / s.total
  end
  local again = #s.retry
  if again > 0 then
    return string.format("Reading again %d of %d listings whose items had not loaded", s.retryNext - 1, again), (s.retryNext - 1) / again
  end
  return "Finishing", 1
end

local function addButton()
  if E.scanButton then E.scanButton.refresh(); return end
  if not AuctionHouseFrame then return end
  if E.AuctionTab and E.AuctionTab.Attach(AuctionHouseFrame) then return end
  local button = CreateFrame("Button", "EverlootScanButton", AuctionHouseFrame, "UIPanelButtonTemplate")
  button:SetSize(120, 22)
  -- Keep the fallback below the window, away from the house's Search and Filter controls.
  button:SetPoint("TOPRIGHT", AuctionHouseFrame, "BOTTOMRIGHT", -12, -4)
  local function refresh()
    local label, enabled = E:ScanAction()
    button:SetText(label)
    button:SetEnabled(enabled)
  end
  button.refresh = refresh
  button:SetScript("OnClick", function() E:StartScan(); refresh() end)
  local elapsed = 0
  button:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + dt
    if elapsed >= 1 then elapsed = 0; refresh() end
  end)
  refresh()
  E.scanButton = button
end

--- True when a click could start a full scan now: enabled, the house open, nothing running, cooldown over.
function E:ScanReady()
  return E:IsEnabled("auctions") and E.auctionHouseOpen and not scan
    and (EverlootDB.lastScanAt or 0) + E.SCAN_COOLDOWN <= time()
end

--- One label and readiness for the tab and the fallback button; never starts a scan.
function E:ScanAction()
  if self:Scanning() then return "Scanning...", false end
  local wait = (EverlootDB.lastScanAt or 0) + self.SCAN_COOLDOWN - time()
  if wait > 0 then return string.format("Ready in %d:%02d", math.floor(wait / 60), wait % 60), false end
  return "Scan prices", self:ScanReady() and true or false
end

local function onFullScanEvent(event, arg1)
  if scan and not E:IsEnabled("auctions") then
    if scan.fallback then finishFallback(scan) elseif scan.waiting then refundWaitingScan() else scan = nil end
  end
  if event == "AUCTION_HOUSE_SHOW" then
    E.auctionHouseOpen = true
    E.auctionHouseKind = auctioneerHouse()
    addButton()
  elseif event == "AUCTION_HOUSE_CLOSED" then
    if E.AuctionTab then E.AuctionTab.Hide() end
    E.auctionHouseOpen = false
    E.auctionHouseKind = nil
    if scan then
      if scan.fallback then finishFallback(scan) elseif scan.waiting then refundWaitingScan() else scan = nil end
      say("scan stopped: the auction house closed.")
    end
  elseif event == "ADDON_LOADED" and arg1 == "Blizzard_AuctionHouseUI" then
    addButton()
  elseif scan and scan.fallback then
    local s = scan
    local ok = pcall(fallbackResult, s, event, arg1)
    if not ok and scan == s then
      if s.phase == "browse" then finishFallback(s) else nextFallbackItem(s) end
    end
  elseif event == "REPLICATE_ITEM_LIST_UPDATE" and scan and scan.waiting then
    local ok, total = pcall(C_AuctionHouse.GetNumReplicateItems)
    total = ok and number(total)
    if not total then startFallback(scan); return end
    scan.waiting = false
    scan.total = math.floor(total)
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
  if not EverlootDB or EverlootDB.scanPrompt == false then return end
  if EverlootDB.auctionNoticeShown or EverlootDB.auctionHintShown then return end
  if E:IsEnabled("auctions") then
    EverlootDB.auctionNoticeShown = true
    say("the Everloot tab (or scan button) at the bottom of the auction house scans this house's prices when you click Scan. "
      .. "It reads item prices and quantities, never sellers, and never posts, bids or buys. /everloot auctions off turns scans off.")
    return
  end
  EverlootDB.auctionHintShown = true
  say("you can share this auction house's prices with Everloot: /everloot auctions on, then /reload. "
    .. "A scan only runs when you click it. /everloot scanprompt off hides this introduction.")
end)

E:RegisterModule("auctions", function()
  local f = E.frame
  if C_AuctionHouse and (C_AuctionHouse.ReplicateItems or C_AuctionHouse.SendBrowseQuery) then
    if not E.fullScanHooked then
      for _, event in ipairs({ "AUCTION_HOUSE_SHOW", "AUCTION_HOUSE_CLOSED", "ADDON_LOADED", "REPLICATE_ITEM_LIST_UPDATE",
        "AUCTION_HOUSE_BROWSE_RESULTS_UPDATED", "AUCTION_HOUSE_BROWSE_RESULTS_ADDED", "AUCTION_HOUSE_BROWSE_FAILURE",
        "ITEM_SEARCH_RESULTS_UPDATED", "ITEM_SEARCH_RESULTS_ADDED", "COMMODITY_SEARCH_RESULTS_UPDATED",
        "COMMODITY_SEARCH_RESULTS_ADDED" }) do
        pcall(f.RegisterEvent, f, event)
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
