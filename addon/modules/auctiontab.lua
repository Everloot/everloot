-- Everloot tab at the auction house: the scan and its cooldown, whether the last scan is in the saved
-- file yet, a Share now button (a /reload, which writes the file so the Desktop App can send it) and a
-- price lookup with the same lines as the tooltip. The tab sits beside Blizzard's tabs without joining
-- their tab system, so their code is never changed: it shows a panel over the house, and clicking any of
-- their tabs hides it. Nothing here posts, bids or buys, and a scan starts only from the player's click.
-- With the Everloot window's file loaded (modules/window.lua) the panel wears that window's look.

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

--- Looks up what the player typed and shows it in the panel.
function T.ShowResult(text)
  if T.panel then render(T.panel, T.Result(text)) end
end

function T.Refresh()
  if T.panel and T.panel.status then T.panel.status:SetText(table.concat(T.StatusLines(), "\n")) end
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
    local box = T.panel and T.panel.lookup
    if box and box.HasFocus and box:HasFocus() and type(link) == "string" then box:SetText(link) end
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
