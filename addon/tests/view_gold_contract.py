"""Run with: uv run --with lupa python addon/tests/view_gold_contract.py

The window's Gold view (modules/view_gold.lua): every character's gold by realm and a chart of gold earned and spent
for each day of the period picked (each UTC hour for today), the ledger by category, day and receipt, auction
sales one by one (with the house's cut) or by item (with paid sales/day, units/day and the last sold day), and the gold per hour session. It reads the
roster, the ledger store and the gph session and displays them; the buttons run the commands the player could type.
A saved file without a roster or ledger shows each section's empty line, never an error.
"""
import zlib
from pathlib import Path
from window_world import fresh

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\view_gold.lua" in toc, "the Gold view is in the TOC"
assert toc.index("modules\\window.lua") < toc.index("modules\\view_gold.lua") < toc.index("modules\\minimap.lua"), \
    "the Gold view loads after the window and before the minimap button"

DAY = 86400
NOW = 1794052800  # 2026-11-07 12:00 UTC
TODAY = NOW - NOW % DAY
# The key core.lua's E.CharacterKey gives this install and player GUID.
ME = "%08x" % zlib.adler32(b"abcd-1234:Player-1-0001")
API = f"""now = {NOW}
date = os.date
UnitGUID = function() return 'Player-1-0001' end
-- The game tooltip, keeping its lines: {{ left, right }} for a double line, {{ left }} for one.
GameTooltip = {{ lines = {{}}, shown = false }}
function GameTooltip:SetOwner(owner) self.owner, self.lines = owner, {{}} end
function GameTooltip:AddLine(t) self.lines[#self.lines + 1] = {{ t }} end
function GameTooltip:AddDoubleLine(l, r) self.lines[#self.lines + 1] = {{ l, r }} end
function GameTooltip:Show() self.shown = true end
function GameTooltip:Hide() self.shown = false end
"""

SAVED = f"""{{ installId = 'abcd-1234', toggles = {{}}, records = {{}},
  roster = {{
    ['{ME}'] = {{ name = 'Samplechar', realm = 'Forever', class = 'SHAMAN', level = 24, copper = 1312745 }},
    aaaa0002 = {{ name = 'Samplechar', realm = 'Nightfall', class = 'MAGE', level = 30, copper = 250000 }},
  }},
  ledger = {{
    events = {{
      {{ at = {TODAY + 9 * 3600}, key = '{ME}', category = 'vendor', copper = 41000 }},
      {{ at = {TODAY + 10 * 3600}, key = '{ME}', category = 'quest', copper = 67500 }},
      {{ at = {TODAY + 10 * 3600 + 900}, key = '{ME}', category = 'flight', copper = 55 }},
      {{ at = {TODAY + 11 * 3600}, key = '{ME}', category = 'auction', copper = 3800, itemName = 'Linen Cloth', count = 20 }},
    }},
    sales = {{
      {{ at = {TODAY + 8 * 3600}, key = 'aaaa0002', itemName = 'Linen Cloth', count = 10, unit = 190, total = 1900, status = 'paid' }},
      {{ at = {TODAY + 11 * 3600}, key = '{ME}', itemName = 'Linen Cloth', count = 20, unit = 190, total = 3800, deposit = 60, cut = 200, status = 'paid' }},
      {{ at = {TODAY + 11 * 3600 + 1800}, key = '{ME}', itemName = 'Linen Cloth', status = 'pending' }},
      {{ at = {TODAY + 6 * 3600}, key = '{ME}', itemName = 'Copper Ore', status = 'unmatched' }},
    }},
    daily = {{
      ['{ME}'] = {{ ['2026-11-05'] = 1000000, ['2026-11-06'] = 1200000, ['2026-11-07'] = 1312745 }},
      aaaa0002 = {{ ['2026-11-05'] = 240000, ['2026-11-06'] = 245000, ['2026-11-07'] = 250000 }},
    }},
  }},
}}"""

