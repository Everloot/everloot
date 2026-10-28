-- Everloot tab at the auction house: the scan and its cooldown, whether the last scan is in the saved
-- file yet, a Share now button (a /reload, which writes the file so the Desktop App can send it) and a
-- price lookup with the same lines as the tooltip. The tab sits beside Blizzard's tabs without joining
-- their tab system, so their code is never changed: it shows a panel over the house, and clicking any of
-- their tabs hides it. Nothing here posts, bids or buys, and a scan starts only from the player's click.

local E = Everloot
local T = {}
E.AuctionTab = T

T.SITE = "everloot.app/tools/auctions"
local TEMPLATES = { "PanelTabButtonTemplate", "CharacterFrameTabButtonTemplate", "UIPanelButtonTemplate" }
local sessionStart = time()   -- a scan before this load is already in the saved file

local function realmName()
  local realm = GetRealmName and GetRealmName()
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

--- The price lines for what the player typed (a link, an id or a loaded item's name), as plain text.
function T.Lookup(text)
  local id = E.ItemIdFrom(text)
  if not id then return "Type an item's name or id, or shift-click an item here." end
  local realm = realmName()
  local lines = realm and E.PriceLines and E.PriceLines(realm, id) or {}
  if #lines == 0 then return "No Everloot price for that item on this realm yet." end
  local out = {}
  for _, line in ipairs(lines) do out[#out + 1] = line.text end
  return table.concat(out, "\n")
end

function T.Refresh()
  if T.panel and T.panel.status then T.panel.status:SetText(table.concat(T.StatusLines(), "\n")) end
end

function T.Show()
  if not T.panel then return end
  T.panel:Show()
  T.Refresh()
end

function T.Hide()
  if T.panel then T.panel:Hide() end
end

local function text(parent, font, width)
  local s = parent:CreateFontString(nil, "OVERLAY", font)
  if width then s:SetWidth(width) end
  s:SetJustifyH("LEFT")
  return s
end

local function buildPanel(house)
  local panel = CreateFrame("Frame", "EverlootAuctionPanel", house, "BackdropTemplate")
  panel:SetPoint("TOPLEFT", house, "TOPLEFT", 8, -60)
  panel:SetPoint("BOTTOMRIGHT", house, "BOTTOMRIGHT", -8, 28)
  local level = house.GetFrameLevel and house:GetFrameLevel()
  if type(level) == "number" then panel:SetFrameLevel(level + 20) end
  if panel.EnableMouse then panel:EnableMouse(true) end
  if panel.SetBackdrop then
    panel:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = true, tileSize = 16, edgeSize = 12, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
  end
  local title = text(panel, "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", 16, -14)
  title:SetText("Everloot")
  local intro = text(panel, "GameFontHighlightSmall", 420)
  intro:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -8)
  intro:SetText("One click reads this house's prices. They show in your tooltips at once and reach everloot.app when "
    .. "your file is saved: Share now or log out, and the Desktop App sends it. A price counts on the site once three players agree.")

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

  local status = text(panel, "GameFontHighlight", 420)
  status:SetPoint("TOPLEFT", scanButton, "BOTTOMLEFT", 0, -10)
  panel.status = status

  local label = text(panel, "GameFontNormal")
  label:SetPoint("TOPLEFT", status, "BOTTOMLEFT", 0, -18)
  label:SetText("Look up a price")
  local box = CreateFrame("EditBox", "EverlootAuctionLookup", panel, "InputBoxTemplate")
  box:SetSize(260, 20)
  box:SetPoint("TOPLEFT", label, "BOTTOMLEFT", 6, -6)
  if box.SetAutoFocus then box:SetAutoFocus(false) end
  local result = text(panel, "GameFontHighlightSmall", 420)
  result:SetPoint("TOPLEFT", box, "BOTTOMLEFT", -6, -8)
  box:SetScript("OnEnterPressed", function(self)
    result:SetText(T.Lookup(self:GetText()))
    self:ClearFocus()
  end)
  box:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  panel.lookup, panel.result = box, result

  local footer = text(panel, "GameFontDisableSmall", 420)
  footer:SetPoint("BOTTOMLEFT", 16, 12)
  footer:SetText("Full history and other realms: " .. T.SITE)

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
