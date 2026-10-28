"""Run with: uv run --with lupa --with jsonschema python addon/tests/conveniences_contract.py

Two chores, both off until switched on. At a merchant: sell grey items only and repair with the player's
own gold (never the guild bank). At the mailbox: Collect all takes money and items from auction invoices,
skipping cash on delivery and every letter without an auction invoice, one take at a time, and stops when
the bags are full. The gold module's vendor and auction-sale records stay correct, repairs stay unrecorded,
and no other player's name reaches a record.
"""
import re
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]

WORLD = """
date = function() return '2026-10-23T00:00:00Z' end
time = function() return 1000 end
printed = {}
print = function(msg) printed[#printed + 1] = tostring(msg) end
SlashCmdList = {}
local Frame = {}
Frame.__index = function(self, key) return rawget(Frame, key) or function() end end
function Frame.SetScript(self, name, f) self.scripts[name] = f; if name == 'OnEvent' then self.onEvent = f end end
function Frame.HookScript(self, _, f) table.insert(self.hooks, f) end
function Frame.SetText(self, t) self.text = t end
function Frame.Show(self) self.shown = true end
function Frame.Hide(self) self.shown = false end
CreateFrame = function(kind, name)
  return setmetatable({ kind = kind, name = name, scripts = {}, hooks = {} }, Frame)
end
InboxFrame = CreateFrame('Frame', 'InboxFrame')
UnitName = function() return 'Thrall' end
GetRealmName = function() return 'Test Realm' end
NUM_BAG_SLOTS = 1
money = 100000
GetMoney = function() return money end
hooksecurefunc = function(name, after)
  local original = _G[name]
  _G[name] = function(...) original(...); after(...) end
end
-- Timers run only when the test says so; the server's replies (gold changes) only when it flushes them.
timers = {}
C_Timer = { After = function(seconds, f) table.insert(timers, f) end }
function runTimers() local list = timers; timers = {}; for _, f in ipairs(list) do f() end end
server = {}
function flush()
  local list = server; server = {}
  for _, f in ipairs(list) do f() end
end
function fire(name, ...)
  for _, hook in ipairs(Everloot.frame.hooks) do hook(nil, name, ...) end
end
function drive() for _ = 1, 60 do flush(); runTimers() end end
-- A change in the purse reaches the addon later, as an event.
function pay(delta) server[#server + 1] = function() money = money + delta; fire('PLAYER_MONEY') end end
"""

VENDOR = """
-- bag -> slot -> item. A grey is quality 0.
bags = {
  [0] = {
    { quality = 0, count = 3, link = 'grey-a', price = 10 },
    { quality = 1, count = 1, link = 'white', price = 50 },
    { quality = 0, count = 1, link = 'grey-novalue', price = 0, noValue = true },
    { quality = 2, count = 1, link = 'green', price = 90 },
  },
  [1] = { { quality = 0, count = 1, link = 'grey-b', price = 5 } },
}
prices = {}
for _, bag in pairs(bags) do for _, item in pairs(bag) do prices[item.link] = item.price end end
GetItemInfo = function(link) return 'n', link, 0, 1, 1, 't', 'st', 1, '', 1, prices[link] end
sold = {}
local function use(bag, slot)
  local item = bags[bag] and bags[bag][slot]
  sold[#sold + 1] = item and item.link or '?'
  if item then pay(item.price * item.count); bags[bag][slot] = nil end
end
if MODERN then
  C_Container = {
    GetContainerNumSlots = function(bag) return 4 end,
    GetContainerItemInfo = function(bag, slot)
      local i = bags[bag] and bags[bag][slot]
      if not i then return nil end
      return { quality = i.quality, stackCount = i.count, hyperlink = i.link, hasNoValue = i.noValue }
    end,
    UseContainerItem = use,
  }
else
  GetContainerNumSlots = function() return 4 end
  GetContainerItemInfo = function(bag, slot)
    local i = bags[bag] and bags[bag][slot]
    if not i then return nil end
    return 'icon', i.count, false, i.quality, false, false, i.link, false, i.noValue
  end
  UseContainerItem = use
end
repairCost = 400
repairCalls = {}
CanMerchantRepair = function() return true end
GetRepairAllCost = function() return repairCost, true end
RepairAllItems = function(guild)
  repairCalls[#repairCalls + 1] = guild
  pay(-repairCost)
end
"""

