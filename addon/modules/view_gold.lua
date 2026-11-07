-- Everloot window, Gold: every character's gold by realm with the last 30 days as bars, the ledger by category,
-- day and receipt, auction sales one by one or by item, and the gold per hour session. It reads the roster
-- (roster.lua), the ledger store (ledger.lua) and the gph session (gph.lua) and displays them.
-- Display only: it reads, the session buttons run the gph commands the player could type, and nothing here
-- records. It registers no events; the window builds it the first time Gold is opened.

local E = Everloot
if not (E.Window and E.Window.Views and E.Ledger and E.Roster) then return end
local U = E.Window
local COLORS, NARROW, text, surface = U.COLORS, U.NARROW, U.Text, U.Surface

local W = 604          -- the view frame window.lua gives every view (W - MAIN - 12 wide)
local ROWS, ROW_H = 12, 18
local TABS = { { "overview", "Overview" }, { "ledger", "Ledger" }, { "sales", "Sales" }, { "session", "Session" } }
local PERIODS = { { "today", "Today" }, { "7d", "7 days" }, { "30d", "30 days" }, { "all", "All" } }
local SCOPES = { { "character", "This character", 110 }, { "account", "Account", 80 } }
local NO_EVENTS = "Nothing recorded in this period."
local NO_SALES = "No auction sales recorded yet. Collect an auction letter at the mailbox and it appears here."

local refresh

-- A click redraws the view; an error closes the window as any other view error does.
local function redraw()
  local ok, err = pcall(refresh, U.frame)
  if not ok then U.Fail(err) end
end

local function box(parent, x, y, w, h)
  local b = CreateFrame("Frame", nil, parent)
  b:SetPoint("TOPLEFT", x, y)
  b:SetSize(w, h)
  return surface(b)
end

