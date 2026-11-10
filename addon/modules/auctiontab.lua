-- Everloot tab at the auction house: the scan and its cooldown, whether the last scan is in the saved
-- file yet, a Share now button (a /reload, which writes the file so the Desktop App can send it) and a
-- price lookup with the same lines as the tooltip. The tab sits beside Blizzard's tabs without joining
-- their tab system, so their code is never changed: it shows a panel over the house, and clicking any of
-- their tabs hides it. Nothing here posts, bids or buys, and a scan starts only from the player's click.
-- With the Everloot window's file loaded (modules/window.lua) the panel wears that window's look.
-- A button at its top right swaps the panel for the shopping lists (modules/shopping.lua): the active list with each
-- item's wanted count, max price, market value and what a search found, and a Search button per item that sends one
-- search per press.

local E = Everloot
local T = {}
E.AuctionTab = T

T.SITE = "everloot.app/tools/auctions"
local TEMPLATES = { "PanelTabButtonTemplate", "CharacterFrameTabButtonTemplate", "UIPanelButtonTemplate" }
local sessionStart = time()   -- a scan before this load is already in the saved file
-- The text column: wide enough for a label and its value, narrow enough that the eye finds one from the other.
local COLUMN, SCROLLBAR, PAD, GAP = 460, 26, 8, 12
local HINT = "Type an item's name or id, or shift-click an item here."
local NONE = "No Everloot price for that item on this realm yet."
-- The shopping page: rows on screen at once, their height, and each column's left edge and width.
local SHOP_ROWS, SHOP_ROW_H = 10, 18
local SHOP_COLUMNS = { { "name", 0, 220 }, { "want", 226, 40 }, { "max", 272, 90 }, { "market", 368, 130 }, { "found", 504, 90 } }
local SHOP_HELP = "Item: a name, an id or shift-click. Want: how many. Max each: like 1g 50s, blank for no limit."
local SHOP_EMPTY = "Nothing on this list yet. Add an item above, or a recipe's reagents from the Professions tab of the Everloot window."
local FALLBACK_COLORS = { text = { 1, 1, 1, 1 }, muted = { 0.788, 0.765, 0.69, 1 }, accent = { 0.612, 0.941, 0.227, 1 } }
local WARN = { 1, 0.4, 0.4, 1 }  -- the tooltip's warning red (prices.lua)

local function realmName()
  -- A realm name the client will not let the addon read is unknown, like a missing one.
  local realm = E.Readable(GetRealmName and GetRealmName())
  return type(realm) == "string" and #realm >= 2 and realm or nil
end

--- The status lines: scan readiness, the last scan of this realm, and whether it is saved for sharing.
function T.StatusLines()
  local lines = {}
  local wait = (EverlootDB.lastScanAt or 0) + E.SCAN_COOLDOWN - time()
  if E:Scanning() then lines[1] = "Scanning. Keep the auction house open until it reports."
  elseif wait > 0 then lines[1] = string.format("Next scan in %d:%02d.", math.floor(wait / 60), wait % 60)
  else lines[1] = "Ready to scan." end
  local realm = realmName()
  local own = realm and E:OwnScan(realm)
  if not own then
    lines[2] = "No scan on this realm yet."
    return lines
  end
  local items = 0
  for _ in pairs(own.items) do items = items + 1 end
  local minutes = math.floor((time() - own.at) / 60)
  lines[2] = string.format("Last scan on this realm: %d items, %s.", items,
    minutes < 1 and "just now" or minutes < 60 and (minutes .. " min ago") or (math.floor(minutes / 60) .. " h ago"))
  lines[3] = own.at < sessionStart and "Saved in your file: the Desktop App sends it."
    or "Not saved yet: Share now, or log out, and the Desktop App sends it."
  return lines
end

-- The item as the game links it, or its id while the client has not loaded it or will not let the addon read it.
local function itemName(id)
  local info = (type(C_Item) == "table" and C_Item.GetItemInfo) or GetItemInfo
  if type(info) == "function" then
    local ok, _, link = pcall(info, id)
    link = ok and E.Readable(link)
    if type(link) == "string" and link ~= "" then return link end
  end
  return "Item " .. id
