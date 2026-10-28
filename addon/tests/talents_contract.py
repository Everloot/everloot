"""Run with: uv run --with lupa --with jsonschema python addon/tests/talents_contract.py"""
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).parents[1]
toc = (root / "Everloot.toc").read_text(encoding="utf-8")
for module in ["talents", "selftest", "plan"]:
    assert f"modules\\{module}.lua" in toc, f"{module} module must be in the TOC"
assert toc.index("modules\\talents.lua") < toc.index("modules\\selftest.lua") < toc.index("modules\\plan.lua"), "talents loads first"


def loadout(version: int, spec: int) -> str:
    """A loadout string head written the way Blizzard's file describes it: values packed
    least-significant bit first, 6 bits per character, standard base64 alphabet, no padding."""
    fields = [(8, version), (16, spec), (128, 0), (1, 1), (1, 1), (1, 0), (1, 0)]
    bits = [(value >> k) & 1 for width, value in fields for k in range(width)]
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    chars = []
    for i in range(0, len(bits), 6):
        chunk = bits[i:i + 6]
        chars.append(alphabet[sum(bit << n for n, bit in enumerate(chunk))])
    return "".join(chars)


GOOD = loadout(2, 1482)

STUBS = """
date = function() return '2026-10-17T00:00:00Z' end
time = function() return 123456 end
printed = {}
print = function(text) table.insert(printed, text) end
SlashCmdList = {}
CreateFrame = function() return {
 RegisterEvent=function(self, name) self.events=self.events or {}; self.events[name]=true end,
 SetScript=function(self, _, f) self.onEvent=f end,
 HookScript=function(self, _, f) self.hooks=self.hooks or {}; table.insert(self.hooks,f) end
} end
GetBuildInfo = function() return '1.60.1', '70450', 'Oct 1 2026', 11508 end
LEVEL = 45
CLASS = 'MAGE'
UnitClass = function(unit) assert(unit == 'player'); return 'Mage', CLASS, 8 end
UnitLevel = function(unit) assert(unit == 'player'); return LEVEL end
SPEC = 1482
PlayerUtil = { GetCurrentSpecID = function() return SPEC end }
GROUPS = 2
ACTIVE = 1
CONFIGS = { [1] = 10, [2] = 20 }
C_SpecializationInfo = {
 GetNumSpecGroups = function() return GROUPS end,
 GetActiveSpecGroup = function() return ACTIVE end,
 GetCombatConfigIDForSpecGroup = function(group) return CONFIGS[group] end,
}
calls = { import = 0, view = 0, purchase = 0 }
EXPORT = '__LOADOUT__'
VERSION = 2
-- Node data per config: ranksPurchased, maxRanks, entries.
NODES = {
 [10] = {
  [90001] = { ranksPurchased = 2, activeRank = 2, maxRanks = 3 },
  [90002] = { ranksPurchased = 1, activeRank = 1, maxRanks = 1, entryIDs = { 501, 502 }, activeEntry = { entryID = 502, rank = 1 } },
  [90003] = { ranksPurchased = 0, activeRank = 1, maxRanks = 1 },
  [90004] = { ranksPurchased = 0, activeRank = 0, maxRanks = 2 },
 },
 [20] = {
  [90001] = { ranksPurchased = 0, activeRank = 0, maxRanks = 3 },
  [90002] = { ranksPurchased = 0, activeRank = 0, maxRanks = 1, entryIDs = { 501, 502 } },
  [90003] = { ranksPurchased = 0, activeRank = 1, maxRanks = 1 },
  [90004] = { ranksPurchased = 1, activeRank = 1, maxRanks = 2 },
 },
}
TREE_NODES = { 90001, 90002, 90003, 90004 }
C_Traits = {
 GetConfigInfo = function(id) if NODES[id] then return { ID = id, treeIDs = { 786 } } end end,
 GetTreeNodes = function(tree) assert(tree == 786); return TREE_NODES end,
 GetNodeInfo = function(config, node) local n = NODES[config][node]; if n then local copy = { ID = node }; for k, v in pairs(n) do copy[k] = v end; return copy end end,
 GetEntryInfo = function() return { definitionID = 1 } end,
 GetDefinitionInfo = function() return { spellID = 1 } end,
 GenerateImportString = function(config) if type(EXPORT) == 'function' then return EXPORT(config) end return EXPORT end,
 GetLoadoutSerializationVersion = function() return VERSION end,
 GetTreeHash = function() return 'hash' end,
 PurchaseRank = function() calls.purchase = calls.purchase + 1 end,
}
C_ClassTalents = {
 GetActiveConfigID = function() return CONFIGS[ACTIVE] end,
 ImportLoadout = function() calls.import = calls.import + 1 end,
 ViewLoadout = function() calls.view = calls.view + 1 end,
}
"""


