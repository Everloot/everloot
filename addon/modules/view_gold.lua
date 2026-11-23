-- Everloot window, Gold: every character's gold by realm with the period's earning and spending as a chart, the
-- ledger by category, day and receipt, auction sales one by one or by item, and the gold per hour session. It reads
-- the roster (roster.lua), the ledger store (ledger.lua) and the gph session (gph.lua) and displays them.
-- Display only: it reads, the session buttons run the gph commands the player could type, and nothing here
-- records. It registers no events; the window builds it the first time Gold is opened.

local E = Everloot
if not (E.Window and E.Window.Views and E.Ledger and E.Roster) then return end
local U = E.Window
local COLORS, NARROW, text, surface = U.COLORS, U.NARROW, U.Text, U.Surface

local W = 604          -- the view frame window.lua gives every view (W - MAIN - 12 wide)
local DAY = 86400
local ROWS, ROW_H = 12, 18
local TABS = { { "overview", "Overview" }, { "ledger", "Ledger" }, { "sales", "Sales" }, { "session", "Session" } }
local PERIODS = { { "today", "Today" }, { "7d", "7 days" }, { "30d", "30 days" }, { "all", "All" } }
-- The days each period covers, for the per-day averages and the by-item rates. "All" is the ledger's own 90-day
-- window.
local PERIOD_DAYS = { today = 1, ["7d"] = 7, ["30d"] = 30, all = 90 }
local PERIOD_CAPTION = { today = "Today", ["7d"] = "Last 7 days", ["30d"] = "Last 30 days", all = "Last 90 days" }
-- The chart's plot inside its 308 x 190 box: 288 px wide from x 10, 110 px tall from y -42. Slots sit on whole
-- pixels; a bar is at most 28 px wide so seven days do not turn into blocks.
local MAX_SLOTS = 90
local PLOT_LEFT, PLOT_WIDTH, PLOT_TOP, PLOT_HEIGHT = 10, 288, -42, 110
local MAX_BAR = 28
local MONTHS = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" }
-- The roster panel's row is 282 wide: a character's name and gold share it, a realm's name has all of it.
local ROSTER_ROW, NAME_W = 282, 150
local SCOPES = { { "character", "This character", 110 }, { "account", "Account", 80 } }
local NO_EVENTS = "Nothing recorded in this period."
local NO_SALES = "No auction sales recorded yet. Collect an auction letter at the mailbox and it appears here."
local MUTED = "|cffc9c3b0"

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

-- The game tooltip beside `owner`: the first line in white, then { label, value } pairs, a lone line in muted text.
local function tooltip(owner, lines)
  if type(GameTooltip) ~= "table" then return end
  GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
  local m = COLORS.muted
  for i, l in ipairs(lines) do
    if l[2] then GameTooltip:AddDoubleLine(l[1], l[2], m[1], m[2], m[3], 1, 1, 1)
    elseif i == 1 then GameTooltip:AddLine(l[1], 1, 1, 1)
    else GameTooltip:AddLine(l[1], m[1], m[2], m[3]) end
  end
  GameTooltip:Show()
end

local function untip()
  if type(GameTooltip) == "table" then GameTooltip:Hide() end
end

-- A panel of `count` rows (ROWS when not given) under a heading. Columns are { field, x, width, right aligned,
-- narrow } and together fill the row, which is w - 8 wide; each row keeps one font string per field. Figures (right
-- aligned or marked narrow) use the narrow font, words Friz. Each column has a caption on the heading line,
-- `captions[field]` or empty. A row with a `tip` shows it on hover. Up and Down page through a longer list.
local function list(parent, x, y, w, h, title, columns, count, captions)
  local b = box(parent, x, y, w, h)
  local rows = { offset = 0, size = count or ROWS, captions = {} }
  rows.head = text(b, 12)
  rows.head:SetPoint("TOPLEFT", 8, -6)
  rows.head:SetText(title)
  for _, c in ipairs(columns) do
    local s = text(b, 12, nil, COLORS.muted)
    s:SetPoint("TOPLEFT", 4 + c[2], -6)
    s:SetWidth(c[3])
    if c[4] then s:SetJustifyH("RIGHT") end
    if s.SetWordWrap then s:SetWordWrap(false) end
    s:SetText(captions and captions[c[1]] or "")
    rows.captions[c[1]] = s
  end
  for i = 1, rows.size do
    local row = CreateFrame("Button", nil, b)
    row:SetPoint("TOPLEFT", 4, -24 - (i - 1) * ROW_H)
    row:SetSize(w - 8, ROW_H)
    for _, c in ipairs(columns) do
      local s = text(row, 12, (c[4] or c[5]) and NARROW or nil)
      s:SetPoint("LEFT", c[2], 0)
      s:SetWidth(c[3])
      if c[4] then s:SetJustifyH("RIGHT") end
      if s.SetWordWrap then s:SetWordWrap(false) end
      row[c[1]] = s
    end
    row:SetScript("OnEnter", function(self) if self.tip then tooltip(self, self.tip) end end)
    row:SetScript("OnLeave", untip)
    rows[i] = row
  end
  rows.empty = text(b, 12, nil, COLORS.muted)
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
    row.tip = nil
    if item then draw(row, item); row:Show() else row:Hide() end
  end
  rows.empty:SetText(empty)
  if n == 0 then rows.empty:Show() else rows.empty:Hide() end
  if rows.offset > 0 then rows.up:Show() else rows.up:Hide() end
  if rows.offset + rows.size < n then rows.down:Show() else rows.down:Hide() end
