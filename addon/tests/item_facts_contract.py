"""Run with: uv run --with lupa --with jsonschema python addon/tests/item_facts_contract.py

Item facts: the numbers an item's tooltip shows that the game files do not hold. When the player's own tooltip
shows an item, the addon reads GetItemStats on the plain item from GetItemInfo and stores one `item_fact` row per
known stat key, with the client build. The tooltip API, GetItemStats and its keys follow Blizzard's documentation
and were not checked on the Forever client, so a missing call, a missing key or a value of the wrong type must
record nothing rather than error. Every row is checked against the protocol's JSON Schema.
"""
import re
from pathlib import Path

from lupa.lua51 import LuaRuntime

from protocol_schema import check_all

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
assert "modules\\itemfacts.lua" in toc, "the item facts module must be in the TOC"
version = re.search(r"^## Version: (\d+\.\d+\.\d+)\s*$", toc, re.M)
assert version, "the release has a numeric addon version"
assert f'E.VERSION = "{version.group(1)}"' in (root / "core.lua").read_text(encoding="utf-8"), "core and TOC versions agree"

STUBS = """
date = function() return '2026-11-04T18:00:00Z' end
time = function() return 123456 end
printed = {}
print = function(text) table.insert(printed, tostring(text)) end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function() end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function() end
} end
BUILD = { '1.60.1', '70450', 'Oct 1 2026', 16001 }
GetBuildInfo = function() return unpack(BUILD) end
Enum = { TooltipDataType = { Item = 0, Unit = 2 } }
postCalls = {}
TooltipDataProcessor = { AddTooltipPostCall = function(kind, f) table.insert(postCalls, { kind = kind, f = f }) end }
-- Items in the client's cache: a link for each; stats by link. 6070 is cached but has no numbers (a potion).
links = { [2075] = 'item:2075', [15055] = 'item:15055', [6070] = 'item:6070', [9001] = 'item:9001' }
stats = {
 ['item:2075'] = { ITEM_MOD_STAMINA_SHORT = 5, ITEM_MOD_SPIRIT_SHORT = -2, RESISTANCE0_NAME = 103, ITEM_MOD_MADE_UP_SHORT = 9 },
 ['item:15055'] = { ITEM_MOD_DAMAGE_PER_SECOND_SHORT = 12.4285, RESISTANCE2_NAME = 10, ITEM_MOD_STRENGTH_SHORT = 3 },
 ['item:9001'] = { ITEM_MOD_AGILITY_SHORT = 'seven', ITEM_MOD_INTELLECT_SHORT = 2.5, ITEM_MOD_STAMINA_SHORT = 0,
   RESISTANCE0_NAME = 20000, ITEM_MOD_SPIRIT_SHORT = 0/0 },
}
calls = 0
GetItemInfo = function(id) local link = links[id]; if link then return 'Item ' .. id, link end end
GetItemStats = function(link) calls = calls + 1; return stats[link] end
"""


def fresh(extra=""):
    lua = LuaRuntime()
    lua.execute(STUBS + extra)
    for file in ["core.lua", "modules/itemfacts.lua"]:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("""
Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')
function hover(data) for _, call in ipairs(postCalls) do if call.kind == Enum.TooltipDataType.Item then call.f({}, data) end end end
function facts() return EverlootDB.records.item_fact or {} end
function factsOf(id)
  local out = {}
  for _, row in ipairs(facts()) do if row.itemId == id then out[row.fact] = row.value end end
  return out
end
""")
    return lua


# --- A fact that is there: one row per known key, the plain item's numbers, the client build ---
lua = fresh()
lua.execute("""
assert(#postCalls == 1 and postCalls[1].kind == Enum.TooltipDataType.Item, 'one post-call on item tooltips')
assert(Everloot:Status():find('itemfacts: ready', 1, true), Everloot:Status())
assert(Everloot:Status():find('rows item_fact: 0', 1, true), 'status lists the kind')
hover({ id = 2075, guid = 'Item-0-0-0000000000000001' })
local got = factsOf(2075)
assert(got.stamina == 5 and got.spirit == -2 and got.armor == 103, 'armor and stats, a negative stat kept')
assert(#facts() == 3, 'an unknown key records nothing: ' .. #facts())
for _, row in ipairs(facts()) do
  assert(row.clientBuild == '1.60.1.70450' and row.capturedAt == '2026-11-04T18:00:00Z', 'the build and the time')
  assert(row.installId == EverlootDB.installId and row.eventId and row.kindLoggedAt, 'stored through E:Store')
  for key in pairs(row) do
    assert(({ installId=1, capturedAt=1, itemId=1, fact=1, value=1, clientBuild=1, eventId=1, kindLoggedAt=1 })[key], 'nothing else: ' .. key)
  end
end
hover({ id = 15055 })
got = factsOf(15055)
assert(got.damage_per_second == 12.4 and got.fire_resistance == 10 and got.strength == 3, 'dps to one decimal, a resistance')
assert(Everloot:Status():find('rows item_fact: 6', 1, true), 'status counts the rows')
""")
assert check_all(lua) == {"item_fact": 6}

