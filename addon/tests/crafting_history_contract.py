"""Run with: uv run --with lupa python addon/tests/crafting_history_contract.py

Own price history for crafting (modules/crafting_history.lua): quantity ladders and seven-day baselines from this
install's own completed full scans, only for the items the current character's proven recipes take or make, kept on
this computer outside the upload records. The hand-checked cases are market-context-qa-cases.md in the SDD folder.
"""
import re
from pathlib import Path

from window_world import fresh

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\crafting_history.lua" in toc, "the crafting history module is in the TOC"
assert toc.index("modules\\crafting_plan.lua") < toc.index("modules\\crafting_history.lua") < toc.index("modules\\crafting.lua"), \
    "history loads after the recipe planner whose learned recipes it reads and before the calculator"

# Only the full-scan completion path writes history: no other module names it, and auctions.lua calls it once, from
# finish(), after the scan's records are stored. Search samples, character-only scans and imports never reach it.
writers = {}
for source in sorted((root / "modules").glob("*.lua")):
    code = source.read_text(encoding="utf-8")
    if source.name != "crafting_history.lua" and re.search(r"CraftingHistory\.(Start|Step|Observe)", code):
        writers[source.name] = code
assert list(writers) == ["auctions.lua"], f"only auctions.lua writes crafting history: {sorted(writers)}"
auctions = writers["auctions.lua"]
assert len(re.findall(r"^\s+recordHistory\(s\)$", auctions, re.M)) == 1, "one call site"
finish = auctions[auctions.index("local function finish()"):auctions.index("--- An unexpected row shape")]
assert "recordHistory(s)" in finish and finish.index("pruneScans(s.realm)") < finish.index("recordHistory(s)"), \
    "history is recorded in finish(), after the scan's records are stored"
fallback = auctions[auctions.index("local function finishFallback"):auctions.index("local function nextFallbackItem")]
assert "recordHistory" not in fallback and "CraftingHistory" not in fallback, "a partial sample never records history"

API = """
GetServerTime = function() return serverNow or (Everloot.DayNumber('2026-11-28') + 1) * 86400 - 1 end
UnitGUID = function() return 'Player-1-00000001' end
UnitExists = function() return true end
npcFaction = 'Alliance'
UnitFactionGroup = function(unit) if unit == 'npc' then return npcFaction end return 'Alliance', 'Alliance' end
replicate = {}
C_AuctionHouse = {
  ReplicateItems = function() end,
  GetNumReplicateItems = function() return #replicate end,
  -- name, texture, count, ... buyout (10th) ... itemId (17th), hasAllInfo
  GetReplicateItemInfo = function(i)
    local r = replicate[i]
    return 'Item', nil, r[2], nil, nil, nil, nil, nil, nil, r[3], nil, nil, nil, nil, nil, nil, r[1], r[4] ~= false
  end,
}
-- One completed full scan at `at`: rows are { itemId, count, buyout }.
function fullScan(rows, at, serverAt)
  now = at
  serverNow = serverAt or at
  EverlootDB.lastScanAt = nil
  replicate = rows
  fire('AUCTION_HOUSE_SHOW')
  Everloot:StartScan()
  fire('REPLICATE_ITEM_LIST_UPDATE')
  drain()
  serverNow = nil
end
"""
EXTRA = ("modules/sellcheck.lua", "modules/recipe_cooldown_data.lua", "modules/crafting_plan.lua",
         "modules/crafting_history.lua")


def world(saved="{ installId = 'abcd-1234', records = {} }"):
    return fresh(saved, API, extra=EXTRA)


lua = world()
lua.execute("""
H = Everloot.CraftingHistory
assert(type(H) == 'table' and H.ITEMS == 500 and H.LEVELS == 200 and H.DAYS == 14, 'limits')
function day(text) return Everloot.DayNumber(text) * 86400 end
assert(Everloot.DayNumber('1970-01-01') == 0, 'day numbers count from the epoch, as UTC seconds / 86400')
function check(q, cost, available, shortfall, what)
  assert(q, what .. ': a quote')
  assert(q.cost == cost and q.available == available and q.shortfall == shortfall,
    what .. ': cost ' .. tostring(q.cost) .. ', available ' .. tostring(q.available) .. ', shortfall ' .. tostring(q.shortfall))
end
""")

