"""Run with: uv run --with lupa python addon/tests/view_gold_contract.py

The window's Gold view (modules/view_gold.lua): every character's gold by realm and a 30-day chart, the ledger by
category, day and receipt, auction sales one by one or by item, and the gold per hour session. It reads the
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
API = f"now = {NOW}\ndate = os.date\nUnitGUID = function() return 'Player-1-0001' end\n"

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

-- Overview: every character grouped by realm, the realm and account totals, and the last 30 days.
local rows = g.rows
assert(shown(rows) == 4, 'two realm lines, two characters')
assert(rows[1].name.text == 'Forever' and rows[2].name.text == 'Samplechar' and money(rows[2].gold.text, {{131, 'Gold'}}, {{27, 'Silver'}}, {{45, 'Copper'}}), rows[2].gold.text)
assert(rows[3].name.text == 'Nightfall' and rows[4].name.text == 'Samplechar' and money(rows[4].gold.text, {{25, 'Gold'}}, {{0, 'Silver'}}, {{0, 'Copper'}}), rows[4].gold.text)
assert(g.realmTotals.Forever == 1312745 and g.realmTotals.Nightfall == 250000)
assert(g.accountTotal == 1312745 + 250000, 'the account total is every character summed')
assert(#g.bars == 30 and g.bars[30].value == 1312745 and g.bars[30].hi == 1312745 and g.bars[29].value == 1200000, 'today is the last bar')
assert(g.bars[1].value == 0 and g.bars[1].lo == 0, 'a day before any close draws nothing')
assert(g.chartCaption.text == 'Last 30 days · This character', g.chartCaption.text)
click(g.scopes.account)
assert(g.scope == 'account' and g.bars[30].value == 1312745 + 250000 and g.chartCaption.text == 'Last 30 days · Account')
click(g.scopes.character)

-- Ledger: categories largest first, one day, its receipts newest first, the gold the events do not explain.
click(g.tabs.ledger)
assert(g.tab == 'ledger' and g.pages.ledger.shown and not g.pages.overview.shown)
assert(g.categories[1].label.text == 'Quest rewards' and money(g.categories[1].amount.text, {{6, 'Gold'}}, {{75, 'Silver'}}, {{0, 'Copper'}}), g.categories[1].amount.text)
assert(g.categories[1].count.text == '1 event' and shown(g.categories) == 4)
assert(g.categories[4].label.text == 'Flight paths' and money(g.categories[4].amount.text, {{'%-55', 'Copper'}}), 'spending is a minus')
assert(shown(g.days) == 1 and g.days[1].date.text == '2026-11-07' and g.day == '2026-11-07')
assert(money(g.days[1]['out'].text, {{55, 'Copper'}}) and money(g.days[1].net.text, {{11, 'Gold'}}, {{22, 'Silver'}}, {{45, 'Copper'}}), g.days[1].net.text)
assert(shown(g.receipts) == 4, 'four receipts that day')
assert(g.receipts[1].when.text == '11:00' and g.receipts[1].label.text == 'Auction sales · Linen Cloth × 20', g.receipts[1].label.text)
assert(g.receipts[2].when.text == '10:15' and g.receipts[3].when.text == '10:00' and g.receipts[4].when.text == '09:00', 'newest first')
assert(g.unrecorded.text == 'Unrecorded: -', 'no close from before the 30 days: ' .. g.unrecorded.text)
click(g.periods.today)
assert(g.period == 'today' and g.unrecorded.text:find('^Unrecorded: 5|T.-Silver.- 0|T.-Copper'), g.unrecorded.text)

-- Sales: one by one for this character, every character's grouped by item.
click(g.tabs.sales)
assert(shown(g.sales) == 3, 'paid, pending and unmatched rows are listed')
-- Newest first: the pending notice, the paid sale, the unmatched notice.
assert(g.sales[1].item.text == 'Linen Cloth' and g.sales[1].status.text == 'sold, gold pending', g.sales[1].status.text)
assert(g.sales[1].count.text == '-' and g.sales[1].unit.text == '-' and g.sales[1].total.text == '-', 'a pending row has no price yet')
assert(g.sales[2].item.text .. ' ' .. g.sales[2].count.text == 'Linen Cloth × 20')
assert(money(g.sales[2].unit.text, {{1, 'Silver'}}, {{90, 'Copper'}}) and money(g.sales[2].total.text, {{38, 'Silver'}}, {{0, 'Copper'}}), g.sales[2].unit.text)
assert(g.sales[2].when.text == '2026-11-07 11:00' and g.sales[2].status.text == 'paid')
assert(g.sales[3].item.text == 'Copper Ore' and g.sales[3].status.text == 'unmatched' and g.sales[3].total.text == '-')
click(g.scopes.account)
assert(shown(g.sales) == 4 and g.sales[2].count.text == '× 20' and g.sales[3].count.text == '× 10', 'newest first')
assert(g.groupButton.text == 'By item')
click(g.groupButton)
assert(g.grouped and shown(g.sales) == 1 and g.sales[1].count.text == '× 30' and g.sales[1].when.text == '2 sales', 'grouped view counts paid sales only')
assert(money(g.sales[1].total.text, {{57, 'Silver'}}, {{0, 'Copper'}}) and g.groupButton.text == 'Each sale')

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
local function none(rows) for _, r in ipairs(rows) do if r.shown then return false end end; return rows.empty.shown end
assert(none(g.rows) and g.rows.empty.text == 'No characters recorded yet.')
assert(g.accountTotal == nil and g.bars[30].value == 0 and g.bars[30].hi == 1, 'no closes, an empty chart')
click(g.tabs.ledger)
assert(none(g.categories) and g.categories.empty.text == 'Nothing recorded in this period.' and none(g.days) and none(g.receipts))
assert(g.unrecorded.text == 'Unrecorded: -')
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

print("Lua 5.1 Gold view: characters by realm with a 30-day chart, ledger by category, day and receipt, sales each or by item, the gph session; empty lines for a fresh file")
