-- Everloot window, Gold: every character's gold by realm with the period's days as bars, the ledger by category,
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
-- The days each period covers: the chart draws one bar per day, and the by-item rate divides by it. "All" is the
-- ledger's own 90-day window.
local PERIOD_DAYS = { today = 1, ["7d"] = 7, ["30d"] = 30, all = 90 }
local PERIOD_CAPTION = { today = "Today", ["7d"] = "Last 7 days", ["30d"] = "Last 30 days", all = "Last 90 days" }
local MAX_BARS = 90
local CHART_LEFT, CHART_WIDTH = 10, 288   -- the bars' left edge and the width they share inside the 308 px chart
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

-- A panel of `count` rows (ROWS when not given) under a heading. Columns are { field, x, width, right aligned }
-- and together fill the row, which is w - 8 wide; each row keeps one font string per field. Up and Down page
-- through a longer list.
local function list(parent, x, y, w, h, title, columns, count)
  local b = box(parent, x, y, w, h)
  local rows = { offset = 0, size = count or ROWS }
  rows.head = text(b, 12)
  rows.head:SetPoint("TOPLEFT", 8, -6)
  rows.head:SetText(title)
  for i = 1, rows.size do
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
  rows.up = button(b, "Up", 48, function() rows.offset = math.max(0, rows.offset - rows.size) end)
  rows.up:SetPoint("BOTTOMRIGHT", -58, 6)
  rows.down = button(b, "Down", 48, function() rows.offset = rows.offset + rows.size end)
  rows.down:SetPoint("BOTTOMRIGHT", -6, 6)
  return rows, b
end

-- Fills a list from `items` at its offset; `draw(row, item)` sets one row. With no items, the empty line.
local function show(rows, items, draw, empty)
  local n = #items
  rows.offset = math.min(rows.offset, math.floor(math.max(n - 1, 0) / rows.size) * rows.size)
  for i, row in ipairs(rows) do
    local item = items[rows.offset + i]
    if item then draw(row, item); row:Show() else row:Hide() end
  end
  rows.empty:SetText(empty)
  if n == 0 then rows.empty:Show() else rows.empty:Hide() end
  if rows.offset > 0 then rows.up:Show() else rows.up:Hide() end
  if rows.offset + rows.size < n then rows.down:Show() else rows.down:Hide() end
end

-- List cells use the short money text (two coins at most); the totals under the lists keep the full one.
local function signed(copper, direction)
  return U.MoneyShort(direction == "out" and -copper or copper)
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

-- Days the per-day averages divide by. A fixed period has its own length; "All" counts the UTC days from the first
-- event in scope through today, at least 1 and at most the ledger's 90, so a young ledger is not averaged over days
-- it never had.
local function averageDays(period, firstAt, now)
  if period ~= "all" then return PERIOD_DAYS[period] or 30 end
  if not firstAt then return 1 end
  return math.min(PERIOD_DAYS.all, math.max(1, math.floor(now / 86400) - math.floor(firstAt / 86400) + 1))
end

local function drawSummary(g, keys)
  local now = time()
  if g.summaryPeriod == g.period and g.summaryScope == g.scope and g.revision == E.Ledger.revision
    and g.utcDay == math.floor(now / 86400) and not (g.pendingExpiry and now > g.pendingExpiry) then return end
  local from, to = E.Ledger.Period(g.period)
  local sum = E.Ledger.Summary(keys, from, to)
  local days = averageDays(g.period, sum.firstAt, now)
  g.summaryCaption:SetText((PERIOD_CAPTION[g.period] or "Last 30 days") .. " · " .. (g.scope == "account" and "Account" or "This character"))
  for _, entry in ipairs({ { "earned", sum.totalIn }, { "spent", sum.totalOut }, { "profit", sum.totalIn - sum.totalOut } }) do
    g[entry[1]]:SetText(U.MoneyShort(entry[2]))
    g[entry[1] .. "Average"]:SetText(U.MoneyShort(entry[2] / days) .. "/day")
  end
  local pending = 0
  g.pendingExpiry = nil
  for _, sale in ipairs(E.Ledger.Sales(keys, from, to)) do
    if sale.status == "pending" then
      pending = pending + 1
      local expires = sale.at + E.Ledger.PENDING_SECONDS
      if not g.pendingExpiry or expires < g.pendingExpiry then g.pendingExpiry = expires end
    end
  end
  g.pending:SetText(pending > 0 and ("plus " .. pending .. " pending") or "")
  for _, entry in ipairs({ { "topEarned", "Top earning" }, { "topSpent", "Top spending" } }) do
    local item = sum[entry[1]]
    g[entry[1]]:SetText(entry[2] .. ": " .. (item and (item.itemName .. "  " .. U.MoneyShort(item.copper)) or "-"))
  end
  g.revision, g.utcDay = E.Ledger.revision, math.floor(time() / 86400)
  g.summaryPeriod, g.summaryScope = g.period, g.scope