# 1. The quantity ladder walks price levels cheapest first, whatever the input order; the cheap single listing is
# never the price of many; insufficient depth is said, never extrapolated.
lua.execute("""
local t = day('2026-11-28') + 36000
assert(H.Observe('R1', 'Alliance', t, { [2589] = { { 60, 30 }, { 10, 1 }, { 100, 10 }, { 50, 20 } } }, { [2589] = true }))
check(H.Quote('R1', 'Alliance', 2589, 1, t), 10, 61, 0, 'one unit')
check(H.Quote('R1', 'Alliance', 2589, 20, t), 960, 61, 0, 'twenty units, not 20 x 10')
check(H.Quote('R1', 'Alliance', 2589, 21, t), 1010, 61, 0, 'twenty-one')
check(H.Quote('R1', 'Alliance', 2589, 51, t), 2810, 61, 0, 'fifty-one')
local all = H.Quote('R1', 'Alliance', 2589, 61, t)
check(all, 3810, 61, 0, 'every listed unit')
assert(all.covered and not all.truncated and all.at == t and all.bought == 61)
local short = H.Quote('R1', 'Alliance', 2589, 70, t)
check(short, 3810, 61, 9, 'seventy: the 61 listed cost 3810, nine missing')
assert(short.covered == false and short.bought == 61 and short.beyond == nil, 'insufficient depth is explicit')
assert(H.Quote('R1', 'Alliance', 9999, 1, t) == nil, 'an item never scanned has no quote, not cost 0')
assert(H.Quote('R1', 'Alliance', 2589, 0, t) == nil and H.Quote('R1', 'Alliance', 2589, 1.5, t) == nil, 'whole quantities only')
assert(H.Quote('R1', 'Alliance', 2589, 1, t + 14 * 86400) == nil, 'a ladder older than the 14 kept days is not quoted')
""")
print("Lua 5.1 crafting history: quantity ladder, cheapest-listing trap, insufficient depth")

# 2. Each realm and house is its own market, for depth and for baselines.
lua.execute("""
local t = day('2026-11-28') + 36000
H.Observe('R1', 'Horde', t, { [2589] = { { 30, 5 } } }, { [2589] = true })
H.Observe('R2', 'Alliance', t, { [2589] = { { 7, 100 } } }, { [2589] = true })
check(H.Quote('R1', 'Alliance', 2589, 5, t), 210, 61, 0, 'R1 Alliance')
check(H.Quote('R1', 'Horde', 2589, 5, t), 150, 5, 0, 'R1 Horde')
check(H.Quote('R2', 'Alliance', 2589, 5, t), 35, 100, 0, 'R2 Alliance')
assert(H.Quote('R1', 'Neutral', 2589, 5, t) == nil, 'a house never observed')
check(H.Quote('R1', 'Horde', 2589, 6, t), 150, 5, 1, 'Horde never borrows Alliance depth')
for _, d in ipairs({ '2026-11-25', '2026-11-26', '2026-11-27' }) do
  H.Observe('R1', 'Alliance', day(d) + 3600, { [7001] = { { 100, 1 } } }, { [7001] = true })
end
assert(H.Baseline('R1', 'Alliance', 7001, '2026-11-28') == 100)
local m, days = H.Baseline('R1', 'Horde', 7001, '2026-11-28')
assert(m == nil and days == 0, 'baselines are per house too')
""")
print("Lua 5.1 crafting history: realms and houses kept apart")