lua = fresh(SAVED, API)
lua.execute(f"""
local U, ME = Everloot.Window, '{ME}'
assert(Everloot.CharacterKey() == ME, 'the seeded key is this character')
assert(U.Views.gold and U.Views.gold.build and U.Views.gold.refresh, 'the Gold view registers')
assert(U.Open() == true)
local f = EverlootWindow
f.nav.gold.scripts.OnClick(f.nav.gold)
local g = f.gold
assert(f.views.gold and f.views.gold.shown and f.subtitle.text == 'Gold' and not f.note.shown, 'Gold opens its view')
assert(g.tab == 'overview' and g.period == '30d' and g.scope == 'character')
local function shown(rows) local n = 0; for _, r in ipairs(rows) do if r.shown then n = n + 1 end end; return n end
local function money(text, ...)
  local pattern = '^'
  for i, part in ipairs({{...}}) do pattern = pattern .. (i > 1 and ' ' or '') .. part[1] .. '|T[^|]-UI%-' .. part[2] .. 'Icon:[^|]-|t' end
  return text:find(pattern .. '$') ~= nil
end
local function click(b) b.scripts.OnClick(b) end

-- List cells: two coins at most. 123456 copper is 12g 34s; the copper is left off.
assert(money(U.MoneyShort(123456), {{12, 'Gold'}}, {{34, 'Silver'}}) and not U.MoneyShort(123456):find('Copper'), U.MoneyShort(123456))
assert(money(U.MoneyShort(3456), {{34, 'Silver'}}, {{56, 'Copper'}}) and money(U.MoneyShort(56), {{56, 'Copper'}}) and U.MoneyShort(nil) == '-')
assert(money(U.MoneyShort(-123456), {{'%-12', 'Gold'}}, {{34, 'Silver'}}), 'a minus in front')

-- Every list's columns fill its row exactly, and the status column fits "gold pending" (86 px).
local function filled(rows)
  local row, w = rows[1], rows[1].width
  local fields = {{}}
  for k, v in pairs(row) do if type(v) == 'table' and v.kind == 'FontString' then fields[#fields + 1] = v end end
  table.sort(fields, function(a, b) return a.point[2] < b.point[2] end)
  local x = 0
  for _, s in ipairs(fields) do
    assert(s.point[2] >= x, 'columns do not overlap')
    x = s.point[2] + s.width
  end
  return x == w, x .. ' of ' .. w
end
assert(filled({{ g.rows[2] }}), 'a character row')
for _, tab in ipairs({{ 'ledger', 'sales' }}) do click(g.tabs[tab]) end
for _, rows in ipairs({{ g.categories, g.days, g.receipts, g.sales }}) do assert(filled(rows)) end
-- Widths from the fonts at 12 px: "11-07 11:00" in the narrow figures, "gold pending" in Friz, coins in 56 and 70.
assert(g.sales[1].status.width == 86 and g.sales[1].deposit.width == 56 and g.sales[1].cut.width == 56 and g.sales[1].when.width == 62, 'the sales columns')
assert(g.sales[1].when.font == U.NARROW and g.sales[1].count.font == U.NARROW and g.receipts[1].when.font == U.NARROW, 'times and counts in the narrow figures')
assert(g.days[1].date.width == 70 and g.days[1]['in'].width == 76 and g.days[1].out.width == 76 and g.days[1].net.width == 76, 'the day columns')
-- Column captions on the heading line, over their own columns.
assert(g.days.captions['in'].text == 'Earned' and g.days.captions.out.text == 'Spent' and g.days.captions.net.text == 'Net')
assert(g.days.captions['in'].point[2] == g.days[1]['in'].point[2] + 4 and g.days.captions['in'].width == 76, 'over the column')
assert(g.sales.captions.unit.text == 'Each' and g.sales.captions.cut.text == 'AH cut' and g.sales.captions.when.text == 'Sold' and g.sales.captions.status.text == 'Status')
click(g.tabs.overview)

-- Overview: every character grouped by realm, the realm and account totals, and the last 30 days.
local rows = g.rows
assert(shown(rows) == 4, 'two realm lines, two characters')
-- A character's gold in full, copper included; the realm line gets the whole row for its name.
assert(rows[1].name.text == 'Forever' and rows[2].name.text == 'Samplechar' and money(rows[2].gold.text, {{131, 'Gold'}}, {{27, 'Silver'}}, {{45, 'Copper'}}), rows[2].gold.text)
assert(rows[3].name.text == 'Nightfall' and rows[4].name.text == 'Samplechar' and money(rows[4].gold.text, {{25, 'Gold'}}, {{0, 'Silver'}}, {{0, 'Copper'}}), rows[4].gold.text)
assert(rows[1].gold.text == '' and rows[1].name.width == rows[1].width and rows[2].name.width == 150, 'the realm line is not cut at the gold column')
assert(g.realmTotals.Forever == 1312745 and g.realmTotals.Nightfall == 250000)
assert(g.accountTotal == 1312745 + 250000, 'the account total is every character summed')
-- The chart plots what the summary counts, one slot a day; today is the last. A day with nothing draws nothing.
assert(#g.slots == 90 and shown(g.slots) == 30, 'thirty slots for 30 days, the rest built and hidden')
assert(g.slots[30].info.earned == 41000 + 67500 + 3800 and g.slots[30].info.spent == 55 and g.slots[30].info.held == 1312745, 'today is the last slot')
assert(g.slots[30].earned.shown and g.slots[30].spent.shown and not g.slots[29].earned.shown and not g.slots[29].spent.shown, 'no events, no bar')
assert(g.slots[29].info.held == 1200000 and g.slots[1].info.held == nil, 'gold held from the closes')
assert(g.summaryCaption.text == 'Last 30 days · This character', g.summaryCaption.text)
click(g.scopes.account)
assert(g.scope == 'account' and g.slots[30].info.held == 1312745 + 250000 and g.summaryCaption.text == 'Last 30 days · Account')
click(g.scopes.character)
-- The period row is on the Overview and the chart follows it: 7 days, seven slots; Today, 24 hours; All, the
-- ledger's own days (at least 7).
for _, p in ipairs({{ 'today', '7d', '30d', 'all' }}) do assert(g.periods[p].shown, p .. ' shows on the overview') end
click(g.periods['7d'])
assert(g.period == '7d' and shown(g.slots) == 7 and g.slots[7].shown and not g.slots[8].shown, 'seven slots')
assert(g.slots[7].info.earned == 112300 and g.slots[6].info.held == 1200000, 'today is the seventh')
assert(g.summaryCaption.text == 'Last 7 days · This character', g.summaryCaption.text)
click(g.periods.all)
assert(g.period == 'all' and shown(g.slots) == 7 and g.slots[7].info.earned == 112300, 'a one-day ledger shows its last seven days')
assert(g.summaryCaption.text == 'Last 90 days · This character', g.summaryCaption.text)
click(g.periods.today)
assert(shown(g.slots) == 24 and g.summaryCaption.text == 'Today · This character', g.summaryCaption.text)
assert(g.slots[10].info.earned == 41000 and g.slots[11].info.earned == 67500 and g.slots[11].info.spent == 55 and g.slots[12].info.earned == 3800, 'one slot an hour, UTC')
click(g.periods['30d'])
assert(shown(g.slots) == 30 and g.slots[30].info.earned == 112300)

-- Ledger: categories largest first, one day, its receipts newest first, the gold the events do not explain.
click(g.tabs.ledger)
assert(g.tab == 'ledger' and g.pages.ledger.shown and not g.pages.overview.shown)
assert(g.categories[1].label.text == 'Quest rewards' and money(g.categories[1].amount.text, {{6, 'Gold'}}, {{75, 'Silver'}}), g.categories[1].amount.text)
assert(g.categories[1].count.text == '1 event' and shown(g.categories) == 4)
assert(g.categories[4].label.text == 'Flight paths' and money(g.categories[4].amount.text, {{'%-55', 'Copper'}}), 'spending is a minus')
assert(shown(g.days) == 1 and g.days[1].date.text == '2026-11-07' and g.day == '2026-11-07')
assert(money(g.days[1]['out'].text, {{55, 'Copper'}}) and money(g.days[1].net.text, {{11, 'Gold'}}, {{22, 'Silver'}}), g.days[1].net.text)
assert(shown(g.receipts) == 4, 'four receipts that day')
-- The item first, its category after it in muted text, so a long name cuts the category, not the item.
assert(g.receipts[1].when.text == '11:00' and g.receipts[1].label.text == 'Linen Cloth × 20  |cffc9c3b0Auction sales|r', g.receipts[1].label.text)
assert(g.receipts[2].when.text == '10:15' and g.receipts[3].when.text == '10:00' and g.receipts[4].when.text == '09:00', 'newest first')
assert(g.unrecorded.text == 'Gold change not recorded: -', 'no close from before the 30 days: ' .. g.unrecorded.text)
click(g.periods.today)
assert(g.period == 'today' and g.unrecorded.text:find('^Gold change not recorded: 5|T.-Silver.- 0|T.-Copper'), g.unrecorded.text)

-- Sales: one by one for this character, every character's grouped by item.
click(g.tabs.sales)
assert(shown(g.sales) == 3, 'paid, pending and unmatched rows are listed')
-- Newest first: the pending notice, the paid sale, the unmatched notice.
assert(g.sales[1].item.text == 'Linen Cloth' and g.sales[1].status.text == 'gold pending', g.sales[1].status.text)
assert(g.sales[1].count.text == '-' and g.sales[1].unit.text == '-' and g.sales[1].total.text == '-' and g.sales[1].deposit.text == '-' and g.sales[1].cut.text == '-', 'a pending row has no price yet')
assert(g.sales[2].item.text .. ' ' .. g.sales[2].count.text == 'Linen Cloth × 20')
assert(money(g.sales[2].unit.text, {{1, 'Silver'}}, {{90, 'Copper'}}) and money(g.sales[2].total.text, {{38, 'Silver'}}, {{0, 'Copper'}}), g.sales[2].unit.text)
assert(money(g.sales[2].deposit.text, {{60, 'Copper'}}), 'the deposit the letter returned: ' .. g.sales[2].deposit.text)
assert(money(g.sales[2].cut.text, {{2, 'Silver'}}, {{0, 'Copper'}}), "the auction house's cut from the invoice: " .. g.sales[2].cut.text)
assert(g.sales[2].when.text == '11-07 11:00' and g.sales[2].status.text == 'paid')
assert(g.sales[3].item.text == 'Copper Ore' and g.sales[3].status.text == 'unmatched' and g.sales[3].total.text == '-')
assert(g.sales.head.text == 'Auction sales')
click(g.scopes.account)
assert(shown(g.sales) == 4 and g.sales[2].count.text == '× 20' and g.sales[3].count.text == '× 10', 'newest first')
assert(g.sales[3].cut.text == '-', 'a sale recorded without a cut shows none')
assert(g.groupButton.text == 'By item')
click(g.groupButton)
assert(g.grouped and shown(g.sales) == 1 and g.sales[1].count.text == '× 30' and g.sales[1].deposit.text == '2.0', 'grouped view counts paid sales only')
assert(money(g.sales[1].total.text, {{57, 'Silver'}}, {{0, 'Copper'}}) and g.groupButton.text == 'Each sale')
-- Today: two sales and thirty units a day under their captions, and the last day sold under Last sold.
assert(g.sales[1].cut.text == '30.0' and g.sales[1].when.text == '11-07' and g.sales[1].status.text == '', g.sales[1].cut.text)
assert(g.sales.head.text == 'Auction sales by item', g.sales.head.text)
assert(g.sales.captions.deposit.text == 'Sales/day' and g.sales.captions.cut.text == 'Units/day' and g.sales.captions.when.text == 'Last sold' and g.sales.captions.status.text == '')
click(g.periods['30d'])
assert(g.grouped and g.sales[1].deposit.text == '0.1' and g.sales[1].cut.text == '1.0', 'two sales over thirty days: ' .. g.sales[1].cut.text)
click(g.periods.today)

-- Session: the gph lines and the commands' own buttons.
click(g.tabs.session)
assert(g.session.text:find('No session running'), g.session.text)
assert(g.sessionButton.text == 'Start')
click(g.sessionButton)
assert(EverlootDB.gph.current and EverlootDB.gph.current.runningSince ~= nil, 'Start starts a session')
assert(g.sessionButton.text == 'Pause' and g.session.text:find('^Running'), g.session.text)
click(g.sessionButton)
assert(EverlootDB.gph.current.runningSince == nil and g.sessionButton.text == 'Resume')
click(g.stopButton)
assert(EverlootDB.gph.current == nil and g.sessionButton.text == 'Start' and #EverlootDB.gph.sessions == 1, 'Stop saves the session')

-- Two days on, today holds nothing.
now = now + 2 * 86400
click(g.tabs.ledger)
assert(g.period == 'today' and shown(g.categories) == 0 and g.categories.empty.text == 'Nothing recorded in this period.' and g.categories.empty.shown)
click(g.tabs.sales)
assert(shown(g.sales) == 0 and g.sales.empty.shown)
assert(f.shown and not U.failed)
""")

