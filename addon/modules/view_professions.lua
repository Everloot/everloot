-- Everloot window, Professions: three screens behind two buttons at the bottom.
--   Professions: each profession in the character's profession book with its rank bar, how many recipes the addon
--     has recorded for it in each difficulty colour (professions.lua writes them, read here through Everloot:Rows),
--     the day they were last read, and one line for the next recipe a trainer teaches. Under the blocks, every other
--     character in the roster (roster.lua) with its professions and ranks.
--   Ranks and trainers: per profession, the recipes a trainer teaches at or above the current rank, lowest first,
--     with the rank, the cost and where: the trainer's name and zone (trainer_seen rows; name and map from the
--     matching npc_sighting row). A row's hover estimates its profit and training payback (U.TrainerLines) when the
--     row has the recipe's spell ID and the client can read that recipe's schematic.
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
  .. "materials. If the output is unknown, the estimate assumes one. Unsold auction deposits are excluded. "
  .. "Sell: vendor values the output at the game's vendor sell price instead, with no cut; an item without one has "
  .. "no vendor profit."
local HELP_COLOUR = "Green profit is a gain, red is a loss. Est. profitable only keeps the green ones."
local HELP_SCANS = "Your scans: how the lowest buyout of what the recipe makes moved between your last two scans of this "
  .. "auction house, with bars for up to three scans. These are listings, not sales; hover a recipe for the numbers."