def fresh(extra: str = "", saved: str = "nil"):
    lua = LuaRuntime()
    lua.execute(STUBS.replace("__LOADOUT__", GOOD))
    lua.execute(extra)
    for file in ["core.lua", "modules/talents.lua", "modules/selftest.lua", "modules/plan.lua"]:
        lua.execute((root / file).read_text(encoding="utf-8"))
    lua.execute(f"EverlootDB = {saved}")
    lua.execute("""
Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot')
function event(name) for _, hook in ipairs(Everloot.frame.hooks or {}) do hook(nil, name) end end
function reload() Everloot.frame.hooks = nil; Everloot.frame.onEvent(nil,'ADDON_LOADED','Everloot'); event('PLAYER_ENTERING_WORLD') end
""")
    return lua


# --- Both spec groups are recorded, spent ranks only, in the intake shape ---
lua = fresh()
lua.execute("""
assert(EverlootDB.toggles.talents == true, 'talents are on by default')
event('PLAYER_ENTERING_WORLD')
local rows = EverlootDB.records.talent_snapshot
assert(rows and #rows == 2, 'both spec groups are recorded')
local a, b = rows[1], rows[2]
assert(a.group == 1 and a.active == true and a.configId == 10 and a.treeId == 786, 'group 1: config and tree')
assert(a.class == 'MAGE' and a.level == 45 and a.clientBuild == '1.60.1.70450' and a.specId == 1482)
assert(a.points == 3 and #a.nodes == 2, 'granted and empty nodes are not spent points')
assert(a.nodes[1].nodeId == 90001 and a.nodes[1].ranks == 2 and a.nodes[1].choice == nil)
assert(a.nodes[2].nodeId == 90002 and a.nodes[2].ranks == 1 and a.nodes[2].choice == 1, 'a choice node keeps its zero-based entry')
assert(a.exportStatus == 'ok' and a.loadoutString == EXPORT and a.serializationVersion == 2, 'the game export is stored with its status')
assert(b.group == 2 and b.active == false and b.configId == 20 and b.points == 1 and b.specId == nil, 'group 2')
assert(a.installId == EverlootDB.installId and a.capturedAt == '2026-10-17T00:00:00Z' and a.eventId)
local allowed = { installId=1, capturedAt=1, eventId=1, kindLoggedAt=1, class=1, level=1, group=1, active=1, configId=1, treeId=1,
  specId=1, clientBuild=1, serializationVersion=1, loadoutString=1, exportStatus=1, points=1, nodes=1 }
for _, row in ipairs(rows) do for key in pairs(row) do assert(allowed[key], 'unexpected field ' .. key) end end

-- Unchanged builds are not stored again; a change is.
event('TRAIT_CONFIG_UPDATED'); reload()
assert(Everloot:Count('talent_snapshot') == 2, 'same build, same rows')
NODES[10][90004].ranksPurchased = 1
event('TRAIT_CONFIG_UPDATED')
assert(Everloot:Count('talent_snapshot') == 3 and EverlootDB.records.talent_snapshot[3].points == 4, 'a spent point adds one row')
assert(string.find(Everloot:Status(), 'rows talent_snapshot: 3', 1, true))
assert(calls.import == 0 and calls.view == 0 and calls.purchase == 0, 'reading never imports, views or spends')
""")