end

--- What the lookup shows for what the player typed (a link, an id or a loaded item's name): { item, realm, lines }
--- with the tooltip's own price lines, or { message } saying why there are none. Community prices still being
--- checked, or refused by their checksum, are said in words, beside the player's own scan when there is one.
function T.Result(text)
  local id = E.ItemIdFrom(text)
  if not id then return { message = HINT } end
  local realm = realmName()
  local lines, entry
  if realm and E.PriceLines then lines, entry = E.PriceLines(realm, id) end
  lines = type(lines) == "table" and lines or {}
  entry = type(entry) == "table" and entry or {}
  local note
  if entry.status == "verifying" then
    note = { text = E.PriceMissingNote(realm, entry), r = 0.788, g = 0.765, b = 0.69 }
  elseif entry.status == "bad" and not entry.silent then
    note = { text = E.PriceMissingNote(realm, entry), r = 1, g = 0.4, b = 0.4 }
  end
  if #lines == 0 then
    return { message = realm and E.PriceMissingNote and E.PriceMissingNote(realm, entry) or NONE }
  end
  local shown = { note }
  for _, line in ipairs(lines) do shown[#shown + 1] = line end
  return { item = itemName(id), realm = realm, lines = shown }
end

--- The same lookup as plain text, a line each, as chat prints it.
function T.Lookup(text)
  local result = T.Result(text)
  if result.message then return result.message end
  local out = {}
  for _, line in ipairs(result.lines) do out[#out + 1] = line.text end
  return table.concat(out, "\n")
end

-- Text in the Everloot window's fonts and colours (modules/window.lua loads after this file, before the house
-- opens), else in the game's own template.
local function words(parent, template, size, tone, narrow)
  local W = E.Window
  if W and W.Text then return W.Text(parent, size, narrow and W.NARROW or nil, W.COLORS[tone]) end
  local s = parent:CreateFontString(nil, "OVERLAY", template)
  s:SetJustifyH("LEFT")
  return s
end

local function height(s) return tonumber(s:GetStringHeight()) or 0 end

-- A string's width on one line, before a column wraps it.
local function natural(s)
  local w = s.GetUnboundedStringWidth and s:GetUnboundedStringWidth()
  if type(w) ~= "number" then w = s:GetStringWidth() end
  return tonumber(w) or 0
end

-- One result row: a label and its value, or one line of text.
local function newRow(content)
  local row = {
    label = words(content, "GameFontHighlightSmall", 12, "text"),
    value = words(content, "GameFontHighlight", 13, "text", true),
    note = words(content, "GameFontHighlightSmall", 11, "muted"),
  }
  row.value:SetJustifyH("RIGHT")
  return row
end

--- Lays the result down the column: the item or the message, then each row below the last. A value keeps one
--- line at the column's right edge and its label wraps beside it, never into it; a long result scrolls.
local function layoutResults(panel)
  local column = panel.column
  if not column then return end
  local content, inner = panel.content, math.max(1, column - 2 * PAD)
  content:SetWidth(column)
  local y = PAD
  local function line(s)
    s:SetWidth(inner)
    s:SetPoint("TOPLEFT", content, "TOPLEFT", PAD, -y)
    y = y + height(s)
  end
  local function pair(label, value)
    local w = math.min(math.ceil(natural(value)) + 2, math.floor(inner * 0.6))
    value:SetWidth(w)
    label:SetWidth(math.max(1, inner - w - GAP))
    label:SetPoint("TOPLEFT", content, "TOPLEFT", PAD, -y)
    value:SetPoint("TOPRIGHT", content, "TOPLEFT", PAD + inner, -y)
    y = y + math.max(height(label), height(value))
  end
  if not panel.hasItem then
    line(panel.message)
  elseif panel.perUnit then
    pair(panel.item, panel.unit)
  else
    line(panel.item)
  end
  for i = 1, panel.used do
    local row, previous = panel.rows[i], panel.rows[i - 1]
    y = y + (i == 1 and 6 or (row.pair and not previous.pair) and 8 or 3)
    if row.pair then pair(row.label, row.value) else line(row.note) end
  end
  y = y + PAD
  content:SetHeight(y)
  local scroll = panel.results
  local limit = math.max(0, y - (tonumber(scroll:GetHeight()) or 0))
  scroll:SetVerticalScroll(math.min(tonumber(scroll:GetVerticalScroll()) or 0, limit))
end

-- Shows one result. A line with a label and an amount is one row, the label in the line's colour and the amount
-- in white as the tooltip writes it (a word standing in for an amount brings its own colour); any other line is
-- its text. Rows an earlier, longer result used are hidden.
local function render(panel, result)
  local rows, used, amounts = panel.rows, 0, false
  for _, line in ipairs(result.lines or {}) do
    local pair = type(line.left) == "string" and line.left ~= "" and type(line.right) == "string" and line.right ~= ""
    if pair or type(line.text) == "string" then
      used = used + 1
      local row = rows[used] or newRow(panel.content)
      rows[used], row.pair = row, pair
      local r, g, b = tonumber(line.r) or 1, tonumber(line.g) or 1, tonumber(line.b) or 1
      if pair then
        amounts = true
        row.label:SetText(line.left); row.label:SetTextColor(r, g, b)
        row.value:SetText(line.right); row.value:SetTextColor(1, 1, 1)
        row.note:Hide(); row.label:Show(); row.value:Show()
      else
        row.note:SetText(line.text); row.note:SetTextColor(r, g, b)
        row.label:Hide(); row.value:Hide(); row.note:Show()
      end
    end
  end
  for i = used + 1, #rows do rows[i].label:Hide(); rows[i].value:Hide(); rows[i].note:Hide() end
  panel.used, panel.hasItem, panel.perUnit = used, result.message == nil, amounts
  if result.message then
    panel.message:SetText(result.message)
    panel.message:Show(); panel.item:Hide(); panel.unit:Hide()
  else
    panel.item:SetText(result.item .. "  |cffc9c3b0on " .. result.realm .. "|r")
    panel.item:Show(); panel.message:Hide()
    -- Every amount is for one unit; the tooltip says so once in its header, and so does this heading.
    if amounts then panel.unit:Show() else panel.unit:Hide() end
  end
  panel.results:SetVerticalScroll(0)
  layoutResults(panel)
end

-- The column follows the panel's width, so a narrow panel wraps text instead of spilling past its edge.
local function layout(panel, width)
  width = tonumber(width) or tonumber(panel:GetWidth())
  if not width or width <= 0 then return end
  local column = math.floor(math.max(160, math.min(COLUMN, width - 32 - SCROLLBAR)))
  panel.column = column
  panel.intro:SetWidth(column)
  panel.status:SetWidth(column)
  panel.lookup:SetWidth(math.max(80, math.min(260, column - 12)))
  local buttonWidth = math.min(160, math.floor((column - 8) / 2))
  panel.scanButton:SetWidth(buttonWidth)
  panel.shareButton:SetWidth(buttonWidth)
  panel.results:SetWidth(column)
  panel.footer:SetWidth(math.max(1, width - 32))
  layoutResults(panel)
end

-- Shopping lists -------------------------------------------------------------------------------------------------

local function tone(name)
  local W = E.Window
  return (W and W.COLORS and W.COLORS[name]) or FALLBACK_COLORS[name]
end

local function shopButton(parent, label, w, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(w, 20)
  b:SetText(label)
  b:SetScript("OnClick", function()
    local shop = T.panel and T.panel.shop
    if shop and onClick ~= shop.deleteClick then shop.confirmDelete = false end
    onClick()
    T.RefreshShop()
  end)
  return b
end

local function shopBox(parent, w, x, y)
  local b = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
  b:SetSize(w, 20)
  b:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
  if b.SetAutoFocus then b:SetAutoFocus(false) end
  b:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  return b
end

local function say(text) E.Shopping.message = text end

-- Adds what the three boxes say to the active list, or updates the item when it is already there.
local function addFromBoxes(shop)
  local S = E.Shopping
  local id = E.ItemIdFrom(shop.itemBox:GetText() or "")
  if not id then return say("Type an item's name or id, or shift-click an item into the Item box.") end
  local wantText = (shop.wantBox:GetText() or ""):gsub("%s", "")
  local want = wantText == "" and 1 or tonumber(wantText)
  if not want or want < 1 or want ~= math.floor(want) then return say("Want is a whole number of at least 1.") end
  local max, blank = S.ParseMoney(shop.maxBox:GetText())
  if not max and not blank then return say("Max each reads like 1g 50s, 75s or 2 (gold); leave it blank for no limit.") end
  local item, why = S.Set(id, want, max, S.ItemName(id))
  if not item then return say(why) end
  shop.itemBox:SetText(""); shop.wantBox:SetText(""); shop.maxBox:SetText("")
  say("Saved " .. (S.ItemName(id, item.name) or ("item " .. id)) .. ": want " .. item.want
    .. (item.max and (", max " .. E.Coins(item.max) .. " each.") or ", no max."))
end

-- One list row: the item (a click puts it in the boxes to change), its numbers, Search and remove.
local function drawShopRow(line, item)
  local S = E.Shopping
  line.item = item
  line.name:SetText(S.ItemName(item.itemId, item.name) or ("Item " .. item.itemId))
  line.name:SetTextColor(unpack(tone("text")))
  line.want:SetText(tostring(item.want))
  line.max:SetText(item.max and S.Money(item.max) or "no limit")
  line.max:SetTextColor(unpack(tone(item.max and "text" or "muted")))
  local market = S.Market(item.itemId)
  if market then
    local age, stale = S.Age(market.day)
    line.market:SetText(S.Money(market.market) .. " · " .. age)
    line.market:SetTextColor(unpack(stale and WARN or tone("text")))
  else
    line.market:SetText("no price")
    line.market:SetTextColor(unpack(tone("muted")))
  end
  local f = S.Found(item.itemId)
  if f and f.min then
    line.found:SetText(S.Money(f.min) .. " ×" .. f.quantity)
    line.found:SetTextColor(unpack(tone((not item.max or f.min <= item.max) and "accent" or "text")))
  else
    line.found:SetText(f and "none" or "-")
    line.found:SetTextColor(unpack(tone("muted")))
  end
end

--- Draws the shopping page from the saved lists: the active list's name, the file's age, a page of items, the last
--- thing a search or a button said, and the caps.
function T.RefreshShop()
  local shop = T.panel and T.panel.shop
  local S = E.Shopping
  if not (shop and S) then return end
  local db = S.DB()
  local list, index = S.Active()
  shop.listName:SetText(list and (list.name .. "  |cffc9c3b0" .. index .. " of " .. #db.lists .. "|r") or "No list yet")
  local fileLine, warn = S.FileLine()
  shop.file:SetText(fileLine)
  shop.file:SetTextColor(unpack(warn and WARN or tone("muted")))
  local items = list and list.items or {}
  shop.offset = math.min(shop.offset, math.floor(math.max(#items - 1, 0) / SHOP_ROWS) * SHOP_ROWS)
  for i, line in ipairs(shop.rows) do
    local item = items[shop.offset + i]
    if item then drawShopRow(line, item); line:Show() else line.item = nil; line:Hide() end
  end
  if #items == 0 then shop.empty:Show() else shop.empty:Hide() end
  if shop.offset > 0 then shop.up:Show() else shop.up:Hide() end
  if shop.offset + SHOP_ROWS < #items then shop.down:Show() else shop.down:Hide() end
  shop.message:SetText(S.message or "")
  shop.deleteButton:SetText(shop.confirmDelete and "Confirm" or "Delete")
end

-- The shopping page: list controls, the add boxes, a line on the price file, the column heads, the rows, then the
-- last message and the caps above the panel's footer. It covers the scan controls and the lookup while shown.
local function buildShop(panel)
  local S = E.Shopping
  local shop = { offset = 0, rows = {} }
  local page = CreateFrame("Frame", nil, panel)
  page:SetPoint("TOPLEFT", panel, "TOPLEFT", 16, -46)
  page:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -16, 30)
  page:Hide()
  shop.page = page

  local prev = shopButton(page, "<", 24, function() S.Select(select(2, S.Active()) - 1) end)
  prev:SetPoint("TOPLEFT", page, "TOPLEFT", 0, 0)
  shop.listName = words(page, "GameFontNormal", 13, "text")
  shop.listName:SetPoint("TOPLEFT", page, "TOPLEFT", 30, -4)
  shop.listName:SetWidth(176)
  if shop.listName.SetWordWrap then shop.listName:SetWordWrap(false) end
  local nextButton = shopButton(page, ">", 24, function() S.Select(select(2, S.Active()) + 1) end)
  nextButton:SetPoint("TOPLEFT", page, "TOPLEFT", 210, 0)
  shop.nameBox = shopBox(page, 130, 252, 0)
  if shop.nameBox.SetMaxLetters then shop.nameBox:SetMaxLetters(S.MAX_NAME) end
  shop.newButton = shopButton(page, "New list", 76, function()
    local list, why = S.Create(shop.nameBox:GetText())
    if list then shop.nameBox:SetText(""); shop.offset = 0; say("Made " .. list.name .. ".") else say(why) end
  end)
  shop.newButton:SetPoint("TOPLEFT", page, "TOPLEFT", 390, 0)
  shop.renameButton = shopButton(page, "Rename", 70, function()
    local ok, why = S.Rename(shop.nameBox:GetText())
    if ok then shop.nameBox:SetText(""); say("Renamed.") else say(why) end
  end)
  shop.renameButton:SetPoint("TOPLEFT", page, "TOPLEFT", 470, 0)
  -- Deleting takes two presses: the first asks, the second deletes. Any other button cancels it.
  shop.deleteClick = function()
    local list = S.Active()
    if not list then return say("No list to delete.") end
    if not shop.confirmDelete then
      shop.confirmDelete = true
      return say("Press Confirm to delete " .. list.name .. " and its " .. #list.items .. " items.")
    end
    shop.confirmDelete, shop.offset = false, 0
    local _, said = S.Delete()
    say(said)
  end
  shop.deleteButton = shopButton(page, "Delete", 70, shop.deleteClick)
  shop.deleteButton:SetPoint("TOPLEFT", page, "TOPLEFT", 544, 0)

  shop.itemBox = shopBox(page, 214, 6, -30)
  shop.itemBox:SetScript("OnEnterPressed", function(self) self:ClearFocus(); addFromBoxes(shop); T.RefreshShop() end)
  shop.wantBox = shopBox(page, 40, 230, -30)
  shop.maxBox = shopBox(page, 90, 276, -30)
  shop.addButton = shopButton(page, "Add or update", 120, function() addFromBoxes(shop) end)
  shop.addButton:SetPoint("TOPLEFT", page, "TOPLEFT", 374, -30)
  shop.help = words(page, "GameFontDisableSmall", 11, "muted")
  shop.help:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -56)
  shop.help:SetText(SHOP_HELP)
  shop.file = words(page, "GameFontDisableSmall", 11, "muted")
  shop.file:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -70)

  shop.head = {}
  local heads = { name = "Item", want = "Want", max = "Max each", market = "Market · age", found = "Lowest found" }
  for _, col in ipairs(SHOP_COLUMNS) do
    local s = words(page, "GameFontDisableSmall", 11, "muted")
    s:SetPoint("TOPLEFT", page, "TOPLEFT", col[2], -90)
    s:SetWidth(col[3])
    if col[1] ~= "name" then s:SetJustifyH("RIGHT") end
    s:SetText(heads[col[1]])
    shop.head[col[1]] = s
  end
  for i = 1, SHOP_ROWS do
    local line = CreateFrame("Button", nil, page)
    line:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -106 - (i - 1) * SHOP_ROW_H)
    line:SetSize(686, SHOP_ROW_H)
    for _, col in ipairs(SHOP_COLUMNS) do
      local s = words(line, "GameFontHighlightSmall", 12, "text", col[1] ~= "name")
      s:SetPoint("LEFT", line, "LEFT", col[2], 0)
      s:SetWidth(col[3])
      if s.SetWordWrap then s:SetWordWrap(false) end
      if col[1] ~= "name" then s:SetJustifyH("RIGHT") end
      line[col[1]] = s
    end
    -- A click on the row puts the item in the boxes, to change its numbers with Add or update.
    line:SetScript("OnClick", function()
      local item = line.item
      if not item then return end
      shop.itemBox:SetText(S.ItemName(item.itemId, item.name) or tostring(item.itemId))
      shop.wantBox:SetText(tostring(item.want))
      shop.maxBox:SetText(item.max and E.Coins(item.max) or "")
    end)
    -- The row's buttons are its children, so they hide with it. Search sends one search per press.
    line.search = shopButton(line, "Search", 60, function()
      if line.item then S.Search(line.item.itemId, line.item.name) end
    end)
    line.search:SetPoint("LEFT", line, "LEFT", 600, 0)
    line.remove = shopButton(line, "x", 22, function()
      if line.item and S.Remove(line.item.itemId) then say("Removed " .. (S.ItemName(line.item.itemId, line.item.name) or "the item") .. ".") end
    end)
    line.remove:SetPoint("LEFT", line, "LEFT", 664, 0)
    shop.rows[i] = line
  end
  shop.empty = words(page, "GameFontHighlightSmall", 12, "muted")
  shop.empty:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -108)
  shop.empty:SetWidth(560)
  shop.caps = words(page, "GameFontDisableSmall", 10, "muted")
  shop.caps:SetPoint("BOTTOMLEFT", page, "BOTTOMLEFT", 0, 0)
  shop.caps:SetText(S.CAPS .. " Nothing is uploaded, bought or posted for you.")
  shop.message = words(page, "GameFontHighlightSmall", 12, "text")
  shop.message:SetPoint("BOTTOMLEFT", page, "BOTTOMLEFT", 0, 16)
  shop.message:SetWidth(560)
  shop.up = shopButton(page, "Up", 48, function() shop.offset = math.max(0, shop.offset - SHOP_ROWS) end)
  shop.up:SetPoint("BOTTOMRIGHT", page, "BOTTOMRIGHT", -54, 12)
  shop.down = shopButton(page, "Down", 48, function() shop.offset = shop.offset + SHOP_ROWS end)
  shop.down:SetPoint("BOTTOMRIGHT", page, "BOTTOMRIGHT", 0, 12)
  shop.empty:SetText(SHOP_EMPTY)
  panel.shop = shop
  S.OnChange = T.RefreshShop
end

--- Shows the price lookup ("lookup") or the shopping lists ("shop"); each hides what the other shows.
function T.SetMode(mode)
  local panel = T.panel
  if not (panel and panel.shop) then return end
  local shopping = mode == "shop"
  panel.mode = shopping and "shop" or "lookup"
  for _, part in ipairs({ panel.intro, panel.scanButton, panel.shareButton, panel.status, panel.lookupLabel, panel.lookup, panel.results }) do
    if shopping then part:Hide() else part:Show() end
  end
  if shopping then
    panel.shop.page:Show()
    T.RefreshShop()
  else
    panel.shop.confirmDelete = false
    panel.shop.page:Hide()
  end
  panel.modeButton:SetText(shopping and "Price lookup" or "Shopping list")
end

--- Looks up what the player typed and shows it in the panel.
function T.ShowResult(text)
  if T.panel then render(T.panel, T.Result(text)) end
end

function T.Refresh()
  if T.panel and T.panel.status then T.panel.status:SetText(table.concat(T.StatusLines(), "\n")) end
  -- A search the house never answered is let go after a while; the shopping page redraws its ages and results.
  if E.Shopping then E.Shopping.Tick() end
  if T.panel and T.panel.mode == "shop" then T.RefreshShop() end
end

function T.Show()
  if not T.panel then return end
  T.panel:Show()
  layout(T.panel)
  T.Refresh()
end

function T.Hide()
  if T.panel then T.panel:Hide() end
end

local function buildPanel(house)
  local panel = CreateFrame("Frame", "EverlootAuctionPanel", house, "BackdropTemplate")
  panel:SetPoint("TOPLEFT", house, "TOPLEFT", 8, -60)
  panel:SetPoint("BOTTOMRIGHT", house, "BOTTOMRIGHT", -8, 28)
  local level = house.GetFrameLevel and house:GetFrameLevel()
  if type(level) == "number" then panel:SetFrameLevel(level + 20) end
  if panel.EnableMouse then panel:EnableMouse(true) end
  -- The Everloot window's dark panel under a small crest heading; the game's dialog without the window file.
  local W = E.Window
  if W and W.Backdrop and W.Heading then
    W.Backdrop(panel)
    panel.crest, panel.title = W.Heading(panel, "Auction house")
    panel.crest:SetPoint("TOPLEFT", panel, "TOPLEFT", 12, -10)
  else
    if panel.SetBackdrop then
      panel:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true, tileSize = 16, edgeSize = 12, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    end
    panel.title = words(panel, "GameFontNormalLarge")
    panel.title:SetPoint("TOPLEFT", panel, "TOPLEFT", 16, -14)
    panel.title:SetText("Everloot")
  end
  local intro = words(panel, "GameFontHighlightSmall", 11, "muted")
  intro:SetPoint("TOPLEFT", panel, "TOPLEFT", 16, -46)
  intro:SetWidth(COLUMN)
  intro:SetText("One click reads this house's prices. They show in your tooltips at once and reach everloot.app when "
    .. "your file is saved: Share now or log out, and the Desktop App sends it. A price counts on the site once three players agree.")
  panel.intro = intro

  local scanButton = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
  scanButton:SetSize(160, 24)
  scanButton:SetPoint("TOPLEFT", intro, "BOTTOMLEFT", 0, -12)
  scanButton:SetText("Scan this house")
  scanButton:SetScript("OnClick", function() E:StartScan(); T.Refresh() end)
  panel.scanButton = scanButton

  local shareButton = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
  shareButton:SetSize(160, 24)
  shareButton:SetPoint("LEFT", scanButton, "RIGHT", 8, 0)
  shareButton:SetText("Share now (/reload)")
  shareButton:SetScript("OnClick", function() if ReloadUI then ReloadUI() end end)
  panel.shareButton = shareButton

  local status = words(panel, "GameFontHighlight", 12, "text")
  status:SetPoint("TOPLEFT", scanButton, "BOTTOMLEFT", 0, -10)
  status:SetWidth(COLUMN)
  panel.status = status

  local label = words(panel, "GameFontNormal", 13, "text")
  label:SetPoint("TOPLEFT", status, "BOTTOMLEFT", 0, -16)
  label:SetText("Look up a price")
  panel.lookupLabel = label
  local box = CreateFrame("EditBox", "EverlootAuctionLookup", panel, "InputBoxTemplate")
  box:SetSize(260, 20)
  box:SetPoint("TOPLEFT", label, "BOTTOMLEFT", 6, -6)
  if box.SetAutoFocus then box:SetAutoFocus(false) end
  box:SetScript("OnEnterPressed", function(self)
    T.ShowResult(self:GetText())
    self:ClearFocus()
  end)
  box:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  panel.lookup = box

  local footer = words(panel, "GameFontDisableSmall", 10, "muted")
  footer:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", 16, 12)
  footer:SetWidth(COLUMN)
  footer:SetText("Full history and other realms: " .. T.SITE)
  panel.footer = footer

  -- The result scrolls between the box and the footer, so a long one never runs over the footer. A client
  -- without the scroll frame template gets a plain scroll frame, still moved by the mouse wheel.
  local made, scroll = pcall(CreateFrame, "ScrollFrame", nil, panel, "UIPanelScrollFrameTemplate")
  if not made or not scroll then scroll = CreateFrame("ScrollFrame", nil, panel) end
  scroll:SetPoint("TOPLEFT", box, "BOTTOMLEFT", -6, -10)
  scroll:SetPoint("BOTTOMLEFT", footer, "TOPLEFT", 0, 8)
  scroll:SetWidth(COLUMN)
  local content = CreateFrame("Frame", nil, scroll)
  content:SetSize(COLUMN, 1)
  scroll:SetScrollChild(content)
  if W and W.Surface then W.Surface(scroll) end
  scroll:EnableMouseWheel(true)
  scroll:SetScript("OnMouseWheel", function(self, delta)
    local limit = math.max(0, (tonumber(content:GetHeight()) or 0) - (tonumber(self:GetHeight()) or 0))
    self:SetVerticalScroll(math.max(0, math.min(limit, (tonumber(self:GetVerticalScroll()) or 0) - delta * 30)))
  end)
  panel.results, panel.content, panel.rows, panel.used = scroll, content, {}, 0
  panel.column = false -- no width until the panel is shown or sized
  -- The item's name and the realm come from the client in its own language, so the game's font object draws them:
  -- it holds every alphabet the client shows, where a font file named here may not.
  panel.item = content:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  panel.item:SetJustifyH("LEFT")
  if W and W.COLORS then panel.item:SetTextColor(unpack(W.COLORS.text)) end
  panel.unit = words(content, "GameFontDisableSmall", 11, "muted")
  panel.unit:SetJustifyH("RIGHT")
  panel.unit:SetText("per unit")
  panel.message = words(content, "GameFontHighlightSmall", 12, "muted")
  render(panel, { message = HINT })
  -- The shopping lists, behind a button at the top right, when their file is loaded.
  if E.Shopping then
    buildShop(panel)
    panel.mode = "lookup"
    panel.modeButton = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
    panel.modeButton:SetSize(120, 22)
    panel.modeButton:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -16, -12)
    panel.modeButton:SetText("Shopping list")
    panel.modeButton:SetScript("OnClick", function() T.SetMode(panel.mode == "shop" and "lookup" or "shop") end)
  end
  -- A hook, not a script: the backdrop template keeps its own size handler.
  panel:HookScript("OnSizeChanged", function(self, width) layout(self, width) end)

  local elapsed = 0
  panel:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + (dt or 0)
    if elapsed >= 1 then elapsed = 0; T.Refresh() end
  end)
  panel:Hide()
  return panel
end

--- Shift-clicking an item while the lookup box has focus puts its link there, as in a chat box.
local function hookLinks()
  if T.linksHooked or not hooksecurefunc then return end
  local function insert(link)
    local p = T.panel
    if not p or type(link) ~= "string" then return end
    for _, box in pairs({ p.lookup, E.Shopping and p.shop and p.shop.itemBox or nil }) do
      if box.HasFocus and box:HasFocus() then box:SetText(link) end
    end
  end
  if ChatEdit_InsertLink then hooksecurefunc("ChatEdit_InsertLink", insert) end
  T.linksHooked = true
end

--- Adds the tab and its panel to the auction house window, once. Returns false when it cannot.
function T.Attach(house)
  if T.tab then return true end
  if T.failed or not house then return false end
  local tab
  for _, template in ipairs(TEMPLATES) do
    local ok, frame = pcall(CreateFrame, "Button", "EverlootAuctionTab", house, template)
    if ok and frame then tab = frame; break end
  end
  if not tab then return false end
  local built = pcall(function()
    local tabs = type(house.Tabs) == "table" and house.Tabs or {}
    local last = tabs[#tabs]
    if last then tab:SetPoint("LEFT", last, "RIGHT", -15, 0)
    else tab:SetPoint("TOPLEFT", house, "BOTTOMLEFT", 20, 2) end
    local width = tab.GetWidth and tab:GetWidth()
    if type(width) ~= "number" or width < 60 then tab:SetSize(100, 24) end
    tab:SetText("Everloot")
    if PanelTemplates_TabResize then pcall(PanelTemplates_TabResize, tab, 0) end
    T.panel = buildPanel(house)
    tab:SetScript("OnClick", function() if T.panel:IsShown() then T.Hide() else T.Show() end end)
    for _, blizzard in ipairs(tabs) do
      if blizzard.HookScript then blizzard:HookScript("OnClick", T.Hide) end
    end
    hookLinks()
  end)
  if not built then
    tab:Hide()
    T.failed = true
    return false
  end
  T.tab = tab
  return true
end