# A saved file with no roster or ledger: every section says so, and nothing errors.
lua = fresh("{ installId = 'abcd-1234', toggles = {}, records = {} }", API)
lua.execute("""
local U = Everloot.Window
assert(U.Open('gold') == true)
local f = EverlootWindow
local g = f.gold
local function click(b) b.scripts.OnClick(b) end
local function shown(rows) local n = 0; for _, r in ipairs(rows) do if r.shown then n = n + 1 end end; return n end
local function none(rows) for _, r in ipairs(rows) do if r.shown then return false end end; return rows.empty.shown end
assert(none(g.rows) and g.rows.empty.text == 'No characters recorded yet.')
assert(g.accountTotal == nil and shown(g.slots) == 30 and not g.slots[30].earned.shown and g.chartEmpty.shown, 'no events, an empty chart that says so')
assert(g.scaleTop.text == '' and g.scaleBottom.text == '' and g.axis.last.text == 'Today')
click(g.tabs.ledger)
assert(none(g.categories) and g.categories.empty.text == 'Nothing recorded in this period.' and none(g.days) and none(g.receipts))
assert(g.unrecorded.text == 'Gold change not recorded: -')
click(g.tabs.sales)
assert(none(g.sales) and g.sales.empty.text == 'No auction sales recorded yet. Collect an auction letter at the mailbox and it appears here.')
click(g.scopes.account)
click(g.tabs.session)
assert(g.session.text:find('No session running') and g.sessionButton.text == 'Start')
assert(EverlootWindow.shown and not U.failed, 'the window stays open')
""")