# 3. 200 price levels kept, the cheapest; a truncated ladder never claims complete depth.
lua.execute("""
local t = day('2026-11-28') + 36000
local many, fewer = {}, {}
for k = 201, 1, -1 do many[#many + 1] = { k, 1 } end   -- most expensive first: a cut by listing order would keep the wrong tail
for k = 1, 199 do fewer[#fewer + 1] = { k, 1 } end
H.Observe('R1', 'Alliance', t, { [900] = many, [901] = fewer }, { [900] = true, [901] = true })
local levels = EverlootDB.craftingHistory.realms.R1.Alliance.items[900].levels
local _, n = levels:gsub(':', '')
assert(n == 200 and levels:find('^1:1 2:1 ') and levels:find(' 200:1$'), 'the cheapest 200 levels: ' .. n)
local q = H.Quote('R1', 'Alliance', 900, 150, t)
assert(q.cost == 11325 and q.covered and q.truncated, 'exact lower-tail cost, still marked truncated')
q = H.Quote('R1', 'Alliance', 900, 200, t)
assert(q.cost == 20100 and q.available == 200 and q.truncated, 'available is at least 200, not all there is')
q = H.Quote('R1', 'Alliance', 900, 201, t)
assert(q.cost == 20100 and q.covered == false and q.shortfall == nil and q.beyond == 1,
  'beyond the kept levels is unknown: no definite shortfall, no complete claim')
q = H.Quote('R1', 'Alliance', 901, 200, t)
assert(not q.truncated and q.shortfall == 1 and q.available == 199, 'an untruncated ladder has a real shortfall')
""")
print("Lua 5.1 crafting history: 200 cheapest levels, truncation never claims full coverage")

# 4. Admission at the caller: a completed own full scan of a named house, for this character's learned recipes.
lua.execute("""
local E = Everloot
local key = E.CharacterKey()
assert(key, 'the test character has a key')
assert(E.CraftingPlan.ReplaceKnown(key, 185, { { recipeId = 7751, learned = true, itemId = 4, minimum = 1, maximum = 1,
  reagents = { { itemId = 2589, count = 2 } } } }, true))
local interests = H.Interests(key)
assert(interests[4] and interests[2589] and not interests[7777], 'inputs and outputs of the proven recipes only')
local starts = 0
local start = H.Start
H.Start = function(...) starts = starts + 1; return start(...) end
local d = day('2026-11-28')
fullScan({ { 2589, 10, 400 }, { 4, 1, 900 }, { 7777, 1, 5 } }, d + 36000)          -- S1 10:00: 2589 at 40
assert(starts == 1, 'the completed full scan started one history job')
local item = EverlootDB.craftingHistory.realms.Forever.Alliance.items
assert(item[2589] and item[4] and item[7777] == nil, 'only the learned recipe items are kept')
check(H.Quote('Forever', 'Alliance', 2589, 5, d + 36000), 200, 10, 0, 'S1')
fullScan({ { 2589, 10, 350 }, { 4, 1, 900 } }, d + 43200)                        -- S2 12:00: 35
check(H.Quote('Forever', 'Alliance', 2589, 5, d + 43200), 175, 10, 0, 'the newest completed scan')
assert(item[2589].days[d / 86400][2] == 35, 'S2 overwrote the day value')
fullScan({ { 2589,10,10 }, { false,1,900,false } }, d+45000)
assert(starts == 2, 'a scan with rows still unloaded cannot start history')
check(H.Quote('Forever','Alliance',2589,5,d+45000),175,10,0,'unloaded rows leave the last complete depth intact')
-- A scan the house closes on is not complete: nothing is recorded.
E.SCAN_CHUNK = 1
EverlootDB.lastScanAt = nil
replicate = { { 2589, 100, 100 }, { 4, 1, 900 } }
now = d + 50000
E:StartScan()
fire('REPLICATE_ITEM_LIST_UPDATE')
fire('AUCTION_HOUSE_CLOSED')
drain()
E.SCAN_CHUNK = 1000
check(H.Quote('Forever', 'Alliance', 2589, 5, now), 175, 10, 0, 'an interrupted scan changed nothing')
assert(starts == 2, 'and started no job: ' .. starts)
-- A scan whose auctioneer cannot be read has no house: no history.
UnitExists = function() return false end
fullScan({ { 2589, 100, 100 } }, d + 60000)
UnitExists = function() return true end
assert(starts == 2, 'a scan with no house is not recorded')
check(H.Quote('Forever', 'Alliance', 2589, 5, now), 175, 10, 0, 'still S2')
-- A completed scan where the item is absent: none listed now, and no day value from it.
fullScan({ { 4, 1, 900 } }, d + 64800)                                            -- S3 18:00
local q = H.Quote('Forever', 'Alliance', 2589, 5, d + 64800)
assert(q and q.available == 0 and q.cost == nil and q.shortfall == 5 and q.bought == 0, 'none listed: no zero price')
assert(item[2589].days[d / 86400][2] == 35, 'an absent item writes no day value')
-- The calculator's scan quotes are unchanged by history: a fresh scan prices from its own summary.
H.Start = start
""")
print("Lua 5.1 crafting history: only completed own full scans of a named house, for learned recipe items")

