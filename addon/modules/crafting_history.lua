-- Everloot crafting history: this install's own completed full auction scans, kept per realm and house for the items
-- this character's proven recipes use or make, so the profession window can say how deep a material's listings are
-- and how today's price compares with the last week. Kept on this computer only: never a record, never uploaded,
-- never mixed with community, search-sample or partial-scan prices. auctions.lua is the only writer (its full-scan
-- completion path); search samples, character-only scans and other addons' data never reach it.
--
-- EverlootDB.craftingHistory = { version = 1, realms = { [realm] = { [house] = {
--   seq = n,       -- use counter: each observation and each quote takes the next number
--   day = d,       -- newest UTC day observed (days since 1970-01-01)
--   items = { [itemId] = {
--     used = seq,                 -- last use, for least-recently-used pruning
--     at = seconds,               -- the scan the ladder came from (its start time)
--     levels = "unit:qty unit:qty ...", cheapest first, at most LEVELS price levels; "" when that scan listed none
--     truncated = true?,          -- the scan had more price levels than were kept: depth beyond them is unknown
--     days = { [utcDay] = { at, value } }, -- the day's last completed scan: its cheapest-quarter value (ScanSummary)
--   } } } } } }
--
--   CraftingHistory.Interests(characterKey) -> { [itemId] = true }: inputs and outputs of the recipes that character proved.
--   CraftingHistory.Start(realm, house, at, byItem[, interests]) -> job | nil, why. byItem is a completed full
--     scan's { [itemId] = { { unitCopper, count }, ... } }. Starting cancels this house's unfinished job.
--   CraftingHistory.Step(job, items) -> done: reads up to `items` more items; the last step commits all of them at
--     once, so a job that is cancelled, errors or is left by a reload writes nothing.
--   CraftingHistory.Observe(realm, house, at, byItem[, interests]) -> true | nil, why: Start and every Step at once.
--   CraftingHistory.Quote(realm, house, itemId, quantity, now) -> { cost, bought, available, shortfall, covered,
--     truncated, beyond, at } | nil. Walks the newest scan's price levels cheapest first. cost is what the units
--     that were listed cost (never extrapolated; nil when none were). shortfall is the units missing, known only
--     when no levels were dropped; a truncated ladder short of the quantity says `beyond` instead.
--   CraftingHistory.Baseline(realm, house, itemId, today) -> median | nil, days: the median of the daily values of
--     the seven UTC days before today (today excluded), with at least three of them observed; an even count takes
--     the floor of the mean of the two middle values. today is seconds since the epoch or "YYYY-MM-DD".
--   CraftingHistory.Change(realm, house, itemId, today) -> { median, days, today, change, percent }.

local E = Everloot
local H = {}
E.CraftingHistory = H

H.DAYS = 14          -- UTC days kept, today included
H.ITEMS = 500        -- items kept per house, least recently used pruned first
H.LEVELS = 200       -- price levels kept per item, the cheapest
H.WINDOW = 7         -- prior UTC days a baseline reads
H.MIN_DAYS = 3       -- observed days a baseline needs
H.CHUNK = 10         -- items a scheduled step reads (auctions.lua runs one step a frame): about 7 ms at 200 levels

local function whole(n)
  return type(n) == "number" and n >= 1 and n <= 9007199254740991 and n == math.floor(n)
end

local function named(s) return type(s) == "string" and s ~= "" end

local function dayOf(at) return math.floor(at / 86400) end

local function dayFrom(today)
  if type(today) == "string" then return E.DayNumber and E.DayNumber(today) or nil end
  if type(today) == "number" and today == today and today >= 0 and today < math.huge then return dayOf(today) end
end

local function houseOf(realm, house, create)
  if not named(realm) or not named(house) or type(EverlootDB) ~= "table" then return nil end
  local root = EverlootDB.craftingHistory
  if type(root) ~= "table" or type(root.realms) ~= "table" then
    if not create then return nil end
    root = { version = 1, realms = {} }
    EverlootDB.craftingHistory = root
  end
  local houses = root.realms[realm]
  if type(houses) ~= "table" then
    if not create then return nil end
    houses = {}
    root.realms[realm] = houses
  end
  local h = houses[house]
  if type(h) ~= "table" or type(h.items) ~= "table" then
    if not create then return nil end
    h = { seq = 0, items = {} }
    houses[house] = h
  end
  if type(h.seq) ~= "number" then h.seq = 0 end
  return h
