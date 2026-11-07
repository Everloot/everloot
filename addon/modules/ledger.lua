-- The gold ledger's local store: money events, auction sales and each character's daily closing gold, kept in
-- EverlootDB.ledger for the window's Gold tab. Local only: it is not a record, nothing here goes through E:Store,
-- EverlootDB.records is never written, and the upload never reads this table. The money_event records gold.lua
-- writes for the upload stay exactly as they are.
--
-- Rows are keyed by the opaque character key (core.lua, E.CharacterKey), never a name. Times are time() seconds;
-- days are UTC. The window is bounded: 5,000 events and 90 days, 2,000 sales, 400 daily closes per character.
-- Queries skip rows older than 90 days even before eviction has run; their period starts at a UTC midnight at most
-- 89 days before today's.
-- Categories and directions are the web's (kb/src/gold-ledger.ts), in the same order, plus the slice-two names.
-- For days before the store existed, Summary also reads the uploaded money_event records (read only, never copied
-- into the store), matched to a character key through the roster's name and realm.
-- This file registers no events: gold.lua calls Record, RecordSale and Close, and the views call the queries.

local E = Everloot
local L = {}
E.Ledger = L

local DAY = 86400
local MAX_EVENTS = 5000
local MAX_AGE = 90 * DAY
local MAX_SALES = 2000
local PENDING_SECONDS = 48 * 3600
local MAX_CLOSES = 400
local MAX_ITEM_NAME = 80
local SERIES_DAYS = 30

L.INCOME = { "loot", "quest", "vendor", "auction", "trade_in", "mail_in" }
L.SPENDING = { "flight", "postage", "barber", "respec", "auction_spend", "repair", "vendor_spend", "trade_out", "mail_out" }
L.LABELS = {
  loot = "Loot", quest = "Quest rewards", vendor = "Vendor sales", auction = "Auction sales",
  trade_in = "Trades in", mail_in = "Mail in",
  flight = "Flight paths", postage = "Postage", barber = "Barber", respec = "Respecs", auction_spend = "Auction purchases",
  repair = "Repairs", vendor_spend = "Vendor purchases", trade_out = "Trades out", mail_out = "Mail out",
}

local direction = {}
for _, c in ipairs(L.INCOME) do direction[c] = "in" end
for _, c in ipairs(L.SPENDING) do direction[c] = "out" end

--- "out" for a spending category, "in" for anything else, as the web's directionOf.
function L.Direction(category)
  return direction[category] == "out" and "out" or "in"
end

--- The store, created on first use; a file from before the ledger gets an empty one.
--- Without a saved file yet, an empty store that is not kept.
local function store()
  if type(EverlootDB) ~= "table" then return { events = {}, sales = {}, daily = {} } end
  local s = EverlootDB.ledger
  if type(s) ~= "table" then s = {}; EverlootDB.ledger = s end
  s.events = type(s.events) == "table" and s.events or {}
  s.sales = type(s.sales) == "table" and s.sales or {}
  s.daily = type(s.daily) == "table" and s.daily or {}
  return s
end

local function whole(value, least)
  return type(value) == "number" and value >= least and value == math.floor(value)
end

local function validKey(key)
  return type(key) == "string" and key ~= "" and #key <= 64
end

local function validName(name)
  return type(name) == "string" and name ~= "" and #name <= MAX_ITEM_NAME
end

local function day(ts)
  return date("!%Y-%m-%d", ts)
end

--- The oldest time a query still counts.
local function oldest()
  return time() - MAX_AGE
end

--- Today's UTC midnight.
local function midnight()
  local now = time()
  return now - now % DAY
end

--- The oldest time a query's period may start: a UTC midnight, so the first day is a whole day and its opening
--- close (the day before) matches the events counted.
local function oldestDay()
  return midnight() - (MAX_AGE - DAY)
end

local function keySet(keys)
  local set = {}
  for _, k in ipairs(type(keys) == "table" and keys or {}) do set[k] = true end
  return set
end

--- Drops the first `n` rows of a list in one pass.
local function dropOldest(list, n)
  if n <= 0 then return end
  local total = #list
  for i = 1, total - n do list[i] = list[i + n] end
  for i = total - n + 1, total do list[i] = nil end
end

