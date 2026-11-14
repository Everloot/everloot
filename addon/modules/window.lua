-- Everloot window: a home for what this file already holds. The character and what it is missing, gold on hand and
-- where the gold module saw it come from, this character's and the account's week from the ledger, gold per hour
-- from the gph session, professions with their skill bars and every character the roster holds. Built the first
-- time it opens (minimap button or /everloot window), never at
-- load, and it registers no events: recording runs whether this window exists, works or is turned off.
-- Every build and refresh runs inside pcall; an error closes this window for the session, not the addon.
-- Display only: it reads, the buttons call the commands the player could type, and nothing here records.

local E = Everloot
local U = { view = "home" }
E.Window = U

U.CREST = "Interface\\AddOns\\Everloot\\media\\crest"

-- The client's own fonts, so ruRU and CJK clients draw their letters; the Latin files are the fallback.
local FRIZ = (type(STANDARD_TEXT_FONT) == "string" and STANDARD_TEXT_FONT) or "Fonts\\FRIZQT__.TTF"
local NARROW = "Fonts\\ARIALN.TTF"
do
  local ok, path = pcall(function() return NumberFontNormal:GetFont() end)
  if ok and type(path) == "string" and path ~= "" then NARROW = path end
end
local COLORS = {
  canvas = { 0.055, 0.059, 0.051, 0.97 }, surface = { 0.082, 0.09, 0.102, 1 }, line = { 0.17, 0.176, 0.157, 1 },
  bronze = { 0.478, 0.416, 0.298, 1 }, text = { 0.957, 0.937, 0.867, 1 }, muted = { 0.788, 0.765, 0.69, 1 },
  accent = { 0.612, 0.941, 0.227, 1 },
}

-- In sidebar order. A view is looked up in U.Views by key when it is selected; `open` hands over to another part
-- of the addon. Files loaded after this one fill U.Views.
U.NAV = {
  { key = "home", label = "Home", icon = "INV_Misc_Book_09" },
  { key = "gold", label = "Gold", icon = "INV_Misc_Coin_02" },
  { key = "collection", label = "Collection", icon = "INV_Misc_Bag_10" },
  { key = "professions", label = "Professions", icon = "Trade_BlackSmithing" },
  { key = "settings", label = "Settings", icon = "Trade_Engineering", bottom = true },
}