# Character-only scans (no realm) stay local and record no history.
lua.execute("""
local E = Everloot
local starts = 0
local start = H.Start
H.Start = function(...) starts = starts + 1; return start(...) end
GetRealmName = function() return '' end
GetRealmID = function() return 0 end
fullScan({ { 2589, 1, 10 } }, day('2026-11-28') + 70000)
assert(E:OwnScan(nil), 'the character-only scan was kept locally')
assert(starts == 0, 'a character-only scan records no history')
GetRealmName = function() return 'Forever' end
H.Start = start
""")


def upload_records(with_history):
    w = world()
    if not with_history:
        w.execute("Everloot.CraftingHistory = nil")
    w.execute("""
local E = Everloot
E.CraftingPlan.ReplaceKnown(E.CharacterKey(), 185, { { recipeId = 7751, learned = true, itemId = 4, minimum = 1,
  maximum = 1, reagents = { { itemId = 2589, count = 2 } } } }, true)
fullScan({ { 2589, 10, 400 }, { 2589, 5, 150 }, { 4, 1, 900 }, { 7777, 1, 5 } }, 1764320000)
local out = {}
for _, r in ipairs(EverlootDB.records.auction_snapshot) do
  out[#out + 1] = table.concat({ r.installId, r.capturedAt, r.realm, tostring(r.house), r.scanId, r.part, r.parts }, '|')
  for _, it in ipairs(r.items) do out[#out + 1] = table.concat(it, ',') end
end
local keys = {}
for k in pairs(EverlootDB.records) do keys[#keys + 1] = k end
table.sort(keys)
result = table.concat(out, ';') .. '#' .. table.concat(keys, ',')
history = EverlootDB.craftingHistory ~= nil
""")
    return w.eval("result"), w.eval("history")


with_text, with_kept = upload_records(True)
without_text, without_kept = upload_records(False)
assert with_kept and not without_kept, "the history is kept only with the module"
assert with_text == without_text, f"upload records are identical with and without history:\n{with_text}\n{without_text}"
assert "craftingHistory" not in with_text, "history is not an upload record"
print("Lua 5.1 crafting history: outside the upload records, which stay byte-identical")