# --- Before level 40 there is one group; no points, no row ---
lua = fresh("GROUPS = 1; LEVEL = 30")
lua.execute("""
event('PLAYER_ENTERING_WORLD')
assert(Everloot:Count('talent_snapshot') == 1 and EverlootDB.records.talent_snapshot[1].level == 30)
""")
lua = fresh("for _, n in pairs(NODES[10]) do n.ranksPurchased = 0 end")
lua.execute("event('PLAYER_ENTERING_WORLD'); assert(Everloot:Count('talent_snapshot') == 1, 'only the group with spent points')")

# --- Active config only when the spec group lookup is missing ---
lua = fresh("C_SpecializationInfo = nil")
lua.execute("""
event('PLAYER_ENTERING_WORLD')
local rows = EverlootDB.records.talent_snapshot
assert(#rows == 1 and rows[1].group == 1 and rows[1].configId == 10, 'falls back to the active config')
""")

# --- The export never breaks the row: each failure becomes a status ---
for name, stub, status in [
    ("error", "EXPORT = function() error('nope') end", "failed"),
    ("empty", "EXPORT = ''", "empty"),
    ("junk", "EXPORT = 'not base64!'", "unexpected"),
    ("missing", "C_Traits.GenerateImportString = nil", "unavailable"),
]:
    lua = fresh(stub)
    lua.execute(f"""
event('PLAYER_ENTERING_WORLD')
local row = EverlootDB.records.talent_snapshot[1]
assert(row and row.exportStatus == '{status}' and row.loadoutString == nil, '{name}: ' .. tostring(row and row.exportStatus))
assert(#row.nodes == 2, 'the node list survives a failed export')
""")

# --- Events come in bursts: one timer, one read ---
lua = fresh("""
timers = {}
C_Timer = { After = function(seconds, fn) table.insert(timers, fn) end }
""")
lua.execute("""
event('TRAIT_CONFIG_UPDATED'); event('TRAIT_CONFIG_UPDATED'); event('PLAYER_TALENT_UPDATE')
assert(#timers == 1 and Everloot:Count('talent_snapshot') == 0, 'a burst schedules one read')
timers[1]()
assert(Everloot:Count('talent_snapshot') == 2)
event('TRAIT_CONFIG_UPDATED')
assert(#timers == 2, 'the next burst schedules again')
""")

# --- Guarded: no trait API, an error inside it, a missing player ---
lua = fresh("C_Traits = nil")
lua.execute("""
event('PLAYER_ENTERING_WORLD')
assert(Everloot:Count('talent_snapshot') == 0)
assert(string.find(Everloot:Status(), 'talents: disabled', 1, true), 'no C_Traits disables the module')
""")
lua = fresh("C_Traits.GetNodeInfo = function() error('boom') end")
lua.execute("event('PLAYER_ENTERING_WORLD'); assert(Everloot:Count('talent_snapshot') == 0, 'a failing call stores nothing and does not raise')")
lua = fresh("UnitClass = nil")
lua.execute("event('PLAYER_ENTERING_WORLD'); assert(Everloot:Count('talent_snapshot') == 0)")
lua = fresh("", "{ installId = 'abcd-1234', toggles = { openworld = true, talents = false }, records = {} }")
lua.execute("""
assert(string.find(Everloot:Status(), 'talents: off by toggle', 1, true))
event('PLAYER_ENTERING_WORLD'); assert(Everloot:Count('talent_snapshot') == 0)
""")
lua = fresh("", "{ installId = 'abcd-1234', toggles = { openworld = true }, records = {} }")
lua.execute("assert(EverlootDB.toggles.talents == true, 'an upgraded install starts with talents on')")

