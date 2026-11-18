-- Observed disenchant yields from the price file, and this character's bounded local history.
-- History never goes through Store: only openworld's existing loot records are uploaded.
local E = Everloot
local D = {}
E.Disenchant = D
local cached
local function whole(n, min) return type(n) == "number" and n >= min and n <= 9007199254740991 and n == math.floor(n) end

function D.Reset() cached = nil end

-- Only fields supplied by Forever's GetItemInfo, with secrets read as missing. Class is return 12.
function D.Item(id)
  local info = (C_Item and C_Item.GetItemInfo) or GetItemInfo
  if type(info) ~= "function" then return nil end
  local ok, name, link, quality, level, _, _, _, _, _, icon, sell, class = pcall(info, id)
  if not ok or type(E.Readable(link)) ~= "string" then return nil end
  return { name = E.Readable(name), quality = E.Readable(quality), level = E.Readable(level),
    icon = E.Readable(icon), sell = E.Readable(sell), class = E.Readable(class) }
end

function D.Band(id)
  if E.NO_DISENCHANT[id] then return nil end
  local item = D.Item(id)
  if not item or not whole(item.level, 1) then return nil end
  for _, b in ipairs(E.DISENCHANT_BANDS) do
    if item.class == b[2] and item.quality == b[3] and item.level >= b[4] and item.level <= b[5] then return b[1] end
  end
end

