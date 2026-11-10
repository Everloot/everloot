-- Everloot window, Professions: each profession in the character's profession book with its rank bar, how many recipes
-- the addon has recorded for it by difficulty colour (professions.lua writes them, read here through Everloot:Rows),
-- the day they were last read, and the next recipes a trainer teaches at or above the current rank, with the cost and
-- the trainer's name (trainer_seen rows, the name from the matching npc_sighting row). Under the blocks, every other
-- character in the roster (roster.lua) with its professions and ranks. A button at the bottom swaps the blocks for
-- the crafting costs: each recorded recipe of the character's professions with its reagents' cost, its product's
-- market value and an estimated profit, and what to buy for a chosen recipe and count. Display only: it registers no events and
-- records nothing; the window builds it the first time Professions is opened.

local E = Everloot
if not (E.Window and E.Window.Views) then return end
local U = E.Window
local COLORS, NARROW, text, surface = U.COLORS, U.NARROW, U.Text, U.Surface

local W, H = 604, 390  -- the view frame window.lua gives every view (W - MAIN - 12 wide, H - 60 tall)
local BLOCKS, GAP = 5, 4           -- the profession book has five slots
local HEAD_H, LINE_H = 44, 13      -- a block: the name, bar and recipe line, then one line per trainer recipe
local TRAINER_LINES = 3            -- per block; two when four or five professions must share the view
local OTHER_ROWS = 6               -- the most characters the list under the blocks holds
local FOOTER_H = 24
local BUCKETS = { optimal = "orange", medium = "yellow", easy = "green", trivial = "grey" }
local READ_IT = "Open the profession window to read its recipes."
local NO_TRAINER = "Nothing from a trainer yet. Open a trainer's window."
local OTHERS = "Other characters"
local NO_OTHERS = "No other characters seen by this install yet."
local NO_BOOK = "No profession book in this client."
local NONE_LEARNED = "No professions learned yet."
local FOOTER = "Full planner: everloot.app/tools/profession-planner"
local FALLBACK_ICON = "Interface\\Icons\\INV_Misc_QuestionMark"

-- The crafting costs page.
local CRAFT_ROWS, CRAFT_ROW_H = 8, 16
local BUY_LINES = 5
local MAX_COUNT = 999
local TO_CRAFTING, TO_RANKS = "Crafting costs", "Ranks and trainers"
local SORT_PROFIT, PROFITABLE = "Sort: est. profit", "Est. profitable only"
local NO_RECIPES = "No recipes with reagents recorded for your professions yet. Open a profession window to read them."
local NONE_PROFITABLE = "No recipe shows an estimated profit at these prices, assuming one item per craft."
local PER_ITEM = "Value is per item. Est. profit assumes one item per craft: how many items a craft makes is not recorded."
local NO_FILE = "No price file in the game yet: the Everloot Desktop App writes it, then /reload. Vendor prices you saw still count."
local CHECKING = "Checking the price file..."
local FAILED = "The price file failed its checksum and is not used. Vendor prices you saw still count."
local NO_REALM = "The price file has no market values for this realm yet. Vendor prices you saw still count."
local WARN = { 1, 0.4, 0.4, 1 }  -- the tooltip's warning red (prices.lua)

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

-- The trainer's name for an NPC id, from the newest npc_sighting row that has one.
local function trainerNames()
  local names = {}
  for _, r in ipairs(E:Rows("npc_sighting")) do
    if type(r) == "table" and r.npcId ~= nil and type(r.name) == "string" and r.name ~= "" then names[r.npcId] = r.name end
  end
  return names
end