# Gold moved between own characters: one line under Unrecorded, for the account only.
MOVED = SAVED.replace(
    f"{{ at = {TODAY + 9 * 3600}, key = '{ME}', category = 'vendor', copper = 41000 }},",
    f"{{ at = {TODAY + 9 * 3600}, key = '{ME}', category = 'vendor', copper = 41000 }},\n"
    f"      {{ at = {TODAY + 9 * 3600 + 60}, key = '{ME}', category = 'trade_out', copper = 4000, ownAlt = true }},\n"
    f"      {{ at = {TODAY + 9 * 3600 + 120}, key = 'aaaa0002', category = 'trade_in', copper = 4000, ownAlt = true }},")
assert MOVED != SAVED
lua = fresh(MOVED, API)
lua.execute("""
local U = Everloot.Window
assert(U.Open('gold') == true)
local g = EverlootWindow.gold
local function click(b) b.scripts.OnClick(b) end
click(g.tabs.ledger)
assert(not g.moved.shown, 'no moved line for one character')
local found = false
for _, row in ipairs(g.categories) do if row.shown and row.label.text == 'Trades out' then found = true end end
assert(found, 'one character keeps its trade in the categories')
click(g.scopes.account)
assert(g.moved.shown and g.moved.text:find('^Moved between your characters: 40|T.-Silver.- 0|T.-Copper'), g.moved.text)
for _, row in ipairs(g.categories) do assert(not (row.shown and row.label.text:find('^Trades')), 'the account leaves transfers out') end
local listed = 0
for _, row in ipairs(g.receipts) do if row.shown and row.label.text:find('^Trades') then listed = listed + 1 end end
assert(listed == 2, 'both sides are still receipts')
""")
lua = fresh(SAVED, API)
lua.execute("""
local g = (Everloot.Window.Open('gold') and EverlootWindow.gold)
g.tabs.ledger.scripts.OnClick(g.tabs.ledger)
g.scopes.account.scripts.OnClick(g.scopes.account)
assert(g.moved.shown and g.moved.text == 'Moved between your characters: -', g.moved.text)
""")