# 5. Seven prior UTC days, today excluded, at least three observed days; the day's last scan is its value.
lua.execute("""
local function seed(id, samples)
  for _, s in ipairs(samples) do
    assert(H.Observe('R1', 'Alliance', s[1], { [id] = { { s[2], 1 } } }, { [id] = true }))
  end
end
local function at(d, h) return day(d) + (h or 12) * 3600 end
local cases = {
  { 1, { { at('2026-11-26'), 100 }, { at('2026-11-27'), 110 } }, nil, 2 },
  { 2, { { at('2026-11-25'), 100 }, { at('2026-11-26'), 120 }, { at('2026-11-27'), 110 }, { at('2026-11-28'), 500 } }, 110, 3 },
  { 3, { { at('2026-11-25'), 100 }, { at('2026-11-26'), 120 }, { at('2026-11-27', 1), 10 }, { at('2026-11-27', 23), 110 } }, 110, 3 },
  { 4, { { at('2026-11-21'), 90 }, { at('2026-11-24'), 200 }, { at('2026-11-27'), 100 } }, 100, 3 },
  { 5, { { at('2026-11-20'), 5 }, { at('2026-11-26'), 100 }, { at('2026-11-27'), 110 } }, nil, 2 },
  { 7, { { at('2026-11-24'), 100 }, { at('2026-11-25'), 110 }, { at('2026-11-26'), 121 }, { at('2026-11-27'), 130 } }, 115, 4 },
  { 8, { { at('2026-11-25'), 100 }, { at('2026-11-26'), 500 }, { day('2026-11-27') + 86399, 300 }, { day('2026-11-28') + 1, 900 } }, 300, 3 },
}
for _, c in ipairs(cases) do
  local id = 8000 + c[1]
  seed(id, c[2])
  local m, days = H.Baseline('R1', 'Alliance', id, '2026-11-28')
  assert(m == c[3] and days == c[4], 'B' .. c[1] .. ': ' .. tostring(m) .. ', ' .. tostring(days))
end
-- B6: only the seven prior days count, older samples are ignored.
local six = {}
for i = 14, 20 do six[#six + 1] = { at(string.format('2026-11-%02d', i)), 9999 } end
for i = 21, 27 do six[#six + 1] = { at(string.format('2026-11-%02d', i)), (i - 20) * 10 } end
H.DAYS = 30 -- keep the older samples for this case, to prove the window ignores them
seed(8006, six)
H.DAYS = 14
local m, days = H.Baseline('R1', 'Alliance', 8006, '2026-11-28')
assert(m == 40 and days == 7, 'B6: ' .. tostring(m) .. ', ' .. tostring(days))
-- Today's change against the baseline: B2's 500 today is +390, +354.5%.
local c = H.Change('R1', 'Alliance', 8002, '2026-11-28')
assert(c.median == 110 and c.days == 3 and c.today == 500 and c.change == 390 and math.abs(c.percent - 354.545) < 0.01)
c = H.Change('R1', 'Alliance', 8001, '2026-11-28')
assert(c.median == nil and c.today == nil and c.change == nil, 'no change without a baseline')
-- The baseline also reads seconds: 2026-11-28 12:00 UTC is the same day.
assert(H.Baseline('R1', 'Alliance', 8002, at('2026-11-28')) == 110)
-- A week later with no new scans the window has moved past every sample.
m, days = H.Baseline('R1', 'Alliance', 8006, '2026-12-05')
assert(m == nil and days == 0, 'old days do not carry a baseline forward')
""")
print("Lua 5.1 crafting history: seven prior UTC days, today excluded, three days needed, same-day overwrite, even median")

# 14 UTC days kept, today included; older days are pruned when a newer day is written.
lua.execute("""
local id = 8100
H.Observe('R1', 'Alliance', day('2026-11-14') + 3600, { [id] = { { 50, 1 } } }, { [id] = true })
H.Observe('R1', 'Alliance', day('2026-11-15') + 3600, { [id] = { { 60, 1 } } }, { [id] = true })
H.Observe('R1', 'Alliance', day('2026-11-28') + 3600, { [id] = { { 70, 1 } } }, { [id] = true })
local days = EverlootDB.craftingHistory.realms.R1.Alliance.items[id].days
assert(days[Everloot.DayNumber('2026-11-14')] == nil, 'the 15th day back is pruned')
assert(days[Everloot.DayNumber('2026-11-15')][2] == 60 and days[Everloot.DayNumber('2026-11-28')][2] == 70, '11-15..11-28 kept')
""")
print("Lua 5.1 crafting history: 14 UTC days kept")

