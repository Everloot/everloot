-- Everloot window: a home for what this file already holds. The character, gold on hand and where the gold
-- module saw it come from, gold per hour from the gph session, professions with their skill bars and how many
-- rows each kind of record has. Built the first time it opens (minimap button or /everloot window), never at
-- load, and it registers no events: recording runs whether this window exists, works or is turned off.
-- Every build and refresh runs inside pcall; an error closes this window for the session, not the addon.
-- Display only: it reads, the buttons call the commands the player could type, and nothing here records.

local E = Everloot
local U = { view = "home" }
E.Window = U

U.CREST = "Interface\\AddOns\\Everloot\\media\\crest"

local FRIZ, NARROW = "Fonts\\FRIZQT__.TTF", "Fonts\\ARIALN.TTF"
local COLORS = {
  canvas = { 0.055, 0.059, 0.051, 0.97 }, surface = { 0.082, 0.09, 0.102, 1 }, line = { 0.17, 0.176, 0.157, 1 },
  bronze = { 0.478, 0.416, 0.298, 1 }, text = { 0.957, 0.937, 0.867, 1 }, muted = { 0.788, 0.765, 0.69, 1 },
  accent = { 0.612, 0.941, 0.227, 1 },
}

-- In sidebar order. `view` shows a line in the window; `open` hands over to another part of the addon.
U.NAV = {
  { key = "home", label = "Home", icon = "INV_Misc_Book_09" },
  { key = "gold", label = "Gold", icon = "INV_Misc_Coin_02", open = function() E.GphCommand("show") end },
  { key = "professions", label = "Professions", icon = "Trade_BlackSmithing",
    view = "Coming soon. Open a profession window and Everloot reads its recipe colours; Home shows your skill." },
  { key = "collection", label = "Collection", icon = "INV_Misc_Bag_10",
    view = "Coming soon. /everloot completion on reads your achievements, reputation, titles and quests." },
  { key = "auctions", label = "Auctions", icon = "INV_Misc_Note_01",
    view = "Coming soon here. At the auction house the Everloot tab scans prices, and /everloot price [item] shows one." },
  { key = "ask", label = "Ask", icon = "INV_Misc_QuestionMark",
    view = "Coming soon here. Type /ask and a question; the Desktop App answers it and /reload shows the answer." },
  { key = "plan", label = "Build plan", icon = "INV_Misc_Book_11", open = function() E.Planner.Open() end },
  { key = "settings", label = "Settings", icon = "Trade_Engineering", bottom = true, open = function() E.Options.Open() end },
}

-- What the gold module records, in the order the ledger line names them. Spending is shown as a minus.
U.SOURCES = {
  { "loot", "Loot" }, { "quest", "Quests" }, { "vendor", "Vendors" }, { "auction", "Auctions" },
  { "flight", "Flights", true }, { "auction_spend", "Buyouts", true }, { "postage", "Postage", true },
}

-- "What you've added": rows of each kind in the saved file now.
U.ADDED = {
  { "loot", "Loot windows" }, { "npc_sighting", "NPC sightings" }, { "quest", "Quests" }, { "recipe_observed", "Recipe colours" },
  { "item_fact", "Item facts" }, { "auction_scan", "Auction scans" }, { "census_seen", "Players seen" }, { "map_bounds", "Zones mapped" },
}

-- A game call's values, each one a secret value would be read as missing; nothing when the call errors.
local function readable(fn, ...)
  if type(fn) ~= "function" then return nil end
  local result = { n = 0 }
  local function keep(...) result.n = select("#", ...); for i = 1, result.n do result[i] = (select(i, ...)) end end
  keep(pcall(fn, ...))
  if not result[1] then return nil end
  for i = 2, result.n do result[i] = E.Readable(result[i]) end
  return unpack(result, 2, result.n)
end

local function count(n)
  local text = tostring(n)
  while true do
    local done
    text, done = text:gsub("^(%d+)(%d%d%d)", "%1,%2")
    if done == 0 then return text end
  end
end