end

-- One rule for money: gold a character holds (the roster, its totals) to the copper; gold that moved (the summary,
-- the lists) as its two largest coins; tooltips in full.
local function signed(copper, direction)
  return U.MoneyShort(direction == "out" and -copper or copper)
end

local function label(category)
  return E.Ledger.LABELS[category] or category
end

-- "2026-11-07" as "Nov 7".
local function shortDate(ymd)
  local m, d = tostring(ymd):match("^%d+%-(%d+)%-(%d+)$")
  return m and ((MONTHS[tonumber(m)] or m) .. " " .. tonumber(d)) or tostring(ymd)
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
  return math.min(PERIOD_DAYS.all, math.max(1, math.floor(now / DAY) - math.floor(firstAt / DAY) + 1))
end

-- The chart's slots, oldest first, each { label, earned, spent, held }: Today is its 24 UTC hours from the day's
-- receipts, any other period its days from the summary's days with the gold held at each day's close. "All" shows
-- the days since the first event in scope, at least seven. The account leaves gold moved between its own characters
-- out, as the summary does.
local function chartSlots(g, keys, sum, now)
  local slots = {}
  if g.period == "today" then
    local midnight = now - now % DAY
    for h = 1, 24 do slots[h] = { label = string.format("%02d:00 to %02d:00 UTC", h - 1, h), earned = 0, spent = 0 } end
    local netted = #keys > 1
    for _, r in ipairs(sum.receipts(date("!%Y-%m-%d", now))) do
      local slot = slots[math.floor((r.at - midnight) / 3600) + 1]
      if slot and not (netted and r.ownAlt) then
        if r.direction == "out" then slot.spent = slot.spent + r.copper else slot.earned = slot.earned + r.copper end
      end
    end
    return slots
  end
  local n = g.period == "all" and math.max(7, averageDays("all", sum.firstAt, now)) or (PERIOD_DAYS[g.period] or 30)
  local byDate = {}
  for _, d in ipairs(sum.days) do byDate[d.date] = d end
  for i, d in ipairs(E.Ledger.Series(keys, n)) do
    local day = byDate[d.date]
    slots[i] = { label = shortDate(d.date), earned = day and day.inCopper or 0, spent = day and day.outCopper or 0, held = d.copper }
  end
  return slots
end

