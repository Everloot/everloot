-- Everloot prices in item tooltips: the player's own latest full scan, and community market values
-- the companion wrote into the EverlootPrices slot addon (checksummed; they show after /reload), with the
-- game's own vendor price beside them. The drop sources in the same file (modules/drops.lua) follow the
-- prices in the same tooltip, and the player's own sales and purchases of the item from the gold ledger (ledger.lua)
-- sit between them. Display only: nothing here talks to the network or acts on the auction house.

local E = Everloot

--- The auction house whose prices this character sees: the open auctioneer's (a goblin house is "Neutral"), else the
--- character's faction house. Each house is its own market. Nil when neither can be read: then no community price is
--- shown, never another house's.
function E:MarketHouse()
  if E.auctionHouseKind then return E.auctionHouseKind end
  if not UnitFactionGroup then return nil end
  local ok, group = pcall(UnitFactionGroup, "player")
  group = ok and E.Readable(group)
  if group == "Alliance" or group == "Horde" then return group end
  return nil
end

--- The player's latest full scan of one auction house on this realm (`house` defaults to E:MarketHouse()):
--- { at, house, items = { [itemId] = {id, auctions, quantity, min, value} } }. Scans are indexed by realm and house
--- (EverlootDB.houseScans). A scan stored before that, or one whose auctioneer could not be read, is found through
--- the realm's latest scan only when it is this house's or recorded no house; `house` is then nil, so the tooltip says
--- the house was not recorded. Another house's scan is never returned.
function E:OwnScan(realm, house)
  house = house or E:MarketHouse()
  local byHouse = EverlootDB.houseScans and EverlootDB.houseScans[realm]
  local last = (house and byHouse and byHouse[house]) or (EverlootDB.lastScans and EverlootDB.lastScans[realm])
  if not last then return nil end
  local cached = E.ownScanCache
  if not (cached and cached.scanId == last.scanId) then
    local items, scanHouse, found = {}, nil, false
    for _, row in ipairs(EverlootDB.records.auction_snapshot or {}) do
      if row.scanId == last.scanId then
        found = true
        scanHouse = scanHouse or row.house
        for _, item in ipairs(row.items) do items[item[1]] = item end
      end
    end
    if not found then return nil end
    cached = { scanId = last.scanId, at = last.at, house = scanHouse, items = items }
    E.ownScanCache = cached
  end
  if cached.house and cached.house ~= house then return nil end
  return cached
end

E.THIN_UNITS = 5          -- as kb/src/market.ts: this many units listed or fewer is a thin market
E.STALE_DAYS = 2          -- an item's newest public day or the price file older than this many days shows a stale marker
E.PRICE_FILE_ROWS = 2000  -- as kb/src/market.ts MAX_PRICE_ROWS: the most items one realm's price file holds
local VERIFY_SLICE = 20000 -- checksum characters per frame, so a large price file never stalls the client

--- Days since 1970-01-01 for a "YYYY-MM-DD..." string, or nil. Civil-date arithmetic, no os library.
function E.DayNumber(text)
  local y, m, d = tostring(text):match("^(%d%d%d%d)-(%d%d)-(%d%d)")
  if not y then return nil end
  y, m, d = tonumber(y), tonumber(m), tonumber(d)
  if m <= 2 then y = y - 1 end
  local era = math.floor(y / 400)
  local yoe = y - era * 400
  local doy = math.floor((153 * ((m + 9) % 12) + 2) / 5) + d - 1
  local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
end

-- Community prices per realm and house ("forever|horde"): { status = "verifying" | "ready" | "bad", data, asOf, house }.
local community = {}

function E:ResetPrices()
  community = {}
  if E.ResetDrops then E:ResetDrops() end
  if E.ResetSourceIndex then E.ResetSourceIndex() end
end