-- The recipes a trainer teaches for one profession at or above the character's rank, lowest rank first, at most
-- `limit` of them. A recipe listed by two trainers at the same rank is one line.
local function nextFromTrainer(name, rank, limit, names)
  local rows, seen = {}, {}
  for _, r in ipairs(E:Rows("trainer_seen")) do
    if type(r) == "table" and r.profession == name and type(r.requiredRank) == "number" and r.requiredRank >= rank
      and type(r.recipe) == "string" then
      local key = r.recipe .. "|" .. r.requiredRank
      if not seen[key] then
        seen[key] = true
        rows[#rows + 1] = { rank = r.requiredRank, recipe = r.recipe, cost = r.costCopper, trainer = names[r.trainerNpcId] }
      end
    end
  end
  table.sort(rows, function(a, b)
    if a.rank ~= b.rank then return a.rank < b.rank end
    return a.recipe < b.recipe
  end)
  for i = #rows, limit + 1, -1 do rows[i] = nil end
  return rows
end

local function trainerLine(r)
  local s = "Rank " .. r.rank .. ": " .. r.recipe
  if type(r.cost) == "number" then s = s .. " · " .. U.MoneyShort(r.cost) end
  if r.trainer then s = s .. " · " .. r.trainer end
  return s
end

-- Draws one block and returns its height.
local function draw(block, p, lines, names)
  local got = recorded(p.name)
  block.name:SetText(p.name)
  block.icon:SetTexture(p.icon or FALLBACK_ICON)
  block.bar:SetMinMaxValues(0, p.maxRank or math.max(p.rank, 1))
  block.bar:SetValue(p.rank)
  block.rank:SetText(p.maxRank and (p.rank .. " / " .. p.maxRank) or tostring(p.rank))
  if got.n == 0 then
    block.recipes:SetText(READ_IT)
  else
    block.recipes:SetText(got.n .. (got.n == 1 and " recipe" or " recipes") .. " recorded: " .. got.orange .. " orange · "
      .. got.yellow .. " yellow · " .. got.green .. " green · " .. got.grey .. " grey")
  end
  if got.n > 0 and got.newest then
    block.last:SetText("Last read: " .. got.newest)
    block.last:Show()
  else
    block.last:Hide()
  end
  local rows = nextFromTrainer(p.name, p.rank, lines, names)
  for i, line in ipairs(block.trainer) do
    if rows[i] then
      line:SetText(trainerLine(rows[i]))
      line:Show()
    elseif i == 1 then
      line:SetText(NO_TRAINER)
      line:Show()
    else
      line:Hide()
    end
  end
  local height = HEAD_H + LINE_H * math.max(#rows, 1)
  block:SetSize(W, height)
  return height
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
    index.recipes[key] = { key = key, profession = r.profession, name = r.recipe, reagents = reagents,
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

-- One redraw's prices, each item looked up once: the price file's market value, or the lowest vendor price this
-- install saw when that is lower or the only one. A reagent named by a recipe gets its id from this install's item
-- rows, else from the client when it has the item loaded. A name this install saw with two ids stays ambiguous: the
-- client's lookup by name would only pick one of them.
local AMBIGUOUS = "ambiguous"
local function pricer(realm)
  local ids, units, markets = {}, {}, {}
  local P = {}
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
      markets[itemId] = row and row.market or false
    end
    return markets[itemId] or nil
  end
  -- The price of one unit and whether it is a vendor's, or nil.
  function P.unit(itemId)
    if units[itemId] == nil then
      local market, vendor = P.market(itemId), index.vendor[itemId]
      if vendor and (not market or vendor < market) then units[itemId] = { vendor, true }
      elseif market then units[itemId] = { market, false }
      else units[itemId] = false end
    end
    local u = units[itemId]
    if u then return u[1], u[2] end
  end
  return P
end

-- One recipe at these prices: its reagents ({ item, count, unit, vendor, ambiguous }), the cost (nil when a reagent
-- has no price, with `unpriced` saying how many), the product's market value and, when both are known, the profit:
-- an estimate, because it sets one item's value against a whole craft's cost.
local function evaluate(recipe, P)
  local out = { key = recipe.key, name = recipe.name, parts = {}, unpriced = 0 }
  local cost = 0
  for _, g in ipairs(recipe.reagents) do
    local id, ambiguous = P.id(g.item)
    local unit, vendor
    if id then unit, vendor = P.unit(id) end
    out.parts[#out.parts + 1] = { item = g.item, count = g.count, unit = unit, vendor = vendor, ambiguous = ambiguous }
    if unit then cost = cost + unit * g.count else out.unpriced = out.unpriced + 1 end
  end
  if out.unpriced == 0 then out.cost = cost end
  out.value = recipe.product and P.market(recipe.product) or nil
  if out.cost and out.value then out.profit = out.value - out.cost end
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

-- How old the market values are, and the colour to say it in.
local function ageLine(realm)
  if type(EverlootPricesDB) ~= "table" or not realm or not E.PriceFile then return NO_FILE, COLORS.muted end
  local file = E:PriceFile(realm)
  if file.status == "verifying" then return CHECKING, COLORS.muted end
  if file.status == "bad" then return file.silent and NO_REALM or FAILED, file.silent and COLORS.muted or WARN end
  local today, built = E.DayNumber(date("!%Y-%m-%d")), E.DayNumber(file.asOf or "")
  if not today or not built then return "Market values from the price file; when it was built is unknown.", WARN end
  local days = today - built
  local age = days <= 0 and "today" or (plural(days, "day") .. " ago")
  if days > E.STALE_DAYS then
    return "OLD FILE: market values from " .. file.asOf:sub(1, 10) .. " (" .. age .. "). The Everloot Desktop App "
      .. "refreshes it, then /reload.", WARN
  end
  return "Market values from the price file built " .. file.asOf:sub(1, 10) .. " (" .. age .. "), all houses; "
    .. "a vendor price when it is lower.", COLORS.muted
end

local function buyLine(part, count)
  local need = part.count * count
  local s = need .. " × " .. part.item
  if not part.unit then return s .. (part.ambiguous and " · unpriced (ambiguous name)" or " · no price") end
  return s .. " · " .. U.MoneyShort(part.unit) .. " each" .. (part.vendor and " (vendor)" or "") .. " · "
    .. U.MoneyShort(part.unit * need)
end

-- The reagents for `count` crafts of one recipe, a page at a time, and their total; a reagent without a price is
-- said, never a zero. Another recipe starts at its first page.
local function drawBuy(c, row)
  local b = c.buy
  if not row then
    b.title:SetText("What to buy")
    for _, line in ipairs(b.lines) do line:Hide() end
    b.up:Hide(); b.down:Hide()
    b.total:SetText("Choose a recipe in the list.")
    return
  end
  b.title:SetText("What to buy: " .. c.count .. " × " .. row.name)
  if row.key ~= b.key then b.key = row.key; b.offset = 0 end
  local n = #row.parts
  b.offset = math.min(b.offset, math.floor(math.max(n - 1, 0) / BUY_LINES) * BUY_LINES)
  for i, line in ipairs(b.lines) do
    local part = row.parts[b.offset + i]
    if part then line:SetText(buyLine(part, c.count)); line:Show() else line:Hide() end
  end
  if b.offset > 0 then b.up:Show() else b.up:Hide() end
  if b.offset + BUY_LINES < n then b.down:Show() else b.down:Hide() end
  local priced = 0
  for _, part in ipairs(row.parts) do
    if part.unit then priced = priced + part.unit * part.count * c.count end
  end
  if row.unpriced == 0 then
    b.total:SetText("Total: " .. U.MoneyShort(priced))
  else
    b.total:SetText("Total unknown: " .. plural(row.unpriced, "reagent") .. " unpriced"
      .. (row.unpriced < #row.parts and (" · the priced ones " .. U.MoneyShort(priced)) or ""))
  end
end

local function drawCraftRow(line, row, selected)
  line.name:SetText(row.name)
  line.name:SetTextColor(unpack(selected and COLORS.accent or COLORS.text))
  -- An unknown cost says in its own column how many reagents have no price; the product's value still shows.
  line.cost:SetText(row.cost and U.MoneyShort(row.cost) or ("unknown (" .. row.unpriced .. " unpriced)"))
  line.value:SetText(row.value and U.MoneyShort(row.value) or "no price")
  line.profit:SetText(row.profit and U.MoneyShort(row.profit) or "-")
  line.profit:SetTextColor(unpack(row.profit and row.profit > 0 and COLORS.accent or COLORS.text))
end

local function refreshCrafting(c)
  local realm = GetRealmName and E.Readable(GetRealmName())
  realm = type(realm) == "string" and realm ~= "" and realm or nil
  local all = craftRows(pricer(realm))
  local age, color = ageLine(realm)
  c.age:SetText(age)
  c.age:SetTextColor(unpack(color))
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
  local crafting = p.mode == "crafting"
  p.toggle:SetText(crafting and TO_RANKS or TO_CRAFTING)
  if crafting then
    for _, block in ipairs(p.blocks) do block:Hide() end
    p.empty:Hide(); p.others:Hide()
    for _, line in ipairs(p.other) do line:Hide() end
    p.craft.page:Show()
    refreshCrafting(p.craft)
    return
  end
  p.craft.page:Hide()
  local list = U.Professions()
  local empty = list == nil and NO_BOOK or (#list == 0 and NONE_LEARNED) or nil
  local lines = list and #list > 3 and TRAINER_LINES - 1 or TRAINER_LINES
  local names = trainerNames()
  local y = 0
  for i, block in ipairs(p.blocks) do
    local prof = list and list[i]
    if prof then
      block:SetPoint("TOPLEFT", 0, -y)
      y = y + draw(block, prof, lines, names) + GAP
      block:Show()
    else
      block:Hide()
    end
  end
  if empty then p.empty:SetText(empty); p.empty:Show() else p.empty:Hide() end
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

-- Recipe 4..204, cost 208..318, value 322..432, profit 436..546; the amounts are set to the right of their columns.
local CRAFT_COLUMNS = { { "name", 4, 200 }, { "cost", 208, 110 }, { "value", 322, 110 }, { "profit", 436, 110 } }

-- The sort and filter buttons and the price file's age, the recipe list, and under it what to buy for the recipe
-- chosen in the list, with buttons for the count and, past five reagents, Up and Down for the rest of them.
buildCrafting = function(parent)
  local c = { sort = "profit", profitable = false, count = 1 }
  c.page = CreateFrame("Frame", nil, parent)
  c.page:SetPoint("TOPLEFT", 0, 0)
  c.page:SetSize(W, H - FOOTER_H)
  c.page:Hide()
  c.sortButton = button(c.page, SORT_PROFIT, 150, function()
    c.sort = c.sort == "name" and "profit" or "name"; c.rows.offset = 0
  end)
  c.sortButton:SetPoint("TOPLEFT", 0, -6)
  c.filterButton = button(c.page, PROFITABLE, 150, function() c.profitable = not c.profitable; c.rows.offset = 0 end)
  c.filterButton:SetPoint("TOPLEFT", 154, -6)
  c.age = text(c.page, 11, NARROW, COLORS.muted)
  c.age:SetPoint("TOPLEFT", 4, -32)
  c.age:SetWidth(W - 8)
  c.note = text(c.page, 11, NARROW, COLORS.muted)
  c.note:SetPoint("TOPLEFT", 4, -45)
  c.note:SetWidth(W - 8)
  c.note:SetText(PER_ITEM)

  local list = box(c.page, 0, -60, W, 186)
  c.head = {}
  for _, col in ipairs(CRAFT_COLUMNS) do
    local s = text(list, 11, NARROW, COLORS.muted)
    s:SetPoint("TOPLEFT", col[2] + 4, -6)
    s:SetWidth(col[3])
    if col[1] ~= "name" then s:SetJustifyH("RIGHT") end
    c.head[col[1]] = s
  end
  c.head.name:SetText("Recipe")
  c.head.cost:SetText("Cost")
  c.head.value:SetText("Value per item")
  c.head.profit:SetText("Est. profit (1/craft)")
  local rows = { offset = 0 }
  for i = 1, CRAFT_ROWS do
    local line = CreateFrame("Button", nil, list)
    line:SetPoint("TOPLEFT", 4, -22 - (i - 1) * CRAFT_ROW_H)
    line:SetSize(W - 8, CRAFT_ROW_H)
    for _, col in ipairs(CRAFT_COLUMNS) do
      local s = text(line, 11, NARROW)
      s:SetPoint("LEFT", col[2], 0)
      s:SetWidth(col[3])
      if s.SetWordWrap then s:SetWordWrap(false) end
      if col[1] ~= "name" then s:SetJustifyH("RIGHT") end
      line[col[1]] = s
    end
    line:SetScript("OnClick", function()
      if line.row then c.selected = line.row.key; redraw() end
    end)
    rows[i] = line
  end
  rows.empty = text(list, 11, nil, COLORS.muted)
  rows.empty:SetPoint("TOPLEFT", 8, -24)
  rows.empty:SetWidth(W - 16)
  rows.up = button(list, "Up", 48, function() rows.offset = math.max(0, rows.offset - CRAFT_ROWS) end)
  rows.up:SetPoint("BOTTOMRIGHT", -58, 6)
  rows.down = button(list, "Down", 48, function() rows.offset = rows.offset + CRAFT_ROWS end)
  rows.down:SetPoint("BOTTOMRIGHT", -6, 6)
  c.rows = rows

  local buy = box(c.page, 0, -252, W, 110)
  local b = { lines = {}, steps = {}, offset = 0 }
  b.title = text(buy, 12)
  b.title:SetPoint("TOPLEFT", 8, -9)
  b.title:SetWidth(W - 16 - 4 * 40)
  if b.title.SetWordWrap then b.title:SetWordWrap(false) end
  for i, step in ipairs({ -10, -1, 1, 10 }) do
    local s = button(buy, (step > 0 and "+" or "") .. step, 36, function()
      c.count = math.max(1, math.min(MAX_COUNT, c.count + step))
    end)
    s:SetPoint("TOPRIGHT", -6 - (4 - i) * 40, -6)
    b.steps[i] = s
  end
  -- The lines and the total leave the bottom right to Up and Down (106 wide).
  for i = 1, BUY_LINES do
    local line = text(buy, 11, NARROW, COLORS.muted)
    line:SetPoint("TOPLEFT", 8, -30 - (i - 1) * LINE_H)
    line:SetWidth(W - 16 - 110)
    if line.SetWordWrap then line:SetWordWrap(false) end
    b.lines[i] = line
  end
  b.total = text(buy, 12)
  b.total:SetPoint("TOPLEFT", 8, -30 - BUY_LINES * LINE_H - 2)
  b.total:SetWidth(W - 16 - 110)
  b.up = button(buy, "Up", 48, function() b.offset = math.max(0, b.offset - BUY_LINES) end)
  b.up:SetPoint("BOTTOMRIGHT", -58, 6)
  b.down = button(buy, "Down", 48, function() b.offset = b.offset + BUY_LINES end)
  b.down:SetPoint("BOTTOMRIGHT", -6, 6)
  c.buy = b
  return c
end

local function build(f, parent)
  local p = { blocks = {} }
  f.professions = p
  for i = 1, BLOCKS do
    local b = CreateFrame("Frame", nil, parent)
    b:SetPoint("TOPLEFT", 0, -(i - 1) * (HEAD_H + LINE_H + GAP))
    b:SetSize(W, HEAD_H + LINE_H)
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
    b.recipes = text(b, 11, NARROW, COLORS.muted)
    b.recipes:SetPoint("TOPLEFT", 46, -28)
    b.recipes:SetWidth(W - 236)
    b.last = text(b, 11, NARROW, COLORS.muted)
    b.last:SetPoint("TOPRIGHT", -10, -28)
    b.last:SetWidth(170)
    b.last:SetJustifyH("RIGHT")
    b.trainer = {}
    for j = 1, TRAINER_LINES do
      local line = text(b, 11, NARROW, COLORS.muted)
      line:SetPoint("TOPLEFT", 46, -(HEAD_H + (j - 1) * LINE_H))
      line:SetWidth(W - 56)
      b.trainer[j] = line
    end
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
    local line = text(parent, 11, NARROW, COLORS.muted)
    line:SetPoint("TOPLEFT", p.others, "BOTTOMLEFT", 0, -(i - 1) * LINE_H - 2)
    line:SetWidth(W - 16)
    p.other[i] = line
  end
  p.footer = text(parent, 11, NARROW, COLORS.muted)
  -- At the bottom of the view, under the blocks and the other characters.
  p.footer:SetPoint("BOTTOMLEFT", 8, 8)
  p.footer:SetWidth(W - 160)  -- the button beside it is 140 wide
  p.footer:SetText(FOOTER)
  -- Beside the footer: swaps the blocks for the crafting costs and back.
  p.mode = "ranks"
  p.toggle = button(parent, TO_CRAFTING, 140, function() p.mode = p.mode == "crafting" and "ranks" or "crafting" end)
  p.toggle:SetPoint("BOTTOMRIGHT", 0, 2)
  p.craft = buildCrafting(parent)
end

U.Views.professions = { build = build, refresh = refresh }