--- Copper with the game's coin icons: "38g 12s 40c" drawn as coins, gold and silver left out below them.
function U.Money(copper)
  if type(copper) ~= "number" then return "-" end
  local sign = copper < 0 and "-" or ""
  copper = math.abs(math.floor(copper))
  local function coin(n, name) return n .. "|TInterface\\MoneyFrame\\UI-" .. name .. "Icon:0:0:2:0|t" end
  local gold, silver, rest = math.floor(copper / 10000), math.floor(copper % 10000 / 100), copper % 100
  local parts = {}
  if gold > 0 then parts[#parts + 1] = coin(gold, "Gold") end
  if gold > 0 or silver > 0 then parts[#parts + 1] = coin(silver, "Silver") end
  parts[#parts + 1] = coin(rest, "Copper")
  return sign .. table.concat(parts, " ")
end

local function minutes(seconds)
  if seconds < 3600 then return math.floor(seconds / 60) .. " min" end
  return string.format("%d h %d min", math.floor(seconds / 3600), math.floor(seconds % 3600 / 60))
end

--- Everything Home shows, read now from the client and the saved file. A value that cannot be read is nil,
--- and the window draws a dash: nothing is estimated.
function U.HomeData()
  local d = {}
  local name = readable(UnitName, "player")
  local realm = readable(GetRealmName)
  local className, classFile = readable(UnitClass, "player")
  local race = readable(UnitRace, "player")
  local level = readable(UnitLevel, "player")
  d.name = type(name) == "string" and name ~= "" and name or nil
  d.realm = type(realm) == "string" and realm ~= "" and realm or nil
  d.className = type(className) == "string" and className or nil
  d.classFile = type(classFile) == "string" and classFile or nil
  d.race = type(race) == "string" and race or nil
  d.level = type(level) == "number" and level > 0 and level or nil

  local copper = readable(GetMoney)
  d.onHand = type(copper) == "number" and copper >= 0 and copper or nil
  d.peak = type(EverlootDB.goldPeak) == "number" and EverlootDB.goldPeak or nil
  -- Money events are the player's own, one character at a time: only this character's are summed.
  local totals = {}
  for _, row in ipairs(EverlootDB.records.money_event or {}) do
    if type(row) == "table" and row.character == d.name and row.realm == d.realm and type(row.copper) == "number" then
      totals[row.category] = (totals[row.category] or 0) + row.copper
    end
  end
  d.sources = {}
  if d.name and d.realm then
    for _, s in ipairs(U.SOURCES) do
      if totals[s[1]] then d.sources[#d.sources + 1] = { label = s[2], copper = s[3] and -totals[s[1]] or totals[s[1]] } end
    end
  end

  d.gph = U.GphData()
  d.professions = U.Professions()
  d.added = {}
  for _, a in ipairs(U.ADDED) do d.added[#d.added + 1] = { label = a[2], n = E:Count(a[1]) } end
  return d
end

--- The gph session: { running, seconds, perHour }, or nil when the module is missing or no session exists.
function U.GphData()
  local G = E.Gph
  local s = type(EverlootDB.gph) == "table" and EverlootDB.gph.current
  if not (G and G.Summary and type(s) == "table") then return nil end
  local sum = G.Summary(s)
  return { running = s.runningSince ~= nil, seconds = sum.seconds, perHour = sum.perHour }
end

--- The character's professions from the game's profession book, with the recipe colours this file holds for each.
--- Nil when the client has no profession book.
function U.Professions()
  if type(GetProfessions) ~= "function" or type(GetProfessionInfo) ~= "function" then return nil end
  local indices = { readable(GetProfessions) }
  local recipes = {}
  for _, row in ipairs(EverlootDB.records.recipe_observed or {}) do
    if type(row) == "table" and type(row.profession) == "string" then recipes[row.profession] = (recipes[row.profession] or 0) + 1 end
  end
  local out = {}
  for i = 1, 6 do
    local index = indices[i]
    if index then
      local name, icon, rank, maxRank = readable(GetProfessionInfo, index)
      if type(name) == "string" and name ~= "" and type(rank) == "number" then
        out[#out + 1] = { name = name, icon = icon, rank = rank, maxRank = type(maxRank) == "number" and maxRank > 0 and maxRank or nil,
          recipes = recipes[name] }
      end
    end
  end
  return out
end

-- Widgets ---------------------------------------------------------------------------------------------------

local function fill(frame, color, layer)
  local t = frame:CreateTexture(nil, layer or "BACKGROUND")
  t:SetAllPoints()
  t:SetColorTexture(unpack(color))
  return t
end

local function text(parent, size, font, color)
  local s = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  if s.SetFont then pcall(s.SetFont, s, font or FRIZ, size or 12, "") end
  if s.SetShadowOffset then s:SetShadowOffset(1, -1); s:SetShadowColor(0, 0, 0, 1) end
  s:SetJustifyH("LEFT")
  s:SetTextColor(unpack(color or COLORS.text))
  return s
end

local function icon(parent, size, path)
  local t = parent:CreateTexture(nil, "ARTWORK")
  t:SetSize(size, size)
  t:SetTexture(path)
  t:SetTexCoord(0.08, 0.92, 0.08, 0.92)
  return t
end

-- A panel inside the window: the surface colour and a one-pixel line around it.
local function box(parent, x, y, w, h)
  local b = CreateFrame("Frame", nil, parent)
  b:SetPoint("TOPLEFT", x, y)
  b:SetSize(w, h)
  fill(b, COLORS.surface)
  for _, edge in ipairs({ { "TOPLEFT", "TOPRIGHT", w, 1 }, { "BOTTOMLEFT", "BOTTOMRIGHT", w, 1 },
    { "TOPLEFT", "BOTTOMLEFT", 1, h }, { "TOPRIGHT", "BOTTOMRIGHT", 1, h } }) do
    local t = b:CreateTexture(nil, "BORDER")
    t:SetPoint(edge[1]); t:SetPoint(edge[2])
    t:SetSize(edge[3], edge[4])
    t:SetColorTexture(unpack(COLORS.line))
  end
  return b
end

local function stat(parent, x, path, caption)
  local i = icon(parent, 28, "Interface\\Icons\\" .. path)
  i:SetPoint("TOPLEFT", x, -10)
  local l = text(parent, 11, FRIZ, COLORS.muted)
  l:SetPoint("TOPLEFT", i, "TOPRIGHT", 8, 1)
  l:SetText(caption)
  local v = text(parent, 15, NARROW, { 1, 1, 1, 1 })
  v:SetPoint("TOPLEFT", l, "BOTTOMLEFT", 0, -2)
  return v
end

local W, H, SIDE, MAIN = 800, 450, 160, 184

local function buildHome(f)
  local home = CreateFrame("Frame", nil, f)
  home:SetPoint("TOPLEFT", MAIN, -48)
  home:SetSize(W - MAIN - 12, H - 60)
  f.home = home

  -- The character.
  local who = box(home, 0, 0, 150, 390)
  local portrait = who:CreateTexture(nil, "ARTWORK")
  portrait:SetPoint("TOP", 0, -14)
  portrait:SetSize(96, 96)
  if SetPortraitTexture then pcall(SetPortraitTexture, portrait, "player") end
  f.portrait = portrait
  f.name = text(who, 16)
  f.name:SetPoint("TOPLEFT", 10, -124)
  f.name:SetWidth(130)
  f.class = text(who, 12, FRIZ, COLORS.muted)
  f.class:SetPoint("TOPLEFT", f.name, "BOTTOMLEFT", 0, -4)
  f.class:SetWidth(130)
  f.realm = text(who, 11, FRIZ, COLORS.muted)
  f.realm:SetPoint("TOPLEFT", f.class, "BOTTOMLEFT", 0, -3)
  f.realm:SetWidth(130)

  -- Gold: on hand, per hour, the peak this install saw; where it came from; the gph session.
  local gold = box(home, 160, 0, 444, 100)
  f.onHand = stat(gold, 10, "INV_Misc_Coin_02", "On hand")
  f.perHour = stat(gold, 158, "INV_Misc_PocketWatch_01", "Gold per hour")
  f.peak = stat(gold, 306, "INV_Misc_Coin_04", "Peak on install")
  f.ledger = text(gold, 11, FRIZ, COLORS.muted)
  f.ledger:SetPoint("TOPLEFT", 10, -50)
  f.ledger:SetWidth(424)
  f.session = text(gold, 12, FRIZ, COLORS.muted)
  f.session:SetPoint("BOTTOMLEFT", 10, 10)
  local toggle = CreateFrame("Button", nil, gold, "UIPanelButtonTemplate")
  toggle:SetSize(74, 20)
  toggle:SetPoint("BOTTOMRIGHT", -8, 6)
  toggle:SetScript("OnClick", function()
    local g = U.GphData()
    pcall(E.GphCommand, (g and g.running) and "pause" or "start")
    pcall(U.Refresh)
  end)
  f.gphButton = toggle

  -- Professions, one bar each.
  local prof = box(home, 160, -110, 444, 146)
  local heading = text(prof, 13)
  heading:SetPoint("TOPLEFT", 10, -8)
  heading:SetText("Professions")
  f.profRows = {}
  for i = 1, 5 do
    local y = -28 - (i - 1) * 23
    local row = { icon = icon(prof, 18, "Interface\\Icons\\INV_Misc_QuestionMark") }
    row.icon:SetPoint("TOPLEFT", 10, y)
    row.name = text(prof, 12)
    row.name:SetPoint("TOPLEFT", 36, y + 1)
    row.name:SetWidth(320)
    local bar = CreateFrame("StatusBar", nil, prof)
    bar:SetPoint("TOPLEFT", 36, y - 13)
    bar:SetSize(320, 5)
    bar:SetStatusBarTexture("Interface\\TargetingFrame\\UI-StatusBar")
    bar:SetStatusBarColor(unpack(COLORS.accent))
    fill(bar, { 0.133, 0.137, 0.114, 1 })
    row.bar = bar
    row.rank = text(prof, 13, NARROW, { 1, 1, 1, 1 })
    row.rank:SetPoint("TOPRIGHT", -10, y - 2)
    row.rank:SetJustifyH("RIGHT")
    f.profRows[i] = row
  end

  -- What this file holds, kind by kind.
  local added = box(home, 160, -266, 444, 124)
  local addedHeading = text(added, 13)
  addedHeading:SetPoint("TOPLEFT", 10, -8)
  addedHeading:SetText("What you've added  |cffc9c3b0rows in your saved file|r")
  f.added = {}
  for i = 1, #U.ADDED do
    local col, line = (i - 1) % 4, math.floor((i - 1) / 4)
    local l = text(added, 11, FRIZ, COLORS.muted)
    l:SetPoint("TOPLEFT", 10 + col * 108, -32 - line * 22)
    l:SetText(U.ADDED[i][2])
    local n = text(added, 13, NARROW, COLORS.accent)
    n:SetPoint("TOPLEFT", 10 + col * 108, -44 - line * 22)
    f.added[i] = n
  end
  local footer = text(added, 10, FRIZ, COLORS.muted)
  footer:SetPoint("BOTTOMLEFT", 10, 8)
  footer:SetText("Nothing leaves this computer until the Desktop App or everloot.app/upload sends it.")
end

local function build()
  if U.frame then return U.frame end
  local ok, f = pcall(CreateFrame, "Frame", "EverlootWindow", UIParent, "BackdropTemplate")
  if not ok or not f then f = CreateFrame("Frame", "EverlootWindow", UIParent) end
  -- Hidden from the start: a build that stops halfway leaves nothing on screen.
  f:Hide()
  f:SetSize(W, H)
  f:SetPoint("CENTER")
  f:SetFrameStrata("HIGH")
  f:SetMovable(true)
  f:SetClampedToScreen(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function(self) self:StartMoving() end)
  f:SetScript("OnDragStop", function(self) self:StopMovingOrSizing() end)
  -- Everloot's dark panel inside the stock tooltip edge, tinted bronze.
  if f.SetBackdrop then
    f:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = false, edgeSize = 14, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    f:SetBackdropColor(unpack(COLORS.canvas))
    f:SetBackdropBorderColor(unpack(COLORS.bronze))
  else
    fill(f, COLORS.canvas)
  end

  -- The crest breaks out of the top-left corner.
  local crest = f:CreateTexture(nil, "OVERLAY")
  crest:SetSize(64, 64)
  crest:SetPoint("TOPLEFT", -20, 22)
  crest:SetTexture(U.CREST)
  f.crest = crest

  local title = text(f, 17)
  title:SetPoint("TOPLEFT", 54, -16)
  title:SetText("Everloot")
  f.subtitle = text(f, 12, FRIZ, COLORS.muted)
  f.subtitle:SetPoint("LEFT", title, "RIGHT", 10, -1)
  local close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", -2, -2)
  f.close = close

  -- The sidebar: game icons, fel green only on the item that is open.
  f.nav = {}
  local top, bottom = 0, 0
  for _, item in ipairs(U.NAV) do
    local b = CreateFrame("Button", nil, f)
    b:SetSize(SIDE, 30)
    if item.bottom then
      b:SetPoint("BOTTOMLEFT", 12, 14 + bottom * 32); bottom = bottom + 1
    else
      b:SetPoint("TOPLEFT", 12, -48 - top * 32); top = top + 1
    end
    local on = b:CreateTexture(nil, "BACKGROUND")
    on:SetAllPoints()
    on:SetColorTexture(COLORS.accent[1], COLORS.accent[2], COLORS.accent[3], 0.14)
    on:Hide()
    b.on = on
    b:SetHighlightTexture("Interface\\Buttons\\WHITE8X8")
    local highlight = b.GetHighlightTexture and b:GetHighlightTexture()
    if highlight then highlight:SetVertexColor(1, 1, 1, 0.05) end
    local i = icon(b, 22, "Interface\\Icons\\" .. item.icon)
    i:SetPoint("LEFT", 5, 0)
    b.label = text(b, 13, FRIZ, COLORS.muted)
    b.label:SetPoint("LEFT", i, "RIGHT", 9, 0)
    b.label:SetText(item.label)
    b:SetScript("OnClick", function() U.Select(item.key) end)
    f.nav[item.key] = b
  end

  buildHome(f)
  f.note = text(f, 13, FRIZ, COLORS.muted)
  f.note:SetPoint("TOPLEFT", MAIN + 4, -56)
  f.note:SetWidth(W - MAIN - 32)

  -- Once a second while shown, so the clock of a running session moves. An error stops the window, never the addon.
  local wait = 0
  f:SetScript("OnUpdate", function(self, dt)
    wait = wait + (dt or 0)
    if wait < 1 then return end
    wait = 0
    if U.view == "home" then
      local okLive, err = pcall(U.RefreshLive)
      if not okLive then U.Fail(err) end
    end
  end)
  if UISpecialFrames then UISpecialFrames[#UISpecialFrames + 1] = "EverlootWindow" end
  U.frame = f
  return f
end

-- Refresh ----------------------------------------------------------------------------------------------------

--- The numbers that move while the window is open: gold on hand and the gold per hour session.
function U.RefreshLive()
  local f = U.frame
  if not (f and f:IsShown()) then return end
  local copper = readable(GetMoney)
  f.onHand:SetText(type(copper) == "number" and U.Money(copper) or "-")
  local g = U.GphData()
  f.perHour:SetText(g and (U.Money(g.perHour) .. " |cffc9c3b0/h|r") or "-")
  if g and g.running then
    f.session:SetText("|cff9cf03aRunning|r  " .. minutes(g.seconds))
    f.gphButton:SetText("Pause")
  elseif g then
    f.session:SetText("Paused  " .. minutes(g.seconds))
    f.gphButton:SetText("Resume")
  else
    f.session:SetText("Gold per hour is not running.")
    f.gphButton:SetText("Start")
  end
end

function U.Refresh()
  local f = U.frame
  if not (f and f:IsShown()) then return end
  local d = U.HomeData()
  f.name:SetText(d.name or "-")
  local class = d.className or ""
  local colors = d.classFile and type(RAID_CLASS_COLORS) == "table" and RAID_CLASS_COLORS[d.classFile]
  if class ~= "" and type(colors) == "table" and type(colors.r) == "number" then
    class = string.format("|cff%02x%02x%02x%s|r", colors.r * 255, colors.g * 255, colors.b * 255, class)
  end
  local parts = {}
  if d.level then parts[#parts + 1] = "Level " .. d.level end
  if d.race then parts[#parts + 1] = d.race end
  if class ~= "" then parts[#parts + 1] = class end
  f.class:SetText(#parts > 0 and table.concat(parts, " ") or "-")
  f.realm:SetText(d.realm or "")
  if SetPortraitTexture then pcall(SetPortraitTexture, f.portrait, "player") end

  f.peak:SetText(d.peak and U.Money(d.peak) or "-")
  local ledger = {}
  for _, s in ipairs(d.sources) do
    local amount = E.Coins(math.abs(s.copper)):gsub(" 0c$", "")
    ledger[#ledger + 1] = s.label .. " |cffffffff" .. (s.copper < 0 and "-" or "") .. amount .. "|r"
  end
  f.ledger:SetText(#ledger > 0 and ("Recorded: " .. table.concat(ledger, "   ")) or "No gold sources recorded for this character yet.")

  local profs = d.professions
  for i, row in ipairs(f.profRows) do
    local p = profs and profs[i]
    if p then
      row.icon:SetTexture(p.icon or "Interface\\Icons\\INV_Misc_QuestionMark")
      row.name:SetText(p.name .. (p.recipes and ("  |cffc9c3b0" .. count(p.recipes) .. " recipe colours recorded|r") or ""))
      row.bar:SetMinMaxValues(0, p.maxRank or math.max(p.rank, 1))
      row.bar:SetValue(p.rank)
      row.rank:SetText(p.rank .. (p.maxRank and (" / " .. p.maxRank) or ""))
      row.icon:Show(); row.name:Show(); row.bar:Show(); row.rank:Show()
    else
      row.icon:Hide(); row.bar:Hide(); row.rank:Hide()
      if i == 1 then
        row.name:SetText(profs and "No professions learned." or "-")
        row.name:Show()
      else
        row.name:Hide()
      end
    end
  end

  for i, a in ipairs(d.added) do f.added[i]:SetText(count(a.n)) end
  U.RefreshLive()
end

--- Shows one sidebar item: Home, a short line, or the part of the addon it opens.
function U.Select(key)
  local item
  for _, n in ipairs(U.NAV) do if n.key == key then item = n end end
  if not item then return end
  if item.open then
    if not pcall(item.open) then print("Everloot: " .. item.label .. " is not available in this client.") end
    return
  end
  U.view = key
  local f = U.frame
  for k, b in pairs(f.nav) do
    if k == key then b.on:Show(); b.label:SetTextColor(unpack(COLORS.text))
    else b.on:Hide(); b.label:SetTextColor(unpack(COLORS.muted)) end
  end
  f.subtitle:SetText(item.label)
  if key == "home" then
    f.note:Hide(); f.home:Show()
    local ok, err = pcall(U.Refresh)
    if not ok then U.Fail(err) end
  else
    f.home:Hide(); f.note:SetText(item.view); f.note:Show()
  end
end

--- An error inside the window: it closes and stays closed this session, and /everloot status says why.
function U.Fail(err)
  U.failed = tostring(err)
  if U.frame then pcall(U.frame.Hide, U.frame) end
  E:SetNote("window", "error, closed until /reload: " .. U.failed)
  print("Everloot: the window hit an error and closed until /reload. Recording is not affected. /everloot status says more.")
end

--- Opens the window on Home (or another sidebar item). False when it is off, failed this session or cannot build,
--- so the caller can fall back to what it opened before.
function U.Open(key)
  if not E:IsEnabled("window") then
    print("Everloot: the window is off. Turn it on in /everloot options.")
    return false
  end
  if U.failed then return false end
  local ok, err = pcall(build)
  if not ok or not U.frame then
    U.Fail(err or "the window could not be built")
    return false
  end
  local width = UIParent and UIParent.GetWidth and tonumber(UIParent:GetWidth())
  local height = UIParent and UIParent.GetHeight and tonumber(UIParent:GetHeight())
  if width and height then pcall(U.frame.SetScale, U.frame, math.min(1, (width - 32) / W, (height - 32) / H)) end
  U.frame:Show()
  local shown, why = pcall(U.Select, key or U.view or "home")
  if not shown then U.Fail(why); return false end
  return not U.failed
end

function U.Toggle()
  if U.frame and U.frame:IsShown() then U.frame:Hide(); return true end
  return U.Open()
end

E:RegisterModule("window", function()
  return "ready (built when first opened: the minimap button or /everloot window)"
end)