end

local function drawOverview(g, keys)
  drawSummary(g, keys)
  local days = PERIOD_DAYS[g.period] or 30
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
    row.gold:SetText(U.MoneyShort(item.copper))
  end, "No characters recorded yet.")
  g.total:SetText(#items > 0 and ("All characters  " .. U.Money(account)) or "")

  -- One bar per day of the period, sharing the chart's width; the bars past the period stay hidden.
  local series = E.Ledger.Series(keys, days)
  local high
  for _, d in ipairs(series) do
    if d.copper and (not high or d.copper > high) then high = d.copper end
  end
  local max = high and high > 0 and high or 1
  local step = CHART_WIDTH / days
  local width = math.max(1, step - (step >= 6 and 2 or 1))
  for i, bar in ipairs(g.bars) do
    if i <= days then
      local copper = series[i] and series[i].copper
      bar:SetPoint("BOTTOMLEFT", CHART_LEFT + (i - 1) * step, 40)
      bar:SetSize(width, 110)
      bar:SetMinMaxValues(0, max)
      bar:SetValue(copper or 0)
      bar:SetStatusBarColor(unpack(copper and COLORS.accent or COLORS.muted))
      bar:Show()
    else
      bar:Hide()
    end
  end
  g.chartHigh:SetText("Highest  " .. U.Money(high))
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
    row["in"]:SetText(U.MoneyShort(d.inCopper))
    row.out:SetText(U.MoneyShort(d.outCopper))
    row.net:SetText(U.MoneyShort(d.net))
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
  -- The account's totals leave out gold moved between its own characters; this line says how much that was.
  if g.scope == "account" then
    g.moved:SetText("Moved between your characters: " .. U.Money((sum.moved or 0) > 0 and sum.moved or nil))
    g.moved:Show()
  else
    g.moved:Hide()
  end
end

local STATUS_TEXT = { paid = "paid", pending = "sold, gold pending", unmatched = "unmatched" }

-- By item, each row's rate is its paid sales over the period's days and its last sold day; the sales list is
-- newest first, so the first paid sale of an item is its last.
local function drawSales(g, keys)
  local from, to = E.Ledger.Period(g.period)
  local sales = g.grouped and E.Ledger.SalesByItem(keys, from, to) or E.Ledger.Sales(keys, from, to)
  local lastSold = {}
  if g.grouped then
    for _, s in ipairs(E.Ledger.Sales(keys, from, to)) do
      if s.status == "paid" and not lastSold[s.itemName] then lastSold[s.itemName] = s.at end
    end
  end
  local days = PERIOD_DAYS[g.period] or 30
  show(g.sales, sales, function(row, s)
    local priced = type(s.count) == "number" and type(s.total) == "number"
    row.item:SetText(s.itemName)
    row.count:SetText(priced and ("× " .. s.count) or "-")
    row.unit:SetText(priced and U.MoneyShort(s.unit) or "-")
    row.total:SetText(priced and U.MoneyShort(s.total) or "-")
    if g.grouped then
      row.deposit:SetText("")
      row.cut:SetText("")
      row.when:SetText(s.sales .. (s.sales == 1 and " sale" or " sales"))
      local last = lastSold[s.itemName]
      row.status:SetText(string.format("%.1f/day", s.sales / days) .. (last and (" · " .. date("!%m-%d", last)) or ""))
    else
      row.deposit:SetText(type(s.deposit) == "number" and U.MoneyShort(s.deposit) or "-")
      row.cut:SetText(type(s.cut) == "number" and U.MoneyShort(s.cut) or "-")
      row.when:SetText(date("!%m-%d %H:%M", s.at))
      row.status:SetText(STATUS_TEXT[s.status] or "-")
    end
  end, NO_SALES)
  g.sales.head:SetText(g.grouped and "Auction sales by item  |cffc9c3b0sales, per day · last sold|r" or "Auction sales")
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
  -- The period counts for the overview chart, the ledger and sales; the session has neither period nor scope.
  for _, p in ipairs(PERIODS) do
    local b = g.periods[p[1]]
    lit(b, p[1] == g.period)
    if g.tab ~= "session" then b:Show() else b:Hide() end
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

  -- Overview: characters by realm, and the scope's closing gold over the period, one bar a day. The bars are
  -- built once for the longest period; drawOverview places the period's own and hides the rest.
  local o = g.pages.overview
  g.summaryBox = box(o, 0, 0, W, 112)
  local function summaryText(field, x, y, width, size, color)
    local s = text(g.summaryBox, size or 11, NARROW, color)
    s:SetPoint("TOPLEFT", x, y)
    s:SetWidth(width)
    if s.SetWordWrap then s:SetWordWrap(false) end
    g[field] = s
    return s
  end
  summaryText("summaryCaption", 8, -6, 400, 12)
  summaryText("pending", 412, -6, 184, 11, COLORS.muted)
  for i, entry in ipairs({ { "earned", "Gold earned" }, { "spent", "Gold spent" }, { "profit", "Profit" } }) do
    local x = 8 + (i - 1) * 196
    summaryText(entry[1] .. "Label", x, -24, 188):SetText(entry[2])
    summaryText(entry[1], x, -40, 188, 12)
    summaryText(entry[1] .. "Average", x, -56, 188, 11, COLORS.muted)
  end
  summaryText("topEarned", 8, -76, W - 16)
  summaryText("topSpent", 8, -92, W - 16)
  local roster
  g.rows, roster = list(o, 0, -118, 290, 190, "Characters", { { "name", 0, 150 }, { "gold", 150, 132, true } }, 7)
  g.total = text(roster, 12)
  g.total:SetPoint("BOTTOMLEFT", 8, 10)
  local chart = box(o, 296, -118, 308, 190)
  g.chartHigh = text(chart, 11, nil, COLORS.muted)
  g.chartHigh:SetPoint("TOPLEFT", 10, -8)
  for i = 1, MAX_BARS do
    local bar = CreateFrame("StatusBar", nil, chart)
    bar:SetPoint("BOTTOMLEFT", CHART_LEFT, 40)
    bar:SetSize(1, 110)
    bar:Hide()
    bar:SetOrientation("VERTICAL")
    bar:SetStatusBarTexture("Interface\\TargetingFrame\\UI-StatusBar")
    local back = bar:CreateTexture(nil, "BACKGROUND")
    back:SetAllPoints()
    back:SetColorTexture(0.133, 0.137, 0.114, 1)
    g.bars[i] = bar
  end

  -- Ledger: by day on the left; by category and the receipts of the day picked stacked on the right, five rows
  -- each, so every money column has room for its coins.
  local l = g.pages.ledger
  g.days = list(l, 0, 0, 306, 290, "By day  |cffc9c3b0in, out, net|r",
    { { "date", 0, 70 }, { "in", 70, 76, true }, { "out", 146, 76, true }, { "net", 222, 76, true } })
  for _, row in ipairs(g.days) do
    row:SetScript("OnClick", function(self) g.day = self.day; g.receipts.offset = 0; redraw() end)
  end
  g.categories = list(l, 312, 0, 292, 142, "By category",
    { { "label", 0, 148 }, { "amount", 148, 76, true }, { "count", 224, 60, true } }, 5)
  g.receipts = list(l, 312, -148, 292, 142, "Receipts",
    { { "when", 0, 34 }, { "label", 34, 174 }, { "amount", 208, 76, true } }, 5)
  g.unrecorded = text(l, 12, nil, COLORS.muted)
  g.unrecorded:SetPoint("TOPLEFT", 4, -300)
  g.moved = text(l, 12, nil, COLORS.muted)
  g.moved:SetPoint("TOPLEFT", 4, -314)

  -- Sales, newest first, or one row per item; the cut is the auction house's, from the invoice.
  local salesBox
  g.sales, salesBox = list(g.pages.sales, 0, 0, W, 300, "Auction sales",
    { { "item", 0, 150 }, { "count", 150, 34 }, { "unit", 184, 68, true }, { "total", 252, 68, true },
      { "deposit", 320, 50, true }, { "cut", 370, 50, true }, { "when", 426, 70 }, { "status", 496, 100 } })
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
    if wait < 1 then return end
    wait = 0
    if g.tab == "overview" then
      -- Only the revision/day check runs while idle; queries run after a mutation or UTC rollover.
      local now = time()
      if g.revision ~= E.Ledger.revision or g.utcDay ~= math.floor(now / 86400)
        or (g.pendingExpiry and now > g.pendingExpiry) then redraw() end
      return
    end
    if g.tab ~= "session" then return end
    local ok, err = pcall(drawSession, g)
    if not ok then U.Fail(err) end
  end)
end

U.Views.gold = { build = build, refresh = refresh }
