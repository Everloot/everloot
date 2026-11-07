-- The gold ledger's local store: money events, auction sales and each character's daily closing gold, kept in
-- EverlootDB.ledger for the window's Gold tab. Local only: it is not a record, nothing here goes through E:Store,
-- EverlootDB.records is never written, and the upload never reads this table. The money_event records gold.lua
-- writes for the upload stay exactly as they are.
--
-- Rows are keyed by the opaque character key (core.lua, E.CharacterKey), never a name. Times are time() seconds;
-- days are UTC. The window is bounded: 5,000 events and 90 days, 2,000 sales, 400 daily closes per character.
-- Categories and directions are the web's (kb/src/gold-ledger.ts), in the same order, plus the slice-two names.
-- This file registers no events: gold.lua calls Record, RecordSale and Close, and the views call the queries.

local E = Everloot
local L = {}
E.Ledger = L

local DAY = 86400
local MAX_EVENTS = 5000
local MAX_AGE = 90 * DAY
local MAX_SALES = 2000
local MAX_CLOSES = 400
local MAX_ITEM_NAME = 80

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

--- Appends a money event for this character. Refuses an unknown category, copper that is not a whole number of
--- at least 1, or an item name or count that does not fit; other fields in `extra` are not kept.
function L.Record(key, category, copper, extra)
  if not validKey(key) or not direction[category] or not whole(copper, 1) then return false end
  if extra ~= nil and type(extra) ~= "table" then return false end
  extra = extra or {}
  if extra.itemName ~= nil and not validName(extra.itemName) then return false end
  if extra.count ~= nil and not whole(extra.count, 1) then return false end
  local events = store().events
  local now = time()
  events[#events + 1] = { at = now, key = key, category = category, copper = copper, itemName = extra.itemName, count = extra.count }
  local drop = math.max(0, #events - MAX_EVENTS)
  while events[drop + 1] and events[drop + 1].at < now - MAX_AGE do drop = drop + 1 end
  dropOldest(events, drop)
  return true
end

--- Appends one auction sale: item, count, total after the house cut, the deposit returned and the cut.
function L.RecordSale(key, sale)
  if not validKey(key) or type(sale) ~= "table" then return false end
  if not validName(sale.itemName) or not whole(sale.count, 1) or not whole(sale.total, 1) then return false end
  if sale.deposit ~= nil and not whole(sale.deposit, 0) then return false end
  if sale.cut ~= nil and not whole(sale.cut, 0) then return false end
  local sales = store().sales
  sales[#sales + 1] = {
    at = time(), key = key, itemName = sale.itemName, count = sale.count, unit = math.floor(sale.total / sale.count),
    total = sale.total, deposit = sale.deposit, cut = sale.cut, status = "paid",
  }
  dropOldest(sales, #sales - MAX_SALES)
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

--- One character's latest close on or before a UTC date, or nil.
local function closeOn(closes, ymd)
  local best
  for d in pairs(type(closes) == "table" and closes or {}) do
    if d <= ymd and (not best or d > best) then best = d end
  end
  return best and closes[best]
end

--- The keys' gold summed at a UTC date, or nil when no key has a close by then.
local function balanceOn(keys, ymd)
  local daily, total = store().daily, nil
  for _, k in ipairs(keys) do
    local copper = closeOn(daily[k], ymd)
    if copper then total = (total or 0) + copper end
  end
  return total
end

--- In and out for the keys between two times (both included): category totals, days with events, receipts for a
--- day, and the gold change the events do not explain (unrecorded), when there are closes at both ends.
function L.Summary(keys, fromTs, toTs)
  keys = type(keys) == "table" and keys or {}
  local wanted = keySet(keys)
  local totals, byDay, rows = {}, {}, {}
  local totalIn, totalOut = 0, 0
  for i, e in ipairs(store().events) do
    if wanted[e.key] and e.at >= fromTs and e.at <= toTs then
      local dir = L.Direction(e.category)
      local t = totals[e.category]
      if not t then t = { category = e.category, direction = dir, copper = 0, events = 0 }; totals[e.category] = t end
      t.copper = t.copper + e.copper
      t.events = t.events + 1
      local ymd = day(e.at)
      local d = byDay[ymd]
      if not d then d = { date = ymd, inCopper = 0, outCopper = 0, net = 0 }; byDay[ymd] = d end
      if dir == "in" then
        d.inCopper = d.inCopper + e.copper; totalIn = totalIn + e.copper
      else
        d.outCopper = d.outCopper + e.copper; totalOut = totalOut + e.copper
      end
      d.net = d.inCopper - d.outCopper
      rows[#rows + 1] = { i = i, e = e, ymd = ymd, direction = dir }
    end
  end

  local categories, days = {}, {}
  for _, t in pairs(totals) do categories[#categories + 1] = t end
  table.sort(categories, function(a, b)
    if a.copper ~= b.copper then return a.copper > b.copper end
    return a.category < b.category
  end)
  for _, d in pairs(byDay) do days[#days + 1] = d end
  table.sort(days, function(a, b) return a.date < b.date end)

  local unrecorded
  local opening, closing = balanceOn(keys, day(fromTs)), balanceOn(keys, day(toTs))
  if opening and closing then unrecorded = (closing - opening) - (totalIn - totalOut) end

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

  return { categories = categories, days = days, receipts = receipts, totalIn = totalIn, totalOut = totalOut, unrecorded = unrecorded }
end

--- The keys' auction sales between two times (both included), newest first.
function L.Sales(keys, fromTs, toTs)
  local wanted, list = keySet(keys), {}
  for i, s in ipairs(store().sales) do
    if wanted[s.key] and s.at >= fromTs and s.at <= toTs then list[#list + 1] = { i = i, s = s } end
  end
  table.sort(list, function(a, b)
    if a.s.at ~= b.s.at then return a.s.at > b.s.at end
    return a.i > b.i
  end)
  for n, r in ipairs(list) do list[n] = r.s end
  return list
end

--- The same sales grouped by item name: count sold, total, average unit price and number of sales, largest total first.
function L.SalesByItem(keys, fromTs, toTs)
  local groups, list = {}, {}
  for _, s in ipairs(L.Sales(keys, fromTs, toTs)) do
    local g = groups[s.itemName]
    if not g then g = { itemName = s.itemName, count = 0, total = 0, sales = 0 }; groups[s.itemName] = g; list[#list + 1] = g end
    g.count = g.count + s.count
    g.total = g.total + s.total
    g.sales = g.sales + 1
  end
  for _, g in ipairs(list) do g.unit = math.floor(g.total / g.count) end
  table.sort(list, function(a, b)
    if a.total ~= b.total then return a.total > b.total end
    return a.itemName < b.itemName
  end)
  return list
end

--- The keys' gold over the last `days` UTC days, oldest first, today last. A day before any close has no copper.
function L.Series(keys, days)
  keys = type(keys) == "table" and keys or {}
  local today = time()
  today = today - today % DAY
  local list = {}
  for i = days - 1, 0, -1 do
    local ymd = day(today - i * DAY)
    list[#list + 1] = { date = ymd, copper = balanceOn(keys, ymd) }
  end
  return list
end

--- The from and to times of a period: "today" (since UTC midnight), "7d", "30d" or "all".
function L.Period(name)
  local now = time()
  if name == "today" then return now - now % DAY, now end
  if name == "7d" then return now - 7 * DAY, now end
  if name == "30d" then return now - 30 * DAY, now end
  if name == "all" then return 0, now end
  return nil
end

E:RegisterModule("ledger", function()
  local s = store()
  return string.format("ready (%d events, %d sales, local only)", #s.events, #s.sales)
end, "gold")