end

--- The items one character's proven recipes take and make. No key or no planner: nothing.
function H.Interests(characterKey)
  local out = {}
  local CP = E.CraftingPlan
  if not (CP and CP.Known) then return out end
  for _, r in pairs(CP.Known(characterKey)) do
    if whole(r.itemId) then out[r.itemId] = true end
    for _, g in ipairs(type(r.reagents) == "table" and r.reagents or {}) do
      if whole(g.itemId) then out[g.itemId] = true end
    end
  end
  return out
end

-- One item's listings as price levels and its day value; nil when no listing is a whole unit price and count.
local function build(listings)
  local valid, byUnit, units = {}, {}, {}
  for _, l in ipairs(listings) do
    if type(l) == "table" and whole(l[1]) and whole(l[2]) then
      valid[#valid + 1] = { l[1], l[2] }
      if not byUnit[l[1]] then byUnit[l[1]] = 0; units[#units + 1] = l[1] end
      byUnit[l[1]] = byUnit[l[1]] + l[2]
    end
  end
  if #valid == 0 then return nil end
  table.sort(units)
  local parts = {}
  for i = 1, math.min(#units, H.LEVELS) do parts[i] = units[i] .. ":" .. byUnit[units[i]] end
  -- The same cheapest-quarter value the upload summary carries, from every listing (not only the kept levels).
  local _, _, _, value = E.ScanSummary(valid)
  return { levels = table.concat(parts, " "), truncated = #units > H.LEVELS or nil, value = value }
end

local jobs = {} -- the unfinished job of each house

local function currentTime()
  -- Prefer the server clock so a misconfigured computer clock cannot advance the house's retention window.
  for _, clock in ipairs({ GetServerTime or false, time or false }) do
    if type(clock) == "function" then
      local ok, value = pcall(clock)
      value = ok and E.Readable(value)
      if whole(value) then return value end
    end
  end
end

-- The scan caller captures this same clock at scan start; public upload timestamps keep their existing clock.
H.Clock = currentTime

function H.Start(realm, house, at, byItem, interests)
  if not named(realm) or not named(house) then return nil, "no house" end
  if not whole(at) then return nil, "bad time" end
  local now = currentTime()
  if not now then return nil, "no clock" end
  if at > now + 120 then return nil, "future time" end
  if type(byItem) ~= "table" then return nil, "no scan" end
  if not E.ScanSummary then return nil, "no scan summary" end
  interests = interests or H.Interests(E.CharacterKey and E.CharacterKey() or nil)
  local ids = {}
  for id, yes in pairs(interests) do if yes == true and whole(id) then ids[#ids + 1] = id end end
  if #ids == 0 then return nil, "no recipes" end
  table.sort(ids)
  local key = realm .. "\0" .. house
  if jobs[key] then jobs[key].canceled = true end
  local job = { realm = realm, house = house, at = at, byItem = byItem, ids = ids, next = 1, staged = {}, key = key }
  jobs[key] = job
  return job
end

local function prune(h)
  local oldest = (h.day or 0) - H.DAYS + 1
  local order = {}
  for id, item in pairs(h.items) do
    if type(item) ~= "table" or not whole(id) then
      h.items[id] = nil
    else
      for d in pairs(type(item.days) == "table" and item.days or {}) do
        if type(d) ~= "number" or d < oldest then item.days[d] = nil end
      end
      order[#order + 1] = id
    end
  end
  if #order <= H.ITEMS then return end
  -- Least recently used first; the same use (one scan) by item ID, lowest first, so a reload prunes the same items.
  table.sort(order, function(a, b)
    local ua, ub = tonumber(h.items[a].used) or 0, tonumber(h.items[b].used) or 0
    if ua ~= ub then return ua < ub end
    return a < b
  end)
  for i = 1, #order - H.ITEMS do h.items[order[i]] = nil end
end

local function commit(job)
  local h = houseOf(job.realm, job.house, true)
  if not h then return end
  h.seq = h.seq + 1
  local day = dayOf(job.at)
  for _, id in ipairs(job.ids) do
    local s = job.staged[id]
    if s then
      local item = type(h.items[id]) == "table" and h.items[id] or {}
      if type(item.days) ~= "table" then item.days = {} end
      item.used = h.seq
      -- An older scan finishing late never replaces the depth of a newer one.
      if type(item.at) ~= "number" or job.at >= item.at then
        item.at, item.levels, item.truncated = job.at, s.levels or "", s.truncated
      end
      if s.value then
        local d = item.days[day]
        if type(d) ~= "table" or type(d[1]) ~= "number" or job.at >= d[1] then item.days[day] = { job.at, s.value } end
      end
      h.items[id] = item
    end
  end
  h.day = math.max(type(h.day) == "number" and h.day or day, day)
  prune(h)
  job.committed = true
end

function H.Step(job, count)
  if job.done then return true end
  if job.canceled then job.done = true; return true end
  local last = math.min(#job.ids, job.next + math.max(1, count or H.CHUNK) - 1)
  for i = job.next, last do
    local id = job.ids[i]
    local listings = job.byItem[id]
    if listings == nil then
      job.staged[id] = { levels = "" } -- the scan is complete: none listed
    elseif type(listings) == "table" then
      job.staged[id] = build(listings) -- nil (untouched) when no listing was usable
    end
  end
  job.next = last + 1
  if job.next > #job.ids then
    job.done = true
    if jobs[job.key] == job then jobs[job.key] = nil end
    commit(job)
  end
  return job.done == true
end

function H.Observe(realm, house, at, byItem, interests)
  local job, why = H.Start(realm, house, at, byItem, interests)
  if not job then return nil, why end
  H.Step(job, #job.ids)
  return job.committed or nil, job.committed and nil or "canceled"
end

function H.Quote(realm, house, itemId, quantity, now)
  local h = houseOf(realm, house)
  local item = h and whole(itemId) and h.items[itemId]
  if type(item) ~= "table" or not whole(item.at) or type(item.levels) ~= "string" or not whole(quantity) then return nil end
  local day = now ~= nil and dayFrom(now)
  if day and dayOf(item.at) < day - H.DAYS + 1 then return nil end
  h.seq = h.seq + 1
  item.used = h.seq
  local need, cost, available = quantity, 0, 0
  for u, q in item.levels:gmatch("(%d+):(%d+)") do
    u, q = tonumber(u), tonumber(q)
    available = available + q
    if need > 0 then
      local take = math.min(q, need)
      cost, need = cost + take * u, need - take
    end
  end
  local out = { at = item.at, available = available, bought = quantity - need, covered = need == 0,
    truncated = item.truncated == true }
  if out.bought > 0 then out.cost = cost end
  if need == 0 then out.shortfall = 0
  elseif out.truncated then out.beyond = need
  else out.shortfall = need end
  return out
end

local function median(values)
  table.sort(values)
  local n = #values
  if n % 2 == 1 then return values[(n + 1) / 2] end
  return math.floor((values[n / 2] + values[n / 2 + 1]) / 2)
end

function H.Baseline(realm, house, itemId, today)
  local h = houseOf(realm, house)
  local item = h and whole(itemId) and h.items[itemId]
  local day = dayFrom(today)
  if type(item) ~= "table" or type(item.days) ~= "table" or not day then return nil, 0 end
  local values = {}
  for d = day - H.WINDOW, day - 1 do
    local sample = item.days[d]
    if type(sample) == "table" and whole(sample[2]) then values[#values + 1] = sample[2] end
  end
  if #values < H.MIN_DAYS then return nil, #values end
  return median(values), #values
end

function H.Change(realm, house, itemId, today)
  local m, days = H.Baseline(realm, house, itemId, today)
  local out = { median = m, days = days }
  local h = houseOf(realm, house)
  local item = h and whole(itemId) and h.items[itemId]
  local day = dayFrom(today)
  local sample = day and type(item) == "table" and type(item.days) == "table" and item.days[day]
  if type(sample) == "table" and whole(sample[2]) then out.today = sample[2] end
  if m and out.today then
    out.change = out.today - m
    out.percent = out.change / m * 100
  end
  return out
end
