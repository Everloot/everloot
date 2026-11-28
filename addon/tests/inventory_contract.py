"""Local inventory snapshots: python addon/tests/inventory_contract.py (lupa)."""
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
lua = LuaRuntime()
lua.execute('''
NOW = 1000
time = function() return NOW end
date = os.date
print = function() end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
UnitGUID = function() return GUID end
GUID = 'Player-1-AAAA'
UnitClass = function() return 'Mage', 'MAGE' end
UnitLevel = function() return 60 end
UnitName = function() return 'SameName' end
GetRealmName = function() return 'Realm' end
NUM_BAG_SLOTS = 4
NUM_BANKBAGSLOTS = 7
slots = { [0]=2, [-1]=2 }
contents = { [0] = { {itemID=2589, stackCount=3}, {itemID=2589, stackCount=4} }, [-1] = {{itemID=2592,stackCount=5}} }
reads = 0
C_Container = {
 GetContainerNumSlots = function(b) reads=reads+1; return slots[b] or 0 end,
 GetContainerItemInfo = function(b,s) return (contents[b] or {})[s] end
}
GetInboxNumItems = function() return MAIL_COUNT or 1, MAIL_TOTAL or 1 end
GetInboxHeaderInfo = function() if MISSING_HEADER then return end; return nil,nil,'Sender','Subject',0,0,1,1 end
GetInboxItemLink = function(m,a) if a==1 and not MISSING_LINK then return 'item:2589' end end
GetInboxItem = function(m,a) if a==1 then return 'Cloth',2589,123,2 end end
''')
for file in ['core.lua', 'modules/roster.lua']:
    lua.execute((root / file).read_text())
source = root / 'modules/inventory.lua'
# Before the module exists, the behavior assertion below fails rather than an import.
if source.exists():
    lua.execute(source.read_text())
lua.execute((root / 'modules/options.lua').read_text())
lua.execute(r'''
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
function event(name, ...)
 for _,hook in ipairs(Everloot.frame.hooks or {}) do hook(nil,name,...) end
end
local I = Everloot.Inventory
assert(I, 'inventory snapshot module is available')
assert(I.BagCheckCode('bags') == nil and reads == 0, 'copy flow requires inventory consent before reading')
event('PLAYER_ENTERING_WORLD'); event('BANKFRAME_OPENED'); event('MAIL_SHOW')
assert(EverlootDB.inventory == nil and reads == 0, 'default-off consent reads and stores nothing')
local option
for _,r in ipairs(Everloot.Options.ROWS) do if r.key=='inventoryCapture' then option=r end end
assert(option and not Everloot.Options.IsOn(option), 'explicit capture setting is off')
Everloot.Options.Set(option,true)
assert(Everloot.Options.IsOn(option))
event('PLAYER_ENTERING_WORLD')
local key = Everloot.CharacterKey()
local row = EverlootDB.inventory[key]
assert(row.bags.items[2589]==7 and row.bags.observedAt==NOW and row.bags.complete==true, 'bag stacks sum')
assert(I.BagCheckCode('bags') == 'EVERLOOT-INVENTORY-1\n2589 7', 'a bag export contains only item ids and counts')
assert(I.BagCheckCode('bank') == nil, 'copy flow requires the bank to be open')
assert(row.bank==nil and row.mail==nil, 'unopened locations unknown')
event('BANKFRAME_OPENED'); event('MAIL_SHOW')
assert(row.bank.items[2592]==5 and row.mail.items[2589]==2, 'open bank and mail captured')
assert(I.BagCheckCode('bank') == 'EVERLOOT-INVENTORY-1\n2592 5', 'bank code excludes bags and mail')
event('BANKFRAME_CLOSED'); event('MAIL_CLOSED')
NOW=1001; MISSING_LINK=true; event('MAIL_SHOW')
assert(row.mail.items[2589]==2 and row.mail.observedAt==1000, 'uncached attachments preserve complete mail snapshot')
MISSING_HEADER=true; event('MAIL_INBOX_UPDATE')
assert(row.mail.items[2589]==2 and row.mail.observedAt==1000, 'missing mail header preserves complete snapshot')
MISSING_HEADER=false; MISSING_LINK=false; event('MAIL_CLOSED')
NOW=1100; contents[0]={}; event('BAG_UPDATE_DELAYED')
assert(next(row.bags.items)==nil and row.bags.observedAt==1100, 'complete empty snapshot replaces previous stock')
assert(row.bank.observedAt==1000 and row.mail.observedAt==1000, 'separate observation times')
event('BANKFRAME_CLOSED'); event('MAIL_CLOSED')
contents[-1]={}; MAIL_COUNT=0; MAIL_TOTAL=0
NOW=1200; event('BAG_UPDATE_DELAYED'); event('MAIL_INBOX_UPDATE')
assert(row.bank.items[2592]==5 and row.mail.items[2589]==2, 'closed locations retain dated data')
event('BANKFRAME_OPENED'); event('MAIL_SHOW')
assert(next(row.bank.items)==nil and next(row.mail.items)==nil, 'observed empty bank and mail clear stock')
event('BANKFRAME_CLOSED')
-- Partial inboxes, unreadable slots and API failures cannot erase a complete observation.
contents[0]={{itemID=2589, stackCount=8}}; event('BAG_UPDATE_DELAYED')
NOW=1300; contents[0]={{itemID=2589,stackCount='unreadable'}}; event('BAG_UPDATE_DELAYED')
assert(row.bags.items[2589]==8 and row.bags.observedAt==1200, 'unreadable item leaves previous snapshot')
MAIL_COUNT=1; MAIL_TOTAL=2; event('MAIL_INBOX_UPDATE')
assert(row.mail.observedAt==1200, 'partial mail never replaces complete mail')
slots[-1]=0; event('BANKFRAME_OPENED')
assert(row.bank.observedAt==1200, 'unavailable bank is unknown, not empty')
local secretSlot={}
contents[0]={secretSlot}; issecretvalue=function(v) return v==secretSlot end
event('BAG_UPDATE_DELAYED')
assert(row.bags.observedAt==1200, 'secret item info is unavailable, never empty')
issecretvalue=nil
C_Container.GetContainerNumSlots=function() error('unavailable') end
event('BAG_UPDATE_DELAYED')
assert(row.bags.observedAt==1200, 'API errors preserve snapshot')
C_Container.GetContainerNumSlots=function(b) return slots[b] or 0 end
slots[0]=0; contents[0]={}; event('BAG_UPDATE_DELAYED')
assert(row.bags.items[2589]==8 and row.bags.observedAt==1200, 'unavailable backpack never becomes empty')
slots[0]=10000; event('BAG_UPDATE_DELAYED')
assert(row.bags.observedAt==1200, 'slot cap never stores a partial snapshot')
slots[0]=1; contents[0]={{itemID=2589,stackCount=2147483648}}; event('BAG_UPDATE_DELAYED')
assert(row.bags.observedAt==1200, 'item count cap preserves previous data')
MAIL_COUNT=101; MAIL_TOTAL=101; event('MAIL_INBOX_UPDATE')
assert(row.mail.observedAt==1200, 'mail cap preserves previous data')
-- New identity resets accessibility even without an explicit close event.
GUID='Player-2-BBBB'; contents[0]={{itemID=2592,stackCount=1}}; event('PLAYER_ENTERING_WORLD')
local second=Everloot.CharacterKey()
assert(second~=key and EverlootDB.inventory[second].bags.items[2592]==1, 'same display name has distinct identity')
assert(EverlootDB.inventory[second].bank==nil and EverlootDB.inventory[second].mail==nil, 'login never assumes bank/mail open')
Everloot.Roster.Forget(key)
assert(EverlootDB.inventory[key]==nil and EverlootDB.inventory[second], 'forget deletes only that character inventory')
-- Character storage is bounded; no partial or unbounded new character entries.
for i=1,101 do GUID='Player-3-'..i; event('PLAYER_ENTERING_WORLD') end
local n=0; for _ in pairs(EverlootDB.inventory) do n=n+1 end
assert(n<=50, 'character cap')
Everloot.Options.Set(option,false)
assert(EverlootDB.inventory==nil, 'withdrawing consent deletes local inventory')
event('BAG_UPDATE_DELAYED'); event('BANKFRAME_OPENED'); event('MAIL_SHOW')
assert(EverlootDB.inventory==nil, 'off never recaptures')
assert(next(EverlootDB.records)==nil, 'inventory never enters public records')
''')