--- Adler-32 of `data` in slices of VERIFY_SLICE characters, one per frame; `done(ok)` gets the verdict.
--- Same arithmetic as E.Adler32 (the companion's checksum), split so it can pause between frames.
local function verify(data, sum, done)
  local a, b, i, n = 1, 0, 1, #data
  local function slice()
    local last = math.min(n, i + VERIFY_SLICE - 1)
    for k = i, last do
      a = (a + data:byte(k)) % 65521
      b = (b + a) % 65521
    end
    i = last + 1
    if i <= n and C_Timer and C_Timer.After then
      C_Timer.After(0, slice)
    elseif i <= n then
      return slice()
    else
      done(b * 65536 + a == sum)
    end
  end
  slice()
end

E.VerifyChecksum = verify

--- One house of one realm in EverlootPricesDB, keyed "realm|house" in lower case (`house` defaults to E:MarketHouse()):
--- "itemId,market,min,historical,quantity,day,reporters;..." with an Adler-32 `sum` over that string. A blank market is
--- unrecorded. The string is searched, not parsed: a tooltip finds its one row, so a large file costs nothing until its
--- checksum has passed. A block keyed by the realm alone comes from an older file whose values may mix both factions:
--- it is never read as this house's price (`legacy` says it is there), because a blended price can be far from what
--- this house charges and nothing in it says which house it came from. Without a house nothing is read (`noHouse`).
local function communityFor(realm, house)
  house = house or E:MarketHouse()
  if not house then return { status = "bad", silent = true, noHouse = true } end
  local key = realm:lower() .. "|" .. house:lower()
  local entry = community[key]
  if entry == nil then
    local realms = type(EverlootPricesDB) == "table" and EverlootPricesDB.realms
    local db = type(realms) == "table" and realms[key]
    local where = realm .. " (" .. house .. " auction house)"
    if type(db) ~= "table" then
      entry = { status = "bad", silent = true, legacy = type(realms) == "table" and type(realms[realm:lower()]) == "table" or nil }
    elseif type(db.data) ~= "string" or type(db.sum) ~= "number" then
      entry = { status = "bad" }
      print("Everloot: community prices for " .. where .. " failed their checksum and are not shown.")
    else
      entry = { status = "verifying", data = ";" .. db.data .. ";", asOf = db.dataAsOf }
      community[key] = entry
      verify(db.data, db.sum, function(ok)
        if community[key] ~= entry then return end -- reset while checking
        entry.status = ok and "ready" or "bad"
        if ok then
          -- A file with this many rows was cut at the cap: an item it lacks may still have a public price.
          local _, separators = entry.data:gsub(";", "")
          entry.full = separators - 1 >= E.PRICE_FILE_ROWS
        else
          entry.data = nil
          print("Everloot: community prices for " .. where .. " failed their checksum and are not shown.")
        end
      end)
    end
    entry.house = house
    community[key] = entry
  end
  return entry
end

local function communityRow(entry, itemId)
  if entry.status ~= "ready" then return nil end
  local from = entry.data:find(";" .. itemId .. ",", 1, true)
  if not from then return nil end
  local text = entry.data:match("^;([^;]+)", from)
  local id, market, min, historical, quantity, day, reporters =
    text:match("^(%d+),(%d*),(%d+),(%d+),(%d+),([%d%-]+),(%d+)$")
  if not id then return nil end
  return {
    market = tonumber(market), min = tonumber(min), historical = tonumber(historical),
    quantity = tonumber(quantity), day = day, reporters = tonumber(reporters),
  }
end

--- The community row for one item in one house of a realm ({ market, min, historical, quantity, day, reporters }), or
--- nil while the file is missing, being checked or failed its checksum, or the house is unknown. `house` defaults to
--- E:MarketHouse(). The gold-per-hour tracker reads it.
function E:CommunityPrice(realm, itemId, house)
  return communityRow(communityFor(realm, house), itemId)
end

--- The state of one house of a realm in the price file ({ status = "verifying" | "ready" | "bad", asOf, silent, house,
--- legacy, noHouse }), for the window's crafting costs to say how old their market values are and which house they are
--- for. `silent` is a realm and house the file has no entry for; `legacy` an older realm-only block that is not read.
function E:PriceFile(realm, house)
  local entry = communityFor(realm, house)
  return { status = entry.status, asOf = entry.asOf, silent = entry.silent, house = entry.house, legacy = entry.legacy, noHouse = entry.noHouse }
end

local function hex(r, g, b) return string.format("|cff%02x%02x%02x", r * 255, g * 255, b * 255) end

-- The tooltip's colours: fel green for the header only, Everloot's price gold for labels, the player's own scan in
-- blue, amounts in white, the Home window's muted text for evidence (dates, units, reporters), red for warnings.
local HEAD, LABEL, OWN = { 0.612, 0.941, 0.227 }, { 0.9, 0.8, 0.5 }, { 0.6, 0.8, 1 }
local VALUE, META, WARN = { 1, 1, 1 }, { 0.788, 0.765, 0.69 }, { 1, 0.4, 0.4 }

--- Copper as the game shows money in tooltips: each amount before the game's own coin icon, the same amounts as
--- E.Coins. For the value column only; chat and every plain line keep E.Coins' letters.
local function coinIcons(copper)
  local function coin(n, kind) return n .. "|TInterface\\MoneyFrame\\UI-" .. kind .. "Icon:0:0:2:0|t" end
  local gold, silver, coins = math.floor(copper / 10000), math.floor(copper % 10000 / 100), copper % 100
  local text = (gold > 0) and (coin(gold, "Gold") .. " " .. coin(silver, "Silver") .. " ")
    or ((silver > 0) and (coin(silver, "Silver") .. " ") or "")
  return text .. coin(coins, "Copper")
end

--- A word in the value column (unrecorded, no sell price), in the evidence colour so it never reads as an amount.
local function quiet(word) return hex(META[1], META[2], META[3]) .. word .. "|r" end

-- Forever's realm names end in their ruleset, as the game's realm list splits them: "CAMWOW US1 Realm 4 PvP". The
-- website files and colours realms by the same words (web/src/lib/realms.ts `rulesetFromName`, tokens `realm-*`).
-- RP-PvP may be one word ("CAMWOW US1 Realm 9 RPPVP" in the list players copied).
local RULESETS = {
  { suffix = "rp%-pvp", label = "RP-PvP", r = 1, g = 0.5, b = 0.25 },
  { suffix = "rp pvp", label = "RP-PvP", r = 1, g = 0.5, b = 0.25 },
  { suffix = "rppvp", label = "RP-PvP", r = 1, g = 0.5, b = 0.25 },
  { suffix = "pvp", label = "PvP", r = 1, g = 0.3, b = 0.3 },
  { suffix = "pve", label = "PvE", r = 0.4, g = 0.85, b = 0.4 },
  { suffix = "normal", label = "PvE", r = 0.4, g = 0.85, b = 0.4 },
  { suffix = "rp", label = "RP", r = 0.45, g = 0.7, b = 1 },
  { suffix = "hardcore", label = "Hardcore", r = 1, g = 0.82, b = 0 },
}

--- A realm's name without its ruleset, and the ruleset ({ label, r, g, b }), or the whole name and nil.
function E.RealmRuleset(realm)
  local lower = realm:lower()
  for _, rule in ipairs(RULESETS) do
    local cut = lower:find("[%s%-]" .. rule.suffix .. "$")
    if cut and cut > 1 then return realm:sub(1, cut - 1), rule end
  end
  return realm, nil
end

--- The header's right column: the realm the prices are from, its ruleset split off in its own colour, and the unit
--- of every amount below: "CAMWOW US1 Realm 4 PvP · per unit". The market line names its auction house.
local function headerRight(realm)
  local name, rule = E.RealmRuleset(realm)
  local ruleset = rule and (" " .. hex(rule.r, rule.g, rule.b) .. rule.label .. "|r") or ""
  return quiet(name) .. ruleset .. quiet(" · per unit")
end

--- The game's vendor price for one unit, in copper: 0 when vendors do not buy the item, nil when it is unknown (the
--- item is not loaded yet, the client has no item reader, or the reader fails or answers with a secret). Unknown is
--- never 0.
local function vendorPrice(itemId)
  local info = (type(C_Item) == "table" and C_Item.GetItemInfo) or GetItemInfo
  if type(info) ~= "function" then return nil end
  -- name, link, quality, item level, required level, type, subtype, stack, slot, icon, sell price
  local ok, _, link, _, _, _, _, _, _, _, _, sell = pcall(info, itemId)
  -- A stand-in for an item the client has not loaded has no link, and its sell price is not the item's.
  if not ok or type(E.Readable(link)) ~= "string" then return nil end
  sell = E.Readable(sell)
  if type(sell) ~= "number" or sell < 0 or sell ~= math.floor(sell) then return nil end
  return sell