MAIL = """
inbox = {
  -- 1: a sold auction (the letter pays sale minus cut plus the returned deposit)
  { invoice = 'seller', buyer = 'Jaina', money = 3000, bid = 2900, deposit = 250, cut = 150, sender = 'Auction House' },
  -- 2: a player's letter with gold, no invoice
  { money = 700, sender = 'Jaina' },
  -- 3: cash on delivery, an item
  { cod = 500, item = true, sender = 'Jaina' },
  -- 4: a won auction: an item, an invoice
  { invoice = 'buyer', buyer = 'Jaina', item = true, sender = 'Auction House' },
  -- 5: another sold auction
  { invoice = 'seller', buyer = 'Jaina', money = 900, bid = 900, deposit = 45, cut = 45, sender = 'Auction House' },
  -- 6: an auction invoice that also demands cash on delivery: not taken either
  { invoice = 'buyer', cod = 100, item = true, sender = 'Auction House' },
}
free = 5
taken = {}
-- The server deletes an emptied auction letter; the letters after it slide down one position.
autoDelete = false
local function dropIfEmpty(m)
  if not (autoDelete and m.invoice and not m.money and not m.item) then return end
  for j, other in ipairs(inbox) do if other == m then table.remove(inbox, j) break end end
end
GetInboxNumItems = function() return #inbox end
GetInboxHeaderInfo = function(i)
  local m = inbox[i]
  if not m then return nil end
  return 'icon', 'paper', m.sender, 'subject', m.money or 0, m.cod or 0, 20, m.item and 1 or nil
end
GetInboxInvoiceInfo = function(i)
  local m = inbox[i]
  if not m or not m.invoice then return nil end
  return m.invoice, 'Silk', m.buyer, m.bid, m.bid, m.deposit, m.cut
end
GetContainerNumFreeSlots = function(bag) if bag == 0 then return free, 0 end return 0, 0 end
TakeInboxMoney = function(i)
  taken[#taken + 1] = 'money' .. i
  local m = inbox[i]
  if not m then return end
  -- The letter keeps showing its money until the server answers, as the client does.
  local amount = m.money or 0
  server[#server + 1] = function() m.money = nil; money = money + amount; dropIfEmpty(m); fire('PLAYER_MONEY') end
end
AutoLootMailItem = function(i)
  taken[#taken + 1] = 'item' .. i
  local m = inbox[i]
  if not m then return end
  m.item = nil
  free = free - 1
  dropIfEmpty(m)
end
"""


def fresh(modern=True, extra=""):
    lua = LuaRuntime()
    lua.execute(WORLD)
    lua.execute(f"MODERN = {'true' if modern else 'false'}")
    lua.execute(VENDOR)
    lua.execute(MAIL)
    lua.execute(extra)
    for file in ["core.lua", "modules/gold.lua", "modules/conveniences.lua"]:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot'); fire('PLAYER_ENTERING_WORLD')")
    return lua


COMMON = """
function events(category)
  local list = {}
  for _, row in ipairs(EverlootDB.records.money_event or {}) do
    if category == nil or row.category == category then list[#list + 1] = row end
  end
  return list
end
function said(text)
  for _, line in ipairs(printed) do if string.find(line, text, 1, true) then return true end end
  return false
end
"""

