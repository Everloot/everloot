"""Run with: uv run --with lupa --with jsonschema python addon/tests/ledger_contract.py"""
import json
import re
from datetime import datetime
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\roster.lua\nmodules\\ledger.lua\n" in toc, "ledger loads right after roster"
source = (root / "modules/ledger.lua").read_text(encoding="utf-8")
assert "RegisterEvent" not in source, "the ledger registers no events"
assert "E:Store(" not in source, "the ledger is not a record"
# Reading the uploaded money_event rows is allowed; any assignment into records, or an insert, is not.
assert not re.search(r"\brecords\b[\w.\[\]\"' ]*=(?!=)", source), "the ledger never writes EverlootDB.records"
assert not re.search(r"(table\.insert|table\.remove|dropOldest)\s*\([^)]*records", source), "the ledger never changes EverlootDB.records"

# The web's category lists, read from the TypeScript file: the Lua lists start with them, in order.
ts = (root.parent / "kb/src/gold-ledger.ts").read_text(encoding="utf-8")


def ts_list(name):
    body = re.search(name + r"\s*=\s*\[([^\]]*)\]", ts).group(1)
    return re.findall(r'"([a-z_]+)"', body)


def ts_labels(name):
    body = re.search(name + r"[^=]*=\s*\{([^}]*)\}", ts).group(1)
    return dict(re.findall(r'(\w+):\s*"([^"]+)"', body))


TS_INCOME, TS_SPENDING = ts_list("INCOME_CATEGORIES"), ts_list("SPENDING_CATEGORIES")
assert len(TS_INCOME) == 4 and len(TS_SPENDING) == 5, (TS_INCOME, TS_SPENDING)
TS_LABELS = {**ts_labels("INCOME_LABEL"), **ts_labels("SPENDING_LABEL")}
assert sorted(TS_LABELS) == sorted(TS_INCOME + TS_SPENDING), TS_LABELS

fixture = json.loads((root / "tests/fixtures/ledger-parity.json").read_text(encoding="utf-8"))