lua = fresh(SAVED, API)
lua.execute("""
local U, L = Everloot.Window, Everloot.Ledger
assert(U.Open('gold'))
local g, me = EverlootWindow.gold, Everloot.CharacterKey()
local function click(b) b.scripts.OnClick(b) end
EverlootDB.ledger.events = {}
EverlootDB.ledger.sales = {}
local today = now - now % 86400
for _, age in ipairs({0, 6, 29, 89, 90}) do
  for _, key in ipairs({me, 'aaaa0002'}) do
    for _, item in ipairs({'Zebra', 'Apple'}) do
      table.insert(EverlootDB.ledger.events, {at=today-age*86400, key=key, category='vendor', copper=100, itemName=item})
    end
    for _, item in ipairs({'Boots', 'Axe'}) do
      table.insert(EverlootDB.ledger.events, {at=today-age*86400, key=key, category='vendor_spend', copper=300, itemName=item})
    end
  end
end
L.Record(me, 'mail_out', 50, {ownAlt=true, itemName='Transfer'})
L.Record('aaaa0002', 'mail_in', 50, {ownAlt=true, itemName='Transfer'})
L.RecordPending(me, 'Pending')
L.RecordPending('aaaa0002', 'Pending')
local captions = {'Today', 'Last 7 days', 'Last 30 days', 'Last 90 days'}
for _, scope in ipairs({'character', 'account'}) do
  click(g.scopes[scope])
  for i, period in ipairs({'today', '7d', '30d', 'all'}) do
    click(g.periods[period])
    local n = scope == 'account' and 2 or 1
    local earned, spent = i*200*n, i*600*n + (scope == 'character' and 50 or 0)
    local days = ({1,7,30,90})[i]
    assert(g.summaryCaption.text == captions[i] .. ' · ' .. (n == 2 and 'Account' or 'This character'))
    assert(g.earned.text == U.MoneyShort(earned), g.earned.text)
    assert(g.spent.text == U.MoneyShort(spent), g.spent.text)
    assert(g.profit.text == U.MoneyShort(earned-spent), g.profit.text)
    -- Today's own total is its day; a longer period adds the average a day.
    local function perDay(c) return period == 'today' and '' or (U.MoneyShort(c) .. ' a day') end
    assert(g.earnedAverage.text == perDay(earned/days), g.earnedAverage.text)
    assert(g.spentAverage.text == perDay(spent/days))
    assert(g.profitAverage.text == perDay((earned-spent)/days))
    assert(g.pending.text == n .. (n == 1 and ' sale' or ' sales') .. ' awaiting gold', g.pending.text)
    assert(g.topEarned.text == 'Apple' and g.topEarnedAmount.text == U.Money(i*100*n), g.topEarned.text)
    assert(g.topSpent.text == 'Axe' and g.topSpentAmount.text == U.Money(i*300*n), g.topSpent.text)
  end
end
assert(g.summaryBox.width == 604 and g.summaryBox.height == 112)
assert(#g.rows == 7 and g.topEarnedLabel.text == 'Top earning' and g.topSpentLabel.text == 'Top spending')
-- Label, item and amount side by side across the box: 92 + 384 + 104, with 4 between.
assert(g.topEarned.point[2] == 104 and g.topEarned.width == 384 and g.topEarnedAmount.point[2] == 492 and g.topEarnedAmount.width == 104)
assert(g.earned.font == U.NARROW and g.earnedAverage.point[3] - g.earned.point[3] <= -18, 'the figure, then room before the line under it')
assert(g.summaryBox.point[3] == 0 and g.pages.overview.point[3] == -64, 'summary starts below the controls')
assert(g.rows[1].parent.point[3] == -118 and g.rows[1].parent.height == 190)
assert(g.slots[1].parent.point[3] == -118 and g.slots[1].parent.height == 190)
assert(g.rows[7].point[3] - g.rows[7].height >= -156, 'seven rows leave footer room')
local calls, summary = 0, L.Summary
L.Summary = function(...) calls=calls+1; return summary(...) end
local update = EverlootWindow.views.gold.scripts.OnUpdate
for i=1,120 do update(nil, 1/60) end
assert(calls == 0, 'idle overview does not recompute')
L.Record(me, 'quest', 10000)
update(nil, 1.1)
assert(calls == 1 and g.profit.text == U.MoneyShort(10000-3200), g.profit.text)
-- The paid sale's money event counts once; sale rows supply pending counts only.
L.RecordSale(me, {itemName='Pending', count=1, total=500})
L.Record(me, 'auction', 500, {itemName='Pending'})
update(nil, 1.1)
assert(g.pending.text == '1 sale awaiting gold')
assert(g.earned.text == U.MoneyShort(12100))
L.Record(me, 'repair', 7300)
update(nil, 1.1)
assert(g.profit.text == U.MoneyShort(0), 'break even')
-- Repeated events for the same item add together rather than competing as individual receipts.
L.Record(me, 'vendor', 2000, {itemName='Zebra'})
update(nil, 1.1)
assert(g.topEarned.text == 'Zebra' and g.topEarnedAmount.text == U.Money(2800))
-- Pending expiry and the UTC day boundary refresh without a new money event.
now = now + 48*3600 + 1
update(nil, 1.1)
assert(g.pending.text == '')
click(g.periods.today)
assert(g.profit.text == U.MoneyShort(0) and g.topEarned.text == '-' and g.topEarnedAmount.text == '')
-- "All" averages over the UTC days from the first event in scope through today, not a fixed 90.
today = now - now % 86400
for _, case in ipairs({ { 'a ledger of five days', {0, 4}, 5 }, { 'a ledger of one day', {0}, 1 },
                        { 'a ledger over 60 days old', {0, 60, 120}, 61 }, { 'a ledger at the 90-day edge', {0, 89}, 90 } }) do
  EverlootDB.ledger.events = {}
  EverlootDB.ledger.sales = {}
  for _, age in ipairs(case[2]) do
    table.insert(EverlootDB.ledger.events, {at=today-age*86400+3600, key=me, category='vendor', copper=900, itemName='Apple'})
  end
  L.Record(me, 'quest', 0 + 100)
  click(g.scopes.character)
  click(g.periods.all)
  click(g.periods.today)
  click(g.periods.all)
  local counted = 0
  for _, age in ipairs(case[2]) do if age <= 89 then counted = counted + 900 end end
  counted = counted + 100
  assert(g.earned.text == U.MoneyShort(counted), case[1] .. ' ' .. g.earned.text)
  assert(g.earnedAverage.text == U.MoneyShort(counted / case[3]) .. ' a day', case[1] .. ' ' .. g.earnedAverage.text)
end
assert(not U.failed, U.failed)
""")