--- Keeps the newest 5,000 events from the last 90 days and the newest 2,000 sales.
local function evict(s)
  local events, limit = s.events, oldest()
  local drop = math.max(0, #events - MAX_EVENTS)
  while events[drop + 1] and (type(events[drop + 1].at) ~= "number" or events[drop + 1].at < limit) do drop = drop + 1 end
  dropOldest(events, drop)
  dropOldest(s.sales, #s.sales - MAX_SALES)
end

--- Appends a money event for this character. Refuses an unknown category or copper that is not a whole number of
--- at least 1. An item name or count that does not fit is left off the row; `ownAlt` (gold moved to or from one of
--- the player's own characters) is kept only when true; other fields in `extra` are not kept.
function L.Record(key, category, copper, extra)
  if not validKey(key) or not direction[category] or not whole(copper, 1) then return false end
  extra = type(extra) == "table" and extra or {}
  local s = store()
  s.events[#s.events + 1] = {
    at = time(), key = key, category = category, copper = copper,
    itemName = validName(extra.itemName) and extra.itemName or nil,
    count = whole(extra.count, 1) and extra.count or nil,
    ownAlt = extra.ownAlt == true or nil,
  }
  evict(s)
  return true
end

--- Appends a sale the sold notice announced: the item is known, the gold is not until the letter is taken.
function L.RecordPending(key, itemName)
  if not validKey(key) or not validName(itemName) then return false end
  local s = store()
  s.sales[#s.sales + 1] = { at = time(), key = key, itemName = itemName, status = "pending" }
  evict(s)
  return true
end

--- The oldest pending sale of this item for this character, or nil. With `orUnmatched`, a row already marked
--- unmatched counts too: a letter taken after 48 hours still belongs to the sale it pays.
function L.MatchPending(key, itemName, orUnmatched)
  for _, row in ipairs(store().sales) do
    local open = row.status == "pending" or (orUnmatched and row.status == "unmatched")
    if open and row.key == key and row.itemName == itemName then return row end
  end
  return nil
end

--- Marks pending sales older than 48 hours as unmatched: the letter never came, or its item name did not match.
function L.ExpirePending(now)
  now = tonumber(now) or time()
  for _, row in ipairs(store().sales) do
    if row.status == "pending" and type(row.at) == "number" and row.at < now - PENDING_SECONDS then row.status = "unmatched" end
  end
end

--- Records one auction sale: item, count, total after the house cut, the deposit returned and the cut. A pending
--- or unmatched sale of the same item (the oldest) is filled in and marked paid; otherwise the sale is appended.
function L.RecordSale(key, sale)
  if not validKey(key) or type(sale) ~= "table" then return false end
  if not validName(sale.itemName) or not whole(sale.count, 1) or not whole(sale.total, 1) then return false end
  if sale.deposit ~= nil and not whole(sale.deposit, 0) then return false end
  if sale.cut ~= nil and not whole(sale.cut, 0) then return false end
  local s = store()
  L.ExpirePending(time())
  local row = L.MatchPending(key, sale.itemName, true)
  if not row then
    row = {}
    s.sales[#s.sales + 1] = row
  end
  row.at, row.key, row.itemName, row.count = time(), key, sale.itemName, sale.count
  row.unit, row.total, row.deposit, row.cut, row.status = math.floor(sale.total / sale.count), sale.total, sale.deposit, sale.cut, "paid"
  evict(s)
  return true
end

--- Sets this character's closing gold for today (UTC); the day's last call wins. Keeps the newest 400 days.
function L.Close(key, copper)
  if not validKey(key) or not whole(copper, 0) then return false end
  local daily = store().daily
  local closes = daily[key]
  if type(closes) ~= "table" then closes = {}; daily[key] = closes end
  closes[day(time())] = copper
  local dates = {}
  for d in pairs(closes) do dates[#dates + 1] = d end
  if #dates > MAX_CLOSES then
    table.sort(dates, function(a, b) return a > b end)
    for i = MAX_CLOSES + 1, #dates do closes[dates[i]] = nil end
  end
  return true
end

--- One character's latest close on or before a UTC date (and, when given, not before `since`), or nil.
local function closeOn(closes, ymd, since)
  local best
  for d in pairs(type(closes) == "table" and closes or {}) do
    if d <= ymd and (not since or d >= since) and (not best or d > best) then best = d end
  end
  return best and closes[best]
end

--- "YYYY-MM-DDTHH:MM:SS..." (UTC) as time() seconds, or nil. Lua 5.1 has no UTC parser, so the day count is
--- worked out from the civil date.
local function isoTime(text)
  if type(text) ~= "string" then return nil end
  local y, m, d, hh, mm, ss = text:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)")
  if not y then return nil end
  y, m, d = tonumber(y), tonumber(m), tonumber(d)
  if m < 1 or m > 12 or d < 1 or d > 31 then return nil end
  if m <= 2 then y = y - 1 end
  local era = math.floor(y / 400)
  local yoe = y - era * 400
  local doy = math.floor((153 * (m > 2 and m - 3 or m + 9) + 2) / 5) + d - 1
  local days = era * 146097 + yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy - 719468
  return days * DAY + tonumber(hh) * 3600 + tonumber(mm) * 60 + tonumber(ss)
end

--- The uploaded money_event records for the wanted keys from before the store's oldest event, as ledger rows.
--- Read only: a row whose character and realm are not in the roster, or that does not read cleanly, is skipped.
local function recordRows(wanted, events)
  local uploaded = type(EverlootDB) == "table" and type(EverlootDB.records) == "table" and EverlootDB.records.money_event
  if type(uploaded) ~= "table" or not (E.Roster and E.Roster.Rows) then return {} end
  local before
  for _, e in ipairs(events) do
    if type(e.at) == "number" and (not before or e.at < before) then before = e.at end
  end
  local keyOf = {}
  for _, r in ipairs(E.Roster.Rows()) do
    if wanted[r.key] and type(r.name) == "string" and type(r.realm) == "string" then keyOf[r.name .. "\0" .. r.realm] = r.key end
  end
  local rows = {}
  for _, r in ipairs(uploaded) do
    local key = type(r) == "table" and type(r.character) == "string" and type(r.realm) == "string" and keyOf[r.character .. "\0" .. r.realm]
    local at = key and isoTime(r.capturedAt)
    if at and (not before or at < before) and direction[r.category] and whole(r.copper, 1) then
      rows[#rows + 1] = { at = at, key = key, category = r.category, copper = r.copper }
    end
  end
  return rows
end

--- In and out for the keys between two times (both included; nil means all): category totals, days with events,
--- receipts for a day, and the gold change the events do not explain (unrecorded). Unrecorded is the change from the
--- close before the first day to the close on the last, and only when every key has both; otherwise nil.
--- Moved is the copper of the outgoing rows marked ownAlt (each transfer once). With more than one key those rows leave the totals,
--- categories and days (the gold stayed in the account) and are still receipts; one key keeps them in its totals.
function L.Summary(keys, fromTs, toTs)
  keys = type(keys) == "table" and keys or {}
  local wanted = keySet(keys)
  fromTs = math.max(tonumber(fromTs) or 0, oldestDay())
  toTs = tonumber(toTs) or time()
  local totals, byDay, rows = {}, {}, {}
  local totalIn, totalOut, moved = 0, 0, 0
  local netted = #keys > 1
  local events = store().events

  local function count(i, e)
    if not (wanted[e.key] and type(e.at) == "number" and e.at >= fromTs and e.at <= toTs) then return end
    local dir = L.Direction(e.category)
    local ymd = day(e.at)
    rows[#rows + 1] = { i = i, e = e, ymd = ymd, direction = dir }
    -- The day is listed even when only transfers fall on it, so its receipts can be picked.
    local d = byDay[ymd]
    if not d then d = { date = ymd, inCopper = 0, outCopper = 0, net = 0 }; byDay[ymd] = d end
    if e.ownAlt == true then
      -- One transfer has an out row and an in row; only the out side counts, so it is not counted twice.
      if dir == "out" then moved = moved + e.copper end
      if netted then return end
    end
    local t = totals[e.category]
    if not t then t = { category = e.category, direction = dir, copper = 0, events = 0 }; totals[e.category] = t end
    t.copper = t.copper + e.copper
    t.events = t.events + 1
    if dir == "in" then
      d.inCopper = d.inCopper + e.copper; totalIn = totalIn + e.copper
    else
      d.outCopper = d.outCopper + e.copper; totalOut = totalOut + e.copper
    end
    d.net = d.inCopper - d.outCopper
  end
  -- Older uploaded rows sort before every store row with the same time.
  for _, e in ipairs(recordRows(wanted, events)) do count(0, e) end
  for i, e in ipairs(events) do count(i, e) end

  local categories, days = {}, {}
  for _, t in pairs(totals) do categories[#categories + 1] = t end
  table.sort(categories, function(a, b)
    if a.copper ~= b.copper then return a.copper > b.copper end
    return a.category < b.category
  end)
  for _, d in pairs(byDay) do days[#days + 1] = d end
  table.sort(days, function(a, b) return a.date < b.date end)

  local unrecorded
  if #keys > 0 then
    local daily, opening, closing = store().daily, 0, 0
    local openDay, closeDay = day(fromTs - fromTs % DAY - DAY), day(toTs)
    for _, k in ipairs(keys) do
      local a, b = closeOn(daily[k], openDay), closeOn(daily[k], closeDay)
      if not (a and b) then opening = nil; break end
      opening, closing = opening + a, closing + b
    end
    if opening then unrecorded = (closing - opening) - (totalIn - totalOut) end
  end

  local function receipts(ymd)
    local list = {}
    for _, r in ipairs(rows) do
      if r.ymd == ymd then list[#list + 1] = r end
    end
    table.sort(list, function(a, b)
      if a.e.at ~= b.e.at then return a.e.at > b.e.at end
      return a.i > b.i
    end)
    for n, r in ipairs(list) do
      local e = r.e
      list[n] = { at = e.at, key = e.key, category = e.category, direction = r.direction, copper = e.copper, itemName = e.itemName, count = e.count }
    end
    return list
  end

  return { categories = categories, days = days, receipts = receipts, totalIn = totalIn, totalOut = totalOut, unrecorded = unrecorded, moved = moved }
end

--- The keys' auction sales between two times (both included; nil means all), newest first.
function L.Sales(keys, fromTs, toTs)
  L.ExpirePending(time())
  fromTs = math.max(tonumber(fromTs) or 0, oldestDay())
  toTs = tonumber(toTs) or time()
  local wanted, list = keySet(keys), {}
  for i, s in ipairs(store().sales) do
    if wanted[s.key] and type(s.at) == "number" and s.at >= fromTs and s.at <= toTs then list[#list + 1] = { i = i, s = s } end
  end
  table.sort(list, function(a, b)
    if a.s.at ~= b.s.at then return a.s.at > b.s.at end
    return a.i > b.i
  end)
  for n, r in ipairs(list) do list[n] = r.s end
  return list
end

--- The same paid sales grouped by item name: count sold, total, average unit price and number of sales, largest total first.
function L.SalesByItem(keys, fromTs, toTs)
  local groups, list = {}, {}
  for _, s in ipairs(L.Sales(keys, fromTs, toTs)) do
    if s.status == "paid" then
      local g = groups[s.itemName]
      if not g then g = { itemName = s.itemName, count = 0, total = 0, sales = 0 }; groups[s.itemName] = g; list[#list + 1] = g end
      g.count = g.count + s.count
      g.total = g.total + s.total
      g.sales = g.sales + 1
    end
  end
  for _, g in ipairs(list) do g.unit = math.floor(g.total / g.count) end
  table.sort(list, function(a, b)
    if a.total ~= b.total then return a.total > b.total end
    return a.itemName < b.itemName
  end)
  return list
end

--- The keys' gold over the last `days` UTC days (30 when not given), oldest first, today last: each key's latest
--- close from the last 90 days on or before the day, summed. A day before any close has no copper.
function L.Series(keys, days)
  keys = type(keys) == "table" and keys or {}
  days = whole(days, 1) and days or SERIES_DAYS
  local daily, since = store().daily, day(oldest())
  local today = time()
  today = today - today % DAY
  local list = {}
  for i = days - 1, 0, -1 do
    local ymd, total = day(today - i * DAY), nil
    for _, k in ipairs(keys) do
      local copper = closeOn(daily[k], ymd, since)
      if copper then total = (total or 0) + copper end
    end
    list[#list + 1] = { date = ymd, copper = total }
  end
  return list
end

--- The from and to times of a period: "today" (since UTC midnight), "7d" and "30d" (today and the 6 or 29 whole UTC
--- days before it), or "all"; anything else is "30d". Every period but "all" starts at a UTC midnight.
function L.Period(name)
  local now, today = time(), midnight()
  if name == "today" then return today, now end
  if name == "7d" then return today - 6 * DAY, now end
  if name == "all" then return 0, now end
  return today - 29 * DAY, now
end

E:RegisterModule("ledger", function()
  local s = store()
  evict(s)
  L.ExpirePending(time())
  return string.format("ready (%d events, %d sales, local only)", #s.events, #s.sales)
end, "gold")