for modern in (True, False):
    lua = fresh(modern)
    lua.execute(COMMON)
    lua.execute("""
    -- Both chores are off in a new install: a merchant and a mailbox change nothing, the button is hidden.
    assert(EverlootDB.autoVendor ~= true and EverlootDB.mailCollect ~= true, 'both off by default')
    fire('MERCHANT_SHOW'); drive(); fire('MERCHANT_CLOSED')
    assert(#sold == 0 and #repairCalls == 0, 'off: nothing sold, nothing repaired')
    fire('MAIL_SHOW')
    assert(InboxFrame ~= nil and Everloot.Conveniences.button.shown == false, 'off: the button is hidden')
    Everloot.Conveniences.button.scripts.OnClick(); drive()
    assert(#taken == 0, 'off: a click takes nothing')

    -- On: only greys with a vendor price are sold, in every bag.
    SlashCmdList.EVERLOOT('vendor on')
    assert(EverlootDB.autoVendor == true)
    fire('MERCHANT_SHOW')
    runTimers()
    table.sort(sold)
    assert(table.concat(sold, ',') == 'grey-a,grey-b', 'greys only, got ' .. table.concat(sold, ','))
    assert(bags[0][2] and bags[0][4] and bags[0][3], 'white, green and the no-value grey stay')
    -- The repair waits for the sales' gold change, so one change cannot hide the other.
    assert(#repairCalls == 0, 'repair waits for the sale to reach the ledger')
    flush(); runTimers()
    assert(#repairCalls == 1 and repairCalls[1] == false, 'repair once, never from the guild bank')
    flush()
    -- The ledger: the sales are vendor income (35 copper); the repair is not recorded at all.
    local vendor = events('vendor')
    local total = 0
    for _, row in ipairs(vendor) do total = total + row.copper end
    assert(total == 35, 'vendor sales recorded in full, got ' .. total)
    assert(#events() == #vendor, 'the repair is not recorded as anything')
    assert(said('sold 2 grey items for 35c') and said('repaired for 4s 0c'), 'one summary line: ' .. table.concat(printed, ' | '))
    fire('MERCHANT_CLOSED')

    -- Nothing to sell: the repair runs at once. A repair the purse cannot pay is not attempted.
    printed = {}
    fire('MERCHANT_SHOW'); runTimers(); flush()
    assert(#repairCalls == 2 and #events() == #vendor, 'repair alone, still unrecorded')
    fire('MERCHANT_CLOSED')
    repairCost = money + 1
    fire('MERCHANT_SHOW'); runTimers(); flush()
    assert(#repairCalls == 2, 'no repair above the purse')
    fire('MERCHANT_CLOSED')

    -- A merchant closed before the timer runs: nothing happens.
    repairCost = 400
    SlashCmdList.EVERLOOT('vendor off')
    assert(EverlootDB.autoVendor == false)
    fire('MERCHANT_SHOW'); fire('MERCHANT_CLOSED'); runTimers(); flush()
    assert(#repairCalls == 2)

    -- Switched off before the settle timer: nothing is sold.
    local soldBefore = #sold
    SlashCmdList.EVERLOOT('vendor on')
    fire('MERCHANT_SHOW')
    SlashCmdList.EVERLOOT('vendor off')
    runTimers(); flush()
    assert(#sold == soldBefore and #repairCalls == 2, 'off before the settle timer: nothing sold or repaired')
    fire('MERCHANT_CLOSED')

    -- Switched off while the repair waits for the sales' gold change: the sales are made and reported, the
    -- repair, which spends gold, is not.
    bags[0][1] = { quality = 0, count = 3, link = 'grey-a', price = 10 }
    bags[1][1] = { quality = 0, count = 1, link = 'grey-b', price = 5 }
    printed = {}
    SlashCmdList.EVERLOOT('vendor on')
    fire('MERCHANT_SHOW'); runTimers()
    assert(#sold == soldBefore + 2 and #repairCalls == 2, 'greys sold, repair waiting')
    SlashCmdList.EVERLOOT('vendor off')
    flush(); runTimers(); flush()
    assert(#repairCalls == 2, 'off before the delayed repair: no gold spent')
    assert(said('sold 2 grey items for 35c') and not said('repaired'), 'the sales are still summarised: ' .. table.concat(printed, ' | '))
    fire('MERCHANT_CLOSED')
    """)

