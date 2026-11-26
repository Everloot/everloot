-- Everloot window, Professions: three screens behind two buttons at the bottom.
--   Professions: each profession in the character's profession book with its rank bar, how many recipes the addon
--     has recorded for it in each difficulty colour (professions.lua writes them, read here through Everloot:Rows),
--     the day they were last read, and one line for the next recipe a trainer teaches. Under the blocks, every other
--     character in the roster (roster.lua) with its professions and ranks.
--   Ranks and trainers: per profession, the recipes a trainer teaches at or above the current rank, lowest first,
--     with the rank, the cost and where: the trainer's name and zone (trainer_seen rows; name and map from the
--     matching npc_sighting row).
--   Crafting costs: each recorded recipe of the character's professions with its reagents' cost, its product's
--     market value and an estimated profit per craft, and what to buy for a chosen recipe and count, which a button
--     adds to the active shopping list (modules/shopping.lua, saved in this install's file).
-- Otherwise display only: it registers no events and records nothing; the window builds it the first time
-- Professions is opened.

local E = Everloot
if not (E.Window and E.Window.Views) then return end
local U = E.Window
local COLORS, NARROW, text, surface = U.COLORS, U.NARROW, U.Text, U.Surface

local W, H = 604, 390  -- the view frame window.lua gives every view (W - MAIN - 12 wide, H - 60 tall)
local FOOTER_H = 24
local PAGE_H = H - FOOTER_H        -- what a screen has above the footer
local BLOCKS, GAP = 5, 4           -- the profession book has five slots
local HEAD_H, LINE_H = 44, 15      -- a block: the name, bar and recipe line, then the trainer line
local BLOCK_H = HEAD_H + 16
local OTHER_ROWS = 6               -- the most characters the list under the blocks holds
local BUCKETS = { optimal = "orange", medium = "yellow", easy = "green", trivial = "grey" }
-- The colours the game's trade-skill window gives each recipe difficulty (TradeSkillTypeColor), hardest first.
local SHADES = { { "orange", "ff8040" }, { "yellow", "ffff00" }, { "green", "40c040" }, { "grey", "808080" } }
local READ_IT = "Open the profession window to read its recipes."
local NO_TRAINER = "Nothing from a trainer yet. Open a trainer's window."
local NOT_SEEN = "Trainer not seen"
local OTHERS = "Other characters"
local NO_OTHERS = "No other characters seen by this install yet."
local NO_BOOK = "No profession book in this client."
local NONE_LEARNED = "No professions learned yet."
local FOOTER = "Planner: everloot.app/tools/profession-planner"
local FALLBACK_ICON = "Interface\\Icons\\INV_Misc_QuestionMark"

-- The screens, and the two the buttons at the bottom open from each: the left one, then the right one.
local TO_LIST, TO_CRAFTING, TO_RANKS = "Professions", "Crafting costs", "Ranks and trainers"
local SCREENS = { list = TO_LIST, crafting = TO_CRAFTING, trainers = TO_RANKS }
local GO = { list = { "trainers", "crafting" }, crafting = { "list", "trainers" }, trainers = { "list", "crafting" } }
local NAV_W = 136

-- The ranks and trainers page: a heading row, then a box per profession with its rows.
local TRAIN_ROWS, TRAIN_HEAD, SECTION_HEAD, ROW_H = 5, 20, 26, 16
local TRAIN_COLUMNS = { { "rank", 10, 34 }, { "recipe", 48, 200 }, { "cost", 252, 70 }, { "where", 330, 264 } }

-- The crafting costs page.
local CRAFT_ROWS, CRAFT_ROW_H = 8, 16
local BUY_LINES = 5
local MAX_COUNT = 999
local SORT_PROFIT, PROFITABLE = "Sort: est. profit", "Est. profitable only"
local NO_RECIPES = "No recipes with reagents recorded for your professions yet. Open a profession window to read them."
local NONE_PROFITABLE = "No recipe shows an estimated profit at these prices."
local PER_ITEM = "Select a recipe for the cost and profit breakdown."
local HELP_PROFIT = "Profit is the estimated sale value of a craft's average output, minus the auction house cut and "
  .. "materials. If the output is unknown, the estimate assumes one. Unsold auction deposits are excluded."
local HELP_COLOUR = "Green profit is a gain, red is a loss. Est. profitable only keeps the green ones."
local HELP_SCANS = "Your scans: how the lowest buyout of what the recipe makes moved between your last two scans of this "
  .. "auction house, with bars for up to three scans. These are listings, not sales; hover a recipe for the numbers."
local NO_FILE = "No price file in the game yet: the Everloot Desktop App writes it, then /reload. Vendor prices you saw still count."
local CHECKING = "Checking the price file..."
local FAILED = "The price file failed its checksum and is not used. Vendor prices you saw still count."
local NO_REALM = "The price file has no market values for this realm yet. Vendor prices you saw still count."
local WARN = { 1, 0.4, 0.4, 1 }  -- the tooltip's warning red (prices.lua)
local ADD_TO_LIST = "Add reagents to shopping list"

local refresh, buildCrafting

-- A click redraws the view; an error closes the window as any other view error does.
local function redraw()
  local ok, err = pcall(refresh, U.frame)
  if not ok then U.Fail(err) end
end

-- What was recorded for one profession: how many recipes, each colour's count, and the newest read day. A recipe
-- whose colour changed has a row per colour (professions.lua), so only its newest row counts.
local function recorded(name)
  local latest = {}
  for _, r in ipairs(E:Rows("recipe_observed")) do
    if type(r) == "table" and r.profession == name then
      local id = r.recipeId ~= nil and r.recipeId or r.recipe
      local at = type(r.kindLoggedAt) == "string" and r.kindLoggedAt:match("^%d%d%d%d%-%d%d%-%d%d") or ""
      if id ~= nil then
        local seen = latest[id]
        if not seen or at >= seen.at then latest[id] = { at = at, difficulty = r.difficulty } end
      end
    end
  end
  local out = { n = 0, orange = 0, yellow = 0, green = 0, grey = 0 }
  for _, r in pairs(latest) do
    out.n = out.n + 1
    local bucket = BUCKETS[r.difficulty]
    if bucket then out[bucket] = out[bucket] + 1 end
    if r.at ~= "" and (not out.newest or r.at > out.newest) then out.newest = r.at end
  end
  return out
end

-- The trainer's name and map for an NPC id, from the newest npc_sighting row that has a name.
local function trainerNames()
  local names = {}
  for _, r in ipairs(E:Rows("npc_sighting")) do
    if type(r) == "table" and r.npcId ~= nil and type(r.name) == "string" and r.name ~= "" then
      names[r.npcId] = { name = r.name, mapId = type(r.mapId) == "number" and r.mapId or nil }
    end
  end
  return names
end

-- The zone's name for a UiMap id, as the client names it, or nil. Display text only: its pipes are doubled.
local function zoneName(mapId)
  local get = mapId and type(C_Map) == "table" and C_Map.GetMapInfo
  if type(get) ~= "function" then return nil end
  local ok, info = pcall(get, mapId)
  local name = ok and type(info) == "table" and E.Readable(info.name)
  if type(name) ~= "string" or name == "" then return nil end
  return (name:gsub("|", "||"))
end

-- The recipes a trainer teaches for one profession at or above the character's rank, lowest rank first. A recipe
-- listed by two trainers at the same rank is one row, from the first trainer read.
local function trainerRows(name, rank, names)
  local rows, seen = {}, {}
  for _, r in ipairs(E:Rows("trainer_seen")) do
    if type(r) == "table" and r.profession == name and type(r.requiredRank) == "number" and r.requiredRank >= rank
      and type(r.recipe) == "string" then
      local key = r.recipe .. "|" .. r.requiredRank
      if not seen[key] then
        seen[key] = true
        local who = names[r.trainerNpcId]
        rows[#rows + 1] = { rank = r.requiredRank, recipe = r.recipe, cost = r.costCopper,
          trainer = who and who.name, mapId = who and who.mapId }
      end
    end
  end
  table.sort(rows, function(a, b)
    if a.rank ~= b.rank then return a.rank < b.rank end
    return a.recipe < b.recipe
  end)
  return rows
end

-- The block's trainer line: the first recipe a trainer teaches at or above the character's rank. Whether this
-- character already trained it is not recorded, so a recipe at its rank is "At your rank", never "Learn now".
local function nextLine(r, rank)
  local now = r.rank <= rank
  local s = (now and "At your rank: " or ("Next at " .. r.rank .. ": ")) .. r.recipe
  if type(r.cost) == "number" then s = s .. " · " .. U.MoneyShort(r.cost) end
  if r.trainer then s = s .. " · " .. r.trainer end
  return s, now
end

-- "39 recipes: 2 orange · 1 yellow · 3 green · 33 grey", each colour's count in the game's colour for it; a colour
-- with no recipe is left out.
local function recipeLine(got)
  local parts = {}
  for _, shade in ipairs(SHADES) do
    local n = got[shade[1]]
    if n > 0 then parts[#parts + 1] = "|cff" .. shade[2] .. n .. " " .. shade[1] .. "|r" end
  end
  local s = got.n .. (got.n == 1 and " recipe" or " recipes")
  return #parts > 0 and (s .. ": " .. table.concat(parts, " · ")) or s
end

-- Draws one block and returns its height.
local function draw(block, p, names)
  local got = recorded(p.name)
  block.name:SetText(p.name)
  block.icon:SetTexture(p.icon or FALLBACK_ICON)
  block.bar:SetMinMaxValues(0, p.maxRank or math.max(p.rank, 1))
  block.bar:SetValue(p.rank)
  block.rank:SetText(p.maxRank and (p.rank .. " / " .. p.maxRank) or tostring(p.rank))
  block.recipes:SetText(got.n == 0 and READ_IT or recipeLine(got))
  if got.n > 0 and got.newest then
    block.last:SetText("Last read: " .. got.newest)
    block.last:Show()
  else
    block.last:Hide()
  end
  local first = trainerRows(p.name, p.rank, names)[1]
  if first then
    local s, now = nextLine(first, p.rank)
    block.next:SetText(s)
    block.next:SetTextColor(unpack(now and COLORS.text or COLORS.muted))
  else
    block.next:SetText(NO_TRAINER)
    block.next:SetTextColor(unpack(COLORS.muted))
  end
  block:SetSize(W, BLOCK_H)
  return BLOCK_H
end

-- Ranks and trainers ------------------------------------------------------------------------------------------

-- One profession's box: its name, rank and what is waiting at a trainer, then a row per recipe up to `limit`. The
-- trainer and zone are said once for a run of rows from the same trainer. Returns the box's height.
local function drawSection(s, prof, limit, names)
  local rows = trainerRows(prof.name, prof.rank, names)
  local now = 0
  for _, r in ipairs(rows) do if r.rank <= prof.rank then now = now + 1 end end
  local rank = prof.maxRank and (prof.rank .. " / " .. prof.maxRank) or tostring(prof.rank)
  local waiting = now > 0 and (now .. " at your rank") or (rows[1] and ("next at rank " .. rows[1].rank) or "no trainer seen")
  local more = #rows - limit
  s.name:SetText(prof.name)
  s.summary:SetText(rank .. " · " .. waiting .. (more > 0 and (" · " .. more .. " more") or ""))
  local last
  for i, line in ipairs(s.rows) do
    local r = i <= limit and rows[i]
    if r then
      line.rank:SetText(tostring(r.rank))
      line.rank:SetTextColor(unpack(r.rank <= prof.rank and COLORS.text or COLORS.muted))
      line.recipe:SetText(r.recipe)
      line.recipe:SetTextColor(unpack(COLORS.text))
      line.recipe:SetWidth(TRAIN_COLUMNS[2][3])
      line.cost:SetText(type(r.cost) == "number" and U.MoneyShort(r.cost) or "-")
      local zone = zoneName(r.mapId)
      local where = r.trainer and (r.trainer .. (zone and (" · " .. zone) or "")) or NOT_SEEN
      line.where:SetText(where == last and "" or where)
      last = where
      line:Show()
    elseif i == 1 then
      line.rank:SetText(""); line.cost:SetText(""); line.where:SetText("")
      line.recipe:SetText(NO_TRAINER)
      line.recipe:SetTextColor(unpack(COLORS.muted))
      line.recipe:SetWidth(W - 60)
      line:Show()
    else
      line:Hide()
    end
  end
  local height = SECTION_HEAD + ROW_H * math.max(1, math.min(#rows, limit)) + 4
  s:SetSize(W, height)
  return height
end

local function refreshTrainers(t, list)
  for _, cell in pairs(t.head) do if #list > 0 then cell:Show() else cell:Hide() end end
  -- As many rows per profession as let every box fit above the footer, at least one and at most five.
  local k = math.max(#list, 1)
  local each = (PAGE_H - TRAIN_HEAD - (k - 1) * GAP) / k
  local limit = math.max(1, math.min(TRAIN_ROWS, math.floor((each - SECTION_HEAD - 4) / ROW_H)))
  local names = trainerNames()
  local y = TRAIN_HEAD
  for i, s in ipairs(t.sections) do
    local prof = list[i]
    if prof then
      s:SetPoint("TOPLEFT", 0, -y)
      y = y + drawSection(s, prof, limit, names) + GAP
      s:Show()
    else
      s:Hide()
    end
  end
end

local function professionText(list)
  local parts = {}
  for _, prof in ipairs(type(list) == "table" and list or {}) do
    if type(prof) == "table" and type(prof.name) == "string" then
      parts[#parts + 1] = prof.name .. (type(prof.rank) == "number" and (" " .. prof.rank) or "")
    end
  end
  return #parts > 0 and table.concat(parts, ", ") or "no professions read yet"
end

-- The other characters' professions under the blocks, as many rows as fit above the footer; hidden when none fits.
local function drawOthers(p, y)
  local me = E.Roster and E.Roster.Current and E.Roster.Current() or nil
  local rows = {}
  for _, c in ipairs(E.Roster and E.Roster.Rows and E.Roster.Rows() or {}) do
    if c.key ~= me and type(c.name) == "string" then
      rows[#rows + 1] = c.name .. (type(c.realm) == "string" and (" · " .. c.realm) or "") .. ": " .. professionText(c.professions)
    end
  end
  local room = math.floor((H - FOOTER_H - y - LINE_H) / LINE_H)
  if room < 1 then
    p.others:Hide()
    for _, line in ipairs(p.other) do line:Hide() end
    return
  end
  p.others:SetPoint("TOPLEFT", 8, -y)
  p.others:Show()
  for i, line in ipairs(p.other) do
    if i == 1 and #rows == 0 then
      line:SetText(NO_OTHERS); line:Show()
    elseif rows[i] and i <= room then
      line:SetText(rows[i]); line:Show()
    else
      line:Hide()
    end
  end
end

-- Crafting costs ----------------------------------------------------------------------------------------------

-- What the crafting page reads, indexed once and then only for the rows stored since, as prices.lua indexes its own
-- rows: the newest reagent list of each known recipe, every item id this install saw for each item name (recipes name
-- their reagents, prices are by item id; a name seen with two ids is ambiguous and gets no price) and the lowest price
-- a vendor this install visited asked for each item. A kind with fewer rows than were read was cleared, and everything
-- is read again.
local index
local function resetIndex() index = { recipes = {}, ids = {}, vendor = {}, read = {} } end
resetIndex()

local INDEX_ROWS = {
  recipe_observed = function(r)
    if r.learned == false or type(r.profession) ~= "string" or type(r.recipe) ~= "string" or type(r.reagents) ~= "table" then return end
    local reagents = {}
    for _, g in ipairs(r.reagents) do
      if type(g) == "table" and type(g.item) == "string" and type(g.count) == "number" and g.count >= 1 then
        reagents[#reagents + 1] = { item = g.item, count = g.count }
      end
    end
    -- A recipe whose slot takes several items is stored without reagents (professions.lua): it has no cost here.
    if #reagents == 0 then return end
    local key = r.profession .. "|" .. tostring(r.recipeId ~= nil and r.recipeId or r.recipe)
    index.recipes[key] = { key = key, profession = r.profession, name = r.recipe, reagents = reagents, id = r.recipeId,
      product = type(r.productItemId) == "number" and r.productItemId or nil }
  end,
  item_seen = function(r)
    if type(r.itemId) ~= "number" or type(r.name) ~= "string" or r.name == "" then return end
    local ids = index.ids[r.name] or { n = 0 }
    if not ids[r.itemId] then ids[r.itemId] = true; ids.n = ids.n + 1; ids.id = r.itemId end
    index.ids[r.name] = ids
  end,
  vendor = function(r)
    if type(r.items) ~= "table" then return end
    for _, o in ipairs(r.items) do
      -- A price of 0 is an item bought with something other than money; it is not a gold cost.
      if type(o) == "table" and type(o.itemId) == "number" and type(o.priceCopper) == "number" and o.priceCopper > 0 then
        local low = index.vendor[o.itemId]
        if not low or o.priceCopper < low then index.vendor[o.itemId] = o.priceCopper end
      end
    end
  end,
}

local function indexRows()
  for kind in pairs(INDEX_ROWS) do
    if #E:Rows(kind) < (index.read[kind] or 0) then resetIndex(); break end
  end
  for kind, each in pairs(INDEX_ROWS) do
    local rows = E:Rows(kind)
    for i = (index.read[kind] or 0) + 1, #rows do
      if type(rows[i]) == "table" then each(rows[i]) end
    end
    index.read[kind] = #rows
  end
end

-- Snapshot parts carry UTC text; OwnScan's time is seconds since the epoch.
local function scanTime(at)
  local day = E.DayNumber(at)
  local h, m, sec = tostring(at):match("T(%d%d):(%d%d):(%d%d)Z$")
  if day and h then return day * 86400 + tonumber(h) * 3600 + tonumber(m) * 60 + tonumber(sec) end
end

-- Read complete scans of this house only. Missing items stay missing, never zero listings or sales.
local function keptScans(realm)
  local latest = realm and E:OwnScan(realm)
  if not latest or not latest.house then return {} end
  local groups, out = {}, {}
  for _, r in ipairs(E:Rows("auction_snapshot")) do
    if r.realm == realm and r.house == latest.house then
      local at = scanTime(r.capturedAt)
      if at and at <= latest.at then
        local g = groups[r.scanId]
        if not g then
          g = { at = at, items = {}, parts = {}, total = r.parts }
          groups[r.scanId] = g
        end
        g.parts[r.part] = true
        for _, item in ipairs(r.items) do g.items[item[1]] = item end
      end
    end
  end
  for id, g in pairs(groups) do
    local complete = true
    for part = 1, g.total do if not g.parts[part] then complete = false end end
    if complete and id ~= latest.scanId then out[#out + 1] = g end
  end
  table.sort(out, function(a, b) return a.at > b.at end)
  while #out > 2 do table.remove(out) end
  table.insert(out, 1, latest)
  return out
end

local function percent(value, base)
  if value and base and base > 0 then return (value - base) / base * 100 end
end
local function signed(value)
  return value and string.format("%+.1f%%", value) or "—"
end
local function hours(seconds)
  return seconds < 3600 and "under 1 h" or (math.floor(seconds / 3600) .. " h")
end

local function marketChange(itemId, scans, public)
  local out = { bars = {}, lines = { "Listing changes, not sales. Scans are snapshots of asking prices." } }
  local latest, previous = scans[1], scans[2]
  local item = latest and latest.items[itemId]
  local older = previous and previous.items[itemId]
  if previous then
    out.lines[#out.lines + 1] = "Change since the previous " .. latest.house .. " scan, over the last "
      .. hours(latest.at - previous.at) .. " (older scan: " .. hours(math.max(0, time() - previous.at)) .. " ago)"
    out.change = percent(item and item[4], older and older[4])
    out.lines[#out.lines + 1] = "Min buyout: " .. signed(out.change)
    local units = item and older and item[3] - older[3]
    out.lines[#out.lines + 1] = "Units listed: " .. (units and string.format("%+d", units) or "—")
  else
    out.lines[#out.lines + 1] = latest and "one scan so far: scan again later to see change"
      or "No own scan of this house yet."
  end
  out.lines[#out.lines + 1] = signed(public and percent(public.market, public.historical)) .. " vs 60-day median"
  local prices = {}
  local function add(price) if type(price) == "number" and price > 0 then prices[#prices + 1] = price end end
  for i = #scans, 1, -1 do
    local point = scans[i].items[itemId]
    out.bars[#out.bars + 1] = point and point[4] or false
    if point then add(point[4]); add(point[5]) end
  end
  if public then add(public.market); add(public.historical) end
  local swing
  if #prices >= 2 then
    local lo, hi, sum = prices[1], prices[1], 0
    for _, price in ipairs(prices) do lo = math.min(lo, price); hi = math.max(hi, price); sum = sum + price end
    swing = (hi - lo) / (sum / #prices) * 100
  end
  out.lines[#out.lines + 1] = (swing and string.format("%.1f%%", swing) or "—") .. " swing"
  out.lines[#out.lines + 1] = "Swing is (highest - lowest) / average of kept scan min/value and price file market/median."
  out.lines[#out.lines + 1] = "Bars: oldest to newest kept scan, min buyout relative to the highest. Gaps mean no item price."
  return out
end

-- One redraw's prices, each item looked up once: the price file's market value, or the lowest vendor price this
-- install saw when that is lower or the only one. A reagent named by a recipe gets its id from this install's item
-- rows, else from the client when it has the item loaded. A name this install saw with two ids stays ambiguous: the
-- client's lookup by name would only pick one of them.
local AMBIGUOUS = "ambiguous"
local function pricer(realm, own)
  local ids, units, markets = {}, {}, {}
  local scans
  local P = {}
  P.cut = E.SellCheck and math.floor(E.SellCheck.Cut(E:MarketHouse()) * 100 + 0.5) or 5
  -- The item id for a reagent name, or nil and true when the name is ambiguous.
  function P.id(name)
    if ids[name] == nil then
      local seen = index.ids[name]
      if seen and seen.n > 1 then ids[name] = AMBIGUOUS
      else ids[name] = seen and seen.id or (E.ItemIdFrom and E.ItemIdFrom(name)) or false end
    end
    if ids[name] == AMBIGUOUS then return nil, true end
    return ids[name] or nil
  end
  function P.market(itemId)
    if markets[itemId] == nil then
      local row = realm and E.CommunityPrice and E:CommunityPrice(realm, itemId)
      markets[itemId] = row or false
    end
    local row = markets[itemId]
    local listing = own and own.items[itemId]
    local observed = listing and row and E.DayNumber(row.day)
    -- Community observations are dated to the day. Prefer a recent own scan on that day or later.
    if listing and type(listing[5]) == "number" and listing[5] > 0
      and (not observed or math.floor(own.at / 86400) >= observed) then
      return listing[5], "scan"
    end
    if row and row.market then return row.market, "community", row.day end
  end
  function P.change(itemId)
    scans = scans or keptScans(realm)
    if itemId then P.market(itemId) end
    return marketChange(itemId, scans, itemId and markets[itemId])
  end
  -- The price of one unit and whether it is a vendor's, or nil.
  function P.unit(itemId)
    if units[itemId] == nil then
      local market, source, observed = P.market(itemId)
      local vendor = index.vendor[itemId]
      if vendor and (not market or vendor < market) then units[itemId] = { vendor, true }
      elseif market then units[itemId] = { market, false, source, observed }
      else units[itemId] = false end
    end
    local u = units[itemId]
    if u then return u[1], u[2], u[3], u[4] end
  end
  return P
end

local function saleEstimate(row, count)
  local sale = math.floor(row.value * row.yield * count)
  local net = math.floor(sale * (100 - row.cut) / 100)
  return sale, sale - net, net - row.cost * count
end

-- A recipe's material cost, item price and estimated profit after the auction house cut.
local function evaluate(recipe, P)
  local out = { key = recipe.key, name = recipe.name, parts = {}, unpriced = 0, cut = P.cut, yield = 1 }
  local output = recipe.output
  if not recipe.live then output = recipe.id and EverlootDB.recipeOutput and EverlootDB.recipeOutput[recipe.id] end
  if output and output.itemId == recipe.product then
    out.output = output
    out.yield = (output.minimum + output.maximum) / 2
  end
  local cost = 0
  for _, g in ipairs(recipe.reagents) do
    local id, ambiguous = g.id, g.ambiguous
    if not id and not ambiguous then id, ambiguous = P.id(g.item) end
    local unit, vendor, source, observed
    if id then unit, vendor, source, observed = P.unit(id) end
    out.parts[#out.parts + 1] = { item = g.item, id = id, count = g.count, unit = unit, vendor = vendor,
      ambiguous = ambiguous, source = source, observed = observed }
    if unit then cost = cost + unit * g.count else out.unpriced = out.unpriced + 1 end
  end
  if out.unpriced == 0 then out.cost = cost end
  if recipe.product then out.value, out.source, out.observed = P.market(recipe.product) end
  if not recipe.live then out.marketChange = P.change(recipe.product) end
  if out.cost and out.value and (not recipe.live or out.output) then
    local _, _, profit = saleEstimate(out, 1)
    out.profit = profit
  end
  return out
end

-- Profit first, highest first; then the recipes whose product has no price, then those whose cost is unknown.
local function rankOf(r) return r.profit and 1 or (r.cost and 2 or 3) end
local function byProfit(a, b)
  local ra, rb = rankOf(a), rankOf(b)
  if ra ~= rb then return ra < rb end
  if a.profit and a.profit ~= b.profit then return a.profit > b.profit end
  if a.name ~= b.name then return a.name < b.name end
  return a.key < b.key
end
local function byName(a, b)
  if a.name ~= b.name then return a.name < b.name end
  return a.key < b.key
end

-- The recorded recipes of the character's professions (every profession when the client has no profession book).
-- Recipe rows carry no character, so these are every recipe this install recorded under those profession names, by
-- any of its characters.
local function craftRows(P)
  indexRows()
  local book = U.Professions()
  local mine
  if book then
    mine = {}
    for _, prof in ipairs(book) do mine[prof.name] = true end
  end
  local rows = {}
  for _, recipe in pairs(index.recipes) do
    if not mine or mine[recipe.profession] then rows[#rows + 1] = evaluate(recipe, P) end
  end
  return rows
end

local function plural(n, word) return n .. " " .. word .. (n == 1 and "" or "s") end

-- Where the market values come from and how old they are: a short line that fits beside the buttons, the colour to
-- say it in, and the full sentence for its hover.
local function ageLine(realm)
  if type(EverlootPricesDB) ~= "table" or not realm or not E.PriceFile then
    return "No price file: vendor prices only", COLORS.muted, NO_FILE
  end
  local file = E:PriceFile(realm)
  if file.status == "verifying" then return CHECKING, COLORS.muted, CHECKING end
  if file.status == "bad" then
    if file.silent then return "No market values for this realm", COLORS.muted, NO_REALM end
    return "Price file failed its check", WARN, FAILED
  end
  local today, built = E.DayNumber(date("!%Y-%m-%d")), E.DayNumber(file.asOf or "")
  if not today or not built then
    return "Price file date unknown", WARN, "Market values from the price file; when it was built is unknown."
  end
  local days = today - built
  local day = file.asOf:sub(1, 10)
  local age = days <= 0 and "today" or (plural(days, "day") .. " ago")
  if days > E.STALE_DAYS then
    return "Old price file: " .. day .. " (" .. age .. ")", WARN, "OLD FILE: market values from " .. day .. " (" .. age
      .. "). The Everloot Desktop App refreshes it, then /reload."
  end
  return file.house .. " AH prices, " .. day .. " (" .. age .. ")", COLORS.muted, "Market values from the price file built "
    .. day .. " (" .. age .. "), " .. file.house .. " auction house; a vendor price when it is lower."
end

-- The native window prices the current schematic directly. It does not depend on a saved recipe observation.
function U.NativeCraftEstimate(recipe)
  indexRows()
  local realm = E.CurrentRealm()
  local house = E:MarketHouse()
  local own = house and E.OwnScan and E:OwnScan(realm, house)
  local age = own and type(own.at) == "number" and time() - own.at
  if not age or age < 0 or age > 86400 or own.house ~= house or not own.items then own = nil end
  local row = evaluate(recipe, pricer(realm, own))
  local status, _, detail = ageLine(realm)
  local oldFile = status:find("^Old price file")
  row.oldQuote = E.StaleDay(row.observed) or (oldFile and row.source == "community")
  for _, part in ipairs(row.parts) do
    row.oldQuote = row.oldQuote or E.StaleDay(part.observed) or (oldFile and part.source == "community")
  end
  if own then
    row.listing = own.items[recipe.product]
    row.scanInfo = "Your " .. house .. " scan: " .. (age < 60 and "just now"
      or (age < 3600 and (math.floor(age / 60) .. " min ago") or (math.floor(age / 3600) .. " h ago")))
    detail = "Community fallback: " .. detail
  end
  return row, detail, status == CHECKING
end

-- The hover on the source line and the note: where the prices come from and how to read the columns.
local function explain(owner, c)
  if not GameTooltip then return end
  GameTooltip:SetOwner(owner, "ANCHOR_BOTTOM")
  GameTooltip:AddLine(TO_CRAFTING)
  for _, said in ipairs({ c.ageDetail or "", HELP_PROFIT, HELP_COLOUR, HELP_SCANS }) do
    GameTooltip:AddLine(said, COLORS.text[1], COLORS.text[2], COLORS.text[3], true)
  end
  GameTooltip:Show()
end

local function buyLine(part, count)
  local need = part.count * count
  local s = need .. " × " .. part.item
  if not part.unit then return s .. (part.ambiguous and " · unpriced (ambiguous name)" or " · no price") end
  return s .. " · " .. U.Money(part.unit) .. " each" .. (part.vendor and " (vendor)" or "") .. " · "
    .. U.Money(part.unit * need)
end

-- The reagents for `count` crafts of one recipe, a page at a time, and their total; a reagent without a price is
-- said, never a zero. Another recipe starts at its first page.
local function drawBuy(c, row)
  local b = c.buy
  if not row then
    b.title:SetText("What to buy")
    for _, line in ipairs(b.lines) do line:Hide() end
    b.up:Hide(); b.down:Hide(); b.add:Hide(); b.details:Hide()
    b.count:Hide(); b.receipt:Hide()
    for _, step in ipairs(b.steps) do step:Hide() end
    b.output:Hide(); b.math:Hide()
    b.total:SetText("Choose a recipe in the list.")
    return
  end
  if E.Shopping then b.add:Show() else b.add:Hide() end
  b.count:SetText(plural(c.count, "craft"))
  b.count:Show(); b.details:Show(); b.receipt:Show()
  for _, step in ipairs(b.steps) do step:Show() end
  b.receipt:SetText(c.added or "")
  b.row = row
  b.title:SetText("What to buy: " .. c.count .. " × " .. row.name)
  if row.key ~= b.key then b.key = row.key; b.offset = 0; b.showDetails = false end
  b.details:SetText(b.showDetails and "Reagents" or "Cost details")
  local n = #row.parts
  b.offset = math.min(b.offset, math.floor(math.max(n - 1, 0) / BUY_LINES) * BUY_LINES)
  for i, line in ipairs(b.lines) do
    local part = row.parts[b.offset + i]
    if part and not b.showDetails then line:SetText(buyLine(part, c.count)); line:Show() else line:Hide() end
  end
  if not b.showDetails and b.offset > 0 then b.up:Show() else b.up:Hide() end
  if not b.showDetails and b.offset + BUY_LINES < n then b.down:Show() else b.down:Hide() end
  local priced = 0
  for _, part in ipairs(row.parts) do
    if part.unit then priced = priced + part.unit * part.count * c.count end
  end
  if row.unpriced == 0 then
    b.total:SetText("Total: " .. U.Money(priced))
  else
    b.total:SetText("Total unknown: " .. plural(row.unpriced, "reagent") .. " unpriced"
      .. (row.unpriced < #row.parts and (" · the priced ones " .. U.Money(priced)) or ""))
  end
  local output = row.output
  if output then
    local amount = output.minimum == output.maximum and plural(output.minimum, "item")
      or (output.minimum .. "-" .. output.maximum .. " items")
    b.output:SetText("Makes " .. amount .. " per craft"
      .. (row.cost and (" · " .. U.Money(math.floor(row.cost / row.yield)) .. " materials per item"
        .. (output.minimum ~= output.maximum and " (avg.)" or "")) or ""))
  else
    b.output:SetText("Output unknown · sale estimate assumes 1 item per craft")
  end
  local calculation
  if row.profit then
    local sale, cut, profit = saleEstimate(row, c.count)
    calculation = "Sale: " .. U.Money(sale) .. " - " .. row.cut .. "% AH cut: " .. U.Money(cut)
      .. " - materials: " .. U.Money(priced) .. " = " .. U.Money(profit) .. " profit"
  elseif not row.cost and not row.value then
    calculation = "Profit unknown: missing material prices and sale estimate."
  elseif not row.cost then
    calculation = "Profit unknown: missing material prices."
  else
    calculation = "Profit unknown: no market price for the finished item."
  end
  b.math:SetText(calculation)
  if b.showDetails then b.output:Show(); b.math:Show() else b.output:Hide(); b.math:Hide() end
end

local function drawCraftRow(line, row, selected)
  if selected then line.selection:Show() else line.selection:Hide() end
  line.name:SetText(row.name)
  line.name:SetTextColor(unpack(selected and COLORS.accent or COLORS.text))
  -- An unknown cost says in its own column how many reagents have no price; the product's value still shows.
  line.cost:SetText(row.cost and U.MoneyShort(row.cost) or (row.unpriced .. " unpriced"))
  line.cost:SetTextColor(unpack(row.cost and COLORS.text or COLORS.muted))
  line.value:SetText(row.value and U.MoneyShort(row.value) or "no price")
  line.value:SetTextColor(unpack(row.value and COLORS.text or COLORS.muted))
  -- Profit per craft: a gain signed and green, a loss red, none muted.
  local profit = row.profit
  line.profit:SetText(profit and ((profit > 0 and "+" or "") .. U.MoneyShort(profit)) or "-")
  line.profit:SetTextColor(unpack(not profit and COLORS.muted or (profit > 0 and COLORS.accent) or (profit < 0 and WARN) or COLORS.text))
  -- Your scans: the product's lowest buyout change since the previous scan of this house, in figures the font draws.
  -- A change that rounds to 0% is "0%", muted, not a coloured "+0%".
  local change = row.marketChange
  local direction = change.change and math.floor(change.change + 0.5)
  local color = direction and direction > 0 and COLORS.accent or (direction and direction < 0 and COLORS.gold or COLORS.muted)
  line.change:SetText(direction and (direction == 0 and "0%" or string.format("%+d%%", direction)) or "")
  line.change:SetTextColor(unpack(color))
  local max = 0
  for _, price in ipairs(change.bars) do if price then max = math.max(max, price) end end
  for i, bar in ipairs(line.bars) do
    local price = change.bars[i]
    if price and price > 0 and max > 0 then
      bar:SetSize(5, math.max(1, 12 * price / max))
      bar:SetVertexColor(unpack(color))
      bar:Show()
    else bar:Hide() end
  end
end

local function refreshCrafting(c)
  local realm = E.CurrentRealm()
  local all = craftRows(pricer(realm))
  local age, color, detail = ageLine(realm)
  c.age:SetText(age)
  c.age:SetTextColor(unpack(color))
  c.ageDetail = detail
  if age == CHECKING and not c.waiting and C_Timer and C_Timer.After then
    -- A large file is checked a slice per frame; draw again once it can be read.
    c.waiting = true
    C_Timer.After(0.5, function()
      c.waiting = false
      if c.page:IsShown() then redraw() end
    end)
  end
  local rows = all
  if c.profitable then
    rows = {}
    for _, r in ipairs(all) do if r.profit and r.profit > 0 then rows[#rows + 1] = r end end
  end
  table.sort(rows, c.sort == "name" and byName or byProfit)
  c.sortButton:SetText(c.sort == "name" and "Sort: name" or SORT_PROFIT)
  c.filterButton:SetText(c.profitable and "Show all" or PROFITABLE)

  -- The chosen recipe stays chosen while it is filtered out of the list; without one, the first row is.
  local selected
  for _, r in ipairs(all) do if r.key == c.selected then selected = r end end
  if not selected then selected = rows[1]; c.selected = selected and selected.key or nil end

  local list = c.rows
  list.offset = math.min(list.offset, math.floor(math.max(#rows - 1, 0) / CRAFT_ROWS) * CRAFT_ROWS)
  for i, line in ipairs(list) do
    local row = rows[list.offset + i]
    line.row = row
    if row then drawCraftRow(line, row, row.key == c.selected); line:Show() else line:Hide() end
  end
  list.empty:SetText(#all == 0 and NO_RECIPES or NONE_PROFITABLE)
  if #rows == 0 then list.empty:Show() else list.empty:Hide() end
  if list.offset > 0 then list.up:Show() else list.up:Hide() end
  if list.offset + CRAFT_ROWS < #rows then list.down:Show() else list.down:Hide() end
  drawBuy(c, selected)
end

function refresh(f)
  local p = f.professions
  local go = GO[p.mode]
  p.nav:SetText(SCREENS[go[1]])
  p.toggle:SetText(SCREENS[go[2]])
  for _, block in ipairs(p.blocks) do block:Hide() end
  p.empty:Hide(); p.others:Hide()
  for _, line in ipairs(p.other) do line:Hide() end
  p.craft.page:Hide(); p.trainers.page:Hide()
  if p.mode == "crafting" then
    p.craft.page:Show()
    refreshCrafting(p.craft)
    return
  end
  local list = U.Professions()
  local empty = list == nil and NO_BOOK or (#list == 0 and NONE_LEARNED) or nil
  if empty then p.empty:SetText(empty); p.empty:Show() end
  if p.mode == "trainers" then
    p.trainers.page:Show()
    refreshTrainers(p.trainers, list or {})
    return
  end
  local names = trainerNames()
  local y = 0
  for i, block in ipairs(p.blocks) do
    local prof = list and list[i]
    if prof then
      block:SetPoint("TOPLEFT", 0, -y)
      y = y + draw(block, prof, names) + GAP
      block:Show()
    end
  end
  drawOthers(p, empty and 32 or y + 4)
end

local function button(parent, label, w, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(w, 20)
  b:SetText(label)
  b:SetScript("OnClick", function() onClick(); redraw() end)
  return b
end

local function box(parent, x, y, w, h)
  local b = CreateFrame("Frame", nil, parent)
  b:SetPoint("TOPLEFT", x, y)
  b:SetSize(w, h)
  return surface(b)
end

-- Recipe 4..200, cost 206..296, value 302..392, profit 398..502, your scans from 510 (the change, then three bars);
-- the amounts are set to the right of their columns. Row positions; the headings sit 4 further right, as the rows do.
local CRAFT_COLUMNS = { { "name", 4, 196 }, { "cost", 206, 90 }, { "value", 302, 90 }, { "profit", 398, 104 } }
local SCAN_X = 510

-- A frame over a line of text that shows what the page's figures mean while the mouse is on it.
local function helpOver(parent, c, anchor, x, y, w)
  local h = CreateFrame("Frame", nil, parent)
  h:SetPoint(anchor, x, y)
  h:SetSize(w, 18)
  if h.EnableMouse then h:EnableMouse(true) end
  h:SetScript("OnEnter", function(self) explain(self, c) end)
  h:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  return h
end

-- The sort and filter buttons with the price file's source line beside them, the recipe list with what its figures
-- mean under it, and under the list what to buy for the recipe chosen in it, with buttons for the count and, past
-- five reagents, Up and Down for the rest of them.
buildCrafting = function(parent)
  local c = { sort = "profit", profitable = false, count = 1 }
  c.page = CreateFrame("Frame", nil, parent)
  c.page:SetPoint("TOPLEFT", 0, 0)
  c.page:SetSize(W, PAGE_H)
  c.page:Hide()
  c.sortButton = button(c.page, SORT_PROFIT, 150, function()
    c.sort = c.sort == "name" and "profit" or "name"; c.rows.offset = 0
  end)
  c.sortButton:SetPoint("TOPLEFT", 0, -6)
  c.filterButton = button(c.page, PROFITABLE, 150, function() c.profitable = not c.profitable; c.rows.offset = 0 end)
  c.filterButton:SetPoint("TOPLEFT", 154, -6)
  -- The market status has a dedicated full-width line below the controls.
  c.age = text(c.page, 12, nil, COLORS.muted)
  c.age:SetPoint("TOPLEFT", 8, -30)
  c.age:SetWidth(W - 16)
  c.age:SetJustifyH("LEFT")
  if c.age.SetWordWrap then c.age:SetWordWrap(false) end
  c.source = helpOver(c.page, c, "TOPLEFT", 8, -27, W - 16)

  local list = box(c.page, 0, -48, W, 176)
  c.list = list
  c.head = {}
  for _, col in ipairs(CRAFT_COLUMNS) do
    local s = text(list, 12, nil, COLORS.muted)
    s:SetPoint("TOPLEFT", col[2] + 4, -6)
    s:SetWidth(col[3])
    if col[1] ~= "name" then s:SetJustifyH("RIGHT") end
    c.head[col[1]] = s
  end
  c.head.change = text(list, 12, nil, COLORS.muted)
  c.head.change:SetPoint("TOPLEFT", SCAN_X + 4, -6)
  c.head.change:SetWidth(W - SCAN_X - 14)
  c.head.change:SetText("Your scans")
  c.head.name:SetText("Recipe")
  c.head.cost:SetText("Craft cost")
  c.head.value:SetText("Item value")
  c.head.profit:SetText("Profit / craft")
  -- Under the rows, beside Up and Down: what the figures mean, or what Add to shopping list just did.
  c.note = text(list, 12, nil, COLORS.muted)
  c.note:SetPoint("BOTTOMLEFT", 8, 10)
  c.note:SetWidth(W - 16 - 110)
  if c.note.SetWordWrap then c.note:SetWordWrap(false) end
  c.note:SetText(PER_ITEM)
  helpOver(list, c, "BOTTOMLEFT", 8, 7, W - 16 - 110)
  local rows = { offset = 0 }
  for i = 1, CRAFT_ROWS do
    local line = CreateFrame("Button", nil, list)
    line:SetPoint("TOPLEFT", 4, -22 - (i - 1) * CRAFT_ROW_H)
    line:SetSize(W - 8, CRAFT_ROW_H)
    line.selection = line:CreateTexture(nil, "BACKGROUND")
    line.selection:SetAllPoints()
    line.selection:SetColorTexture(0.612, 0.941, 0.227, 0.12)
    line.selection:Hide()
    for _, col in ipairs(CRAFT_COLUMNS) do
      local s = text(line, 12, col[1] ~= "name" and NARROW or nil) -- numbers in the narrow figures, words in Friz
      s:SetPoint("LEFT", col[2], 0)
      s:SetWidth(col[3])
      if s.SetWordWrap then s:SetWordWrap(false) end
      if col[1] ~= "name" then s:SetJustifyH("RIGHT") end
      line[col[1]] = s
    end
    line.change = text(line, 12, NARROW, COLORS.muted)
    line.change:SetPoint("LEFT", SCAN_X, 0)
    line.change:SetWidth(38)
    if line.change.SetWordWrap then line.change:SetWordWrap(false) end
    line.bars = {}
    for j = 1, 3 do
      local bar = line:CreateTexture(nil, "ARTWORK")
      bar:SetTexture("Interface\\Buttons\\WHITE8X8")
      bar:SetPoint("BOTTOMLEFT", SCAN_X + 40 + (j - 1) * 7, 2)
      line.bars[j] = bar
    end
    line:SetScript("OnEnter", function(self)
      if not (GameTooltip and self.row) then return end
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(self.row.name)
      for _, said in ipairs(self.row.marketChange.lines) do GameTooltip:AddLine(said, COLORS.text[1], COLORS.text[2], COLORS.text[3], true) end
      GameTooltip:Show()
    end)
    line:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
    line:SetScript("OnClick", function()
      if line.row then c.selected = line.row.key; c.added = nil; redraw() end
    end)
    rows[i] = line
  end
  rows.empty = text(list, 12, nil, COLORS.muted)
  rows.empty:SetPoint("TOPLEFT", 8, -24)
  rows.empty:SetWidth(W - 16)
  rows.up = button(list, "Up", 48, function() rows.offset = math.max(0, rows.offset - CRAFT_ROWS) end)
  rows.up:SetPoint("BOTTOMRIGHT", -58, 6)
  rows.down = button(list, "Down", 48, function() rows.offset = rows.offset + CRAFT_ROWS end)
  rows.down:SetPoint("BOTTOMRIGHT", -6, 6)
  c.rows = rows

  local buy = box(c.page, 0, -229, W, PAGE_H - 229)
  local b = { lines = {}, steps = {}, offset = 0 }
  b.title = text(buy, 12)
  b.title:SetPoint("TOPLEFT", 8, -9)
  b.title:SetWidth(W - 16 - 118)
  if b.title.SetWordWrap then b.title:SetWordWrap(false) end
  b.count = text(buy, 12, nil, COLORS.muted)
  b.count:SetPoint("TOPRIGHT", -32, -9)
  b.count:SetWidth(64)
  b.count:SetJustifyH("CENTER")
  for i, step in ipairs({ -1, 1 }) do
    local s = button(buy, step > 0 and "+" or "-", 24, function()
      local amount = IsShiftKeyDown and IsShiftKeyDown() and 10 or 1
      c.count = math.max(1, math.min(MAX_COUNT, c.count + step * amount))
      c.added = nil
    end)
    s:SetPoint("TOPRIGHT", i == 1 and -96 or -6, -6)
    b.steps[i] = s
  end
  -- Reagents and expanded cost details share the body. The total and actions have their own rows.
  local spacing = 12
  for i = 1, BUY_LINES do
    local line = text(buy, 12, nil, COLORS.muted)
    line:SetPoint("TOPLEFT", 8, -29 - (i - 1) * spacing)
    line:SetWidth(W - 16 - 110)
    if line.SetWordWrap then line:SetWordWrap(false) end
    b.lines[i] = line
  end
  b.total = text(buy, 12)
  b.total:SetPoint("TOPLEFT", 8, -91)
  b.total:SetWidth(W - 16 - 110)
  b.output = text(buy, 12, nil, COLORS.muted)
  b.output:SetPoint("TOPLEFT", 8, -32)
  b.output:SetWidth(W - 16)
  b.math = text(buy, 12, nil, COLORS.muted)
  b.math:SetPoint("TOPLEFT", 8, -56)
  b.math:SetWidth(W - 16)
  b.details = button(buy, "Cost details", 90, function() b.showDetails = not b.showDetails end)
  b.details:SetPoint("BOTTOMLEFT", 6, 5)
  b.receipt = text(buy, 11, nil, COLORS.accent)
  b.receipt:SetPoint("BOTTOMLEFT", 104, 4)
  b.receipt:SetWidth(W - 328)
  b.receipt:SetJustifyV("BOTTOM")
  b.add = button(buy, ADD_TO_LIST, 214, function()
    if not (E.Shopping and b.row) then return end
    local _, _, _, said = E.Shopping.AddReagents(b.row.parts, c.count)
    c.added = said
  end)
  b.add:SetPoint("BOTTOMRIGHT", -6, 5)
  b.up = button(buy, "Up", 48, function() b.offset = math.max(0, b.offset - BUY_LINES) end)
  b.up:SetPoint("TOPRIGHT", -58, -86)
  b.down = button(buy, "Down", 48, function() b.offset = b.offset + BUY_LINES end)
  b.down:SetPoint("TOPRIGHT", -6, -86)
  c.buy = b
  return c
end

-- The heading row, then a box per profession slot, each with its name and summary and TRAIN_ROWS rows.
local function buildTrainers(parent)
  local t = { head = {}, sections = {} }
  t.page = CreateFrame("Frame", nil, parent)
  t.page:SetPoint("TOPLEFT", 0, 0)
  t.page:SetSize(W, PAGE_H)
  t.page:Hide()
  local HEADINGS = { rank = "Rank", recipe = "Recipe", cost = "Cost", where = "Trainer" }
  for _, col in ipairs(TRAIN_COLUMNS) do
    local s = text(t.page, 12, nil, COLORS.muted)
    s:SetPoint("TOPLEFT", col[2], -4)
    s:SetWidth(col[3])
    if col[1] == "cost" then s:SetJustifyH("RIGHT") end
    s:SetText(HEADINGS[col[1]])
    t.head[col[1]] = s
  end
  for i = 1, BLOCKS do
    local s = CreateFrame("Frame", nil, t.page)
    s:SetPoint("TOPLEFT", 0, -TRAIN_HEAD)
    s:SetSize(W, SECTION_HEAD + ROW_H + 4)
    surface(s)
    s.name = text(s, 14)
    s.name:SetPoint("TOPLEFT", 10, -6)
    s.name:SetWidth(200)
    s.summary = text(s, 12, nil, COLORS.muted)
    s.summary:SetPoint("TOPRIGHT", -10, -8)
    s.summary:SetWidth(W - 230)
    s.summary:SetJustifyH("RIGHT")
    s.rows = {}
    for j = 1, TRAIN_ROWS do
      local line = CreateFrame("Frame", nil, s)
      line:SetPoint("TOPLEFT", 0, -(SECTION_HEAD + (j - 1) * ROW_H))
      line:SetSize(W, ROW_H)
      for _, col in ipairs(TRAIN_COLUMNS) do
        -- Ranks and costs in the narrow figures, words in Friz; the trainer in the muted colour.
        local figures = col[1] == "rank" or col[1] == "cost"
        local cell = text(line, 12, figures and NARROW or nil, col[1] == "where" and COLORS.muted or nil)
        cell:SetPoint("LEFT", col[2], 0)
        cell:SetWidth(col[3])
        if cell.SetWordWrap then cell:SetWordWrap(false) end
        if col[1] == "cost" then cell:SetJustifyH("RIGHT") end
        line[col[1]] = cell
      end
      s.rows[j] = line
    end
    s:Hide()
    t.sections[i] = s
  end
  return t
end

local function build(f, parent)
  local p = { blocks = {} }
  f.professions = p
  for i = 1, BLOCKS do
    local b = CreateFrame("Frame", nil, parent)
    b:SetPoint("TOPLEFT", 0, -(i - 1) * (BLOCK_H + GAP))
    b:SetSize(W, BLOCK_H)
    surface(b)
    b.icon = b:CreateTexture(nil, "ARTWORK")
    b.icon:SetSize(28, 28)
    b.icon:SetPoint("TOPLEFT", 10, -8)
    b.icon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
    b.name = text(b, 14)
    b.name:SetPoint("TOPLEFT", 46, -8)
    b.name:SetWidth(200)
    b.bar = CreateFrame("StatusBar", nil, b)
    b.bar:SetPoint("TOPLEFT", 250, -13)
    b.bar:SetSize(250, 8)
    b.bar:SetStatusBarTexture("Interface\\TargetingFrame\\UI-StatusBar")
    b.bar:SetStatusBarColor(unpack(COLORS.accent))
    local back = b.bar:CreateTexture(nil, "BACKGROUND")
    back:SetAllPoints()
    back:SetColorTexture(0.133, 0.137, 0.114, 1)
    b.rank = text(b, 12, NARROW)
    b.rank:SetPoint("TOPRIGHT", -10, -10)
    b.rank:SetJustifyH("RIGHT")
    b.recipes = text(b, 12, nil, COLORS.muted)
    b.recipes:SetPoint("TOPLEFT", 46, -28)
    b.recipes:SetWidth(W - 236)
    b.last = text(b, 12, nil, COLORS.muted)
    b.last:SetPoint("TOPRIGHT", -10, -28)
    b.last:SetWidth(170)
    b.last:SetJustifyH("RIGHT")
    b.next = text(b, 12, nil, COLORS.muted)
    b.next:SetPoint("TOPLEFT", 46, -HEAD_H)
    b.next:SetWidth(W - 56)
    if b.next.SetWordWrap then b.next:SetWordWrap(false) end
    p.blocks[i] = b
  end
  p.empty = text(parent, 12, nil, COLORS.muted)
  p.empty:SetPoint("TOPLEFT", 8, -12)
  p.empty:SetWidth(W - 16)
  p.others = text(parent, 12)
  p.others:SetPoint("TOPLEFT", 8, -8)
  p.others:SetWidth(W - 16)
  p.others:SetText(OTHERS)
  p.other = {}
  for i = 1, OTHER_ROWS do
    local line = text(parent, 12, nil, COLORS.muted)
    line:SetPoint("TOPLEFT", p.others, "BOTTOMLEFT", 0, -(i - 1) * LINE_H - 2)
    line:SetWidth(W - 16)
    p.other[i] = line
  end
  p.footer = text(parent, 12, nil, COLORS.muted)
  -- At the bottom of the view, under every screen; the two buttons beside it.
  p.footer:SetPoint("BOTTOMLEFT", 8, 8)
  p.footer:SetWidth(W - 2 * NAV_W - 20)
  if p.footer.SetWordWrap then p.footer:SetWordWrap(false) end
  p.footer:SetText(FOOTER)
  -- Beside the footer: the other two screens, named on the buttons (GO).
  p.mode = "list"
  p.nav = button(parent, TO_RANKS, NAV_W, function() p.mode = GO[p.mode][1] end)
  p.nav:SetPoint("BOTTOMRIGHT", -(NAV_W + 4), 2)
  p.toggle = button(parent, TO_CRAFTING, NAV_W, function() p.mode = GO[p.mode][2] end)
  p.toggle:SetPoint("BOTTOMRIGHT", 0, 2)
  p.craft = buildCrafting(parent)
  p.trainers = buildTrainers(parent)
end

U.Views.professions = { build = build, refresh = refresh }

function U.OpenCrafting()
  if not U.Open("professions") then return end
  U.frame.professions.mode = "crafting"
  redraw()
end