function D.Yields(band)
  if not cached then
    local db = type(EverlootPricesDB) == "table" and EverlootPricesDB.disenchant
    local entry = { status = "absent", bands = {} }
    cached = entry
    if type(db) == "table" then
      entry.status = "bad"
      if type(db.data) == "string" and type(db.sum) == "number" then
        entry.status, entry.asOf = "verifying", db.dataAsOf
        E.VerifyChecksum(db.data, db.sum, function(ok)
          if cached ~= entry then return end
          entry.status = ok and "ready" or "bad"
          if not ok then return end
          for row in db.data:gmatch("[^;]+") do
            local b, id, hit, n, milli, min, max = row:match("^(%d+),(%d+),(%d+),(%d+),(%d+),(%d+),(%d+)$")
            b, id, hit, n, milli, min, max = tonumber(b), tonumber(id), tonumber(hit), tonumber(n), tonumber(milli), tonumber(min), tonumber(max)
            if whole(b, 1) and whole(id, 1) and whole(hit, 1) and whole(n, 1) and hit <= n
              and whole(milli, 0) and whole(min, 1) and whole(max, min) and milli <= max * 1000 then
              local rows = entry.bands[b] or {}
              entry.bands[b] = rows
              if not rows[id] then
                rows[id] = true
                rows[#rows + 1] = { id = id, hit = hit, n = n, mean = milli / 1000, min = min, max = max }
              end
            end
          end
        end)
      end
    end
  end
  return cached.status == "ready" and cached.bands[band] or nil, cached
end

-- The current house only. A scan whose house was never recorded cannot price these estimates.
function D.Price(realm, id)
  local house = E:MarketHouse()
  if not house then return nil, false end
  local scan = E:OwnScan(realm, house)
  local own = scan and scan.house == house and scan.items[id]
  if own and whole(own[5], 0) then
    local age = time() - scan.at
    return own[5], age >= 0 and age <= E.STALE_DAYS * 86400, "your scan " .. date("!%Y-%m-%d", scan.at)
  end
  local row = E:CommunityPrice(realm, id, house)
  if not row or not whole(row.market, 0) then return nil, false end
  local today, seen = E.DayNumber(date("!%Y-%m-%d")), E.DayNumber(row.day)
  local file = E:PriceFile(realm, house)
  local built = E.DayNumber(file.asOf)
  return row.market, today and seen and built and today - seen >= 0 and today - seen <= E.STALE_DAYS
    and today - built >= 0 and today - built <= E.STALE_DAYS and row.quantity > E.THIN_UNITS,
    "community " .. row.day .. " (file " .. tostring(file.asOf or "unknown") .. ")"
end

function D.Value(realm, mats)
  local value, missing, fresh = 0, false, true
  for id, units in pairs(mats) do
    local price, current = D.Price(realm, id)
    if price == nil then missing = true else value = value + price * units end
    fresh = fresh and current
  end
  return math.floor(value), missing, fresh
end

function D.Label(id)
  local item = D.Item(id)
  local icon = item and item.icon or "Interface\\Icons\\INV_Misc_QuestionMark"
  local name = item and type(item.name) == "string" and item.name or ("Item " .. id)
  return "|T" .. icon .. ":14:14:0:0|t " .. name
end

function D.Lines(realm, id, compact)
  local band = D.Band(id)
  if not band then return {} end
  local out = {}
  local function add(text, left, right)
    out[#out + 1] = { text = text, left = left, right = right, r = 0.788, g = 0.765, b = 0.69, wrap = true }
  end
  local rows, file = D.Yields(band)
  -- No disenchant block in the file (no Desktop App, or an older one) or one still being checked: say nothing, so
  -- an armor or weapon tooltip is not one line longer for every player who never fetched the data.
  if file.status == "absent" or file.status == "verifying" then return out end
  if not rows or #rows == 0 then
    add(file.status == "bad" and "Disenchant: data failed its checksum" or "Disenchant: not enough data yet")
    return out
  end
  local mats = {}
  for _, r in ipairs(rows) do mats[r.id] = r.mean end
  local value, missing, fresh = D.Value(realm, mats)
  local amount = (missing and "at least " or "") .. E.PriceCoinIcons(value)
  add("Disenchant estimate (gross): " .. (missing and "at least " or "") .. E.Coins(value), "Disenchant estimate (gross)", amount)
  if not compact then
    local provenance = {}
    for _, r in ipairs(rows) do
      local label = D.Label(r.id)
      local quantity = r.min == r.max and tostring(r.min) or (r.min .. "-" .. r.max)
      local detail = string.format("%.1f%% · %s units", 100 * r.hit / r.n, quantity)
      add(label .. " · " .. detail, "  " .. label, detail)
      local _, _, source = D.Price(realm, r.id)
      if source then provenance[source] = true end
    end
    local sources = {}
    for source in pairs(provenance) do sources[#sources + 1] = source end
    table.sort(sources)
    if #sources > 0 then add("  Material prices: " .. table.concat(sources, "; ")) end
  end
  local auction, auctionFresh = D.Price(realm, id)
  local item = D.Item(id)
  local vendor = item and whole(item.sell, 0) and item.sell or nil
  if vendor and not compact then add("Vendor: " .. E.Coins(vendor), "Vendor", E.PriceCoinIcons(vendor)) end
  if auction then add("Auction estimate (gross): " .. E.Coins(auction), "Auction estimate (gross)", E.PriceCoinIcons(auction)) end
  local comparison = "Not enough data to compare"
  if not missing and fresh and auction and auctionFresh and vendor then
    if value > auction and value > vendor then comparison = "Disenchant estimate is higher"
    elseif auction > value and auction > vendor then comparison = "Auction estimate is higher"
    elseif vendor > value and vendor > auction then comparison = "Vendor value is higher"
    else comparison = "Estimates are tied" end
  end
  add(comparison)
  if not compact then
    add(string.format("  Observed: %d disenchants, at least 3 installs · %s", rows[1].n, file.asOf or "upload date unknown"))
    add("  " .. (E:MarketHouse() or "Unknown") .. " house · gross before fees; sale and skill not guaranteed")
    if not fresh and not missing then add("  Prices are stale, thin or their age is unknown") end
  end
  return out
end

local function history()
  local key = E.CharacterKey()
  if not key or type(EverlootDB) ~= "table" then return {} end
  EverlootDB.disenchantLog = EverlootDB.disenchantLog or {}
  local list = EverlootDB.disenchantLog[key] or {}
  EverlootDB.disenchantLog[key] = list
  return list
end

function D.Record(id, materials, source)
  if not whole(id, 1) then return end
  local list = history()
  -- Item GUIDs are local deduplication keys only, bounded with their entries.
  for _, row in ipairs(list) do if source and row.source == source then return end end
  local mats = {}
  for _, m in ipairs(materials) do
    if whole(m.itemId, 1) and whole(m.count, 1) then mats[m.itemId] = (mats[m.itemId] or 0) + m.count end
  end
  if not next(mats) then return end
  local row = { t = time(), item = id, mats = mats, source = source }
  local item = D.Item(id)
  local h = item and item.name and E.Ledger and E.Ledger.ItemHistory(GetRealmName(), item.name)
  if h then row.cost = h.averagePaid end
  list[#list + 1] = row
  while #list > 500 do table.remove(list, 1) end
end

function D.History() return history() end

function D.Summary(since)
  local out = { count = 0, mats = {}, cost = 0, known = 0 }
  for _, row in ipairs(history()) do
    if row.t >= since and row.t <= time() then
      out.count = out.count + 1
      for id, n in pairs(row.mats) do out.mats[id] = (out.mats[id] or 0) + n end
      if row.cost ~= nil then out.cost, out.known = out.cost + row.cost, out.known + 1 end
    end
  end
  out.value, out.missing = D.Value(GetRealmName(), out.mats)
  return out
end