# Out of order and malformed input never poison history.
lua.execute("""
local d = day('2026-11-28')
local id = 8200
H.Observe('R1', 'Alliance', d + 43200, { [id] = { { 35, 10 } } }, { [id] = true })
H.Observe('R1', 'Alliance', d + 36000, { [id] = { { 40, 10 } } }, { [id] = true })   -- older scan finished later
check(H.Quote('R1', 'Alliance', id, 5, d + 43200), 175, 10, 0, 'the newer ladder stays')
local item = EverlootDB.craftingHistory.realms.R1.Alliance.items[id]
assert(item.at == d + 43200 and item.days[d / 86400][2] == 35, 'the newer day value stays')
H.Observe('R1', 'Alliance', d - 86400 + 3600, { [id] = { { 45, 10 } } }, { [id] = true })  -- yesterday, late
assert(item.at == d + 43200 and item.days[d / 86400 - 1][2] == 45, 'a late older scan adds its own day only')
-- Malformed times and amounts.
assert(H.Observe('R1', 'Alliance', 'soon', { [id] = { { 1, 1 } } }, { [id] = true }) == nil, 'a text time is refused')
assert(H.Observe('R1', 'Alliance', d + 0.5, { [id] = { { 1, 1 } } }, { [id] = true }) == nil, 'a fractional time is refused')
assert(H.Observe('R1', 'Alliance', 0 / 0, { [id] = { { 1, 1 } } }, { [id] = true }) == nil, 'NaN is refused')
assert(H.Observe(nil, 'Alliance', d, { [id] = { { 1, 1 } } }, { [id] = true }) == nil, 'no realm')
assert(H.Observe('R1', nil, d, { [id] = { { 1, 1 } } }, { [id] = true }) == nil, 'no house')
check(H.Quote('R1', 'Alliance', id, 5, d + 43200), 175, 10, 0, 'unchanged after refused input')
H.Observe('R1', 'Alliance', d + 50000, { [8201] = { { 0, 5 }, { -1, 2 }, { 1.5, 1 }, { 'a', 1 }, { 5, 0 }, { 0 / 0, 1 } } },
  { [8201] = true })
assert(EverlootDB.craftingHistory.realms.R1.Alliance.items[8201] == nil and H.Quote('R1', 'Alliance', 8201, 1) == nil,
  'an item whose every listing is malformed is not evidence of anything')
H.Observe('R1', 'Alliance', d + 50000, { [8202] = { { 0, 5 }, { 20, 2 }, { 1 / 0, 3 } } }, { [8202] = true })
local q = H.Quote('R1', 'Alliance', 8202, 3, d + 50000)
assert(q.cost == 40 and q.available == 2 and q.shortfall == 1, 'malformed listings dropped, no zero price')
assert(EverlootDB.craftingHistory.realms.R1.Alliance.items[8202].days[d / 86400][2] == 20)
""")
print("Lua 5.1 crafting history: out-of-order scans and malformed input")

drift = world()
drift.execute("""
local E = Everloot
local d = E.DayNumber('2026-11-28') * 86400
assert(E.CraftingPlan.ReplaceKnown(E.CharacterKey(),185,{{recipeId=7751,learned=true,itemId=4,minimum=1,maximum=1,
 reagents={{itemId=2589,count=2}}}},true))
fullScan({{2589,10,400}},d+1600,d+1000)
local q = E.CraftingHistory.Quote('Forever','Alliance',2589,5,d+2000)
assert(q and q.cost == 200 and q.at == d+1000, 'a ten-minute fast local clock still commits with server start time')
assert(EverlootDB.lastScans.Forever.at == d+1600, 'existing public scan timestamp stays unchanged')
GetServerTime = nil
fullScan({{2589,10,350}},d+3000)
q = E.CraftingHistory.Quote('Forever','Alliance',2589,5,d+4000)
assert(q and q.cost == 175 and q.at == d+3000, 'missing server clock uses a consistent local fallback')
""")