local function button(parent, label, w, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(w, 20)
  b:SetText(label)
  b:SetScript("OnClick", function() onClick(); redraw() end)
  return b
end

local function lit(b, on)
  if on then b:LockHighlight() else b:UnlockHighlight() end
end

-- A panel of ROWS rows under a heading. Columns are { field, x, width, right aligned }; each row keeps one font
-- string per field. Up and Down page through a longer list.
local function list(parent, x, y, w, h, title, columns)
  local b = box(parent, x, y, w, h)
  local rows = { offset = 0 }
  rows.head = text(b, 12)
  rows.head:SetPoint("TOPLEFT", 8, -6)
  rows.head:SetText(title)
  for i = 1, ROWS do
    local row = CreateFrame("Button", nil, b)
    row:SetPoint("TOPLEFT", 4, -24 - (i - 1) * ROW_H)
    row:SetSize(w - 8, ROW_H)
    for _, c in ipairs(columns) do
      local s = text(row, 11, NARROW)
      s:SetPoint("LEFT", c[2], 0)
      s:SetWidth(c[3])
      if c[4] then s:SetJustifyH("RIGHT") end
      if s.SetWordWrap then s:SetWordWrap(false) end
      row[c[1]] = s
    end
    rows[i] = row
  end
  rows.empty = text(b, 11, nil, COLORS.muted)
  rows.empty:SetPoint("TOPLEFT", 8, -28)
  rows.empty:SetWidth(w - 16)
  rows.up = button(b, "Up", 48, function() rows.offset = math.max(0, rows.offset - ROWS) end)
  rows.up:SetPoint("BOTTOMRIGHT", -58, 6)
  rows.down = button(b, "Down", 48, function() rows.offset = rows.offset + ROWS end)
  rows.down:SetPoint("BOTTOMRIGHT", -6, 6)
  return rows, b
end

-- Fills a list from `items` at its offset; `draw(row, item)` sets one row. With no items, the empty line.
local function show(rows, items, draw, empty)
  local n = #items
  rows.offset = math.min(rows.offset, math.floor(math.max(n - 1, 0) / ROWS) * ROWS)
  for i, row in ipairs(rows) do
    local item = items[rows.offset + i]
    if item then draw(row, item); row:Show() else row:Hide() end
  end
  rows.empty:SetText(empty)
  if n == 0 then rows.empty:Show() else rows.empty:Hide() end
  if rows.offset > 0 then rows.up:Show() else rows.up:Hide() end
  if rows.offset + ROWS < n then rows.down:Show() else rows.down:Hide() end
end

local function signed(copper, direction)
  return U.Money(direction == "out" and -copper or copper)
end

local function label(category)
  return E.Ledger.LABELS[category] or category
end

-- This character's key, or every key in the roster.
local function keysFor(scope)
  if scope ~= "account" then return { E.Roster.Current() } end
  local keys = {}
  for _, r in ipairs(E.Roster.Rows()) do keys[#keys + 1] = r.key end
  return keys
end

local function drawOverview(g, keys)
  local items, realm, header, account = {}, nil, nil, nil
  g.realmTotals = {}
  for _, r in ipairs(E.Roster.Rows()) do
    if not header or r.realm ~= realm then
      realm = r.realm
      header = { name = realm or "-", header = true }
      items[#items + 1] = header
    end
    items[#items + 1] = { name = r.name or "-", copper = r.copper }
    if type(r.copper) == "number" then
      header.copper = (header.copper or 0) + r.copper
      account = (account or 0) + r.copper
      if realm then g.realmTotals[realm] = header.copper end
    end
  end
  g.accountTotal = account
  show(g.rows, items, function(row, item)
    row.name:SetText(item.name)
    row.name:SetTextColor(unpack(item.header and COLORS.muted or COLORS.text))
    row.gold:SetText(U.Money(item.copper))
  end, "No characters recorded yet.")
  g.total:SetText(#items > 0 and ("All characters  " .. U.Money(account)) or "")

  local series = E.Ledger.Series(keys, 30)
  local high
  for _, d in ipairs(series) do
    if d.copper and (not high or d.copper > high) then high = d.copper end
  end
  local max = high and high > 0 and high or 1
  for i, bar in ipairs(g.bars) do
    local copper = series[i] and series[i].copper
    bar:SetMinMaxValues(0, max)
    bar:SetValue(copper or 0)
    bar:SetStatusBarColor(unpack(copper and COLORS.accent or COLORS.muted))
  end
  g.chartHigh:SetText("Highest  " .. U.Money(high))
  g.chartCaption:SetText("Last 30 days · " .. (g.scope == "account" and "Account" or "This character"))
end

local function drawLedger(g, keys)
  local sum = E.Ledger.Summary(keys, E.Ledger.Period(g.period))
  show(g.categories, sum.categories, function(row, c)
    row.label:SetText(label(c.category))
    row.amount:SetText(signed(c.copper, c.direction))
    row.count:SetText(c.events .. (c.events == 1 and " event" or " events"))
  end, NO_EVENTS)

  -- Newest day first; the selected day stays selected while it is in the period, else the newest is.
  local days, kept = {}, false
  for i = #sum.days, 1, -1 do
    days[#days + 1] = sum.days[i]
    if sum.days[i].date == g.day then kept = true end
  end
  if not kept then g.day = days[1] and days[1].date end
  show(g.days, days, function(row, d)
    row.day = d.date
    row.date:SetText(d.date)
    row.date:SetTextColor(unpack(d.date == g.day and COLORS.accent or COLORS.text))
    row["in"]:SetText(U.Money(d.inCopper))
    row.out:SetText(U.Money(d.outCopper))
    row.net:SetText(U.Money(d.net))
  end, NO_EVENTS)

  g.receipts.head:SetText(g.day and ("Receipts  " .. g.day) or "Receipts")
  show(g.receipts, g.day and sum.receipts(g.day) or {}, function(row, r)
    local what = label(r.category)
    if r.itemName then what = what .. " · " .. r.itemName .. (r.count and (" × " .. r.count) or "") end
    row.when:SetText(date("!%H:%M", r.at))
    row.label:SetText(what)
    row.amount:SetText(signed(r.copper, r.direction))
  end, NO_EVENTS)
  g.unrecorded:SetText("Unrecorded: " .. U.Money(sum.unrecorded))
end

local STATUS_TEXT = { paid = "paid", pending = "sold, gold pending", unmatched = "unmatched" }

local function drawSales(g, keys)
  local from, to = E.Ledger.Period(g.period)
  local sales = g.grouped and E.Ledger.SalesByItem(keys, from, to) or E.Ledger.Sales(keys, from, to)
  show(g.sales, sales, function(row, s)
    local priced = type(s.count) == "number" and type(s.total) == "number"
    row.item:SetText(s.itemName)
    row.count:SetText(priced and ("× " .. s.count) or "-")
    row.unit:SetText(priced and U.Money(s.unit) or "-")
    row.total:SetText(priced and U.Money(s.total) or "-")
    if g.grouped then
      row.when:SetText(s.sales .. (s.sales == 1 and " sale" or " sales"))
      row.status:SetText("")
    else
      row.when:SetText(date("!%Y-%m-%d %H:%M", s.at))
      row.status:SetText(STATUS_TEXT[s.status] or "-")
    end
  end, NO_SALES)
  g.groupButton:SetText(g.grouped and "Each sale" or "By item")
end

local function gphSession()
  local s = type(EverlootDB.gph) == "table" and EverlootDB.gph.current
  return type(s) == "table" and s or nil
end

local function drawSession(g)
  local ok, lines = pcall(E.Gph and E.Gph.Lines)
  g.session:SetText(ok and type(lines) == "table" and table.concat(lines, "\n") or "-")
  local s = gphSession()
  g.sessionButton:SetText(not s and "Start" or (s.runningSince and "Pause" or "Resume"))
end

function refresh(f)
  local g = f.gold
  for _, t in ipairs(TABS) do
    lit(g.tabs[t[1]], t[1] == g.tab)
    if t[1] == g.tab then g.pages[t[1]]:Show() else g.pages[t[1]]:Hide() end
  end
  -- The period counts for the ledger and sales; the session has neither period nor scope.
  for _, p in ipairs(PERIODS) do
    local b = g.periods[p[1]]
    lit(b, p[1] == g.period)
    if g.tab == "ledger" or g.tab == "sales" then b:Show() else b:Hide() end
  end
  for _, s in ipairs(SCOPES) do
    local b = g.scopes[s[1]]
    lit(b, s[1] == g.scope)
    if g.tab ~= "session" then b:Show() else b:Hide() end
  end
  local keys = keysFor(g.scope)
  if g.tab == "overview" then drawOverview(g, keys)
  elseif g.tab == "ledger" then drawLedger(g, keys)
  elseif g.tab == "sales" then drawSales(g, keys)
  else drawSession(g) end
end

local function build(f, parent)
  local g = { tab = "overview", period = "30d", scope = "character", grouped = false,
    tabs = {}, periods = {}, scopes = {}, pages = {}, bars = {} }
  f.gold = g
  local function reset()
    for _, rows in ipairs({ g.rows, g.categories, g.days, g.receipts, g.sales }) do rows.offset = 0 end
    g.day = nil
  end

  -- Tabs at the top, the period and scope under them, the open tab's page from -64 down.
  for i, t in ipairs(TABS) do
    g.tabs[t[1]] = button(parent, t[2], 90, function() g.tab = t[1] end)
    g.tabs[t[1]]:SetPoint("TOPLEFT", (i - 1) * 94, -8)
    local page = CreateFrame("Frame", nil, parent)
    page:SetPoint("TOPLEFT", 0, -64)
    page:SetSize(W, 326)
    g.pages[t[1]] = page
  end
  for i, p in ipairs(PERIODS) do
    g.periods[p[1]] = button(parent, p[2], 64, function() g.period = p[1]; reset() end)
    g.periods[p[1]]:SetPoint("TOPLEFT", (i - 1) * 68, -36)
  end
  local right = 0
  for i = #SCOPES, 1, -1 do
    local s = SCOPES[i]
    g.scopes[s[1]] = button(parent, s[2], s[3], function() g.scope = s[1]; reset() end)
    g.scopes[s[1]]:SetPoint("TOPRIGHT", -right, -36)
    right = right + s[3] + 4
  end

  -- Overview: characters by realm, and the scope's closing gold for the last 30 days.
  local o = g.pages.overview
  local roster
  g.rows, roster = list(o, 0, 0, 290, 300, "Characters", { { "name", 6, 150 }, { "gold", 150, 126, true } })
  g.total = text(roster, 12)
  g.total:SetPoint("BOTTOMLEFT", 8, 10)
  local chart = box(o, 296, 0, 308, 300)
  g.chartHigh = text(chart, 11, nil, COLORS.muted)
  g.chartHigh:SetPoint("TOPLEFT", 10, -8)
  for i = 1, 30 do
    local bar = CreateFrame("StatusBar", nil, chart)
    bar:SetPoint("BOTTOMLEFT", 19 + (i - 1) * 9, 40)
    bar:SetSize(7, 220)
    bar:SetOrientation("VERTICAL")
    bar:SetStatusBarTexture("Interface\\TargetingFrame\\UI-StatusBar")
    local back = bar:CreateTexture(nil, "BACKGROUND")
    back:SetAllPoints()
    back:SetColorTexture(0.133, 0.137, 0.114, 1)
    g.bars[i] = bar
  end
  g.chartCaption = text(chart, 12)
  g.chartCaption:SetPoint("BOTTOMLEFT", 10, 14)

  -- Ledger: by category, by day, and the receipts of the day picked.
  local l = g.pages.ledger
  g.categories = list(l, 0, 0, 196, 290, "By category",
    { { "label", 4, 80 }, { "amount", 84, 62, true }, { "count", 148, 40, true } })
  g.days = list(l, 202, 0, 228, 290, "By day  |cffc9c3b0in, out, net|r",
    { { "date", 4, 58 }, { "in", 64, 52, true }, { "out", 118, 50, true }, { "net", 170, 52, true } })
  for _, row in ipairs(g.days) do
    row:SetScript("OnClick", function(self) g.day = self.day; g.receipts.offset = 0; redraw() end)
  end
  g.receipts = list(l, 436, 0, 168, 290, "Receipts",
    { { "when", 4, 30 }, { "label", 36, 76 }, { "amount", 112, 52, true } })
  g.unrecorded = text(l, 12, nil, COLORS.muted)
  g.unrecorded:SetPoint("TOPLEFT", 4, -300)

  -- Sales, newest first, or one row per item.
  local salesBox
  g.sales, salesBox = list(g.pages.sales, 0, 0, W, 300, "Auction sales",
    { { "item", 4, 190 }, { "count", 198, 50 }, { "unit", 252, 90, true }, { "total", 346, 90, true },
      { "when", 446, 100 }, { "status", 550, 44 } })
  g.groupButton = button(salesBox, "By item", 90, function() g.grouped = not g.grouped; g.sales.offset = 0 end)
  g.groupButton:SetPoint("BOTTOMLEFT", 6, 6)

  -- Session: the gph lines, moving once a second while this tab is open.
  local sb = box(g.pages.session, 0, 0, W, 200)
  g.session = text(sb, 12)
  g.session:SetPoint("TOPLEFT", 10, -10)
  g.session:SetWidth(W - 20)
  g.session:SetJustifyV("TOP")
  g.sessionButton = button(sb, "Start", 90, function()
    local s = gphSession()
    pcall(E.GphCommand, not s and "start" or (s.runningSince and "pause" or "resume"))
  end)
  g.sessionButton:SetPoint("BOTTOMLEFT", 10, 10)
  g.stopButton = button(sb, "Stop", 90, function() pcall(E.GphCommand, "stop") end)
  g.stopButton:SetPoint("LEFT", g.sessionButton, "RIGHT", 6, 0)
  local wait = 0
  parent:SetScript("OnUpdate", function(_, dt)
    wait = wait + (dt or 0)
    if wait < 1 or g.tab ~= "session" then return end
    wait = 0
    local ok, err = pcall(drawSession, g)
    if not ok then U.Fail(err) end
  end)
end

U.Views.gold = { build = build, refresh = refresh }