-- What a slot's tooltip says: when, then earned, spent and net, or that nothing was recorded; the gold held at the
-- day's close when the roster saw it.
local function slotLines(info)
  local lines = { { info.label } }
  if info.earned == 0 and info.spent == 0 then
    lines[2] = { "Nothing recorded" }
  else
    lines[2] = { "Earned", U.Money(info.earned) }
    lines[3] = { "Spent", U.Money(info.spent) }
    lines[4] = { "Net", U.Money(info.earned - info.spent) }
  end
  if info.held then lines[#lines + 1] = { "Gold held", U.Money(info.held) } end
  return lines
end

-- Slot step, bar width, the first slot's x and the bar's inset in its slot for n slots: whole pixels, centred in the
-- plot, two pixels between bars when there is room.
local function grid(n)
  local step = math.floor(PLOT_WIDTH / n)
  local width = math.min(MAX_BAR, step - (step >= 8 and 2 or (step >= 3 and 1 or 0)))
  return step, width, PLOT_LEFT + math.floor((PLOT_WIDTH - step * n) / 2), math.floor((step - width) / 2)
end

-- A bar's height in whole pixels: nothing for nothing, at least one pixel for any amount.
local function barHeight(copper, max, room)
  if copper <= 0 or max <= 0 or room <= 0 then return 0 end
  return math.max(1, math.floor(copper / max * room + 0.5))
end

local function place(bar, width, height)
  if height > 0 then bar:SetSize(width, height); bar:Show() else bar:Hide() end
end

-- Earned goes up from the baseline, spent goes down; the plot's height is split between the largest earning slot and
-- the largest spending slot, so both read on one scale. An empty slot draws nothing and the baseline runs on.
local function drawChart(g, slots, hourly)
  local n = #slots
  local step, width, left, inset = grid(n)
  local maxIn, maxOut = 0, 0
  for _, s in ipairs(slots) do
    if s.earned > maxIn then maxIn = s.earned end
    if s.spent > maxOut then maxOut = s.spent end
  end
  local base = 0
  if maxIn == 0 and maxOut > 0 then base = PLOT_HEIGHT
  elseif maxOut > 0 then
    base = math.min(PLOT_HEIGHT - 1, math.max(1, math.floor(maxOut / (maxIn + maxOut) * PLOT_HEIGHT + 0.5)))
  end
  local up = PLOT_HEIGHT - base
  g.chartBase = base
  for i, slot in ipairs(g.slots) do
    local info = slots[i]
    slot.info = info
    if info then
      slot:SetPoint("TOPLEFT", left + (i - 1) * step, PLOT_TOP)
      slot:SetSize(step, PLOT_HEIGHT)
      slot.earned:SetPoint("BOTTOMLEFT", inset, base)
      slot.spent:SetPoint("TOPLEFT", slot, "BOTTOMLEFT", inset, base)
      place(slot.earned, width, barHeight(info.earned, maxIn, up))
      place(slot.spent, width, barHeight(info.spent, maxOut, base))
      slot:Show()
    else
      slot:Hide()
    end
  end
  local bottom = PLOT_TOP - PLOT_HEIGHT
  g.baseline:SetPoint("TOPLEFT", PLOT_LEFT, bottom + base)
  g.scaleTop:SetText(maxIn > 0 and U.MoneyShort(maxIn) or "")
  g.scaleBottom:SetText(maxOut > 0 and U.MoneyShort(-maxOut) or "")
  if maxIn > 0 then g.guideTop:Show() else g.guideTop:Hide() end
  if maxOut > 0 and base < PLOT_HEIGHT then g.guideBottom:Show() else g.guideBottom:Hide() end
  if maxIn + maxOut == 0 then g.chartEmpty:Show() else g.chartEmpty:Hide() end
  g.chartTitle:SetText(hourly and "Per hour, UTC" or "Per day")

  -- Start, middle and end: the hours at their edges, the days under their slots with the last one "Today".
  local a = g.axis
  local right = left + n * step
  local mid = math.floor((n + 1) / 2)
  local middleX = hourly and (left + 12 * step) or (left + (mid - 1) * step + math.floor(step / 2))
  a.first:SetPoint("TOPLEFT", left, -172)
  a.middle:SetPoint("TOPLEFT", middleX - 40, -172)
  a.last:SetPoint("TOPLEFT", right - 80, -172)
  a.first:SetText(hourly and "00:00" or slots[1].label)
  a.middle:SetText(hourly and "12:00" or slots[mid].label)
  a.last:SetText(hourly and "24:00" or "Today")
end

local function drawSummary(g, keys)
  local now = time()
  if g.summaryPeriod == g.period and g.summaryScope == g.scope and g.revision == E.Ledger.revision
    and g.utcDay == math.floor(now / DAY) and not (g.pendingExpiry and now > g.pendingExpiry) then return end
  local from, to = E.Ledger.Period(g.period)
  local sum = E.Ledger.Summary(keys, from, to)
  local days = averageDays(g.period, sum.firstAt, now)
  g.summaryCaption:SetText((PERIOD_CAPTION[g.period] or "Last 30 days") .. " · " .. (g.scope == "account" and "Account" or "This character"))
  for _, entry in ipairs({ { "earned", sum.totalIn }, { "spent", sum.totalOut }, { "profit", sum.totalIn - sum.totalOut } }) do
    g[entry[1]]:SetText(U.MoneyShort(entry[2]))
    -- Today's total is its own day; a longer period adds its average.
    g[entry[1] .. "Average"]:SetText(g.period == "today" and "" or (U.MoneyShort(entry[2] / days) .. " a day"))
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
  g.pending:SetText(pending > 0 and (pending .. (pending == 1 and " sale" or " sales") .. " awaiting gold") or "")
  for _, field in ipairs({ "topEarned", "topSpent" }) do
    local item = sum[field]
    g[field]:SetText(item and item.itemName or "-")
    g[field .. "Amount"]:SetText(item and U.Money(item.copper) or "")
  end
  drawChart(g, chartSlots(g, keys, sum, now), g.period == "today")
  g.revision, g.utcDay = E.Ledger.revision, math.floor(time() / DAY)
  g.summaryPeriod, g.summaryScope = g.period, g.scope
end

local function drawOverview(g, keys)
  drawSummary(g, keys)
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
  -- A realm line has the whole row for its name and gives its total on hover; a character with no gold is a dash.
  show(g.rows, items, function(row, item)
    row.name:SetText(item.name)
    row.name:SetWidth(item.header and ROSTER_ROW or NAME_W)
    row.name:SetTextColor(unpack(item.header and COLORS.muted or COLORS.text))
    if item.header then
      row.gold:SetText("")
      row.tip = { { item.name }, { "Realm total", U.Money(item.copper) } }
    else
      row.gold:SetText(type(item.copper) == "number" and item.copper > 0 and U.Money(item.copper) or "-")
    end
  end, "No characters recorded yet.")
  g.total:SetText(#items > 0 and ("Total  " .. U.Money(account)) or "")
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

  -- The item first and its category after it in muted text, so a long name cuts the category; hover for all of it.
  g.receipts.head:SetText(g.day and ("Receipts  " .. g.day) or "Receipts")
  show(g.receipts, g.day and sum.receipts(g.day) or {}, function(row, r)
    local what = label(r.category)
    local item = r.itemName and (r.itemName .. (r.count and (" × " .. r.count) or ""))
    row.when:SetText(date("!%H:%M", r.at))
    row.label:SetText(item and (item .. "  " .. MUTED .. what .. "|r") or what)
    row.amount:SetText(signed(r.copper, r.direction))
    row.tip = { { item or what }, { what, U.Money(r.direction == "out" and -r.copper or r.copper) },
      { "Time (UTC)", date("!%Y-%m-%d %H:%M", r.at) } }
  end, NO_EVENTS)
  g.unrecorded:SetText("Gold change not recorded: " .. U.Money(sum.unrecorded))
  -- The account's totals leave out gold moved between its own characters; this line says how much that was.
  if g.scope == "account" then
    g.moved:SetText("Moved between your characters: " .. U.Money((sum.moved or 0) > 0 and sum.moved or nil))
    g.moved:Show()
  else
    g.moved:Hide()
  end
end

local STATUS_TEXT = { paid = "paid", pending = "gold pending", unmatched = "unmatched" }
local SALE_CAPTIONS = { count = "Qty", unit = "Each", total = "Total", deposit = "Deposit", cut = "AH cut", when = "Sold", status = "Status" }
local ITEM_CAPTIONS = { count = "Qty", unit = "Avg each", total = "Total", deposit = "Sales/day", cut = "Units/day", when = "Last sold", status = "" }

-- By item, rates count paid transactions and paid units over the period's days, under their captions; the sales list
-- is newest first, so the first paid sale of an item is its last.
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
    row.tip = { { s.itemName } }
    row.count:SetText(priced and ("× " .. s.count) or "-")
    row.unit:SetText(priced and U.MoneyShort(s.unit) or "-")
    row.total:SetText(priced and U.MoneyShort(s.total) or "-")
    if g.grouped then
      local last = lastSold[s.itemName]
      row.deposit:SetText(string.format("%.1f", s.sales / days))
      row.cut:SetText(string.format("%.1f", s.count / days))
      row.when:SetText(last and date("!%m-%d", last) or "-")
      row.status:SetText("")
    else
      row.deposit:SetText(type(s.deposit) == "number" and U.MoneyShort(s.deposit) or "-")
      row.cut:SetText(type(s.cut) == "number" and U.MoneyShort(s.cut) or "-")
      row.when:SetText(date("!%m-%d %H:%M", s.at))
      row.status:SetText(STATUS_TEXT[s.status] or "-")
    end
  end, NO_SALES)
  g.sales.head:SetText(g.grouped and "Auction sales by item" or "Auction sales")
  for field, caption in pairs(g.grouped and ITEM_CAPTIONS or SALE_CAPTIONS) do g.sales.captions[field]:SetText(caption) end
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

-- A one-pixel line across the plot.
local function rule(chart, color)
  local t = chart:CreateTexture(nil, "ARTWORK")
  t:SetSize(PLOT_WIDTH, 1)
  t:SetColorTexture(unpack(color))
  return t
end

local function build(f, parent)
  local g = { tab = "overview", period = "30d", scope = "character", grouped = false,
    tabs = {}, periods = {}, scopes = {}, pages = {}, slots = {}, axis = {} }
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

  -- Overview: the period's summary, characters by realm, and the period's earning and spending as a chart.
  local o = g.pages.overview
  g.summaryBox = box(o, 0, 0, W, 112)
  local function summaryText(field, x, y, width, size, color, font)
    local s = text(g.summaryBox, size or 12, font, color)
    s:SetPoint("TOPLEFT", x, y)
    s:SetWidth(width)
    if s.SetWordWrap then s:SetWordWrap(false) end
    g[field] = s
    return s
  end
  summaryText("summaryCaption", 8, -6, 400, 12)
  summaryText("pending", 412, -6, 184, 12, COLORS.muted):SetJustifyH("RIGHT")
  -- Three columns as Home's figures are: a muted caption, the amount in 15 px figures, the average a day under it.
  for i, entry in ipairs({ { "earned", "Gold earned" }, { "spent", "Gold spent" }, { "profit", "Profit" } }) do
    local x = 8 + (i - 1) * 196
    summaryText(entry[1] .. "Label", x, -24, 188, 12, COLORS.muted):SetText(entry[2])
    summaryText(entry[1], x, -40, 188, 15, { 1, 1, 1, 1 }, NARROW)
    summaryText(entry[1] .. "Average", x, -60, 188, 12, COLORS.muted)
  end
  -- The top item lines: caption, name and amount side by side, so a long name never pushes the amount off.
  for i, entry in ipairs({ { "topEarned", "Top earning" }, { "topSpent", "Top spending" } }) do
    local y = -78 - (i - 1) * 16
    summaryText(entry[1] .. "Label", 8, y, 92, 12, COLORS.muted):SetText(entry[2])
    summaryText(entry[1], 104, y, 384)
    summaryText(entry[1] .. "Amount", 492, y, 104, 12, nil, NARROW):SetJustifyH("RIGHT")
  end
  local roster
  g.rows, roster = list(o, 0, -118, 290, 190, "Characters", { { "name", 0, NAME_W }, { "gold", NAME_W, ROSTER_ROW - NAME_W, true } }, 7)
  g.total = text(roster, 12)
  g.total:SetPoint("BOTTOMLEFT", 8, 10)

  local chart = box(o, 296, -118, 308, 190)
  g.chartTitle = text(chart, 12, nil, COLORS.muted)
  g.chartTitle:SetPoint("TOPLEFT", PLOT_LEFT, -8)
  -- The legend at the top right: a swatch and a word for each direction.
  local function legend(anchor, offset, word, color)
    local s = text(chart, 12, nil, COLORS.muted)
    if anchor then s:SetPoint("RIGHT", anchor, "LEFT", offset, 0) else s:SetPoint("TOPRIGHT", -PLOT_LEFT, -8) end
    s:SetText(word)
    local swatch = chart:CreateTexture(nil, "ARTWORK")
    swatch:SetSize(8, 8)
    swatch:SetPoint("RIGHT", s, "LEFT", -4, 0)
    swatch:SetColorTexture(unpack(color))
    return s, swatch
  end
  local spentSwatch, earnedSwatch
  g.legendSpent, spentSwatch = legend(nil, 0, "Spent", COLORS.bronze)
  g.legendEarned, earnedSwatch = legend(spentSwatch, -10, "Earned", COLORS.accent)
  g.scaleTop = text(chart, 12, NARROW, COLORS.muted)
  g.scaleTop:SetPoint("TOPLEFT", PLOT_LEFT, PLOT_TOP + 15)
  g.scaleBottom = text(chart, 12, NARROW, COLORS.muted)
  g.scaleBottom:SetPoint("TOPLEFT", PLOT_LEFT, PLOT_TOP - PLOT_HEIGHT - 3)
  g.guideTop = rule(chart, COLORS.line)
  g.guideTop:SetPoint("TOPLEFT", PLOT_LEFT, PLOT_TOP)
  g.guideBottom = rule(chart, COLORS.line)
  g.guideBottom:SetPoint("TOPLEFT", PLOT_LEFT, PLOT_TOP - PLOT_HEIGHT + 1)
  g.baseline = rule(chart, COLORS.bronze)
  g.chartEmpty = text(chart, 12, nil, COLORS.muted)
  g.chartEmpty:SetPoint("TOPLEFT", PLOT_LEFT, PLOT_TOP - 48)
  g.chartEmpty:SetWidth(PLOT_WIDTH)
  g.chartEmpty:SetJustifyH("CENTER")
  g.chartEmpty:SetText(NO_EVENTS)
  for _, edge in ipairs({ { "first", "LEFT" }, { "middle", "CENTER" }, { "last", "RIGHT" } }) do
    local s = text(chart, 12, NARROW, COLORS.muted)
    s:SetWidth(80)
    s:SetJustifyH(edge[2])
    g.axis[edge[1]] = s
  end
  -- One slot a day (an hour for Today), built once for the longest period; drawChart places the period's own and
  -- hides the rest. A slot is the hover target for its whole column, highlighted as the sidebar is.
  for i = 1, MAX_SLOTS do
    local slot = CreateFrame("Button", nil, chart)
    slot:Hide()
    slot:SetHighlightTexture("Interface\\Buttons\\WHITE8X8")
    local highlight = slot.GetHighlightTexture and slot:GetHighlightTexture()
    if highlight then highlight:SetVertexColor(1, 1, 1, 0.05) end
    slot.earned = slot:CreateTexture(nil, "ARTWORK")
    slot.earned:SetColorTexture(unpack(COLORS.accent))
    slot.spent = slot:CreateTexture(nil, "ARTWORK")
    slot.spent:SetColorTexture(unpack(COLORS.bronze))
    slot:SetScript("OnEnter", function(self) if self.info then tooltip(self, slotLines(self.info)) end end)
    slot:SetScript("OnLeave", untip)
    g.slots[i] = slot
  end

  -- Ledger: by day on the left; by category and the receipts of the day picked stacked on the right, five rows
  -- each, so every money column has room for its coins.
  local l = g.pages.ledger
  g.days = list(l, 0, 0, 306, 290, "By day",
    { { "date", 0, 70 }, { "in", 70, 76, true }, { "out", 146, 76, true }, { "net", 222, 76, true } }, nil,
    { ["in"] = "Earned", out = "Spent", net = "Net" })
  for _, row in ipairs(g.days) do
    row:SetScript("OnClick", function(self) g.day = self.day; g.receipts.offset = 0; redraw() end)
  end
  g.categories = list(l, 312, 0, 292, 142, "By category",
    { { "label", 0, 148 }, { "amount", 148, 76, true }, { "count", 224, 60, true } }, 5)
  g.receipts = list(l, 312, -148, 292, 142, "Receipts",
    { { "when", 0, 34, false, true }, { "label", 34, 174 }, { "amount", 208, 76, true } }, 5)
  g.unrecorded = text(l, 12, nil, COLORS.muted)
  g.unrecorded:SetPoint("TOPLEFT", 4, -300)
  g.moved = text(l, 12, nil, COLORS.muted)
  g.moved:SetPoint("TOPLEFT", 4, -314)

  -- Sales, newest first, or one row per item; the cut is the auction house's, from the invoice. Widths fit the
  -- figures at 12 px: coins in 56 to 68, "11-07 11:00" in the narrow figures, "gold pending" in Friz.
  local salesBox
  g.sales, salesBox = list(g.pages.sales, 0, 0, W, 300, "Auction sales",
    { { "item", 0, 164 }, { "count", 164, 34, false, true }, { "unit", 198, 64, true }, { "total", 262, 68, true },
      { "deposit", 330, 56, true }, { "cut", 386, 56, true }, { "when", 448, 62, false, true }, { "status", 510, 86 } },
    nil, SALE_CAPTIONS)
  g.groupButton = button(salesBox, "By item", 90, function() g.grouped = not g.grouped; g.sales.offset = 0 end)
  g.groupButton:SetPoint("BOTTOMLEFT", 6, 6)

  -- Session: the gph lines, moving once a second while this tab is open. Tall enough for every line gph writes
  -- (four, the vendor line, five items and the cut) above the buttons.
  local sb = box(g.pages.session, 0, 0, W, 250)
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
      if g.revision ~= E.Ledger.revision or g.utcDay ~= math.floor(now / DAY)
        or (g.pendingExpiry and now > g.pendingExpiry) then redraw() end
      return
    end
    if g.tab ~= "session" then return end
    local ok, err = pcall(drawSession, g)
    if not ok then U.Fail(err) end
  end)
end

U.Views.gold = { build = build, refresh = refresh }