end

--- The price lines for one item on the player's realm, as { text, r, g, b }: the community market value
--- from the companion's file (with its freshness), the player's own last scan, and the vendor price beside them.
--- The tooltip and the chat command show the same lines, so they always agree. `text` is plain, for chat; a line
--- holding one amount also has `left` (its label) and `right` (the amount in coin icons, or a word when there is
--- none) for the tooltip's two columns, and a long warning has `wrap`.
local function priceLines(realm, itemId)
  local out = {}
  local function add(text, color, left, right, wrap)
    out[#out + 1] = { text = text, r = color[1], g = color[2], b = color[3], left = left, right = right, wrap = wrap }
  end
  local entry = communityFor(realm)
  local row = communityRow(entry, itemId)
  if row then
    local thin = row.quantity <= E.THIN_UNITS
    local unrecorded = thin and "unrecorded (thin)" or "unrecorded"
    -- Each auction house is its own market: the value is this house's, and the line says which.
    local house = entry.house .. " house"
    add("Everloot market " .. (row.market and E.Coins(row.market) or unrecorded) .. " · per unit · " .. house, LABEL,
      "Market value · " .. house, row.market and coinIcons(row.market) or quiet(unrecorded))
    add("  min " .. E.Coins(row.min), LABEL, "  Min buyout", coinIcons(row.min))
    add("  historical " .. E.Coins(row.historical), LABEL, "  Historical", coinIcons(row.historical))
    add(string.format("  %d units listed%s, %d reporters on %s", row.quantity, thin and " (thin)" or "", row.reporters, row.day), META)
    -- Two separate facts. The item's newest public day says how old its prices are; the file's build time says
    -- how long since the companion last ran. A file built today can still hold an item nobody scanned for a week.
    local today = E.DayNumber(date("!%Y-%m-%d"))
    local seen = E.DayNumber(row.day)
    if not seen or not today then
      add("  public day unknown (stale?)", WARN, nil, nil, true)
    elseif today - seen > E.STALE_DAYS then
      add(string.format("  STALE: newest public day %s is %d days old", row.day, today - seen), WARN, nil, nil, true)
    end
    local built = E.DayNumber(entry.asOf or "")
    if not built or not today then
      add("  price file age unknown (stale?)", WARN, nil, nil, true)
    elseif today - built > E.STALE_DAYS then
      add(string.format("  OLD FILE: built %s; the Everloot Desktop App refreshes it, then /reload", entry.asOf:sub(1, 10)), WARN, nil, nil, true)
    else
      add("  price file built " .. entry.asOf:sub(1, 10), META)
    end
  end
  local own = E:OwnScan(realm)
  local item = own and own.items[itemId]
  if item then
    local hours = math.floor((time() - own.at) / 3600)
    add("Your scan: min " .. E.Coins(item[4]) .. " · per unit", OWN, "Your scan · min buyout", coinIcons(item[4]))
    add("  value " .. E.Coins(item[5]), OWN, "  Value", coinIcons(item[5]))
    add(string.format("  %d units listed, scanned %s, %s", item[3], hours < 1 and "under 1 h ago" or (hours .. " h ago"),
      own.house and (own.house .. " house") or "house not recorded"), META)
  end
  -- The game's own vendor price, for comparison beside an auction price; by itself it is no reason for these lines.
  if #out > 0 then
    local sell = vendorPrice(itemId)
    if sell and sell > 0 then
      add("Vendor " .. E.Coins(sell) .. " · per unit", LABEL, "Vendor", coinIcons(sell))
    elseif sell == 0 then
      add("Vendor: no sell price", LABEL, "Vendor", quiet("no sell price"))
    end
  end
  return out, entry
end

E.PriceLines = priceLines

-- What this install's own rows say about an item, read from the saved file and never written to it: the vendors it
-- saw selling the item (`vendor` rows), the known recipes the item is a basic reagent of (`recipe_observed` rows) and
-- the map a source was met on (`npc_sighting` and `object_sighting` rows). Each kind is indexed once, then only
-- the rows stored since, as E:SourceName does; a cleared kind is read again.
local own
local function resetOwn() own = { vendors = {}, reagents = {}, maps = {}, read = {} } end
resetOwn()
E.ResetSourceIndex = resetOwn

local OWN_ROWS = {
  vendor = function(row)
    if type(row.vendorNpcId) ~= "number" or type(row.items) ~= "table" then return end
    for _, item in ipairs(row.items) do
      local itemId = type(item) == "table" and item.itemId
      if type(itemId) == "number" then
        local list = own.vendors[itemId] or {}
        own.vendors[itemId] = list
        if not list[row.vendorNpcId] then
          list[row.vendorNpcId] = true
          list[#list + 1] = row.vendorNpcId
        end
      end
    end
  end,
  recipe_observed = function(row)
    -- Known recipes only, each once: a recipe is observed again at every colour change. The reagents carry the
    -- item's name as the client showed it, so the count is kept by name.
    local key = row.learned == true and (row.recipeId or row.recipe)
    if not key or type(row.reagents) ~= "table" then return end
    for _, reagent in ipairs(row.reagents) do
      local name = type(reagent) == "table" and reagent.item
      if type(name) == "string" then
        local set = own.reagents[name] or { n = 0 }
        own.reagents[name] = set
        if not set[key] then
          set[key] = true
          set.n = set.n + 1
        end
      end
    end
  end,
  npc_sighting = function(row)
    if type(row.npcId) == "number" and type(row.mapId) == "number" and own.maps["n" .. row.npcId] == nil then
      own.maps["n" .. row.npcId] = row.mapId
    end
  end,
  object_sighting = function(row)
    if type(row.objectId) == "number" and type(row.mapId) == "number" and own.maps["o" .. row.objectId] == nil then
      own.maps["o" .. row.objectId] = row.mapId
    end
  end,
}

local function indexOwnRows()
  local records = type(EverlootDB) == "table" and EverlootDB.records
  if type(records) ~= "table" then return end
  for kind in pairs(OWN_ROWS) do
    local rows = records[kind]
    if type(rows) == "table" and #rows < (own.read[kind] or 0) then resetOwn() end -- the rows were cleared
  end
  for kind, each in pairs(OWN_ROWS) do
    local rows = records[kind]
    if type(rows) == "table" then
      for i = (own.read[kind] or 0) + 1, #rows do
        if type(rows[i]) == "table" then each(rows[i]) end
      end
      own.read[kind] = #rows
    end
  end
end

--- The zone's name for a UiMap id, as the client names it, or nil. A name is display text only: its pipes are doubled.
local function zoneName(mapId)
  local get = type(C_Map) == "table" and C_Map.GetMapInfo
  if type(get) ~= "function" then return nil end
  local ok, info = pcall(get, mapId)
  local name = ok and type(info) == "table" and E.Readable(info.name)
  if type(name) ~= "string" or name == "" then return nil end
  return (name:gsub("|", "||"))
end

--- The item's name as the client knows it, or nil while it is not loaded.
local function itemName(itemId)
  local info = (type(C_Item) == "table" and C_Item.GetItemInfo) or GetItemInfo
  if type(info) ~= "function" then return nil end
  local ok, name = pcall(info, itemId)
  name = ok and E.Readable(name)
  return type(name) == "string" and name ~= "" and name or nil
end

--- The source lines for one item, muted, at most one of each, as { text, r, g, b, wrap }: who sells it (this
--- install's own vendor sighting first, else the file's public vendors), how many recipes it is a reagent of (the
--- recipes this install knows first, else the file's public count) and the zone this install met a drop source in.
--- Display only, from rows already in the saved file and the slot file; nothing is recorded, and no other player's
--- name appears: the vendors are NPCs and the zones are the map names.
function E:SourceLines(itemId)
  indexOwnRows()
  local out = {}
  local function add(text) out[#out + 1] = { text = text, r = META[1], g = META[2], b = META[3], wrap = true } end
  local public = E.PublicSources and E:PublicSources(itemId)
  local function npcName(id)
    return (E.SourceName and E:SourceName("npc", id)) or (public and public.names[("n" .. id)]) or ("NPC " .. id)
  end
  local vendors, suffix = own.vendors[itemId], " (your sighting)"
  if not vendors or #vendors == 0 then vendors, suffix = public and public.vendors, "" end
  if vendors and #vendors > 0 then
    local more = #vendors - 1
    add("Sold by " .. npcName(vendors[1]) .. (more > 0 and string.format(" and %d more", more) or "") .. suffix)
  end
  local name = itemName(itemId)
  local known = name and own.reagents[name]
  if known and known.n > 0 then
    add(string.format("Reagent for %d recipe%s you know", known.n, known.n == 1 and "" or "s"))
  elseif public and public.reagentOf > 0 then
    add(string.format("Reagent for %d recipe%s", public.reagentOf, public.reagentOf == 1 and "" or "s"))
  end
  local zones, seen = {}, {}
  for _, s in ipairs((E.DropSources and E:DropSources(itemId)) or {}) do
    local mapId = own.maps[(s.kind == "npc" and "n" or "o") .. s.id]
    local zone = mapId and zoneName(mapId)
    if zone and not seen[zone] then
      seen[zone] = true
      zones[#zones + 1] = zone
    end
  end
  if #zones > 0 then
    local more = #zones - 1
    add("Seen in " .. zones[1] .. (more > 0 and string.format(" and %d more zone%s", more, more == 1 and "" or "s") or ""))
  end
  return out
end

--- One part of the item tooltip is on unless the player turned it off on the settings page: "tooltipMarket" (the
--- price lines), "tooltipHistory" (the player's own sales and purchases) or "tooltipSources" (drops, vendors,
--- reagents, zones). Read on every hover, so a switch applies at once.
function E.TooltipShows(field)
  return not (type(EverlootDB) == "table" and EverlootDB[field] == false)
end

local function plural(n, word) return n .. " " .. word .. (n == 1 and "" or "s") end

--- The player's own history with the item on this realm, from the gold ledger, as { text, r, g, b, left, right }
--- like the price lines: the last sale (its UTC day and price per unit), the average sale and the units sold over the
--- ledger's window, sales whose letter has not been taken yet, and the average paid where the ledger knows both the
--- item and the price of a purchase. Every amount says the window; with no history there are no lines at all.
--- One lookup in the ledger's item index per hover.
local function historyLines(realm, itemId)
  local out = {}
  local L = E.Ledger
  local name = L and L.ItemHistory and itemName(itemId)
  local h = name and L.ItemHistory(realm, name)
  if not h then return out end
  local function add(text, color, left, right)
    out[#out + 1] = { text = text, r = color[1], g = color[2], b = color[3], left = left, right = right }
  end
  local window = "last " .. L.WINDOW_DAYS .. " days"
  if h.sales > 0 then
    local on = date("!%Y-%m-%d", h.lastAt)
    add("Your last sale " .. E.Coins(h.lastUnit) .. " · per unit · " .. on, OWN, "Your last sale · " .. on, coinIcons(h.lastUnit))
    add("  average sale " .. E.Coins(h.average) .. " · " .. window, OWN, "  Average sale · " .. window, coinIcons(h.average))
    add(string.format("  %s sold in %s, %s", plural(h.units, "unit"), plural(h.sales, "sale"), window), META)
  end
  if h.pending > 0 then
    -- The sold notice names the item; its gold arrives with the mailbox letter, so these have no price yet.
    add(string.format("%s%s in the last 2 days, paid when you take the mailbox letter",
      h.sales > 0 and "  and " or "Your sales: ", plural(h.pending, h.sales > 0 and "more sale" or "sale")), META)
  end
  if h.purchases > 0 then
    add("Your average paid " .. E.Coins(h.averagePaid) .. " · " .. window, OWN, "Your average paid · " .. window, coinIcons(h.averagePaid))
    add(string.format("  %s bought in %s, %s", plural(h.bought, "unit"), plural(h.purchases, "purchase"), window), META)
  end
  return out
end

--- The tooltip: price lines, then the player's own history, then drop lines, then the source lines. Once the Desktop
--- App's file is in the game and its prices have been checked, what is missing is said in one muted line; without the
--- file a tooltip carries no Everloot line it has no value for. Each of the three parts can be switched off on the
--- settings page (E.TooltipShows).
-- The crest's diamond, cut from media/crest.tga (128px), drawn inline before the name.
local TOOLTIP_HEADER = "|TInterface\\AddOns\\Everloot\\media\\crest:14:14:0:0:128:128:36:92:36:92|t Everloot"

local function addLines(tooltip, itemId)
  local realm = GetRealmName and GetRealmName()
  if type(realm) ~= "string" or realm == "" then return end
  -- Without the file the tooltip stays quiet, so the first item tooltip says once per install, in chat, where
  -- community prices come from. A line in every tooltip would repeat it forever to players who never install the app.
  local market, history, sources = E.TooltipShows("tooltipMarket"), E.TooltipShows("tooltipHistory"), E.TooltipShows("tooltipSources")
  if market and type(EverlootPricesDB) ~= "table" and not EverlootDB.priceFileHint then
    EverlootDB.priceFileHint = true
    print("Everloot: community prices in item tooltips come from the Everloot Desktop App (everloot.app/addon), which writes them into the game; until then tooltips show only your own auction scans. /everloot price [item] says what Everloot has for an item.")
  end
  local lines, entry
  if market then lines, entry = priceLines(realm, itemId) else lines, entry = {}, communityFor(realm) end
  local priced = #lines
  if history then
    for _, line in ipairs(historyLines(realm, itemId)) do lines[#lines + 1] = line end
  end
  -- The unit and the realm belong to the price amounts; a drop rate is neither per unit nor per realm.
  local amounts = false
  for _, line in ipairs(lines) do amounts = amounts or line.right ~= nil end
  local dropLines, dropNote
  if sources then dropLines, dropNote = E:DropLines(itemId) end
  local missing = {}
  if type(EverlootPricesDB) == "table" and entry.status ~= "verifying" then
    if market and priced == 0 then
      if entry.status == "bad" and not entry.silent then
        missing[#missing + 1] = "community prices failed their checksum"
      elseif entry.full then
        missing[#missing + 1] = "not in the local price file, which keeps 2,000 items"
      elseif entry.noHouse then
        missing[#missing + 1] = "this character's auction house is unknown, so no community price"
      elseif entry.legacy then
        missing[#missing + 1] = "the price file is from before houses were kept apart; refresh it in the Desktop App"
      else
        missing[#missing + 1] = "no price on " .. realm .. " yet"
      end
    end
    missing[#missing + 1] = dropNote
  end
  for _, line in ipairs(dropLines or {}) do lines[#lines + 1] = line end
  if #missing > 0 then
    -- Under the Everloot header the note needs no "Everloot:" of its own: "No price on Forever yet · no drop source ...".
    local note = table.concat(missing, " · "):gsub("^%l", string.upper)
    lines[#lines + 1] = { text = note, r = META[1], g = META[2], b = META[3], wrap = true }
  end
  -- Sold by, reagent for, seen in: this install's own rows need no file, so they show with or without one.
  if sources then
    for _, line in ipairs(E:SourceLines(itemId)) do lines[#lines + 1] = line end
  end
  if #lines == 0 then return end
  -- The game's two-column line puts each amount in a column beside its label; a tooltip without it gets every
  -- line's plain text instead, so nothing is lost.
  local columns = type(tooltip.AddDoubleLine) == "function"
  -- One header, only when there is something to show: the crest inline and "Everloot" in fel green, with the realm
  -- the prices are from and the unit of every amount below said once beside it.
  if columns and amounts then
    tooltip:AddDoubleLine(TOOLTIP_HEADER, headerRight(realm), HEAD[1], HEAD[2], HEAD[3], META[1], META[2], META[3])
  else
    tooltip:AddLine(TOOLTIP_HEADER, HEAD[1], HEAD[2], HEAD[3])
  end
  for _, line in ipairs(lines) do
    if columns and line.left and line.right then
      tooltip:AddDoubleLine(line.left, line.right, line.r, line.g, line.b, VALUE[1], VALUE[2], VALUE[3])
      if line.detail then tooltip:AddLine(line.detail, META[1], META[2], META[3], true) end
    else
      tooltip:AddLine(line.text, line.r, line.g, line.b, line.wrap)
    end
  end
end

--- The item id in what the player typed after /everloot price: a shift-clicked link, a bare id, or the
--- name of an item this client has seen (the game only knows names it has loaded).
function E.ItemIdFrom(text)
  text = tostring(text or ""):gsub("^%s+", ""):gsub("%s+$", "")
  local id = text:match("|Hitem:(%d+)") or text:match("^item:(%d+)") or text:match("^(%d+)$")
  if id then return tonumber(id) end
  if text == "" then return nil end
  local link = GetItemInfo and select(2, GetItemInfo(text))
  return link and tonumber(link:match("item:(%d+)")) or nil
end

--- Why a price command found nothing, said exactly: no file, a file without this realm, a file that failed its
--- checksum, a full file (the item may be public but cut), or a small file that simply has no price for it.
local function missingNote(realm, entry)
  if entry.status == "verifying" then return "The price file is still being checked; try again in a moment." end
  if entry.status == "bad" and not entry.silent then
    return "The community prices for " .. realm .. " failed their checksum and were not used: refresh them with the Everloot Desktop App, then /reload."
  end
  if entry.status == "bad" then
    if type(EverlootPricesDB) ~= "table" then
      return "No Everloot price file in the game yet: the Everloot Desktop App writes it, then /reload."
    end
    if entry.noHouse then
      return "Everloot cannot tell this character's auction house, so it shows no community price: each house is its own market."
    end
    if entry.legacy then
      return "The Everloot price file is from before auction houses were kept apart: its prices may mix both factions, so they are not shown. Refresh it with the Everloot Desktop App, then /reload."
    end
    local where = entry.house and ("the " .. entry.house .. " auction house on " .. realm) or realm
    return "The Everloot price file has no data for " .. where .. " yet: scan its auction house or follow it in the Desktop App, then /reload."
  end
  if entry.full then
    return "Not in this realm's price file, which keeps only the 2,000 items with the most units listed. A public price may still be on the website."
  end
  return "No price for this item on this realm yet: no public day (3 reporters) and no scan of your own."
end

E.PriceMissingNote = missingNote

--- Percent-encodes every byte outside [A-Za-z0-9-_.~] so a realm with an apostrophe or non-ASCII letters is a valid URL
--- value. The ranges are spelled out: %w follows the C locale and can count a Latin-1 lead byte as a letter.
local function encode(s)
  return (s:gsub("[^A-Za-z0-9%-_%.~]",function(c) return string.format("%%%02X", c:byte()) end))
end

--- /everloot price <item>: the same lines as the tooltip, in chat, anywhere in the world. Read from the
--- files already in the game (the companion's prices and the player's own scans); nothing is fetched.
--- The full history, every realm and the chart are on the site.
function E.PriceCommand(text, tries)
  local id = E.ItemIdFrom(text)
  if not id then
    print("Everloot: shift-click an item into the command (/everloot price [item]), or give its item id.")
    return
  end
  local realm = GetRealmName and GetRealmName()
  if type(realm) ~= "string" or realm == "" then return end
  local lines, entry = priceLines(realm, id)
  -- A large price file is checked a slice per frame the first time it is read; wait for it.
  if entry.status == "verifying" and (tries or 0) < 100 and C_Timer and C_Timer.After then
    return C_Timer.After(0, function() E.PriceCommand(text, (tries or 0) + 1) end)
  end
  local name = (GetItemInfo and select(2, GetItemInfo(id))) or ("item " .. id)
  print("Everloot price: " .. name .. " on " .. realm .. (entry.house and (", " .. entry.house .. " auction house") or ""))
  -- A failed checksum is said even when the player's own scan answers: the community prices were there to be shown.
  if #lines == 0 or (entry.status == "bad" and not entry.silent) then print("  " .. missingNote(realm, entry)) end
  for _, line in ipairs(lines) do print(hex(line.r, line.g, line.b) .. line.text .. "|r") end
  for _, line in ipairs(historyLines(realm, id)) do print(hex(line.r, line.g, line.b) .. line.text .. "|r") end
  local dropLines, dropNote = E:DropLines(id)
  for _, line in ipairs(dropLines or {}) do print(hex(line.r, line.g, line.b) .. line.text .. "|r") end
  if dropNote and type(EverlootPricesDB) == "table" then print("  " .. dropNote:gsub("^%l", string.upper)) end
  for _, line in ipairs(E:SourceLines(id)) do print(hex(line.r, line.g, line.b) .. line.text .. "|r") end
  print("  Full history and other realms: everloot.app/tools/auctions?realm=" .. encode(realm) .. "&item=" .. encode(tostring(id)))
end

--- The post-call runs for every item tooltip, and comparing an item opens ShoppingTooltip1 and 2 (ItemRefShoppingTooltip1
--- and 2 from a chat link) beside the main one, each with its own item. The block belongs on the main tooltip only;
--- on the comparison tooltips it repeated up to three times on one hover.
local function isComparison(tooltip)
  local name = type(tooltip.GetName) == "function" and tooltip:GetName()
  return type(name) == "string" and name:find("ShoppingTooltip%d+$") ~= nil
end

E:RegisterModule("prices", function()
  if not (TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall and Enum and Enum.TooltipDataType) then
    error("tooltip API unavailable", 0)
  end
  if not E.pricesHooked then
    TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Item, function(tooltip, data)
      if tooltip and tooltip.AddLine and type(data) == "table" and type(data.id) == "number" and not isComparison(tooltip) then
        pcall(addLines, tooltip, data.id)
      end
    end)
    E.pricesHooked = true
  end
  return "ready (prices in item tooltips; community prices after the Everloot Desktop App writes them and /reload)"
end)
