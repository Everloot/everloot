"""Bounded modern auction fallback; run with uv run --with lupa --with jsonschema python addon/tests/auction_fallback_contract.py."""
from pathlib import Path
from lupa.lua51 import LuaRuntime

ROOT = Path(__file__).parents[1]


def runtime(replicate="nil"):
    lua = LuaRuntime()
    lua.execute('''
now=1000000; clock=0; timers={}; calls={}; printed={}
time=function() return now+clock end
GetTime=function() return clock end
date=function() return '2026-10-31T00:00:00Z' end
print=function(s) printed[#printed+1]=s end
SlashCmdList={}; GetRealmName=function() return 'Forever' end
CreateFrame=function() return {
 RegisterEvent=function() end, SetScript=function(self,_,f) self.onEvent=f end,
 HookScript=function(self,_,f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
C_Timer={After=function(delay,f) timers[#timers+1]={at=clock+delay,f=f} end}
function tick(seconds)
 local ending=clock+seconds
 while true do
  local index,at=nil,ending+1
  for i,t in ipairs(timers) do if t.at<at then index,at=i,t.at end end
  if not index or at>ending then break end
  clock=at; table.remove(timers,index).f()
 end
 clock=ending
end
function fire(event,arg) for _,f in ipairs(Everloot.frame.hooks or {}) do f(nil,event,arg) end end
function call(name) calls[#calls+1]={name=name,at=clock} end
function countCalls(name) local n=0; for _,c in ipairs(calls) do if c.name==name then n=n+1 end end; return n end
key={itemID=2589,itemLevel=0,itemSuffix=0,battlePetSpeciesID=0}
other={itemID=765,itemLevel=0,itemSuffix=0,battlePetSpeciesID=0}
browse={{itemKey=key,minPrice=1,totalQuantity=999999},{itemKey=other}}
itemRows={{itemKey=key,auctionID=1,quantity=20,buyoutAmount=2000},
 {itemKey=key,auctionID=2,quantity=10,buyoutAmount=1500}}
commodityRows={{itemID=765,auctionID=3,quantity=3,unitPrice=33}}
ready=true; browseFull=true; itemFull=true; commodityFull=true
C_AuctionHouse={
 IsThrottledMessageSystemReady=function() return ready end,
 SendBrowseQuery=function(q) assert(q.searchString==''); call('browse') end,
 GetBrowseResults=function() return browse end,
 HasFullBrowseResults=function() return browseFull end,
 RequestMoreBrowseResults=function() call('moreBrowse') end,
 GetItemKeyInfo=function(k) return {isCommodity=k.itemID==765} end,
 SendSearchQuery=function(k,sorts,separate) assert(separate==false); call('search'..k.itemID) end,
 HasFullItemSearchResults=function() return itemFull end,
 RequestMoreItemSearchResults=function() call('moreItem') end,
 GetNumItemSearchResults=function() return #itemRows end,
 GetItemSearchResultInfo=function(_,i) return itemRows[i] end,
 HasFullCommoditySearchResults=function() return commodityFull end,
 RequestMoreCommoditySearchResults=function() call('moreCommodity') end,
 GetNumCommoditySearchResults=function() return #commodityRows end,
 GetCommoditySearchResultInfo=function(_,i) return commodityRows[i] end,
 GetNumReplicateItems=function() error('late replicate must not read') end,
}
for _,name in ipairs({'PlaceBid','PostItem','PostCommodity','StartCommoditiesPurchase','ConfirmCommoditiesPurchase','CancelAuction'}) do
 C_AuctionHouse[name]=function() error('trade mutation '..name) end
end
''')
    lua.execute("C_AuctionHouse.ReplicateItems=" + replicate)
    for file in ["core.lua", "modules/auctions.lua"]:
        lua.execute((ROOT / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot'); fire('AUCTION_HOUSE_SHOW')")
    return lua


lua = runtime()
lua.execute('''
assert(countCalls('browse')==0,'opening the house never queries')
Everloot:StartScan(); tick(1)
assert(countCalls('browse')==1,'missing ReplicateItems starts the clicked fallback')
fire('AUCTION_HOUSE_BROWSE_RESULTS_UPDATED'); tick(1)
assert(countCalls('search2589')==1,'browse keys select a search, not browse prices')
fire('ITEM_SEARCH_RESULTS_UPDATED',other)
assert(not EverlootDB.records.auction_scan,'mismatched events ignored')
fire('ITEM_SEARCH_RESULTS_UPDATED',key); tick(1)
fire('COMMODITY_SEARCH_RESULTS_UPDATED',765); tick(1)
assert(not Everloot:Scanning())
local rows=EverlootDB.records.auction_scan
assert(#rows==3 and rows[1].copper==100 and rows[1].count==20)
assert(rows[2].copper==150 and rows[2].count==10)
assert(rows[3].copper==33 and rows[3].count==3)
assert(not EverlootDB.records.auction_snapshot,'partial observations never claim full snapshot')
assert(not EverlootDB.lastScans,'partial observations never replace the own full scan')
assert(EverlootDB.lastScanAt==now,'usable observations consume cooldown')
for i=2,#calls do assert(calls[i].at-calls[i-1].at>=1,'requests paced') end
''')
from protocol_schema import check_all
check_all(lua)

for replicate in ["function() call('replicate') end", "function() error('unsupported') end"]:
    lua=runtime(replicate)
    lua.execute('''
Everloot:StartScan(); tick(C_AuctionHouse.ReplicateItems and countCalls('replicate')==1 and 31 or 1)
assert(countCalls('browse')==1,'timeout or throw falls back')
fire('REPLICATE_ITEM_LIST_UPDATE')
assert(Everloot:Scanning(),'late replicate does not replace fallback')
fire('AUCTION_HOUSE_CLOSED'); tick(100)
assert(not Everloot:Scanning() and EverlootDB.lastScanAt==nil,'close refunds unused attempt')
''')

lua=runtime()
lua.execute('''
ready=false; Everloot:StartScan(); tick(3); assert(#calls==0,'throttle blocks requests')
ready=true; tick(1); browseFull=false
fire('AUCTION_HOUSE_BROWSE_RESULTS_UPDATED'); tick(1)
assert(countCalls('moreBrowse')==1)
browseFull=true; fire('AUCTION_HOUSE_BROWSE_RESULTS_ADDED'); tick(1)
itemFull=false; fire('ITEM_SEARCH_RESULTS_UPDATED',key); tick(1)
assert(countCalls('moreItem')==1)
itemFull=true; fire('ITEM_SEARCH_RESULTS_ADDED',key); tick(1)
commodityFull=false; fire('COMMODITY_SEARCH_RESULTS_UPDATED',765); tick(1)
assert(countCalls('moreCommodity')==1)
commodityFull=true; fire('COMMODITY_SEARCH_RESULTS_ADDED',765); tick(1)
assert(#EverlootDB.records.auction_scan==3,'cumulative result pages not duplicated')
''')

lua=runtime()
lua.execute('''
C_AuctionHouse.GetItemSearchResultInfo=function() error('bad row') end
Everloot:StartScan(); tick(1); fire('AUCTION_HOUSE_BROWSE_RESULTS_UPDATED'); tick(1)
fire('ITEM_SEARCH_RESULTS_UPDATED',key); tick(1)
fire('COMMODITY_SEARCH_RESULTS_UPDATED',765); tick(1)
assert(not Everloot:Scanning() and #EverlootDB.records.auction_scan==1,'one item failure does not stop others')
''')

lua=runtime()
lua.execute('''
Everloot:StartScan(); tick(1)
EverlootDB.toggles.auctions=false; tick(1); tick(100)
fire('AUCTION_HOUSE_BROWSE_RESULTS_UPDATED')
assert(not Everloot:Scanning() and EverlootDB.lastScanAt==nil and #calls==1,'off stops queued work')
EverlootDB.toggles.auctions=true; Everloot:StartScan(); tick(1)
assert(countCalls('browse')==2,'cancelled timer cannot cancel next scan')
ready=false; tick(100)
assert(not Everloot:Scanning() and EverlootDB.lastScanAt==nil,'absolute deadline refunds no results')
''')
lua=runtime()
lua.execute("""
-- Secret values are treated as missing before comparison, arithmetic or serialization.
secret={}; issecretvalue=function(value) return value==secret end
itemRows[1].quantity=secret; itemRows[2].buyoutAmount=secret
commodityRows[2]={itemID=765,auctionID=3,quantity=3,unitPrice=33}
Everloot:StartScan(); tick(1); fire('AUCTION_HOUSE_BROWSE_RESULTS_UPDATED'); tick(1)
fire('ITEM_SEARCH_RESULTS_UPDATED',{itemID=2589,itemLevel=0,itemSuffix=1,battlePetSpeciesID=0})
assert(not EverlootDB.records.auction_scan,'full key identity must match')
fire('ITEM_SEARCH_RESULTS_UPDATED',key); tick(1)
fire('COMMODITY_SEARCH_RESULTS_UPDATED',765); tick(1)
assert(#EverlootDB.records.auction_scan==1,'secret rows skipped; repeated auction ID is not counted twice')
""")

lua=runtime()
lua.execute("""
browse={}
for i=1,50 do browse[i]={itemKey={itemID=i,itemLevel=0,itemSuffix=0,battlePetSpeciesID=0}} end
browseFull=false; itemFull=false
Everloot:StartScan(); tick(1); fire('AUCTION_HOUSE_BROWSE_RESULTS_UPDATED')
for i=1,100 do
 tick(1)
 local c=calls[#calls]
 if c.name=='moreItem' or c.name:match('^search') then
  local itemID=tonumber(c.name:match('^search(%d+)'))
  if itemID then activeKey={itemID=itemID,itemLevel=0,itemSuffix=0,battlePetSpeciesID=0} end
  fire('ITEM_SEARCH_RESULTS_UPDATED',activeKey)
 end
end
assert(not Everloot:Scanning() and #calls<=40,'request cap ends fallback')
assert(countCalls('moreBrowse')==0,'twenty keys never query all browse pages')
assert(countCalls('search21')==0,'key cap')
assert(not EverlootDB.records.auction_snapshot)
""")

lua=runtime()
lua.execute("""
Everloot:StartScan(); tick(1); fire('AUCTION_HOUSE_BROWSE_RESULTS_UPDATED'); tick(1)
itemFull=false
C_AuctionHouse.RequestMoreItemSearchResults=function() call('moreItem'); itemFull=true; return true end
fire('ITEM_SEARCH_RESULTS_UPDATED',key); tick(1)
assert(#EverlootDB.records.auction_scan==2,'already complete pagination return does not need an event')
""")

lua=runtime("function() call('replicate') end")
lua.execute("""
C_AuctionHouse.GetNumReplicateItems=function() return 0 end
Everloot:StartScan(); fire('REPLICATE_ITEM_LIST_UPDATE')
assert(not Everloot:Scanning() and EverlootDB.lastScanAt==nil,'no usable replicate results refund too')
""")

lua=runtime("function() call('replicate') end")
lua.execute("""
Everloot:StartScan(); fire('REPLICATE_ITEM_LIST_UPDATE'); tick(1)
assert(countCalls('browse')==1,'replicate result API error falls back safely')
""")

print('Lua 5.1 auction fallback: explicit click, actual partial rows, bounded pages/throttle, timeout, cancellation, no trading')