# --- A fact that is not there: no numbers, not cached, bad values, no stats call, no tooltip API ---
lua = fresh()
lua.execute("""
hover({ id = 6070 })
assert(#facts() == 0, 'an item with no numbers records nothing')
local before = calls
hover({ id = 6070 })
assert(calls == before, 'and is read once per session, not on every tooltip')
assert(EverlootDB.itemFactSeen == nil or EverlootDB.itemFactSeen[6070] == nil, 'and is not kept in the file')
hover({ id = 4242 })
assert(#facts() == 0, 'an item not in the cache records nothing')
links[4242] = 'item:4242'; stats['item:4242'] = { ITEM_MOD_STAMINA_SHORT = 8 }
hover({ id = 4242 })
assert(factsOf(4242).stamina == 8, 'and is read once the cache has it')
hover({ id = 9001 })
local odd = factsOf(9001)
assert(next(odd) == nil, 'text, a fraction on a whole-number line, zero, out of range and NaN record nothing')
for _, data in ipairs({ {}, { id = 'x' }, { id = 0 }, { id = -5 }, { id = 1.5 } }) do hover(data) end
hover(nil)
assert(#facts() == 1, 'tooltip data without a real item id records nothing')
""")
assert check_all(lua) == {"item_fact": 1}

lua = fresh("GetItemStats = nil")
lua.execute("assert(Everloot:Status():find('itemfacts: disabled: GetItemStats unavailable', 1, true), Everloot:Status())")
lua = fresh("TooltipDataProcessor = nil")
lua.execute("assert(Everloot:Status():find('itemfacts: disabled: tooltip API unavailable', 1, true), Everloot:Status())")
lua = fresh("GetBuildInfo = nil")
lua.execute("""
assert(Everloot:Status():find('itemfacts: off (this client gives no build)', 1, true), Everloot:Status())
assert(#postCalls == 0, 'no hook without a build')
""")
lua = fresh("C_Item = { GetItemStats = function(link) return { ITEM_MOD_AGILITY_SHORT = 4 } end }; GetItemStats = nil")
lua.execute("hover({ id = 2075 }); assert(factsOf(2075).agility == 4, 'C_Item.GetItemStats where the client has it')")
lua = fresh("GetItemStats = function() error('boom') end")
lua.execute("hover({ id = 2075 }); assert(#facts() == 0, 'a failing call records nothing and does not error')")
lua = fresh("GetItemInfo = function() error('boom') end")
lua.execute("hover({ id = 2075 }); assert(#facts() == 0, 'a failing GetItemInfo records nothing')")

# --- A repeat: once per item and build; a new build records again ---
lua = fresh()
lua.execute("""
hover({ id = 2075 }); hover({ id = 2075 }); hover({ id = 2075, guid = 'Item-0-0-0000000000000002' })
assert(#facts() == 3, 'a repeat in the session adds nothing')
assert(EverlootDB.itemFactSeen[2075] == '1.60.1.70450', 'the item is kept with its build')
""")


def reload(lua, extra=""):
    """A /reload: the Lua state is new, EverlootDB is what the file kept."""
    lua.execute(extra + "\npostCalls = {}; Everloot.itemFactsHooked = nil")
    for file in ["core.lua", "modules/itemfacts.lua"]:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute("Everloot.frame.onEvent(nil, 'ADDON_LOADED', 'Everloot')")


reload(lua)
lua.execute("""
hover({ id = 2075 })
assert(#facts() == 3, 'after a reload on the same build, nothing new')
""")
reload(lua, "BUILD = { '1.60.2', '70999', 'Nov 1 2026', 16002 }")
lua.execute("""
hover({ id = 2075 })
assert(#facts() == 6 and facts()[6].clientBuild == '1.60.2.70999', 'a new build records the item again')
""")
assert check_all(lua) == {"item_fact": 6}

# --- A refused GUID: a tooltip whose GUID is not an item's records nothing ---
lua = fresh()
lua.execute("""
for _, guid in ipairs({ 'Player-1-0A1B2C3D', 'Creature-0-1-2-3-3158-0000000001', 'GameObject-0-1-2-3-1731-1', '', 42, true }) do
  hover({ id = 2075, guid = guid })
end
assert(#facts() == 0, 'no row from a tooltip about a player, a creature or an object')
hover({ id = 2075, guid = 'Item-0-0-0000000000000003' })
assert(#facts() == 3, 'an item GUID is read')
""")

# --- The open-world toggle turns it off; the kind pauses at capacity ---
lua = fresh("EverlootDB = { toggles = { openworld = false } }")
lua.execute("""
assert(Everloot:Status():find('itemfacts: off (follows open-world collection)', 1, true), Everloot:Status())
assert(#postCalls == 0, 'no hook while open-world collection is off')
""")
lua = fresh()
lua.execute("""
Everloot.MAX_ROWS_PER_KIND = 4
hover({ id = 2075 })
hover({ id = 15055 })
assert(#facts() == 4, 'the kind fills to its cap')
assert(EverlootDB.paused and EverlootDB.paused.item_fact, 'and pauses there')
assert(EverlootDB.itemFactSeen[15055] == nil, 'an item cut short is not marked as recorded')
""")
assert check_all(lua) == {"item_fact": 4}

# --- No local path and no advertisement in the module's text ---
source = (root / "modules" / "itemfacts.lua").read_text(encoding="utf-8")
for pattern in [r"[A-Za-z]:[\\/]", r"/Users/", r"/home/", r"\\\\", r"https?://", r"www\.", r"everloot\.app", r"discord"]:
    assert not re.search(pattern, source, re.I), f"itemfacts.lua carries {pattern!r}"
strings = re.findall(r'"(?:\\.|[^"\\])*"', "\n".join(line.split("--")[0] for line in source.splitlines()))
shown = [s for s in strings if " " in s]
assert shown and all(s.startswith(('"off (', '"ready (')) or s in ('"tooltip API unavailable"', '"GetItemStats unavailable"') for s in shown), shown

print("item_facts_contract: ok")
