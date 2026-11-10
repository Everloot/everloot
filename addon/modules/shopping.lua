-- Shopping lists: named lists of items the player wants to buy, each with a wanted count and an optional most they
-- will pay per unit. Saved in this install's file only (EverlootDB.shopping), never uploaded, and capped so the file
-- stays small. The Everloot tab at the auction house (modules/auctiontab.lua) shows the active list and searches one
-- item per press; the Professions tab's what-to-buy list adds a recipe's reagents. Wanted counts are the player's own
-- numbers: bags and banks are not read.
--
-- A search is one browse query, the call the price scan's fallback already makes (C_AuctionHouse.SendBrowseQuery),
-- sent only from the player's press, only when the client says its throttled message system is ready, and never while
-- a price scan or an earlier search is waiting. Its first page of results gives the lowest buyout and how many are
-- listed. Nothing here posts, bids or buys.

local E = Everloot
local S = {}
E.Shopping = S

S.MAX_LISTS = 10        -- lists per install
S.MAX_ITEMS = 50        -- items per list
S.MAX_NAME = 24         -- characters in a list's name
S.MAX_WANT = 9999       -- the largest wanted count
S.MAX_COPPER = 99999999999 -- 9,999,999g 99s 99c: the largest max price
S.WAIT = 10             -- seconds a search waits for its results before the player may press again
S.DEFAULT_NAME = "Shopping"
S.CAPS = "Up to 10 lists of 50 items each, kept in this install's saved file only."

local found = {}   -- [itemId] = { min, quantity, at } or { none = true, at }: this session's searches, never saved
local pending      -- { itemId, name, at } while a search waits for its results
S.message = nil    -- what the last search said, for the panel

local function readable(v)
  if E.Readable then return E.Readable(v) end
  return v
end

local function clamp(n, lo, hi) return math.max(lo, math.min(hi, n)) end

local function cleanName(name)
  if type(name) ~= "string" then return nil end
  name = name:gsub("|", ""):gsub("^%s+", ""):gsub("%s+$", "")
  name = name:sub(1, S.MAX_NAME):gsub("%s+$", "")
  return name ~= "" and name or nil
end

-- One saved item, or nil when it cannot be one.
local function cleanItem(it)
  if type(it) ~= "table" or type(it.itemId) ~= "number" or it.itemId < 1 or it.itemId ~= math.floor(it.itemId) then return nil end
  local want = type(it.want) == "number" and clamp(math.floor(it.want), 1, S.MAX_WANT) or 1
  local max = type(it.max) == "number" and it.max >= 1 and math.min(math.floor(it.max), S.MAX_COPPER) or nil
  local name = type(it.name) == "string" and it.name ~= "" and it.name:sub(1, 64) or nil
  return { itemId = it.itemId, want = want, max = max, name = name }
end

