-- Everloot prices in item tooltips: the player's own latest full scan, and community market values
-- the companion wrote into the EverlootPrices slot addon (checksummed; they show after /reload), with the
-- game's own vendor price beside them. The drop sources in the same file (modules/drops.lua) follow the
-- prices in the same tooltip. Display only: nothing here talks to the network or acts on the auction house.

local E = Everloot

--- The player's latest full scan on this realm: { at, items = { [itemId] = {id, auctions, quantity, min, value} } }.
function E:OwnScan(realm)
  local last = EverlootDB.lastScans and EverlootDB.lastScans[realm]
  if not last then return nil end
  if E.ownScanCache and E.ownScanCache.scanId == last.scanId then return E.ownScanCache end
  local items = {}
  for _, row in ipairs(EverlootDB.records.auction_snapshot or {}) do
    if row.scanId == last.scanId then
      for _, item in ipairs(row.items) do items[item[1]] = item end
    end
  end
  E.ownScanCache = { scanId = last.scanId, at = last.at, items = items }
  return E.ownScanCache
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

-- Community prices per realm: { status = "verifying" | "ready" | "bad", data, asOf }.
local community = {}

function E:ResetPrices()
  community = {}
  if E.ResetDrops then E:ResetDrops() end
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

--- One realm's price file entry from EverlootPricesDB: "itemId,market,min,historical,quantity,day,reporters;..."
--- with an Adler-32 `sum` over that string. A blank market is unrecorded. The string is searched, not
--- parsed: a tooltip finds its one row, so a large file costs nothing until its checksum has passed.
local function communityFor(realm)
  local key = realm:lower()
  local entry = community[key]
  if entry == nil then
    local realms = type(EverlootPricesDB) == "table" and EverlootPricesDB.realms
    local db = type(realms) == "table" and realms[key]
    if type(db) ~= "table" then
      entry = { status = "bad", silent = true }
    elseif type(db.data) ~= "string" or type(db.sum) ~= "number" then
      entry = { status = "bad" }
      print("Everloot: community prices for " .. realm .. " failed their checksum and are not shown.")
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
          print("Everloot: community prices for " .. realm .. " failed their checksum and are not shown.")
        end
      end)
    end
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

--- The community row for one item on a realm ({ market, min, historical, quantity, day, reporters }), or
--- nil while the file is missing, being checked or failed its checksum. The gold-per-hour tracker reads it.
function E:CommunityPrice(realm, itemId)
  return communityRow(communityFor(realm), itemId)
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
--- of every amount below: "CAMWOW US1 Realm 4 PvP · per unit".
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
    -- The website can show one auction house; this file blends every house on the realm, so say so beside the numbers.
    add("Everloot market " .. (row.market and E.Coins(row.market) or unrecorded) .. " · per unit · all houses", LABEL,
      "Market value · all houses", row.market and coinIcons(row.market) or quiet(unrecorded))
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
      add(string.format("  OLD FILE: built %s; the Desktop App or companion refreshes it, then /reload", entry.asOf:sub(1, 10)), WARN, nil, nil, true)
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
    add(string.format("  %d units listed, scanned %s", item[3], hours < 1 and "under 1 h ago" or (hours .. " h ago")), META)
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

--- The tooltip: price lines, then drop lines. Once the Desktop App's file is in the game and its prices have been
--- checked, what is missing is said in one muted line; without the file a tooltip carries no Everloot line it has no value for.
-- The crest's diamond, cut from media/crest.tga (128px), drawn inline before the name.
local TOOLTIP_HEADER = "|TInterface\\AddOns\\Everloot\\media\\crest:14:14:0:0:128:128:36:92:36:92|t Everloot"

local function addLines(tooltip, itemId)
  local realm = GetRealmName and GetRealmName()
  if type(realm) ~= "string" or realm == "" then return end
  -- Without the file the tooltip stays quiet, so the first item tooltip says once per install, in chat, where
  -- community prices come from. A line in every tooltip would repeat it forever to players who never install the app.
  if type(EverlootPricesDB) ~= "table" and not EverlootDB.priceFileHint then
    EverlootDB.priceFileHint = true
    print("Everloot: community prices in item tooltips come from the Everloot Desktop App (everloot.app/addon), which writes them into the game; until then tooltips show only your own auction scans. /everloot price [item] says what Everloot has for an item.")
  end
  local lines, entry = priceLines(realm, itemId)
  -- The unit and the realm belong to the price amounts; a drop rate is neither per unit nor per realm.
  local amounts = false
  for _, line in ipairs(lines) do amounts = amounts or line.right ~= nil end
  local dropLines, dropNote = E:DropLines(itemId)
  local missing = {}
  if type(EverlootPricesDB) == "table" and entry.status ~= "verifying" then
    if #lines == 0 then
      if entry.status == "bad" and not entry.silent then
        missing[#missing + 1] = "community prices failed their checksum"
      elseif entry.full then
        missing[#missing + 1] = "not in the local price file, which keeps 2,000 items"
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
    return "The community prices for " .. realm .. " failed their checksum and were not used: refresh them with the Desktop App or companion, then /reload."
  end
  if entry.status == "bad" then
    if type(EverlootPricesDB) ~= "table" then
      return "No Everloot price file in the game yet: the Everloot Desktop App or companion writes it, then /reload."
    end
    return "The Everloot price file has no data for " .. realm .. " yet: scan its auction house or follow it in the Desktop App, then /reload."
  end
  if entry.full then
    return "Not in this realm's price file, which keeps only the 2,000 items with the most units listed. A public price may still be on the website."
  end
  return "No price for this item on this realm yet: no public day (3 reporters) and no scan of your own."
end

E.PriceMissingNote = missingNote

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
  print("Everloot price: " .. name .. " on " .. realm)
  -- A failed checksum is said even when the player's own scan answers: the community prices were there to be shown.
  if #lines == 0 or (entry.status == "bad" and not entry.silent) then print("  " .. missingNote(realm, entry)) end
  for _, line in ipairs(lines) do print(hex(line.r, line.g, line.b) .. line.text .. "|r") end
  local dropLines, dropNote = E:DropLines(id)
  for _, line in ipairs(dropLines or {}) do print(hex(line.r, line.g, line.b) .. line.text .. "|r") end
  if dropNote and type(EverlootPricesDB) == "table" then print("  " .. dropNote:gsub("^%l", string.upper)) end
  print("  Full history and other realms: everloot.app/tools/auctions?realm=" .. realm:gsub(" ", "+") .. "&item=" .. id)
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