lua = fresh('{ installId = "abcd-1234", toggles = {}, records = {} }', API)
lua.execute("""
local U = Everloot.Window
assert(U.Open('gold'))
local g = EverlootWindow.gold
for _, scope in ipairs({'character','account'}) do
  g.scopes[scope].scripts.OnClick()
  for _, period in ipairs({'today','7d','30d','all'}) do
    g.periods[period].scripts.OnClick()
    assert(g.earned.text == U.MoneyShort(0) and g.spent.text == U.MoneyShort(0) and g.profit.text == U.MoneyShort(0))
    assert(g.pending.text == '' and g.topEarned.text == '-' and g.topSpent.text == '-')
  end
end
""")

print("Lua 5.1 Gold view: periods, scopes, summary, item ties, pending, live ledger changes and empty state")

# Two paid transactions containing twenty units have different daily rates. Notices are not paid sales.
lua = fresh(SAVED, API)
lua.execute("""
local U = Everloot.Window
assert(U.Open('gold'))
local g, me = EverlootWindow.gold, Everloot.CharacterKey()
EverlootDB.ledger.sales = {
  {at=now-3600, key=me, itemName='Linen Cloth', count=8, total=800, unit=100, status='paid'},
  {at=now-1800, key=me, itemName='Linen Cloth', count=12, total=1200, unit=100, status='paid'},
  {at=now-900, key=me, itemName='Linen Cloth', count=99, total=9900, status='pending'},
  {at=now-600, key=me, itemName='Linen Cloth', count=77, total=7700, status='unmatched'},
}
local function click(b) b.scripts.OnClick(b) end
click(g.tabs.sales)
click(g.periods.today)
click(g.groupButton)
assert(g.sales[1].count.text == '× 20', g.sales[1].count.text)
assert(g.sales[1].deposit.text == '2.0', g.sales[1].deposit.text)
assert(g.sales[1].cut.text == '20.0', g.sales[1].cut.text)
assert(g.sales[1].when.text == '11-07', g.sales[1].when.text)
click(g.periods['7d'])
assert(g.sales[1].deposit.text == '0.3' and g.sales[1].cut.text == '2.9')
click(g.groupButton)
assert(g.sales[1].status.text == 'unmatched' and g.sales[1].deposit.text == '-', 'individual view restored')
assert(not U.failed, U.failed)
""")