--- The saved lists, checked once per session against the caps (a hand-edited file is trimmed, never trusted):
--- { lists = { { name, items = { { itemId, want, max, name } } } }, active }.
function S.DB()
  if type(EverlootDB) ~= "table" then return { lists = {}, active = 0 } end
  local db = EverlootDB.shopping
  if S.checked == db and type(db) == "table" then return db end
  db = type(db) == "table" and db or {}
  local lists = {}
  for _, l in ipairs(type(db.lists) == "table" and db.lists or {}) do
    local name = type(l) == "table" and cleanName(l.name)
    if name and #lists < S.MAX_LISTS then
      local items, seen = {}, {}
      for _, it in ipairs(type(l.items) == "table" and l.items or {}) do
        local item = cleanItem(it)
        if item and not seen[item.itemId] and #items < S.MAX_ITEMS then seen[item.itemId] = true; items[#items + 1] = item end
      end
      lists[#lists + 1] = { name = name, items = items }
    end
  end
  local active = type(db.active) == "number" and math.floor(db.active) or 1
  db = { lists = lists, active = #lists == 0 and 0 or clamp(active, 1, #lists) }
  EverlootDB.shopping = db
  S.checked = db
  return db
end

--- The active list, or nil when there is none.
function S.Active()
  local db = S.DB()
  return db.lists[db.active], db.active
end

--- Makes the list at `index` active (wrapping past either end).
function S.Select(index)
  local db = S.DB()
  if #db.lists == 0 then return false end
  db.active = (math.floor(index) - 1) % #db.lists + 1
  return true
end

--- A new list, made active. Returns the list, or nil and why not.
function S.Create(name)
  local db = S.DB()
  name = cleanName(name)
  if not name then return nil, "Type a name for the list." end
  if #db.lists >= S.MAX_LISTS then return nil, "You have " .. S.MAX_LISTS .. " lists, the most Everloot keeps: delete one first." end
  for _, l in ipairs(db.lists) do
    if l.name:lower() == name:lower() then return nil, "A list is already called " .. l.name .. "." end
  end
  db.lists[#db.lists + 1] = { name = name, items = {} }
  db.active = #db.lists
  return db.lists[#db.lists]
end

function S.Rename(name)
  local list = S.Active()
  name = cleanName(name)
  if not list then return false, "No list to rename." end
  if not name then return false, "Type the new name." end
  for _, l in ipairs(S.DB().lists) do
    if l ~= list and l.name:lower() == name:lower() then return false, "A list is already called " .. l.name .. "." end
  end
  list.name = name
  return true
end

--- Deletes the active list; the one before it becomes active.
function S.Delete()
  local db = S.DB()
  local list, index = S.Active()
  if not list then return false, "No list to delete." end
  table.remove(db.lists, index)
  db.active = #db.lists == 0 and 0 or clamp(index - 1, 1, #db.lists)
  return true, "Deleted " .. list.name .. "."
end

local function find(list, itemId)
  for i, it in ipairs(list.items) do if it.itemId == itemId then return it, i end end
end

-- The active list, made when there is none, so the first item added always has somewhere to go.
local function activeOrNew()
  local list = S.Active()
  if list then return list end
  return S.Create(S.DEFAULT_NAME)
end

--- Adds an item to the active list, or sets its wanted count and max price when it is already there. `max` is copper
--- per unit or nil for no limit. Returns the item, or nil and why not.
function S.Set(itemId, want, max, name)
  local list, why = activeOrNew()
  if not list then return nil, why end
  local item = cleanItem({ itemId = itemId, want = want, max = max, name = name })
  if not item then return nil, "Type an item's name or id, or shift-click an item." end
  local have = find(list, item.itemId)
  if have then
    have.want, have.max, have.name = item.want, item.max, item.name or have.name
    return have
  end
  if #list.items >= S.MAX_ITEMS then return nil, list.name .. " holds " .. S.MAX_ITEMS .. " items, the most a list keeps." end
  list.items[#list.items + 1] = item
  return item
end

function S.Remove(itemId)
  local list = S.Active()
  if not list then return false end
  local _, index = find(list, itemId)
  if not index then return false end
  table.remove(list.items, index)
  return true
end

--- Adds a recipe's reagents for `crafts` crafts to the active list (made when there is none): each part is
--- { id, item, count }, as the Professions tab's what-to-buy list has them. An item already on the list wants more;
--- its max price stays. A reagent without a known item id is skipped and counted. Returns added, skipped, full and the
--- sentence to show.
function S.AddReagents(parts, crafts)
  local list, why = activeOrNew()
  if not list then return 0, 0, false, why end
  crafts = math.max(1, math.floor(tonumber(crafts) or 1))
  local added, skipped, full = 0, 0, false
  for _, part in ipairs(type(parts) == "table" and parts or {}) do
    local count = type(part.count) == "number" and part.count * crafts or 0
    if type(part.id) ~= "number" or count < 1 then
      skipped = skipped + 1
    else
      local have = find(list, part.id)
      if have then
        have.want = math.min(S.MAX_WANT, have.want + count)
        added = added + 1
      elseif #list.items < S.MAX_ITEMS then
        list.items[#list.items + 1] = cleanItem({ itemId = part.id, want = count, name = part.item })
        added = added + 1
      else
        full = true
        skipped = skipped + 1
      end
    end
  end
  local said = "Added " .. added .. (added == 1 and " reagent" or " reagents") .. " to " .. list.name .. "."
  if full then said = said .. " The list is full (" .. S.MAX_ITEMS .. " items): some were not added." end
  if skipped > 0 and not full then
    said = said .. " " .. skipped .. " without a known item id " .. (skipped == 1 and "was" or "were") .. " not added."
  end
  return added, skipped, full, said
end

--- Copper from what the player typed: "1g 50s 3c", any of the three, or a plain number of gold ("2", "1.5").
--- Blank is no max (nil, true); anything else unreadable is nil, false.
function S.ParseMoney(text)
  if type(text) ~= "string" then return nil, true end
  text = text:lower():gsub("^%s+", ""):gsub("%s+$", "")
  if text == "" then return nil, true end
  local plain = tonumber(text)
  if plain then
    if plain <= 0 then return nil, false end
    return math.min(math.floor(plain * 10000 + 0.5), S.MAX_COPPER)
  end
  local total, rest = 0, text
  for amount, unit in text:gmatch("(%d+)%s*([gsc])") do
    total = total + tonumber(amount) * (unit == "g" and 10000 or unit == "s" and 100 or 1)
  end
  rest = rest:gsub("%d+%s*[gsc]", ""):gsub("[%s,]", "")
  if rest ~= "" or total < 1 then return nil, false end
  return math.min(total, S.MAX_COPPER)
end

--- An amount as the window writes a list cell (with coin icons), or as the site writes it without the window file.
function S.Money(copper)
  local W = E.Window
  if W and W.MoneyShort then return W.MoneyShort(copper) end
  return E.Coins(math.floor(copper))
end

local function realmName()
  local realm = readable(GetRealmName and GetRealmName())
  return type(realm) == "string" and #realm >= 2 and realm or nil
end

--- The price file's market value for one item ({ market, day }), or nil: no file, still being checked, failed, or no
--- market value recorded for the item.
function S.Market(itemId)
  local realm = realmName()
  local row = realm and E.CommunityPrice and E:CommunityPrice(realm, itemId)
  if row and row.market then return { market = row.market, day = row.day } end
end

local function plural(n, word) return n .. " " .. word .. (n == 1 and "" or "s") end

--- How old an item's market value is, from its newest public day: "today", "3 d". Older than E.STALE_DAYS is stale.
function S.Age(day)
  local today, then_ = E.DayNumber and E.DayNumber(date("!%Y-%m-%d")), E.DayNumber and E.DayNumber(day or "")
  if not today or not then_ then return "age unknown", true end
  local days = math.max(0, today - then_)
  return days == 0 and "today" or (days .. " d"), days > (E.STALE_DAYS or 2)
end

--- One line on where the market values come from and how old the file is, and whether to warn.
function S.FileLine()
  local realm = realmName()
  if type(EverlootPricesDB) ~= "table" or not realm or not E.PriceFile then
    return "Market: no price file in the game yet. The Everloot Desktop App writes it, then /reload.", false
  end
  local file = E:PriceFile(realm)
  if file.status == "verifying" then return "Market: checking the price file...", false end
  if file.status == "bad" then
    if file.silent then return "Market: the price file has no values for " .. realm .. " yet.", false end
    return "Market: the price file failed its checksum and is not used.", true
  end
  local where = type(file.house) == "string" and (file.house .. " auction house") or "all houses"
  local today, built = E.DayNumber(date("!%Y-%m-%d")), E.DayNumber(file.asOf or "")
  if not today or not built then return "Market: from the price file, " .. where .. "; when it was built is unknown.", true end
  local days = math.max(0, today - built)
  local age = days == 0 and "today" or (plural(days, "day") .. " ago")
  local stale = days > (E.STALE_DAYS or 2)
  return "Market: price file built " .. file.asOf:sub(1, 10) .. " (" .. age .. "), " .. where
    .. (stale and ". OLD FILE: the Everloot Desktop App refreshes it." or "; each value's age beside it."), stale
end

-- Searching ------------------------------------------------------------------------------------------------------

--- The item's name as the client has it, else the name the list saved, else nil.
function S.ItemName(itemId, saved)
  local info = (type(C_Item) == "table" and C_Item.GetItemInfo) or GetItemInfo
  if type(info) == "function" then
    local ok, name = pcall(info, itemId)
    name = ok and readable(name)
    if type(name) == "string" and name ~= "" then return name end
  end
  return type(saved) == "string" and saved ~= "" and saved or nil
end

-- The three calls a search needs, named one by one (gold_contract.py forbids indexing the namespace by a name).
local function canSearch()
  return type(C_AuctionHouse) == "table" and type(C_AuctionHouse.SendBrowseQuery) == "function"
    and type(C_AuctionHouse.GetBrowseResults) == "function" and type(C_AuctionHouse.IsThrottledMessageSystemReady) == "function"
end

local function say(text)
  S.message = text
  return text
end

--- This session's search result for one item: { min, quantity, at } or { none = true, at }, or nil.
function S.Found(itemId) return found[itemId] end

--- True while a search waits for its results.
function S.Pending() return pending ~= nil end

--- Searches the auction house for one item, from the player's press: at most one browse query, sent only when the
--- house is open, no price scan or earlier search is waiting and the client's throttle is ready. Returns true when it
--- sent the query, else false; S.message says which.
function S.Search(itemId, saved)
  if pending and time() - pending.at < S.WAIT then return false, say("Still waiting for the last search.") end
  pending = nil
  if not E.auctionHouseOpen then return false, say("Open the auction house first.") end
  if E.Scanning and E:Scanning() then return false, say("A price scan is running: search when it reports.") end
  if not canSearch() then
    return false, say("This client has no auction house search.")
  end
  local ok, ready = pcall(C_AuctionHouse.IsThrottledMessageSystemReady)
  if not ok or readable(ready) ~= true then
    return false, say("The auction house is still answering an earlier search: press Search again in a moment.")
  end
  local name = S.ItemName(itemId, saved)
  if not name then return false, say("The client has not loaded that item yet: press Search again in a moment.") end
  pending = { itemId = itemId, name = name, at = time() }
  if not pcall(C_AuctionHouse.SendBrowseQuery, { searchString = name, sorts = {} }) then
    pending = nil
    return false, say("The search could not be sent. Try again.")
  end
  return true, say("Searching for " .. name .. "...")
end

local function number(v)
  v = readable(v)
  if type(v) == "number" and v == v and v >= 0 and v < math.huge then return v end
end

-- The first page of browse results, for the item the search was for: its lowest buyout across every variant of the
-- item and how many are listed. Rows for other items that matched the name are ignored.
local function readResults()
  local s = pending
  pending = nil
  local ok, results = pcall(C_AuctionHouse.GetBrowseResults)
  results = ok and readable(results)
  local min, quantity = nil, 0
  for _, r in ipairs(type(results) == "table" and results or {}) do
    local key = type(readable(r)) == "table" and readable(r.itemKey)
    if type(key) == "table" and number(key.itemID) == s.itemId then
      local price, count = number(r.minPrice), number(r.totalQuantity)
      if price and price >= 1 and (not min or price < min) then min = price end
      if count then quantity = quantity + count end
    end
  end
  if min then
    found[s.itemId] = { min = min, quantity = quantity, at = time() }
    say(s.name .. ": lowest " .. E.Coins(min) .. " each, " .. quantity .. " listed.")
  else
    found[s.itemId] = { none = true, at = time() }
    local more = type(C_AuctionHouse.HasFullBrowseResults) == "function"
      and readable(select(2, pcall(C_AuctionHouse.HasFullBrowseResults))) == false
    say(s.name .. (more and ": not in the first page of results. The Buy tab shows them all." or ": none listed with a buyout."))
  end
end

--- Clears a search the house never answered, so the next press can send another. The panel calls it every second.
function S.Tick()
  if pending and time() - pending.at >= S.WAIT then
    say("No answer from the auction house for " .. pending.name .. ": press Search again.")
    pending = nil
    return true
  end
end

local function onEvent(_, event)
  if event == "AUCTION_HOUSE_CLOSED" then pending = nil; return end
  if not pending then return end
  if event == "AUCTION_HOUSE_BROWSE_FAILURE" then
    say("The auction house refused the search for " .. pending.name .. ": try again in a moment.")
    pending = nil
  elseif event == "AUCTION_HOUSE_BROWSE_RESULTS_UPDATED" then
    if not pcall(readResults) then pending = nil; say("The search results could not be read.") end
  else
    return
  end
  if S.OnChange then pcall(S.OnChange) end
end

S.frame = CreateFrame("Frame")
for _, event in ipairs({ "AUCTION_HOUSE_BROWSE_RESULTS_UPDATED", "AUCTION_HOUSE_BROWSE_FAILURE", "AUCTION_HOUSE_CLOSED" }) do
  pcall(S.frame.RegisterEvent, S.frame, event)
end
S.frame:SetScript("OnEvent", onEvent)