local NO_FILE = "No price file in the game yet: the Everloot Desktop App writes it, then /reload. Vendor prices you saw still count."
local CHECKING = "Checking the price file..."
local FAILED = "The price file failed its checksum and is not used. Vendor prices you saw still count."
local NO_REALM = "The price file has no market values for this realm yet. Vendor prices you saw still count."
local WARN = { 1, 0.4, 0.4, 1 }  -- the tooltip's warning red (prices.lua)
local ADD_TO_LIST = "Add reagents to shopping list"
local ROUTE_BUY, ROUTE_CHEAPEST = "Route: buy all", "Route: cheapest"

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
-- A row with the recipe's spell ID is that recipe: two recipes with one name stay two rows. A row read before the
-- trainer's identity was readable is left out when a row with a spell ID has its name and rank; it never lends or
-- borrows an ID.
local function spellOf(r) return type(r.spellId) == "number" and r.spellId or nil end
local function trainerRows(name, rank, names)
  local rows, seen, identified, listed = {}, {}, {}, {}
  for _, r in ipairs(E:Rows("trainer_seen")) do
    if type(r) == "table" and r.profession == name and type(r.requiredRank) == "number" and r.requiredRank >= rank
      and type(r.recipe) == "string" then
      listed[#listed + 1] = r
      if spellOf(r) then identified[r.recipe .. "|" .. r.requiredRank] = true end
    end
  end
  for _, r in ipairs(listed) do
    local byName = r.recipe .. "|" .. r.requiredRank
    local key = spellOf(r) and ("spell:" .. spellOf(r) .. "|" .. r.requiredRank) or byName
    if not seen[key] and (spellOf(r) or not identified[byName]) then
      seen[key] = true
      local who = names[r.trainerNpcId]
      rows[#rows + 1] = { rank = r.requiredRank, recipe = r.recipe, cost = r.costCopper,
        trainer = who and who.name, mapId = who and who.mapId, spellId = spellOf(r),
        itemId = type(r.productItemId) == "number" and r.productItemId or nil }
    end
  end
  table.sort(rows, function(a, b)
    if a.rank ~= b.rank then return a.rank < b.rank end
    if a.recipe ~= b.recipe then return a.recipe < b.recipe end
    return (a.spellId or math.huge) < (b.spellId or math.huge)
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
    line.service = r or nil
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

-- A trainer row's hover: its profit and payback from its own recorded spell ID, never another row's.
local function showService(line)
  local r = line.service
  if not (r and GameTooltip) then return end
  GameTooltip:SetOwner(line, "ANCHOR_RIGHT")
  GameTooltip:AddLine((r.recipe:gsub("|", "||")))
  local te, why, checking
  if r.spellId and E.Crafting and E.Crafting.TrainerEstimate then
    local context, _
    context, _, checking = U.CraftContext(E.CurrentRealm(), E:MarketHouse())
    te, why = E.Crafting.TrainerEstimate({ spellId = r.spellId, trainingCostCopper = r.cost, name = r.recipe }, context)
  else
    why = r.itemId and "item" or "no spell ID"
  end
  for _, said in ipairs(U.TrainerLines(te, why, checking)) do
    GameTooltip:AddLine(said, COLORS.text[1], COLORS.text[2], COLORS.text[3], true)
  end
  GameTooltip:Show()
end

local function hideService(line) if GameTooltip and GameTooltip:IsOwned(line) then GameTooltip:Hide() end end

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

-- The recorded recipes of the character's professions (every profession when the client has no profession book).
-- Recipe rows carry no character, so these are every recipe this install recorded under those profession names, by
-- any of its characters.
local function craftRows(realm)
  local context = U.CraftContext(realm, E:MarketHouse())
  local scans
  local book = U.Professions()
  local mine
  if book then
    mine = {}
    for _, prof in ipairs(book) do mine[prof.name] = true end
  end
  local rows = {}
  for _, recipe in pairs(E.Crafting.Recipes()) do
    if not mine or mine[recipe.profession] then
      local row = E.Crafting.Evaluate(recipe, context, 1)
      row.recipe = recipe
      -- Your scans: listing history beside the estimate, never an input to it.
      scans = scans or keptScans(realm)
      row.marketChange = marketChange(recipe.product, scans, recipe.product and context:Community(recipe.product))
      row.valueLine = U.CraftValueLine(row, context)
      rows[#rows + 1] = row
    end
  end
  return rows, context
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

-- One quote policy for the native window and the Crafting costs page: a scan of this house under a day old (and not
-- older than the community day) first, then the community price file, and a vendor price when it is lower. Returns
-- the context, the price file's sentence for a hover and whether the file is still being checked.
function U.CraftContext(realm, house)
  local status, _, detail = ageLine(realm)
  local context = E.Crafting.Context(realm, house, { scan = true, oldFile = status:find("^Old price file") ~= nil,
    destination = E.Options and E.Options.CraftDestination and E.Options.CraftDestination() or "ah" })
  local describe = U.CraftSourceLine(context)
  if describe then detail = describe .. (context.priceSource.fallback and (" Fallback prices: " .. detail) or "")
  elseif context.own then detail = "Community fallback: " .. detail end
  return context, detail, status == CHECKING
end

--- The selected price source in a sentence (CraftingSources.Describe), or nil while it is Everloot's own.
function U.CraftSourceLine(context)
  local CS = E.CraftingSources
  return CS and context and CS.Describe(context.priceSource) or nil
end

--- An external quote's label ("TSM AHDBMedianBuyout, age and market unknown"), or nil for Everloot's own sources.
function U.CraftExternalLabel(source)
  local CS = E.CraftingSources
  return CS and CS.External(source) and CS.QuoteLabel(source) or nil
end

--- Why an Everloot price stands in, before its own source: "Everloot fallback, TSM not loaded".
function U.CraftFallbackNote(priceSource, why)
  local label = priceSource and priceSource.label or "the selected source"
  if why == "no price" then return "Everloot fallback, no " .. label .. " price" end
  return "Everloot fallback, " .. label .. " " .. tostring(why)
end

--- Why the selected source gave no price: "(TSM: not loaded)", or "".
function U.CraftMissingNote(priceSource, why)
  if not (priceSource and why) then return "" end
  return " (" .. tostring(priceSource.label) .. ": " .. tostring(why) .. ")"
end

-- The prices behind a profit, in words: "community prices", "TSM AHDBMedianBuyout, age and market unknown".
local function priceBasis(row)
  local ps, CS = row.priceSource, E.CraftingSources
  local base = row.external and CS and CS.QuoteLabel(ps.name)
    or ((row.source == "scan" and "your scan" or "community") .. " prices")
  if row.usedFallback then
    base = base .. (row.external and ", some Everloot fallback" or (", Everloot fallback for " .. tostring(ps and ps.label)))
  end
  return base
end

--- "Your Alliance scan: 5 min ago" when the context prices from a fresh scan, else nil.
function U.CraftScanInfo(context)
  local own = context.own
  if not own then return nil end
  local age = time() - own.at
  return "Your " .. tostring(context.house) .. " scan: " .. (age < 60 and "just now"
    or (age < 3600 and (math.floor(age / 60) .. " min ago") or (math.floor(age / 3600) .. " h ago")))
end

--- Where a recipe's item value comes from, said with its scope and date: "Item value: 4s each (your Alliance scan)".
function U.CraftValueLine(row, context)
  if not row.value then return "Item value: no price" .. U.CraftMissingNote(row.priceSource, row.missing) end
  local source = U.CraftExternalLabel(row.source) or (row.source == "scan" and ("your " .. tostring(context.house) .. " scan"))
    or ((row.observed and E.ShortDay(row.observed)) and ("community " .. E.ShortDay(row.observed)) or "community")
  if row.fallback then source = U.CraftFallbackNote(row.priceSource, row.fallback) .. ": " .. source end
  return "Item value: " .. U.Money(row.value) .. " each (" .. source .. ")" .. (row.oldQuote and ", old prices" or "")
end

--- One destination's result for `count` crafts, in words: "At the AH: 18s - 5% cut: 90c - materials: 2s = 15s 10c
--- profit" or "To a vendor: ...". A missing figure is said, never a zero.
function U.CraftComparison(row, destination, count)
  count = count or 1
  local vendor = destination == "vendor"
  local label = vendor and "To a vendor: " or "At the AH: "
  if vendor and not row.vendorValue then
    return label .. (row.vendorPending and "the game is still loading the item's sell price."
      or "no verified sell price for the finished item.")
  end
  if not vendor and not row.value then return label .. "no auction price for the finished item." end
  if not row.cost then return label .. "materials unpriced." end
  if not (vendor and row.vendorProfit or (not vendor and row.ahProfit)) then return label .. "recipe yield unavailable." end
  local sale, cut, profit = E.Crafting.Sale(row, count, destination)
  return label .. U.Money(sale) .. (vendor and "" or (" - " .. row.cut .. "% cut: " .. U.Money(cut)))
    .. " - materials: " .. U.Money(row.cost * count) .. " = " .. U.Money(profit) .. " profit for "
    .. count .. (count == 1 and " craft" or " crafts")
end

-- The native window prices the current schematic directly. It does not depend on a saved recipe observation.
function U.NativeCraftEstimate(recipe)
  local context, detail, checking = U.CraftContext(E.CurrentRealm(), E:MarketHouse())
  local row = E.Crafting.Evaluate(recipe, context, 1)
  if context.own then
    row.listing = context.own.items[recipe.product]
    row.scanInfo = U.CraftScanInfo(context)
  end
  -- Tags, sorting and the summary stay on buying every reagent for one craft; the cheapest route is a comparison.
  row.plan = E.Crafting.Plan(recipe, context, 1, { strategy = "cheapest" })
  return row, detail, checking
end

-- Why there is no training payback estimate, after "No payback estimate: ".
local NO_ESTIMATE = {
  ["no spell ID"] = "the trainer gave no recipe spell ID for it",
  ["no identity"] = "the trainer gave no recipe spell ID for it",
  item = "the trainer named an item, not the recipe's spell",
  conflict = "the trainer's recipe IDs disagree",
  ["no schematic"] = "the game shows its materials only with your profession window open: open it too",
  ["other recipe"] = "the game answered with another recipe's materials",
  ["no materials"] = "the game has not provided the recipe's material costs",
}

--- A trainer recipe's profit and training payback in lines, for the trainer window's hover and the Ranks and trainers
--- page: TrainerEstimate's result (te, why), or nil and why. The profit says its count (per craft), destination, cut
--- and price source; the payback appears only for a complete positive profit.
function U.TrainerLines(te, why, checking)
  if not te then return { "No payback estimate: " .. (NO_ESTIMATE[why] or "recipe unknown") .. "." } end
  if checking then return { "No payback estimate yet: " .. CHECKING } end
  local row, lines = te.row, {}
  if te.profit then
    local basis = row.destination == "vendor" and ("sold to a vendor at the game's sell price"
      .. ((row.external or row.usedFallback) and (", materials at " .. priceBasis(row)) or ""))
      or ("sold at the AH after its " .. row.cut .. "% cut, " .. priceBasis(row))
    lines[1] = "Est. profit per craft: " .. (te.profit > 0 and "+" or "") .. U.Money(te.profit) .. " (" .. basis
      .. (row.oldQuote and ", old prices" or "") .. ")"
  else
    lines[1] = U.CraftComparison(row, row.destination)
  end
  if te.payback == 0 then lines[#lines + 1] = "Nothing to repay: training is free."
  elseif te.payback then
    lines[#lines + 1] = "Repays " .. U.Money(te.trainingCost) .. " training after " .. plural(te.payback, "profitable craft")
  elseif te.why == "loss" then lines[#lines + 1] = "No payback: each craft loses " .. U.Money(-te.profit) .. "."
  elseif te.why == "zero" then lines[#lines + 1] = "No payback: a craft only breaks even."
  elseif te.why == "no cost" then lines[#lines + 1] = "No payback estimate: training cost unknown."
  else lines[#lines + 1] = "No payback estimate: prices incomplete." end
  return lines
end

-- Why a plan did not use some of the character's recipes, and where the search stopped, in words.
local EXCLUDED = { capacity = "no cooldown evidence", cooldown = "cooldown not ready now",
  ["not learned"] = "not learned", reagents = "reagents unknown", output = "output unknown", unknown = "recipe unknown",
  cycle = "recipe loops back to its own product" }
local LIMITED = { depth = "chain deeper than 12 steps", recipes = "over 500 recipes compared",
  passes = "search stopped early", purchases = "over 50 items: some not listed" }

--- One short line about a cheapest-route plan's exclusions, limits and leftovers, or "".
function U.PlanNote(plan)
  local said, seen, names = {}, {}, {}
  for _, d in ipairs(plan.decisions) do names[d.itemId] = d.item end
  local left = {}
  for id, n in pairs(plan.leftovers) do left[#left + 1] = n .. " × " .. (names[id] or ("Item " .. id)) end
  table.sort(left)
  if #left > 0 then said[#said + 1] = "Left over: " .. table.concat(left, ", ") end
  local reasons = {}
  for _, x in ipairs(plan.exclusions) do
    local why = EXCLUDED[x.reason]
    if why and x.detail then why = why .. " (" .. x.detail .. ")" end
    if why and not seen[why] then seen[why] = true; reasons[#reasons + 1] = why end
  end
  if #reasons > 0 then said[#said + 1] = "Recipes not used: " .. table.concat(reasons, ", ") end
  -- Build-scoped evidence, said as such: never "unlimited".
  if plan.basis then said[#said + 1] = "Assumes: " .. plan.basis:sub(1, 1):lower() .. plan.basis:sub(2) end
  for _, l in ipairs(plan.limits) do
    if LIMITED[l.kind] then said[#said + 1] = "Best found, not proven best: " .. LIMITED[l.kind]
    elseif l.kind == "cooldown" then
      said[#said + 1] = "Cooldown allows " .. l.capacity .. " now" .. (l.detail and (" (" .. l.detail .. ")") or "")
    end
  end
  return table.concat(said, " · ")
end

--- The cheapest route for a plan in one line: "Cheapest route: 40c (buying all: 60c), make Wolf Meat: 1 craft".
function U.PlanSummary(plan)
  if not plan then return nil end
  if not plan.cost then
    return "Cheapest route: unknown" .. (#plan.unpriced > 0 and (" (" .. plural(#plan.unpriced, "item") .. " unpriced)") or "")
  end
  local made = {}
  for i = #plan.decisions, 1, -1 do
    local d = plan.decisions[i]
    if d.crafts > 0 then made[#made + 1] = d.item .. ": " .. plural(d.crafts, "craft") end
  end
  if #made == 0 then return "Cheapest route: buy every reagent (" .. U.Money(plan.cost) .. ")" end
  return "Cheapest route: " .. U.Money(plan.cost) .. (plan.buyCost and (" (buying all: " .. U.Money(plan.buyCost) .. ")") or "")
    .. ", make " .. table.concat(made, ", ")
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

local function buyLine(part, count, priceSource)
  local need = part.count * count
  local s = need .. " × " .. part.item
  if not part.unit then
    return s .. (part.ambiguous and " · unpriced (ambiguous name)" or (" · no price" .. U.CraftMissingNote(priceSource, part.missing)))
  end
  -- An external price names its addon; an Everloot price standing in for it says so (the line above says the rest).
  local CS = E.CraftingSources
  local from = part.vendor and " (vendor)" or (CS and CS.External(part.source) and (" (" .. CS.Label(part.source) .. ")"))
    or (part.fallback and " (Everloot fallback)") or ""
  return s .. " · " .. U.Money(part.unit) .. " each" .. from .. " · " .. U.Money(part.unit * need)
end

local function incomplete(plan)
  if #plan.unpriced > 0 then return plural(#plan.unpriced, "item") .. " unpriced" end
  if #plan.omitted > 0 then return plural(#plan.omitted, "item") .. " over the 50-item limit" end
  for _, l in ipairs(plan.limits) do
    if l.kind == "cooldown" then
      return "the recipe's cooldown allows " .. l.capacity .. " now" .. (l.detail and (": " .. l.detail) or "")
    end
  end
  if plan.cost == nil then return "the recipe's reagents are not all known" end
  return "the route is not complete"
end

local function planLines(plan)
  local lines = {}
  for i = #plan.decisions, 1, -1 do
    local d = plan.decisions[i]
    if d.crafts > 0 then
      lines[#lines + 1] = "Make " .. d.made .. " × " .. d.item .. ": " .. plural(d.crafts, "craft")
        .. (d.bought > 0 and (", buy " .. d.bought .. " more") or "")
    end
  end
  for _, p in ipairs(plan.purchases) do
    local s = p.count .. " × " .. p.item
    lines[#lines + 1] = p.unit and (s .. " · " .. U.Money(p.unit) .. " each" .. (p.vendor and " (vendor)" or "") .. " · "
      .. U.Money(p.unit * p.count)) or (s .. " · no price")
  end
  for _, p in ipairs(plan.omitted) do lines[#lines + 1] = p.count .. " × " .. p.item .. " · not listed (over 50 items)" end
  return lines
end

-- The selected count on the cheapest route: the make-and-buy list, its total beside buying everything, and the profit
-- for that many crafts with the route's material cost.
local function drawPlan(c, row, plan)
  local b = c.buy
  local lines = planLines(plan)
  local n = #lines
  b.offset = math.min(b.offset, math.floor(math.max(n - 1, 0) / BUY_LINES) * BUY_LINES)
  for i, line in ipairs(b.lines) do
    local s = lines[b.offset + i]
    if s and not b.showDetails then line:SetText(s); line:Show() else line:Hide() end
  end
  if not b.showDetails and b.offset > 0 then b.up:Show() else b.up:Hide() end
  if not b.showDetails and b.offset + BUY_LINES < n then b.down:Show() else b.down:Hide() end
  if plan.cost then
    b.total:SetText("Total: " .. U.Money(plan.cost)
      .. ((plan.buyCost and plan.buyCost ~= plan.cost) and (" · buying all: " .. U.Money(plan.buyCost)) or ""))
  elseif #plan.unpriced > 0 then
    b.total:SetText("Total unknown: " .. plural(#plan.unpriced, "item") .. " unpriced")
  else
    b.total:SetText("Total unknown: the recipe's reagents are not all known")
  end
  local vendor = row.destination == "vendor"
  local sale, cut, profit = E.Crafting.PlanSale(row, c.count, plan.cost)
  local calculation
  if profit then
    calculation = (vendor and ("Vendor sale: " .. U.Money(sale))
      or ("Sale: " .. U.Money(sale) .. " - " .. row.cut .. "% AH cut: " .. U.Money(cut)))
      .. " - materials: " .. U.Money(plan.cost) .. " = " .. U.Money(profit) .. " profit for " .. plural(c.count, "craft")
  elseif not plan.cost then
    calculation = "Profit unknown: missing material prices."
  elseif vendor and row.vendorPending then
    calculation = "Profit unknown: the game is still loading the item's vendor sell price."
  elseif vendor then
    calculation = "Profit unknown: no verified vendor sell price for the finished item."
  elseif row.value then
    calculation = "Profit unknown: recipe yield unavailable."
  else
    calculation = "Profit unknown: no market price for the finished item."
  end
  b.math:SetText(calculation)
  local note = U.PlanNote(plan)
  b.alt:SetText(note ~= "" and note or "Cheapest route found by comparing buying with your own recipes.")
  if b.showDetails then b.output:Show(); b.math:Show(); b.alt:Show() else b.output:Hide(); b.math:Hide(); b.alt:Hide() end
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
    b.output:Hide(); b.math:Hide(); b.alt:Hide(); b.route:Hide()
    b.total:SetText("Choose a recipe in the list.")
    b.plan = nil
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
  -- Buy every reagent, or the cheapest route with this character's own recipes, for the selected count.
  if E.CraftingPlan and row.recipe then b.route:Show() else b.route:Hide() end
  b.route:SetText(c.strategy == "cheapest" and ROUTE_CHEAPEST or ROUTE_BUY)
  local plan = c.strategy == "cheapest" and E.CraftingPlan and row.recipe and c.context
    and E.Crafting.Plan(row.recipe, c.context, c.count, { strategy = "cheapest" }) or nil
  b.plan = plan
  local output = row.output
  if output then
    local amount = output.minimum == output.maximum and plural(output.minimum, "item")
      or (output.minimum .. "-" .. output.maximum .. " items")
    b.output:SetText("Makes " .. amount .. " per craft"
      .. (row.cost and (" · " .. U.Money(math.floor(row.cost / row.yield)) .. " materials per item"
        .. (output.minimum ~= output.maximum and " (avg.)" or "")) or ""))
  else
    b.output:SetText("Output unknown · no sale estimate until the profession window shows what it makes")
  end
  if plan then return drawPlan(c, row, plan) end
  local n = #row.parts
  b.offset = math.min(b.offset, math.floor(math.max(n - 1, 0) / BUY_LINES) * BUY_LINES)
  for i, line in ipairs(b.lines) do
    local part = row.parts[b.offset + i]
    if part and not b.showDetails then line:SetText(buyLine(part, c.count, row.priceSource)); line:Show() else line:Hide() end
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
  -- The selected destination's calculation, then the other one for comparison.
  local vendor = row.destination == "vendor"
  local calculation
  if row.profit then
    local sale, cut, profit = E.Crafting.Sale(row, c.count)
    calculation = (vendor and ("Vendor sale: " .. U.Money(sale))
      or ("Sale: " .. U.Money(sale) .. " - " .. row.cut .. "% AH cut: " .. U.Money(cut)))
      .. " - materials: " .. U.Money(priced) .. " = " .. U.Money(profit) .. " profit"
  elseif not row.cost and not (vendor and row.vendorValue or (not vendor and row.value)) then
    calculation = "Profit unknown: missing material prices and sale estimate."
  elseif not row.cost then
    calculation = "Profit unknown: missing material prices."
  elseif row.yieldUnknown then
    calculation = "Profit unknown: recipe yield unavailable."
  elseif vendor and row.vendorPending then
    calculation = "Profit unknown: the game is still loading the item's vendor sell price."
  elseif vendor then
    calculation = "Profit unknown: no verified vendor sell price for the finished item."
  else
    calculation = "Profit unknown: no market price for the finished item."
  end
  b.math:SetText(calculation)
  b.alt:SetText(U.CraftComparison(row, vendor and "ah" or "vendor", c.count))
  if b.showDetails then b.output:Show(); b.math:Show(); b.alt:Show() else b.output:Hide(); b.math:Hide(); b.alt:Hide() end
end

local function drawCraftRow(line, row, selected)
  if selected then line.selection:Show() else line.selection:Hide() end
  line.name:SetText(row.name)
  line.name:SetTextColor(unpack(selected and COLORS.accent or COLORS.text))
  -- An unknown cost says in its own column how many reagents have no price; the product's value still shows.
  line.cost:SetText(row.cost and U.MoneyShort(row.cost) or (row.unpriced .. " unpriced"))
  line.cost:SetTextColor(unpack(row.cost and COLORS.text or COLORS.muted))
  -- The value at the selected destination: the auction value, or the vendor's sell price.
  local value = row.destination == "vendor" and row.vendorValue or (row.destination ~= "vendor" and row.value)
  line.value:SetText(value and U.MoneyShort(value) or (row.destination == "vendor" and row.vendorPending and "checking" or "no price"))
  line.value:SetTextColor(unpack(value and COLORS.text or COLORS.muted))
  -- Profit per craft: a gain signed and green, a loss red, none muted.
  local profit = row.profit
  line.profit:SetText(profit and ((profit > 0 and "+" or "") .. U.MoneyShort(profit) .. (row.oldQuote and " old" or "")) or "-")
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
  local all, context = craftRows(realm)
  local age, color, detail = ageLine(realm)
  local checking = age == CHECKING
  -- Another addon's prices: said first, with their unknown age and market; the price file stays the fallback's.
  local CS = E.CraftingSources
  local short = CS and CS.Short(context.priceSource)
  local scanInfo = not short and U.CraftScanInfo(context)
  if short then age = "Prices: " .. short .. " · " .. age
  elseif scanInfo then age = scanInfo .. " · " .. age end
  c.age:SetText(age)
  c.age:SetTextColor(unpack(short and WARN or color))
  local describe = U.CraftSourceLine(context)
  c.ageDetail = describe and (describe .. " " .. detail) or detail
  if c.sourceButton and E.Options and E.Options.CraftSourceText then c.sourceButton:SetText(E.Options.CraftSourceText()) end
  local pending = checking
  for _, row in ipairs(all) do if row.vendorPending then pending = true; break end end
  if not pending then c.waitTries = 0 end
  if pending and not c.waiting and C_Timer and C_Timer.After then
    -- Price-file checks and delayed client sell prices finish without another click.
    c.waiting = true
    c.waitTries = (c.waitTries or 0) + 1
    C_Timer.After(c.waitTries > 40 and 2 or 0.5, function()
      c.waiting = false
      U.RefreshCrafting()
    end)
  end
  local rows = E.Crafting.Rank(all, { sort = c.sort, profitableOnly = c.profitable })
  c.sortButton:SetText(c.sort == "name" and "Sort: name" or SORT_PROFIT)
  c.filterButton:SetText(c.profitable and "Show all" or PROFITABLE)
  local vendor = context.destination == "vendor"
  c.destButton:SetText(vendor and "Sell: vendor" or "Sell: AH")
  c.head.value:SetText(vendor and "Vendor price" or "Item value")

  -- The chosen recipe stays chosen while it is filtered out of the list; without one, the first row is.
  local selected
  for _, r in ipairs(all) do if r.key == c.selected then selected = r end end
  if not selected then selected = rows[1]; c.selected = selected and selected.key or nil end

  c.context = context
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
  local c = { sort = "profit", profitable = false, count = 1, strategy = "buy" }
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
  -- Where the crafted item is sold: the auction house (after its cut) or a vendor (the game's sell price).
  c.destButton = button(c.page, "Sell: AH", 120, function()
    if E.Options and E.Options.SetCraftDestination then
      E.Options.SetCraftDestination(E.Options.CraftDestination() == "vendor" and "ah" or "vendor")
    end
    c.rows.offset = 0
  end)
  c.destButton:SetPoint("TOPLEFT", 308, -6)
  -- Where auction prices come from: Everloot, or another addon's documented price, optionally with Everloot's as a
  -- marked fallback. Saved as that choice only; it starts no scan.
  c.sourceButton = button(c.page, "Prices: Everloot", 168, function()
    if E.Options and E.Options.NextCraftSource then E.Options.NextCraftSource() end
    c.rows.offset = 0
  end)
  c.sourceButton:SetPoint("TOPLEFT", 432, -6)
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
      GameTooltip:AddLine(self.row.valueLine, COLORS.text[1], COLORS.text[2], COLORS.text[3], true)
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
  b.alt = text(buy, 12, nil, COLORS.muted)
  b.alt:SetPoint("TOPLEFT", 8, -70)
  b.alt:SetWidth(W - 16)
  b.details = button(buy, "Cost details", 90, function() b.showDetails = not b.showDetails end)
  b.details:SetPoint("BOTTOMLEFT", 6, 5)
  b.route = button(buy, ROUTE_BUY, 120, function()
    c.strategy = c.strategy == "cheapest" and "buy" or "cheapest"
    b.offset, c.added = 0, nil
  end)
  b.route:SetPoint("BOTTOMLEFT", 100, 5)
  -- What the cheapest route assumes about cooldowns, and what the client files could not show.
  b.route:SetScript("OnEnter", function(self)
    if not GameTooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine(ROUTE_CHEAPEST)
    GameTooltip:AddLine("Compares buying each reagent with crafting it from this character's own recipes.", 1, 1, 1, true)
    local ev = E.Crafting.CooldownEvidence and E.Crafting.CooldownEvidence()
    if ev and ev.status == "match" then
      GameTooltip:AddLine(ev.basis .. ". " .. ev.disclosure, 1, 1, 1, true)
    elseif ev then
      GameTooltip:AddLine("Recipes are used only with cooldown evidence: " .. (ev.status == "mismatch"
        and ("the cooldown data is for build " .. tostring(ev.build) .. ", the game is " .. tostring(ev.running))
        or ev.status) .. ".", 1, 1, 1, true)
    end
    GameTooltip:AddLine("Cooldown recipes count only while their profession window is open and ready.", 1, 1, 1, true)
    GameTooltip:Show()
  end)
  b.route:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  b.receipt = text(buy, 11, nil, COLORS.accent)
  b.receipt:SetPoint("BOTTOMLEFT", 226, 4)
  b.receipt:SetWidth(W - 450)
  b.receipt:SetJustifyV("BOTTOM")
  b.add = button(buy, ADD_TO_LIST, 214, function()
    if not (E.Shopping and b.row) then return end
    -- The cheapest route adds what it buys, already for every craft; buying all adds the reagents per craft.
    local plan = b.plan
    local parts, crafts = b.row.parts, c.count
    -- An incomplete route is not added: a partial list would look like everything needed.
    if plan and not plan.complete then
      c.added = "Not added: this route is incomplete (" .. incomplete(plan) .. ")."
      return
    end
    if plan then
      parts, crafts = {}, 1
      for _, p in ipairs(plan.purchases) do parts[#parts + 1] = { id = p.id, item = p.item, count = p.count } end
    end
    local _, _, _, said = E.Shopping.AddReagents(parts, crafts)
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
      if line.EnableMouse then line:EnableMouse(true) end
      line:SetScript("OnEnter", showService)
      line:SetScript("OnLeave", hideService)
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

function U.RefreshCrafting()
  local frame = U.frame
  local professions = frame and frame.professions
  if frame and U.view == "professions" and frame:IsShown() and professions and professions.mode == "crafting" then redraw() end
end

function U.OpenCrafting()
  if not U.Open("professions") then return end
  U.frame.professions.mode = "crafting"
  redraw()
end