# The Overview chart: what it plots, its scale, axis, baseline, empty days, the hover tooltip, and the zero rule.
ZERO = SAVED.replace(
    "aaaa0002 = { name = 'Samplechar', realm = 'Nightfall'",
    "aaaa0003 = { name = 'Broke', realm = 'CAMWOW US1 Realm 4 PvP', class = 'MAGE', level = 5, copper = 0 },\n"
    "    aaaa0002 = { name = 'Samplechar', realm = 'Nightfall'")
assert ZERO != SAVED
lua = fresh(ZERO, API)
lua.execute("""
-- The stub keeps a texture's colour, so the test can tell the bars apart.
getmetatable(created[1]).SetColorTexture = function(self, r, g, b, a) self.color = { r, g, b, a } end
local U = Everloot.Window
assert(U.Open('gold'))
local g = EverlootWindow.gold
local function click(b) b.scripts.OnClick(b) end
local function shown(rows) local n = 0; for _, r in ipairs(rows) do if r.shown then n = n + 1 end end; return n end
local function lines() local out = {} for _, l in ipairs(GameTooltip.lines) do out[#out + 1] = l[1] .. (l[2] and (' = ' .. l[2]) or '') end return table.concat(out, ' / ') end

-- Zero gold is a dash; the realm line keeps its whole name and gives its total on hover.
local rows = g.rows
assert(rows[1].name.text == 'CAMWOW US1 Realm 4 PvP' and rows[1].name.width == rows[1].width and rows[1].gold.text == '', rows[1].name.text)
assert(rows[2].name.text == 'Broke' and rows[2].gold.text == '-', 'a character with no gold: ' .. rows[2].gold.text)
rows[3].scripts.OnEnter(rows[3])
assert(GameTooltip.shown and GameTooltip.lines[1][1] == 'Forever' and GameTooltip.lines[2][2] == U.Money(1312745), lines())
rows[3].scripts.OnLeave(rows[3])
assert(not GameTooltip.shown)
assert(g.total.text == 'Total  ' .. U.Money(1312745 + 250000), g.total.text)

-- 30 days: what it plots, said above it; one slot a day on a whole-pixel grid, centred in the 288 px plot.
assert(g.chartTitle.text == 'Per day' and g.legendEarned.text == 'Earned' and g.legendSpent.text == 'Spent')
assert(g.slots[1].point[2] == 19 and g.slots[1].width == 9 and g.slots[30].point[2] == 19 + 29 * 9, 'step 9 from 19')
assert(g.slots[30].earned.width == 7 and g.slots[30].spent.width == 7, 'two pixels between bars')
for i = 1, 30 do assert(g.slots[i].point[2] % 1 == 0 and g.slots[i].width == 9, 'whole pixels, even steps') end
-- Earned goes up from the baseline in fel green, spent down in bronze; the scale is the largest day each way.
assert(g.scaleTop.text == U.MoneyShort(112300) and g.scaleBottom.text == U.MoneyShort(-55), g.scaleTop.text)
assert(g.chartBase == 1 and g.baseline.point[3] == -42 - 110 + 1 and g.baseline.width == 288 and g.baseline.shown, 'the baseline')
assert(g.slots[30].earned.height == 109 and g.slots[30].spent.height == 1, 'a spend this small still shows')
assert(g.slots[30].earned.color[2] == U.COLORS.accent[2] and g.slots[30].spent.color[1] == U.COLORS.bronze[1], 'earned and spent look different')
assert(not g.chartEmpty.shown)
-- Start, middle and end dates.
assert(g.axis.first.text == 'Oct 9' and g.axis.middle.text == 'Oct 23' and g.axis.last.text == 'Today', g.axis.first.text .. ' ' .. g.axis.middle.text)
-- Hover: the date, earned, spent, net and the gold held that day.
g.slots[30].scripts.OnEnter(g.slots[30])
assert(GameTooltip.owner == g.slots[30] and GameTooltip.shown)
assert(lines() == 'Nov 7 / Earned = ' .. U.Money(112300) .. ' / Spent = ' .. U.Money(55) .. ' / Net = ' .. U.Money(112245) .. ' / Gold held = ' .. U.Money(1312745), lines())
g.slots[30].scripts.OnLeave(g.slots[30])
assert(not GameTooltip.shown)
-- A day with nothing recorded draws no bar and says so.
g.slots[29].scripts.OnEnter(g.slots[29])
assert(lines() == 'Nov 6 / Nothing recorded / Gold held = ' .. U.Money(1200000), lines())
g.slots[1].scripts.OnEnter(g.slots[1])
assert(lines() == 'Oct 9 / Nothing recorded', 'no close that day either: ' .. lines())

-- 7 days: wider slots, bars capped at 28 px and centred in them.
click(g.periods['7d'])
assert(shown(g.slots) == 7 and g.slots[1].point[2] == 10 and g.slots[1].width == 41 and g.slots[7].earned.width == 28, g.slots[1].width)
assert(g.slots[7].earned.point[2] == 6, 'centred in its slot')
assert(g.axis.first.text == 'Nov 1' and g.axis.middle.text == 'Nov 4' and g.axis.last.text == 'Today')
-- Today: one slot an hour, UTC, labelled at its start, noon and end.
click(g.periods.today)
assert(g.chartTitle.text == 'Per hour, UTC' and shown(g.slots) == 24 and g.slots[1].point[2] == 10 and g.slots[1].width == 12)
assert(g.axis.first.text == '00:00' and g.axis.middle.text == '12:00' and g.axis.last.text == '24:00')
g.slots[11].scripts.OnEnter(g.slots[11])
-- The hour says UTC, as the chart title does.
assert(lines() == '10:00 to 11:00 UTC / Earned = ' .. U.Money(67500) .. ' / Spent = ' .. U.Money(55) .. ' / Net = ' .. U.Money(67445), lines())
-- All, with ninety days of events: three-pixel slots that stay inside the plot.
EverlootDB.ledger.events[#EverlootDB.ledger.events + 1] = { at = now - 89 * 86400, key = Everloot.CharacterKey(), category = 'quest', copper = 100 }
Everloot.Ledger.revision = Everloot.Ledger.revision + 1
click(g.periods.all)
assert(shown(g.slots) == 90 and g.slots[1].point[2] == 19 and g.slots[1].width == 3 and g.slots[90].earned.width == 2, g.slots[1].width)
assert(g.slots[90].point[2] + 3 <= 298 and g.slots[1].info.earned == 100 and g.slots[1].earned.shown, 'the first day of the ledger')
assert(g.axis.last.text == 'Today' and g.axis.first.text == 'Aug 10', g.axis.first.text)
-- Spending only: the baseline sits at the top, nothing goes up.
EverlootDB.ledger.events = { { at = now - 60, key = Everloot.CharacterKey(), category = 'repair', copper = 900 } }
Everloot.Ledger.revision = Everloot.Ledger.revision + 1
click(g.periods['7d'])
assert(g.chartBase == 110 and g.scaleTop.text == '' and g.scaleBottom.text == U.MoneyShort(-900) and g.slots[7].spent.height == 110 and not g.slots[7].earned.shown)
assert(not U.failed, U.failed)
""")
print("Lua 5.1 Gold view: chart grid, scale, axis, empty days, tooltip and the zero rule")