# Task 6: Inventory.CurrentBags() is an ephemeral read of this character's bags for recipe-plan shortfalls. It needs no
# capture consent because it saves nothing, never turns capture on, and never counts the bank, mail or other characters.
lua.execute('''
local I = Everloot.Inventory
assert(type(I.CurrentBags) == 'function', 'Inventory.CurrentBags exists')
assert(EverlootDB.inventoryCapture ~= true and EverlootDB.inventory == nil, 'consent is off')
C_Container.GetContainerNumSlots = function(b) return slots[b] or 0 end
slots = { [0]=2, [1]=1, [-1]=2 }
contents = { [0] = { {itemID=2589, stackCount=3}, {itemID=2589, stackCount=4} }, [1] = { {itemID=2592, stackCount=1} },
  [-1] = {{itemID=2592,stackCount=5}} }
event('BANKFRAME_OPENED'); event('MAIL_SHOW')
local counts, why = I.CurrentBags()
assert(counts and why == nil and counts[2589]==7 and counts[2592]==1, 'bag stacks summed; the open bank and mail are not counted')
assert(EverlootDB.inventory == nil and EverlootDB.inventoryCapture ~= true, 'an ephemeral read saves nothing and enables nothing')
counts[2589] = 99
assert(I.CurrentBags()[2589] == 7, 'each read is a fresh table')
event('BANKFRAME_CLOSED'); event('MAIL_CLOSED')
contents[0] = { {itemID=2589, stackCount='unreadable'} }
local none, reason = I.CurrentBags()
assert(none == nil and reason == 'bags unreadable', tostring(reason))
local secretSlot = {}
contents[0] = { secretSlot }; issecretvalue = function(v) return v == secretSlot end
none, reason = I.CurrentBags()
assert(none == nil and reason == 'bags unreadable', 'a secret slot is unreadable, never empty')
issecretvalue = nil
contents[0] = {}
local saved = C_Container
C_Container = nil
none, reason = I.CurrentBags()
assert(none == nil and reason == 'no bag API', tostring(reason))
C_Container = saved
counts = I.CurrentBags()
assert(counts and counts[2592] == 1 and counts[2589] == nil, 'an empty backpack slot list is empty, not unknown')
assert(EverlootDB.inventory == nil, 'still nothing saved')
''')
print('inventory contract: PASS')