-- A view is { build = function(f, parent) end, refresh = function(f) end }, keyed like U.NAV. It is built once, the
-- first time it is selected, into a frame stored at f.views[key].
U.Views = {
  settings = {
    build = function(_, parent) E.Options.BuildWindow(parent) end,
    refresh = function() E.Options.Refresh() end,
  },
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

local function coinIcon(n, name) return n .. "|TInterface\\MoneyFrame\\UI-" .. name .. "Icon:0:0:2:0|t" end

--- Copper for a list cell: at most the two largest coins, "12g 34s", "34s 56c" or "56c", drawn as coins.
function U.MoneyShort(copper)
  if type(copper) ~= "number" then return "-" end
  local sign = copper < 0 and "-" or ""
  copper = math.abs(math.floor(copper))
  local gold, silver, rest = math.floor(copper / 10000), math.floor(copper % 10000 / 100), copper % 100
  if gold > 0 then return sign .. coinIcon(gold, "Gold") .. " " .. coinIcon(silver, "Silver") end
  if silver > 0 then return sign .. coinIcon(silver, "Silver") .. " " .. coinIcon(rest, "Copper") end
  return sign .. coinIcon(rest, "Copper")
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
  d.gph = U.GphData()
  d.professions = U.Professions()
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
  local out = {}
  for i = 1, 6 do
    local index = indices[i]
    if index then
      local name, icon, rank, maxRank = readable(GetProfessionInfo, index)
      if type(name) == "string" and name ~= "" and type(rank) == "number" then
        out[#out + 1] = { name = name, icon = icon, rank = rank, maxRank = type(maxRank) == "number" and maxRank > 0 and maxRank or nil }
      end
    end
  end
  return out
end

-- This character's rows of one owned kind, by the catalog id in `field`, as the Collection view reads them.
local function ownedById(kind, key, field)
  local out = {}
  for _, r in ipairs(E:Rows(kind)) do
    if type(r) == "table" and r.characterKey == key and r[field] ~= nil then out[r[field]] = r end
  end
  return out
end

--- What this character has not done yet, counted from the rows Collection and Professions already read: catalog
--- achievements not completed, catalog factions not exalted, catalog titles not held, professions in the book with
--- no recipe recorded, and this week's raid lockouts with bosses left. A count the file cannot give is nil: the
--- tracker counts while the completion tracker is off, a catalog with no rows yet, the recipes without a profession
--- book. Nil when the character cannot be identified. Nothing here estimates or records.
function U.MissingData()
  local ok, key = pcall(E.CharacterKey)
  if not (ok and key) then return nil end
  local d = {}
  local profs = U.Professions()
  if profs then
    local read = {}
    for _, r in ipairs(E:Rows("recipe_observed")) do
      if type(r) == "table" and type(r.profession) == "string" then read[r.profession] = true end
    end
    d.recipes = 0
    for _, p in ipairs(profs) do if not read[p.name] then d.recipes = d.recipes + 1 end end
  end
  if not E:IsEnabled("completion") then return d end

  local done = ownedById("achievement_owned", key, "achievementId")
  for _, a in ipairs(E:Rows("achievement_catalog")) do
    if type(a) == "table" then
      local o = done[a.achievementId]
      d.achievements = (d.achievements or 0) + ((o and o.completed == true) and 0 or 1)
    end
  end
  local standing = ownedById("reputation_owned", key, "factionId")
  for _, r in ipairs(E:Rows("reputation_catalog")) do
    if type(r) == "table" and not r.major then
      local o = standing[r.factionId]
      d.factions = (d.factions or 0) + ((o and type(o.reaction) == "number" and o.reaction >= 8) and 0 or 1)
    end
  end
  local held = {}
  for _, r in ipairs(E:Rows("title_owned")) do
    if type(r) == "table" and r.characterKey == key and type(r.titleIds) == "table" then
      for _, id in ipairs(r.titleIds) do held[id] = true end
    end
  end
  for _, t in ipairs(E:Rows("title_catalog")) do
    if type(t) == "table" then d.titles = (d.titles or 0) + (held[t.titleId] and 0 or 1) end
  end
  -- A lockout whose reset time has passed is gone in the game too; one with every boss down is not missing.
  local now = date("!%Y-%m-%dT%H:%M:%SZ", time())
  d.raids = 0
  for _, r in ipairs(E:Rows("lockout_owned")) do
    if type(r) == "table" and r.characterKey == key and type(r.resetAt) == "string" and r.resetAt > now then
      local cleared = type(r.bossesKilledCount) == "number" and type(r.bossesTotal) == "number" and r.bossesKilledCount >= r.bossesTotal
      if not cleared then d.raids = d.raids + 1 end
    end
  end
  return d
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

-- The surface colour and a one-pixel line around a frame: the panels inside this window, the list of switches on
-- the settings page and the price lookup at the auction house.
local EDGES = { { "TOPLEFT", "TOPRIGHT", true }, { "BOTTOMLEFT", "BOTTOMRIGHT", true },
  { "TOPLEFT", "BOTTOMLEFT" }, { "TOPRIGHT", "BOTTOMRIGHT" } }
local function surface(b)
  fill(b, COLORS.surface)
  for _, edge in ipairs(EDGES) do
    local t = b:CreateTexture(nil, "BORDER")
    t:SetPoint(edge[1]); t:SetPoint(edge[2])
    if edge[3] then t:SetHeight(1) else t:SetWidth(1) end
    t:SetColorTexture(unpack(COLORS.line))
  end
  return b
end

-- A panel inside the window.
local function box(parent, x, y, w, h)
  local b = CreateFrame("Frame", nil, parent)
  b:SetPoint("TOPLEFT", x, y)
  b:SetSize(w, h)
  return surface(b)
end

-- Everloot's dark panel inside the stock tooltip edge, tinted bronze. A frame without the backdrop API gets the
-- dark colour alone.
local function backdrop(f)
  if f.SetBackdrop then
    f:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = false, edgeSize = 14, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    f:SetBackdropColor(unpack(COLORS.canvas))
    f:SetBackdropBorderColor(unpack(COLORS.bronze))
  else
    fill(f, COLORS.canvas)
  end
end

-- The heading of the settings page and the auction house tab: a small crest, Everloot in fel green as in the
-- tooltip, and the page's name in muted text. The caller places the crest; the words follow it.
local function heading(parent, subtitle)
  local crest = parent:CreateTexture(nil, "ARTWORK")
  crest:SetSize(28, 28)
  crest:SetTexture(U.CREST)
  local title = text(parent, 16, FRIZ, COLORS.accent)
  title:SetPoint("LEFT", crest, "RIGHT", 6, 0)
  title:SetText("Everloot")
  local sub = text(parent, 12, FRIZ, COLORS.muted)
  sub:SetPoint("LEFT", title, "RIGHT", 8, -1)
  sub:SetText(subtitle or "")
  return crest, title, sub
end

-- The look the settings page and the auction house tab borrow. This file loads after theirs, so they read it when
-- they build; using it creates nothing here. Without this file they keep the game's own frames and fonts.
U.COLORS, U.NARROW = COLORS, NARROW
U.Text, U.Surface, U.Backdrop, U.Heading = text, surface, backdrop, heading

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

-- The Missing strip on Home: { key in U.MissingData, the line's label, the sidebar item a click opens }, in order.
-- The recipes line comes from the professions module and shows with the tracker off; the rest need it on.
U.MISSING = {
  { key = "achievements", label = "Achievements left", view = "collection" },
  { key = "factions", label = "Factions not exalted", view = "collection" },
  { key = "titles", label = "Titles not held", view = "collection" },
  { key = "recipes", label = "Recipes to read", view = "professions", tracker = false },
  { key = "raids", label = "Raids not cleared", view = "collection" },
}
local MISSING_TOP, MISSING_LINE = 190, 16
local TRACKER_OFF = "The completion tracker is off: achievements, factions, titles and raid lockouts are not read."
local TRACKER_TURNED_ON = "Turned on. /reload to start reading."

-- The roster list on Home: { field, x, width, right aligned, heading }.
U.ROSTER_ROWS = 10
U.ROSTER_COLUMNS = {
  { "name", 4, 88, false, "Name" }, { "level", 94, 22, true, "Lv" }, { "gold", 120, 100, true, "Gold" },
  { "profs", 224, 104, false, "Professions" }, { "lockouts", 332, 46, false, "Raids" }, { "seen", 382, 54, false, "Seen" },
}

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

  -- What this character is missing, under the realm line: one line per count, each opening the tab that lists it.
  -- The lines are packed from the top at each refresh, the tracker-off note and its button after them.
  local m = { lines = {} }
  f.missing = m
  m.title = text(who, 12)
  m.title:SetPoint("TOPLEFT", 10, -MISSING_TOP)
  m.title:SetText("Missing")
  for i, item in ipairs(U.MISSING) do
    local b = CreateFrame("Button", nil, who)
    b:SetSize(138, MISSING_LINE)
    b:SetHighlightTexture("Interface\\Buttons\\WHITE8X8")
    local highlight = b.GetHighlightTexture and b:GetHighlightTexture()
    if highlight then highlight:SetVertexColor(1, 1, 1, 0.05) end
    b.label = text(b, 11, NARROW)
    b.label:SetPoint("LEFT", 4, 0)
    b.label:SetWidth(130)
    if b.label.SetWordWrap then b.label:SetWordWrap(false) end
    b:SetScript("OnClick", function() U.Select(item.view) end)
    m.lines[i] = b
  end
  m.off = text(who, 11, FRIZ, COLORS.muted)
  m.off:SetWidth(130)
  m.off:SetJustifyV("TOP")
  m.turnOn = CreateFrame("Button", nil, who, "UIPanelButtonTemplate")
  m.turnOn:SetSize(90, 20)
  m.turnOn:SetPoint("TOPLEFT", m.off, "BOTTOMLEFT", 0, -6)
  m.turnOn:SetText("Turn on")
  m.turnOn:SetScript("OnClick", function()
    pcall(SlashCmdList.EVERLOOT, "completion on")
    if E:IsEnabled("completion") then m.turnedOn = true end
    local ok, err = pcall(U.Refresh)
    if not ok then U.Fail(err) end
  end)

  -- Gold: on hand, per hour, the peak this install saw; this character's week and the account's; the gph session.
  local gold = box(home, 160, 0, 444, 104)
  f.onHand = stat(gold, 10, "INV_Misc_Coin_02", "On hand")
  f.perHour = stat(gold, 158, "INV_Misc_PocketWatch_01", "Gold per hour")
  f.peak = stat(gold, 306, "INV_Misc_Coin_04", "Peak on install")
  f.week = text(gold, 12, FRIZ, COLORS.muted)
  f.week:SetPoint("TOPLEFT", 10, -50)
  f.week:SetWidth(424)
  f.weekAccount = text(gold, 12, FRIZ, COLORS.muted)
  f.weekAccount:SetPoint("TOPLEFT", f.week, "BOTTOMLEFT", 0, -2)
  f.weekAccount:SetWidth(424)
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

  -- Professions, one bar each, five across.
  local prof = box(home, 160, -110, 444, 55)
  f.profRows = {}
  for i = 1, 5 do
    local x = 6 + (i - 1) * 87
    local row = { icon = icon(prof, 14, "Interface\\Icons\\INV_Misc_QuestionMark") }
    row.icon:SetPoint("TOPLEFT", x, -7)
    row.name = text(prof, 11)
    row.name:SetPoint("TOPLEFT", x + 18, -7)
    row.name:SetWidth(64)
    if row.name.SetWordWrap then row.name:SetWordWrap(false) end
    local bar = CreateFrame("StatusBar", nil, prof)
    bar:SetPoint("TOPLEFT", x, -25)
    bar:SetSize(80, 5)
    bar:SetStatusBarTexture("Interface\\TargetingFrame\\UI-StatusBar")
    bar:SetStatusBarColor(unpack(COLORS.accent))
    fill(bar, { 0.133, 0.137, 0.114, 1 })
    row.bar = bar
    row.rank = text(prof, 11, NARROW, { 1, 1, 1, 1 })
    row.rank:SetPoint("TOPLEFT", x, -33)
    row.rank:SetWidth(80)
    f.profRows[i] = row
  end

  -- Every character the roster holds, by realm: 10 rows at a time, Up and Down for more.
  local roster = box(home, 160, -175, 444, 215)
  local r = { rows = {}, realmTotals = {}, offset = 0 }
  f.roster = r
  local title = text(roster, 12)
  title:SetPoint("TOPLEFT", 8, -6)
  title:SetText("Characters")
  for _, c in ipairs(U.ROSTER_COLUMNS) do
    local head = text(roster, 10, FRIZ, COLORS.muted)
    head:SetPoint("TOPLEFT", 4 + c[2], -22)
    head:SetWidth(c[3])
    if c[4] then head:SetJustifyH("RIGHT") end
    head:SetText(c[5])
  end
  for i = 1, U.ROSTER_ROWS do
    local row = CreateFrame("Frame", nil, roster)
    row:SetPoint("TOPLEFT", 4, -36 - (i - 1) * 16)
    row:SetSize(436, 16)
    for _, c in ipairs(U.ROSTER_COLUMNS) do
      local s = text(row, 11, NARROW)
      s:SetPoint("LEFT", c[2], 0)
      s:SetWidth(c[3])
      if c[4] then s:SetJustifyH("RIGHT") end
      if s.SetWordWrap then s:SetWordWrap(false) end
      row[c[1]] = s
    end
    r.rows[i] = row
  end
  r.empty = text(roster, 11, nil, COLORS.muted)
  r.empty:SetPoint("TOPLEFT", 8, -40)
  r.empty:SetText("No characters recorded yet.")
  r.accountTotal = text(roster, 12)
  r.accountTotal:SetPoint("BOTTOMLEFT", 8, 5)
  local function page(delta)
    r.offset = math.max(0, r.offset + delta * U.ROSTER_ROWS)
    local ok, err = pcall(U.Refresh)
    if not ok then U.Fail(err) end
  end
  r.up = CreateFrame("Button", nil, roster, "UIPanelButtonTemplate")
  r.up:SetSize(48, 18)
  r.up:SetPoint("TOPRIGHT", -58, -3)
  r.up:SetText("Up")
  r.up:SetScript("OnClick", function() page(-1) end)
  r.down = CreateFrame("Button", nil, roster, "UIPanelButtonTemplate")
  r.down:SetSize(48, 18)
  r.down:SetPoint("TOPRIGHT", -6, -3)
  r.down:SetText("Down")
  r.down:SetScript("OnClick", function() page(1) end)
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
  backdrop(f)

  -- The crest breaks out of the top-left corner.
  local crest = f:CreateTexture(nil, "OVERLAY")
  crest:SetSize(64, 64)
  crest:SetPoint("TOPLEFT", -20, 22)
  crest:SetTexture(U.CREST)
  f.crest = crest

  -- Everloot in fel green, as the tooltip, the settings page and the auction house tab write it.
  local title = text(f, 17, FRIZ, COLORS.accent)
  title:SetPoint("TOPLEFT", 54, -16)
  title:SetText("Everloot")
  f.title = title
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
  f.views = {}
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

-- "<label>: +<in> / -<out>" for the keys over the last seven days, or "<label>: -" without keys or the ledger.
local function weekText(label, keys)
  local L = E.Ledger
  if not (type(keys) == "table" and #keys > 0 and L and L.Summary and L.Period) then return label .. ": -" end
  local ok, sum = pcall(function() return L.Summary(keys, L.Period("7d")) end)
  if not ok or type(sum) ~= "table" or type(sum.totalIn) ~= "number" or type(sum.totalOut) ~= "number" then return label .. ": -" end
  return label .. ": +" .. U.Money(sum.totalIn) .. " / -" .. U.Money(sum.totalOut)
end

--- "This week: +<in> / -<out>" for this character over the last seven days, or "This week: -" when the key or
--- the ledger is missing.
function U.WeekLine()
  local key = E.Roster and E.Roster.Current()
  return weekText("This week", key and { key } or nil)
end

--- "Account this week: +<in> / -<out>" over every character in the roster, as the Gold tab's Account scope sums
--- them, or "Account this week: -" when the roster is empty or the ledger is missing.
function U.AccountWeekLine()
  local ok, rows = false, nil
  if E.Roster and E.Roster.Rows then ok, rows = pcall(E.Roster.Rows) end
  local keys = {}
  for _, r in ipairs(ok and type(rows) == "table" and rows or {}) do keys[#keys + 1] = r.key end
  return weekText("Account this week", keys)
end

--- The Missing strip: the lines the file can count, packed from the top, then the tracker-off note and its button.
function U.RefreshMissing()
  local f = U.frame
  local m = f.missing
  local d = U.MissingData()
  local on = E:IsEnabled("completion")
  local slot = 0
  for i, item in ipairs(U.MISSING) do
    local b = m.lines[i]
    if item.tracker == false or on then
      local n = d and d[item.key]
      b.label:SetText(item.label .. ": " .. (type(n) == "number" and tostring(n) or "-"))
      b:SetPoint("TOPLEFT", 6, -(MISSING_TOP + MISSING_LINE + slot * MISSING_LINE))
      b:Show()
      slot = slot + 1
    else
      b:Hide()
    end
  end
  if on and not m.turnedOn then
    m.off:Hide(); m.turnOn:Hide()
    return
  end
  m.off:SetPoint("TOPLEFT", 10, -(MISSING_TOP + MISSING_LINE + slot * MISSING_LINE + 2))
  m.off:SetText(m.turnedOn and TRACKER_TURNED_ON or TRACKER_OFF)
  m.off:Show()
  if m.turnedOn then m.turnOn:Hide() else m.turnOn:Show() end
end

-- Raid lockouts exist only while the completion tracker is on; "-" when it is off or the character has none. A
-- lockout whose reset time has passed is gone in the game too, as in the Collection view.
local function lockoutText(key)
  if not E:IsEnabled("completion") then return "-" end
  local now = date("!%Y-%m-%dT%H:%M:%SZ", time())
  local n = 0
  for _, row in ipairs(E:Rows("lockout_owned")) do
    if type(row) == "table" and row.characterKey == key and type(row.resetAt) == "string" and row.resetAt > now then n = n + 1 end
  end
  return n > 0 and (n .. (n == 1 and " raid" or " raids")) or "-"
end

local function professionText(list)
  local parts = {}
  for _, p in ipairs(type(list) == "table" and list or {}) do
    if type(p) == "table" and type(p.name) == "string" then
      parts[#parts + 1] = p.name .. (type(p.rank) == "number" and (" " .. p.rank) or "")
    end
  end
  return #parts > 0 and table.concat(parts, ", ") or "-"
end

-- The class colour, else the plain text colour.
local function classColor(token)
  local c = type(token) == "string" and type(RAID_CLASS_COLORS) == "table" and RAID_CLASS_COLORS[token]
  if type(c) == "table" and type(c.r) == "number" and type(c.g) == "number" and type(c.b) == "number" then return c.r, c.g, c.b, 1 end
  return unpack(COLORS.text)
end

--- Home's list of characters: a line per realm with its gold, then its characters; the account total under it.
function U.RefreshRoster()
  local f = U.frame
  local r = f.roster
  local ok, rows = false, nil
  if E.Roster and E.Roster.Rows then ok, rows = pcall(E.Roster.Rows) end
  if not (ok and type(rows) == "table") then rows = {} end
  local current = E.Roster and E.Roster.Current()
  local items, realm, header, account = {}, nil, nil, nil
  r.realmTotals = {}
  for _, c in ipairs(rows) do
    if not header or c.realm ~= realm then
      realm = c.realm
      header = { header = true, realm = realm or "-" }
      items[#items + 1] = header
      r.realmTotals[header.realm] = header
    end
    items[#items + 1] = c
    if type(c.copper) == "number" then
      header.copper = (header.copper or 0) + c.copper
      account = (account or 0) + c.copper
    end
  end
  for _, h in pairs(r.realmTotals) do h.text = h.realm .. " · " .. U.Money(h.copper) end
  r.accountTotal:SetText("Account: " .. U.Money(account))

  local n = #items
  r.offset = math.min(r.offset, math.floor(math.max(n - 1, 0) / U.ROSTER_ROWS) * U.ROSTER_ROWS)
  for i, row in ipairs(r.rows) do
    local item = items[r.offset + i]
    if not item then
      row:Hide()
    else
      for _, c in ipairs(U.ROSTER_COLUMNS) do row[c[1]]:SetText("") end
      if item.header then
        row.name:SetText(item.text)
        row.name:SetWidth(430)
        row.name:SetTextColor(unpack(COLORS.muted))
      else
        row.name:SetWidth(88)
        row.name:SetText(item.name or "-")
        if item.key == current then row.name:SetTextColor(unpack(COLORS.accent))
        else row.name:SetTextColor(classColor(item.class)) end
        row.level:SetText(type(item.level) == "number" and tostring(item.level) or "-")
        row.gold:SetText(U.MoneyShort(item.copper))
        row.profs:SetText(professionText(item.professions))
        row.lockouts:SetText(lockoutText(item.key))
        row.seen:SetText(type(item.lastSeen) == "number" and date("!%Y-%m-%d", item.lastSeen) or "-")
      end
      row:Show()
    end
  end
  if n == 0 then r.empty:Show() else r.empty:Hide() end
  if r.offset > 0 then r.up:Show() else r.up:Hide() end
  if r.offset + U.ROSTER_ROWS < n then r.down:Show() else r.down:Hide() end
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
  f.week:SetText(U.WeekLine())
  f.weekAccount:SetText(U.AccountWeekLine())
  U.RefreshMissing()

  local profs = d.professions
  for i, row in ipairs(f.profRows) do
    local p = profs and profs[i]
    if p then
      row.icon:SetTexture(p.icon or "Interface\\Icons\\INV_Misc_QuestionMark")
      row.name:SetText(p.name)
      row.name:SetWidth(64)
      row.bar:SetMinMaxValues(0, p.maxRank or math.max(p.rank, 1))
      row.bar:SetValue(p.rank)
      row.rank:SetText(p.rank .. (p.maxRank and (" / " .. p.maxRank) or ""))
      row.icon:Show(); row.name:Show(); row.bar:Show(); row.rank:Show()
    else
      row.icon:Hide(); row.bar:Hide(); row.rank:Hide()
      if i == 1 then
        row.name:SetText(profs and "No professions learned." or "-")
        row.name:SetWidth(400)
        row.name:Show()
      else
        row.name:Hide()
      end
    end
  end

  U.RefreshRoster()
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
  for _, v in pairs(f.views) do v:Hide() end
  if key == "home" then
    f.note:Hide(); f.home:Show()
    local ok, err = pcall(U.Refresh)
    if not ok then U.Fail(err) end
    return
  end
  f.home:Hide()
  local view = U.Views[key]
  if not view then
    f.note:SetText("This part of Everloot did not load. /everloot status says why."); f.note:Show()
    return
  end
  if not f.views[key] then
    local parent = CreateFrame("Frame", nil, f)
    parent:SetPoint("TOPLEFT", MAIN, -48)
    parent:SetSize(W - MAIN - 12, H - 60)
    parent:Hide()
    local ok, err = pcall(view.build, f, parent)
    if not ok then U.Fail(err); return end
    f.views[key] = parent
  end
  f.note:Hide()
  f.views[key]:Show()
  local ok, err = pcall(view.refresh, f)
  if not ok then U.Fail(err) end
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