# --- Mailbox ---
lua = fresh(True)
lua.execute(COMMON)
lua.execute("""
SlashCmdList.EVERLOOT('mail on')
assert(EverlootDB.mailCollect == true)
fire('MAIL_SHOW')
local button = Everloot.Conveniences.button
assert(button.shown == true and button.text == 'Collect all')
button.scripts.OnClick()
assert(button.text == 'Stop', 'a run can be stopped')
-- One take, then it waits: the next take does not happen until the gold change arrived.
assert(#taken == 1 and taken[1] == 'money5', 'last letter first, one take at a time, got ' .. table.concat(taken, ','))
runTimers()
assert(#taken == 1, 'it waits for the gold change')
flush()
drive()
assert(table.concat(taken, ',') == 'money5,item4,money1', 'only auction invoices without cash on delivery: ' .. table.concat(taken, ','))
assert(inbox[2].money == 700 and inbox[3].item and inbox[6].item, 'player mail and COD letters untouched')
assert(button.text == 'Collect all', 'finished')
assert(said('3 skipped') and said('from 3 letters') and said('39s 0c'), table.concat(printed, ' | '))

-- The ledger: each sale is the invoice's price minus the house cut; the deposit is not income.
local sales = events('auction')
assert(#sales == 2 and sales[1].copper == 855 and sales[2].copper == 2750, 'two auction sales net of the cut, got ' .. #sales)
assert(#events() == 2, 'nothing else recorded')
-- Other players: no sender or buyer name is stored anywhere.
local function scan(value)
  if type(value) == 'table' then for _, v in pairs(value) do scan(v) end
  else assert(value ~= 'Jaina' and value ~= 'Auction House', 'a mail name reached the file') end
end
scan(EverlootDB.records)

-- Bags full: it stops before taking an item, and says so.
printed = {}
inbox = { { invoice = 'buyer', buyer = 'Jaina', item = true, sender = 'Auction House' } }
taken = {}
free = 0
button.scripts.OnClick(); drive()
assert(#taken == 0 and said('bags full'), 'no item taken with the bags full: ' .. table.concat(printed, ' | '))

-- A letter whose invoice cannot be read is skipped, never guessed at.
printed = {}
free = 5
inbox = { { money = 50, sender = 'Auction House' } }
button.scripts.OnClick(); drive()
assert(#taken == 0 and said('1 skipped'))

-- The mailbox closing stops a run.
inbox = { { invoice = 'seller', buyer = 'Jaina', money = 500, bid = 500, deposit = 0, cut = 0 }, { invoice = 'seller', buyer = 'Jaina', money = 600, bid = 600, deposit = 0, cut = 0 } }
taken = {}
button.scripts.OnClick()
assert(#taken == 1)
fire('MAIL_CLOSED'); flush(); drive()
assert(#taken == 1 and button.text == 'Collect all', 'closing the mailbox stops it')
""")

from protocol_schema import check_all  # noqa: E402
check_all(lua)

# --- Mailbox where the server deletes an emptied auction letter ---
# The letters after it slide down one position, so progress kept for "the letter at this position" must not
# carry over, and no letter is taken from unless it is an auction invoice without cash on delivery right now.
def run_mail(extra, check):
    lua = fresh(True, extra)
    lua.execute(COMMON)
    lua.execute("SlashCmdList.EVERLOOT('mail on'); fire('MAIL_SHOW')")
    lua.execute("Everloot.Conveniences.button.scripts.OnClick(); drive()")
    lua.execute(check)
    return lua

lua = run_mail("autoDelete = true", """
assert(table.concat(taken, ',') == 'money5,item4,money1', 'deleted letters: only auction invoices, got ' .. table.concat(taken, ','))
assert(#inbox == 3 and inbox[1].money == 700 and inbox[2].cod == 500 and inbox[2].item and inbox[3].cod == 100 and inbox[3].item,
  'player mail and COD letters untouched')
assert(said('3 skipped') and said('from 3 letters') and said('39s 0c'), table.concat(printed, ' | '))
assert(Everloot.Conveniences.button.text == 'Collect all', 'finished')
local sales = events('auction')
assert(#sales == 2 and sales[1].copper == 855 and sales[2].copper == 2750 and #events() == 2, 'two sales recorded, nothing else')
""")
check_all(lua)