# --- Loadout string header: version, then spec id, least-significant bit first ---
lua = fresh()
lua.execute(f"""
local v, s = Everloot.Talents.DecodeHeader('{GOOD}')
assert(v == 2 and s == 1482, 'header decodes: ' .. tostring(v) .. ' ' .. tostring(s))
assert(Everloot.Talents.DecodeHeader('') == nil and Everloot.Talents.DecodeHeader('!!!!!!') == nil and Everloot.Talents.DecodeHeader('Co') == nil)
""")

# --- Selftest: every check passes on a healthy client and is saved ---
lua = fresh("""
PlayerSpellsFrame = { IsShown = function() return true end, TalentsFrame = { GetTalentButtonByNodeID = function() end } }
""")
lua.execute("""
SlashCmdList.EVERLOOT('selftest')
local st = EverlootDB.selftest
assert(st and st.failed == 0 and st.passed >= 20, 'healthy client: ' .. table.concat(st.results, '\\n'))
assert(st.addonVersion == Everloot.VERSION and st.clientBuild == '1.60.1.70450' and st.at)
local text = table.concat(st.results, '\\n')
for _, expected in ipairs({ 'PASS C_Traits.GenerateImportString', 'PASS C_ClassTalents.ImportLoadout exists', 'PASS group 1 (active) loadout export',
  'PASS group 2 reads', 'PASS group 1 (active) export spec id', 'PASS group 1 (active) node order', 'INFO serialization version: 2',
  'PASS TalentsFrame.GetTalentButtonByNodeID' }) do
 assert(string.find(text, expected, 1, true), 'missing line: ' .. expected .. '\\n' .. text)
end
assert(#printed > st.passed, 'the lines are printed to chat')
assert(calls.import == 0 and calls.view == 0 and calls.purchase == 0, 'selftest never imports, views or spends')
""")

# --- Selftest: what is wrong is named ---
lua = fresh("""
VERSION = 3
SPEC = 1485
TREE_NODES = { 90003, 90001, 90002, 90004 }
C_ClassTalents.ImportLoadout = nil
C_Traits.GetTreeHash = nil
""")
lua.execute("""
SlashCmdList.EVERLOOT('selftest')
local st = EverlootDB.selftest
local text = table.concat(st.results, '\\n')
for _, expected in ipairs({ 'FAIL group 1 (active) export version', 'FAIL group 1 (active) export spec id', 'FAIL group 1 (active) node order',
  'FAIL C_ClassTalents.ImportLoadout exists', 'FAIL C_Traits.GetTreeHash', 'SKIP talent window' }) do
 assert(string.find(text, expected, 1, true), 'missing line: ' .. expected .. '\\n' .. text)
end
assert(st.failed >= 5)
""")
lua = fresh("C_Traits = nil; C_ClassTalents = nil")
lua.execute("""
SlashCmdList.EVERLOOT('selftest')
local st = EverlootDB.selftest
assert(st.failed >= 1 and string.find(table.concat(st.results, '\\n'), 'FAIL C_Traits exists', 1, true), 'no C_Traits is reported, not raised')
""")
lua = fresh("C_Traits.GenerateImportString = nil")
lua.execute("""
SlashCmdList.EVERLOOT('selftest')
local text = table.concat(EverlootDB.selftest.results, '\\n')
assert(string.find(text, 'FAIL group 1 (active) loadout export: GenerateImportString: unavailable', 1, true), text)
""")

# --- /everloot talents prints the build and a share code ---
lua = fresh()
lua.execute("""
SlashCmdList.EVERLOOT('talents')
local text = table.concat(printed, '\\n')
assert(string.find(text, 'spec group 1 (active): 3 points, export ok', 1, true), text)
assert(string.find(text, 'share code: EL1-mage-1482-1.60.1.70450-', 1, true), text)
""")

# Every row the addon wrote is a record the site would accept (packages/protocol/schema).
from protocol_schema import check_all  # noqa: E402
check_all(lua)
print("Lua 5.1 talents: both spec groups, spent nodes, game export and status, guarded calls, selftest pass/fail lines")