def epoch(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


NOW = epoch(fixture["now"])
DAY = 86400

lua = LuaRuntime()
lua.execute("""
date = os.date
clock = 0
time = function() return clock end
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function() end
} end
""")
for file in ["core.lua", "modules/ledger.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute("""
function boot(db)
 EverlootDB = db
 Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
end
function status() return Everloot:Status() end
""")
g = lua.globals()


def py(value):
    """A Lua table as a Python list (keys 1..n, empty included) or dict."""
    if lupa_typeof(value) != "table":
        return value
    keys = list(value.keys())
    if all(isinstance(k, int) for k in keys) and sorted(keys) == list(range(1, len(keys) + 1)):
        return [py(value[k]) for k in range(1, len(keys) + 1)]
    return {k: py(value[k]) for k in keys}


lupa_typeof = lua.eval("type")


def keys(*names):
    return lua.table_from(list(names))


def extra(**fields):
    return lua.table_from(fields)


A, B = "aaaaaaaa", "bbbbbbbb"

# A file from before the ledger existed: booting creates the store, never an error.
g.clock = NOW
g.boot(lua.table_from({"toggles": lua.table_from({"gold": True})}))
L = g.Everloot.Ledger
assert py(g.EverlootDB.ledger) == {"events": [], "sales": [], "daily": []}, py(g.EverlootDB.ledger)
assert "ledger: ready (0 events, 0 sales, local only)" in g.status(), g.status()

# Categories, directions and labels.
income, spending = py(L.INCOME), py(L.SPENDING)
assert income[:4] == TS_INCOME and spending[:5] == TS_SPENDING, (income, spending)
assert income[4:] == ["trade_in", "mail_in"], income
assert spending[5:] == ["repair", "vendor_spend", "trade_out", "mail_out"], spending
assert py(L.LABELS) == {
    **TS_LABELS, "repair": "Repairs", "vendor_spend": "Vendor purchases",
    "trade_in": "Trades in", "trade_out": "Trades out", "mail_in": "Mail in", "mail_out": "Mail out",
}, py(L.LABELS)
for c in income:
    assert L.Direction(c) == "in", c
for c in spending:
    assert L.Direction(c) == "out", c

# Refusals: unknown category, copper that is not whole and at least 1, a bad key or a bad extra field.
records_before = py(g.EverlootDB.records)
for args in [(A, "gameplay", 10), (A, "loot", 0), (A, "loot", 1.5), (A, "loot", "5"), (None, "loot", 5), ("", "loot", 5)]:
    assert L.Record(*args) is False, args
assert py(g.EverlootDB.ledger.events) == [], "nothing refused is written"

# A bad item name or count is left off the row; the money is still recorded.
assert L.Record(A, "loot", 5, extra(itemName="x" * 81, count=2)) is True, "item name over 80"
assert L.Record(A, "loot", 6, extra(itemName="Ore", count=0)) is True, "count under 1"
assert L.Record(A, "loot", 7, extra(itemName=12, count=1.5)) is True, "wrong types"
rows = py(g.EverlootDB.ledger.events)
assert [(r["copper"], r.get("itemName"), r.get("count")) for r in rows] == [(5, None, 2), (6, "Ore", None), (7, None, None)], rows
g.EverlootDB.ledger = None

# Parity: the fixture through Record gives the web's category totals and week (money-ledger.parity.test.ts).
CHARACTER_KEYS = {"Thrall": A, "Jaina": B}
for e in fixture["events"]:
    g.clock = epoch(e["at"])
    assert L.Record(CHARACTER_KEYS[e["character"]], e["category"], e["copper"]) is True, e
g.clock = NOW
assert py(g.EverlootDB.records) == records_before, "Record never writes EverlootDB.records"
summary = L.Summary(keys(A, B), 0, NOW)
assert py(summary.categories) == fixture["expected"]["categories"], py(summary.categories)
week = L.Summary(keys(A, B), NOW - 7 * DAY, NOW)
want = fixture["expected"]["week"]
assert (week.totalIn, week.totalOut, week.totalIn - week.totalOut) == (want["in"], want["out"], want["net"]), (week.totalIn, week.totalOut)
assert summary.unrecorded is None, "no closes, no unrecorded line"

# One character alone; days oldest first, only days with events; receipts newest first.
thrall = L.Summary(keys(A), NOW - 7 * DAY, NOW)
assert (thrall.totalIn, thrall.totalOut) == (12450, 150), (thrall.totalIn, thrall.totalOut)
days = py(thrall.days)
assert [d["date"] for d in days] == ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"], days
assert days[2] == {"date": "2026-11-06", "inCopper": 650, "outCopper": 30, "net": 620}, days[2]
receipts = py(thrall.receipts("2026-11-07"))
assert [(r["category"], r["copper"], r["direction"], r["key"]) for r in receipts] == [("vendor", 300, "in", A), ("loot", 1500, "in", A)], receipts
assert receipts[0]["at"] == epoch("2026-11-07T09:30:00Z"), receipts[0]
assert py(thrall.receipts("2026-10-01")) == [], "a day without events has no receipts"
assert py(L.Summary(keys(), 0, NOW).categories) == [], "no keys, nothing counted"

# Item fields ride along on an event; other fields are not kept.
assert L.Record(A, "vendor", 90, extra(itemName="Linen Cloth", count=3, bidder="Someone")) is True
row = py(g.EverlootDB.ledger.events)[-1]
assert row == {"at": NOW, "key": A, "category": "vendor", "copper": 90, "itemName": "Linen Cloth", "count": 3}, row

# Transfers between own characters: ownAlt is kept only when true. Account totals leave them out and count them as
# moved; one character's totals keep them, since that character really paid or received the gold.
g.EverlootDB.ledger = None
g.clock = NOW
assert L.Record(A, "trade_out", 2000, extra(ownAlt=True)) is True
assert L.Record(B, "trade_in", 2000, extra(ownAlt=True)) is True
assert L.Record(A, "mail_out", 500, extra(ownAlt=False)) is True
assert L.Record(A, "repair", 300, extra(ownAlt="yes")) is True
rows = py(g.EverlootDB.ledger.events)
assert [r.get("ownAlt") for r in rows] == [True, True, None, None], rows
both = L.Summary(keys(A, B), 0, NOW)
assert (both.totalIn, both.totalOut, both.moved) == (0, 800, 4000), (both.totalIn, both.totalOut, both.moved)
assert sorted(c["category"] for c in py(both.categories)) == ["mail_out", "repair"], py(both.categories)
assert [d["inCopper"] for d in py(both.days)] == [0] and [d["outCopper"] for d in py(both.days)] == [800], py(both.days)
listed = py(both.receipts("2026-11-07"))
assert sorted(r["category"] for r in listed) == ["mail_out", "repair", "trade_in", "trade_out"], listed
one = L.Summary(keys(A), 0, NOW)
assert (one.totalIn, one.totalOut, one.moved) == (0, 2800, 2000), (one.totalIn, one.totalOut, one.moved)
assert sorted(c["category"] for c in py(one.categories)) == ["mail_out", "repair", "trade_out"], py(one.categories)
assert L.Summary(keys(), 0, NOW).moved == 0, "no keys, nothing moved"
g.EverlootDB.ledger = None

# Period: today starts at UTC midnight; 7d and 30d count back from now; all starts at 0.
g.clock = epoch("2026-11-07T23:59:30Z")
assert L.Period("today") == (epoch("2026-11-07T00:00:00Z"), g.clock), L.Period("today")
g.clock = epoch("2026-11-08T00:00:30Z")
assert L.Period("today") == (epoch("2026-11-08T00:00:00Z"), g.clock), L.Period("today")
assert L.Period("7d") == (g.clock - 7 * DAY, g.clock)
assert L.Period("30d") == (g.clock - 30 * DAY, g.clock)
assert L.Period("all") == (0, g.clock)

# Daily closes, the gold series and the unrecorded line.
g.EverlootDB.ledger = None
g.clock = epoch("2026-11-05T20:00:00Z")
assert L.Close(A, 10000) is True
g.clock = epoch("2026-11-05T22:00:00Z")
L.Close(A, 12000)  # the day's last close wins
g.clock = epoch("2026-11-06T10:00:00Z")
L.Record(A, "quest", 9000)
L.Record(A, "flight", 500)
L.Record(B, "loot", 4000)  # another key, outside the query below
g.clock = epoch("2026-11-07T10:00:00Z")
L.Close(A, 30000)
L.Close(B, 700)
assert L.Close(A, -1) is False and L.Close(A, 2.5) is False and L.Close(None, 5) is False, "close refusals"
series = py(L.Series(keys(A, B), 3))
assert series == [{"date": "2026-11-05", "copper": 12000}, {"date": "2026-11-06", "copper": 12000},
                  {"date": "2026-11-07", "copper": 30700}], series
series = py(L.Series(keys(B), 3))
assert series == [{"date": "2026-11-05"}, {"date": "2026-11-06"}, {"date": "2026-11-07", "copper": 700}], series
s = L.Summary(keys(A), epoch("2026-11-06T00:00:00Z"), g.clock)
# The opening is the close before the first day (11-05, 12000), the closing today's (30000); the events explain
# +8500, so 9500 is unrecorded.
assert (s.totalIn, s.totalOut, s.unrecorded) == (9000, 500, 9500), (s.totalIn, s.totalOut, s.unrecorded)
assert L.Summary(keys(A), epoch("2026-11-05T00:00:00Z"), g.clock).unrecorded is None, "no close before the first day"
# B's first close is inside the window: its whole balance must not read as unrecorded.
assert L.Summary(keys(A, B), epoch("2026-11-06T00:00:00Z"), g.clock).unrecorded is None, "a key without an opening close"

# Today: yesterday's close is the opening, today's the closing.
g.EverlootDB.ledger = None
g.clock = epoch("2026-11-06T21:00:00Z")
L.Close(A, 10000)
g.clock = epoch("2026-11-07T09:00:00Z")
L.Record(A, "quest", 9000)
L.Record(A, "flight", 500)
g.clock = epoch("2026-11-07T12:00:00Z")
L.Close(A, 25000)
f, t = L.Period("today")
s = L.Summary(keys(A), f, t)
assert (s.totalIn, s.totalOut, s.unrecorded) == (9000, 500, (25000 - 10000) - 8500), (s.totalIn, s.totalOut, s.unrecorded)

# Each key keeps its newest 400 daily closes.
g.EverlootDB.ledger = None
start = epoch("2025-01-01T12:00:00Z")
for i in range(401):
    g.clock = start + i * DAY
    L.Close(A, i)
daily = py(g.EverlootDB.ledger.daily[A])
assert len(daily) == 400 and "2025-01-01" not in daily and "2025-01-02" in daily, len(daily)

# Bounded window: 5,000 events, 90 days.
g.EverlootDB.ledger = None
g.clock = NOW
for i in range(1, 5002):
    L.Record(A, "loot", i)
events = g.EverlootDB.ledger.events
assert len(events) == 5000 and events[1].copper == 2 and events[5000].copper == 5001, (len(events), events[1].copper)
g.EverlootDB.ledger = None
for ago, copper in [(91, 1), (89, 2), (0, 3)]:
    g.clock = NOW - ago * DAY
    L.Record(A, "loot", copper)
assert [r["copper"] for r in py(g.EverlootDB.ledger.events)] == [2, 3], "an event older than 90 days is dropped"

# Queries skip rows past 90 days before eviction runs; the module's start runs one sweep.
g.EverlootDB.ledger = None
g.clock = NOW
L.Record(A, "loot", 3)
L.RecordSale(A, extra(itemName="Ore", count=1, total=10))
L.Close(A, 500)
lua.execute("table.insert(EverlootDB.ledger.events, 1, { at = clock - 91 * 86400, key = 'aaaaaaaa', category = 'loot', copper = 1 })")
lua.execute("table.insert(EverlootDB.ledger.sales, 1, { at = clock - 91 * 86400, key = 'aaaaaaaa', itemName = 'Old', count = 1, total = 7, unit = 7, status = 'paid' })")
lua.execute("EverlootDB.ledger.daily.aaaaaaaa[os.date('!%Y-%m-%d', clock - 120 * 86400)] = 900")
s = L.Summary(keys(A), 0, NOW)
assert (s.totalIn, py(s.categories)[0]["events"]) == (3, 1), (s.totalIn, py(s.categories))
assert py(s.receipts("2026-08-08")) == [], "no receipt for the old event"
assert [r["itemName"] for r in py(L.Sales(keys(A), 0, NOW))] == ["Ore"], "the old sale is skipped"
series = py(L.Series(keys(A), 120))
assert series[0] == {"date": "2026-07-11"} and series[-1] == {"date": "2026-11-07", "copper": 500}, (series[0], series[-1])
g.boot(lua.table_from({"toggles": lua.table_from({"gold": True}), "ledger": g.EverlootDB.ledger}))
assert len(g.EverlootDB.ledger.events) == 1 and g.EverlootDB.ledger.events[1].copper == 3, "init evicts the old event"
assert "ledger: ready (1 events, 2 sales, local only)" in g.status(), g.status()

# Bad inputs from a view read as sensible defaults, never an error.
assert L.Period("bogus") == L.Period("30d") and L.Period(None) == L.Period("30d"), "unknown period is 30 days"
assert L.Summary(keys(A), None, None).totalIn == L.Summary(keys(A), 0, NOW).totalIn == 3, "nil bounds mean all"
assert len(py(L.Sales(keys(A), None, None))) == 1, "nil bounds mean all sales in the window"
assert len(py(L.Series(keys(A), None))) == 30, "Series defaults to 30 days"
assert py(L.Summary(None, None, None).categories) == [], "nil keys, nothing counted"

# Days before the store existed: the uploaded money_event rows count, matched through the roster.
records_before = py(g.EverlootDB.records)
lua.execute("""
Everloot.Roster = { Rows = function() return {
  { key = 'aaaaaaaa', name = 'Thrall', realm = 'Moon Guard' },
  { key = 'bbbbbbbb', name = 'Jaina', realm = 'Moon Guard' },
} end }
EverlootDB.records.money_event = {
  { kind = 'money_event', installId = 'i', capturedAt = os.date('!%Y-%m-%dT%H:%M:%SZ', clock - 10 * 86400), character = 'Thrall', realm = 'Moon Guard', category = 'quest', copper = 400 },
  { kind = 'money_event', installId = 'i', capturedAt = os.date('!%Y-%m-%dT%H:%M:%SZ', clock - 10 * 86400), character = 'Garrosh', realm = 'Moon Guard', category = 'quest', copper = 800 },
  { kind = 'money_event', installId = 'i', capturedAt = os.date('!%Y-%m-%dT%H:%M:%SZ', clock - 100 * 86400), character = 'Thrall', realm = 'Moon Guard', category = 'loot', copper = 50 },
  { kind = 'money_event', installId = 'i', capturedAt = os.date('!%Y-%m-%dT%H:%M:%SZ', clock - 5 * 86400), character = 'Jaina', realm = 'Moon Guard', category = 'flight', copper = 60 },
}
""")
records_before = py(g.EverlootDB.records)
g.EverlootDB.ledger = None
s = L.Summary(keys(A), 0, NOW)
assert (s.totalIn, s.totalOut) == (400, 0), "Thrall's uploaded quest reward counts; Garrosh is not in the roster; past 90 days is skipped"
receipt = py(s.receipts("2026-10-28"))
assert receipt == [{"at": NOW - 10 * DAY, "key": A, "category": "quest", "direction": "in", "copper": 400}], receipt
assert L.Summary(keys(A, B), 0, NOW).totalOut == 60, "Jaina's row counts for her key"
g.clock = NOW - 11 * DAY
L.Record(A, "loot", 9)
g.clock = NOW
s = L.Summary(keys(A), 0, NOW)
assert (s.totalIn, s.totalOut) == (9, 0), "a ledger event older than the uploaded rows replaces them"
assert py(g.EverlootDB.ledger.events) == [{"at": NOW - 11 * DAY, "key": A, "category": "loot", "copper": 9}], "uploaded rows never enter the store"
assert py(g.EverlootDB.records) == records_before, "reading the uploaded rows changes nothing"
g.EverlootDB.records.money_event = None
g.Everloot.Roster = None
records_before = py(g.EverlootDB.records)

# Sales: the row, refusals, newest first, grouped by item, the 2,000 cap.
g.EverlootDB.ledger = None
g.clock = NOW - 100
assert L.RecordSale(A, extra(itemName="Linen Cloth", count=20, total=1990, deposit=60, cut=105, buyer="Someone")) is True
g.clock = NOW
L.RecordSale(A, extra(itemName="Linen Cloth", count=10, total=1000))
L.RecordSale(B, extra(itemName="Copper Ore", count=5, total=5000))
assert L.RecordSale(A, extra(itemName="", count=1, total=10)) is False, "no item name"
assert L.RecordSale(A, extra(itemName="Ore", count=0, total=10)) is False, "no count"
assert L.RecordSale(A, extra(itemName="Ore", count=1, total=0.5)) is False, "total not whole"
assert L.RecordSale(A, extra(itemName="Ore", count=1, total=10, deposit=-1)) is False, "negative deposit"
assert py(g.EverlootDB.ledger.sales)[0] == {"at": NOW - 100, "key": A, "itemName": "Linen Cloth", "count": 20, "unit": 99,
                                           "total": 1990, "deposit": 60, "cut": 105, "status": "paid"}, py(g.EverlootDB.ledger.sales)[0]
sales = py(L.Sales(keys(A), 0, NOW))
assert [r["total"] for r in sales] == [1000, 1990], sales
assert py(L.Sales(keys(A), NOW - 50, NOW))[0]["total"] == 1000 and len(py(L.Sales(keys(A), NOW - 50, NOW))) == 1, "period applies"
by_item = py(L.SalesByItem(keys(A, B), 0, NOW))
assert by_item == [{"itemName": "Copper Ore", "count": 5, "total": 5000, "unit": 1000, "sales": 1},
                   {"itemName": "Linen Cloth", "count": 30, "total": 2990, "unit": 99, "sales": 2}], by_item
for _ in range(2000):
    L.RecordSale(A, extra(itemName="Ore", count=1, total=10))
sales = g.EverlootDB.ledger.sales
assert len(sales) == 2000 and sales[1].itemName == "Ore", "the three oldest sales dropped past 2,000"
assert py(g.EverlootDB.records) == records_before, "nothing in the ledger reaches EverlootDB.records"

# Gold off: the module does not start, and the queries still read the store.
g.boot(lua.table_from({"toggles": lua.table_from({"gold": False}), "ledger": g.EverlootDB.ledger}))
assert "ledger: off by toggle" in g.status(), g.status()
assert len(py(L.Sales(keys(A), 0, NOW))) == 2000, "queries work with the module off"
g.EverlootDB.ledger = None
assert py(L.Summary(keys(A), 0, NOW).categories) == [] and py(L.Sales(keys(A), 0, NOW)) == [], "no store, empty results"
# Pending sales: the sold notice's row is filled by the matching sale, oldest first; 48 hours without a letter is unmatched.
g.EverlootDB.ledger = None
g.clock = NOW - 5000
assert L.RecordPending(A, "Linen Cloth") is True
g.clock = NOW - 4000
L.RecordPending(A, "Linen Cloth")
L.RecordPending(B, "Linen Cloth")
assert L.RecordPending(A, "") is False, "no item name"
first = L.MatchPending(A, "Linen Cloth")
assert first.at == NOW - 5000 and first.status == "pending" and L.MatchPending(A, "Copper Ore") is None, "oldest of this key and item"
assert L.MatchPending(B, "Linen Cloth").at == NOW - 4000
g.clock = NOW
assert L.RecordSale(A, extra(itemName="Linen Cloth", count=20, total=1990, deposit=60, cut=105)) is True
sales_rows = py(g.EverlootDB.ledger.sales)
assert len(sales_rows) == 3, "the sale filled a pending row, it did not add one"
assert sales_rows[0] == {"at": NOW, "key": A, "itemName": "Linen Cloth", "count": 20, "unit": 99, "total": 1990,
                         "deposit": 60, "cut": 105, "status": "paid"}, sales_rows[0]
assert sales_rows[1]["status"] == "pending" and sales_rows[1]["at"] == NOW - 4000, "the newer pending row stays"
by_item = py(L.SalesByItem(keys(A, B), 0, NOW))
assert by_item == [{"itemName": "Linen Cloth", "count": 20, "total": 1990, "unit": 99, "sales": 1}], by_item
L.RecordSale(A, extra(itemName="Copper Ore", count=1, total=10))
assert len(py(g.EverlootDB.ledger.sales)) == 4, "no pending row: the sale appends"
# 47 hours: still pending. 49 hours: unmatched, listed with that status, left out of the grouped view.
g.EverlootDB.ledger = None
g.clock = NOW
L.RecordPending(A, "Ore")
L.ExpirePending(NOW + 47 * 3600)
assert g.EverlootDB.ledger.sales[1].status == "pending", "47 hours is still pending"
L.ExpirePending(NOW + 49 * 3600)
assert g.EverlootDB.ledger.sales[1].status == "unmatched" and L.MatchPending(A, "Ore") is None
assert [r["status"] for r in py(L.Sales(keys(A), 0, NOW))] == ["unmatched"]
assert py(L.SalesByItem(keys(A), 0, NOW)) == []

print("ledger contract: PASS")