# An item letter that vanishes leaves a player's letter with gold in its place: that gold is not taken.
run_mail("""autoDelete = true
inbox = { { invoice = 'buyer', buyer = 'Jaina', item = true }, { money = 700, sender = 'Jaina' } }""", """
assert(table.concat(taken, ',') == 'item1', 'a slid letter is not taken from, got ' .. table.concat(taken, ','))
assert(#inbox == 1 and inbox[1].money == 700 and said('1 skipped') and said('from 1 letter'), table.concat(printed, ' | '))
""")

# A player's letter with an item takes the place of a vanished gold letter: not taken either.
run_mail("""autoDelete = true
inbox = { { invoice = 'seller', buyer = 'Jaina', money = 500, bid = 500, deposit = 0, cut = 0 }, { item = true, sender = 'Jaina' } }""", """
assert(table.concat(taken, ',') == 'money1', 'got ' .. table.concat(taken, ','))
assert(#inbox == 1 and inbox[1].item and said('1 skipped'), table.concat(printed, ' | '))
""")

# The inbox changing under a run (new mail) is not guessed at: the run stops instead of trusting positions.
lua = fresh(True)
lua.execute(COMMON)
lua.execute("""
inbox = { { invoice = 'seller', buyer = 'Jaina', money = 500, bid = 500, deposit = 0, cut = 0 }, { invoice = 'seller', buyer = 'Jaina', money = 600, bid = 600, deposit = 0, cut = 0 } }
SlashCmdList.EVERLOOT('mail on'); fire('MAIL_SHOW')
Everloot.Conveniences.button.scripts.OnClick()
table.insert(inbox, 1, { money = 40, sender = 'Jaina' })
drive()
assert(table.concat(taken, ',') == 'money2', 'the run stopped, got ' .. table.concat(taken, ','))
assert(said('the inbox changed') and Everloot.Conveniences.button.text == 'Collect all', table.concat(printed, ' | '))
""")

# Safety is judged again on every take: a letter that turns into cash on delivery mid-run is left alone.
run_mail("""local real = AutoLootMailItem
AutoLootMailItem = function(i) real(i); inbox[i].item = true; inbox[i].cod = 100 end
inbox = { { invoice = 'buyer', buyer = 'Jaina', item = true } }""", """
assert(table.concat(taken, ',') == 'item1', 'one take, then the letter is unsafe: ' .. table.concat(taken, ','))
""")
check_all(lua)

# Stop and Collect all again before the old run's pending step fires: that step belongs to the old run and must
# not take a letter while the new run waits for its own gold change (a second take would overwrite the invoice
# the gold module is about to match).
lua = fresh(True, """
inbox = {
  { invoice = 'seller', buyer = 'Jaina', money = 500, bid = 500, deposit = 0, cut = 0 },
  { invoice = 'seller', buyer = 'Jaina', money = 600, bid = 600, deposit = 0, cut = 0 },
  { invoice = 'seller', buyer = 'Jaina', money = 700, bid = 700, deposit = 0, cut = 0 },
}""")
lua.execute(COMMON)
lua.execute("""
SlashCmdList.EVERLOOT('mail on'); fire('MAIL_SHOW')
local button = Everloot.Conveniences.button
button.scripts.OnClick()
assert(table.concat(taken, ',') == 'money3')
flush() -- the gold change arrives: the next step of this run is queued
button.scripts.OnClick() -- Stop
assert(button.text == 'Collect all')
button.scripts.OnClick() -- Collect all again, before the queued step fires
assert(table.concat(taken, ',') == 'money3,money2', 'the new run took the next letter, got ' .. table.concat(taken, ','))
runTimers() -- the old run's step fires now
assert(table.concat(taken, ',') == 'money3,money2', 'a stopped run\\'s step took a letter: ' .. table.concat(taken, ','))
drive()
assert(table.concat(taken, ',') == 'money3,money2,money1', 'got ' .. table.concat(taken, ','))
local amounts = {}
for _, row in ipairs(events('auction')) do amounts[#amounts + 1] = row.copper end
table.sort(amounts)
assert(table.concat(amounts, ',') == '500,600,700', 'every sale reached the ledger, got ' .. table.concat(amounts, ','))
assert(#events() == 3 and button.text == 'Collect all')
""")
check_all(lua)