lua.execute("""
local id, wanted = 8250, { [8250]=true }
local savedNow = now
now = day('2027-11-28')
local ok, why = H.Observe('Future', 'Alliance', now, { [id]={{999,1}} }, wanted)
assert(ok == nil and why == 'future time', 'a future scan cannot poison the house even if the local clock is ahead')
now = savedNow
for i=25,28 do
 assert(H.Observe('Future', 'Alliance', day('2026-11-' .. i)+3600, { [id]={{100+(i-25)*10,1}} }, wanted))
end
assert(H.Quote('Future','Alliance',id,1,day('2026-11-28')+7200).cost == 130, 'correct scans still replace the depth')
local baseline, days = H.Baseline('Future','Alliance',id,'2026-11-28')
assert(baseline == 110 and days == 3, 'correct daily samples survive the rejected future scan')
local serverNow = GetServerTime()
assert(H.Start('Future','Horde',serverNow+121,{[id]={{1,1}}},wanted) == nil, 'future tolerance is bounded')
""")

# An unfinished or superseded job writes nothing.
lua.execute("""
local d = day('2026-11-28')
local items = { [8301] = { { 10, 1 } }, [8302] = { { 20, 1 } }, [8303] = { { 30, 1 } } }
local want = { [8301] = true, [8302] = true, [8303] = true }
local old = H.Start('R1', 'Alliance', d + 1000, items, want)
assert(H.Step(old, 1) == false, 'one of three read')
assert(EverlootDB.craftingHistory.realms.R1.Alliance.items[8301] == nil, 'nothing is written before the last step')
local newer = H.Start('R1', 'Alliance', d + 2000, { [8301] = { { 11, 1 } } }, want)
assert(H.Step(old, 10) == true and not old.committed, 'the superseded job ends without writing')
assert(EverlootDB.craftingHistory.realms.R1.Alliance.items[8302] == nil)
assert(H.Step(newer, 10) == true and newer.committed)
check(H.Quote('R1', 'Alliance', 8301, 1, d + 2000), 11, 1, 0, 'the newer job wrote')
assert(H.Quote('R1', 'Alliance', 8302, 1, d + 2000).available == 0, 'absent from the newer complete scan')
-- Another house's job is not superseded.
local a = H.Start('R1', 'Alliance', d + 3000, items, want)
local b = H.Start('R1', 'Horde', d + 3000, items, want)
assert(H.Step(a, 10) and a.committed and H.Step(b, 10) and b.committed)
""")
print("Lua 5.1 crafting history: unfinished and superseded jobs write nothing")

# 7. At most 500 items per house, least recently used pruned first; ties by item ID.
lua.execute("""
local d = day('2026-11-28')
local function scan(house, from, to, t)
  local items, want = {}, {}
  for id = from, to do items[id] = { { 10, 1 } }; want[id] = true end
  assert(H.Observe('R9', house, t, items, want))
end
local function count(house)
  local n = 0
  for _ in pairs(EverlootDB.craftingHistory.realms.R9[house].items) do n = n + 1 end
  return n
end
scan('A', 1, 500, d + 10)
assert(H.Quote('R9', 'A', 1, 1, d + 20), 'item 1 used again')
scan('A', 501, 501, d + 30)
local items = EverlootDB.craftingHistory.realms.R9.A.items
assert(count('A') == 500 and items[1] and items[501] and items[2] == nil and items[3], 'item 2 is the least recently used')
-- One scan of 501 items: all used together, the lowest item ID goes.
scan('B', 1, 501, d + 10)
items = EverlootDB.craftingHistory.realms.R9.B.items
assert(count('B') == 500 and items[1] == nil and items[2] and items[501], 'ties prune by item ID')
""")
print("Lua 5.1 crafting history: 500 items per house, deterministic least-recently-used pruning")

