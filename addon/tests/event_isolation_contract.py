"""Run with: uv run --with lupa --with jsonschema python addon/tests/event_isolation_contract.py

The modules share one event frame, and the game runs its handlers as one chain: an error in one ends the dispatch,
so every handler after it misses the event. The open-world module loads first, so its loot window handler must not
let an error reach the gold and gold per hour modules. Its spell cast events are for the player only, so they
are registered for that unit on a frame of their own and do not pass through every module's handler.
"""
from lupa.lua51 import LuaRuntime
from window_world import WORLD, root

lua = LuaRuntime()
lua.execute(WORLD)
lua.execute("""
GetRealmName = function() return 'Forever' end
GOLD_AMOUNT = nil
local calls = 0
-- The loot window API fails the first time it is read, which is the open-world module's read; gold reads it next.
GetNumLootItems = function() calls = calls + 1; if calls == 1 then error('boom') end; return 1 end
GetLootSlotType = function() return 2 end
GetLootSlotInfo = function() return 'coin', '50 Copper', 50 end
GetLootSlotLink = function() return nil end
GetLootSourceInfo = function() return 'Creature-0-1-2-3-299-0000000001', 50 end
""")
for file in ["core.lua", "modules/openworld.lua", "modules/auctions.lua", "modules/gold.lua", "modules/prices.lua", "modules/gph.lua"]:
    lua.execute((root / file).read_text(encoding="utf-8"))
lua.execute("""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
SlashCmdList.EVERLOOT('gph start')
assert(#Everloot.frame.hooks >= 3, 'openworld, gold and gph hook the one frame')
local before = EverlootDB.gph.current.money.loot or 0
fire('LOOT_OPENED')
money = money + 77
fire('PLAYER_MONEY')
assert((EverlootDB.gph.current.money.loot or 0) - before == 77, 'gph saw LOOT_OPENED after the open-world module failed')
assert(Everloot:Count('money_event') > 0, 'gold saw LOOT_OPENED after the open-world module failed')
assert(#fireErrors == 0, 'the error stayed inside the open-world module: ' .. tostring(fireErrors[1]))
-- The module tells the player once and /everloot status says why.
local n = 0
for _, p in ipairs(printed) do if p:find('openworld hit an error', 1, true) then n = n + 1 end end
assert(n == 1, 'one line in chat, got ' .. n)
fire('LOOT_OPENED')
n = 0
for _, p in ipairs(printed) do if p:find('openworld hit an error', 1, true) then n = n + 1 end end
assert(n == 1, 'a second error says nothing more, got ' .. n)
assert(Everloot:Status():find('openworld: error', 1, true), 'status says which module failed')

-- Spell casts: the player's own, on a frame that is not the shared one.
local spell
for _, f in ipairs(created) do
  if f ~= Everloot.frame and f.unitEvents.UNIT_SPELLCAST_SENT then spell = f end
end
assert(spell, 'a frame of its own holds the spell cast events')
for _, e in ipairs({ 'UNIT_SPELLCAST_SENT', 'UNIT_SPELLCAST_FAILED', 'UNIT_SPELLCAST_FAILED_QUIET', 'UNIT_SPELLCAST_SUCCEEDED', 'UNIT_SPELLCAST_INTERRUPTED' }) do
  assert(spell.unitEvents[e] == 'player', e .. ' is registered for the player only')
  assert(not Everloot.frame.events[e], e .. ' is not on the shared frame')
end
assert(spell.onEvent, 'the spell frame has a handler')
""")
print("Event isolation contract: PASS")