# Stop and Collect all again while a money take still waits for its gold change. The server settles a letter's
# money once: a repeated take of the same letter pays nothing. Probe a reply-before-gold ordering too: the
# letter can already show no money while that change is on its way; this order is not observed in Forever. Either
# way, a new take before the old change lands is a second call or overwrites the invoice the gold module is
# about to match. The click waits instead; once the change lands, Collect all again finishes the rest.
ONCE = """
inbox = {
  { invoice = 'seller', buyer = 'Jaina', money = 500, bid = 500, deposit = 0, cut = 0 },
  { invoice = 'seller', buyer = 'Jaina', money = 600, bid = 600, deposit = 0, cut = 0 },
  { invoice = 'seller', buyer = 'Jaina', money = 700, bid = 700, deposit = 0, cut = 0 },
}
TakeInboxMoney = function(i)
  taken[#taken + 1] = 'money' .. i
  local m = inbox[i]
  if not m or m.settling or not m.money then return end
  m.settling = true
  local amount = m.money
  if headerFirst then server[#server + 1] = function() m.money = nil end end
  server[#server + 1] = function() m.money = nil; money = money + amount; fire('PLAYER_MONEY') end
end
-- Delivers only the server's next message.
function answer() table.remove(server, 1)() end
"""
for header_first in (False, True):
    lua = fresh(True, ONCE + f"headerFirst = {'true' if header_first else 'false'}")
    lua.execute(COMMON)
    lua.execute("""
SlashCmdList.EVERLOOT('mail on'); fire('MAIL_SHOW')
local button = Everloot.Conveniences.button
button.scripts.OnClick()
if headerFirst then answer() end -- the letter shows no money now
button.scripts.OnClick() -- Stop
button.scripts.OnClick() -- Collect all again, money3's gold change still on its way
assert(table.concat(taken, ',') == 'money3', 'no take before the last one settles, got ' .. table.concat(taken, ','))
assert(button.text == 'Collect all' and said('click Collect all again'), table.concat(printed, ' | '))
drive() -- the change lands; nothing runs on its own
assert(table.concat(taken, ',') == 'money3', 'a stopped collection does not restart, got ' .. table.concat(taken, ','))
button.scripts.OnClick()
drive()
assert(table.concat(taken, ',') == 'money3,money2,money1', 'got ' .. table.concat(taken, ','))
local amounts = {}
for _, row in ipairs(events('auction')) do amounts[#amounts + 1] = row.copper end
table.sort(amounts)
assert(table.concat(amounts, ',') == '500,600,700', 'every sale reached the ledger, got ' .. table.concat(amounts, ','))
assert(#events() == 3 and button.text == 'Collect all')
""")
    check_all(lua)

# A gold change that never comes: the wait ends after its timeout, and the old take's timer does not act for the
# collection started after it.
lua = fresh(True, ONCE + "headerFirst = true")
lua.execute(COMMON)
lua.execute("""
SlashCmdList.EVERLOOT('mail on'); fire('MAIL_SHOW')
local button = Everloot.Conveniences.button
button.scripts.OnClick()
answer()
button.scripts.OnClick() -- Stop
server = {} -- money3's gold change is lost
runTimers() -- the wait times out
assert(table.concat(taken, ',') == 'money3', 'got ' .. table.concat(taken, ','))
button.scripts.OnClick()
assert(table.concat(taken, ',') == 'money3,money2', 'a new collection after the timeout, got ' .. table.concat(taken, ','))
runTimers() -- includes the new take's timeout; no old step may take money1 while that timer only queues its next step
assert(table.concat(taken, ',') == 'money3,money2', 'got ' .. table.concat(taken, ','))
drive()
assert(table.concat(taken, ',') == 'money3,money2,money1', 'got ' .. table.concat(taken, ','))
""")
check_all(lua)