# Performance: a synthetic 500-item, 200-level house through the real full-scan path. The history job runs a few
# items a frame after the scan reported; every scheduled step is timed, and the saved history is serialized the way
# the client writes SavedVariables.
perf = world()
perf.execute("""
local E, H = Everloot, Everloot.CraftingHistory
local recipes, rows = {}, {}
for i = 1, 500 do
  local id = 20000 + i
  recipes[#recipes + 1] = { recipeId = 40000 + i, learned = true, reagents = { { itemId = id, count = 1 } } }
  for level = 1, 200 do rows[#rows + 1] = { id, 1 + (level % 3), (1000 + level * 7) * (1 + (level % 3)) } end
end
assert(E.CraftingPlan.ReplaceKnown(E.CharacterKey(), 185, recipes, true))
stepTimes, stepItems, reported = {}, {}, nil
local step = H.Step
H.Step = function(job, n)
  if not reported then reported = #printed end
  local before, started = job.next, os.clock()
  local done = step(job, n)
  stepTimes[#stepTimes + 1] = os.clock() - started
  stepItems[#stepItems + 1] = job.next - before
  return done
end
local started = os.clock()
fullScan(rows, 1764320000)
total = os.clock() - started
H.Step = step
historyTotal, worst = 0, 0
for _, t in ipairs(stepTimes) do historyTotal = historyTotal + t; worst = math.max(worst, t) end
local n = 0
for _ in pairs(EverlootDB.craftingHistory.realms.Forever.Alliance.items) do n = n + 1 end
kept = n
-- The SavedVariables text the client would write for this table (keys, nesting and array index comments).
local function serialize(v, indent, out)
  if type(v) == 'table' then
    out[#out + 1] = '{\\n'
    local n = #v
    for i = 1, n do
      out[#out + 1] = indent .. '\\t'; serialize(v[i], indent .. '\\t', out); out[#out + 1] = ', -- [' .. i .. ']\\n'
    end
    for k, x in pairs(v) do
      if not (type(k) == 'number' and k >= 1 and k <= n and k % 1 == 0) then
        out[#out + 1] = indent .. '\\t[' .. (type(k) == 'string' and string.format('%q', k) or tostring(k)) .. '] = '
        serialize(x, indent .. '\\t', out); out[#out + 1] = ',\\n'
      end
    end
    out[#out + 1] = indent .. '}'
  elseif type(v) == 'string' then out[#out + 1] = string.format('%q', v)
  else out[#out + 1] = tostring(v) end
end
local out = {}
serialize(EverlootDB.craftingHistory, '', out)
bytes = #table.concat(out)
""")
steps = perf.eval("#stepTimes")
items = [perf.eval(f"stepItems[{i}]") for i in range(1, steps + 1)]
worst_ms = perf.eval("worst") * 1000
history_ms = perf.eval("historyTotal") * 1000
total_ms = perf.eval("total") * 1000
size = perf.eval("bytes")
assert perf.eval("kept") == 500, "all 500 learned inputs kept"
chunk = perf.eval("Everloot.CraftingHistory.CHUNK")
assert chunk == 10 and steps == 50 and max(items) == chunk and sum(items) == 500, f"10 items a step, one step a frame: {items}"
assert perf.eval("reported") is not None and perf.eval("printed[reported]").find("scanned 500 items") >= 0, \
    "the scan reported before the first history step ran"
assert perf.eval("EverlootDB.craftingHistory.realms.Forever.Alliance.items[20001].levels"), "levels kept"
# Budgets with headroom for a slow CI runner; the measured figures are printed and reported.
assert worst_ms < 100, f"worst history step {worst_ms:.1f} ms"
assert size < 2_500_000, f"serialized history {size} bytes"
print(f"Lua 5.1 crafting history: 500 items x 200 levels: {steps} steps of <= {chunk} items, worst step {worst_ms:.1f} ms, "
      f"history {history_ms:.0f} ms in all, scan plus history {total_ms:.0f} ms, saved history {size / 1024:.0f} KiB")