# The mailbox closes, or the option goes off, while a money take waits: no take follows its gold change, and a
# click before that change lands still waits. Closing the mailbox also ends the gold module's wait for that
# letter's change, so only the option going off leaves that sale recorded.
for stop, recorded in (("fire('MAIL_CLOSED'); fire('MAIL_SHOW')", 0), ("SlashCmdList.EVERLOOT('mail off')", 1)):
    lua = fresh(True, ONCE + "headerFirst = true")
    lua.execute(COMMON)
    lua.execute("""
SlashCmdList.EVERLOOT('mail on'); fire('MAIL_SHOW')
local button = Everloot.Conveniences.button
button.scripts.OnClick()
answer()
""" + stop + """
button.scripts.OnClick()
assert(table.concat(taken, ',') == 'money3', 'got ' .. table.concat(taken, ','))
drive()
assert(table.concat(taken, ',') == 'money3', 'got ' .. table.concat(taken, ','))
assert(#events('auction') == RECORDED and #events() == RECORDED, 'got ' .. #events())
SlashCmdList.EVERLOOT('mail on')
button.scripts.OnClick()
drive()
assert(table.concat(taken, ',') == 'money3,money2,money1', 'got ' .. table.concat(taken, ','))
assert(#events('auction') == RECORDED + 2)
""".replace("RECORDED", str(recorded)))
    check_all(lua)

# Switching the option off during a run stops the run before its next take (the options only say "reload",
# but /everloot mail off confirms "off" at once, so a queued take must not follow).
lua = fresh(True, """
inbox = { { invoice = 'buyer', buyer = 'Jaina', item = true }, { invoice = 'buyer', buyer = 'Jaina', item = true }, { invoice = 'buyer', buyer = 'Jaina', item = true } }""")
lua.execute(COMMON)
lua.execute("""
SlashCmdList.EVERLOOT('mail on'); fire('MAIL_SHOW')
local button = Everloot.Conveniences.button
button.scripts.OnClick()
assert(table.concat(taken, ',') == 'item3')
SlashCmdList.EVERLOOT('mail off')
drive()
assert(table.concat(taken, ',') == 'item3', 'no take after mail off, got ' .. table.concat(taken, ','))
assert(button.text == 'Collect all', 'the run ended')
assert(said('from 1 letter') and said('stopped: switched off'), table.concat(printed, ' | '))
""")

# Off while a money take waits for its gold change: that take is already made and stays recorded; no further take follows.
lua = fresh(True, """
inbox = {
  { invoice = 'seller', buyer = 'Jaina', money = 500, bid = 500, deposit = 0, cut = 0 },
  { invoice = 'seller', buyer = 'Jaina', money = 600, bid = 600, deposit = 0, cut = 0 },
}""")
lua.execute(COMMON)
lua.execute("""
SlashCmdList.EVERLOOT('mail on'); fire('MAIL_SHOW')
local button = Everloot.Conveniences.button
button.scripts.OnClick()
assert(table.concat(taken, ',') == 'money2')
SlashCmdList.EVERLOOT('mail off')
drive()
assert(table.concat(taken, ',') == 'money2', 'no take after mail off, got ' .. table.concat(taken, ','))
local sales = events('auction')
assert(#sales == 1 and sales[1].copper == 600 and #events() == 1, 'the take already made is recorded')
assert(button.text == 'Collect all' and said('stopped: switched off'), table.concat(printed, ' | '))
""")
check_all(lua)

# The source never takes the guild bank's side, never writes a record, never reads a letter's text or sender.
code = "\n".join(line.split("--")[0] for line in (root / "modules" / "conveniences.lua").read_text(encoding="utf-8").splitlines())
for pattern in [r"RepairAllItems\(\s*(true|1)\b", r"E:Store|\.records", r"GetInboxText", r"GuildBank|guildBank", r"TakeInboxItem"]:
    assert not re.search(pattern, code), f"conveniences.lua has {pattern}"
print("Lua 5.1 conveniences: both off by default; greys only sold; own-gold repair after the sales are recorded; "
      "mail takes auction invoices only, skips COD, one take at a time, stops on full bags; gold ledger and privacy intact")
